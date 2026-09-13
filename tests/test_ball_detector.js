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

