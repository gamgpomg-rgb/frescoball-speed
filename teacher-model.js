/* 学習済みの球検出モデル（RF-DETR nano・ONNX）を、予測位置の小窓にだけ当てるための補助。
 * PC の Chrome（WebGPU）向け。モデルは models/<name>/ に 24MB ずつ分割して置き、初回だけ取得して
 * Cache API に保存する。速度・打数は音声基準のままで、この検出は球の軌跡の見落としを埋めるだけに使う。
 * 純粋な関数（前処理・復号・結合）は Node のテストで検証する。ONNX Runtime は呼び出し側が読み込んで渡す。
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.FrescoTeacher=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const MEAN=[0.485,0.456,0.406],STD=[0.229,0.224,0.225];
  // RGBA の画素列（size×size）→ float32 [1,3,size,size]（ImageNet の平均・分散で正規化、CHW 順）
  function preprocess(data,size){
    const n=size*size,out=new Float32Array(3*n);
    for(let i=0;i<n;i++){const j=i*4;out[i]=(data[j]/255-MEAN[0])/STD[0];out[n+i]=(data[j+1]/255-MEAN[1])/STD[1];out[2*n+i]=(data[j+2]/255-MEAN[2])/STD[2];}
    return out;
  }
  // dets [queries,4]（cx,cy,w,h を 0〜1 で正規化）と labels [queries,classes]（ロジット）から、
  // 最も確からしい 1 つを {x,y,w,h,conf}（窓内の相対座標）で返す。min 未満なら null。
  function decode(dets,labels,queries,classes,min=.05){
    let best=null;
    for(let q=0;q<queries;q++){
      let s=0;for(let c=0;c<classes;c++){const v=1/(1+Math.exp(-labels[q*classes+c]));if(v>s)s=v;}
      if(s<min||(best&&s<=best.conf))continue;
      best={x:dets[q*4],y:dets[q*4+1],w:dets[q*4+2],h:dets[q*4+3],conf:s};
    }
    return best;
  }
  // 分割ファイルを 1 つの Uint8Array に戻す。合計サイズが manifest と違えば失敗にする
  function assemble(parts,totalBytes){
    const total=parts.reduce((s,p)=>s+p.byteLength,0);
    if(!finite(totalBytes)||total!==totalBytes)throw new Error(`モデルの大きさが合いません（${total}/${totalBytes}）`);
    const out=new Uint8Array(total);let offset=0;for(const p of parts){out.set(p instanceof Uint8Array?p:new Uint8Array(p),offset);offset+=p.byteLength;}
    return out;
  }
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  // PC の Chrome で WebGPU が使えるときだけ対象にする（スマホは重すぎるため対象外）
  function supported(nav=typeof navigator!=='undefined'?navigator:null){
    return !!(nav&&nav.gpu)&&!/Mobi|Android|iPhone|iPad|iPod/i.test(nav.userAgent||'');
  }
  // SHA-256 の16進表記（manifest の値と突き合わせる）。WebCrypto が無い環境では null
  async function sha256Hex(buffer){
    const subtle=typeof crypto!=='undefined'?crypto.subtle:null;if(!subtle)return null;
    const digest=await subtle.digest('SHA-256',buffer);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }
  // manifest.json と分割ファイルを取得（初回のみ通信。以後は Cache API から）。各分割の大きさと SHA-256 を
  // manifest と照合し、合わないものはキャッシュから消して失敗にする（差し替えられたモデルを使わない）。
  async function fetchModel(baseUrl,onProgress,cacheName='frescoball-teacher-v1'){
    const cache=typeof caches!=='undefined'?await caches.open(cacheName).catch(()=>null):null;
    const get=async url=>{const hit=cache&&await cache.match(url);if(hit)return hit;const res=await fetch(url,{cache:'no-cache'});if(!res.ok)throw new Error(`モデルを取得できません（${res.status}）`);if(cache)try{await cache.put(url,res.clone());}catch{}return res;};
    const manifest=await (await get(baseUrl+'manifest.json')).json();
    if(!Array.isArray(manifest.parts)||!manifest.parts.every(p=>typeof p.file==='string'&&/^[A-Za-z0-9._-]+$/.test(p.file)&&finite(p.bytes)))throw new Error('モデルの一覧が不正です');
    const parts=[];let done=0;
    for(const part of manifest.parts){
      const url=baseUrl+part.file,buf=await (await get(url)).arrayBuffer();
      const hash=part.sha256?await sha256Hex(buf):null;
      if(buf.byteLength!==part.bytes||(hash&&hash!==part.sha256)){if(cache)try{await cache.delete(url);}catch{}throw new Error(`モデルの一部が壊れています（${part.file}）`);}
      parts.push(buf);done+=buf.byteLength;onProgress?.(done/manifest.totalBytes);
    }
    return {manifest,bytes:assemble(parts,manifest.totalBytes)};
  }
  // ONNX Runtime（ort）でセッションを作り、detect(imageData) を返す。imageData は size×size の RGBA
  async function createTeacher({ort,baseUrl,onProgress,providers=['webgpu','wasm']}){
    if(!ort?.InferenceSession)throw new Error('ONNX Runtime が読み込まれていません');
    const {manifest,bytes}=await fetchModel(baseUrl,onProgress);
    const size=manifest.input.shape[2];
    let session=null,provider=null;
    for(const ep of providers){try{session=await ort.InferenceSession.create(bytes,{executionProviders:[ep]});provider=ep;break;}catch(e){session=null;}}
    if(!session)throw new Error('モデルを実行できる環境がありません');
    const inputName=manifest.input.name,boxesName=manifest.outputs.boxes,logitsName=manifest.outputs.logits;
    return {size,provider,name:manifest.name,
      async detect(imageData){
        if(!imageData||imageData.width!==size||imageData.height!==size)throw new Error(`入力は${size}×${size}にしてください`);
        const input=new ort.Tensor('float32',preprocess(imageData.data,size),[1,3,size,size]);
        const out=await session.run({[inputName]:input});
        const dets=out[boxesName],labels=out[logitsName];
        return decode(dets.data,labels.data,labels.dims[1],labels.dims[2]);
      },
      async close(){try{await session.release?.();}catch{}}
    };
  }
  return {preprocess,decode,assemble,supported,sha256Hex,fetchModel,createTeacher,mean:MEAN,std:STD};
});
