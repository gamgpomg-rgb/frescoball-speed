"""フレスコボール球速計算の共通物理モジュール。

平均速度→初速の換算（空気抵抗補正）と閾値カウントを提供する。
パラメータは実測で更新すること（レポート§3「要実測項目」参照）。
"""
import math

# ===== ボール・環境パラメータ（要実測で更新） =====
BALL_DIAMETER_M = 0.057   # 直径 [m]（市販フレスコボール球 2.25in ベース）
BALL_MASS_KG = 0.040      # 質量 [kg]
DRAG_CD = 0.5             # 抗力係数（滑らかな球, Re~1e5）
AIR_DENSITY = 1.2         # 空気密度 [kg/m^3]
COURT_LENGTH_M = 7.0      # ペア間距離 [m]
SOUND_SPEED = 343.0       # 音速 [m/s]

# スピードガン併走校正後はこちらを直接上書きしてもよい（None=物理モデルから算出）
CALIBRATED_V0_FACTOR = None

SPEED_THRESHOLDS_KMH = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]


def drag_k() -> float:
    """二次抗力の距離減衰率 k [1/m]。 v(x) = v0 * exp(-k x)"""
    area = math.pi * (BALL_DIAMETER_M / 2) ** 2
    return AIR_DENSITY * DRAG_CD * area / (2 * BALL_MASS_KG)


def v0_factor(length_m: float = COURT_LENGTH_M) -> float:
    """平均速度→初速の換算係数。 v0 = factor * v_avg

    導出: v(x)=v0 e^{-kx} より飛行時間 T=(e^{kL}-1)/(k v0)
          v_avg = L/T = k L v0 / (e^{kL}-1)
    """
    if CALIBRATED_V0_FACTOR is not None:
        return CALIBRATED_V0_FACTOR
    kL = drag_k() * length_m
    return (math.exp(kL) - 1) / kL


def avg_to_initial_kmh(v_avg_kmh: float, length_m: float = COURT_LENGTH_M) -> float:
    """7m平均速度[km/h]を打球初速[km/h]に換算する。"""
    return v_avg_kmh * v0_factor(length_m)


def flight_time_to_speeds(dt_s: float, length_m: float = COURT_LENGTH_M):
    """飛行時間[s] -> (平均速 km/h, 初速換算 km/h)"""
    v_avg = length_m / dt_s * 3.6
    return v_avg, avg_to_initial_kmh(v_avg, length_m)


def threshold_counts(initial_speeds_kmh, thresholds=SPEED_THRESHOLDS_KMH):
    """初速リストから「各閾値を超えた打球数」を集計する。"""
    return {th: sum(1 for v in initial_speeds_kmh if v >= th) for th in thresholds}


def format_report(initial_speeds_kmh) -> str:
    if not initial_speeds_kmh:
        return "打球が検出されませんでした。"
    lines = [
        f"打球数: {len(initial_speeds_kmh)}",
        f"最高初速: {max(initial_speeds_kmh):.1f} km/h",
        f"平均初速: {sum(initial_speeds_kmh)/len(initial_speeds_kmh):.1f} km/h",
        "",
        "閾値超えカウント（初速換算ベース）:",
    ]
    counts = threshold_counts(initial_speeds_kmh)
    for th, n in counts.items():
        if n > 0:
            lines.append(f"  {th} km/h 以上: {n} 回")
    return "\n".join(lines)


if __name__ == "__main__":
    print(f"k = {drag_k():.5f} /m, v0換算係数(7m) = {v0_factor():.4f}")
    for dt in (0.30, 0.40, 0.54):
        va, v0 = flight_time_to_speeds(dt)
        print(f"飛行時間 {dt:.2f}s -> 平均 {va:.1f} km/h, 初速換算 {v0:.1f} km/h")
