'use strict';
const assert=require('assert');
const M=require('../motion-core.js');
const event=(t,player,status='confirmed')=>({t,player,status});
assert.equal(M.speeds([event(0,'a'),event(.5,'b')],7)[1].averageKmh,50.4);
assert.equal(M.speeds([event(0,'a'),event(.5,'b')],10)[1].averageKmh,72);
assert.equal(M.speeds([event(0,'a'),{...event(.5,'b'),distanceM:8}],10)[1].usedDistanceM,8);
assert.equal(M.speeds([event(0,'a'),event(.5,'a')],7)[1].averageKmh,null);
assert.equal(M.speeds([event(0,'a'),event(.25,null,'pending'),event(.5,'b')],7)[2].averageKmh,null);
assert.equal(M.speeds([event(0,'a'),event(.25,null,'ignored'),event(.5,'b')],7)[1].averageKmh,50.4);
assert.equal(M.speeds([event(0,'a'),event(0,'b')],7)[1].averageKmh,null);
for(const t of [NaN,Infinity,-1,'0.5'])assert.throws(()=>M.speeds([event(0,'a'),event(t,'b')],7));
for(const distance of ['',0,-1,Infinity,NaN,true,[],{},101])assert.throws(()=>M.distance(distance));
const p=(x,y,visibility=1)=>({x,y,visibility});
const pose=Array.from({length:33},()=>p(0,0));
pose[11]=p(10,10);pose[13]=p(10,20);pose[15]=p(20,20);
assert.equal(M.posture(pose).leftElbow,90);
pose[13].visibility=.2;assert.equal(M.posture(pose).leftElbow,null);
const frames=[0,.06,.12,.18].map((t,i)=>({t,poses:[[],[]],ballCandidates:[p(100+i*15,100),p(600,200)]}));
const tracks=M.track(frames,1000);assert.equal(tracks.length,1,'stationary marks must be excluded');
assert.equal(tracks[0].points.length,4);
assert.equal(M.nearestFrame(frames,2),null);
frames.forEach(f=>{f.poses[0]=Array.from({length:33},()=>p(0,0,0));f.poses[0][15]=p(130,100);});
const checked=M.evidence([event(.12,null,'pending')],frames,tracks,1000)[0];
assert.equal(checked.suggestedPlayer,'a');assert.equal(checked.status,'pending');assert.equal(checked.player,null,'a suggestion must not confirm the hitter');
const source={name:'test.mov',size:100,width:1000,height:500,duration:4};
const data={schema:'frescoball-motion-v1',source,frames:[{t:0,poses:[[],[]],ballCandidates:[]}],settings:{distanceM:8},events:[event(.5,'b')]};
assert.equal(M.normalize(data,source).settings.distanceM,8);
for(const change of [{name:'other.mov'},{size:101},{width:900},{duration:5}])assert.throws(()=>M.normalize({...data,source:{...source,...change}},source));
assert.throws(()=>M.normalize({...data,frames:[data.frames[0],data.frames[0]]},source));
assert.throws(()=>M.normalize({...data,events:{}},source));
assert.throws(()=>M.normalize({...data,events:[null]},source));
assert.throws(()=>M.normalize({...data,frames:[null]},source));
assert.throws(()=>M.normalize(null,source));
console.log('Motion core distance, confirmation boundaries, track filtering and import validation passed');

const regions=[{x:0,y:0,w:100,h:200},{x:900,y:300,w:100,h:200}];
assert.deepEqual(M.normalize({...data,regions},source).regions,regions);
assert.deepEqual(M.normalize(data,source).regions,[]);
assert.deepEqual(M.normalize({...data,regions:[]},source).regions,[]);
for(const invalidRegions of [[regions[0]],{},[regions[0],null],[regions[0],{x:901,y:300,w:100,h:200}],[regions[0],{x:0,y:0,w:0,h:20}],[regions[0],{x:NaN,y:0,w:20,h:20}],[regions[0],{x:0,y:-1,w:20,h:20}],new Array(2)])assert.throws(()=>M.normalize({...data,regions:invalidRegions},source));
console.log('Motion region import round-trip and bounds validation passed');

