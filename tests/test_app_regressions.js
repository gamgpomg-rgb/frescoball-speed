"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const server = fs.readFileSync(path.join(root, "scripts", "serve_https.py"), "utf8");

assert.match(html, /id="resumeBtn"[^>]*hidden/);
assert.match(html, /function showLiveResumeOption\(\)/);
assert.match(html, /renderPlayers\(\);\s*showLiveResumeOption\(\);/);
assert.doesNotMatch(html, /renderPlayers\(\);\s*restoreLiveSession\(\);/);

assert.match(html, /function resetUploadAnalysis\(\)[\s\S]*?\$\("ulH"\)\.textContent = "0";/);
assert.match(html, /\$\("upFile"\)\.addEventListener\("change", async e => \{[\s\S]*?const generation = resetUploadAnalysis\(\);/);
assert.match(html, /generation !== uploadAnalysisGeneration/);
assert.match(html, /assertAnalysisActive\(shouldContinue\)/);
assert.match(html, /cameraGeneration/);
assert.match(html, /beginLiveDetectorWarmup\("カメラ"\)/);
assert.match(html, /if \(startingMeasurement\) return;/);

assert.match(html, /DETECTION\.DEFAULTS\.liveWarmupSeconds/);
assert.match(html, /DETECTION\.DEFAULTS\.videoWarmupSeconds/);
assert.match(sw, /frescoball-speed-shell-v44/);
assert.match(sw, /teacher-model\.js/);
assert.match(html, /teacher-model\.js/);
assert.match(html, /id="teacherBall"/);
assert.match(html, /teacher:loadTeacher/);
assert.match(html, /FrescoTeacher\.pick\(navigator/);
for (const model of ["rfdetr-nano", "yolox-nano"]) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "models", model, "manifest.json"), "utf8"));
  assert(Array.isArray(manifest.parts) && manifest.parts.length >= 1 && manifest.parts.every(p => /^part-\d+\.bin$/.test(p.file) && /^[0-9a-f]{64}$/.test(p.sha256)), `${model} manifest lists hashed parts`);
  assert(manifest.totalBytes === manifest.parts.reduce((s, p) => s + p.bytes, 0), `${model} manifest sizes add up`);
}
assert(fs.existsSync(path.join(__dirname, "..", "models", "yolox-nano", "part-00.bin")), "the lightweight model ships with the app");
assert.match(sw, /result-utils\.js/);
assert.match(sw, /key\.startsWith\(CACHE_PREFIX\)/);
assert.match(sw, /cache\.match\(request\)/);
assert.doesNotMatch(sw, /caches\.match\(request\)/);
assert.match(sw, /\.\/detection-engine\.js/);
assert.match(server, /"\/detection-engine\.js"/);
for (const asset of ['result-utils.js', 'motion-core.js', 'motion-review.js', 'video-quality.js', 'share-core.js', 'share-media.js']) {
  assert(sw.includes(`./${asset}`));
  assert(server.includes(`"/${asset}"`));
}
assert.doesNotMatch(html, /id="tabNum"/);
assert.match(html, /FrescoMotionReview.open/);

console.log("Application state regression checks passed");
