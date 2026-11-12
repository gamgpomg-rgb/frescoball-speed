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
    videoWarmupSeconds: 0.5,
    // 動画解析の打音検出。512サンプルの区切りを4通りの開始位置で走らせて合成する。
    // 1通りだけだと、打音が区切りのどこに落ちるかで拾えたり拾えなかったりする。
    videoHop: 512,
    videoPhases: Object.freeze([0, 128, 256, 384]),
    highpassHz: 2500,
    // 線形の Q。Web Audio の highpass は Q をデシベルで受け取るため、
    // BiquadFilterNode に 0.7 を渡すと線形 1.08 相当になり帯域の縁が持ち上がる。
    highpassQ: 0.7
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

  /** 2次ハイパス（RBJ Audio EQ Cookbook）。q は線形値。端末やブラウザの実装差を受けない。 */
  function highpassBiquad(input, sampleRate, cutoffHz = DEFAULTS.highpassHz, q = DEFAULTS.highpassQ) {
    const sr = positiveNumber(sampleRate, 48000);
    const w0 = 2 * Math.PI * positiveNumber(cutoffHz, DEFAULTS.highpassHz) / sr;
    const alpha = Math.sin(w0) / (2 * positiveNumber(q, DEFAULTS.highpassQ));
    const cosW0 = Math.cos(w0);
    const a0 = 1 + alpha;
    const b0 = (1 + cosW0) / 2 / a0, b1 = -(1 + cosW0) / a0, b2 = b0;
    const a1 = -2 * cosW0 / a0, a2 = (1 - alpha) / a0;
    const output = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      output[i] = y;
    }
    return output;
  }

  // 反復 radix-2 FFT（in-place・複素）
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cwr = 1, cwi = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = i + k + half;
          const vr = re[b] * cwr - im[b] * cwi, vi = re[b] * cwi + im[b] * cwr;
          re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
          const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr;
        }
      }
    }
  }

  /** 2500–12000Hz 帯のスペクトル平坦度（ライブの spectralFlatness と同じ指標）。 */
  function flatnessAt(buf, start, sr) {
    const N = 1024;
    if (start + N > buf.length) return 0;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); re[i] = buf[start + i] * w; }
    fft(re, im);
    const nyq = sr / 2, lo = Math.floor(2500 / nyq * (N / 2)), hi = Math.floor(12000 / nyq * (N / 2));
    let logSum = 0, linSum = 0, cnt = 0;
    for (let i = lo; i < hi && i < N / 2; i++) { const p = re[i] * re[i] + im[i] * im[i] + 1e-12; logSum += Math.log(p); linSum += p; cnt++; }
    if (!cnt) return 0;
    return Math.exp(logSum / cnt) / (linSum / cnt);
  }

  /**
   * 1つの開始位置（phase）で、ハイパス済みの波形を端から端まで走査する。
   * step(maxFrames) を呼ぶたびに最大 maxFrames 区切りだけ進み、終わったら true を返す。
   * 画面を止めずに進められるよう、呼び出し側が合間に待ちを入れる。
   */
  function createOnsetScanner(buf, sampleRate, options = {}) {
    const sr = positiveNumber(sampleRate, 48000);
    const hop = Math.max(1, Math.floor(positiveNumber(options.hop, DEFAULTS.videoHop)));
    const phase = Math.max(0, Math.floor(nonNegativeNumber(options.phase, 0)));
    const sensitivity = positiveNumber(options.sensitivity, 6);
    const attackThreshold = positiveNumber(options.attackThreshold, 3);
    const flatnessThreshold = nonNegativeNumber(options.flatnessThreshold, 0);
    const detector = createOnsetDetector({
      refractorySeconds: nonNegativeNumber(options.refractorySeconds, DEFAULTS.refractorySeconds),
      warmupSeconds: nonNegativeNumber(options.warmupSeconds, DEFAULTS.videoWarmupSeconds),
      startTime: 0
    });
    const onsets = [];
    const n = buf.length;
    let position = phase;

    function step(maxFrames = Infinity) {
      let frames = 0;
      while (position + hop <= n && frames < maxFrames) {
        const p = position;
        let sum = 0;
        for (let i = 0; i < hop; i++) { const s = buf[p + i]; sum += s * s; }
        const now = p / sr;
        const result = detector.process({
          rms: Math.sqrt(sum / hop),
          now,
          sensitivity,
          attackThreshold,
          flatnessThreshold,
          flatness: () => flatnessAt(buf, p, sr)
        });
        if (result.detected) onsets.push(now);
        position += hop;
        frames++;
      }
      return position + hop > n;
    }

    function progress() {
      return n > 0 ? Math.min(1, position / n) : 1;
    }

    return { step, progress, onsets };
  }

  /** 開始位置ごとの検出結果を1本にまとめる。minGapSeconds 以内に重なる検出は最初の1件だけ残す。 */
  function mergeOnsets(lists, minGapSeconds = DEFAULTS.refractorySeconds) {
    const gap = nonNegativeNumber(minGapSeconds, DEFAULTS.refractorySeconds);
    const all = [];
    for (const list of lists || []) for (const t of list || []) if (Number.isFinite(t)) all.push(t);
    all.sort((a, b) => a - b);
    const merged = [];
    for (const t of all) if (!merged.length || t - merged[merged.length - 1] >= gap) merged.push(t);
    return merged;
  }

  /** 走査と合成を一度に行う同期版（テストと、待ちを入れる必要がない場面用）。 */
  function detectOnsets(buf, sampleRate, options = {}) {
    const phases = Array.isArray(options.phases) && options.phases.length ? options.phases : DEFAULTS.videoPhases;
    const lists = phases.map(phase => {
      const scanner = createOnsetScanner(buf, sampleRate, { ...options, phase });
      scanner.step();
      return scanner.onsets;
    });
    return mergeOnsets(lists, nonNegativeNumber(options.refractorySeconds, DEFAULTS.refractorySeconds));
  }

  return { DEFAULTS, createOnsetDetector, highpassBiquad, flatnessAt, createOnsetScanner, mergeOnsets, detectOnsets };
});
