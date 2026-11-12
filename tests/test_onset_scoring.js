"use strict";

// 打数の採点（要件 R7・R1）。
// 1) 合成した波形で、検出の部品（ハイパス・開始位置の合成）が期待どおり動くことを確かめる。
// 2) 実際の60秒の音（人の声が入るためコミットしない。local/fixtures/ に置く）があれば、
//    目で確かめた正解56打に対して、拾えた数と余分の数を採点する。無ければその部分だけ飛ばす。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const detection = require("../detection-engine.js");

const SR = 48000;
const VIDEO_OPTIONS = { sensitivity: 6, attackThreshold: 3, flatnessThreshold: 0.17 }; // 感度6・声カット5（既定）

// --- 部品：合成 ---
assert.deepStrictEqual(detection.mergeOnsets([[1.0, 2.0], [1.005, 2.11], [1.119]], 0.12), [1.0, 2.0]);
assert.deepStrictEqual(detection.mergeOnsets([[1.0], [1.12]], 0.12), [1.0, 1.12]);
assert.deepStrictEqual(detection.mergeOnsets([[], [3, 1]], 0.12), [1, 3]);
assert.deepStrictEqual(detection.mergeOnsets([], 0.12), []);

// --- 部品：ハイパス（線形 Q=0.7。縁を持ち上げない） ---
function gainAt(hz) {
  const n = SR; // 1秒
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * hz * i / SR);
  const y = detection.highpassBiquad(x, SR);
  let sx = 0, sy = 0;
  for (let i = n / 2; i < n; i++) { sx += x[i] * x[i]; sy += y[i] * y[i]; }
  return Math.sqrt(sy / sx);
}
assert.ok(Math.abs(gainAt(2500) - 0.7) < 0.02, `2.5kHz の通過量は約0.7（実測 ${gainAt(2500).toFixed(3)}）`);
assert.ok(gainAt(8000) > 0.97 && gainAt(8000) < 1.03, "高い音はそのまま通す");
assert.ok(gainAt(250) < 0.02, "低い音は切る");
for (const hz of [1500, 2000, 2500, 3000, 4000, 6000]) assert.ok(gainAt(hz) <= 1.005, `${hz}Hz で持ち上がらない`);

// --- 合成した波形：開始位置によらず全打を拾う ---
function makeRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
}
function synthetic(hitTimes, seconds) {
  const rand = makeRandom(20261112);
  const x = new Float32Array(Math.floor(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = rand() * 0.002;          // 波や風に当たる弱い雑音
  for (const t of hitTimes) {
    const start = Math.floor(t * SR);
    for (let i = 0; i < 2400 && start + i < x.length; i++) x[start + i] += rand() * 0.6 * Math.exp(-i / 300); // 短く鋭い打音
  }
  return x;
}
const syntheticTruth = [];
for (let t = 1.0, k = 0; t < 29; t += 0.45 + (k % 5) * 0.047, k++) syntheticTruth.push(+(t + (k % 7) * 0.0013).toFixed(4));
const syntheticWave = detection.highpassBiquad(synthetic(syntheticTruth, 30), SR);

function score(onsets, truth, tolerance) {
  const hit = truth.filter(t => onsets.some(o => Math.abs(o - t) < tolerance)).length;
  const extra = onsets.filter(o => !truth.some(t => Math.abs(o - t) < tolerance));
  return { detected: onsets.length, hit, extra };
}
for (let shift = 0; shift < 512; shift += 16) {
  const onsets = detection.detectOnsets(syntheticWave.subarray(shift), SR, VIDEO_OPTIONS).map(t => t + shift / SR);
  const result = score(onsets, syntheticTruth, 0.03);
  assert.strictEqual(result.hit, syntheticTruth.length, `合成波形・開始位置${shift}: ${result.hit}/${syntheticTruth.length}`);
  assert.strictEqual(result.extra.length, 0, `合成波形・開始位置${shift}: 余分 ${result.extra.length}`);
}
console.log(`Onset scoring (synthetic): ${syntheticTruth.length}打 × 開始位置32通りをすべて検出、余分0`);

// --- 実際の60秒：正解56打の採点 ---
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "onsets-trim60.json"), "utf8"));
const audioPath = path.join(__dirname, "..", "local", "fixtures", fixture.audioFile);
if (!fs.existsSync(audioPath)) {
  console.log(`Onset scoring (real 60s): 飛ばしました。音声 ${path.relative(path.join(__dirname, ".."), audioPath)} がありません`);
} else {
  const raw = fs.readFileSync(audioPath);
  const mono = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const wave = detection.highpassBiquad(mono, fixture.sampleRate);
  const rows = [];
  for (let shift = 0; shift < 512; shift += 16) {
    const onsets = detection.detectOnsets(wave.subarray(shift), fixture.sampleRate, VIDEO_OPTIONS).map(t => t + shift / fixture.sampleRate);
    rows.push({ shift, ...score(onsets, fixture.truth, fixture.toleranceSeconds) });
  }
  const known = fixture.knownExtra.map(k => k.t);
  const unexplained = rows.map(r => r.extra.filter(e => !known.some(k => Math.abs(k - e) < fixture.toleranceSeconds)).length);
  const minHit = Math.min(...rows.map(r => r.hit)), maxExtra = Math.max(...rows.map(r => r.extra.length)), maxUnexplained = Math.max(...unexplained);
  const counts = [...new Set(rows.map(r => r.detected))].sort((a, b) => a - b);
  // 比較用：開始位置1通りだけ（合成なし）で走らせたとき
  const single = [];
  for (let shift = 0; shift < 512; shift += 16) {
    const onsets = detection.detectOnsets(wave.subarray(shift), fixture.sampleRate, { ...VIDEO_OPTIONS, phases: [0] }).map(t => t + shift / fixture.sampleRate);
    single.push(score(onsets, fixture.truth, fixture.toleranceSeconds).hit);
  }
  console.log(`Onset scoring (real 60s): 正解${fixture.truth.length}打のうち 最少${minHit}・最多${Math.max(...rows.map(r => r.hit))}、余分 ${Math.min(...rows.map(r => r.extra.length))}〜${maxExtra}（ラリー外の打球音以外は ${maxUnexplained}）、検出数 ${counts.join("/")}（開始位置32通り）。合成なしだと正解のうち ${Math.min(...single)}〜${Math.max(...single)}`);
  assert.ok(minHit >= fixture.pass.minHit, `正解のうち拾えた数が ${fixture.pass.minHit} 未満の開始位置がある（最少 ${minHit}）`);
  assert.ok(maxExtra <= fixture.pass.maxExtra, `余分が ${fixture.pass.maxExtra} を超える開始位置がある（最大 ${maxExtra}）`);
  assert.ok(maxUnexplained <= fixture.pass.maxUnexplainedExtra, `ラリー外の打球音では説明できない余分がある（最大 ${maxUnexplained}）`);
}
