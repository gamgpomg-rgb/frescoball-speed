"""フレスコボール球速 動画解析スクリプト（A方式: 打→打フレーム間隔）。

使い方:
    pip install opencv-python
    python video_speed.py ラリー動画.mov [--fps 240] [--distance 7.0]

操作（プレビューウィンドウ）:
    j / l       : 1フレーム戻る / 進む
    J / L       : 10フレーム戻る / 進む
    SPACE       : 現在フレームを「打点」としてマーク
    u           : 直前のマークを取り消し
    q または ESC : 終了して集計を表示

原理:
    打点フレーム同士の間隔 Δframes / fps = 飛行時間。
    既知距離(7m)から平均速度を出し、空気抵抗補正で初速に換算する。
    画素校正（px→m）は不要。

注意:
    iPhoneのスロー動画は全フレームが実撮影fps(例:240)で格納されている。
    メタデータfpsが240でない場合（再エンコード後など）は --fps で実撮影fpsを指定。
"""
import argparse
import sys

import cv2

from fresco_physics import COURT_LENGTH_M, SPEC, SPEC_VERSION, format_report, measure_observed_interval


DEFAULT_GATE = SPEC["qualityGate"]


def main():
    ap = argparse.ArgumentParser(description="フレスコボール球速 動画解析（打点フレーム手動マーク方式）")
    ap.add_argument("video", help="解析する動画ファイル（240fpsスロー推奨）")
    ap.add_argument("--fps", type=float, default=None,
                    help="実撮影fps（省略時はメタデータから取得）")
    ap.add_argument("--distance", type=float, default=COURT_LENGTH_M, help="選手間距離 [m]")
    ap.add_argument("--scale", type=float, default=0.5, help="表示縮小率")
    ap.add_argument("--min-dt", type=float, default=float(DEFAULT_GATE["minFlightSeconds"]), help="信頼する最小飛行時間 [s]")
    ap.add_argument("--max-dt", type=float, default=float(DEFAULT_GATE["maxFlightSeconds"]), help="信頼する最大飛行時間 [s]")
    ap.add_argument("--max-initial-kmh", type=float, default=float(DEFAULT_GATE["maxInitialSpeedKmh"]),
                    help="信頼する初速の上限 [km/h]。超過値は集計から除外")
    ap.add_argument("--calibration-factor", type=float, default=None,
                    help="明示的な平均速→初速係数。省略時は物理モデル")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"動画を開けません: {args.video}")

    meta_fps = cap.get(cv2.CAP_PROP_FPS)
    fps = args.fps or meta_fps
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"メタデータfps={meta_fps:.1f}  採用fps={fps:.1f}  総フレーム={total}")
    if fps < 100:
        print("警告: fpsが100未満です。再エンコードで実fpsが落ちている可能性。--fps 240 を検討してください。")

    frames = []          # デコード済みフレームのキャッシュ（メモリ節約のため随時読み）
    idx = 0
    marks = []           # 打点フレーム番号

    def read_frame(i):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        return frame if ok else None

    win = "fresco - j/l:1F  J/L:10F  SPACE:mark  u:undo  q:quit"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    while True:
        frame = read_frame(idx)
        if frame is None:
            idx = max(0, min(idx, total - 1))
            frame = read_frame(idx)
            if frame is None:
                break
        disp = cv2.resize(frame, None, fx=args.scale, fy=args.scale)
        label = f"frame {idx}/{total-1}  t={idx/fps:.4f}s  marks={marks[-6:]}"
        cv2.putText(disp, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imshow(win, disp)

        key = cv2.waitKey(0) & 0xFF
        if key in (ord("q"), 27):
            break
        elif key == ord("l"):
            idx = min(idx + 1, total - 1)
        elif key == ord("j"):
            idx = max(idx - 1, 0)
        elif key == ord("L"):
            idx = min(idx + 10, total - 1)
        elif key == ord("J"):
            idx = max(idx - 10, 0)
        elif key == ord(" "):
            marks.append(idx)
            print(f"マーク: frame {idx} (t={idx/fps:.4f}s)")
        elif key == ord("u") and marks:
            removed = marks.pop()
            print(f"取り消し: frame {removed}")

    cap.release()
    cv2.destroyAllWindows()

    # ===== 集計 =====
    marks.sort()
    speeds = []
    print(f"\n===== 打球ごとの結果（計算仕様 {SPEC_VERSION}） =====")
    for i, (a, b) in enumerate(zip(marks, marks[1:])):
        dt = (b - a) / fps
        result = measure_observed_interval(
            dt,
            pair_start_index=i,
            mic_position="center",  # フレーム時刻は音の伝搬遅延を含まない
            length_m=args.distance,
            calibration_factor=args.calibration_factor,
            min_flight_s=args.min_dt,
            max_flight_s=args.max_dt,
            max_initial_kmh=args.max_initial_kmh,
        )
        if not result["accepted"]:
            print(f"frame {a}->{b}: Δt={dt:.3f}s {result['reason']}、スキップ")
            continue
        v_avg = float(result["average_kmh"])
        v0 = float(result["initial_kmh"])
        speeds.append(v0)
        print(f"frame {a}->{b}: Δt={dt:.3f}s  平均 {v_avg:.1f} km/h  初速換算 {v0:.1f} km/h")

    print("\n===== サマリ =====")
    print(format_report(speeds))


if __name__ == "__main__":
    main()
