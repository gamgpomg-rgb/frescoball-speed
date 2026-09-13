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
  // Colour and temporal evidence only. All returned points are visible pixels;
  // a motion prediction narrows the search but never creates a ball position.
  function createDetector(width,height,regions){
    let previous=null,background=null,lastTime=null,hypotheses=[];
    const x0=Math.max(1,Math.floor(Math.min(...regions.map(r=>r.x)))),x1=Math.min(width-2,Math.ceil(Math.max(...regions.map(r=>r.x+r.w))));
    // 縦の探索範囲は画面上端から選手の足元まで。以前は「枠の上端−15%」で止めていたため、
    // 頭〜膝の狭い枠を引くと山なりの球が枠より上を飛ぶ区間で候補が消え、軌跡が分断された
    // （IMG_9997 98.5〜102.5s で再現。広い枠では全返球を追跡できていた）。
    const y0=1,y1=Math.min(height-2,Math.ceil(Math.max(...regions.map(r=>r.y+r.h*.92))));
    return {detect(data,t,poses=[]){
      if(!previous||lastTime==null||t<=lastTime||t-lastTime>.15){previous=new Uint8ClampedArray(data);background=Float32Array.from(data);lastTime=t;hypotheses=[];return [];}
      const dt=t-lastTime,predictions=hypotheses.filter(q=>q.count>=2&&q.vx!=null&&t-q.t<=.1).map(q=>({x:q.x+q.vx*(t-q.t),y:q.y+q.vy*(t-q.t),radius:Math.max(5,width*.015)}));
      const mask=new Uint8Array(width*height),found=[];
      const limbs=poses.flatMap(ps=>[[13,15],[14,16],[23,25],[24,26],[25,27],[26,28]].map(([a,b])=>[ps?.[a],ps?.[b]])).filter(pair=>pair.every(p=>p&&p.visibility>.65));
      const body=poses.flatMap(ps=>[0,7,8,11,12,13,14,15,16,23,24,25,26,27,28].map(k=>ps?.[k])).filter(p=>p&&p.visibility>.65);
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],chroma=Math.max(r,g,b)-Math.min(r,g,b);
        const delta=Math.abs(r-previous[i])+Math.abs(g-previous[i+1])+Math.abs(b-previous[i+2]);
        const bgDelta=Math.abs(r-background[i])+Math.abs(g-background[i+1])+Math.abs(b-background[i+2]);
        for(let k=0;k<3;k++)background[i+k]+=(data[i+k]-background[i+k])*.04;
        const red=r>=95&&r>=g*1.45&&r>=b*1.25&&r-g>=38;
        const pink=r>=100&&r>=b*.95&&r-g>=28&&b-g>=18&&chroma/Math.max(1,r,g,b)>=.2;
        const weak=r>=80&&r>=b*.9&&r-g>=15&&b>=g&&chroma/Math.max(1,r,g,b)>=.1;
        if(!red&&!pink&&!weak)continue;
        const inPlayer=regions.some(q=>x>=q.x&&x<=q.x+q.w&&y>=q.y&&y<=q.y+q.h);
        const strong=red||(!inPlayer&&pink);
        const near=!inPlayer&&predictions.some(p=>(p.x-x)**2+(p.y-y)**2<p.radius**2);
        if(!(strong&&delta>=45&&bgDelta>=35)&&!(near&&weak&&delta>=22&&bgDelta>=24))continue;
        if(body.some(p=>(p.x-x)**2+(p.y-y)**2<(width*.012)**2))continue;
        if(limbs.some(([a,b])=>{const dx=b.x-a.x,dy=b.y-a.y,f=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));return (x-a.x-f*dx)**2+(y-a.y-f*dy)**2<(width*.012)**2;}))continue;
        mask[y*width+x]=near?2:1;
      }
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const i=y*width+x;if(!mask[i])continue;
        const queue=[i];let n=0,sx=0,sy=0,minX=width,maxX=0,minY=height,maxY=0,near=mask[i]===2;mask[i]=0;
        while(queue.length){const j=queue.pop(),px=j%width,py=Math.floor(j/width);n++;sx+=px;sy+=py;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
          for(const z of [j-1,j+1,j-width,j+width])if(z>=0&&z<mask.length&&mask[z]){near=near||mask[z]===2;mask[z]=0;queue.push(z);}}
        const w=maxX-minX+1,h=maxY-minY+1,ratio=Math.max(w,h)/Math.min(w,h);
        if(n>=2&&n<=45&&ratio<=(near?7:3)&&n/(w*h)>=.3)found.push({x:sx/n,y:sy/n});
      }
      const candidates=found.slice(0,100),next=[],used=new Set();
      for(const p of candidates){let best=null,error=Infinity;
        for(let j=0;j<hypotheses.length;j++){const q=hypotheses[j],gap=t-q.t;if(used.has(j)||gap>.1)continue;const vx=(p.x-q.x)/gap,vy=(p.y-q.y)/gap,speed=Math.hypot(vx,vy);if(speed<width*.18||speed>width*3.5)continue;
          if(q.vx!=null&&(vx*q.vx+vy*q.vy<=0||speed<Math.hypot(q.vx,q.vy)*.45||speed>Math.hypot(q.vx,q.vy)*2.2))continue;
          const e=Math.hypot(p.x-q.x-(q.vx||0)*gap,p.y-q.y-(q.vy||0)*gap);if(e<(q.vx==null?width*.16:width*.03)&&e<error){best={j,vx,vy,count:q.count+1};error=e;}}
        if(best){used.add(best.j);next.push({...p,t,vx:best.vx,vy:best.vy,count:best.count});}else next.push({...p,t,count:1});
      }
      hypotheses=next;previous.set(data);lastTime=t;return candidates;
    }};
  }
  function track(frames,width,regions){
    if(!Array.isArray(frames)||!finite(width)||width<=0)throw new Error('動画の追跡入力が不正です');
    if(!Array.isArray(regions)||regions.length!==2||Array.from(regions).some(r=>!r||![r.x,r.y,r.w,r.h].every(finite)||r.w<=0||r.h<=0))return [];
    const left=Math.max(0,Math.min(...regions.map(r=>r.x))),right=Math.min(width,Math.max(...regions.map(r=>r.x+r.w)));
    // 追跡の有効範囲も上端は画面の端（検出側と揃える）。下端は足元より下を除く。
    const top=0,bottom=Math.max(...regions.map(r=>r.y+r.h*.95));
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
      // 1返球ぶん（最長1.2秒）の軌跡を残す。0.22秒だけだと球の直後しか線が出ず、途切れて見えた。
      const trail=ps.filter(q=>q.t>=t-1.2&&q.t<=t);if(!trail.length||Math.abs(trail.at(-1).t-t)>1e-6)trail.push(p);
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
    // Audio boundaries allow a longer display reconstruction within one flight.
    // Missing boundaries, competing paths or a reversal leave the gap untouched.
    const impacts=(events||[]).filter(e=>e.status!=='ignored'&&finite(e.t)).slice().sort((a,b)=>a.t-b.t);
    const sameFlight=(a,b)=>{
      const i=impacts.findIndex(e=>e.t>a.t);
      return i>0&&impacts[i].t>=b.t&&impacts[i].t-impacts[i-1].t<=1.2;
    };
    const used=new Set();
    for(const from of observed){
      const a=from.points.at(-1),pa=from.points.at(-2),dtA=a.t-pa.t;
      if(dtA<=0)continue;
      const vx=(a.x-pa.x)/dtA,vy=(a.y-pa.y)/dtA,speed=Math.hypot(vx,vy);
      const candidates=observed.filter(to=>{
        if(to===from||used.has(to.id))return false;
        const b=to.points[0],pb=to.points[1],gap=b.t-a.t,dtB=pb.t-b.t;
        if(gap<=.03||gap>.9||dtB<=0||blocked(a.t,b.t))return false;
        const ux=(pb.x-b.x)/dtB,uy=(pb.y-b.y)/dtB,nextSpeed=Math.hypot(ux,uy);
        if(speed<width*.18||nextSpeed<speed*.65||nextSpeed>speed*1.5||(vx*ux+vy*uy)/(speed*nextSpeed)<.9)return false;
        if(gap<=.24)return Math.hypot(b.x-a.x-vx*gap,b.y-a.y-vy*gap)<width*.035&&Math.hypot(a.x-b.x+ux*gap,a.y-b.y+uy*gap)<width*.035;
        if(!sameFlight(a,b))return false;
        const dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy),bridgeSpeed=distance/gap;
        if(!distance||bridgeSpeed<speed*.5||bridgeSpeed>speed*1.5||bridgeSpeed<nextSpeed*.5||bridgeSpeed>nextSpeed*1.5)return false;
        return (dx*vx+dy*vy)/(distance*speed)>.94&&(dx*ux+dy*uy)/(distance*nextSpeed)>.94&&
          Math.abs(dx*vy-dy*vx)/speed<width*.06&&Math.abs(dx*uy-dy*ux)/nextSpeed<width*.06;
      });
      if(candidates.length!==1)continue;
      const to=candidates[0],b=to.points[0];
      // An independently detected path in the missing interval is conflicting evidence.
      if(observed.some(other=>other!==from&&other!==to&&other.points.some(p=>p.t>a.t&&p.t<b.t)))continue;
      const count=Math.ceil((b.t-a.t)*30),points=[a];used.add(to.id);
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
  // Rendering only: colour follows audio speed. Widths are about a third of the
  // previous 3x trail (参考動画の細い発光線に寄せた: 本線3.6・縁6.4・芯1.2 ×unit)。
  // Consecutive segments with the same colour and kind are stroked as one path:
  // stroking segment by segment with alpha<1 doubles up at the round joints and
  // the flight looks beaded. Predicted points (interpolation, display bridges,
  // contact estimates) are fainter solid lines without the white core instead
  // of dashes, so a short gap reads as one flight while staying distinguishable.
  function drawTrail(c,points,width,t,hits=[]){
    if(!points?.length)return false;
    const unit=Math.max(1,width/640),colorAt=time=>speedColor(speedAt(hits,time));
    const runs=[];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],predicted=!!(a.predicted||b.predicted),color=colorAt((a.t+b.t)/2),last=runs.at(-1);
      if(last&&last.predicted===predicted&&last.color===color)last.points.push(b);else runs.push({predicted,color,points:[a,b]});
    }
    c.save();c.lineCap='round';c.lineJoin='round';c.setLineDash?.([]);
    const stroke=(run,style,alpha,lineWidth,blur)=>{c.strokeStyle=style;c.globalAlpha=alpha;c.lineWidth=lineWidth;c.shadowColor=run.color;c.shadowBlur=blur;c.beginPath();run.points.forEach((p,k)=>k?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();};
    for(const run of runs)stroke(run,'#081421',run.predicted?.3:.55,6.4*unit,0);
    for(const run of runs)stroke(run,run.color,run.predicted?.45:.95,3.6*unit,run.predicted?0:4*unit);
    for(const run of runs)if(!run.predicted)stroke(run,'#fff',.8,1.2*unit,0);
    c.shadowBlur=0;c.globalAlpha=1;
    const p=points.at(-1),color=colorAt(t),radius=2.6*unit;
    c.beginPath();c.arc(p.x,p.y,radius+1.6*unit,0,Math.PI*2);c.fillStyle='#08142199';c.fill();
    c.beginPath();c.arc(p.x,p.y,radius,0,Math.PI*2);c.strokeStyle=color;c.lineWidth=1.2*unit;c.shadowColor=color;c.shadowBlur=p.predicted?0:5*unit;
    if(p.predicted){c.setLineDash?.([2*unit,2*unit]);c.stroke();}
    else{c.fillStyle='#fff';c.fill();c.stroke();}
    c.restore();return true;
  }
  // 打音の位置マーカー（表示専用）。時刻は打音で確定し、場所は打音の±0.25秒以内にある
  // 観測点のうち最も近いものを使う。観測点が無い打音には出さない（音だけでは場所が分からない）。
  // 速度・打数・接触判定には一切使わない。
  const IMPACT_SECONDS=.7;
  function impactMarkers(hits,tracks,t){
    if(!Array.isArray(hits)||!finite(t))return [];
    const out=[];
    for(const h of hits){
      if(!h||!finite(h.t)||h.status==='ignored')continue;
      const age=t-h.t;if(age<0||age>IMPACT_SECONDS)continue;
      let best=null;
      for(const tr of tracks||[]){const ps=(tr.points||[]).filter(p=>!p.predicted&&valid(p));
        ps.forEach((p,i)=>{const d=Math.abs(p.t-h.t);if(d>.25||(best&&d>=best.d))return;
          // 観測点は打音の少し後（または前）にあるので、隣の観測点との速度で打音時刻まで戻す。
          // 戻す量は最大0.25秒ぶんの観測速度で、軌跡の端より外へ長く延ばさない。
          const q=ps[i+1]||ps[i-1],dt=q?q.t-p.t:0,vx=dt?(q.x-p.x)/dt:0,vy=dt?(q.y-p.y)/dt:0,back=h.t-p.t;
          best={d,x:p.x+vx*back,y:p.y+vy*back};});}
      if(best)out.push({t:h.t,x:best.x,y:best.y,age,offset:best.d});
    }
    return out;
  }
  // 水面のように広がる楕円。外側の輪ほど薄く、0.7秒で消える。色はその打球の音声速度。
  function drawImpacts(c,markers,width,t,hits=[]){
    if(!markers?.length)return false;
    const unit=Math.max(1,width/640);
    c.save();c.setLineDash?.([]);
    for(const m of markers){
      const k=Math.min(1,Math.max(0,m.age/IMPACT_SECONDS)),color=speedColor(speedAt(hits,m.t+.01));
      for(const [scale,alpha] of [[1,.9],[.55,.5]]){
        const rx=(6+k*70)*unit*scale,ry=rx*.42;
        c.beginPath();c.ellipse(m.x,m.y,rx,ry,0,0,Math.PI*2);
        c.strokeStyle=color;c.globalAlpha=alpha*(1-k);c.lineWidth=(2.4-k*1.2)*unit;c.shadowColor=color;c.shadowBlur=6*unit;c.stroke();
      }
    }
    c.restore();return true;
  }
  return {drawTrail,drawImpacts,impactMarkers,impactSeconds:IMPACT_SECONDS,createDetector,track,at,displayTracks,speedAt,speedColor,maxGapSeconds:MAX_GAP};
});
