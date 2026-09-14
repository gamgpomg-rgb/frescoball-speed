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
// 対応判定: WebGPU のある PC だけ。Node（navigator なし）や iPhone は対象外
{
  assert.equal(T.supported(null),false);
  assert.equal(T.supported({gpu:{},userAgent:'Mozilla/5.0 (Macintosh) Chrome/140'}),true);
  assert.equal(T.supported({gpu:{},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) Safari'}),false);
  assert.equal(T.supported({userAgent:'Mozilla/5.0 (Macintosh) Chrome/140'}),false);
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
