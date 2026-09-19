"use strict";
// 映像が主の打点（FrescoMotion.videoHits）: 返球の向きが入れ替わる境目を打点にする。
const assert = require("assert");
const M = require("../motion-core.js");
const MEASUREMENT = require("../measurement-spec.js");

const W = 1920, regions = [{ x: 250, y: 460, w: 230, h: 260 }, { x: 1180, y: 350, w: 560, h: 560 }];
// 30fpsで、x が一定速度で進む返球を作る（from→to を seconds 秒で）。端は選手の体で隠れる想定で少し欠かす。
function flight(t0, seconds, from, to, skipHead = 2, skipTail = 2) {
  const n = Math.round(seconds * 30), points = [];
  for (let i = skipHead; i <= n - skipTail; i++) points.push({ t: t0 + i / 30, x: from + (to - from) * i / n, y: 500 - 80 * Math.sin(Math.PI * i / n) });
  return { id: t0, points };
}
// 左(a)が 10.00 秒に打つ → 右(b)が 10.60 秒に打ち返す → 左(a)が 11.10 秒に打つ → 右(b)が 11.70 秒
const tracks = [flight(10.0, 0.6, 400, 1400), flight(10.6, 0.5, 1400, 400), flight(11.1, 0.6, 400, 1400)];
const hits = M.videoHits(tracks, regions, W);
assert.strictEqual(hits.length, 2, "two reversals between three returns");
assert.ok(Math.abs(hits[0].t - 10.6) < 0.02, `first hit is timed by extrapolating both returns, got ${hits[0].t}`);
assert.ok(Math.abs(hits[1].t - 11.1) < 0.02, `second hit time, got ${hits[1].t}`);
assert.deepStrictEqual(hits.map(h => h.player), ["b", "a"], "the hitter is the player whose area is closest to the reversal");
assert.ok(hits.every(h => h.origin === "video" && h.status === "auto" && h.provenance === "video-reversal-v1"));

// 途中で切れた同じ返球は1本につないでから数える（切れ目を打点にしない）
const split = [flight(20.0, 0.6, 400, 1400, 2, 10), { id: "tail", points: flight(20.0, 0.6, 400, 1400).points.slice(-7) }, flight(20.6, 0.5, 1400, 400)];
assert.strictEqual(M.videoHits(split, regions, W).length, 1, "a return split into two tracks still yields one hit");

// 短い追跡・横にほとんど進まない追跡（人の動きなど）は返球として扱わない
const noise = [{ id: "n1", points: flight(30, 0.6, 400, 1400).points.slice(0, 4) }, flight(30.7, 0.5, 900, 1000)];
assert.strictEqual(M.videoHits(noise, regions, W).length, 0);
// 選手の範囲が無いと打った側は決められないので確認待ちにする
assert.ok(M.videoHits(tracks, [], W).every(h => h.player === null && h.status === "pending"));
assert.throws(() => M.videoHits(tracks, regions, 0));

// 映像の打点があるときは、音の打点が渡されても映像の打点を数える
const counted = M.countedEvents([{ t: 1 }, { t: 2 }, { t: 3 }], hits, 2.5);
assert.strictEqual(counted.length, 2);
assert.ok(counted.every(e => e.countSource === "video"));
// 音だけの解析（従来）は変わらない
assert.strictEqual(M.countedEvents([{ t: 1 }, { t: 2 }], [{ id: "audio-0", t: 1, status: "pending", origin: "audio", player: null }], 2.5).length, 2);

// 速度: 映像で決めた打点どうしの間隔には音の到達遅れが入らないため、マイク位置が「片側」でも補正せずに計算する
const measured = M.estimatedSpeeds(counted, 7, { values: { micPos: "near", firstOnsetSide: "near", maxTrust: "110" } }, MEASUREMENT, [{ t: 1 }, { t: 2 }]);
const second = measured[1];
assert.strictEqual(second.launchPlayer, "b");
assert.ok(second.initialKmh > 50 && second.initialKmh < 58, `7m in 0.5s is about 54km/h initial speed, got ${second.initialKmh}`);

console.log("Video-based hit detection checks passed");
