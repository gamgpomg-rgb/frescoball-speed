"""Canonical Frescoball speed calculations shared by the CLI tools.

The values live in ``../measurement-spec.json``.  The PWA consumes a generated
browser copy of that same file, and tests exercise known intervals in both
languages.  A calibration factor is always an explicit optional input; the
default is the documented physical drag model, not an unverified field value.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Mapping


_ROOT = Path(__file__).resolve().parent.parent
_SPEC_PATH = _ROOT / "measurement-spec.json"
SPEC: Mapping[str, Any] = json.loads(_SPEC_PATH.read_text(encoding="utf-8"))
SPEC_VERSION = str(SPEC["version"])

# Compatibility exports for existing scripts and notebooks.
BALL_DIAMETER_M = float(SPEC["ballDiameterM"])
BALL_MASS_KG = float(SPEC["ballMassKg"])
DRAG_CD = float(SPEC["dragCoefficient"])
AIR_DENSITY = float(SPEC["airDensityKgM3"])
COURT_LENGTH_M = float(SPEC["defaultCourtLengthM"])
SOUND_SPEED = float(SPEC["soundSpeedMps"])
SPEED_THRESHOLDS_KMH = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]

def _positive(value: float, name: str) -> float:
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive finite number")
    return value


def drag_k() -> float:
    """Quadratic-drag distance coefficient ``k`` in 1/m."""
    area = math.pi * (BALL_DIAMETER_M / 2) ** 2
    return AIR_DENSITY * DRAG_CD * area / (2 * BALL_MASS_KG)


def theoretical_v0_factor(length_m: float = COURT_LENGTH_M) -> float:
    """Physical-model average-speed -> launch-speed factor.

    With ``v(x) = v0 * exp(-k*x)``, the factor is
    ``(exp(kL)-1)/(kL)``.  It is not a field calibration result.
    """
    length_m = _positive(length_m, "length_m")
    k_l = drag_k() * length_m
    return math.expm1(k_l) / k_l


def v0_factor(length_m: float = COURT_LENGTH_M) -> float:
    """Backward-compatible name for the theoretical factor."""
    return theoretical_v0_factor(length_m)


def resolve_v0_factor(
    length_m: float = COURT_LENGTH_M, calibration_factor: float | None = None
) -> float:
    """Return an explicit calibration factor, otherwise the physical model."""
    if calibration_factor is None:
        return theoretical_v0_factor(length_m)
    return _positive(calibration_factor, "calibration_factor")


def avg_to_initial_kmh(
    v_avg_kmh: float,
    length_m: float = COURT_LENGTH_M,
    calibration_factor: float | None = None,
) -> float:
    """Convert average speed [km/h] to initial speed [km/h]."""
    return _positive(v_avg_kmh, "v_avg_kmh") * resolve_v0_factor(length_m, calibration_factor)


def flight_time_to_speeds(
    dt_s: float,
    length_m: float = COURT_LENGTH_M,
    calibration_factor: float | None = None,
) -> tuple[float, float]:
    """Actual flight time [s] -> (average km/h, initial km/h)."""
    dt_s = _positive(dt_s, "dt_s")
    length_m = _positive(length_m, "length_m")
    v_avg = length_m / dt_s * 3.6
    return v_avg, avg_to_initial_kmh(v_avg, length_m, calibration_factor)


def corrected_flight_time_s(
    observed_dt_s: float,
    pair_start_index: int,
    mic_position: str = "center",
    first_onset_side: str = "near",
    length_m: float = COURT_LENGTH_M,
) -> float:
    """Correct an observed onset interval for microphone propagation delay.

    ``pair_start_index`` is the index of the first onset in the pair.  If the
    microphone is near one player, a near->far interval includes ``L/c`` and
    therefore subtracts it; a far->near interval omits ``L/c`` and adds it.
    ``first_onset_side`` makes the otherwise ambiguous first pair explicit.
    """
    observed_dt_s = _positive(observed_dt_s, "observed_dt_s")
    if mic_position == "center":
        return observed_dt_s
    if mic_position != "near":
        raise ValueError("mic_position must be 'center' or 'near'")
    if not isinstance(pair_start_index, int) or pair_start_index < 0:
        raise ValueError("pair_start_index must be a non-negative integer")
    if first_onset_side not in {"near", "far"}:
        raise ValueError("first_onset_side must be 'near' or 'far'")
    length_m = _positive(length_m, "length_m")
    starts_near = (pair_start_index % 2 == 0 and first_onset_side == "near") or (
        pair_start_index % 2 == 1 and first_onset_side == "far"
    )
    propagation_delay = length_m / SOUND_SPEED
    return observed_dt_s - propagation_delay if starts_near else observed_dt_s + propagation_delay


def measure_observed_interval(
    observed_dt_s: float,
    *,
    pair_start_index: int = 0,
    mic_position: str = "center",
    first_onset_side: str = "near",
    length_m: float = COURT_LENGTH_M,
    calibration_factor: float | None = None,
    min_flight_s: float | None = None,
    max_flight_s: float | None = None,
    max_initial_kmh: float | None = None,
) -> dict[str, float | str | bool]:
    """Pure quality-gated interval calculation used by audio analysis.

    The result always contains the corrected flight time.  Rejected readings
    include a stable ``reason`` so callers can report rather than silently
    count an acoustic echo or an implausible value.
    """
    q = SPEC["qualityGate"]
    min_flight_s = _positive(q["minFlightSeconds"] if min_flight_s is None else min_flight_s, "min_flight_s")
    max_flight_s = _positive(q["maxFlightSeconds"] if max_flight_s is None else max_flight_s, "max_flight_s")
    max_initial_kmh = _positive(q["maxInitialSpeedKmh"] if max_initial_kmh is None else max_initial_kmh, "max_initial_kmh")
    if min_flight_s > max_flight_s:
        raise ValueError("min_flight_s must not exceed max_flight_s")
    flight_s = corrected_flight_time_s(
        observed_dt_s,
        pair_start_index,
        mic_position,
        first_onset_side,
        length_m,
    )
    result: dict[str, float | str | bool] = {
        "accepted": False,
        "observed_seconds": float(observed_dt_s),
        "flight_seconds": flight_s,
        "propagation_correction_seconds": flight_s - float(observed_dt_s),
    }
    if flight_s < min_flight_s or flight_s > max_flight_s:
        result["reason"] = "flight_time_out_of_range"
        return result
    average_kmh, initial_kmh = flight_time_to_speeds(flight_s, length_m, calibration_factor)
    result.update(average_kmh=average_kmh, initial_kmh=initial_kmh)
    if initial_kmh > max_initial_kmh:
        result["reason"] = "initial_speed_above_trust_limit"
        return result
    result["accepted"] = True
    return result


def threshold_counts(initial_speeds_kmh, thresholds=SPEED_THRESHOLDS_KMH):
    """Count speeds at or above every threshold."""
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
    for threshold, count in threshold_counts(initial_speeds_kmh).items():
        if count > 0:
            lines.append(f"  {threshold} km/h 以上: {count} 回")
    return "\n".join(lines)


if __name__ == "__main__":
    print(f"仕様バージョン = {SPEC_VERSION}")
    print(f"k = {drag_k():.5f} /m, 理論v0換算係数(7m) = {theoretical_v0_factor():.4f}")
    for dt in (0.30, 0.40, 0.54):
        average, initial = flight_time_to_speeds(dt)
        print(f"飛行時間 {dt:.2f}s -> 平均 {average:.1f} km/h, 初速換算 {initial:.1f} km/h")
