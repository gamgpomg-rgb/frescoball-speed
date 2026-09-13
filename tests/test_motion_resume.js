'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
// Optional IndexedDB emulator for repeatable persistence/reload integration tests.
// FRESCO_TEST_IDB_MODULE=/path/to/fake-indexeddb node tests/test_motion_resume.js
if(!process.env.FRESCO_TEST_IDB_MODULE){console.log('Motion persistence integration skipped: set FRESCO_TEST_IDB_MODULE to fake-indexeddb');process.exit(0);}
const {indexedDB,IDBKeyRange}=require(process.env.FRESCO_TEST_IDB_MODULE);
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.value='';this.width=1000;this.height=500;}
 append(n){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(e=>e!==n);this.children.push(n);n.parentNode=this;}replaceChildren(){this.children=[];}remove(){}setAttribute(){}scrollIntoView(){}setPointerCapture(){}
 walk(){return this.children.flatMap(e=>[e,...e.walk()]);}querySelector(s){return this.walk().find(e=>Object.hasOwn(e.dataset,s.slice(6,-1)));}
 getBoundingClientRect(){return {left:0,top:0,width:1000,height:500};}
 getContext(){return new Proxy({},{get:(_,k)=>k==='getImageData'?()=>({data:new Uint8ClampedArray(640*320*4)}):()=>{}});}
}
function load(name='resume.mov',mode='simple',stop=false){
 const video=new Element('video'),host=new Element('host'),listeners={};let t=0,calls=0,cancelled=false;
 Object.assign(video,{videoWidth:1000,videoHeight:500,duration:1,readyState:2,paused:true,addEventListener:(k,f)=>listeners[k]=f,removeEventListener:k=>delete listeners[k],pause(){},play:async()=>{}});
 Object.defineProperty(video,'currentTime',{get:()=>t,set:n=>{t=n;queueMicrotask(()=>listeners.seeked?.());}});
 const context={window:{indexedDB,IDBKeyRange,FrescoBallTracker:require('../ball-tracker'),FrescoMotion:require('../motion-core'),__testDetector:{detect(){calls++;return {landmarks:[]};}}},document:{createElement:t=>new Element(t),getElementById:()=>video},setTimeout,clearTimeout,console};
 vm.runInNewContext(fs.readFileSync(require.resolve('../motion-review.js'),'utf8').replace('if(models)return models;','if(window.__testDetector)return window.__testDetector;if(models)return models;').replace('return {open,reset','return {readCheckpoint,findCheckpoint,clearCheckpoints,open,reset'),context);
 const R=context.window.FrescoMotionReview,source={name,size:100,lastModified:42,width:1000,height:500,duration:1};
 const button=text=>host.walk().find(e=>e.tag==='button'&&e.textContent===text);
 R.open({host,video,source,distance:7,mode,hits:[{t:.5}],onProgress:p=>{if(stop&&!cancelled&&p.busy&&p.percent>30){cancelled=true;button('解析を中止').onclick();}}});
 return {R,host,source,button,calls:()=>calls,select(offset=0){button('1人目を選ぶ').onclick();const c=host.walk().find(e=>e.tag==='canvas');const r=R.snapshot().regions[0];c.onpointerdown({clientX:r.x,clientY:r.y,pointerId:1});c.onpointerup({clientX:r.x+10+offset,clientY:r.y+10,pointerId:1});}};
}
(async()=>{
 const first=load('resume.mov','simple',true);first.select();await first.button('選んだ2人で自動解析').onclick();
 assert(!first.R.isBusy());const meta=await first.R.findCheckpoint(first.source,'simple');assert(meta,'cancel saves completed samples');
 const saved=await first.R.readCheckpoint(JSON.stringify(meta));assert(saved.length>0&&saved.length<30);
 const second=load();for(let i=0;i<30&&!second.button('前回の続きから解析');i++)await new Promise(r=>setTimeout(r,5));
 assert(second.button('前回の続きから解析'),'reload offers saved targets without drawing regions again');
 await second.button('前回の続きから解析').onclick();const result=second.R.snapshot();
 assert.equal(result.frames.length,30);assert.equal(result.regions.length,2);
 assert.deepEqual(result.frames.map(f=>f.t),Array.from({length:30},(_,i)=>i/30));
 const baseline=load('other.mov');baseline.select();await baseline.button('選んだ2人で自動解析').onclick();
 assert(second.calls()<baseline.calls(),'resumed analysis performs fewer model calls');
 const changed=load();await new Promise(r=>setTimeout(r,20));changed.select(20);await changed.button('選んだ2人で自動解析').onclick();assert.equal(changed.calls(),baseline.calls(),'different player regions require new inference');
 assert.equal(await second.R.findCheckpoint({...second.source,lastModified:43},'simple'),null,'different file revision cannot reuse checkpoint');
 assert.equal(await second.R.findCheckpoint(second.source,'detail'),null,'different model sampling mode cannot reuse checkpoint');
 await second.R.clearCheckpoints();assert.equal(await second.R.findCheckpoint(second.source,'simple'),null);
 console.log(`Motion resume integration passed: ${saved.length} samples recovered after cancellation and fresh context; fewer model calls, no duplicate frames, file/mode isolation, deletion`);
})().catch(e=>{console.error(e);process.exitCode=1;});
