/* リザルト集計ユーティリティ（純関数のみ・DOM禁止）。
 * JFBA公式スコアシートの5km/h帯（50-54…95-99・100+）に合わせた集計と、
 * リザルトカード用の指標（Combo等）を提供する。node の回帰テスト対象。 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrescoResult = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** 公式スコアシートと同じ排他的な5km/h帯。 */
  const JFBA_BANDS = (() => {
    const bands = [];
    for (let min = 50; min < 100; min += 5) bands.push({ min, max: min + 4, label: `${min}-${min + 4}` });
    bands.push({ min: 100, max: Infinity, label: "100+" });
    return bands;
  })();

  function bandIndex(speedKmh) {
    if (!(speedKmh >= 50)) return -1;
    if (speedKmh >= 100) return JFBA_BANDS.length - 1;
    return Math.floor((speedKmh - 50) / 5);
  }

  /** 速度配列 → 公式帯ヒストグラム＋基本統計。 */
  function bandHistogram(speeds) {
    const counts = JFBA_BANDS.map(() => 0);
    let over50 = 0, under50 = 0, max = null, sum = 0, n = 0;
    for (const value of speeds || []) {
      const speed = Number(value);
      if (!Number.isFinite(speed)) continue;
      n++; sum += speed;
      if (max === null || speed > max) max = speed;
      const index = bandIndex(speed);
      if (index >= 0) { counts[index]++; over50++; } else under50++;
    }
    return {
      bands: JFBA_BANDS.map((band, index) => ({ label: band.label, count: counts[index] })),
      over50, under50, max, avg: n ? sum / n : null, total: n
    };
  }

  /** 50km/h以上が連続した最長本数（ペア単位）。速度不明(null)は連続を切る。 */
  function comboPeak(speeds, thresholdKmh = 50) {
    let best = 0, run = 0;
    for (const value of speeds || []) {
      const speed = Number(value);
      if (Number.isFinite(speed) && speed >= thresholdKmh) { run++; if (run > best) best = run; }
      else run = 0;
    }
    return best;
  }

  /** hits配列から「打ち出した側」へ速度を帰属して選手別の速度配列を作る
   *（app本体の aggregate と同じ規約: 速度は直前の打者に帰属）。 */
  function speedsByPlayer(hits, flip) {
    const bySide = { a: [], b: [], all: [] };
    let prevPlayer = null;
    for (const hit of hits || []) {
      const player = hit.player === "b" ? "b" : "a";
      if (hit.speed != null && Number.isFinite(Number(hit.speed))) {
        const launcher0 = prevPlayer != null ? prevPlayer : (player === "a" ? "b" : "a");
        const launcher = flip ? (launcher0 === "a" ? "b" : "a") : launcher0;
        bySide[launcher].push(Number(hit.speed));
        bySide.all.push(Number(hit.speed));
      }
      prevPlayer = player;
    }
    return bySide;
  }

  /** 公式帯サマリーCSVの行データ（ヘッダ含む2次元配列）。 */
  function jfbaSummaryRows(record, options) {
    const opts = options || {};
    const labels = record.playerLabels || { a: "選手A", b: "選手B" };
    const speeds = speedsByPlayer(record.hits, Boolean(record.flip));
    const scopes = [
      ["all", "全体", speeds.all],
      ["a", labels.a || "選手A", speeds.a],
      ["b", labels.b || "選手B", speeds.b]
    ];
    const header = [
      "scope", "player", ...JFBA_BANDS.map(band => `band_${band.label}`),
      "over50_count", "under50_count", "max_kmh", "avg_kmh", "combo_peak",
      "total_measured", "quality_rejected", "measurement_spec", "note"
    ];
    const note = opts.note || "参考計測（非公式）。帯はJFBA公式スコアシートと同じ5km/h刻み。";
    const rows = [header];
    for (const [scope, name, values] of scopes) {
      const hist = bandHistogram(values);
      rows.push([
        scope, name, ...hist.bands.map(band => band.count),
        hist.over50, hist.under50,
        hist.max == null ? "" : hist.max.toFixed(1),
        hist.avg == null ? "" : hist.avg.toFixed(1),
        comboPeak(values),
        hist.total,
        scope === "all" ? (Number(record.qualityRejected) || 0) : "",
        record.measurementSpecVersion || "", note
      ]);
    }
    return rows;
  }

  /** リザルトカード用の集計（1レコード分）。 */
  function resultCardStats(record) {
    const labels = record.playerLabels || { a: "選手A", b: "選手B" };
    const speeds = speedsByPlayer(record.hits, Boolean(record.flip));
    const side = key => {
      const hist = bandHistogram(speeds[key]);
      return {
        name: labels[key] || (key === "a" ? "選手A" : "選手B"),
        max: hist.max, avg: hist.avg, over50: hist.over50,
        comboPeak: comboPeak(speeds[key])
      };
    };
    const overall = bandHistogram(speeds.all);
    return {
      a: side("a"), b: side("b"),
      totalHits: Number(record.total) || (record.hits || []).length,
      over50: overall.over50, maxSpeed: overall.max, avgSpeed: overall.avg,
      comboPeak: comboPeak(speeds.all),
      maxRally: Number(record.rMax) || 0,
      drops: Number(record.drops) || 0,
      durationSec: Number(record.duration) || 0,
      bands: overall.bands
    };
  }

  /** liveログの保持期限（days日前のUTC ISO）。 */
  function retentionCutoffISO(nowMs, days) {
    return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
  }

  return { JFBA_BANDS, bandIndex, bandHistogram, comboPeak, speedsByPlayer, jfbaSummaryRows, resultCardStats, retentionCutoffISO };
});
