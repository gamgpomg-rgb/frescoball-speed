'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const ctx={window:{FrescoMotion:{}},document:{getElementById:()=>({addEventListener(){}})}};
vm.runInNewContext(fs.readFileSync(require.resolve('../motion-review.js'),'utf8').replace('return {open,reset', 'return {balls,configure:(s,r)=>{source=s;regions=r;},open,reset'),ctx);
const api=ctx.window.FrescoMotionReview;
api.configure({width:100,height:50},[{x:10,y:10,w:15,h:30},{x:70,y:10,w:20,h:30}]);
function frame(x,y){const data=new Uint8ClampedArray(100*50*4);for(let dx=0;dx<2;dx++)for(let dy=0;dy<2;dy++){const i=((y+dy)*100+x+dx)*4;data[i]=200;data[i+1]=10;data[i+2]=10;}return {width:100,height:50,getContext:()=>({getImageData:()=>({data})}),data};}
const previous=new Uint8ClampedArray(100*50*4),inside=frame(50,20);
assert.equal(api.balls(inside,previous,[]).candidates.length,1,'moving red ball in court remains detectable');
assert.equal(api.balls(frame(5,20),previous,[]).candidates.length,0,'outside pair area is ignored');
assert.equal(api.balls(inside,inside.data,[]).candidates.length,0,'stationary red object is rejected');
assert.equal(api.balls(inside,null,[]).candidates.length,0,'first frame requires motion evidence');
const hand=Array.from({length:33},(_,k)=>({x:50.5,y:20.5,visibility:k===15?1:0}));
assert.equal(api.balls(inside,previous,[hand]).candidates.length,0,'red skin near wrist is rejected');
console.log('Optimized candidate scan retains red motion, court bounds, skin rejection and first-frame safety');
