'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
class Element{
  constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.value='';this.width=1000;this.height=500;}
  append(n){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(e=>e!==n);this.children.push(n);n.parentNode=this;} replaceChildren(){this.children=[];} remove(){} setAttribute(){} scrollIntoView(){} setPointerCapture(){}
  getBoundingClientRect(){return {left:0,top:0,width:1000,height:500};}
  querySelector(s){const key=s.slice(6,-1);return this.walk().find(e=>Object.hasOwn(e.dataset,key));}
  walk(){return this.children.flatMap(e=>[e,...e.walk()]);}
  getContext(){return new Proxy({},{get:(_,key)=>key==='getImageData'?()=>({data:new Uint8ClampedArray(640*320*4)}):()=>{}});}
}
const video=new Element('video');Object.assign(video,{videoWidth:1000,videoHeight:500,currentTime:0,duration:4,readyState:2,paused:true,addEventListener(){},pause(){},play:async()=>{}});
let testTime=0;const listeners={};video.addEventListener=(type,fn)=>{listeners[type]=fn;};video.removeEventListener=type=>{delete listeners[type];};Object.defineProperty(video,'currentTime',{get:()=>testTime,set:value=>{testTime=value;queueMicrotask(()=>listeners.seeked?.());}});
const context={window:{FrescoMotion:require('../motion-core.js')},document:{createElement:t=>new Element(t),getElementById:()=>video},setTimeout,clearTimeout,URL,Blob,console};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../motion-review.js'),'utf8').replace('return {open,reset', 'return {poseSchedule,poseAudioEstimates,open,reset').replace('if(models)return models;', 'if(window.__testDetector)return window.__testDetector;if(models)return models;'),context);
const schedule=context.window.FrescoMotionReview.poseSchedule;
const detailed=schedule(0,300,[{t:1},{t:2.43}], 'detail'), simple=schedule(0,300,[{t:1},{t:2.43}], 'simple');
assert.equal(detailed.reduce((a,b)=>a+b,0),150);
assert(simple.reduce((a,b)=>a+b,0)<75,'sparse contact windows reduce inference substantially');
for(let n=0;n<300;n++){
  if(n%2===0&&[1,2.43].some(t=>Math.abs(n/30-t)<=.18))assert.equal(simple[n],1,'retain all detail samples around contacts');
  if(n%6===0)assert.equal(simple[n],1,'maintain posture updates outside contacts');
  assert(simple[n]<=detailed[n],'never increase work compared with detail');
}
assert.equal(schedule(0,300,[{t:NaN}], 'simple').reduce((a,b)=>a+b,0),50);
const R=context.window.FrescoMotionReview,host=new Element('host'),source={name:'x.mov',size:100,width:1000,height:500,duration:4};let updates=0;
R.open({host,video,source,distance:7,hits:[{t:0},{t:.5}],onChange:()=>updates++});
const find=t=>host.walk().find(e=>e.tag==='button'&&e.textContent===t);
find('1人目を選ぶ').onclick();const canvas=host.walk().find(e=>e.tag==='canvas');
const tap=(x,y)=>{const e={clientX:x,clientY:y,pointerId:1};canvas.onpointerdown(e);canvas.onpointerup(e);};
const drag=(x,y,toX,toY)=>{canvas.onpointerdown({clientX:x,clientY:y,pointerId:1});canvas.onpointermove({clientX:toX,clientY:toY,pointerId:1});canvas.onpointerup({clientX:toX,clientY:toY,pointerId:1});};
assert.equal(R.snapshot().regions.length,2,'two visible starting frames');
drag(80,100,20,20);drag(300,425,200,450);drag(700,100,700,20);drag(920,425,950,450);
assert.equal(R.snapshot().regions[0].x,20);assert.equal(R.snapshot().regions[0].h,430);
const beforeCancel=JSON.stringify(R.snapshot().regions);canvas.onpointerdown({clientX:20,clientY:20,pointerId:1});canvas.onpointermove({clientX:0,clientY:0,pointerId:1});canvas.onpointercancel({pointerId:1});assert.equal(JSON.stringify(R.snapshot().regions),beforeCancel,'cancel restores region');
assert.equal(R.snapshot().regions.length,2,'four corners resize both ROIs');
const shotSelect=host.walk().find(e=>e.tag==='select');shotSelect.value='attack';shotSelect.onchange();assert.equal(R.snapshot().events[0].shotOverride,'attack');shotSelect.value='';shotSelect.onchange();assert.equal(R.snapshot().events[0].shotOverride,null);find('1人目が打った').onclick();find('2人目が打った').onclick();
assert.equal(R.snapshot().events.filter(e=>e.status==='confirmed').length,2);
const saved=R.snapshot();assert.equal(saved.settings.distanceM,7);assert(updates>=4);
R.setDistance(10);assert.equal(R.snapshot().settings.distanceM,10);R.restore(saved);assert.equal(R.snapshot().settings.distanceM,7);
find('1人目を選ぶ').onclick();drag(20,20,30,30);assert(R.snapshot().events.every(e=>e.status==='pending'),'changing target invalidates confirmations');
assert.throws(()=>R.restore({...saved,source:{...source,name:'wrong.mov'}}));
const ps=Array.from({length:33},()=>({x:20,y:20,visibility:1,presence:0}));
R.restore({...saved,frames:[{t:0,poses:[ps,[]],ballCandidates:[]}]});
assert.equal(R.drawOverlay(canvas.getContext(),1000,500,0),false,'low-presence points cannot appear on exports');
ps.forEach(p=>p.presence=1);R.restore({...saved,frames:[{t:0,poses:[ps,[]],ballCandidates:[]}]});
assert.equal(R.drawOverlay(canvas.getContext(),1000,500,0),true);
assert.equal(R.drawOverlay(canvas.getContext(),1000,500,0,{skeleton:false,ball:false}),false,'independent overlay controls can hide both');
const ballFrames=[0,.067,.134,.201].map((t,i)=>({t,poses:[[],[]],ballCandidates:[{x:200+i*50,y:200}]}));
R.restore({...saved,frames:ballFrames});assert.equal(R.snapshot().tracks.length,1,'coherent motion between selected people is retained');
assert.equal(R.drawOverlay(canvas.getContext(),1000,500,.201,{skeleton:false,ball:true}),true);
assert.equal(R.drawOverlay(canvas.getContext(),1000,500,.201,{skeleton:true,ball:false}),false,'ball switch is independent');
R.restore({...saved,frames:ballFrames.map(f=>({...f,ballCandidates:f.ballCandidates.map(p=>({...p,y:490}))}))});assert.equal(R.snapshot().tracks.length,0,'movement below the selected players is rejected');
assert.equal(R.drawOverlay(canvas.getContext(),1000,500,2),false,'do not invent skeleton outside analyzed range');
assert.equal(R.isBusy(),false);const modeBefore=JSON.stringify(R.snapshot());R.setMode('simple');assert.equal(host.walk().find(e=>Object.hasOwn(e.dataset,'posture')).hidden,true);assert.equal(host.walk().find(e=>e.tag==='summary'&&e.textContent==='表示を調整する').parentNode.hidden,true);assert(find('選んだ2人で自動解析'));assert.equal(JSON.stringify(R.snapshot()),modeBefore,'mode changes preserve video analysis');R.setMode('detail');assert.equal(host.walk().find(e=>Object.hasOwn(e.dataset,'posture')).hidden,false);assert.throws(()=>R.setMode('other'));R.reset();assert.equal(R.snapshot(),null,'reset must not expose previous video');
console.log('Motion review touch selection, confirmation, persistence and honest overlays passed');

(async()=>{
  let audioCalls=0,completed=0;const progressUpdates=[];
  context.window.__testDetector={detect:()=>({landmarks:[]})};
  const coreAuto=context.window.FrescoMotion.autoReview;
  context.window.FrescoMotion.autoReview=(ev)=>ev.map(e=>({...e,status:'auto',player:'a'}));
  const freshHost=new Element('host');
  R.open({host:freshHost,video,source,distance:7,analyzeAudio:async(progress,active)=>{audioCalls++;assert(active());progress(.5);return [{t:0}];},onComplete:()=>completed++,onProgress:p=>progressUpdates.push(p)});
  const buttons=()=>freshHost.walk().filter(e=>e.tag==='button'),pick=t=>buttons().find(e=>e.textContent===t);
  assert.equal(audioCalls,0,'opening frames does not start analysis');
  const c=freshHost.walk().find(e=>e.tag==='canvas');const tap2=(x,y)=>{const e={clientX:x,clientY:y,pointerId:1};c.onpointerdown(e);c.onpointerup(e);};
  pick('1人目を選ぶ').onclick();tap2(10,10);tap2(200,400);tap2(700,10);tap2(900,400);
  const duration=freshHost.walk().find(e=>Object.hasOwn(e.dataset,'duration'));assert.equal(duration.value,4,'entire video is default');assert(pick('5秒戻る'));assert(pick('5秒進む'));assert(freshHost.walk().some(e=>e.tag==='input'&&e.type==='range'));assert(freshHost.walk().some(e=>e.tag==='summary'&&e.textContent==='打球の判定を確認・修正する')); duration.value=.05;
  await pick('選んだ2人で自動解析').onclick();assert.equal(audioCalls,1);assert.equal(completed,1);assert.equal(R.snapshot().frames.length,2);assert.equal(R.snapshot().frames[1].poseSampleTime,0);assert(progressUpdates.length>=3);assert.equal(progressUpdates[0].percent,0);assert.equal(progressUpdates.at(-1).busy,false);assert.equal(progressUpdates.at(-1).percent,100);assert.equal(progressUpdates.at(-1).status,'complete');assert(progressUpdates.every(p=>p.phase==='motion'&&Number.isFinite(p.percent)));assert.equal(R.openReview(),true);assert.equal(freshHost.walk().find(e=>e.tag==='summary'&&e.textContent==='打球の判定を確認・修正する').parentNode.open,true);assert.equal(R.snapshot().events[0].status,'auto');
  const config=freshHost.walk().find(e=>e.tag==='summary'&&e.textContent==='解析条件を変更する').parentNode;assert.equal(config.open,false,'completed analysis collapses setup');
  assert.equal(await R.inspectTime(.25),true);assert(freshHost.walk().some(e=>e.tag==='button'&&e.textContent==='1人目が打った'),'inspectTime shows accepted event in same review card');
  assert(c.parentNode!==freshHost.children[0].children[3],'canvas remains present after review render');
  R.reset();
  let release;const pending=new Promise(r=>release=r);const cancelHost=new Element('host');
  R.open({host:cancelHost,video,source,distance:7,analyzeAudio:()=>pending,onComplete:()=>completed++,onProgress:p=>progressUpdates.push(p)});
  const b=t=>cancelHost.walk().find(e=>e.tag==='button'&&e.textContent===t),cv=cancelHost.walk().find(e=>e.tag==='canvas');
  const pt=(x,y)=>{const e={clientX:x,clientY:y,pointerId:2};cv.onpointerdown(e);cv.onpointerup(e);};b('1人目を選ぶ').onclick();pt(10,10);pt(200,400);pt(700,10);pt(900,400);
  const running=b('選んだ2人で自動解析').onclick();R.reset();release([{t:0}]);await running;assert.equal(R.snapshot(),null);assert.equal(completed,1,'cancelled audio must not complete into another video');assert.equal(progressUpdates.at(-1).status,'cancelled');
  const errHost=new Element('host');R.open({host:errHost,video,source,distance:7,analyzeAudio:async()=>{throw new Error('test failure');},onProgress:p=>progressUpdates.push(p)});R.restore(saved);
  await errHost.walk().find(e=>e.tag==='button'&&e.textContent==='選んだ2人で自動解析').onclick();assert.equal(progressUpdates.at(-1).status,'error');assert.equal(progressUpdates.at(-1).busy,false);R.reset();
  context.window.FrescoMotion.autoReview=coreAuto;
  console.log('Motion automatic flow defers audio, processes frames and invokes completion');
})().catch(e=>{console.error(e);process.exitCode=1;});

const pp=(x,y)=>({x,y,visibility:1,presence:1});
const wristFrames=[.4,.6].map((t,i)=>({t,poses:[0,1].map(side=>{const p=Array.from({length:33},()=>pp(100+side*600,100));p[15]=pp(100+side*600+(side?0:i*40),100);return p;}),ballCandidates:[]}));
const provisional=R.poseAudioEstimates([{id:'p',t:.5,status:'pending',origin:'audio'}],wristFrames,1000);
assert.equal(provisional[0].status,'auto');assert.equal(provisional[0].player,'a');assert.equal(provisional[0].reviewRequired,true);assert.equal(provisional[0].provenance,'pose-audio-estimate-v1');
assert.equal(R.poseAudioEstimates([{id:'p',t:.5,status:'pending',origin:'manual-review'}],wristFrames,1000)[0].status,'pending');
assert.equal(R.poseAudioEstimates([{id:'prev',t:.3,status:'confirmed',player:'a'},{id:'p',t:.5,status:'pending'}],wristFrames,1000)[1].status,'pending','same-side estimate remains pending');
assert.equal(R.poseAudioEstimates([{id:'prev',t:.4,status:'confirmed',player:'b'},{id:'p',t:.5,status:'pending'}],wristFrames,1000)[1].status,'pending','too-close sound remains pending');
const bothMove=JSON.parse(JSON.stringify(wristFrames));bothMove[1].poses[1][15].x+=40;
assert.equal(R.poseAudioEstimates([{id:'p',t:.5,status:'pending'}],bothMove,1000)[0].status,'pending','ambiguous simultaneous arm motion is not assigned');
console.log('Pose/audio provisional estimates preserve manual input and reject ambiguity');
