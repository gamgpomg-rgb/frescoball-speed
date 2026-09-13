/* Pixel-space ball candidate tracking. No trained ball model and no metric speed.
 * Predicted association connects only brief, direction-consistent gaps. Display
 * interpolation is marked; extrapolation beyond observations is never shown.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.FrescoBallTracker=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const valid=p=>p&&finite(p.x)&&finite(p.y);
  const MAX_GAP=.12;
  function track(frames,width,regions){
    if(!Array.isArray(frames)||!finite(width)||width<=0)throw new Error('動画の追跡入力が不正です');
    if(!Array.isArray(regions)||regions.length!==2||Array.from(regions).some(r=>!r||![r.x,r.y,r.w,r.h].every(finite)||r.w<=0||r.h<=0))return [];
    const left=Math.max(0,Math.min(...regions.map(r=>r.x))),right=Math.min(width,Math.max(...regions.map(r=>r.x+r.w)));
    const top=Math.max(0,Math.min(...regions.map(r=>r.y-r.h*.2))),bottom=Math.max(...regions.map(r=>r.y+r.h*.95));
    const center=regions.map(r=>({x:r.x+r.w/2,y:r.y+r.h/2})),axis={x:center[1].x-center[0].x,y:center[1].y-center[0].y};
    const separation=Math.hypot(axis.x,axis.y);if(separation<1)return [];
    const inside=p=>valid(p)&&p.x>=left&&p.x<=right&&p.y>=top&&p.y<=bottom;
    const active=[],finished=[];let id=0,lastTime=-Infinity;
    for(const frame of frames){
      if(!frame||!finite(frame.t)||frame.t<=lastTime)throw new Error('追跡フレームは時刻順にしてください');lastTime=frame.t;
      const t=frame.t;
      // Skin near a detected hand/face can inherit the incoming ball track at
      // contact. Prefer a missing point over continuing onto that body part.
      const bodyPoints=(frame.poses||[]).flatMap(ps=>[0,7,8,15,16].map(k=>ps?.[k])).filter(p=>valid(p)&&p.visibility>=.35&&(p.presence==null||p.presence>=.65));
      const points=(frame.ballCandidates||[]).filter(p=>inside(p)&&!bodyPoints.some(b=>Math.hypot(p.x-b.x,p.y-b.y)<width*.012));
      for(let i=active.length-1;i>=0;i--)if(t-active[i].points.at(-1).t>MAX_GAP+1e-9)finished.push(...active.splice(i,1));
      const pairs=[];
      active.forEach((tr,i)=>{
        const b=tr.points.at(-1),a=tr.points.at(-2),dt=t-b.t;if(dt<=0)return;
        const vx=a?(b.x-a.x)/(b.t-a.t):0,vy=a?(b.y-a.y)/(b.t-a.t):0,oldSpeed=Math.hypot(vx,vy);
        points.forEach((p,j)=>{
          const nx=(p.x-b.x)/dt,ny=(p.y-b.y)/dt,speed=Math.hypot(nx,ny);
          if(speed>width*3.5)return;
          if(a&&(oldSpeed<width*.08||speed<oldSpeed*.45||speed>oldSpeed*2.2||(nx*vx+ny*vy)/(speed*oldSpeed)<.25))return;
          const error=Math.hypot(p.x-b.x-vx*dt,p.y-b.y-vy*dt);
          const tolerance=a?width*.018+oldSpeed*dt*.25:width*.16;
          if(error>tolerance)return;
          pairs.push({i,j,cost:error/tolerance+(a?Math.abs(Math.log(speed/oldSpeed))*.15:0)});
        });
      });
      pairs.sort((a,b)=>a.cost-b.cost);const usedTracks=new Set(),usedPoints=new Set();
      for(const pair of pairs){if(usedTracks.has(pair.i)||usedPoints.has(pair.j))continue;
        const p=points[pair.j];active[pair.i].points.push({x:p.x,y:p.y,t,kind:'observed',predicted:false});usedTracks.add(pair.i);usedPoints.add(pair.j);
      }
      points.forEach((p,j)=>{if(!usedPoints.has(j))active.push({id:++id,points:[{x:p.x,y:p.y,t,kind:'observed',predicted:false}]});});
    }
    finished.push(...active);
    return finished.filter(tr=>{
      const ps=tr.points;if(ps.length<4)return false;
      const a=ps[0],b=ps.at(-1),duration=b.t-a.t;let path=0;
      for(let i=1;i<ps.length;i++)path+=Math.hypot(ps[i].x-ps[i-1].x,ps[i].y-ps[i-1].y);
      const net=Math.hypot(b.x-a.x,b.y-a.y),along=Math.abs((b.x-a.x)*axis.x+(b.y-a.y)*axis.y)/separation;
      if(duration<.08||!path||net/path<.65||net/duration<width*.18||along<Math.max(width*.045,separation*.05))return false;
      return ps.some(p=>!regions.some(r=>p.x>=r.x+r.w*.18&&p.x<=r.x+r.w*.82&&p.y>=r.y&&p.y<=r.y+r.h));
    }).map(tr=>{
      const expanded=[];
      for(let i=0;i<tr.points.length;i++){
        const p=tr.points[i],previous=tr.points[i-1];
        if(previous){
          let lo=0,hi=frames.length;while(lo<hi){const m=(lo+hi)>>1;if(frames[m].t<=previous.t+1e-9)lo=m+1;else hi=m;}
          for(let j=lo;j<frames.length&&frames[j].t<p.t-1e-9;j++){const time=frames[j].t,f=(time-previous.t)/(p.t-previous.t);expanded.push({t:time,x:previous.x+(p.x-previous.x)*f,y:previous.y+(p.y-previous.y)*f,kind:'interpolated',predicted:true});}
        }
        expanded.push(p);
      }
      return {id:tr.id,points:expanded,observedCount:tr.points.length,interpolatedCount:expanded.length-tr.points.length};
    });
  }
  function at(tracks,t){
    if(!finite(t))return null;
    const matches=[];
    for(const tr of tracks||[]){
      const ps=tr.points;if(!ps?.length||t<ps[0].t-1e-9||t>ps.at(-1).t+1e-9)continue;
      let lo=0,hi=ps.length;while(lo<hi){const m=(lo+hi)>>1;if(ps[m].t<t)lo=m+1;else hi=m;}
      const b=ps[lo],a=ps[lo-1];let p=null;
      if(b&&Math.abs(b.t-t)<1e-6)p={...b};
      else if(a&&b&&b.t-a.t<=MAX_GAP+1e-9){const f=(t-a.t)/(b.t-a.t);p={t,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,kind:'interpolated',predicted:true};}
      if(!p)continue;
      const trail=ps.filter(q=>q.t>=t-.22&&q.t<=t);if(!trail.length||Math.abs(trail.at(-1).t-t)>1e-6)trail.push(p);
      const span=Math.hypot(ps.at(-1).x-ps[0].x,ps.at(-1).y-ps[0].y);
      matches.push({trackId:tr.id,point:p,trail,predicted:p.predicted,span});
    }
    matches.sort((a,b)=>b.span-a.span);return matches[0]||null;
  }
  return {track,at,maxGapSeconds:MAX_GAP};
});
