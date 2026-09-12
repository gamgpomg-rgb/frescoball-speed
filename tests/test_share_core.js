'use strict';
const assert=require('assert');
const C=require('../share-core.js');
assert.deepEqual(C.windowFor(10,8,15),{start:8,end:10});
for(const args of [[10,10,1],[10,-1,1],[10,0,0],[10,0,61],[NaN,0,1]])assert.throws(()=>C.windowFor(...args));
const fit=C.fit(1920,1080,0,320,1080,1120);
assert.equal(fit.w,1080);assert.equal(fit.h,607.5);assert.equal(fit.y,576.25);
const portrait=C.fit(1080,1920,0,320,1080,1120);
assert.equal(portrait.h,1120);assert.equal(portrait.w,630);assert.equal(portrait.x,225);
assert.throws(()=>C.fit(0,1080,0,0,100,100));
const regions=[{x:100,y:50,w:50,h:100},{x:300,y:50,w:50,h:100}];
assert.deepEqual(C.crop(400,200,regions,true),{x:75,y:25,w:300,h:150});
assert.deepEqual(C.crop(400,200,null,false),{x:0,y:0,w:400,h:200});
assert.throws(()=>C.crop(400,200,[regions[0],{x:500,y:50,w:10,h:20}],true));
assert.throws(()=>C.crop(400,200,new Array(2),true));
const hits=[{t:0,speed:80},{t:.5,speed:60},{t:1,speed:null},{t:1.5,speed:70},{t:8,speed:100}];
assert.deepEqual(C.stats(hits,.5,1.5),{total:3,rally:3,average:70,max:70});
assert.equal(C.stats(hits,0,8).max,70,'a rally gap must not contribute a cross-gap speed');
assert.deepEqual(C.stats([...hits].reverse(),.5,1.5),C.stats(hits,.5,1.5));
assert.equal(C.hitAt(hits,1.1,0),null,'latest null speed must clear previous valid speed');
assert.equal(C.hitAt(hits,.7,0).speed,60);
assert.equal(C.hitAt(hits,3,0),null,'expired speed must clear');
assert.equal(C.hitAt(hits,.7,.6),null,'do not show a shot from before the clip');
assert.equal(C.hitAt([...hits].reverse(),1.1,0),null);
assert.deepEqual(C.motionRange({frames:[{t:1},{t:2}]}),{start:1,end:2});
for(const frames of [[],[{t:0}],[{t:1},{t:1}],[{t:2},{t:1}],[{t:NaN},{t:1}],[null,{t:1}]])assert.equal(C.motionRange({frames}),null);
// Run the actual seek helper against a video-like EventTarget. Same-position
// seeks must complete without a seeked event; aborts must detach handlers.
const fs=require('fs'),vm=require('vm');
const code=fs.readFileSync(require('path').join(__dirname,'../share-media.js'),'utf8');
const begin=code.indexOf('  function seek('),end=code.indexOf('  function skeleton(',begin);
const context=vm.createContext({setTimeout,clearTimeout,Error});vm.runInContext(code.slice(begin,end),context);
(async()=>{
  const v=new EventTarget();v.currentTime=0;v.readyState=2;
  await context.seek(v,0,new AbortController().signal);
  const controller=new AbortController();const pending=context.seek(v,1,controller.signal);controller.abort();
  await assert.rejects(pending,/中止/);
  const bad=new EventTarget();bad.readyState=0;Object.defineProperty(bad,'currentTime',{get:()=>0,set:()=>{throw Error('setter failed');}});
  await assert.rejects(context.seek(bad,1),/setter failed/);
  console.log('Share geometry, clip stats, clearing excluded speed, ranges and cancellable seek passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

// Execute the export selection block to verify that unconfirmed observations
// interrupt the measurement chain and cannot inflate the confirmed shot count.
const M=require('../motion-core.js');
const motion={settings:{distanceM:7},events:[
  {t:0,player:'a',status:'confirmed'},
  {t:.5,player:'b',status:'auto'},
  {t:.8,player:null,status:'pending'},
  {t:1,player:'a',status:'confirmed'},
]};
const selection=vm.createContext({record:{hits:[]},measurement:{value:'confirmed'},motion,window:{FrescoMotion:M},range:{start:0,end:2}});
const selectionStart=code.indexOf('      let selectedRecord=record;');
const selectionEnd=code.indexOf('      state={',selectionStart);
vm.runInContext(code.slice(selectionStart,selectionEnd)+'\nresult=selectedRecord;',selection);
assert.equal(selection.result.hits.length,3);
assert.equal(selection.result.hits[1].status,'auto');
assert.equal(selection.result.hits[1].speed,50.4);
assert.equal(selection.result.hits[2].speed,null);
assert.equal(C.stats(selection.result.hits,0,2).total,3);
assert.equal(C.hitAt(selection.result.playbackHits,.85,0),null);
let strokes=0;
const graphics={beginPath(){},moveTo(){},lineTo(){},stroke(){strokes++;}};
const landmarks=Array.from({length:33},()=>({x:0,y:0,visibility:0,presence:0}));
landmarks[11]={x:1,y:1,visibility:1,presence:.2};landmarks[12]={x:2,y:1,visibility:1,presence:1};
const skeletonContext=vm.createContext({window:{FrescoMotion:M},edges:[[11,12]]});
const skeletonStart=code.indexOf('  function skeleton('),skeletonEnd=code.indexOf('  function draw(',skeletonStart);
vm.runInContext(code.slice(skeletonStart,skeletonEnd),skeletonContext);
skeletonContext.skeleton(graphics,{source:{width:1000},frames:[{t:0,poses:[landmarks]}]},0);
assert.equal(strokes,0,'low presence must suppress a skeletal edge');
console.log('Confirmed-only export selection and skeleton presence checks passed');

// Motion records contain mean speeds in hits: the audio export must take the
// separate initial-speed timeline and reapply saved review choices.
const audioSelection=vm.createContext({record:{analysisMode:'motion',hits:[{t:0,speed:20},{t:.5,speed:30}],audioHits:[{t:0,speed:80},{t:.5,speed:100}],speedReview:{maxSpeedKmh:90}},measurement:{value:'audio'},motion:null,window:{FrescoVideoQuality:require('../video-quality.js')},range:{start:0,end:2}});
vm.runInContext(code.slice(selectionStart,selectionEnd)+'\nresult=selectedRecord;',audioSelection);
assert.equal(audioSelection.result.hits[0].speed,80);
assert.equal(audioSelection.result.hits[1].speed,null);
assert.equal(audioSelection.result.hits[1].originalSpeed,100);
assert.equal(audioSelection.result.playbackHits[1].speed,null);
audioSelection.record={analysisMode:'motion',hits:[{t:0,speed:20}]};
assert.throws(()=>vm.runInContext('{'+code.slice(selectionStart,selectionEnd)+'}',audioSelection),/音から計算した速度/);
console.log('Motion versus audio export provenance and saved speed review checks passed');

const targetReview=vm.createContext({record:{speedReview:{overrides:{'0.5':'drop'}}},measurement:{value:'confirmed'},motion,window:{FrescoMotion:M,FrescoVideoQuality:require('../video-quality.js')},range:{start:0,end:2}});
vm.runInContext(code.slice(selectionStart,selectionEnd)+'\nresult=selectedRecord;',targetReview);
assert.equal(targetReview.result.hits[1].speed,null,'target export must retain user exclusions');
assert.equal(targetReview.result.hits[1].originalSpeed,50.4);
assert.equal(targetReview.result.playbackHits[1].speed,null);
console.log('Target export preserves saved manual speed exclusions');

const ballTrack={points:[0,.05,.1,.15].map((t,i)=>({t,x:170+i*20,y:80}))};
assert.equal(C.trajectoryTracks([ballTrack],regions,400,200).length,1);
const outside={points:ballTrack.points.map(p=>({...p,y:170}))};
const bodyOnly={points:ballTrack.points.map((p,i)=>({...p,x:110+i*10}))};
const staticMark={points:ballTrack.points.map((p,i)=>({...p,x:170+i}))};
assert.equal(C.trajectoryTracks([outside,bodyOnly,staticMark],regions,400,200).length,0);
assert.equal(C.trajectoryTracks([ballTrack],[],400,200).length,0);
assert.equal(C.trajectoryAt([ballTrack],.1).length,3,'no future ball samples in saved frames');
assert.equal(C.trajectoryAt([ballTrack],.4).length,0,'old tracks must disappear');
assert.equal(C.trajectoryAt([ballTrack,ballTrack],.15).length,4,'show one plausible segment instead of accumulating all candidates');
console.log('Trajectory display rejects background/body/static candidates and avoids future or stale points');
