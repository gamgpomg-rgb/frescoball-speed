/* Local video review: explicit player regions, pose model and experimental red-ball tracks. */
window.FrescoMotionReview = (() => {
  'use strict';
  const M = window.FrescoMotion;
  const edges = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
  let drawingTracks = [], serial = 0, models = null, panel, video, source, frames = [], tracks = [], events = [], regions = [], selecting = null, origin = null, busy = false;
  let overlay, view, status, rows, controls, currentDistance = 7, callbacks = {}, reviewIndex = 0, corner = null, clipEnd = null, previewFrame = null, viewHome = null, playback = null, showAll = false, conditions = null, showSkeleton = true, showBall = true, timeline = null, clockLabel = null, reviewSection = null, lastProgress = 0, uiMode = 'detail', detailNodes = [];
  const el = (tag, text, parent) => { const n=document.createElement(tag); if(text)n.textContent=text; if(parent)parent.append(n); return n; };
  const button = (text, parent, action) => {const b=el('button',text,parent);b.type='button';b.onclick=action;return b;};
  const say = text => {if(status)status.textContent=text;};
  function reset(){serial++;if(busy)callbacks.onProgress?.({phase:'motion',percent:lastProgress,busy:false,status:'cancelled'});callbacks={};source=null;corner=null;clipEnd=null;previewFrame=null;showAll=false;showSkeleton=true;showBall=true;timeline=null;clockLabel=null;reviewSection=null;busy=false;selecting=null;origin=null;frames=[];tracks=[];drawingTracks=[];events=[];regions=[];if(panel)panel.remove();panel=null;if(overlay)overlay.remove();overlay=null;}
  async function model(){
    if(models)return models;
    const {FilesetResolver,PoseLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs');
    const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
    const options={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',delegate:'CPU'},runningMode:'IMAGE',numPoses:1,minPoseDetectionConfidence:.6,minPosePresenceConfidence:.6,minTrackingConfidence:.6};
    models=await PoseLandmarker.createFromOptions(files,options);return models;
  }
  function seek(t){const target=video;return new Promise((resolve,reject)=>{if(Math.abs(target.currentTime-t)<.002&&target.readyState>=2){resolve();return;}const timeout=setTimeout(()=>done(new Error('映像の読み込みがタイムアウトしました')),12000);const done=e=>{clearTimeout(timeout);target.removeEventListener('seeked',ok);target.removeEventListener('error',bad);e?reject(e):resolve();};const ok=()=>done(),bad=()=>done(new Error('映像を読み込めません'));target.addEventListener('seeked',ok,{once:true});target.addEventListener('error',bad,{once:true});target.currentTime=t;});}
  function snapshot(){
    if(!source)return null;
    return JSON.parse(JSON.stringify({schema:'frescoball-motion-v1',source,settings:{distanceM:currentDistance,rule:'practice'},regions:regions[0]&&regions[1]?regions:[],frames,tracks,events}));
  }
  function refreshTracks(){drawingTracks=window.FrescoBallTracker?.displayTracks?.(tracks,events,source?.width,frames)||tracks;}
  function changed(){refreshTracks();callbacks.onChange?.(snapshot());}
  function drawOverlay(c,w,h,t,options={}){
    if(!source||!source.width||!source.height)return false;
    const f=previewFrame&&Math.abs(previewFrame.t-t)<.1?previewFrame:M.nearestFrame(frames,t);let drawn=false;
    c.save();c.scale(w/source.width,h/source.height);c.lineWidth=Math.max(2,source.width/500);
    if((options.ball??showBall)&&drawingTracks.length){c.fillStyle='rgba(5,10,22,.12)';c.fillRect(0,0,source.width,source.height);}
    const confident=p=>p&&p.visibility>=.65&&(p.presence==null||p.presence>=.65);
    if((options.skeleton??showSkeleton)&&f)f.poses.forEach((ps,i)=>{c.strokeStyle=i?'#f4bf55':'#58d5ef';for(const [a,b] of edges)if(confident(ps[a])&&confident(ps[b])){c.beginPath();c.moveTo(ps[a].x,ps[a].y);c.lineTo(ps[b].x,ps[b].y);c.stroke();drawn=true;}});
    if(options.ball??showBall){
      const speedHits=callbacks.getSpeedHits?.()||[];
      const ball=window.FrescoBallTracker?.at(drawingTracks,t);
      const fallback=tracks.filter(trackForPair).map(tr=>tr.points.filter(p=>p.t<=t&&p.t>=t-.22)).filter(ps=>ps.length>=2&&t-ps.at(-1).t<=.1).sort((a,b)=>b.length-a.length)[0];
      const points=window.FrescoBallTracker?(ball?.trail||[]):(fallback||[]);
      if(window.FrescoBallTracker?.drawTrails)drawn=window.FrescoBallTracker.drawTrails(c,drawingTracks,source.width,t,speedHits)||drawn;
      else if(window.FrescoBallTracker?.drawTrail)drawn=window.FrescoBallTracker.drawTrail(c,points,source.width,t,speedHits)||drawn;
      if(window.FrescoBallTracker?.drawImpacts){const marks=window.FrescoBallTracker.impactMarkers(events,drawingTracks,t);drawn=window.FrescoBallTracker.drawImpacts(c,marks,source.width,t,speedHits)||drawn;}
    }
    c.restore();return drawn;
  }
  function draw(){
    if(!panel||!video.videoWidth)return;
    const w=video.videoWidth,h=video.videoHeight;view.width=w;view.height=h;if(timeline)timeline.value=video.currentTime;if(clockLabel)clockLabel.textContent=`${timeText(video.currentTime)} / ${timeText(video.duration)}`;
    const c=view.getContext('2d');c.drawImage(video,0,0,w,h);
    const uiScale=w/(view.getBoundingClientRect().width||w);c.lineWidth=2*uiScale;c.font=`${12*uiScale}px sans-serif`;
    regions.forEach((r,i)=>{c.strokeStyle=i?'#f4bf55':'#58d5ef';c.strokeRect(r.x,r.y,r.w,r.h);c.fillStyle='#111b';c.fillRect(r.x+12*uiScale,r.y+6*uiScale,48*uiScale,20*uiScale);c.fillStyle=c.strokeStyle;c.fillText(i?'2人目':'1人目',r.x+16*uiScale,r.y+21*uiScale);
      if(!busy&&!reviewSection?.open){const radius=9*w/(view.getBoundingClientRect().width||w);for(const [x,y] of [[r.x,r.y],[r.x+r.w,r.y],[r.x,r.y+r.h],[r.x+r.w,r.y+r.h]]){c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.fill();c.strokeStyle='#fff';c.stroke();c.strokeStyle=i?'#f4bf55':'#58d5ef';}}
    });
    if(corner){c.fillStyle='#fff';c.beginPath();c.arc(corner.x,corner.y,w/100,0,Math.PI*2);c.fill();}
    drawOverlay(c,w,h,video.currentTime);
    const f=previewFrame||M.nearestFrame(frames,video.currentTime),fmt=n=>n==null?'読み取れません':`${n.toFixed(0)}°`;
    panel.querySelector('[data-posture]').textContent=f?f.poses.map((ps,i)=>`${i+1}人目：上体の傾き ${fmt(M.posture(ps).lean)}`).join(' ／ '):'解析した区間を再生すると、読み取れた骨格と球の軌跡が映像に重なります。';
  }
  function renderEvents(){
    if(viewHome&&view&&view.parentNode!==viewHome){viewHome.append(view);if(playback)viewHome.append(playback);}rows.replaceChildren();let speeds;
    try{speeds=callbacks.measureEvents?callbacks.measureEvents(events):M.speeds(events,currentDistance);}catch(e){say(e.message);return;}
    const all=events.slice().sort((a,b)=>a.t-b.t),pending=all.filter(e=>e.status==='pending'||e.reviewRequired||e.suspicious),ordered=showAll?all:pending,byId=new Map(speeds.map(e=>[e.id,e]));
    el('p',`球と動きで判定 ${events.filter(e=>e.status==='auto'&&!['pose-audio-estimate-v1','rally-alternation-estimate-v1'].includes(e.provenance)).length}球・動き・ラリーから仮判定 ${events.filter(e=>e.status==='auto'&&['pose-audio-estimate-v1','rally-alternation-estimate-v1'].includes(e.provenance)).length}球・確認した打球 ${events.filter(e=>e.status==='confirmed'&&e.player).length}球・見直す音 ${pending.length}件`,rows);const list=el('details','',rows);el('summary','すべての判定を見る',list);button(showAll?'見直す音だけに戻る':'すべての音を見直す',list,()=>{showAll=!showAll;reviewIndex=0;renderEvents();});
    if(!ordered.length){el('p',events.length?'見直す音はありません。自動判定も「すべての判定を見る」から修正できます。':'解析後に判定した打球と、見直しが必要な音を表示します。',rows);if(frames.length&&reviewSection?.open){rows.append(view);rows.append(playback);}return;}
    reviewIndex=Math.min(Math.max(0,reviewIndex),ordered.length-1);const event=ordered[reviewIndex];
    if(frames.length&&!busy&&reviewSection?.open){video.pause();video.currentTime=Math.max(0,event.t-.25);}
    const card=el('div','',rows);card.className='motion-review-candidate';card.style.cssText='position:relative;padding:10px;border-radius:12px';
    el('strong',`確認箇所 ${reviewIndex+1} / ${ordered.length}・${timeText(event.t)}`,card);if(frames.length&&reviewSection?.open){card.append(view);card.append(playback);}el('p',event.reviewReason||event.evidence||'自動では判断しきれなかった音です。',card);
    el('p','映像を見て、誰が打った音か選んでください。隣の組の音や足音は「この2人の打球ではない」を選びます。',card);
    button('この前後を再生',card,async()=>{if(busy)return;try{const token=serial;video.pause();await seek(Math.max(0,event.t-.65));if(token!==serial)return;clipEnd=Math.min(video.duration,event.t+.65);await video.play();}catch(e){say(e.message);}});
    const choices=el('div','',card);
    const select=(player,state)=>{if(busy)return;event.player=player;event.status=state;event.reviewRequired=false;event.suspicious=false;event.origin='manual-review';reviewIndex=state==='pending'?(reviewIndex+1)%ordered.length:showAll?Math.min(reviewIndex+1,ordered.length-1):Math.min(reviewIndex,ordered.length-2);renderEvents();changed();};
    button('1人目が打った',choices,()=>select('a','confirmed'));
    button('2人目が打った',choices,()=>select('b','confirmed'));
    button('この2人の打球ではない',choices,()=>select(null,'ignored'));
    button('分からないので次へ',choices,()=>select(null,'pending'));
    const state=event.status==='auto'?(event.provenance==='pose-audio-estimate-v1'?'動き・ラリーによる仮判定':'自動判定した打球'):event.status==='ignored'?'集計から外しました':event.status==='confirmed'?`${event.player==='a'?'1':'2'}人目の打球として確認済み`:'まだ確認していません';
    const result=byId.get(event.id);el('p',state+(result?.initialKmh!=null?`・推定初速 ${result.initialKmh.toFixed(1)} km/h`:''),card);
    if(event.suggestedPlayer)el('p',`映像からは${event.suggestedPlayer==='a'?'1':'2'}人目の打球の可能性があります。上のボタンで確認してください。`,card);
    button('前の音',card,()=>{reviewIndex--;renderEvents();});button('次の音',card,()=>{reviewIndex++;renderEvents();});
    const details=el('details','',rows);el('summary','確認した音を一覧で見る',details);
    for(const e of all){const r=el('div','',details);r.className='motion-event';button(timeText(e.t),r,()=>{showAll=true;reviewIndex=all.indexOf(e);renderEvents();seek(e.t).then(draw).catch(err=>say(err.message));});el('span',e.status==='ignored'?'対象外':['confirmed','auto'].includes(e.status)?`${e.player==='a'?'1':'2'}人目${e.status==='auto'?'（自動）':''}`:'あとで確認',r);}
  }
  const timeText=t=>{const sec=Math.max(0,Math.floor(Number(t)||0));return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;};
  function inPairArea(x,y){
    if(regions.length!==2||!regions[0]||!regions[1])return false;
    const top=Math.min(...regions.map(r=>r.y-r.h*.15)),bottom=Math.max(...regions.map(r=>r.y+r.h*.92));
    const left=Math.min(...regions.map(r=>r.x)),right=Math.max(...regions.map(r=>r.x+r.w));
    return x>=left&&x<=right&&y>=Math.max(0,top)&&y<=bottom;
  }
  function trackForPair(tr){
    const ps=tr.points;if(!ps||ps.length<4||!ps.every(p=>inPairArea(p.x,p.y)))return false;
    const a=ps[0],b=ps.at(-1),elapsed=b.t-a.t;if(elapsed<.12||elapsed>1.5)return false;
    const centers=regions.map(r=>({x:r.x+r.w/2,y:r.y+r.h/2})),dx=centers[1].x-centers[0].x,dy=centers[1].y-centers[0].y,d=Math.hypot(dx,dy);if(d<1)return false;
    const along=Math.abs((b.x-a.x)*dx+(b.y-a.y)*dy)/d,net=Math.hypot(b.x-a.x,b.y-a.y),length=ps.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-ps[i].x,p.y-ps[i].y),0);
    // A flight must move towards the other player and leave the middle of a body box.
    const outsideBody=ps.some(p=>!regions.some(r=>p.x>r.x+r.w*.18&&p.x<r.x+r.w*.82&&p.y>r.y&&p.y<r.y+r.h));
    return along>=Math.max(12,d*.06)&&length>0&&net/length>=.65&&outsideBody;
  }
  // Colour candidates are intentionally separate from learned pose detections.
  function balls(canvas,prev,poses){
    const w=canvas.width,h=canvas.height,data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
    const mask=new Uint8Array(w*h),found=[];
    if(!prev||regions.length!==2||!regions[0]||!regions[1])return {data,candidates:[]};
    // Compute the court bounds once, not once per pixel. Resolution and colour
    // thresholds stay identical to the previous tracker.
    const scaleX=w/source.width,scaleY=h/source.height;
    const x0=Math.max(1,Math.ceil(Math.min(...regions.map(r=>r.x))*scaleX));
    const x1=Math.min(w-2,Math.floor(Math.max(...regions.map(r=>r.x+r.w))*scaleX));
    const y0=Math.max(1,Math.ceil(Math.max(0,Math.min(...regions.map(r=>r.y-r.h*.15)))*scaleY));
    const y1=Math.min(h-2,Math.floor(Math.max(...regions.map(r=>r.y+r.h*.92))*scaleY));
    const bodyPoints=poses.flatMap(ps=>ps.filter((p,k)=>[0,7,8,13,14,15,16].includes(k)&&p.visibility>.65));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];if(r<95||r<g*1.45||r<b*1.25||r-g<38)continue;if(prev&&Math.abs(r-prev[i])+Math.abs(g-prev[i+1])+Math.abs(b-prev[i+2])<45)continue;
      // Suppress skin near the detected face and limbs, without declaring all ROI motion a ball.
      if(bodyPoints.some(p=>Math.hypot(p.x-x,p.y-y)<w*.012))continue;mask[y*w+x]=1;
    }
    for(let i=0;i<mask.length;i++)if(mask[i]){const queue=[i];mask[i]=0;let sx=0,sy=0,n=0,minX=w,maxX=0,minY=h,maxY=0;while(queue.length){const j=queue.pop();const x=j%w,y=Math.floor(j/w);sx+=x;sy+=y;n++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(const z of [j-1,j+1,j-w,j+w])if(z>=0&&z<mask.length&&mask[z]){mask[z]=0;queue.push(z);}}const bw=maxX-minX+1,bh=maxY-minY+1;if(n>=2&&n<=45&&Math.max(bw,bh)/Math.min(bw,bh)<=3&&n/(bw*bh)>=.3)found.push({x:sx/n,y:sy/n});}
    return {data,candidates:found.slice(0,100)};
  }
  function poseAudioEstimates(input,records,width){
    const visible=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.visibility>=.65&&(p.presence==null||p.presence>=.65);
    const result=input.map(e=>{
      if(e.status!=='pending'||e.origin==='manual'||e.origin==='manual-review')return {...e};
      const before=M.nearestFrame(records,e.t-.1,.05),after=M.nearestFrame(records,e.t+.1,.05);
      if(!before||!after||before.t>=e.t||after.t<=e.t||e.t-before.t>.15||after.t-e.t>.15)return {...e};
      if(![before,after].every(f=>[0,1].every(side=>[11,12,23,24].every(k=>visible(f.poses?.[side]?.[k])))))return {...e};
      const speed=[0,1].map(side=>Math.max(...[15,16].map(k=>{
        const a=before.poses[side],b=after.poses[side];if(!visible(a[k])||!visible(b[k]))return 0;
        const ax=a[k].x-(a[11].x+a[12].x)/2,ay=a[k].y-(a[11].y+a[12].y)/2,bx=b[k].x-(b[11].x+b[12].x)/2,by=b[k].y-(b[11].y+b[12].y)/2;
        return Math.hypot(bx-ax,by-ay)/(after.t-before.t);
      })));
      const side=speed[0]>speed[1]?0:1;if(speed[side]<width*.1||speed[side]<2*speed[1-side])return {...e};
      const player=side===0?'a':'b',reason='腕の動きからの仮判定です。ボールとの接触は未確認です';
      return {...e,status:'auto',player,suggestedPlayer:player,reviewRequired:true,provenance:'pose-audio-estimate-v1',reviewReason:reason,evidence:reason};
    });
    const ordered=result.filter(e=>e.status!=='ignored').slice().sort((a,b)=>a.t-b.t),rejected=new Set();
    for(let i=1;i<ordered.length;i++){const a=ordered[i-1],b=ordered[i],dt=b.t-a.t;
      if(dt<.15||(dt<=2&&a.player&&a.player===b.player&&['auto','confirmed'].includes(a.status)&&['auto','confirmed'].includes(b.status)))for(const e of [a,b])if(['pose-audio-estimate-v1','rally-alternation-estimate-v1'].includes(e.provenance))rejected.add(e.id);
    }
    return result.map(e=>rejected.has(e.id)?{...e,status:'pending',player:null,reviewRequired:true,reviewReason:'打球の間隔または打者の順序を確認してください'}:e);
  }
  let checkpointDB=null;
  async function checkpointStore(){
    if(!window.indexedDB)return null;
    if(!checkpointDB)checkpointDB=new Promise((resolve,reject)=>{
      const request=window.indexedDB.open('frescoMotionProgress',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('chunks',{keyPath:['job','index']});
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    }).catch(e=>{checkpointDB=null;throw e;});
    return checkpointDB;
  }
  async function readCheckpoint(job){
    const db=await checkpointStore();if(!db)return [];
    return new Promise((resolve,reject)=>{
      const request=db.transaction('chunks','readonly').objectStore('chunks').getAll(window.IDBKeyRange.bound([job,0],[job,Infinity]));
      request.onerror=()=>reject(request.error);request.onsuccess=()=>{
        const output=[];for(const chunk of request.result){if(chunk.index!==output.length)break;output.push(...chunk.frames);}resolve(output);
      };
    });
  }
  async function writeCheckpoint(job,index,records){
    const db=await checkpointStore();if(!db)return false;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').put({job,index,frames:records,updatedAt:Date.now()});
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('途中保存が中断されました'));
    });return true;
  }
  async function findCheckpoint(videoSource,mode){
    const db=await checkpointStore();if(!db)return null;
    const identity=s=>JSON.stringify([s.name,s.size,s.lastModified,s.width,s.height,Math.round(s.duration*100)]);
    const keys=await new Promise((resolve,reject)=>{const r=db.transaction('chunks','readonly').objectStore('chunks').getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const matches=[];
    for(const [job,index] of keys){
      if(index!==0)continue;
      let meta;try{meta=JSON.parse(job);}catch{continue;}
      if(meta.version!==4||meta.mode!==mode||identity(meta.source)!==identity(videoSource))continue;
      const chunk=await new Promise((resolve,reject)=>{const r=db.transaction('chunks','readonly').objectStore('chunks').get([job,0]);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      if(chunk)matches.push({meta,updatedAt:chunk.updatedAt||0});
    }
    return matches.sort((a,b)=>b.updatedAt-a.updatedAt)[0]?.meta||null;
  }
  async function clearCheckpoints(){
    const db=await checkpointStore();if(!db)return;
    await new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  }
  // Keep ball samples at 30 fps. Spend pose inference on contact windows,
  // with 5 fps posture updates elsewhere. Never change detail-mode sampling.
  function poseSchedule(start,count,hits,mode){
    const mask=new Uint8Array(count);
    for(let n=0;n<count;n+=mode==='simple'?6:2)mask[n]=1;
    if(mode==='simple')for(const hit of hits){
      if(!Number.isFinite(hit.t))continue;
      const first=Math.max(0,Math.ceil((hit.t-start-.18)*30));
      const last=Math.min(count-1,Math.floor((hit.t-start+.18)*30));
      for(let n=first+(first%2);n<=last;n+=2)mask[n]=1;
    }
    return mask;
  }
  async function run(){
    if(busy)return;
    const start=Number(panel.querySelector('[data-start]').value),duration=Number(panel.querySelector('[data-duration]').value);
    if(!regions[0]||!regions[1]||regions.some(r=>r.w<20||r.h<20)){say('まず映像から2人を選んでください');return;}
    if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0||start+duration>video.duration+.01){say('動画の中に収まる開始時刻と長さを指定してください');return;}
    const token=++serial;busy=true;callbacks.onProgress?.({phase:'motion',percent:(lastProgress=0),busy:true});controls.disabled=true;rows.inert=true;video.pause();clipEnd=null;
    if(viewHome){viewHome.append(view);viewHome.append(playback);viewHome.append(status);}say(uiMode==='simple'?'動画の音を調べています':'1 / 4：音を調べています');
    const runMode=uiMode,output=[],roi=regions.map(r=>({...r}));let previous=null,workingEvents=events.slice(),outcome='error',job=null,saved=0,storageFailed=false,screenLock=null;
    const persist=async()=>{if(!job||storageFailed||saved>=output.length)return;try{if(await writeCheckpoint(job,saved,output.slice(saved)))saved=output.length;else storageFailed=true;}catch(e){storageFailed=true;}};
    try{
      try{screenLock=await window.navigator?.wakeLock?.request('screen');}catch{}
      if(token!==serial)return;
      if(callbacks.analyzeAudio){const hits=await callbacks.analyzeAudio(p=>{if(token===serial){say(`${uiMode==='simple'?'動画の音を解析中':'1 / 4：音を調べています'} ${Math.round(Math.max(0,Math.min(1,p))*100)}%`);callbacks.onProgress?.({phase:'motion',percent:(lastProgress=Math.round(Math.max(0,Math.min(1,p))*15)),busy:true});}},()=>token===serial);
        if(token!==serial)return;
        const manual=events.filter(e=>e.status==='confirmed'||e.origin==='manual-review'||e.origin==='manual'||['attack','defense'].includes(e.shotOverride));
        workingEvents=(hits||[]).filter(h=>!manual.some(e=>Math.abs(e.t-h.t)<.01)).map((h,i)=>({id:`audio-${i}`,t:h.t,player:null,status:'pending',origin:'audio'})).concat(manual);
      }
      say(uiMode==='simple'?'映像を解析する準備をしています':'2 / 4：骨格を読み取る準備をしています。初回は通信が必要です');
      let detector=null;
      const cv=document.createElement('canvas');const scale=Math.min(1,640/video.videoWidth);cv.width=Math.round(video.videoWidth*scale);cv.height=Math.round(video.videoHeight*scale);const cx=cv.getContext('2d',{willReadFrequently:true});
      const pixelDetector=window.FrescoBallTracker?.createDetector(cv.width,cv.height,roi.map(r=>({x:r.x*scale,y:r.y*scale,w:r.w*scale,h:r.h*scale})));
      // 原寸の局所探索。次フレームで球が来るはずの位置（検出器の予測）と、打音直後の打者の手首の周りだけ、
      // 縮小前の画素で小窓を切り出して同じ規則を当てる。窓は前フレームで同じ位置を切り出しておき差分を取る。
      const hi=document.createElement('canvas'),hiCtx=hi.getContext('2d',{willReadFrequently:true}),unitPx=video.videoWidth/1920;
      let watch=[];
      const window_=(cxp,cyp,size,exclude)=>{const w=Math.round(size*unitPx),h=w,x=Math.round(Math.max(0,Math.min(video.videoWidth-w,cxp-w/2))),y=Math.round(Math.max(0,Math.min(video.videoHeight-h,cyp-h/2)));if(w<8||h<8)return;watch.push({x,y,w,h,center:{x:cxp,y:cyp},exclude,data:null});};
      const cropWindow=win=>{if(hi.width!==win.w||hi.height!==win.h){hi.width=win.w;hi.height=win.h;}hiCtx.drawImage(video,win.x,win.y,win.w,win.h,0,0,win.w,win.h);return hiCtx.getImageData(0,0,win.w,win.h).data;};
      const count=Math.ceil(duration*30),schedule=poseSchedule(start,count,workingEvents,runMode);
      job=JSON.stringify({version:4,source,roi,start,duration,mode:runMode,hits:workingEvents.map(e=>e.t).sort((a,b)=>a-b)});
      try{
        const stored=await readCheckpoint(job);if(token!==serial)return;
        if(stored.length<=count&&stored.every((f,i)=>Math.abs(f.t-(start+i/30))<.001&&Array.isArray(f.poses)&&Array.isArray(f.ballCandidates))){for(const frame of stored)output.push(frame);saved=stored.length;}
      }catch(e){storageFailed=true;}
      if(output.length&&output.length<count){await seek(output.at(-1).t);if(token!==serial)return;cx.drawImage(video,0,0,cv.width,cv.height);previous=cx.getImageData(0,0,cv.width,cv.height).data;pixelDetector?.detect(previous,output.at(-1).t);}
      const resumed=output.length;
      if(output.length<count){detector=await model();if(token!==serial)return;}
      // 高精度の球検出モデル（PC の Chrome・任意）。予測位置の小窓で規則ベースが何も見つけないときだけ当てる。
      let teacher=null,teacherCanvas=null,teacherCtx=null,teacherCalls=0,teacherHits=0;
      if(callbacks.teacher&&pixelDetector&&output.length<count){
        try{say('高精度の球検出モデルを準備しています。初回は通信が必要です');teacher=await callbacks.teacher(p=>{if(token===serial)say(`高精度の球検出モデルを取得中 ${Math.round(p*100)}%`);});if(token!==serial)return;
          if(teacher){teacherCanvas=document.createElement('canvas');teacherCanvas.width=teacherCanvas.height=teacher.size;teacherCtx=teacherCanvas.getContext('2d',{willReadFrequently:true});}
        }catch(e){teacher=null;say(`高精度モデルは使えません：${e.message}`);}
      }
      const began=Date.now();
      const crops=roi.map(r=>{const c=document.createElement('canvas');c.width=Math.max(8,Math.min(256,Math.round(512*r.w/r.h)));c.height=Math.max(8,Math.min(512,Math.round(c.width*r.h/r.w)));return {canvas:c,context:c.getContext('2d')};});
      for(let n=output.length;n<count;n++){
        if(token!==serial)return;const t=start+n/30;await seek(t);if(token!==serial)return;
        const samplePose=!!schedule[n],poses=!samplePose&&output.length?output.at(-1).poses:[];
        if(samplePose)for(let person=0;person<roi.length;person++){
          const r=roi[person],{canvas:crop,context:cropContext}=crops[person];
          cropContext.drawImage(video,r.x,r.y,r.w,r.h,0,0,crop.width,crop.height);
          const result=detector.detect(crop);
          poses.push((result.landmarks[0]||[]).map(p=>({x:r.x+p.x*r.w,y:r.y+p.y*r.h,visibility:p.visibility,presence:p.presence})));result.close?.();
        }
        if(n%6===0||n===count-1){
          const elapsed=(Date.now()-began)/1000,remaining=n>resumed&&elapsed>5?Math.ceil(elapsed/(n-resumed)*(count-n)):null;
          const message=`速度・打数は確認できます。${resumed?'続きから':''}軌跡を準備中${remaining!=null?'・残り約'+Math.ceil(remaining/60)+'分':''}${storageFailed?'・途中保存できません':''}${teacher?`・高精度モデル ${teacherHits}/${teacherCalls}`:''}`;
          callbacks.onProgress?.({phase:'motion',percent:(lastProgress=15+Math.round((n+1)/count*80)),busy:true,message});previewFrame={t,poses};
          say(`映像を解析中 ${Math.round((n+1)/count*100)}%：完了すると骨格とボールの軌跡が動画に加わります。速度・打数は先に確認できます。`);
          draw();await new Promise(r=>setTimeout(r,0));if(token!==serial)return;
        }
        cx.drawImage(video,0,0,cv.width,cv.height);const scaledPoses=poses.map(ps=>ps.map(p=>({...p,x:p.x*scale,y:p.y*scale})));const data=cx.getImageData(0,0,cv.width,cv.height).data;const candidate=pixelDetector?{data,candidates:pixelDetector.detect(data,t,scaledPoses)}:balls(cv,previous,scaledPoses);previous=candidate.data;
        const ballCandidates=candidate.candidates.map(p=>({x:p.x/scale,y:p.y/scale}));
        if(pixelDetector&&window.FrescoBallTracker?.refineLocal){
          const extra=[];
          for(const win of watch){if(!win.data)continue;const found=window.FrescoBallTracker.refineLocal({data:cropWindow(win),prev:win.data,width:win.w,height:win.h,origin:{x:win.x,y:win.y},center:win.center,exclude:win.exclude,unit:unitPx});
            for(const p of found)if(!ballCandidates.some(c=>Math.hypot(c.x-p.x,c.y-p.y)<18*unitPx)&&!extra.some(e=>Math.hypot(e.x-p.x,e.y-p.y)<18*unitPx))extra.push({x:p.x,y:p.y,local:true});}
          // 規則ベースが窓の中に何も見つけなかったときだけ、同じ中心の 192px 窓（学習時と同じ大きさ）を高精度モデルに見せる
          if(teacher)for(const win of watch){if(!win.data)continue;const cxp=win.center.x,cyp=win.center.y;
            if(extra.some(e=>Math.hypot(e.x-cxp,e.y-cyp)<win.w)||ballCandidates.some(c=>Math.hypot(c.x-cxp,c.y-cyp)<win.w))continue;
            const size=Math.round(192*unitPx),x0=Math.round(Math.max(0,Math.min(video.videoWidth-size,cxp-size/2))),y0=Math.round(Math.max(0,Math.min(video.videoHeight-size,cyp-size/2)));
            teacherCtx.drawImage(video,x0,y0,size,size,0,0,teacher.size,teacher.size);teacherCalls++;
            let hit=null;try{hit=await teacher.detect(teacherCtx.getImageData(0,0,teacher.size,teacher.size));}catch(e){hit=null;}
            if(token!==serial)return;
            if(hit&&hit.conf>=(teacher.conf??.5)){const px=x0+hit.x*size,py=y0+hit.y*size;teacherHits++;if(!extra.some(e=>Math.hypot(e.x-px,e.y-py)<18*unitPx))extra.push({x:px,y:py,local:true,teacher:true});}}
          if(extra.length){pixelDetector.adopt(extra.map(p=>({x:p.x*scale,y:p.y*scale})),t);ballCandidates.push(...extra.map(p=>({x:p.x,y:p.y})));}
          // 次フレーム用の窓: 予測位置、無ければ打音直後（0.2秒）の手首
          watch=[];const tn=t+1/30;
          // 関節の周りは除外（手首は小さく、それ以外は大きく）。ラケット面の球は手首から離れているので残る
          const joints=poses.flatMap(ps=>(ps||[]).map((p,k)=>p&&p.visibility>=.5?{x:p.x,y:p.y,r:(k===15||k===16?12:30)*unitPx}:null).filter(Boolean))
            .concat(poses.flatMap(ps=>[[11,12],[11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[11,13],[12,14],[13,15],[14,16]].map(([a,b])=>{const p=ps?.[a],q=ps?.[b];return p&&q&&p.visibility>=.5&&q.visibility>=.5?{x1:p.x,y1:p.y,x2:q.x,y2:q.y,r:28*unitPx}:null;}).filter(Boolean)));
          for(const q of pixelDetector.predictions(tn))window_(q.x/scale,q.y/scale,128,joints);
          if(!watch.length&&workingEvents.some(e=>e.t<=tn+1e-6&&tn-e.t<=.2))for(const ps of poses)for(const k of [15,16]){const wr=ps?.[k];if(wr&&wr.visibility>=.5)window_(wr.x,wr.y,160,joints);}
          for(const win of watch)win.data=cropWindow(win);
        }
        output.push({t,poseSampleTime:!samplePose&&output.length?output.at(-1).poseSampleTime:t,poses,ballCandidates});
        if(output.length-saved>=90||n===count-1){await persist();if(token!==serial)return;}
      }
      if(token!==serial)return;callbacks.onProgress?.({phase:'motion',percent:(lastProgress=96),busy:true});say(uiMode==='simple'?'解析結果をまとめています':'3 / 4：打音と2人の動きを照合しています');await new Promise(r=>setTimeout(r,0));if(token!==serial)return;
      const nextTracks=window.FrescoBallTracker?window.FrescoBallTracker.track(output,video.videoWidth,regions):M.track(output,video.videoWidth).filter(trackForPair),observedTracks=nextTracks.map(tr=>({...tr,points:tr.points.filter(p=>!p.predicted)})),nextEvents=M.autoReview(workingEvents,output,observedTracks,video.videoWidth,currentDistance);
      if(token!==serial)return;frames=output;tracks=nextTracks;events=poseAudioEstimates(Array.isArray(nextEvents)?nextEvents:nextEvents.events,output,video.videoWidth);if(window.FrescoShots)events=window.FrescoShots.inferAlternation(events,output,video.videoWidth);
      if(window.FrescoVideoQuality){const reviewed=window.FrescoVideoQuality.review(callbacks.measureEvents?callbacks.measureEvents(events):M.speeds(events,currentDistance).map(e=>({...e,speed:e.averageKmh})));const bad=new Set(reviewed.hits.filter(e=>e.qualityExcluded).map(e=>e.id));events=events.map(e=>bad.has(e.id)&&e.status==='auto'?{...e,suspicious:true,reviewRequired:true,reviewReason:'打球は数えています。前後より速度が大きく違うため確認できます'}:e);}
      previewFrame=null;reviewIndex=0;showAll=false;renderEvents();changed();await seek(Math.max(0,(events.find(e=>e.status==='pending')?.t??start)-.25));if(token!==serial)return;draw();
      say(uiMode==='simple'?'解析が完了しました。結果と動画を保存できます':'4 / 4：解析完了。判断が難しかった音だけ、映像の下で見直せます。');conditions.open=uiMode==='simple';viewHome.scrollIntoView({behavior:'smooth',block:'start'});callbacks.onProgress?.({phase:'motion',percent:(lastProgress=100),busy:true});outcome='complete';callbacks.onComplete?.(snapshot());
    }catch(e){outcome='error';if(token===serial)say(`解析できませんでした：${e.message}`);}finally{await persist();if(screenLock)try{await screenLock.release();}catch{}if(token===serial){previewFrame=null;busy=false;callbacks.onProgress?.({phase:'motion',percent:lastProgress,busy:false,status:outcome,...(storageFailed?{message:outcome==='complete'?'解析は完了しました。途中保存は利用できませんでした':saved?'途中保存に失敗しました。最後に保存できた位置から再開します':'途中保存できませんでした。次回は最初から解析します'}:{})});controls.disabled=false;rows.inert=false;draw();}}
  }
  function restore(raw){
    if(busy)throw new Error('解析が終わってから記録を戻してください');
    const data=M.normalize(raw,source);frames=data.frames;regions=data.regions||[];events=data.events;currentDistance=data.settings.distanceM;
    tracks=window.FrescoBallTracker?window.FrescoBallTracker.track(frames,source.width,regions):M.track(frames,source.width).filter(trackForPair);events=M.evidence(events,frames,tracks.map(tr=>({...tr,points:tr.points.filter(p=>!p.predicted)})),source.width);refreshTracks();reviewIndex=0;
    if(panel){panel.querySelector('[data-distance]').value=currentDistance;renderEvents();draw();}
    callbacks.onDistance?.(currentDistance);return snapshot();
  }
  function open(options){
    reset();detailNodes=[];callbacks=options;video=options.video;source=options.source;currentDistance=M.distance(options.distance);
    panel=el('section','',options.host);panel.className='motion-review';
    el('h3','2人の骨格と軌跡を見る',panel);
    el('p','2人の動きと球の軌跡を、映像で確かめられます。',panel);
    const reviewHelp=el('p','気になる場面を再生し、必要なところだけ判定を直せます。',panel);detailNodes.push(reviewHelp);
    viewHome=el('div','',panel);view=el('canvas','',viewHome);view.style.cssText='width:auto;max-width:100%;max-height:36svh;display:block;margin:auto;object-fit:contain;touch-action:none;background:#000';view.setAttribute('aria-label','選手の枠。四隅をドラッグして大きさを調整し、枠の内側をドラッグして移動します');
    playback=el('div','',viewHome);
    button('再生 / 一時停止',playback,()=>{if(busy)return;clipEnd=null;if(video.paused)video.play().catch(e=>say(e.message));else video.pause();});
    for(const [label,delta] of [['5秒戻る',-5],['0.1秒戻る',-.1],['0.1秒進む',.1],['5秒進む',5]])button(label,playback,()=>{if(!busy){video.pause();seek(Math.max(0,Math.min(video.duration-.001,video.currentTime+delta))).then(draw).catch(e=>say(e.message));}});
    clockLabel=el('p',`${timeText(video.currentTime)} / ${timeText(video.duration)}`,playback);clockLabel.setAttribute('aria-live','off');
    timeline=el('input','',playback);timeline.type='range';timeline.min=0;timeline.max=video.duration;timeline.step=.05;timeline.value=video.currentTime;timeline.style.width='100%';timeline.setAttribute('aria-label','動画の再生位置');timeline.oninput=()=>{if(busy)return;video.pause();clipEnd=null;video.currentTime=Number(timeline.value);};
    const displayOptions=el('details','',playback);detailNodes.push(displayOptions);el('summary','表示を調整する',displayOptions);for(const [text,key]of [['骨格を表示','skeleton'],['球の軌跡候補を表示','ball']]){const label=el('label','',displayOptions),toggle=el('input','',label);toggle.type='checkbox';toggle.checked=true;toggle.dataset.overlay=key;el('span',text,label);toggle.onchange=()=>{if(key==='skeleton')showSkeleton=toggle.checked;else showBall=toggle.checked;draw();};}
    el('small','球の線は対象2人の間で動いた候補です。短い見失いは前後の位置から補い、推定部分は破線で表示します。長く見失うと線を止めます。',displayOptions);
    conditions=el('details','',panel);conditions.open=true;el('summary','解析条件を変更する',conditions);const selector=el('div','',conditions);el('h4','1. 解析する2人を選ぶ',selector);
    el('p','2つの枠を選手に合わせてください。四隅の丸を指で動かすと大きさが変わり、枠の内側を動かすと位置が変わります。頭から足まで入れ、隣の選手を含めないでください。',selector);
    for(let i=0;i<2;i++)button(`${i+1}人目を選ぶ`,selector,()=>{if(busy)return;video.pause();reviewSection.open=false;viewHome.append(view);viewHome.append(playback);selecting=i;say(`${i+1}人目の枠の四隅、または内側を動かしてください`);draw();});
    const xy=e=>{const r=view.getBoundingClientRect();return {x:Math.max(0,Math.min(view.width,(e.clientX-r.left)*view.width/r.width)),y:Math.max(0,Math.min(view.height,(e.clientY-r.top)*view.height/r.height))};};
    view.onpointerdown=e=>{
      if(busy||reviewSection.open||origin)return;const p=xy(e),scale=view.width/(view.getBoundingClientRect().width||view.width),radius=24*scale;
      let hit=null,best=Infinity;
      regions.forEach((r,i)=>{for(const [key,x,y]of [['nw',r.x,r.y],['ne',r.x+r.w,r.y],['sw',r.x,r.y+r.h],['se',r.x+r.w,r.y+r.h]]){const d=Math.hypot(p.x-x,p.y-y);if(d<=radius&&d<best){hit={i,key};best=d;}}});
      if(!hit){const order=selecting===1?[1,0]:[0,1];for(const i of order){const r=regions[i];if(r&&p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h){hit={i,key:'move'};break;}}}
      if(!hit)return;video.pause();selecting=hit.i;serial++;origin={...hit,p,start:{...regions[hit.i]},pointer:e.pointerId};view.setPointerCapture(e.pointerId);e.preventDefault?.();
    };
    view.onpointermove=e=>{
      if(!origin||origin.pointer!==e.pointerId||busy)return;const p=xy(e),{start:r,key}=origin,dx=p.x-origin.p.x,dy=p.y-origin.p.y,min=20;
      if(key==='move')regions[origin.i]={...r,x:Math.max(0,Math.min(view.width-r.w,r.x+dx)),y:Math.max(0,Math.min(view.height-r.h,r.y+dy))};
      else{let l=r.x,t=r.y,right=r.x+r.w,bottom=r.y+r.h;if(key.includes('w'))l=Math.max(0,Math.min(right-min,r.x+dx));if(key.includes('e'))right=Math.min(view.width,Math.max(l+min,r.x+r.w+dx));if(key.includes('n'))t=Math.max(0,Math.min(bottom-min,r.y+dy));if(key.includes('s'))bottom=Math.min(view.height,Math.max(t+min,r.y+r.h+dy));regions[origin.i]={x:l,y:t,w:right-l,h:bottom-t};}draw();
    };
    view.onpointercancel=e=>{if(!origin||origin.pointer!==e.pointerId)return;regions[origin.i]=origin.start;origin=null;draw();};
    view.onpointerup=e=>{
      if(!origin||origin.pointer!==e.pointerId||busy)return;view.onpointermove(e);const edited=JSON.stringify(regions[origin.i])!==JSON.stringify(origin.start);origin=null;
      if(edited){runButton.textContent='選んだ2人で自動解析';frames=[];tracks=[];drawingTracks=[];events=events.map(e=>({...e,status:'pending',player:null,suggestedPlayer:null,evidence:''}));renderEvents();changed();}
      say('枠が2人の全身に合ったら「選んだ2人で自動解析」を押してください。');draw();
    };
    controls=el('fieldset','',conditions);controls.style.border='0';el('legend','2. 動きを解析する',controls);
    const advanced=el('details','',controls);detailNodes.push(advanced);el('summary','詳しく調整する',advanced);const input=(label,key,value,min,max)=>{const l=el('label',label,advanced),i=el('input','',l);i.type='number';i.value=value;i.min=min;i.max=max;i.step='any';i.dataset[key]='';i.style.width='90px';return i;};
    input('開始する秒数 ','start',0,0,video.duration);
    input('解析する長さ（秒） ','duration',video.duration,.1,video.duration);
    el('p','速度・打数は先に確認できます。この追加解析が完了すると、動画に骨格とボールの軌跡が表示されます。ボールが読み取れない区間には軌跡は出ません。初回は準備に通信しますが、動画は送信しません。',controls);
    const d=input('2人の距離（m） ','distance',currentDistance,7,100);d.step='0.1';d.onchange=()=>{try{const value=M.distance(d.value);if(value<7||Math.abs(value*10-Math.round(value*10))>1e-8)throw new Error('距離は7.0m以上、0.1m刻みで入力してください');currentDistance=value;renderEvents();options.onDistance?.(currentDistance);changed();}catch(e){d.value=currentDistance;say(`${e.message}。${currentDistance}m に戻しました`);}};
    const runButton=button('選んだ2人で自動解析',controls,run);
    el('p','解析中は画面を開いたままお待ちください。途中経過はこの端末に自動保存します。中断後は同じ動画を開くと前回の2人を復元して再開できます。',controls);
    button('解析を中止',panel,()=>{if(!busy)return;serial++;previewFrame=null;busy=false;callbacks.onProgress?.({phase:'motion',percent:lastProgress,busy:false,status:'cancelled'});controls.disabled=false;rows.inert=false;draw();say('解析を中止しました。完了していた結果は残しています');});
    status=el('p','四隅の丸を動かして2人の全身に枠を合わせてください',viewHome);status.setAttribute('role','status');
    const posture=el('p','',panel);posture.dataset.posture='';detailNodes.push(posture);
    reviewSection=el('details','',panel);detailNodes.push(reviewSection);el('summary','打球の判定を確認・修正する',reviewSection);reviewSection.ontoggle=()=>renderEvents();
    el('p','気になる判定だけ、映像を見ながら修正できます。',reviewSection);rows=el('div','',reviewSection);
    const further=el('details','',panel);detailNodes.push(further);el('summary','さらに詳しく調整する',further);const manual=el('details','',further);el('summary','見つからなかった打球を追加する',manual);
    el('p','上の映像を打った瞬間で止めて、打った人を選んでください。',manual);
    for(const player of ['a','b'])button(`${player==='a'?'1':'2'}人目の打球を追加`,manual,()=>{if(busy)return;events.push({id:`manual-${Date.now()}-${events.length}`,t:video.currentTime,player,status:'confirmed',origin:'manual'});reviewIndex=events.slice().sort((a,b)=>a.t-b.t).findIndex(e=>e.id===events.at(-1).id);renderEvents();changed();});
    const notes=el('details','',further);el('summary','表示される数値について',notes);
    el('p','骨格の角度は画面上の推定で、腰の立体的な回転ではありません。球の軌跡は赤い球の候補で、誤って表示されることがあります。短い途切れや打球付近を、前後の軌跡・手首の位置から推定した部分は破線です。球速は選手間距離と打球間隔に、音の到達時間と空気抵抗のモデルを適用した推定初速です。実際の打点間距離とは異なる場合があります。',notes);
    button('途中保存をすべて削除',further,async()=>{if(busy)return;try{await clearCheckpoints();say('途中保存を削除しました。完成した解析結果は残っています');}catch(e){say('途中保存を削除できませんでした');}});
    const backup=el('details','',further);el('summary','記録のバックアップ・復元',backup);
    el('p','機種変更や記録の消失に備える解析結果の控えです。元動画は含まれません。通常の解析には必要ありません。',backup);
    button('バックアップを保存',backup,()=>{if(busy){say('解析が終わってから保存してください');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot())],{type:'application/json'}));const a=el('a');a.href=url;a.download='frescoball-motion.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    const label=el('label','バックアップから戻す ',backup),file=el('input','',label);file.type='file';file.accept='.json,application/json';file.onchange=async()=>{const token=serial;try{if(busy)throw new Error('解析を中止してから戻してください');if(!file.files[0])return;const raw=JSON.parse(await file.files[0].text());if(token!==serial||busy)return;restore(raw);changed();if(frames.length)await seek(frames[0].t);if(token!==serial)return;draw();say('記録を戻しました');}catch(e){if(token===serial)say(e.message);}};
    events=(options.hits||[]).map((h,i)=>({id:`audio-${i}`,t:h.t,player:null,status:'pending',origin:'audio'}));
    if(options.initialData){try{restore(options.initialData);say('保存していた解析を表示しました');}catch(e){say(`保存した解析を戻せませんでした：${e.message}`);}}
    if(!regions.length)regions=[.08,.7].map(x=>({x:source.width*x,y:source.height*.2,w:source.width*.22,h:source.height*.65}));
    renderEvents();draw();setMode(options.mode||uiMode);if(frames.length&&uiMode==='detail')conditions.open=false;panel.scrollIntoView({behavior:'smooth',block:'start'});
    const opened=serial;
    if(!frames.length)findCheckpoint(source,uiMode).then(savedJob=>{
      if(!savedJob||savedJob.mode!==uiMode||opened!==serial||busy||selecting!=null)return;
      regions=savedJob.roi;panel.querySelector('[data-start]').value=savedJob.start;panel.querySelector('[data-duration]').value=savedJob.duration;
      runButton.textContent='前回の続きから解析';say('前回選んだ2人を復元しました。続きから解析できます。範囲を選び直すと新しく解析します。');draw();
    }).catch(()=>{if(opened===serial&&!busy)say('途中保存を読み込めません。新しく解析することはできます。');});

  }
  document.getElementById('upVideo').addEventListener('timeupdate',()=>{if(clipEnd!=null&&video?.currentTime>=clipEnd){video.pause();clipEnd=null;}if(!busy)draw();});
  function setMode(mode){if(!['simple','detail'].includes(mode))throw new Error('表示モードが不正です');uiMode=mode;if(!panel)return;for(const n of detailNodes)n.hidden=mode==='simple';if(conditions){conditions.children[0].hidden=mode==='simple';if(mode==='simple')conditions.open=true;}if(mode==='simple'&&reviewSection){reviewSection.open=false;if(viewHome){viewHome.append(view);viewHome.append(playback);}}draw();}
  function openReview(){if(!panel||busy)return false;setMode('detail');reviewSection.open=true;renderEvents();reviewSection.scrollIntoView({behavior:'smooth',block:'start'});return true;}
  async function inspectTime(t){
    if(!panel||busy||!Number.isFinite(t))return false;const token=serial;setMode('detail');reviewSection.open=true;showAll=true;const ordered=events.slice().sort((a,b)=>a.t-b.t);reviewIndex=ordered.reduce((best,e,i)=>Math.abs(e.t-t)<Math.abs(ordered[best].t-t)?i:best,0);renderEvents();video.pause();clipEnd=null;await seek(Math.max(0,Math.min(video.duration-.001,t-.25)));if(token!==serial)return false;draw();rows.scrollIntoView({behavior:'smooth',block:'start'});return true;
  }
  function setDistance(value){if(!panel)return;currentDistance=M.distance(value);panel.querySelector('[data-distance]').value=currentDistance;renderEvents();changed();}
  return {open,reset,setDistance,snapshot,restore,drawOverlay,inspectTime,openReview,setMode,range:()=>frames.length?{start:frames[0].t,end:frames.at(-1).t}:null,isBusy:()=>busy};
})();
