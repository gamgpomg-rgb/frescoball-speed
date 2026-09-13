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

{
  // 打音マーカー: 打音±0.25秒以内の観測点がある打音だけ、0.7秒間だけ位置を返す
  const seq=Array.from({length:8},(_,i)=>({t:i*.03,ballCandidates:[{x:250+i*25,y:100}]}));
  const tr=B.track(seq,1000,regions);
  const marks=B.impactMarkers([{t:.2,status:'auto'},{t:1.5,status:'auto'},{t:.1,status:'ignored'}],tr,.3);
  assert.equal(marks.length,1,'only unignored hits with a nearby observed point, within the display window');
  assert(Math.abs(marks[0].x-416.7)<.5,'nearest observed point, moved back along the track to the hit time');
  assert.equal(B.impactMarkers([{t:.2,status:'auto'}],tr,1.2).length,0,'marker disappears after impactSeconds');
  assert.equal(B.impactMarkers([{t:.6,status:'auto'}],tr,.7).length,0,'no track end near the hit means no marker');
  const longFlight=B.track(Array.from({length:20},(_,i)=>({t:i*.03,ballCandidates:[{x:250+i*20,y:100}]})),1000,regions);
  assert.equal(B.impactMarkers([{t:.3,status:'auto'}],longFlight,.4).length,0,'a hit in the middle of a flight (no track end within 0.12s) gets no marker');
  console.log('Impact markers follow audio time and observed positions only');
}

{
  // 残像: 直近 trailSeconds の点を追跡ごとに返し、窓の外や未来の点は含めない
  const a=Array.from({length:8},(_,i)=>({t:i*.03,ballCandidates:[{x:250+i*25,y:100}]}));
  const b=Array.from({length:8},(_,i)=>({t:1+i*.03,ballCandidates:[{x:700-i*25,y:120}]}));
  const tr=B.track([...a,...b],1000,regions);assert.equal(tr.length,2);
  const runs=B.trailRuns(tr,1.1,1.2);   // 窓を明示（既定の残り時間は調整されうる）
  assert.equal(runs.length,2,'both flights inside the window are kept as separate runs');
  assert(runs.every(r=>r.points.every(p=>p.t<=1.1)),'no future points');
  assert.equal(B.trailRuns(tr,3.5,1.2).length,0,'old flights fade out of the window');
  assert(B.trailSeconds>0&&B.trailSeconds<=2,'default trail lifetime stays within the tuned range');
  assert.equal(B.trailRuns(tr,1.1,.5).length,1,'a shorter window keeps only the current flight');
  console.log('Multi-flight trail window passed');
}

{
  // 放物線の橋渡し: 山なりの返球が途中で欠測しても、選手枠から換算した重力で弧としてつなぐ
  const g=B.gravityFor(1000,regions);assert(g>1000&&g<1200,'gravity prior from the 800px player separation');
  const lob=t=>({t,x:250+900*t,y:300-700*t+.5*g*t*t});   // 打ち上げてから落ちる（画像座標は下向きが正）
  const early=Array.from({length:5},(_,i)=>lob(.1+i/30)),late=Array.from({length:5},(_,i)=>lob(.5+i/30));
  const parts=[{id:1,points:early.map(p=>({...p,predicted:false}))},{id:2,points:late.map(p=>({...p,predicted:false}))}];
  const hits=[{t:.05,status:'auto',player:'a',speed:50},{t:.7,status:'auto',player:'b',speed:55}];
  const display=B.displayTracks(parts,hits,1000,[],regions);
  assert.equal(display.length,3,'a lob with a long gap inside one flight is bridged when the boxes give the gravity scale');
  const mid=B.at(display,.4),truth=lob(.4);
  assert(mid?.predicted&&Math.abs(mid.point.y-truth.y)<4,'the bridge follows the parabola');
  const a=early.at(-1),b=late[0],chordY=a.y+(b.y-a.y)*(.4-a.t)/(b.t-a.t);
  assert(Math.abs(chordY-truth.y)>6,'the straight chord would have missed the arc');
  assert.equal(B.at(parts,.4),null,'measured tracks are untouched');
  // 追跡の欠測補間も放物線: 1フレーム欠けた山なりの飛行の補間点が弧の上に乗る
  const frames=Array.from({length:8},(_,i)=>({t:.1+i/30,ballCandidates:i===4?[]:[lob(.1+i/30)]}));
  const tr=B.track(frames,1000,regions);assert.equal(tr.length,1);
  const gap=tr[0].points.find(p=>p.kind==='interpolated');assert(gap&&Math.abs(gap.y-lob(gap.t).y)<2,'interpolated point lies on the arc');
  console.log('Parabolic display bridge and gap interpolation passed');
}
