'use strict';
const assert=require('assert'),T=require('../teacher-model');
// 前処理: 2×2 の RGBA を CHW の float32 に。ImageNet 正規化の値を確かめる
{
  const data=new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 124,116,104,255]);
  const x=T.preprocess(data,2);
  assert.equal(x.length,12);
  assert(Math.abs(x[0]-(1-.485)/.229)<1e-6,'R channel of pixel 0');
  assert(Math.abs(x[4+1]-(1-.456)/.224)<1e-6,'G channel of pixel 1');
  assert(Math.abs(x[8+2]-(1-.406)/.225)<1e-6,'B channel of pixel 2');
  assert(Math.abs(x[3])<.02&&Math.abs(x[7])<.02&&Math.abs(x[11])<.02,'ImageNet mean colour maps to about 0');
}
// 復号: クエリごとの最大クラス確率で選び、しきい値未満は null
{
  const dets=new Float32Array([.1,.2,.05,.05, .5,.5,.1,.1, .9,.9,.05,.05]);
  const logits=new Float32Array([-6,-6, 2,-6, -1,-6]);   // sigmoid: 0.0025, 0.88, 0.27
  const best=T.decode(dets,logits,3,2);
  assert(best&&Math.abs(best.x-.5)<1e-6&&Math.abs(best.conf-1/(1+Math.exp(-2)))<1e-6,'highest-confidence query wins');
  assert.equal(T.decode(dets,new Float32Array([-6,-6,-6,-6,-6,-6]),3,2),null,'nothing above the minimum confidence');
  assert(Math.abs(T.decode(dets,logits,3,2,.9)?.conf??0)<1e-9||T.decode(dets,logits,3,2,.9)===null,'minimum confidence is respected');
}
// 結合: 分割ファイルを順につなぎ、合計が合わなければ失敗
{
  const a=new Uint8Array([1,2,3]),b=new Uint8Array([4,5]).buffer;
  const out=T.assemble([a,b],5);assert.deepEqual(Array.from(out),[1,2,3,4,5]);
  assert.throws(()=>T.assemble([a,b],6),/大きさ/);
}
// モデルの選び方: WebGPU のある PC は高精度（rfdetr）、スマホや WebGPU の無い環境は軽量（yolox、wasm）
{
  assert.equal(T.pick(null),null);assert.equal(T.supported(null),false);
  assert.equal(T.pick({gpu:{},userAgent:'Mozilla/5.0 (Macintosh) Chrome/140'}).model,'rfdetr');
  assert.equal(T.pick({gpu:{},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) Safari'}),null,'phones stay on the rule-based path until the Safari crash is understood');
  const forcedPhone=T.pick({gpu:{},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) Safari'},'yolox');
  assert.equal(forcedPhone.model,'yolox');assert.deepEqual(forcedPhone.providers,['wasm'],'phones never use the GPU, even when WebGPU exists');
  assert.equal(forcedPhone.maxCalls,200);assert.equal(forcedPhone.threads,1);
  assert.equal(T.pick({userAgent:'Mozilla/5.0 (Linux; Android 15) Mobile Chrome/140'},'yolox').providers.join(),'wasm');
  assert.equal(T.pick({gpu:{},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) Safari'},null),null,'without the switch a phone stays unsupported');
  assert.equal(T.pick({gpu:{},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) Safari'},'rfdetr').maxCalls,undefined,'the trial limits apply only to the phone yolox path');
  assert.equal(T.pick({gpu:{},userAgent:'Mozilla/5.0 (Macintosh) Chrome/140'},'yolox').maxCalls,null);
  const noGpu=T.pick({userAgent:'Mozilla/5.0 (Macintosh) Chrome/140'});
  assert.equal(noGpu.model,'yolox');assert.deepEqual(noGpu.providers,['wasm']);
  assert.equal(T.pick({gpu:{},userAgent:'Mozilla/5.0 (Macintosh) Chrome/140'},'yolox').model,'yolox','forced choice for verification');
  assert.equal(T.supported({userAgent:'Mozilla/5.0 (iPhone)'}),false);
}
// YOLOX 用: BGR 0〜255 の前処理と、obj×cls が最大の 1 つを選ぶ復号（座標は入力画素→相対）
{
  const data=new Uint8ClampedArray([10,20,30,255, 40,50,60,255, 70,80,90,255, 100,110,120,255]);
  const x=T.preprocessBgr255(data,2);
  assert.deepEqual(Array.from(x),[30,60,90,120, 20,50,80,110, 10,40,70,100],'B, G, R planes without normalisation');
  const out=new Float32Array([100,100,20,20,.9,.2, 192,96,20,20,.8,.9, 300,300,20,20,.1,.99]);
  const best=T.decodeYolox(out,3,6,.05,384);
  assert(best&&Math.abs(best.x-.5)<1e-9&&Math.abs(best.y-.25)<1e-9&&Math.abs(best.conf-.72)<1e-6,'obj×cls picks the second box');
  assert.equal(T.decodeYolox(out,3,6,.8,384),null,'minimum confidence is respected');
}
// 分割ファイルの照合: SHA-256 が manifest と一致しないときは失敗にし、キャッシュからも消す
(async()=>{
  assert.equal(await T.sha256Hex(new Uint8Array([1,2,3]).buffer),'039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
  const good=new Uint8Array([1,2,3]),bad=new Uint8Array([1,2,4]);
  const manifest={totalBytes:3,input:{name:'input',shape:[1,3,384,384]},outputs:{boxes:'dets',logits:'labels'},parts:[{file:'part-00.bin',bytes:3,sha256:'039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'}]};
  const deleted=[];const store=new Map();
  globalThis.caches={open:async()=>({match:async url=>store.get(url)||null,put:async(url,res)=>{store.set(url,res);},delete:async url=>{deleted.push(url);store.delete(url);}})};
  let serve=good;
  globalThis.fetch=async url=>({ok:true,clone(){return this;},json:async()=>manifest,arrayBuffer:async()=>serve.buffer.slice(0)});
  const ok=await T.fetchModel('m/');assert.deepEqual(Array.from(ok.bytes),[1,2,3],'matching hash is accepted');
  store.clear();serve=bad;
  await assert.rejects(()=>T.fetchModel('m/'),/壊れています/,'a tampered part is rejected');
  assert.deepEqual(deleted,['m/part-00.bin'],'the bad part is dropped from the cache');
  store.clear();
  await assert.rejects(()=>{globalThis.fetch=async()=>({ok:true,clone(){return this;},json:async()=>({...manifest,parts:[{file:'../evil.bin',bytes:3}]})});return T.fetchModel('m/');},/一覧が不正/,'file names outside the model folder are refused');
  // スマホ試験：スレッド1・wasm のみ・呼び出し上限・段階の記録・採用数
  {
    const yoloxManifest={...manifest,kind:'yolox',conf:.5,input:{name:'input',shape:[1,3,384,384],normalize:'bgr255'},outputs:{boxes:'dets',stride:6}};
    globalThis.fetch=async()=>({ok:true,clone(){return this;},json:async()=>yoloxManifest,arrayBuffer:async()=>good.buffer.slice(0)});store.clear();
    let runs=0,created=null;const stages=[];
    const row=[192,192,20,20,.9,.9];
    const ort={env:{wasm:{}},Tensor:class{constructor(t,d,s){this.data=d;this.dims=s;}},InferenceSession:{create:async(b,o)=>{created=o;return {run:async()=>{runs++;return {dets:{data:Float32Array.from(row),dims:[1,1,6]}};}};}}};
    const t=await T.createTeacher({ort,baseUrl:'m/',providers:['wasm'],maxCalls:200,threads:1,onStage:(stage,info)=>stages.push([stage,info.calls])});
    assert.equal(ort.env.wasm.numThreads,1);assert.deepEqual(created.executionProviders,['wasm']);
    const img={width:384,height:384,data:new Uint8ClampedArray(384*384*4)};
    for(let i=0;i<250;i++)await t.detect(img);
    assert.equal(runs,200,'the model is not called after 200 calls');assert.equal(await t.detect(img),null);
    assert.equal(t.stats().adopted,200);
    assert.deepEqual(stages.slice(0,3).map(x=>x[0]),['fetch','prepare','infer']);
    assert.deepEqual(stages.filter(x=>x[0]==='infer').map(x=>x[1]).slice(0,3),[1,10,20],'stage is recorded at the first call and every 10 calls');
    t.resetCalls();await t.detect(img);assert.equal(runs,201,'resetCalls starts a new analysis');
    // 推論の例外は数えて投げ直す（呼び出し側が握りつぶしても、失敗の回数が残る）
    t.resetCalls();ort.InferenceSession.create=null;const failing=await T.createTeacher({ort:{...ort,InferenceSession:{create:async()=>({run:async()=>{throw new Error('oom');}})}},baseUrl:'m/',providers:['wasm']});
    for(let i=0;i<3;i++)await assert.rejects(()=>failing.detect(img),/oom/);
    assert.deepEqual(failing.stats(),{calls:3,adopted:0,failed:3});
  }
  delete globalThis.caches;delete globalThis.fetch;
  console.log('Teacher model chunk verification passed');
})().catch(e=>{console.error(e);process.exit(1);});
console.log('Teacher model preprocessing, decoding, assembly and support detection passed');
