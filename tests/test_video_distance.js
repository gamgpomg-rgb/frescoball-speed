"use strict";
// Execute the application's real functions with a minimal DOM, checking distance
// changes, record round-trips, and separation from live measurement settings.
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const html = fs.readFileSync(require("path").join(__dirname, "../index.html"), "utf8");
const measurement = require("../measurement-spec.js");
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { value: "", style: {}, disabled: false });
  return elements.get(id);
};
element("distance").value = "7";
const context = vm.createContext({
  console, MEASUREMENT: measurement, MEASUREMENT_SPEC: measurement.spec,
  QUALITY_GATE: measurement.spec.qualityGate,
  RESULT: require("../result-utils.js"), $: element,
  currentVideoSettings: { values: { distance: "7", micPos: "center", firstOnsetSide: "near", rallyGap: "2.5", maxTrust: "200", calib: "" } },
  curStats: null, curFlip: false, currentMotion: null, RECORD_SCHEMA_VERSION: 2,
  HBINS: [{label: "all"}], binIndex: () => 0, playerName: p => p,
  renderShotSummary:()=>{},resetUploadAnalysis: () => {}, renderPlayers: () => {}, renderDash: () => {}, setVideoExportAvailability: () => {}
});
for (const name of ["validatedVideoDistance", "measureVideoInterval", "measureObservedInterval", "videoRallyGap", "buildStats", "rebuildTimeline", "aggregate", "defaultPlayerLabels", "normalizeRecord", "estimatedDrops", "makeRecord", "openRecord"]) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const end = html.indexOf("\n}", start) + 2;
  vm.runInContext(html.slice(start, end), context);
}
for (const invalid of ["", " ", "0", "-1", "NaN", "Infinity", "abc"]) {
  assert.throws(() => context.validatedVideoDistance(invalid));
}
assert.equal(context.validatedVideoDistance("8.5"), 8.5);
for (const value of ["6.9","7.05"]) assert.throws(()=>context.validatedVideoDistance(value));
for (const value of ["7","7.1","7.2","7.3","10.1"]) assert.equal(context.validatedVideoDistance(value), Number(value));
context.curStats = context.buildStats([0, 0.6, 1.2, 1.8]);
const at7 = context.curStats.hits[1].speed;
context.currentVideoSettings.values.distance = "10";
context.curStats = context.rebuildTimeline(context.curStats.hits);
assert(context.curStats.hits[1].speed > at7);
assert.equal(element("distance").value, "7", "video changes must not alter live distance");
const record = context.makeRecord({ id: 123, fileName: "test.mov" });
assert.equal(record.settings.values.distance, "10");
element("distance").value = "8";
context.openRecord(JSON.parse(JSON.stringify(record)));
assert.equal(element("upDistance").value, "10");
assert.equal(element("distance").value, "8", "opening history must not replace live distance");
context.currentVideoSettings.values.distance = "7";
const again7 = context.rebuildTimeline(context.curStats.hits);
assert(Math.abs(again7.hits[1].speed - at7) < 1e-9);
assert.equal(again7.hits.length, record.hits.length);
assert.deepEqual(Array.from(again7.hits, h => h.player), Array.from(record.hits, h => h.player));
context.openRecord({ ...record, settings: undefined });
assert.equal(element("upDistance").value, "", "unknown historical distance must not be labelled 7m");
console.log("Video distance calculation and record round-trip tests passed");

// A speed excluded for this video must remain excluded in history and exports,
// while preserving its value for the user's undo action.
context.FrescoVideoQuality = require('../video-quality.js');
{
  const start = html.indexOf('function applySpeedReview(');
  vm.runInContext(html.slice(start,html.indexOf('\n}',start)+2),context);
}
context.currentVideoSettings = {values:{distance:'7'}};
context.curStats = {hits:[60,61,59,60,107,61,60,59,61].map((speed,i)=>({t:i*.4,idx:i,player:i%2?'b':'a',speed,rNow:i+1})),total:9,rMax:9,rallies:1};
context.applySpeedReview();
const filtered = context.makeRecord({fileName:'test.mov'});
assert.equal(filtered.hits[4].speed,null);
assert.equal(filtered.hits[4].originalSpeed,107);
assert(filtered.maxSpeed<107);
context.openRecord(JSON.parse(JSON.stringify(filtered)));
context.curStats.speedReview.autoOutliers=false;
context.applySpeedReview();
assert.equal(context.curStats.hits[4].speed,107);
console.log('Excluded speed persistence, export statistics and undo passed');

assert.equal(context.estimatedDrops({hits:[{t:1},{t:2},{t:6},{t:7}]},8,2.5).value,1);
assert.equal(context.estimatedDrops({hits:[{t:1},{t:2},{t:6},{t:7}]},10,2.5).value,2);
assert.equal(context.estimatedDrops({hits:[]},20,2.5).value,0);
assert.equal(context.estimatedDrops({hits:[{t:1}],dropOverride:0},20,2.5).value,0);
context.curStats.dropOverride=4;
const dropRecord=context.makeRecord({duration:20});
assert.equal(dropRecord.drops,4);assert.equal(dropRecord.dropOverride,4);
context.openRecord(dropRecord);
assert.equal(context.curStats.dropOverride,4,'manual drop correction survives history');
console.log('Estimated end-of-rally drops and manual correction history passed');
const separate=context.estimatedDrops({hits:[{t:1},{t:2},{t:6},{t:7}]},10,2.5);
assert.equal(separate.rallyBreaks,1);assert.equal(separate.trailingPause,true);assert.equal(separate.confirmedDrops,null);
assert.equal(context.estimatedDrops({hits:[{t:1}],dropOverride:0},20,2.5).confirmedDrops,0);
