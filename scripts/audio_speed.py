"""フレスコボール球速 音声解析スクリプト（C方式: 打音時間差）。

使い方:
    pip install numpy scipy
    # 動画から音声を抽出（ffmpeg必須）:
    python audio_speed.py ラリー動画.mov [--distance 7.0] [--mic-pos center|near]

原理:
    打音（インパルス音）のオンセット時刻を検出し、連続する打音の間隔Δtと
    既知距離7mから平均速度を算出、空気抵抗補正で初速に換算する。

マイク位置補正 (--mic-pos):
    center : スマホがコート中央側面（両選手から等距離）→ 補正なし（推奨配置）
    near   : スマホが片方の選手の近く → 遠い選手の打音に 7m/343m/s≈20.4ms の
             伝搬遅延が乗るため、--first-onset-side を基準に交互に補正する。

計算仕様は ../measurement-spec.json を唯一の正本とし、Web PWA と共有する。
"""
import argparse
import os
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

from fresco_physics import COURT_LENGTH_M, SPEC, SPEC_VERSION, format_report, measure_observed_interval


DEFAULT_GATE = SPEC["qualityGate"]


def extract_audio(video_path: str, sr: int = 48000) -> str:
    """ffmpegで動画からモノラルwavを抽出して一時ファイルパスを返す。"""
    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    cmd = ["ffmpeg", "-y", "-i", video_path, "-vn", "-ac", "1",
           "-ar", str(sr), "-loglevel", "error", wav_path]
    subprocess.run(cmd, check=True)
    return wav_path


def detect_onsets(wav_path: str, min_gap_s: float = 0.12, threshold_ratio: float = 6.0):
    """打音オンセット時刻[s]のリストを返す。

    手法: 1kHzハイパス → 短時間エネルギー包絡 → ノイズフロア比で閾値検出。
    パラメータは実データで要チューニング（ビーチの波音・風切り音）。
    """
    sr, x = wavfile.read(wav_path)
    x = x.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    x /= (np.abs(x).max() + 1e-12)

    # 打音はインパルス性・高周波成分が強い → 1kHzハイパスで波音等を抑制
    sos = butter(4, 1000, btype="high", fs=sr, output="sos")
    y = sosfilt(sos, x)

    # 5msウィンドウのRMS包絡
    win = int(sr * 0.005)
    env = np.sqrt(np.convolve(y ** 2, np.ones(win) / win, mode="same"))

    noise_floor = np.median(env)
    th = noise_floor * threshold_ratio
    above = env > th

    onsets = []
    i = 0
    min_gap = int(min_gap_s * sr)
    while i < len(above):
        if above[i]:
            onsets.append(i / sr)
            i += min_gap  # 同一打音内の多重検出を抑止
        else:
            i += 1
    return onsets, noise_floor, th


def main():
    ap = argparse.ArgumentParser(description="フレスコボール球速 音声解析（打音時間差方式）")
    ap.add_argument("media", help="動画(.mov/.mp4)または音声(.wav)ファイル")
    ap.add_argument("--distance", type=float, default=COURT_LENGTH_M, help="選手間距離 [m]")
    ap.add_argument("--mic-pos", choices=["center", "near"], default="center",
                    help="マイク位置（center=コート中央側面/near=片側選手付近）")
    ap.add_argument("--first-onset-side", choices=["near", "far"], default="near",
                    help="near時のみ: 0番目の打音がマイク近側か遠側か（既定near）")
    ap.add_argument("--min-dt", type=float, default=float(DEFAULT_GATE["minFlightSeconds"]), help="飛行時間とみなす最小間隔 [s]")
    ap.add_argument("--max-dt", type=float, default=float(DEFAULT_GATE["maxFlightSeconds"]), help="飛行時間とみなす最大間隔 [s]")
    ap.add_argument("--max-initial-kmh", type=float, default=float(DEFAULT_GATE["maxInitialSpeedKmh"]),
                    help="信頼する初速の上限 [km/h]。超過値は集計から除外")
    ap.add_argument("--calibration-factor", type=float, default=None,
                    help="スピードガン等で得た明示的な平均速→初速係数。省略時は物理モデル")
    ap.add_argument("--threshold", type=float, default=6.0, help="ノイズフロア比の検出閾値")
    args = ap.parse_args()

    wav = args.media
    tmp = None
    if not args.media.lower().endswith(".wav"):
        tmp = extract_audio(args.media)
        wav = tmp

    try:
        onsets, floor, th = detect_onsets(wav, threshold_ratio=args.threshold)
    finally:
        if tmp:
            os.remove(tmp)

    print(f"検出オンセット数: {len(onsets)}（ノイズフロア={floor:.4f}, 閾値={th:.4f}）")
    if len(onsets) < 2:
        sys.exit("打音が2つ以上検出できませんでした。--threshold を下げて再試行してください。")

    speeds = []
    print(f"\n===== 打音ペアごとの結果（計算仕様 {SPEC_VERSION}） =====")
    for i, (t0, t1) in enumerate(zip(onsets, onsets[1:])):
        observed_dt = t1 - t0
        result = measure_observed_interval(
            observed_dt,
            pair_start_index=i,
            mic_position=args.mic_pos,
            first_onset_side=args.first_onset_side,
            length_m=args.distance,
            calibration_factor=args.calibration_factor,
            min_flight_s=args.min_dt,
            max_flight_s=args.max_dt,
            max_initial_kmh=args.max_initial_kmh,
        )
        dt = float(result["flight_seconds"])
        if not result["accepted"]:
            print(
                f"t={t0:7.3f}s -> {t1:7.3f}s: 観測Δt={observed_dt:.3f}s "
                f"補正後={dt:.3f}s {result['reason']}、スキップ"
            )
            continue
        v_avg = float(result["average_kmh"])
        v0 = float(result["initial_kmh"])
        speeds.append(v0)
        print(
            f"t={t0:7.3f}s -> {t1:7.3f}s: 観測Δt={observed_dt:.3f}s "
            f"補正後={dt:.3f}s  平均 {v_avg:.1f} km/h  初速換算 {v0:.1f} km/h"
        )

    print("\n===== サマリ =====")
    print(format_report(speeds))


if __name__ == "__main__":
    main()
