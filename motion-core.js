/* Motion review arithmetic. Pixel tracks and 2D poses are estimates, not calibrated 3D. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.FrescoMotion=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  function distance(value){const n=(!['string','number'].includes(typeof value)||(typeof value==='string'&&value.trim()===''))?NaN:Number(value);if(!Number.isFinite(n)||n<=0||n>100)throw new Error('距離は0より大きい100m以下の値を入力してください');return n;}
  function point(p){return p&&finite(p.x)&&finite(p.y);}
  function visible(p){return point(p)&&finite(p.visibility)&&p.visibility>=.65&&(p.presence==null||p.presence>=.65);}
  function angle(a,b,c){if(![a,b,c].every(visible))return null;const u=[a.x-b.x,a.y-b.y],v=[c.x-b.x,c.y-b.y];const norm=Math.hypot(...u)*Math.hypot(...v);return norm>1e-6?Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/norm)))*180/Math.PI:null;}
  function posture(p=[]){let lean=null;if([11,12,23,24].every(i=>visible(p[i]))){const dx=(p[11].x+p[12].x-p[23].x-p[24].x)/2,dy=(p[23].y+p[24].y-p[11].y-p[12].y)/2;if(Math.hypot(dx,dy)>1)lean=Math.atan2(dx,dy)*180/Math.PI;}return {lean,leftElbow:angle(p[11],p[13],p[15]),rightElbow:angle(p[12],p[14],p[16]),leftKnee:angle(p[23],p[25],p[27]),rightKnee:angle(p[24],p[26],p[28])};}

  // Greedy constant-velocity tracklets; no point is invented across a dropout.
  // Keep only sustained fast motion to reduce static marks and slow bystanders.
  function track(frames,width){
    const active=[],finished=[];let nextId=1;
    const maxGap=.14,minSpeed=width*.055,maxSpeed=width*3;
    for(const frame of frames){
      const t=frame.t,candidates=(frame.ballCandidates||[]).filter(point);
      for(let i=active.length-1;i>=0;i--)if(t-active[i].points.at(-1).t>maxGap)finished.push(...active.splice(i,1));
      const pairs=[];
      for(let i=0;i<active.length;i++){
        const pts=active[i].points,last=pts.at(-1),prev=pts.at(-2),dt=t-last.t;if(dt<=0)continue;
        const vx=prev?(last.x-prev.x)/(last.t-prev.t):0,vy=prev?(last.y-prev.y)/(last.t-prev.t):0;
        for(let j=0;j<candidates.length;j++){
          const c=candidates[j],speed=Math.hypot(c.x-last.x,c.y-last.y)/dt;
          if(speed>maxSpeed)continue;
          const error=Math.hypot(c.x-last.x-vx*dt,c.y-last.y-vy*dt);
          if(error>width*(prev?.055:.14))continue;
          pairs.push({i,j,error});
        }
      }
      pairs.sort((a,b)=>a.error-b.error);const usedTracks=new Set(),usedPoints=new Set();
      for(const {i,j} of pairs)if(!usedTracks.has(i)&&!usedPoints.has(j)){active[i].points.push({...candidates[j],t});usedTracks.add(i);usedPoints.add(j);}
      candidates.forEach((c,j)=>{if(!usedPoints.has(j))active.push({id:nextId++,points:[{...c,t}]});});
    }
    finished.push(...active);
    return finished.filter(tr=>{
      if(tr.points.length<3)return false;
      const a=tr.points[0],b=tr.points.at(-1),dt=b.t-a.t;
      return dt>0&&Math.hypot(b.x-a.x,b.y-a.y)/dt>=minSpeed;
    });
  }
  function nearestFrame(frames,t,maxGap=.12){
    let lo=0,hi=frames.length;
    while(lo<hi){const m=(lo+hi)>>1;if(frames[m].t<t)lo=m+1;else hi=m;}
    const found=[frames[lo],frames[lo-1]].filter(Boolean).sort((a,b)=>Math.abs(a.t-t)-Math.abs(b.t-t))[0];
    return found&&Math.abs(found.t-t)<=maxGap?found:null;
  }
  function evidence(events,frames,tracks,width){
    const points=tracks.flatMap(tr=>tr.points);
    return events.map(event=>{
      const scores=[Infinity,Infinity];
      for(const p of points){if(Math.abs(p.t-event.t)>.16)continue;const frame=nearestFrame(frames,p.t);if(!frame)continue;
        for(let side=0;side<2;side++)for(const i of [15,16]){const wrist=frame.poses[side]?.[i];if(visible(wrist))scores[side]=Math.min(scores[side],Math.hypot(wrist.x-p.x,wrist.y-p.y));}
      }
      const best=Math.min(...scores),side=scores[0]<scores[1]?'a':'b';
      const suggested=best<width*.08&&Math.abs(scores[0]-scores[1])>width*.02?side:null;
      return {...event,suggestedPlayer:suggested,evidence:suggested?'球軌跡が手首付近（要確認）':'映像の裏付け不足'};
    });
  }
  // Automatic acceptance uses converging visual evidence, not colour alone.
  // Thresholds are conservative heuristics; they are not accuracy estimates.
  function autoReview(events,frames,tracks,width,distanceM){
    distance(distanceM);
    if(!finite(width)||width<=0)throw new Error('動画の幅が不正です');
    const accepted=e=>['auto','confirmed'].includes(e.status);
    const judged=events.map(event=>{
      if(event.status==='confirmed'||event.status==='ignored')return {...event};
      let winner=null,ambiguous=false,joined=false;
      const consider=(a,p,b,isJoined=false)=>{
        const maxGap=isJoined?.15:.14;
          if(![a,p,b].every(point)||Math.abs(p.t-event.t)>.12||!(p.t>a.t&&b.t>p.t)||p.t-a.t>maxGap||b.t-p.t>maxGap)return;
          const f=nearestFrame(frames,p.t,.04),fa=nearestFrame(frames,a.t,.04),fb=nearestFrame(frames,b.t,.04);
          if(!f||!fa||!fb||![0,1].every(side=>[11,12,23,24].every(k=>visible(f.poses?.[side]?.[k]))))return;
          const u={x:p.x-a.x,y:p.y-a.y},v={x:b.x-p.x,y:b.y-p.y};
          const incoming=Math.hypot(u.x,u.y),outgoing=Math.hypot(v.x,v.y);
          if(incoming/(p.t-a.t)<width*.15||outgoing/(b.t-p.t)<width*.15||incoming===0||outgoing===0||(u.x*v.x+u.y*v.y)/(incoming*outgoing)>.5)return;
          for(let side=0;side<2;side++)for(const wrist of [15,16]){
            const center=f.poses[side]?.[wrist],before=fa.poses?.[side]?.[wrist],after=fb.poses?.[side]?.[wrist];
            if(![center,before,after].every(visible)||Math.hypot(center.x-p.x,center.y-p.y)>width*.045)continue;
            if(Math.hypot(after.x-before.x,after.y-before.y)/(b.t-a.t)<width*.08)continue;
            const other=[15,16].map(k=>f.poses[1-side]?.[k]).filter(visible);
            if(!other.length||Math.min(...other.map(w=>Math.hypot(w.x-p.x,w.y-p.y)))<width*.09)continue;
            const player=side===0?'a':'b';if(winner&&winner!==player)ambiguous=true;winner=player;if(isJoined)joined=true;
          }
      };
      const usableTracks=(tracks||[]).filter(tr=>Array.isArray(tr.points)&&tr.points.length>=3);
      for(const tr of usableTracks)for(let i=1;i<tr.points.length-1;i++)consider(tr.points[i-1],tr.points[i],tr.points[i+1]);
      // A fast reversal often ends the incoming track. Compare independently
      // sustained incoming/outgoing tracks by their short projections at the
      // gap midpoint. These projections are evidence only, never drawn tracks.
      const arrivals=usableTracks.filter(tr=>Math.abs(tr.points.at(-1).t-event.t)<=.15),departures=usableTracks.filter(tr=>Math.abs(tr.points[0].t-event.t)<=.15);
      for(const incoming of arrivals)for(const outgoing of departures){
        if(incoming===outgoing)continue;
        const a1=incoming.points.at(-2),a=incoming.points.at(-1),b=outgoing.points[0],b2=outgoing.points[1];
        if(![a1,a,b,b2].every(point)||!(a.t>a1.t&&b2.t>b.t&&b.t>a.t)||b.t-a.t>.3||a.t-a1.t>.14||b2.t-b.t>.14||Math.abs(a.t-event.t)>.15||Math.abs(b.t-event.t)>.15)continue;
        const va={x:(a.x-a1.x)/(a.t-a1.t),y:(a.y-a1.y)/(a.t-a1.t)},vb={x:(b2.x-b.x)/(b2.t-b.t),y:(b2.y-b.y)/(b2.t-b.t)};
        const sa=Math.hypot(va.x,va.y),sb=Math.hypot(vb.x,vb.y);
        if(sa<width*.15||sb<width*.15||(va.x*vb.x+va.y*vb.y)/(sa*sb)>.5)continue;
        const t=(a.t+b.t)/2,pa={x:a.x+va.x*(t-a.t),y:a.y+va.y*(t-a.t)},pb={x:b.x+vb.x*(t-b.t),y:b.y+vb.y*(t-b.t)};
        if(Math.hypot(pa.x-pb.x,pa.y-pb.y)>width*.04)continue;
        const frame=nearestFrame(frames,t,.04);
        if(!frame||![0,1].some(side=>[15,16].some(k=>{const w=frame.poses?.[side]?.[k];return visible(w)&&Math.hypot(w.x-a.x,w.y-a.y)<width*.075&&Math.hypot(w.x-b.x,w.y-b.y)<width*.075;})))continue;
        consider(a,{x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2,t},b,true);
      }
      if(!winner||ambiguous)return {...event,status:'pending',player:null,suggestedPlayer:ambiguous?null:winner,provenance:'motion-ball-wrist-v2',reviewReason:ambiguous?'対象の打者が一意に決まりません':'球の反転と手首の動きを同時に確認できません',evidence:ambiguous?'打者の映像証拠が競合':'映像の裏付け不足'};
      return {...event,status:'auto',player:winner,suggestedPlayer:winner,provenance:'motion-ball-wrist-v2',reviewReason:'',evidence:joined?'分かれた前後軌跡の反転と手首の動きが一致（自動判定）':'球の手首付近での反転と、手首の動きが一致（自動判定）'};
    });
    const ordered=judged.filter(e=>e.status!=='ignored').slice().sort((a,b)=>a.t-b.t);
    const doubtful=new Map();
    for(let i=1;i<ordered.length;i++){
      const previous=ordered[i-1],event=ordered[i],dt=event.t-previous.t;
      if(accepted(previous)&&accepted(event)&&previous.player===event.player){
        for(const h of [previous,event])if(h.status==='auto')doubtful.set(h,'同じ側の打球が連続しています');
      }
      if(event.status==='auto'&&(dt<.1||dt>2))doubtful.set(event,'前の候補との間隔を確認してください');
    }
    for(const [event,reason]of doubtful){event.status='pending';event.reviewReason=reason;}
    return judged;
  }
  function speeds(events,defaultDistance){
    const fallback=distance(defaultDistance);
    if(!Array.isArray(events)||events.some(e=>!e||!finite(e.t)||e.t<0))throw new Error('打点時刻が不正です');
    // Ignored noise can be removed; unresolved events break the interval chain.
    const ordered=events.filter(e=>e.status!=='ignored').slice().sort((a,b)=>a.t-b.t);
    return ordered.map((event,i)=>{
      const previous=ordered[i-1];let reason='',kmh=null,meters=null;
      if(!previous)reason='前の打点なし';
      else if(!['confirmed','auto'].includes(previous.status)||!['confirmed','auto'].includes(event.status))reason='未確認の打点';
      else if(!['a','b'].includes(previous.player)||!['a','b'].includes(event.player))reason='打者が不明';
      else if(previous.player===event.player)reason='同じ側が連続';
      else if(event.t-previous.t<.1||event.t-previous.t>2)reason='打点間隔が範囲外（0.1〜2秒）';
      else {meters=event.distanceM==null?fallback:distance(event.distanceM);kmh=meters/(event.t-previous.t)*3.6;}
      return {...event,previousTime:previous?.t??null,launchPlayer:previous?.player??null,averageKmh:kmh,usedDistanceM:meters,reason};
    });
  }
  function normalize(data,video){
    if(!data||typeof data!=='object')throw new Error('対応するモーション解析JSONではありません');
    const legacy=Array.isArray(data.frames)&&data.summary;
    if(!legacy&&data.schema!=='frescoball-motion-v1')throw new Error('対応するモーション解析JSONではありません');
    const source=legacy?{name:String(data.summary.source||'').split('/').pop(),width:video.width,height:video.height}:data.source;
    if(!source||source.name!==video.name||(source.size!=null&&source.size!==video.size))throw new Error('解析記録と動画が一致しません。同じ元動画を選んでください');
    if(!finite(source.width)||!finite(source.height)||source.width<=0||source.height<=0||source.width!==video.width||source.height!==video.height)throw new Error('動画の解像度が解析記録と一致しません');
    if(source.duration!=null&&(!finite(source.duration)||Math.abs(source.duration-video.duration)>.1))throw new Error('動画の長さが解析記録と一致しません');
    if(!Array.isArray(data.frames)||data.frames.length>100000)throw new Error('フレーム記録が不正です');
    let last=-1;
    const frames=data.frames.map(f=>{
      if(!f||typeof f!=='object')throw new Error('フレーム記録が不正です');
      const t=legacy?f.source_time_s:f.t;
      if(!finite(t)||t<0||t>video.duration+.1||t<=last)throw new Error('フレーム時刻が不正です');last=t;
      if(!Array.isArray(f.poses))throw new Error('選手の記録が不正です');
      const rawPoses=legacy?f.poses.map(p=>p?.landmarks):f.poses;
      if(!Array.isArray(rawPoses)||rawPoses.length!==2)throw new Error('選手の記録が不正です');
      const poses=rawPoses.map(ps=>{if(!Array.isArray(ps)||(ps.length!==0&&ps.length!==33))throw new Error('骨格の記録が不正です');return ps.map(p=>{if(!point(p)||!finite(p.visibility)||Math.abs(p.x)>video.width*3||Math.abs(p.y)>video.height*3)throw new Error('骨格座標が不正です');return {x:p.x,y:p.y,visibility:p.visibility,presence:finite(p.presence)?p.presence:null};});});
      const balls=legacy?f.ball_candidates:f.ballCandidates;
      if(!Array.isArray(balls)||balls.length>500||balls.some(p=>!point(p)||p.x<0||p.y<0||p.x>video.width||p.y>video.height))throw new Error('ボール座標が不正です');
      return {t,poses,ballCandidates:balls.map(p=>({x:p.x,y:p.y}))};
    });
    const settings={distanceM:distance(data.settings?.distanceM??7),rule:['top','classic'].includes(data.settings?.rule)?data.settings.rule:'practice'};
    if(data.events!=null&&(!Array.isArray(data.events)||data.events.length>100000))throw new Error('打点記録が不正です');
    const events=(data.events||[]).map((e,i)=>{
      if(!e||!finite(e.t)||e.t<0||e.t>video.duration)throw new Error('打点時刻が不正です');
      return {id:`e${i}`,t:e.t,reviewRequired:Boolean(e.reviewRequired),suspicious:Boolean(e.suspicious),player:['a','b'].includes(e.player)?e.player:null,status:['confirmed','auto','ignored'].includes(e.status)?e.status:'pending',distanceM:e.distanceM==null?null:distance(e.distanceM),origin:String(e.origin||'import').slice(0,80),provenance:String(e.provenance||'').slice(0,160),evidence:String(e.evidence||'').slice(0,300),reviewReason:String(e.reviewReason||'').slice(0,300),suggestedPlayer:['a','b'].includes(e.suggestedPlayer)?e.suggestedPlayer:null};
    });
    const rawRegions=data.regions??[];
    if(!Array.isArray(rawRegions)||(rawRegions.length!==0&&rawRegions.length!==2))throw new Error('対象範囲の記録が不正です');
    const regions=Array.from(rawRegions,r=>{
      if(!r||![r.x,r.y,r.w,r.h].every(finite)||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>video.width||r.y+r.h>video.height)throw new Error('対象範囲が動画の外にあります');
      return {x:r.x,y:r.y,w:r.w,h:r.h};
    });
    return {schema:'frescoball-motion-v1',source,settings,frames,events,regions,legacy:Boolean(legacy)};
  }
  return {distance,posture,track,nearestFrame,evidence,autoReview,speeds,normalize};
});
