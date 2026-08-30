"""Regression tests for the canonical Python measurement implementation."""
from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from fresco_physics import (  # noqa: E402
    SOUND_SPEED,
    corrected_flight_time_s,
    measure_observed_interval,
    theoretical_v0_factor,
)


class MeasurementRegressionTests(unittest.TestCase):
    def test_generated_browser_spec_is_current(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "sync_measurement_spec.py"), "--check"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_known_theoretical_factor_at_seven_metres(self) -> None:
        self.assertAlmostEqual(theoretical_v0_factor(7.0), 1.0700777979334524, places=12)

    def test_near_microphone_signs_when_first_onset_is_near(self) -> None:
        actual = 0.4
        delay = 7.0 / SOUND_SPEED
        self.assertAlmostEqual(corrected_flight_time_s(actual + delay, 0, "near", "near", 7.0), actual, places=12)
        self.assertAlmostEqual(corrected_flight_time_s(actual - delay, 1, "near", "near", 7.0), actual, places=12)

    def test_near_microphone_signs_when_first_onset_is_far(self) -> None:
        actual = 0.4
        delay = 7.0 / SOUND_SPEED
        self.assertAlmostEqual(corrected_flight_time_s(actual - delay, 0, "near", "far", 7.0), actual, places=12)
        self.assertAlmostEqual(corrected_flight_time_s(actual + delay, 1, "near", "far", 7.0), actual, places=12)

    def test_known_interval_and_quality_gate(self) -> None:
        result = measure_observed_interval(0.5, length_m=7.0)
        self.assertTrue(result["accepted"])
        self.assertAlmostEqual(float(result["average_kmh"]), 50.4, places=9)
        self.assertAlmostEqual(float(result["initial_kmh"]), 53.931921015846, places=9)
        rejected = measure_observed_interval(0.205, length_m=7.0)
        self.assertFalse(rejected["accepted"])
        self.assertEqual(rejected["reason"], "initial_speed_above_trust_limit")


if __name__ == "__main__":
    unittest.main()
