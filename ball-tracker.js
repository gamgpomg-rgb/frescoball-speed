/* Pixel-space ball candidate tracking. No trained ball model and no metric speed.
 * Predicted association connects only brief, direction-consistent gaps. Display
 * interpolation is marked. Optional display estimates can connect a short
 * gap to a visible hitter wrist, without altering measured tracks.
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
  // Display-only bridges between independently sustained tracks. Never feed
  // these points into contact or speed estimation; no endpoint extrapolation.
  function displayTracks(tracks,events,width,frames=[]){
    if(!finite(width)||width<=0)return tracks||[];
    const result=(tracks||[]).slice(),observed= result.map(tr=>({id:tr.id,points:tr.points.filter(p=>!p.predicted)})).filter(tr=>tr.points.length>=4);
    const blocked=(a,b)=>(events||[]).some(e=>e.status!=='ignored'&&finite(e.t)&&e.t>a-.02&&e.t<b+.02);
    const used=new Set();
    for(const from of observed){
      const a=from.points.at(-1),pa=from.points.at(-2),dtA=a.t-pa.t;
      if(dtA<=0)continue;
      const vx=(a.x-pa.x)/dtA,vy=(a.y-pa.y)/dtA,speed=Math.hypot(vx,vy);
      const candidates=observed.filter(to=>{
        if(to===from||used.has(to.id))return false;
        const b=to.points[0],pb=to.points[1],gap=b.t-a.t,dtB=pb.t-b.t;
        if(gap<=.03||gap>.24||dtB<=0||blocked(a.t,b.t))return false;
        const ux=(pb.x-b.x)/dtB,uy=(pb.y-b.y)/dtB,nextSpeed=Math.hypot(ux,uy);
        if(speed<width*.18||nextSpeed<speed*.65||nextSpeed>speed*1.5||(vx*ux+vy*uy)/(speed*nextSpeed)<.9)return false;
        return Math.hypot(b.x-a.x-vx*gap,b.y-a.y-vy*gap)<width*.035&&Math.hypot(a.x-b.x+ux*gap,a.y-b.y+uy*gap)<width*.035;
      });
      if(candidates.length!==1)continue;
      const to=candidates[0],b=to.points[0],count=Math.ceil((b.t-a.t)*30),points=[a];used.add(to.id);
      for(let i=1;i<count;i++){const f=i/count;points.push({t:a.t+(b.t-a.t)*f,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,predicted:true,kind:'display-bridge'});}
      points.push({...b,predicted:true,kind:'display-bridge'});
      result.push({id:`bridge-${from.id}-${to.id}`,displayOnly:true,points});
    }
    // Near contact, the ball often merges with the racket/hand. A short line
    // toward a visible hitter wrist is an explicit display estimate, not a detection.
    for(const tr of observed)for(const start of [true,false]){
      const p=start?tr.points[0]:tr.points.at(-1),q=start?tr.points[1]:tr.points.at(-2),dt=q.t-p.t;
      if(!dt)continue;const vx=(q.x-p.x)/dt,vy=(q.y-p.y)/dt,speed=Math.hypot(vx,vy);
      if(speed<width*.18)continue;
      const contacts=[];
      for(const e of events||[]){
        const delta=e.t-p.t;
        if(!['auto','confirmed'].includes(e.status)||!['a','b'].includes(e.player)||!finite(e.t)||Math.abs(delta)<.02||Math.abs(delta)>.18||(start?delta>=0:delta<=0))continue;
        if((events||[]).some(other=>other!==e&&other.status!=='ignored'&&other.t>Math.min(e.t,p.t)&&other.t<Math.max(e.t,p.t)))continue;
        let lo=0,hi=frames.length;while(lo<hi){const m=(lo+hi)>>1;if(frames[m].t<e.t)lo=m+1;else hi=m;}
        const frame=[frames[lo],frames[lo-1]].filter(f=>f&&Math.abs(f.t-e.t)<=.08&&Math.abs((f.poseSampleTime??f.t)-e.t)<=.15).sort((a,b)=>Math.abs(a.t-e.t)-Math.abs(b.t-e.t))[0];
        const ps=frame?.poses?.[e.player==='a'?0:1];
        const wrists=[15,16].map(k=>ps?.[k]).filter(w=>valid(w)&&w.visibility>=.65&&(w.presence==null||w.presence>=.65)).map(w=>({w,error:Math.hypot(w.x-p.x-vx*delta,w.y-p.y-vy*delta)})).filter(c=>c.error<width*.03).sort((a,b)=>a.error-b.error);
        if(!wrists.length||wrists[1]&&wrists[1].error-wrists[0].error<width*.008)continue;
        const w=wrists[0].w,ux=(w.x-p.x)/delta,uy=(w.y-p.y)/delta,ws=Math.hypot(ux,uy);
        if(ws<speed*.65||ws>speed*1.5||(ux*vx+uy*vy)/(ws*speed)<.9)continue;
        contacts.push({t:e.t,x:w.x,y:w.y});
      }
      if(contacts.length!==1)continue;
      const contact=contacts[0],a=start?contact:p,b=start?p:contact,count=Math.ceil((b.t-a.t)*30),points=[];
      for(let i=0;i<=count;i++){const f=i/count;points.push({t:a.t+(b.t-a.t)*f,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,predicted:true,kind:'contact-display-estimate'});}
      result.push({id:`contact-${tr.id}-${start}`,displayOnly:true,points});
    }
    return result;
  }
  function speedAt(hits,t){
    if(!Array.isArray(hits)||!finite(t))return null;
    let lo=0,hi=hits.length;while(lo<hi){const m=(lo+hi)>>1;if(hits[m].t<=t)lo=m+1;else hi=m;}
    const before=hits[lo-1],after=hits[lo];
    if(!before||!after||after.t-before.t<=0||after.t-before.t>2||after.qualityExcluded||!finite(after.speed)||after.speed<=0)return null;
    return after.speed;
  }
  function speedColor(speed){
    if(!finite(speed)||speed<=0)return '#c6cad3';
    if(speed>=90)return '#ffd700';
    const stops=[[30,[65,115,255]],[45,[40,205,245]],[60,[40,218,161]],[70,[241,223,70]],[80,[255,142,48]],[89.999,[255,72,77]]];
    if(speed<=30)return '#4173ff';
    for(let i=1;i<stops.length;i++)if(speed<=stops[i][0]){const a=stops[i-1],b=stops[i],f=(speed-a[0])/(b[0]-a[0]);return '#'+a[1].map((n,j)=>Math.round(n+(b[1][j]-n)*f).toString(16).padStart(2,'0')).join('');}
    return '#ff484d';
  }
  return {track,at,displayTracks,speedAt,speedColor,maxGapSeconds:MAX_GAP};
});
