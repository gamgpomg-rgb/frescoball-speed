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
  assert.equal(forcedPhone.model,'yolox');assert.deepEqual(forcedPhone.providers,['webgpu','wasm']);
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
  delete globalThis.caches;delete globalThis.fetch;
  console.log('Teacher model chunk verification passed');
})().catch(e=>{console.error(e);process.exit(1);});
console.log('Teacher model preprocessing, decoding, assembly and support detection passed');
