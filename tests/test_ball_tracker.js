'use strict';
const assert=require('assert'),B=require('../ball-tracker.js');
const regions=[{x:0,y:0,w:200,h:300},{x:800,y:0,w:200,h:300}];
const sequence=Array.from({length:8},(_,i)=>({t:i*.03,ballCandidates:[{x:250+i*25,y:100},{x:700+i,y:170}]}));
const base=B.track(sequence,1000,regions);assert.equal(base.length,1);assert.equal(base[0].observedCount,8);
assert.equal(B.at(base,.09).point.kind,'observed');assert.equal(B.at(base,.095).predicted,true);
const gaps=sequence.map((f,i)=>({...f,ballCandidates:i===3?[]:f.ballCandidates}));
const joined=B.track(gaps,1000,regions);assert.equal(joined.length,1);assert.equal(B.at(joined,.09).point.kind,'interpolated');
assert.equal(B.at(joined,.09).point.x,325);assert.equal(joined[0].interpolatedCount,1);
assert.equal(B.at(joined,.3),null,'no extrapolation after last observation');
const long=[...sequence.slice(0,4),...sequence.slice(4).map(f=>({...f,t:f.t+.3}))];
const separated=B.track(long,1000,regions);assert.equal(separated.length,2);assert.equal(B.at(separated,.2),null);
const reverse=[...sequence,...Array.from({length:7},(_,i)=>({t:(8+i)*.03,ballCandidates:[{x:400-i*25,y:100}]}))];
const turns=B.track(reverse,1000,regions);assert(turns.length>=2);assert(turns.every(tr=>tr.points.every((p,i,a)=>!i||Math.sign(p.x-a[i-1].x)===Math.sign(a.at(-1).x-a[0].x))),'do not interpolate across a racket reversal');
assert.equal(B.track(sequence,1000,[]).length,0);
assert.throws(()=>B.track([sequence[1],sequence[0]],1000,regions));
console.log('Ball tracker short-gap interpolation, no long-gap extrapolation, reversal splitting and noise rejection passed');
const nearHand=sequence.map((f,i)=>({...f,poses:i===7?[Array.from({length:33},(_,k)=>k===15?{x:425,y:100,visibility:.45,presence:.9}:null)]:[]}));
const noHand=B.track(nearHand,1000,regions);assert.equal(B.at(noHand,.21),null,'do not attach the final point to a partially visible wrist');
console.log('Hand-proximity rejection passed');
{
 const C=require('../ball-tracker');
 assert.equal(C.speedColor(90),'#ffd700');assert.equal(C.speedColor(120),'#ffd700');assert.notEqual(C.speedColor(89.9),'#ffd700');assert.equal(C.speedColor(null),'#c6cad3');assert.equal(C.speedColor(NaN),'#c6cad3');
 const hits=[{t:1,speed:null},{t:1.5,speed:50},{t:2,speed:95},{t:2.5,speed:null}];
 assert.equal(C.speedAt(hits,1.2),50);assert.equal(C.speedAt(hits,1.5),95);assert.equal(C.speedAt(hits,2.2),null);assert.equal(C.speedAt(hits,.5),null);assert.equal(C.speedAt(hits,3),null);assert.equal(C.speedAt([{t:1},{t:1.5,speed:95,qualityExcluded:true}],1.2),null);assert.equal(C.speedAt([{t:1},{t:5,speed:95}],2),null);
 console.log('Trajectory colors use the upcoming impact interval, gold at 90+, and neutral for excluded/missing speeds');
}
{
 const segment=(id,start,x)=>({id,points:Array.from({length:4},(_,i)=>({t:start+i*.03,x:x+i*25,y:100,predicted:false}))});
 const parts=[segment(1,0,250),segment(2,.27,475)],original=JSON.stringify(parts);
 const display=B.displayTracks(parts,[],1000);
 assert.equal(display.length,3);assert.equal(B.at(display,.18).point.kind,'display-bridge');
 assert.equal(JSON.stringify(parts),original,'display interpolation cannot alter measured tracks');
 assert.equal(B.at(parts,.18),null,'contact evidence remains missing');
 assert.equal(B.displayTracks(parts,[{t:.18,status:'pending'}],1000).length,2,'never bridge a potential impact');
 assert.equal(B.displayTracks(parts,[{t:.18,status:'ignored'}],1000).length,3);
 assert.equal(B.at(display,.5),null,'no extrapolation past observed endpoints');
 assert.equal(B.displayTracks([parts[0],segment(2,.5,667)],[],1000).length,2,'long gaps stay missing');
 const reversed=segment(2,.27,475);reversed.points.forEach((p,i)=>p.x=475-i*25);
 assert.equal(B.displayTracks([parts[0],reversed],[],1000).length,2,'no bridge across reversal');
 assert.equal(B.displayTracks([...parts,segment(3,.27,480)],[],1000).length,3,'ambiguous continuations stay missing');
 console.log('Display-only gap bridges preserve impact evidence, reject reversal and ambiguity, and never extrapolate');
}
{
 const tr={id:1,points:Array.from({length:5},(_,i)=>({t:.1+i*.03,x:300+i*25,y:100,predicted:false}))};
 const poses=[Array.from({length:33},(_,k)=>({x:225,y:100,visibility:k===16?1:0})),[]];
 const frames=[{t:.01,poses}],event={t:.01,status:'auto',player:'a'};
 const out=B.displayTracks([tr],[event],1000,frames);
 assert.equal(B.at(out,.05).predicted,true);assert.equal(out[1].points[0].kind,'contact-display-estimate');
 assert.equal(B.at([tr],.05),null,'contact estimate does not become measured ball evidence');
 assert.equal(B.displayTracks([tr],[{...event,status:'pending'}],1000,frames).length,1,'unknown hitter cannot anchor contact');
 assert.equal(B.displayTracks([tr],[event],1000,[]).length,1,'no wrist means no invented contact path');
 assert.equal(B.at(out,-.01),null);
 console.log('Short contact display estimates require a known hitter and a visible, direction-consistent wrist');
}
{
 const segment=(id,t,x)=>({id,points:Array.from({length:4},(_,i)=>({t:t+i*.03,x:x+i*25,y:100,predicted:false}))});
 const parts=[segment(1,.1,100),segment(2,.7,600)];
 const hits=[{t:0,status:'auto',player:'a',speed:55},{t:.85,status:'auto',player:'b',speed:60}];
 const before=JSON.stringify({parts,hits});
 const display=B.displayTracks(parts,hits,1000);
 assert.equal(display.length,3,'reconstruct a long gap inside one audio flight');
 const middle=B.at(display,.445);
 assert(middle?.predicted);assert(Math.abs(middle.point.x-387.5)<.001);
 assert.equal(JSON.stringify({parts,hits}),before,'audio speeds, counts and measured evidence are immutable');
 assert.equal(B.at(parts,.445),null);
 assert.equal(B.at(display,.05),null);assert.equal(B.at(display,.81),null);
 assert.equal(B.displayTracks(parts,[],1000).length,2,'no long bridge without audio boundaries');
 assert.equal(B.displayTracks(parts,[hits[0]],1000).length,2,'no reconstruction without the arrival impact');
 assert.equal(B.displayTracks(parts,[...hits,{t:.4,status:'pending'}],1000).length,2,'never cross a possible impact');
 const offLine=segment(2,.7,600);offLine.points.forEach(p=>p.y=300);
 assert.equal(B.displayTracks([parts[0],offLine],hits,1000).length,2,'reject sideways displacement');
 const reverse=segment(2,.7,600);reverse.points.forEach((p,i)=>p.x=600-i*25);
 assert.equal(B.displayTracks([parts[0],reverse],hits,1000).length,2,'reject reversed direction');
 assert.equal(B.displayTracks([...parts,segment(3,.7,605)],hits,1000).length,3,'ambiguous endpoints stay missing');
 assert.equal(B.speedAt(hits,.445),60);
 console.log('Whole-flight display reconstruction: bounded audio interval, ambiguity and reversal rejection, unchanged measurements');
}
