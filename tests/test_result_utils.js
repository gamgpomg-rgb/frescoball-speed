/* result-utils.js の回帰テスト（band集計・combo・公式帯CSV）。 */
"use strict";
const assert = require("node:assert");
const path = require("node:path");
const R = require(path.join(__dirname, "..", "result-utils.js"));

// 帯の境界: 49.9はunder50、50.0は50-54、54.9も50-54、55.0は55-59、100.0と127は100+
{
  const hist = R.bandHistogram([49.9, 50.0, 54.9, 55.0, 100.0, 127]);
  const byLabel = Object.fromEntries(hist.bands.map(b => [b.label, b.count]));
  assert.equal(byLabel["50-54"], 2);
  assert.equal(byLabel["55-59"], 1);
  assert.equal(byLabel["100+"], 2);
  assert.equal(hist.under50, 1);
  assert.equal(hist.over50, 5);
  assert.equal(hist.max, 127);
}

// combo: 50以上の連続。nullや50未満で途切れる
assert.equal(R.comboPeak([55, 60, 49, 52, 53, 54, null, 70]), 3);
assert.equal(R.comboPeak([]), 0);

// 速度帰属: 速度は「直前の打者」へ帰属（先頭は相手側扱い）。flipで反転
{
  const hits = [
    { player: "a", speed: null },
    { player: "b", speed: 60 },  // 打ち出しはa
    { player: "a", speed: 70 }   // 打ち出しはb
  ];
  const s = R.speedsByPlayer(hits, false);
  assert.deepEqual(s.a, [60]);
  assert.deepEqual(s.b, [70]);
  const f = R.speedsByPlayer(hits, true);
  assert.deepEqual(f.a, [70]);
  assert.deepEqual(f.b, [60]);
}

// 公式帯CSV: 3行（全体/選手A/選手B）＋ヘッダ、帯列は11本
{
  const record = {
    playerLabels: { a: "岩本", b: "相手" },
    hits: [
      { player: "a", speed: null },
      { player: "b", speed: 52 },
      { player: "a", speed: 66 },
      { player: "b", speed: 101 }
    ],
    flip: false, total: 4, qualityRejected: 2, measurementSpecVersion: "2026-07-10"
  };
  const rows = R.jfbaSummaryRows(record);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].filter(h => String(h).startsWith("band_")).length, R.JFBA_BANDS.length);
  const all = rows[1];
  assert.equal(all[0], "all");
  assert.equal(all[rows[0].indexOf("over50_count")], 3);
  assert.equal(all[rows[0].indexOf("quality_rejected")], 2);
}

// リザルトカード集計
{
  const stats = R.resultCardStats({
    playerLabels: { a: "A", b: "B" },
    hits: [
      { player: "a", speed: null },
      { player: "b", speed: 52 },
      { player: "a", speed: 66 }
    ],
    flip: false, total: 3, rMax: 3, drops: 1, duration: 300
  });
  assert.equal(stats.totalHits, 3);
  assert.equal(stats.over50, 2);
  assert.equal(stats.maxSpeed, 66);
  assert.equal(stats.drops, 1);
}

// 保持期限
assert.equal(R.retentionCutoffISO(Date.UTC(2026, 7, 31), 30), "2026-08-01T00:00:00.000Z");

console.log("Result utils regression tests passed");
