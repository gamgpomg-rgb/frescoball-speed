/* Experimental screen-space shot style estimates; never a radar/contact measurement. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.FrescoShots=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
'use strict';
const visible=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.visibility>=.65&&(p.presence==null||p.presence>=.65);
const median=xs=>{const a=xs.slice().sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
function nearest(frames,t){let l=0,r=frames.length;while(l<r){const m=(l+r)>>1;if(frames[m].t<t)l=m+1;else r=m;}return [frames[l],frames[l-1]].filter(f=>f&&Math.abs(f.t-t)<=.15).sort((a,b)=>Math.abs(a.t-t)-Math.abs(b.t-t))[0];}
function geometry(p,k){
 if(![11,12,23,24,k].every(i=>visible(p?.[i])))return null;
 const sx=(p[11].x+p[12].x)/2,sy=(p[11].y+p[12].y)/2,hx=(p[23].x+p[24].x)/2,hy=(p[23].y+p[24].y)/2;
 const dx=sx-hx,dy=sy-hy,h=Math.hypot(dx,dy);if(h<12)return null;
 const w=Math.max(Math.hypot(p[11].x-p[12].x,p[11].y-p[12].y),h*.45);
 const signed=((p[k].x-sx)*(-dy/h)+(p[k].y-sy)*(dx/h))/w;
 const shoulder=p[k===15?11:12],ownSide=(shoulder.x-sx)*(-dy/h)+(shoulder.y-sy)*(dx/h);
 return {lateral:Math.abs(signed),ownSide:Math.abs(ownSide)>w*.15?Math.sign(ownSide)*signed:null,height:((p[k].x-hx)*dx+(p[k].y-hy)*dy)/(h*h),x:(p[k].x-sx)/h,y:(p[k].y-sy)/h};
}
function observations(events,frames){
 return (events||[]).filter(e=>['auto','confirmed'].includes(e.status)&&['a','b'].includes(e.player)).map(e=>{
  if(['attack','defense'].includes(e.shotOverride))return {id:e.id,t:e.t,player:e.player,type:e.shotOverride,basis:'manual'};
  const side=e.player==='a'?0:1,before=nearest(frames,e.t-.1),after=nearest(frames,e.t+.1),center=nearest(frames,e.t);
  const base={id:e.id,t:e.t,player:e.player,type:null,basis:'insufficient-pose'};
  if(!before||!after||!center||after.t<=before.t)return base;
  const wrists=[15,16].map(k=>{const a=geometry(before.poses[side],k),b=geometry(after.poses[side],k);return {k,movement:a&&b?Math.hypot(b.x-a.x,b.y-a.y):-1};}).sort((a,b)=>b.movement-a.movement);
  if(wrists[0].movement<.04)return base;
  const chosen=wrists[0];if(wrists[1].movement>0&&chosen.movement<wrists[1].movement*1.2)return {...base,basis:'both-arms-moving'};
  const values=[before,center,after].map(f=>geometry(f.poses[side],chosen.k)).filter(Boolean);
  if(values.length<2)return base;const lateral=median(values.map(g=>g.lateral)),height=median(values.map(g=>g.height));
  if(height<-.2||height>1.65)return {...base,basis:'outside-stroke-height'};
  // Shoulder-relative position is a 2D approximation. A side-on view can hide depth.
  const sides=values.map(g=>g.ownSide).filter(v=>v!=null),ownSide=sides.length>=2?median(sides):null;
  const type=lateral<=.52?'defense':ownSide!=null&&ownSide<=-.52?'defense':ownSide!=null&&ownSide>=.72?'attack':null;
  return {...base,type,basis:type?'body-wrist-position-v1':'boundary-position',lateral,hand:chosen.k===15?'left':'right'};
 });
}
// Two complementary roles within a rally. Pose observations anchor the roles;
// switching has a small cost so isolated noisy frames do not flip both players.
// Manual corrections are hard constraints. Missing evidence alone never anchors a rally.
function resolveRoles(items){
 const out=items.map(e=>({...e,observedType:e.type}));
 const role=(state,player)=>(state===0)===(player==='a')?'attack':'defense';
 let first=0;
 while(first<out.length){
  let end=first+1;
  while(end<out.length&&out[end].t-out[end-1].t<=2&&!out[end].roleBreak)end++;
  const segment=out.slice(first,end);
  if(segment.some(e=>e.type)){
   const costs=[],parents=[];
   segment.forEach((e,i)=>{
    const emission=state=>!e.type||role(state,e.player)===e.type?0:e.basis==='manual'?1e9:2;
    costs[i]=[0,1].map(state=>{
     if(!i)return emission(state);
     const stay=costs[i-1][state],swap=costs[i-1][1-state]+1.25;
     (parents[i]??=[])[state]=stay<=swap?state:1-state;
     return Math.min(stay,swap)+emission(state);
    });
   });
   let state=costs.at(-1)[0]<=costs.at(-1)[1]?0:1;
   for(let i=segment.length-1;i>=0;i--){
    const e=out[first+i],type=role(state,e.player);
    e.type=type;e.roles={a:role(state,'a'),b:role(state,'b')};
    if(e.basis!=='manual')e.basis=type===e.observedType?'pose-and-pair-role-v2':'pair-role-estimate-v2';
    if(i)state=parents[i][state];
   }
  }
  first=end;
 }
 return out;
}
function classify(events,frames){
 const ordered=(events||[]).slice().sort((a,b)=>a.t-b.t),items=[];let interrupted=true;
 for(const e of ordered){
  if(e.status==='ignored')continue;
  if(!['auto','confirmed'].includes(e.status)||!['a','b'].includes(e.player)){interrupted=true;continue;}
  const item=observations([e],frames)[0];item.roleBreak=interrupted;items.push(item);interrupted=false;
 }
 return resolveRoles(items);
}
function inferAlternation(events,frames,width){
 const ordered=events.slice().sort((a,b)=>a.t-b.t),accepted=e=>e&&['auto','confirmed'].includes(e.status)&&['a','b'].includes(e.player);
 return ordered.map((event,i)=>{
  if(event.status!=='pending'||['manual','manual-review'].includes(event.origin))return event;
  const a=ordered[i-1],b=ordered[i+1];if(!accepted(a)||!accepted(b)||a.player!==b.player)return event;
  const left=event.t-a.t,right=b.t-event.t;
  if(Math.min(left,right)<.2||Math.max(left,right)>1.2||Math.max(left,right)/Math.min(left,right)>1.65)return event;
  const side=a.player==='a'?1:0,p=nearest(frames,event.t-.1),q=nearest(frames,event.t+.1);
  if(!p||!q||q.t<=p.t)return event;
  const moves=[15,16].some(k=>{const x=p.poses?.[side]?.[k],y=q.poses?.[side]?.[k];return visible(x)&&visible(y)&&Math.hypot(y.x-x.x,y.y-x.y)/(q.t-p.t)>width*.03;});
  if(!moves)return event;
  const player=side?'b':'a';return {...event,player,status:'auto',suggestedPlayer:player,reviewRequired:true,provenance:'rally-alternation-estimate-v1',reviewReason:'前後の打者とラリー間隔、腕の動きからの仮判定です。接触は未確認です'};
 });
}
function summary(items){const attack=items.filter(e=>e.type==='attack').length,defense=items.filter(e=>e.type==='defense').length;return {attack,defense,classified:attack+defense,total:items.length,byPlayer:Object.fromEntries(['a','b'].map(player=>[player,{attack:items.filter(e=>e.player===player&&e.type==='attack').length,defense:items.filter(e=>e.player===player&&e.type==='defense').length}]))};}
return {classify,summary,inferAlternation,resolveRoles};
});
