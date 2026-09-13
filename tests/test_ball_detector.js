'use strict';
const assert=require('assert'),B=require('../ball-tracker');
const w=320,h=160,regions=[{x:0,y:0,w:50,h:160},{x:270,y:0,w:50,h:160}];
function frame(objects=[]){const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=80;data[i+3]=255;}for(const o of objects)for(let y=o.y;y<o.y+(o.h||2);y++)for(let x=o.x;x<o.x+(o.w||2);x++)data.set([...(o.color||[230,100,200]),255],(y*w+x)*4);return data;}
let D=B.createDetector(w,h,regions);D.detect(frame(),0);
assert.equal(D.detect(frame([{x:80,y:50}]),1/30).length,1,'pink, including blue-rich pink, detected');
D=B.createDetector(w,h,regions);const fixed=frame([{x:80,y:50}]);D.detect(fixed,0);assert.equal(D.detect(fixed,1/30).length,0,'static pink background excluded');
D=B.createDetector(w,h,regions);D.detect(frame(),0);assert.equal(D.detect(frame([{x:80,y:50,w:25,h:25}]),1/30).length,0,'large moving pink object excluded');
D=B.createDetector(w,h,regions);D.detect(frame(),0);D.detect(frame([{x:80,y:50}]),1/30);D.detect(frame([{x:90,y:50}]),2/30);
assert.equal(D.detect(frame([{x:100,y:50,color:[150,130,145]}]),3/30).length,1,'faint observed pixels recovered near predicted position');
assert.equal(D.detect(frame(),4/30).length,0,'prediction never invents pixels');
D=B.createDetector(w,h,regions);D.detect(frame(),0);assert.equal(D.detect(frame([{x:100,y:50,color:[150,130,145]}]),1/30).length,0,'weak pink does not start unrestricted tracks');
D=B.createDetector(w,h,regions);D.detect(frame(),0);D.detect(frame([{x:80,y:50}]),1/30);D.detect(frame([{x:90,y:50}]),2/30);assert.equal(D.detect(frame([{x:100,y:50,w:7,h:1}]),3/30).length,1,'short motion blur accepted near prediction');
const slow=Array.from({length:10},(_,i)=>({t:i/30,ballCandidates:[{x:80+i*.1,y:50}]}));assert.equal(B.track(slow,w,regions).length,0,'slow background is not a ball track');
console.log('Pink detection, fixed background, large moving objects, bounded faint/blur recovery and no invented points passed');
// 選手枠より上を飛ぶ球（山なりのラリー）。探索範囲を枠の上端で切っていた頃は候補が消え、軌跡が分断された。
{
  const low=[{x:0,y:100,w:50,h:60},{x:270,y:100,w:50,h:60}];
  const D2=B.createDetector(w,h,low);D2.detect(frame(),0);
  assert.equal(D2.detect(frame([{x:80,y:20}]),1/30).length,1,'ball above the player boxes is still searched');
  const lob=Array.from({length:8},(_,i)=>({t:i/30,ballCandidates:[{x:60+i*25,y:20}]}));
  assert.equal(B.track(lob,w,low).length,1,'a flight above both boxes forms a track');
  assert.equal(D2.detect(frame([{x:80,y:157}]),2/30).length,0,'below the feet stays excluded');
}
console.log('Search range above the player boxes passed');
// 明るい空を背景にした暗い赤の球（ロブ）。縮小で赤みが薄れても、背景より暗く赤い点として拾う。
{
  const low=[{x:0,y:100,w:50,h:60},{x:270,y:100,w:50,h:60}];
  const sky=objects=>{const data=frame(objects);for(let i=0;i<data.length;i+=4){if(data[i]===80){data[i]=199;data[i+1]=214;data[i+2]=226;}}return data;};
  const D3=B.createDetector(w,h,low);D3.detect(sky(),0);D3.detect(sky(),1/30);
  assert.equal(D3.detect(sky([{x:120,y:20,color:[150,140,145]}]),2/30).length,1,'dark reddish dot against bright sky above the players is a candidate');
  const D4=B.createDetector(w,h,low);D4.detect(sky(),0);D4.detect(sky(),1/30);
  assert.equal(D4.detect(sky([{x:120,y:150,color:[150,140,145]}]),2/30).length,0,'the same dot low on bright sand is not a candidate');
  const D5=B.createDetector(w,h,low);D5.detect(sky(),0);D5.detect(sky(),1/30);
  assert.equal(D5.detect(sky([{x:120,y:20,color:[140,150,160]}]),2/30).length,0,'a dark dot that is not redder than the sky is ignored');
}
console.log('Sky-contrast lob candidates passed');
// 見失った仮説の持ち越しと予測、原寸の局所探索
{
  const D6=B.createDetector(w,h,regions);D6.detect(frame(),0);
  D6.detect(frame([{x:80,y:50}]),1/30);D6.detect(frame([{x:90,y:50}]),2/30);
  assert.equal(D6.predictions(3/30).length,1,'a moving ball yields a prediction for the next frame');
  D6.detect(frame(),3/30);D6.detect(frame(),4/30);   // 2フレーム見失う
  assert.equal(D6.predictions(5/30).length,1,'the hypothesis is carried through a two-frame miss');
  assert.equal(D6.detect(frame([{x:120,y:50,color:[150,130,145]}]),5/30).length,1,'faint pixels are recovered near the carried prediction');
  D6.detect(frame(),6/30);D6.detect(frame(),7/30);D6.detect(frame(),8/30);D6.detect(frame(),9/30);
  assert.equal(D6.predictions(10/30).length,0,'a hypothesis is dropped after 0.1s without observation');
  const D7=B.createDetector(w,h,regions);D7.detect(frame(),0);D7.detect(frame([{x:80,y:50}]),1/30);D7.detect(frame([{x:90,y:50}]),2/30);
  D7.detect(frame(),3/30);D7.adopt([{x:100,y:50}],3/30);
  const p=D7.predictions(4/30)[0];assert(p&&Math.abs(p.x-110)<1.5,'adopted local observation continues the prediction chain');
  // refineLocal: 原寸窓（60x60）で、動いた赤い塊だけを窓中心に近い順に返す
  const W=60,H=60,blank=()=>{const d=new Uint8ClampedArray(W*H*4);for(let i=0;i<d.length;i+=4){d[i]=d[i+1]=d[i+2]=120;d[i+3]=255;}return d;};
  const put=(d,x,y,size,color)=>{for(let yy=y;yy<y+size;yy++)for(let xx=x;xx<x+size;xx++)d.set([...color,255],(yy*W+xx)*4);return d;};
  const prev=put(blank(),5,5,4,[230,60,60]);                 // 静止した赤い物（前後で同じ位置）
  const now=put(put(blank(),5,5,4,[230,60,60]),28,26,4,[230,60,60]);
  const found=B.refineLocal({data:now,prev,width:W,height:H,origin:{x:1000,y:500},center:{x:1030,y:530}});
  assert.equal(found.length,1,'a moving red blob near the centre is found');assert(Math.abs(found[0].x-1029.5)<1&&Math.abs(found[0].y-527.5)<1,'returned in video coordinates');
  assert.equal(B.refineLocal({data:prev,prev,width:W,height:H,origin:{x:1000,y:500},center:{x:1030,y:530}}).length,0,'a static red object is ignored');
  assert.equal(B.refineLocal({data:now,prev,width:W,height:H,origin:{x:1000,y:500},center:{x:1030,y:530},exclude:[{x:1030,y:528,r:8}]}).length,0,'blobs inside an exclusion circle (wrist) are ignored');
  assert.equal(B.refineLocal({data:put(blank(),20,20,25,[230,60,60]),prev,width:W,height:H,origin:{x:0,y:0},center:{x:30,y:30}}).length,0,'a large moving red object is not a ball');
}
console.log('Prediction carry-over, adopt and full-resolution local refinement passed');

