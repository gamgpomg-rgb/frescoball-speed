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
  for(let k=6;k<=11;k++)D6.detect(frame(),k/30);
  assert.equal(D6.predictions(11/30).length,1,'the hypothesis is still carried within carrySeconds');
  assert(B.carrySeconds<=.2+1e-9,'carry-over stays at 0.2s or less');
  assert.equal(D6.predictions(12/30).length,0,'a hypothesis is dropped after carrySeconds without observation');
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
// 放物線予測: 直近の観測に等速＋重力の運動モデルを当て、見失った間も山なりに予測する
{
  const g=B.gravityFor(w,regions);assert(g>300&&g<450,'gravity prior from a 7 m player separation');
  assert.equal(B.gravityFor(w,null),0,'no boxes means no gravity assumption');
  // 事前値 g の放物線上の観測から、末尾の位置・速度を当てて0.2秒先まで放物線で進める
  const path=Array.from({length:10},(_,i)=>({t:i/30,x:50+i*10,y:100-60*(i/30)+.5*g*(i/30)**2}));
  const m=B.fitMotion(path,g);assert.equal(m.ay,g,'vertical acceleration is the prior, never fitted from noisy points');
  const pr=B.predict(m,path.at(-1).t+.2),truth={x:50+15*10,y:100-60*.5+.5*g*.5**2};
  assert(Math.hypot(pr.x-truth.x,pr.y-truth.y)<2,'parabolic prediction stays within 2px over 0.2s');
  assert(Math.abs(path.at(-1).y+m.vy*.2-truth.y)>5,'a straight-line prediction would miss by more than 5px');
  assert.equal(B.fitMotion([path[0]],g).vx,null,'a single point has no velocity');
  const exact=B.fitMotion(path.slice(0,2),g);assert(Math.abs(exact.x-path[1].x)<1e-9&&Math.abs(exact.vx-300)<1e-9,'two points give the exact line');
  const back=B.fitMotion(path,g,true);assert(Math.abs(back.t-path[0].t)<1e-9&&Math.abs(back.vy+60)<1e-6,'fromStart anchors the model at the first point with its velocity');
  assert.equal(B.fitMotion(path,0).ay,0,'without boxes the model stays linear');
  // 検出器: 放物線上を飛ぶ球（局所探索の adopt で正確な座標を渡す）を4フレーム見失っても、予測が真の位置に出る
  const D8=B.createDetector(w,h,regions);D8.detect(frame(),0);
  const lob=t=>({x:40+300*t,y:120-90*t+.5*g*t*t});
  for(let i=1;i<=9;i++){D8.detect(frame(),i/30);D8.adopt([lob(i/30)],i/30);}
  for(let i=10;i<=13;i++)D8.detect(frame(),i/30);
  const p14=D8.predictions(14/30)[0],truth14=lob(14/30);
  assert(p14&&Math.hypot(p14.x-truth14.x,p14.y-truth14.y)<1,'carried prediction follows the parabola after a four-frame miss');
  const last=lob(9/30),prev=lob(8/30),linearY=last.y+(last.y-prev.y)*5;
  assert(Math.abs(linearY-truth14.y)>4,'a straight-line carry would have missed by more than 4px');
}
console.log('Parabolic motion model and carried predictions passed');

