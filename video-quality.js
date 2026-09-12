/* Reversible review of estimated speeds. Does not change the physical model.
 * review(hits, { maxSpeedKmh: null | positive number, autoOutliers: true,
 *                overrides: { [String(hit.t)]: 'auto' | 'keep' | 'drop' } })
 * Returns { hits, excluded: number, candidates: [{t, speed, median, threshold}] }.
 * originalSpeed preserves the measurement before this review; pre-existing null
 * measurements remain null. A manual keep may override both review filters.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FrescoVideoQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const median = values => {
    const s = values.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  function review(hits, options = {}) {
    if (!Array.isArray(hits) || hits.some(h => !h || !finite(h.t)))
      throw new Error('打点時刻が不正です');
    if (options.maxSpeedKmh != null && !['number', 'string'].includes(typeof options.maxSpeedKmh))
      throw new Error('速度上限は正の数値で指定してください');
    const limit = options.maxSpeedKmh == null ? null : Number(options.maxSpeedKmh);
    if (limit != null && (!finite(limit) || limit <= 0)) throw new Error('速度上限は正の数値で指定してください');
    const autoOutliers = options.autoOutliers !== false;
    const overrides = options.overrides || {};
    const originals = hits.map(h => Object.prototype.hasOwnProperty.call(h, 'originalSpeed') ? h.originalSpeed : h.speed);
    const ordered = hits.map((h, index) => ({t: h.t, speed: originals[index], index}))
      .filter(h => finite(h.speed) && h.speed > 0).sort((a, b) => a.t - b.t);
    const flagged = new Map();
    for (let i = 0; i < ordered.length; i++) {
      const hit = ordered[i];
      // Need evidence on both sides, nearby in time. Never infer an outlier at
      // a clip edge, across a long break, or from a handful of observations.
      const before = ordered.slice(Math.max(0, i - 4), i).filter(h => hit.t - h.t <= 3);
      const after = ordered.slice(i + 1, i + 5).filter(h => h.t - hit.t <= 3);
      if (before.length < 2 || after.length < 2 || before.length + after.length < 5) continue;
      if (hit.t - before.at(-1).t > 1.5 || after[0].t - hit.t > 1.5) continue;
      const neighbors = before.concat(after).map(h => h.speed);
      const center = median(neighbors), mad = median(neighbors.map(v => Math.abs(v - center)));
      const threshold = center + Math.max(15, center * .25, 4.5 * 1.4826 * mad);
      if (hit.speed <= threshold) continue;
      // Two adjoining high measurements are not an isolated spike. Preserve
      // bursts and sustained fast rallies for review, even if the median is low.
      const elevated = center + Math.max(10, center * .15, 3 * 1.4826 * mad);
      if (before.at(-1).speed >= elevated || after[0].speed >= elevated) continue;
      flagged.set(hit.index, {t: hit.t, speed: hit.speed, median: center, threshold, code: 'isolated_spike'});
    }
    // Whole-video evidence supplements the local neighborhood. Require enough
    // measurements and a clear gap above the rest of the distribution. Repeated
    // upper-range shots support a fast value even when its immediate rally is slow.
    if (ordered.length >= 20) {
      const values = ordered.map(h => h.speed).sort((a, b) => a - b);
      const center = median(values), mad = median(values.map(v => Math.abs(v - center)));
      const threshold = center + Math.max(20, center * .35, 2 * 1.4826 * mad);
      const bound = (value, inclusive) => {
        let lo = 0, hi = values.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] < value || (inclusive && values[mid] === value)) lo = mid + 1; else hi = mid; }
        return lo;
      };
      for (let i = 0; i < ordered.length; i++) {
        const hit = ordered[i];
        const support = bound(hit.speed * 1.2, true) - bound(hit.speed * .8, false) - 1;
        if (support >= 2) { flagged.delete(hit.index); continue; }
        const adjacent = [ordered[i - 1], ordered[i + 1]].some(h => h && Math.abs(h.t - hit.t) <= 1.5 && h.speed >= hit.speed * .8);
        if (adjacent) continue;
        const upper = hit.speed === values.at(-1) ? values.at(-2) : values.at(-1);
        const upperGap = hit.speed - upper;
        if (hit.speed > threshold && upperGap > Math.max(12, upper * .15)) {
          flagged.set(hit.index, {t: hit.t, speed: hit.speed, median: center, threshold,
            upperGap, support, code: 'global_isolated_spike'});
        }
      }
    }
    let excluded = 0;
    const reviewed = hits.map((hit, index) => {
      const originalSpeed = originals[index] == null ? null : originals[index];
      const usable = finite(originalSpeed) && originalSpeed > 0;
      const override = overrides[String(hit.t)] || 'auto';
      if (!['auto', 'keep', 'drop'].includes(override)) throw new Error('速度レビューの指定が不正です');
      let qualityCode = null, qualityReason = '';
      if (usable) {
        if (override === 'drop') { qualityCode = 'manual'; qualityReason = '手動で速度集計から除外'; }
        else if (override !== 'keep' && limit != null && originalSpeed > limit) {
          qualityCode = 'above_limit'; qualityReason = `設定上限 ${limit} km/h を超過`;
        } else if (override !== 'keep' && autoOutliers && flagged.has(index)) {
          qualityCode = flagged.get(index).code; qualityReason = qualityCode === 'global_isolated_spike' ? '動画全体の速度分布に対して孤立した高速値' : '前後の速度に対して孤立した高速値';
        }
      }
      const qualityExcluded = Boolean(qualityCode);
      if (qualityExcluded) excluded++;
      return {...hit, originalSpeed, speed: usable && !qualityExcluded ? originalSpeed : null,
        qualityExcluded, qualityCode, qualityReason, isOutlierCandidate: flagged.has(index)};
    });
    return {hits: reviewed, excluded, candidates: Array.from(flagged.values())};
  }
  return {review};
});
