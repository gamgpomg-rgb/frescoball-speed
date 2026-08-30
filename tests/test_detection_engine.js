"use strict";

const assert = require("assert");
const detection = require("../detection-engine.js");
const measurement = require("../measurement-spec.js");

assert.strictEqual(detection.DEFAULTS.liveWarmupSeconds, 0.75);
assert.strictEqual(detection.DEFAULTS.videoWarmupSeconds, 0.5);

function quietFrames(detector, from, to, step = 0.01) {
  for (let t = from; t < to - 1e-9; t += step) {
    detector.process({
      rms: 1e-4,
      now: t,
      sensitivity: 6,
      attackThreshold: 3,
      flatnessThreshold: 0.17,
      flatness: 0.5
    });
  }
}

function transient(detector, now) {
  return detector.process({
    rms: 0.02,
    now,
    sensitivity: 6,
    attackThreshold: 3,
    flatnessThreshold: 0.17,
    flatness: 0.5
  });
}

const detector = detection.createOnsetDetector({
  warmupSeconds: detection.DEFAULTS.videoWarmupSeconds,
  startTime: 0
});

// A codec/microphone start-up spike and another spike 0.28s later previously
// formed a plausible 96km/h pair. Both must be ignored during calibration.
assert.strictEqual(transient(detector, 0).detected, false);
quietFrames(detector, 0.01, 0.28);
const secondStartupSpike = transient(detector, 0.28);
assert.strictEqual(secondStartupSpike.warmingUp, true);
assert.strictEqual(secondStartupSpike.detected, false);
quietFrames(detector, 0.29, 1.0);

// Real high-speed play remains measurable after warm-up; the fix must not be
// a blanket 90km/h cap.
assert.strictEqual(transient(detector, 1.0).detected, true);
quietFrames(detector, 1.01, 1.28);
assert.strictEqual(transient(detector, 1.28).detected, true);
const highSpeed = measurement.measureInterval({
  observedSeconds: 0.28,
  lengthM: 7,
  micPosition: "center"
});
assert.strictEqual(highSpeed.accepted, true);
assert.ok(highSpeed.initialSpeedKmh > 90 && highSpeed.initialSpeedKmh < 110);

// Restarting a measurement resets both the envelope and the warm-up clock.
const restarted = detector.reset(2);
assert.strictEqual(restarted.readyAt, 2 + detection.DEFAULTS.videoWarmupSeconds);
const restartSpike = transient(detector, 2);
assert.strictEqual(restartSpike.warmingUp, true);
assert.strictEqual(restartSpike.detected, false);

const missingSpectrum = detection.createOnsetDetector({ warmupSeconds: 0, startTime: 0 });
const noFlatnessResult = missingSpectrum.process({
  rms: 0.02,
  now: 1,
  sensitivity: 6,
  attackThreshold: 3,
  flatnessThreshold: 0.17
});
assert.strictEqual(noFlatnessResult.detected, false);

console.log("Detection start-up regression tests passed");
