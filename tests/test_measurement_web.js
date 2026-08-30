"use strict";

const assert = require("assert");
const measurement = require("../measurement-spec.js");

const delay = 7 / measurement.spec.soundSpeedMps;
assert.ok(Math.abs(measurement.theoreticalInitialFactor(7) - 1.0700777979334524) < 1e-12);
assert.ok(Math.abs(measurement.correctedFlightTime(0.4 + delay, 0, "near", "near", 7) - 0.4) < 1e-12);
assert.ok(Math.abs(measurement.correctedFlightTime(0.4 - delay, 1, "near", "near", 7) - 0.4) < 1e-12);
assert.ok(Math.abs(measurement.correctedFlightTime(0.4 - delay, 0, "near", "far", 7) - 0.4) < 1e-12);
const result = measurement.measureInterval({ observedSeconds: 0.5, lengthM: 7, micPosition: "center" });
assert.strictEqual(result.accepted, true);
assert.ok(Math.abs(result.averageSpeedKmh - 50.4) < 1e-12);
assert.ok(Math.abs(result.initialSpeedKmh - 53.931921015846) < 1e-9);
const rejected = measurement.measureInterval({ observedSeconds: 0.205, lengthM: 7, micPosition: "center" });
assert.strictEqual(rejected.accepted, false);
assert.strictEqual(rejected.reason, "initial_speed_above_trust_limit");
console.log("Web measurement regression tests passed");
