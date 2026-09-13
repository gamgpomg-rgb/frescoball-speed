'use strict';const assert=require('assert'),S=require('../shot-analysis');
function pose(x){const p=Array.from({length:33},()=>({x:0,y:0,visibility:0}));for(const [i,a,b]of [[11,80,50],[12,120,50],[23,85,120],[24,115,120],[15,100,80],[16,x,80]])p[i]={x:a,y:b,visibility:1,presence:1};return p;}
function frames(x){return [{t:.9,poses:[pose(x-5),[]]},{t:1,poses:[pose(x),[]]},{t:1.1,poses:[pose(x+5),[]]}];}
const e=[{id:'1',t:1,status:'auto',player:'a'}];assert.equal(S.classify(e,frames(155))[0].type,'attack');assert.equal(S.classify(e,frames(108))[0].type,'defense');assert.equal(S.classify(e,frames(125))[0].type,null);assert.equal(S.classify(e,[])[0].type,null);assert.equal(S.classify([{...e[0],shotOverride:'defense'}],[])[0].type,'defense');assert.equal(S.classify([{...e[0],status:'pending'}],frames(155)).length,0);assert.equal(S.summary(S.classify(e,frames(155))).attack,1);
console.log('Shot style estimates: exterior/front, uncertain boundaries, absent poses and manual overrides passed');
const sequence=[{t:.5,status:'confirmed',player:'a'},{t:1,status:'pending',origin:'audio'},{t:1.5,status:'confirmed',player:'a'}];
const alternating=frames(155).map(f=>({...f,poses:[[],f.poses[0]]}));
assert.equal(S.inferAlternation(sequence,alternating,1000)[1].player,'b');
assert.equal(S.inferAlternation(sequence,[],1000)[1].status,'pending');
assert.equal(S.inferAlternation(sequence.map((e,i)=>i===1?{...e,origin:'manual-review'}:e),alternating,1000)[1].status,'pending');
assert.equal(S.inferAlternation(sequence.map((e,i)=>i===2?{...e,player:'b'}:e),alternating,1000)[1].status,'pending');
console.log('Alternation fills a single rhythm-consistent gap only with wrist evidence, preserving manual uncertainty');
