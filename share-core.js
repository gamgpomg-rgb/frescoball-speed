/* Shared, deterministic geometry and clip statistics for previews and saved media. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.FrescoShareCore=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  function windowFor(duration,start,length,maxLength=60){
    if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(start)||start<0||start>=duration||!Number.isFinite(length)||length<=0||length>maxLength)throw new Error('動画内の開始位置と、60秒以内の長さを選んでください');
    return {start,end:Math.min(duration,start+length)};
  }
  function fit(sw,sh,x,y,w,h){if(![sw,sh,w,h].every(n=>Number.isFinite(n)&&n>0)||![x,y].every(Number.isFinite))throw new Error('映像の寸法が不正です');const scale=Math.min(w/sw,h/sh);return{x:x+(w-sw*scale)/2,y:y+(h-sh*scale)/2,w:sw*scale,h:sh*scale};}
  function crop(width,height,regions,focus){
    if(![width,height].every(n=>Number.isFinite(n)&&n>0))throw new Error('映像の寸法が不正です');
    if(!focus)return{x:0,y:0,w:width,h:height};
    if(!Array.isArray(regions)||regions.length!==2||Array.from(regions).some(r=>!r||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>width||r.y+r.h>height))throw new Error('対象2人の範囲を選び直してください');
    const left=Math.min(...regions.map(r=>r.x)),top=Math.min(...regions.map(r=>r.y));
    const right=Math.max(...regions.map(r=>r.x+r.w)),bottom=Math.max(...regions.map(r=>r.y+r.h));
    const pad=Math.max(right-left,bottom-top)*.1;
    const x=Math.max(0,left-pad),y=Math.max(0,top-pad);
    return{x,y,w:Math.min(width,right+pad)-x,h:Math.min(height,bottom+pad)-y};
  }
  function stats(hits,start,end,gap=2.5){
    const selected=hits.filter(h=>Number.isFinite(h.t)&&h.t>=start&&h.t<=end).slice().sort((a,b)=>a.t-b.t);
    let last=null,run=0,best=0;const speeds=[];
    selected.forEach(h=>{run=last!=null&&h.t-last<=gap?run+1:1;best=Math.max(best,run);if(last!=null&&h.t>last&&h.t-last<=gap&&typeof h.speed==='number'&&Number.isFinite(h.speed)&&h.speed>0)speeds.push(h.speed);last=h.t;});
    return {total:selected.length,rally:best,average:speeds.length?speeds.reduce((a,b)=>a+b,0)/speeds.length:null,max:speeds.length?Math.max(...speeds):null};
  }
  function distribution(hits,start,end,flip=false){
    const rows=['50未満','50–60','60–70','70–80','80–90','90以上'].map(label=>({label,a:0,b:0}));
    const ordered=(hits||[]).slice().sort((a,b)=>a.t-b.t);
    ordered.forEach((h,i)=>{if(h.t<start||h.t>end||h.qualityExcluded||h.status==='ignored'||!Number.isFinite(h.speed)||h.speed<=0)return;
      let player=h.launchPlayer||ordered[i-1]?.player;if(!['a','b'].includes(player))return;
      if(flip)player=player==='a'?'b':'a';const band=h.speed<50?0:h.speed>=90?5:1+Math.floor((h.speed-50)/10);rows[band][player]++;
    });return rows;
  }
  function motionRange(motion){
    const fs=motion?.frames;if(!Array.isArray(fs)||fs.length<2)return null;
    let last=-Infinity;
    for(const f of fs){if(!f||!Number.isFinite(f.t)||f.t<0||f.t<=last)return null;last=f.t;}
    return {start:fs[0].t,end:fs.at(-1).t};
  }
  function hitAt(hits,t,start){
    let latest=null;
    for(const h of hits){if(Number.isFinite(h.t)&&h.t<=t&&h.t>=start&&(!latest||h.t>=latest.t))latest=h;}
    return latest&&t-latest.t<1.2&&typeof latest.speed==='number'&&Number.isFinite(latest.speed)&&latest.speed>0?latest:null;
  }
  function trajectoryTracks(tracks,regions,width,height){
    if(!Array.isArray(regions)||regions.length!==2||Array.from(regions).some(r=>!r||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=0||r.h<=0))return [];
    const centers=regions.map(r=>({x:r.x+r.w/2,y:r.y+r.h/2}));
    const dx=centers[1].x-centers[0].x,dy=centers[1].y-centers[0].y,separation=Math.hypot(dx,dy);
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||separation<1)return [];
    const left=Math.max(0,Math.min(...regions.map(r=>r.x))),right=Math.min(width,Math.max(...regions.map(r=>r.x+r.w)));
    const top=Math.max(0,Math.min(...regions.map(r=>r.y-r.h*.15))),bottom=Math.min(height,Math.max(...regions.map(r=>r.y+r.h*.92)));
    return (tracks||[]).filter(tr=>{
      const points=tr.points;if(!Array.isArray(points)||points.length<4)return false;
      if(points.some(p=>!p||![p.t,p.x,p.y].every(Number.isFinite)||p.x<left||p.x>right||p.y<top||p.y>bottom))return false;
      const a=points[0],b=points.at(-1),duration=b.t-a.t;if(duration<.12||duration>1.5)return false;
      let path=0;
      for(let i=1;i<points.length;i++){const p=points[i-1],q=points[i],dt=q.t-p.t,step=Math.hypot(q.x-p.x,q.y-p.y);if(dt<=0||dt>.15||step/dt>width*3)return false;path+=step;}
      const net=Math.hypot(b.x-a.x,b.y-a.y),along=Math.abs((b.x-a.x)*dx+(b.y-a.y)*dy)/separation;
      if(!path||net/path<.65||net/duration<width*.12||along<Math.max(12,separation*.06))return false;
      return points.some(p=>!regions.some(r=>p.x>=r.x+r.w*.18&&p.x<=r.x+r.w*.82&&p.y>=r.y&&p.y<=r.y+r.h));
    });
  }
  function trajectoryAt(tracks,t){
    const segments=(tracks||[]).map(tr=>tr.points.filter(p=>p.t<=t&&p.t>=t-.3)).filter(ps=>ps.length>=2&&t-ps.at(-1).t<=.1);
    segments.sort((a,b)=>Math.hypot(b.at(-1).x-b[0].x,b.at(-1).y-b[0].y)-Math.hypot(a.at(-1).x-a[0].x,a.at(-1).y-a[0].y));
    return segments[0]||[];
  }
  return {distribution,windowFor,fit,crop,stats,motionRange,hitAt,trajectoryTracks,trajectoryAt};
});
