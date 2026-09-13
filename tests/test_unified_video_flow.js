'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const elements=new Map();const el=id=>{
  if(!elements.has(id))elements.set(id,{value:'7',classList:{toggle(){}},style:{setProperty(){}},dataset:{},hidden:false,handlers:{},setAttribute(k,v){this[k]=v;},addEventListener(type,fn){this.handlers[type]=fn;},removeEventListener(type){delete this.handlers[type];},load(){queueMicrotask(()=>this.handlers.loadeddata?.());},click(){this.handlers.click?.();}});
  return elements.get(id);
};
Object.assign(el('upVideo'),{src:'',videoWidth:1920,videoHeight:1080,duration:20});
let audioCalls=0,workflow;
const c=vm.createContext({$:el,console,setTimeout,clearTimeout,URL:{createObjectURL:()=> 'blob:local-test'},
  videoMode:"simple",analysisActivity:{busy:false,percent:0},renderShotSummary:()=>{},selectedVideoFile:null,uploadObjectUrl:null,uploadAnalysisGeneration:0,currentMotion:null,curStats:null,currentRecordMeta:{},currentVideoSettings:null,
  validatedVideoDistance:Number,currentSettings:()=>({values:{distance:'7'}}),setVideoExportAvailability:()=>{},
  window:{FrescoMotionReview:{isBusy:()=>false}},updateAnalysisSteps:()=>{},renderDash:()=>{},syncLive:()=>{},saveCurrentRecord:()=>{},videoRallyGap:()=>2.5,
  MEASUREMENT:require('../measurement-spec.js'),FrescoMotion:require('../motion-core.js'),FrescoMotionReview:{open:options=>{workflow=options;}},
  analyzeFile:async()=>{audioCalls++;return{onsets:[1,1.5],aiRejected:0};},buildStats:times=>({hits:times.map(t=>({t}))})});
c.resetUploadAnalysis=()=>{c.uploadAnalysisGeneration++;c.curStats=null;c.currentMotion=null;c.uploadObjectUrl=null;return c.uploadAnalysisGeneration;};
for(const name of ['updateActivity','updateAnalysisSteps','openMotionWorkflow','updateFromMotion']){const a=html.indexOf(`function ${name}(`);vm.runInContext(html.slice(a,html.indexOf('\n}',a)+2),c);}
const a=html.indexOf('$("upFile").addEventListener("change", async e => {'),b=html.indexOf('$("upDistanceApply").addEventListener',a);
vm.runInContext(html.slice(a,b),c);
(async()=>{
  await el('upFile').handlers.change({target:{files:[{name:'test.mov',size:100}]}});
  assert.equal(audioCalls,1,'picking a video automatically runs quick analysis');
  assert(!workflow,'detailed analysis is optional');
  assert.equal(el('upStage').hidden,false);
  assert.equal(audioCalls,1);assert.equal(c.curStats.analysisMode,'audio');
  assert.equal(el('stateQuick').textContent,'✓ 計測済み');
  c.updateAnalysisSteps('motion',45);assert.equal(el('analysisProgress').value,45);assert.equal(el('stepReview').disabled,true);
  c.updateAnalysisSteps();assert.equal(el("analysisProgress").value,45,"refresh preserves the running progress");
  c.openMotionWorkflow();
  assert(workflow&&typeof workflow.analyzeAudio==='function');
  const hits=await workflow.analyzeAudio(()=>{},()=>true);
  assert.equal(audioCalls,1);assert.equal(hits.length,2);
  await workflow.analyzeAudio(()=>{},()=>true);assert.equal(audioCalls,1,'rerunning poses reuses completed audio');
  const snapshot={settings:{distanceM:7},frames:[{t:1}],events:[
    {t:1,status:'auto',player:'a'},{t:1.5,status:'auto',player:'b'},
    {t:2,status:'pending',player:null},{t:2.5,status:'confirmed',player:'a'}]};
  workflow.onChange(snapshot);
  assert.equal(c.curStats.analysisMode,'motion');assert.equal(c.curStats.total,3);
  assert.equal(c.curStats.hits[1].speed,require('../measurement-spec.js').measureInterval({observedSeconds:.5,lengthM:7}).initialSpeedKmh);assert.equal(c.curStats.hits[2].speed,null);
  assert.equal(c.curStats.hits[2].rNow,3,'unresolved events must not invent a drop');
  const before=c.currentMotion;c.uploadAnalysisGeneration++;workflow.onChange({...snapshot,settings:{distanceM:10}});
  assert.equal(c.currentMotion,before,'old workflow cannot overwrite another video');
  c.analyzeFile=async()=>{throw new Error('test decode failure');};
  await c.runQuickAnalysis();
  assert.equal(el('quickAnalyze').hidden,false,'failed auto analysis exposes retry');
  assert.equal(el('upProg').hidden,false);
  console.log('Quick audio results, optional target analysis, no false drop and stale callback isolation passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
// Switching presentation modes must preserve the loaded analysis.
{
 const classes=new Map();for(const id of ['upView','tabUp','tabDetail','tabCam'])el(id).classList={add:n=>classes.set(id+':'+n,true),remove:n=>classes.delete(id+':'+n),toggle:(n,on)=>on?classes.set(id+':'+n,true):classes.delete(id+':'+n)};
 c.exitCamera=()=>{};let modeSeen=null;c.window.FrescoMotionReview.setMode=m=>modeSeen=m;
 const start=html.indexOf('function selectVideoMode(');vm.runInContext(html.slice(start,html.indexOf('\n}',start)+2),c);
 const before=c.currentMotion;c.selectVideoMode('detail');assert.equal(modeSeen,'detail');assert.equal(c.currentMotion,before);c.selectVideoMode('simple');assert.equal(modeSeen,'simple');assert.equal(c.currentMotion,before);
 c.updateActivity('motion',29,'running');assert.equal(el('activityBadge').hidden,false);assert.equal(el('activityPercent').textContent,'29%');assert.equal(el('tabCam').disabled,true);
 c.updateActivity('motion',29,'error');assert.equal(el('activityTitle').textContent,'解析できませんでした');assert.equal(el('activityPercent').textContent,'!');
 c.updateActivity('audio',0,'idle');
 console.log('Simple/detail mode preserves analysis; fixed progress distinguishes running and error');
}