// A synthetic hit has a fast ball reversal at a moving wrist. Both players'
// torsos and the other player's wrist are visible; colour proximity alone fails.
function autoFixture(at,side='a') {
  const sideIndex=side==='a'?0:1,target=sideIndex?700:100;
  const points=[{t:at-.06,x:target+30,y:100},{t:at,x:target,y:100},{t:at+.06,x:target+30,y:100}];
  const frames=points.map((ball,i)=>({t:ball.t,poses:[0,1].map(s=>{
    const ps=Array.from({length:33},()=>p(0,0,0));
    for(const k of [11,12,23,24])ps[k]=p(s?700:100,150);
    ps[15]=p(s===sideIndex?target+(i-1)*10:(s?700:100),100);
    return ps;
  }),ballCandidates:[ball]}));
  return {frames,tracks:[{points}]};
}
const first=autoFixture(.12);
const automatically=M.autoReview([event(.12,null,'pending')],first.frames,first.tracks,1000,7);
assert.equal(automatically[0].status,'auto');assert.equal(automatically[0].player,'a');
assert.equal(automatically[0].provenance,'motion-ball-wrist-v2');
const noSecond=first.frames.map(f=>({...f,poses:[f.poses[0],[]]}));
assert.equal(M.autoReview([event(.12,null,'pending')],noSecond,first.tracks,1000,7)[0].status,'pending');
const noMotion=first.frames.map(f=>({...f,poses:f.poses.map(ps=>ps.map((point,k)=>k===15?{...point,x:100}:point))}));
assert.equal(M.autoReview([event(.12,null,'pending')],noMotion,first.tracks,1000,7)[0].status,'pending');
const straight=[{points:first.tracks[0].points.map((point,i)=>({...point,x:70+i*30}))}];
assert.equal(M.autoReview([event(.12,null,'pending')],first.frames,straight,1000,7)[0].status,'pending');
assert.equal(M.autoReview([event(5,null,'pending')],first.frames,first.tracks,1000,7)[0].status,'pending');
const second=autoFixture(.62,'b');
const bothFrames=first.frames.concat(second.frames),bothTracks=first.tracks.concat(second.tracks);
const pair=M.autoReview([event(.12,null,'pending'),event(.62,null,'pending')],bothFrames,bothTracks,1000,7);
assert.deepEqual(pair.map(e=>e.status),['auto','auto']);
assert.equal(M.speeds(pair,7)[1].averageKmh,50.4);
const sameSide=autoFixture(.62,'a');
const conflict=M.autoReview([event(.12,null,'pending'),event(.62,null,'pending')],first.frames.concat(sameSide.frames),first.tracks.concat(sameSide.tracks),1000,7);
assert.deepEqual(conflict.map(e=>e.status),['pending','pending']);
const manual={...event(.12,'a'),evidence:'manually checked'};
assert.deepEqual(M.autoReview([manual,event(.2,'b','ignored')],[],[],1000,7),[manual,event(.2,'b','ignored')]);
const autoRecord=M.normalize({...data,events:pair},source);
assert.equal(autoRecord.events[0].status,'auto');
assert.equal(autoRecord.events[0].provenance,'motion-ball-wrist-v2');
assert.equal(autoRecord.events[0].suggestedPlayer,'a');
console.log('Automatic review requires ball reversal, wrist movement and both targets; manual decisions preserved');

const splitFixture=autoFixture(1);
const splitTracks=[{points:[{t:.82,x:190,y:100},{t:.88,x:160,y:100},{t:.94,x:130,y:100}]},{points:[{t:1.06,x:130,y:100},{t:1.12,x:160,y:100},{t:1.18,x:190,y:100}]}];
const connected=M.autoReview([event(1,null,'pending')],splitFixture.frames,splitTracks,1000,7);
assert.equal(connected[0].status,'auto');assert.match(connected[0].evidence,/分かれた/);
const mismatch=splitTracks.map((tr,i)=>({points:tr.points.map(p=>({...p,y:i?220:100}))}));
assert.equal(M.autoReview([event(1,null,'pending')],splitFixture.frames,mismatch,1000,7)[0].status,'pending');
const noReverse=[splitTracks[0],{points:splitTracks[1].points.map((p,i)=>({...p,x:130-i*30}))}];
assert.equal(M.autoReview([event(1,null,'pending')],splitFixture.frames,noReverse,1000,7)[0].status,'pending');
assert.equal(M.autoReview([event(1,null,'pending')],splitFixture.frames,[splitTracks[0]],1000,7)[0].status,'pending');
console.log('Separate sustained track convergence accepted; missing, mismatched and straight tracks rejected');
{
 const P=require('../measurement-spec');
 for(const length of [7,8.5,10])for(const dt of [.25,.5,.8]){
  const hits=[{t:0},{t:dt}],events=[event(0,'a'),event(dt,'b')];
  const actual=M.estimatedSpeeds(events,length,{values:{distance:String(length)}},P,hits)[1];
  const expected=P.measureInterval({observedSeconds:dt,lengthM:length});
  assert.equal(actual.speed,expected.accepted?expected.initialSpeedKmh:null,'audio and motion use identical initial speed');
 }
 const hits=[{t:0},{t:.5},{t:1}],settings={values:{micPos:'near',firstOnsetSide:'near'}};
 const actual=M.estimatedSpeeds([event(.5,'b'),event(1,'a')],7,settings,P,hits)[1];
 assert.equal(actual.speed,P.measureInterval({observedSeconds:.5,lengthM:7,pairStartIndex:1,micPosition:'near',firstOnsetSide:'near'}).initialSpeedKmh,'use original audio onset side rather than selected-player order');
 assert.equal(M.estimatedSpeeds([event(.4,'a'),event(.9,'b')],7,settings,P,hits)[1].speed,null,'unknown manual microphone side cannot fabricate a corrected speed');
 const slow=M.estimatedSpeeds([event(0,'a'),event(1.5,'b')],7,{},P);
 assert.equal(slow.length,2);assert.equal(slow[1].speed,null,'slow contact remains counted without a speed');
 console.log('Unified initial speed, distance changes, microphone direction and count versus speed acceptance passed');
}
