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
assert.match(sw, /frescoball-speed-shell-v11/);
assert.match(sw, /result-utils\.js/);
assert.match(sw, /key\.startsWith\(CACHE_PREFIX\)/);
assert.match(sw, /cache\.match\(request\)/);
assert.doesNotMatch(sw, /caches\.match\(request\)/);
assert.match(sw, /\.\/detection-engine\.js/);
assert.match(server, /"\/detection-engine\.js"/);

console.log("Application state regression checks passed");
