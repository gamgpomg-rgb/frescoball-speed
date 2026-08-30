(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrescoDetection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULTS = Object.freeze({
    initialEnvelope: 1e-4,
    minimumNoiseFloor: 1e-5,
    refractorySeconds: 0.12,
    liveWarmupSeconds: 0.75,
    videoWarmupSeconds: 0.5
  });

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positiveNumber(value, fallback) {
    const number = finiteNumber(value, fallback);
    return number > 0 ? number : fallback;
  }

  function nonNegativeNumber(value, fallback) {
    const number = finiteNumber(value, fallback);
    return number >= 0 ? number : fallback;
  }

  /**
   * RMS envelope onset detector shared by live microphone and uploaded video.
   * The warm-up interval learns the initial noise floor but can never emit an
   * onset, which prevents microphone/filter start-up transients becoming hits.
   */
  function createOnsetDetector(options = {}) {
    const initialEnvelope = positiveNumber(options.initialEnvelope, DEFAULTS.initialEnvelope);
    const minimumNoiseFloor = positiveNumber(options.minimumNoiseFloor, DEFAULTS.minimumNoiseFloor);
    const refractorySeconds = nonNegativeNumber(options.refractorySeconds, DEFAULTS.refractorySeconds);
    const warmupSeconds = nonNegativeNumber(options.warmupSeconds, 0);

    let noiseFloor;
    let fastEnvelope;
    let refractoryUntil;
    let readyAt;

    function snapshot() {
      return { noiseFloor, fastEnvelope, refractoryUntil, readyAt };
    }

    function reset(startTime = 0) {
      const start = finiteNumber(startTime, 0);
      noiseFloor = initialEnvelope;
      fastEnvelope = initialEnvelope;
      refractoryUntil = start;
      readyAt = start + warmupSeconds;
      return snapshot();
    }

    function suppressUntil(time) {
      refractoryUntil = Math.max(refractoryUntil, finiteNumber(time, refractoryUntil));
    }

    function process(sample = {}) {
      const rms = nonNegativeNumber(sample.rms, 0);
      const now = finiteNumber(sample.now, 0);
      const sensitivity = positiveNumber(sample.sensitivity, 6);
      const attackThreshold = positiveNumber(sample.attackThreshold, 3);
      const flatnessThreshold = nonNegativeNumber(sample.flatnessThreshold, 0);
      const enabled = sample.enabled !== false;
      const previousFast = fastEnvelope;

      fastEnvelope = Math.max(minimumNoiseFloor, fastEnvelope * 0.6 + rms * 0.4);

      if (now < readyAt) {
        // Learn quickly during start-up so a large first buffer cannot seed an
        // onset or leave the detector stuck with the fixed initial floor.
        noiseFloor = Math.max(minimumNoiseFloor, noiseFloor * 0.8 + rms * 0.2);
        return {
          detected: false,
          warmingUp: true,
          loud: false,
          attackRatio: 0,
          flatness: null,
          ...snapshot()
        };
      }

      const loud = rms > noiseFloor * sensitivity;
      const attackRatio = rms / (previousFast + 1e-9);
      let flatness = null;
      let detected = false;

      if (enabled && loud && now > refractoryUntil) {
        flatness = typeof sample.flatness === "function" ? sample.flatness() : sample.flatness;
        // Missing spectral evidence must fail closed; otherwise an incomplete
        // EOF frame can be treated as a perfectly flat impact sound.
        flatness = nonNegativeNumber(flatness, 0);
        if (attackRatio >= attackThreshold && flatness >= flatnessThreshold) {
          detected = true;
          refractoryUntil = now + refractorySeconds;
        }
      } else if (now > refractoryUntil && !loud) {
        noiseFloor = Math.max(minimumNoiseFloor, noiseFloor * 0.995 + rms * 0.005);
      }

      return {
        detected,
        warmingUp: false,
        loud,
        attackRatio,
        flatness,
        ...snapshot()
      };
    }

    reset(options.startTime);
    return { process, reset, snapshot, suppressUntil };
  }

  return { DEFAULTS, createOnsetDetector };
});
