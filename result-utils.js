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

  /**
   * ラリー単位の交互割当。フレスコボールはラリー内で必ず交互に打つため、
   * 1打ごとの左右証拠（evidence>0=右/"b"、<0=左/"a"、絶対値=信頼度）を
   * ラリーごとに重み付き多数決して「開始側」だけを決め、あとは交互に割り当てる。
   * 個々の誤判定（近い選手の動きが大きい等）は多数決で吸収される。
   * items: [{t, evidence}]（時刻昇順） → ["a"|"b", ...]
   */
  function alternateByRallyVote(items, gapSeconds) {
    const gap = Number(gapSeconds) > 0 ? Number(gapSeconds) : 2.5;
    const players = new Array((items || []).length);
    let rallyStart = 0;
    const flushRally = (end) => {
      // 開始側の仮説2つをスコアリング: 打index偶奇で期待側が決まる
      let scoreStartA = 0; // 開始"a"なら偶数番目=a(期待evidence負)・奇数番目=b(期待evidence正)
      for (let i = rallyStart; i < end; i++) {
        const evidence = Number(items[i].evidence) || 0;
        const expectB = (i - rallyStart) % 2 === 1;
        scoreStartA += expectB ? evidence : -evidence;
      }
      const startPlayer = scoreStartA >= 0 ? "a" : "b";
      for (let i = rallyStart; i < end; i++) {
        const even = (i - rallyStart) % 2 === 0;
        players[i] = even ? startPlayer : (startPlayer === "a" ? "b" : "a");
      }
    };
    for (let i = 1; i <= (items || []).length; i++) {
      if (i === items.length || items[i].t - items[i - 1].t > gap) { flushRally(i); rallyStart = i; }
    }
    return players;
  }

  /**
   * 「割れた間隔」の偽打音を除去する。本物の打音2つの間に反響・隣組の音などが
   * 1つ挟まると、正常間隔が「短い間隔×2」に割れて速度が約2倍に見える。
   * 署名: 連続する2間隔がどちらもラリー中央値の70%未満で、合計が中央値±25%に収まる。
   * 本物のアタック（速い1打）は「短い間隔×1」なので誤除去しない。
   * times: 時刻昇順の配列 → { times: 除去後, removed: 除去数 }
   */
  function removeSplitOnsets(times, gapSeconds) {
    const gap = Number(gapSeconds) > 0 ? Number(gapSeconds) : 2.5;
    const input = (times || []).slice();
    const out = [];
    let removed = 0;
    let rallyStart = 0;
    const flush = (end) => {
      const rally = input.slice(rallyStart, end);
      if (rally.length < 4) { out.push(...rally); return; }
      const intervals = [];
      for (let i = 1; i < rally.length; i++) intervals.push(rally[i] - rally[i - 1]);
      const sorted = intervals.slice().sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      const drop = new Set();
      for (let i = 1; i < rally.length - 1; i++) {
        if (drop.has(i - 1)) continue; // 直前を消した場合は間隔が変わるためスキップ
        const before = rally[i] - rally[i - 1], after = rally[i + 1] - rally[i];
        if (before < 0.7 * median && after < 0.7 * median && Math.abs(before + after - median) < 0.25 * median) {
          drop.add(i); removed++;
        }
      }
      for (let i = 0; i < rally.length; i++) if (!drop.has(i)) out.push(rally[i]);
    };
    for (let i = 1; i <= input.length; i++) {
      if (i === input.length || input[i] - input[i - 1] > gap) { flush(i); rallyStart = i; }
    }
    return { times: out, removed };
  }

  /** liveログの保持期限（days日前のUTC ISO）。 */
  function retentionCutoffISO(nowMs, days) {
    return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
  }

  return { JFBA_BANDS, bandIndex, bandHistogram, comboPeak, speedsByPlayer, jfbaSummaryRows, resultCardStats, alternateByRallyVote, removeSplitOnsets, retentionCutoffISO };
});
