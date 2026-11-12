/* One preview and recorder path for stories, original-aspect movies and stills. */
window.FrescoShare = (() => {
  'use strict';
  const C=window.FrescoShareCore;
  const edges=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
  let active=null;
  const speakerOwners=new WeakMap();
  function cancel(){active?.abort();const dialog=document.getElementById('sharePreview');if(dialog){dialog.close();dialog.remove();}active=null;}
  function seek(v,t,signal){return new Promise((resolve,reject)=>{
    const done=error=>{clearTimeout(timer);v.removeEventListener('seeked',ok);v.removeEventListener('error',bad);signal?.removeEventListener('abort',aborted);error?reject(error):resolve();};
    const ok=()=>done(),bad=()=>done(new Error('動画を読み込めませんでした')),aborted=()=>done(new Error('保存を中止しました'));
    const timer=setTimeout(()=>done(new Error('動画の読み込みに時間がかかっています。再度お試しください')),15000);
    if(signal?.aborted){aborted();return;}if(Math.abs(v.currentTime-t)<.002&&v.readyState>=2){ok();return;}
    v.addEventListener('seeked',ok,{once:true});v.addEventListener('error',bad,{once:true});signal?.addEventListener('abort',aborted,{once:true});try{v.currentTime=t;}catch(error){done(error);}
  });}
  function captureWindow(duration,time,image,measurementSource,motion,length,maxLength){
    if(!image)return {...C.windowFor(duration,time,length,maxLength),captureTime:time,statsLabel:'この動画区間の記録'};
    if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(time)||time<0||time>=duration)throw new Error('画像にするフレームを動画内の時刻で指定してください');
    const r=measurementSource==='confirmed'?C.motionRange(motion):null;
    const useRange=r&&r.start>=0&&r.end<=duration;
    return {start:useRange?r.start:0,end:useRange?r.end:duration,captureTime:time,statsLabel:useRange?'解析した区間の記録':'動画全体の記録'};
  }
  function skeleton(g,motion,t){
    const f=window.FrescoMotion.nearestFrame(motion?.frames||[],t,.09);if(!f)return false;
    g.lineWidth=Math.max(3,motion.source.width/400);let drawn=false;
    f.poses.forEach((ps,i)=>{g.strokeStyle=i?'#FFD23F':'#16E6C3';for(const [a,b]of edges)if(ps[a]?.visibility>=.65&&ps[b]?.visibility>=.65&&(ps[a].presence==null||ps[a].presence>=.65)&&(ps[b].presence==null||ps[b].presence>=.65)){g.beginPath();g.moveTo(ps[a].x,ps[a].y);g.lineTo(ps[b].x,ps[b].y);g.stroke();drawn=true;}});
    return drawn;
  }
  function trajectory(g,tracks,t,width,hits){
    let drawn=false;
    if(window.FrescoBallTracker?.drawTrails)drawn=window.FrescoBallTracker.drawTrails(g,tracks,width,t,hits)||drawn;
    else{const points=window.FrescoBallTracker?(window.FrescoBallTracker.at(tracks,t)?.trail||[]):C.trajectoryAt(tracks,t);if(points.length>=2)drawn=window.FrescoBallTracker?.drawTrail(g,points,width,t,hits)||drawn;}
    // 打音の位置に広がる輪。観測点が近くにある打音だけ（音だけでは場所が決まらない）
    if(window.FrescoBallTracker?.drawImpacts)drawn=window.FrescoBallTracker.drawImpacts(g,window.FrescoBallTracker.impactMarkers(hits,tracks,t),width,t,hits)||drawn;
    return drawn;
  }
  function rrect(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
  // 解析条件の1行。1行に収まらないときだけ「｜」で2行に分ける（どちらも24px）。
  function conditionLines(g,text,maxWidth){
    if(g.measureText(text).width<=maxWidth)return [text];
    const cut=text.lastIndexOf('｜');if(cut<0)return [text];
    return [text.slice(0,cut),text.slice(cut)];
  }
  // 左右どちらかに打球のある帯だけを、全体の帯と同じ区切り・順序で返す
  function bandRows(left,right){return left.map((b,i)=>({label:b.label,l:b.count,r:right[i].count})).filter(r=>r.l||r.r);}
  function conditionText(c,total,withSpeed,distance,varied){
    c=c||{};const v=x=>x==null||x===''?'--':x;
    const ai=c.ai?`AI判定あり（除外${c.aiRejected||0}）`:'AI判定なし';
    return `解析条件：感度${v(c.sens)}・声カット${v(c.voiceCut)}・${ai}・打音${c.onsets==null?total:c.onsets}・速度なし${Math.max(0,total-withSpeed)}｜選手間${varied?'区間ごと':distance?distance+'m':'未設定'}`;
  }
  // 集計の根拠（statsLabel は集計した範囲）。ストーリーズ下部に1行で残す。
  function basisText(state,lr){
    const range=state.statsLabel||'この動画区間の記録';
    return `${range}・${state.measurementSource==='confirmed'?'映像で確認した記録（推定初速）':'音から求めた推定初速'}${lr?`・左右は映像で確認${lr.estimated?`（うち推定${lr.estimated}打）`:''}`:''}`;
  }
  // ストーリーズの「動かない部分」（見出し・凡例・数字・分布・根拠・解析条件）。1回だけ別のキャンバスに描き、毎フレームは貼るだけにする。
  // 背景のぼかしは、小さいキャンバスに映像を縮めて描き、引き伸ばして作る（毎フレームの大きなぼかし処理をしない）。
  function storyCache(state,W,H,crop,stats){
    if(state.__story&&state.__story.W===W&&state.__story.H===H)return state.__story;
    const {record,start,end,title}=state,FONT='"Hiragino Sans", sans-serif',distance=record?.settings?.values?.distance;
    const summary=C.speedSummary(record?.hits||[],start,end),bands=summary.bands.filter(b=>b.count>0),legendH=state.showTrajectory?84:0;
    // 左右別の分布は、書き出しに使う記録が「映像で選手を確認した記録」（measurementSource==='confirmed'）で、左右が交互の推定の速度が1割以下のときだけ。それ以外は全体の分布。
    const lr=state.measurementSource==='confirmed'?C.speedSummarySides(record?.hits||[],start,end,record?.flip):null,sides=Boolean(lr?.reliable);
    const HEADER=150,NUM=192,TRUST=82,COND=120,distH=bands.length?58+(sides?44:0)+bands.length*40:60;
    const areaH=Math.max(360,Math.min(1000,H-HEADER-legendH-NUM-TRUST-distH-COND-30));
    const box=C.fit(crop.w,crop.h,0,HEADER,W,areaH);box.y=HEADER;
    // 映像が横長で高さに余りが出るときは、数字のカード・分布の行・セクション間を大きくして、空白が下に偏らないようにする
    const spare=Math.max(0,areaH-box.h+90),nb=bands.length;
    const cardExtra=Math.min(110,Math.round(spare*.3)),rowExtra=nb?Math.min(50,Math.floor(spare*.35/nb)):0;
    const pad=Math.min(200,Math.floor(Math.max(0,spare-cardExtra-rowExtra*nb)/3));
    const L={pad,cardH:170+cardExtra,rowH:40+rowExtra,legendY:box.y+box.h,numY:box.y+box.h+legendH+22+pad};
    const layer=document.createElement('canvas');layer.width=W;layer.height=H;const g=layer.getContext('2d');
    g.textAlign='left';g.fillStyle='#16e6c3';g.font=`700 28px ${FONT}`;g.fillText('FRESCOBALL',64,56);
    g.fillStyle='#fff';g.font=`800 60px ${FONT}`;g.fillText(title||'今日のラリー',64,126,W-128);
    // 凡例は映像の外に置く（1080幅で26px）。
    if(state.showTrajectory){
      const ly=L.legendY+50;g.font=`500 26px ${FONT}`;
      const items=[['映像で追えた球（色は速度）',null],['見失った区間の推定','#c58cff']];
      const widths=items.map(([t])=>64+g.measureText(t).width),gap=36;let x=64;
      items.forEach(([t,c],i)=>{
        let fill=c;if(!c){const gr=g.createLinearGradient(x,0,x+52,0);gr.addColorStop(0,'#4173ff');gr.addColorStop(.35,'#28cdf5');gr.addColorStop(.7,'#28daa1');gr.addColorStop(1,'#f1df46');fill=gr;}
        g.fillStyle=fill;rrect(g,x,ly-12,52,8,4);g.fill();
        g.fillStyle='#e6e1f4';g.fillText(t,x+64,ly);x+=widths[i]+gap;
      });
    }
    // 数字3つ：打数・平均・最高（ストーリーズの打数は総打数）
    const cellW=(952-48)/3,numY=L.numY,cells=[['打数',String(stats.total),''],['平均',stats.average==null?'--':stats.average.toFixed(0),stats.average==null?'':' km/h'],['最高',stats.max==null?'--':stats.max.toFixed(0),stats.max==null?'':' km/h']];
    cells.forEach(([label,value,unit],i)=>{
      const x=64+i*(cellW+24);g.fillStyle='rgba(255,255,255,.06)';rrect(g,x,numY,cellW,L.cardH,22);g.fill();g.strokeStyle='#4a3d6b';g.lineWidth=2;g.stroke();
      g.textAlign='center';g.fillStyle='#cfc5e6';g.font=`600 28px ${FONT}`;g.fillText(label,x+cellW/2,numY+44+(L.cardH-170)*.25);
      let vf=Math.round(92*(1+(L.cardH-170)/170*.5)),vw,uw;
      g.font=`600 28px ${FONT}`;uw=unit?g.measureText(unit).width:0;
      for(;;){g.font=`800 ${vf}px ${FONT}`;vw=g.measureText(value).width;if(vw+uw<=cellW-36||vf<=60)break;vf-=4;}
      const sx=x+cellW/2-(vw+uw)/2;g.textAlign='left';g.fillStyle=i===0?'#ffd23f':'#fff';g.font=`800 ${vf}px ${FONT}`;g.fillText(value,sx,numY+142+(L.cardH-170)*.75);
      if(unit){g.fillStyle='#cfc5e6';g.font=`600 28px ${FONT}`;g.fillText(unit,sx+vw,numY+142+(L.cardH-170)*.75);}
    });
    // 速度を出せた打球 n／m（n・分布・平均・最高は同じ母集団。m は打数と同じ）
    const trY=numY+L.cardH+18+L.pad;g.fillStyle='rgba(255,255,255,.06)';rrect(g,64,trY,952,64,14);g.fill();g.strokeStyle='#4a3d6b';g.lineWidth=2;g.stroke();
    g.fillStyle='#fff';g.font=`800 38px ${FONT}`;g.textAlign='center';g.fillText(`速度を出せた打球 ${summary.withSpeed}／${stats.total}`,540,trY+44,920);g.textAlign='left';
    // 球速分布（全体・打球のない帯は省く）
    const dy=trY+64+34+L.pad,condTop=H-COND;
    g.fillStyle='#fff';g.font=`700 32px ${FONT}`;g.fillText('球速分布',64,dy+26);
    g.fillStyle='#cfc5e6';g.font=`500 24px ${FONT}`;g.textAlign='right';g.fillText('単位：km/h',1016,dy+26);g.textAlign='left';
    if(!bands.length){g.fillStyle='#cfc5e6';g.font=`500 26px ${FONT}`;g.fillText('速度を出せた打球がありません',64,dy+80);}
    else if(sides){
      // 左右別：中央に帯、左に LEFT PLAYER、右に RIGHT PLAYER。見出しの文字と数字で示す（色だけに頼らない）
      const rows=bandRows(lr.left,lr.right),name=side=>{const n=record?.playerLabels?.[(record?.flip?side==='a'?'b':'a':side)];return n&&!/^選手[AB]$/.test(n)?`（${n}）`:'';};
      g.font=`700 26px ${FONT}`;g.textAlign='left';g.fillStyle='#58d5ef';g.fillText(`LEFT PLAYER${name('a')} 計${lr.leftTotal}`,64,dy+72,440);
      g.textAlign='right';g.fillStyle='#ffd23f';g.fillText(`RIGHT PLAYER${name('b')} 計${lr.rightTotal}`,1016,dy+72,440);g.textAlign='left';
      const top=dy+90,rowH=Math.max(36,Math.min(L.rowH,Math.floor((condTop-12-top)/rows.length))),max=Math.max(1,...rows.flatMap(r=>[r.l,r.r])),barH=Math.round(rowH*.56);
      rows.forEach((r,i)=>{const y=top+i*rowH,mid=y+rowH/2;
        g.fillStyle='rgba(255,255,255,.07)';rrect(g,130,mid-barH/2,300,barH,barH/2);g.fill();rrect(g,650,mid-barH/2,300,barH,barH/2);g.fill();
        const lw=Math.max(r.l?barH:0,300*r.l/max),rw=Math.max(r.r?barH:0,300*r.r/max);
        g.fillStyle='#58d5ef';if(r.l){rrect(g,430-lw,mid-barH/2,lw,barH,barH/2);g.fill();}
        g.fillStyle='#ffd23f';if(r.r){rrect(g,650,mid-barH/2,rw,barH,barH/2);g.fill();}
        g.fillStyle='#fff';g.font=`800 28px ${FONT}`;g.textAlign='left';g.fillText(String(r.l),64,mid+10);g.textAlign='right';g.fillText(String(r.r),1016,mid+10);
        g.font=`600 26px ${FONT}`;g.fillStyle='#e6e1f4';g.textAlign='center';g.fillText(r.label,540,mid+9);g.textAlign='left';
      });
    }
    else{
      const top=dy+46,rowH=Math.max(36,Math.min(L.rowH,Math.floor((condTop-12-top)/bands.length))),max=Math.max(1,...bands.map(b=>b.count)),barH=Math.round(rowH*.56);
      bands.forEach((b,i)=>{const y=top+i*rowH,mid=y+rowH/2;
        g.font=`600 26px ${FONT}`;g.fillStyle='#e6e1f4';g.textAlign='right';g.fillText(b.label,236,mid+9);
        g.fillStyle='rgba(255,255,255,.07)';rrect(g,262,mid-barH/2,640,barH,barH/2);g.fill();
        const bw=Math.max(barH,640*b.count/max);const gr=g.createLinearGradient(262,0,262+bw,0);gr.addColorStop(0,'#16e6c3');gr.addColorStop(1,'#2ec5ff');g.fillStyle=gr;rrect(g,262,mid-barH/2,bw,barH,barH/2);g.fill();
        g.fillStyle='#fff';g.font=`800 28px ${FONT}`;g.textAlign='left';g.fillText(String(b.count),918,mid+10);
      });
    }
    // 下端：集計の根拠 → 解析条件（どちらも24px）
    g.font=`500 24px ${FONT}`;g.fillStyle='#c4bdd5';g.textAlign='left';
    const cond=conditionLines(g,conditionText(state.conditions,stats.total,summary.withSpeed,distance,record?.variedDistances),952);
    cond.forEach((line,i)=>g.fillText(line,64,H-52-(cond.length-1-i)*34,952));
    g.fillText(basisText(state,sides?lr:null),64,H-52-cond.length*34,952);
    const bg=document.createElement('canvas');bg.width=Math.max(8,Math.round(W/64));bg.height=Math.max(8,Math.round(H/64));
    const comp=document.createElement('canvas');comp.width=W;comp.height=H;
    return state.__story={W,H,box,layer,bg,bgCtx:bg.getContext('2d'),comp,compCtx:comp.getContext('2d'),n:0};
  }
  function draw(canvas,video,state){
    const {format,style,motion,record,start,end,focus,measurementSource}=state;
    const confirmed=measurementSource==='confirmed';
    const W=canvas.width,H=canvas.height,g=canvas.getContext('2d'),FONT='"Hiragino Sans", sans-serif';
    const crop=C.crop(video.videoWidth,video.videoHeight,motion?.regions,focus);
    const story=format==='story',stats=C.stats(record?.hits||[],start,end);
    let box={x:0,y:0,w:W,h:H},sc=null;
    if(story){
      sc=storyCache(state,W,H,crop,stats);box=sc.box;
      // 背景（映像を縮めて引き伸ばしたぼかし）と動かない部分は、10フレームに1回だけ合成し、毎フレームは1枚貼るだけにする
      if(sc.n++%10===0){const c2=sc.compCtx;c2.fillStyle='#120a2e';c2.fillRect(0,0,W,H);sc.bgCtx.drawImage(video,0,0,sc.bg.width,sc.bg.height);c2.save();c2.globalAlpha=.22;c2.drawImage(sc.bg,0,0,W,H);c2.restore();c2.drawImage(sc.layer,0,0);}
      g.drawImage(sc.comp,0,0);
    }else{g.fillStyle='#120a2e';g.fillRect(0,0,W,H);}
    g.drawImage(video,crop.x,crop.y,crop.w,crop.h,box.x,box.y,box.w,box.h);
    if(state.showTrajectory&&state.trajectoryTracks?.length){g.fillStyle='rgba(5,10,22,.12)';g.fillRect(box.x,box.y,box.w,box.h);}
    if(style==='skeleton'){
      g.save();g.beginPath();g.rect(box.x,box.y,box.w,box.h);g.clip();g.translate(box.x,box.y);g.scale(box.w/crop.w,box.h/crop.h);g.translate(-crop.x,-crop.y);const drawn=skeleton(g,motion,video.currentTime);g.restore();

    }
    if(state.showTrajectory){g.save();g.beginPath();g.rect(box.x,box.y,box.w,box.h);g.clip();g.translate(box.x,box.y);g.scale(box.w/crop.w,box.h/crop.h);g.translate(-crop.x,-crop.y);trajectory(g,state.trajectoryTracks,video.currentTime,video.videoWidth,record?.playbackHits||record?.hits||[]);g.restore();}
    const hit=C.hitAt(record?.playbackHits||record?.hits||[],video.currentTime,start),u=W/1080;
    g.textAlign='left';g.fillStyle='rgba(9,6,25,.75)';g.fillRect(box.x+18*u,box.y+18*u,252*u,92*u);
    g.fillStyle='#fff';g.font=`800 ${38*u}px ${FONT}`;g.fillText(hit?`${hit.speed.toFixed(0)} km/h`:'-- km/h',box.x+34*u,box.y+64*u);
    g.font=`${20*u}px ${FONT}`;g.fillStyle='#ddd8ef';g.fillText(confirmed?'対象打球の推定初速':'音から推定した初速',box.x+34*u,box.y+94*u);
    const visibleHits=(record?.playbackHits||record?.hits||[]).filter(e=>e.t>=start&&e.t<=video.currentTime&&e.status!=='ignored');
    for(const [i,side] of ['a','b'].entries()){
      const player=record?.flip?(side==='a'?'b':'a'):side;
      const bottomClearance=story?8:44;
      const count=String(visibleHits.filter(e=>e.player===player).length);
      const label=i?'RIGHT PLAYER':'LEFT PLAYER';
      g.font=`700 ${20*u}px ${FONT}`;const lw=g.measureText(label).width;
      const cw=Math.max(lw+24*u,96*u),x=i?box.x+box.w-cw-10*u:box.x+10*u,y=box.y+box.h-(104+bottomClearance)*u,center=x+cw/2;
      g.fillStyle='rgba(9,6,25,.66)';g.fillRect(x,y,cw,104*u);
      g.textAlign='center';g.fillStyle=i?'#ffd23f':'#58d5ef';g.fillText(label,center,y+26*u);
      g.fillStyle='#fff';g.font=`${18*u}px ${FONT}`;g.fillText('総打数',center,y+48*u);g.font=`800 ${44*u}px ${FONT}`;g.fillText(count,center,y+92*u,cw-12*u);g.textAlign='left';
    }
    if(!story){g.fillStyle='rgba(9,6,25,.75)';g.fillRect(0,H-40*u,W,40*u);g.fillStyle='#fff';g.font=`${22*u}px ${FONT}`;g.fillText(confirmed&&(motion?.events||[]).some(e=>e.origin==='video')?'映像の球の軌跡から打点を推定・設定距離による推定初速':confirmed?'音の打数＋映像で確認・設定距離による推定初速':'音からの記録・設定距離に基づく初速推定',18*u,H-12*u,W-36*u);}
    return canvas;
  }
  function open(options){
    cancel();document.getElementById('sharePreview')?.remove();
    const controller=new AbortController();active=controller;
    const video=options.video,record=structuredClone(options.record),motion=options.motion?structuredClone(options.motion):null;
    let displayTracks=window.FrescoBallTracker&&motion?.frames?window.FrescoBallTracker.track(motion.frames,video.videoWidth,motion.regions):C.trajectoryTracks(motion?.tracks||(motion?.frames?window.FrescoMotion.track(motion.frames,video.videoWidth):[]),motion?.regions,video.videoWidth,video.videoHeight);
    if(window.FrescoBallTracker?.displayTracks)displayTracks=window.FrescoBallTracker.displayTracks(displayTracks,motion?.events,video.videoWidth,motion?.frames||[],motion?.regions);
    const ownedSrc=video.src,ownedObject=video.srcObject;
    const ownsVideo=()=>active===controller&&video.src===ownedSrc&&video.srcObject===ownedObject;
    const check=()=>{if(controller.signal.aborted||!ownsVideo())throw new Error('保存を中止しました');};
    const changed=()=>{if(!ownsVideo())controller.abort();};
    video.addEventListener('emptied',changed);video.addEventListener('loadstart',changed);
    controller.signal.addEventListener('abort',()=>{if(ownsVideo())video.pause();video.removeEventListener('emptied',changed);video.removeEventListener('loadstart',changed);},{once:true});
    const wait=promise=>new Promise((resolve,reject)=>{
      const abort=()=>{cleanup();reject(new Error('保存を中止しました'));};
      const cleanup=()=>controller.signal.removeEventListener('abort',abort);
      if(controller.signal.aborted){abort();return;}controller.signal.addEventListener('abort',abort,{once:true});
      Promise.resolve(promise).then(value=>{cleanup();try{check();resolve(value);}catch(error){reject(error);}},error=>{cleanup();reject(error);});
    });
    const dialog=document.createElement('dialog');dialog.id='sharePreview';dialog.className='share-dialog';
    const e=(tag,text,parent=dialog)=>{const n=document.createElement(tag);if(text)n.textContent=text;parent.append(n);return n;};
    const heading=e('h2',options.image?'ストーリーズ画像を保存':options.format==='story'?'ストーリーズ動画を保存':'編集した動画を保存');
    const note=e('p','保存する見た目と区間を選び、プレビューで確認できます。');
    const form=e('fieldset');const label=(text)=>e('label',text,form);
    const sl=label('見た目'),style=e('select','',sl);for(const [value,text]of [['play','プレーと球速'],['skeleton','骨格付き']]){const o=e('option',text,style);o.value=value;if(value==='skeleton'&&!C.motionRange(motion))o.disabled=true;}
    if(!C.motionRange(motion))e('p','骨格付きにするには、先に「2人を選んで骨格と軌跡を見る」で解析してください。',form);
    const trailLabel=label('球の軌跡'),trail=e('select','',trailLabel);for(const [value,text]of [['off','表示しない'],['on','軌跡候補を表示']]){const o=e('option',text,trail);o.value=value;if(value==='on'&&!displayTracks.length&&motion?.regions?.length!==2)o.disabled=true;}
    if(displayTracks.length||motion?.regions?.length===2)trail.value='on';
    const measurementLabel=label('表示する記録'),measurement=e('select','',measurementLabel);
    const hasAudio=record?.analysisMode!=='motion'||Array.isArray(record?.audioHits);
    // 映像が主のモード（実験）で作った解析は、打数の基準が音ではなく映像の打点になる。
    const videoBasis=(motion?.events||[]).some(event=>event.origin==='video');
    for(const [value,text]of [['audio','音から計算した記録'],['confirmed',videoBasis?'映像から出した打点（実験）':'音の打数＋映像で確認']]){const o=e('option',text,measurement);o.value=value;if(value==='audio'&&!hasAudio)o.disabled=true;if(value==='confirmed'&&!motion?.events?.some(event=>['auto','confirmed'].includes(event.status)&&['a','b'].includes(event.player)))o.disabled=true;}
    const verifiedCount=(motion?.events||[]).filter(event=>['auto','confirmed'].includes(event.status)&&['a','b'].includes(event.player)).length;
    const audioCount=(record?.analysisMode==='motion'?record?.audioHits:record?.hits||[])?.length||0;
    const measurementChoice=C.measurementDefault({analysisMode:record?.analysisMode,hasAudio,audioCount,verifiedCount});
    if(!measurement.querySelector(`option[value="${measurementChoice.value}"]`)?.disabled)measurement.value=measurementChoice.value;
    if(record?.analysisMode==='motion'&&hasAudio&&audioCount)e('p',`映像で打点を選手に割り当てた打球（仮判定を含む）は ${verifiedCount}／${audioCount} 件（${Math.round((measurementChoice.coverage||0)*100)}%）。${measurementChoice.value==='audio'?'8割未満のため、既定は音から計算した記録です。':'8割以上なので、割り当て済みの打球を基準に集計します。'}`,form);
    e('p',videoBasis?'打数は映像の球の向きが入れ替わる瞬間が基準です（実験）。球を追えなかった返球は数に入りません。速度の目安は±10%です。':'打数は音が基準です。映像で読み取れない打球も含み、左右は前後の動きから推定します。明示的に除外した音は数えません。',form);
    const tl=label('タイトル'),title=e('input','',tl);title.value='今日のラリー';title.maxLength=24;tl.hidden=options.format!=='story';
    const startLabel=label('開始位置（秒）'),start=e('input','',startLabel);start.type='number';start.min=0;start.max=video.duration;start.step='.1';start.value=Math.min(video.currentTime,Math.max(0,video.duration-.1)).toFixed(2);
    const lengthLabel=label('長さ'),length=e('select','',lengthLabel);for(const n of [8,15,30,60]){const o=e('option',`${n}秒`,length);o.value=n;}length.value='15';lengthLabel.hidden=Boolean(options.image);if(options.format!=='story'){const all=e('option','全編',length);all.value=video.duration;all.dataset.full='';}
    const cropLabel=label('画角'),focus=e('select','',cropLabel);for(const [value,text]of [['full','映っている全体'],['pair','選んだ2人を大きく']]){const o=e('option',text,focus);o.value=value;if(value==='pair'&&motion?.regions?.length!==2)o.disabled=true;}
    const canvas=e('canvas');canvas.style.cssText='width:100%;max-height:55vh;object-fit:contain;background:#000';
    const status=e('p','');status.setAttribute('role','status');
    const actions=e('div');actions.className='share-actions';
    const preview=e('button','プレビューを更新',actions),save=e('button',options.image?'画像を作る':'動画を作る',actions),close=e('button','閉じる',actions);
    const saved=e('div');saved.className='share-actions';let result=null,busy=false,previewSerial=0,state=null;
    const showResult=()=>{saved.replaceChildren();if(!result)return;const download=e('button','端末に保存',saved);download.onclick=()=>options.download(result.blob,result.name);if(navigator.canShare&&navigator.canShare({files:[result.file]})){const share=e('button','写真に保存・共有',saved);share.onclick=async()=>{try{await navigator.share({files:[result.file],title:'フレスコボール'});}catch(error){if(error.name!=='AbortError')status.textContent='共有できませんでした。「端末に保存」をお試しください。';}}}};
    const configure=()=>{
      const range=captureWindow(video.duration,Number(start.value),Boolean(options.image),measurement.value,motion,Number(length.value),options.format==='story'?60:video.duration);
      if(style.value==='skeleton'){
        const r=C.motionRange(motion);if(!r||(options.image?(range.captureTime<r.start-.01||range.captureTime>r.end+.07):(range.start<r.start-.01||range.end>r.end+.07)))throw new Error('骨格を解析した区間に合わせてください。「骨格付き」を選び直すと区間を合わせられます。');
      }
      let selectedRecord=record;
      if(measurement.value==='audio'){
        const audioHits=record?.analysisMode==='motion'?record.audioHits:record?.hits;
        if(!Array.isArray(audioHits))throw new Error('この記録には音から計算した速度がありません');
        // 映像の見直しで明示的に除外した音は、音モードでも数えない（フォームの説明と一致させる）
        const ignoredTimes=(motion?.events||[]).filter(event=>event.status==='ignored').map(event=>event.t);
        const kept=ignoredTimes.length?audioHits.filter(h=>!ignoredTimes.some(t=>Math.abs(t-h.t)<.001)):audioHits;
        const reviewed=window.FrescoVideoQuality?window.FrescoVideoQuality.review(kept,record.speedReview||{}).hits:kept;
        selectedRecord={...record,hits:reviewed,playbackHits:reviewed};
      }
      if(measurement.value==='confirmed'){
        const estimates=window.FrescoMotion.estimatedSpeeds(window.FrescoMotion.countedEvents(record.audioHits||record.hits||[],motion?.events||[]),motion?.settings?.distanceM,record.settings,window.FrescoMeasurement,record.audioHits||record.hits||[]);
        const verified=event=>['auto','confirmed'].includes(event.status)&&['a','b'].includes(event.player);
        const measured=estimates.filter(verified).map(event=>({...event,speed:event.initialKmh}));
        const hits=window.FrescoVideoQuality?window.FrescoVideoQuality.review(measured,record.speedReview||{}).hits:measured;
        const reviewedByTime=new Map(hits.map(h=>[h.t,h]));
        const playbackHits=estimates.map(event=>({...event,speed:verified(event)?reviewedByTime.get(event.t)?.speed??null:null}));
        const distances=new Set(hits.filter(h=>h.t>=range.start&&h.t<=range.end&&h.usedDistanceM!=null).map(h=>h.usedDistanceM));
        selectedRecord={...record,hits,playbackHits,settings:{values:{distance:distances.size===1?[...distances][0]:motion.settings.distanceM}},variedDistances:distances.size>1};
      }
      state={mode:options.mode||'simple',conditions:{sens:record?.settings?.values?.sens,voiceCut:record?.settings?.values?.voiceCut,ai:Boolean(record?.settings?.values?.aiFilter),aiRejected:record?.aiRejected||0,onsets:((record?.analysisMode==='motion'?record.audioHits:record?.hits)||[]).filter(h=>h.t>=range.start&&h.t<=range.end).length},format:options.format,style:style.value,motion,record:selectedRecord,measurementSource:measurement.value,start:range.start,end:range.end,captureTime:range.captureTime,statsLabel:range.statsLabel,title:title.value,focus:focus.value==='pair',showTrajectory:trail.value==='on',trajectoryTracks:displayTracks.concat(window.FrescoBallTracker?.estimatedArcs?.(selectedRecord.playbackHits||selectedRecord.hits||[],motion?.frames||[],motion?.regions,video.videoWidth,{tracks:displayTracks})||[])};
      const c=C.crop(video.videoWidth,video.videoHeight,motion?.regions,state.focus);
      if(options.format==='story'){canvas.width=1080;canvas.height=1920;}else{const scale=Math.min(1,1280/Math.max(c.w,c.h));canvas.width=Math.max(2,Math.round(c.w*scale/2)*2);canvas.height=Math.max(2,Math.round(c.h*scale/2)*2);}
      return state;
    };
    const update=async()=>{if(busy)return;const version=++previewSerial;preview.disabled=true;save.disabled=true;try{const s=configure();video.pause();await seek(video,s.captureTime,controller.signal);if(version!==previewSerial||controller.signal.aborted||!ownsVideo())return;draw(canvas,video,s);status.textContent=options.image?`${s.captureTime.toFixed(1)}秒の画像・${s.statsLabel}（${s.start.toFixed(1)}〜${s.end.toFixed(1)}秒）`:`${s.start.toFixed(1)}秒から${(s.end-s.start).toFixed(1)}秒間${s.style==='skeleton'?'・骨格付き':''}`;save.disabled=false;}catch(error){if(!controller.signal.aborted)status.textContent=error.message;}finally{if(version===previewSerial)preview.disabled=false;}};
    preview.onclick=update;
    for(const input of [style,title,start,length,focus,measurement,trail])input.onchange=()=>{
      if(input===length&&length.selectedOptions[0]?.dataset.full!=null)start.value='0';
      if(input===style&&style.value==='skeleton'&&!options.image){const r=C.motionRange(motion);if(r){start.value=r.start.toFixed(3);const duration=Math.min(60,r.end-r.start);let custom=length.querySelector('[data-range]');if(!custom){custom=e('option','',length);custom.dataset.range='';}custom.value=duration;custom.textContent=`解析した区間（${duration.toFixed(1)}秒）`;length.value=String(duration);}}
      result=null;showResult();update();
    };
    const dispose=()=>{controller.abort();dialog.close();dialog.remove();if(active===controller)active=null;};
    close.onclick=()=>{if(busy){controller.abort();status.textContent='保存を中止しています';}else dispose();};dialog.addEventListener('cancel',event=>{event.preventDefault();close.click();});
    save.onclick=async()=>{
      if(busy||controller.signal.aborted)return;busy=true;form.disabled=true;preview.disabled=true;save.disabled=true;close.textContent='作成を中止';
      let graph=null,dest=null,streams=[],recorder=null,timer=null,finishPlay=null,oldGain=null,stopTimer=null;
      const old={t:video.currentTime,rate:video.playbackRate,muted:video.muted,volume:video.volume};
      try{
        check();const s=configure();video.pause();await seek(video,s.captureTime,controller.signal);check();draw(canvas,video,s);
        let blob,ext;
        if(options.image){blob=await wait(new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('画像の作成が止まりました')),15000);canvas.toBlob(value=>{clearTimeout(timeout);resolve(value);},'image/png');}));ext='png';}
        else{
          const mime=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm'].find(m=>window.MediaRecorder&&MediaRecorder.isTypeSupported(m));
          if(!mime||!canvas.captureStream)throw new Error('このブラウザでは動画を保存できません。対応するSafariやChromeでお試しください。');
          graph=options.audioGraph();dest=graph.audioCtx.createMediaStreamDestination();streams=[dest.stream];graph.source.connect(dest);oldGain=speakerOwners.get(graph.speakerGain)?.gain??graph.speakerGain.gain.value;speakerOwners.set(graph.speakerGain,{controller,gain:oldGain});graph.speakerGain.gain.value=0;await wait(graph.audioCtx.resume());check();
          const canvasStream=canvas.captureStream(30);streams=[canvasStream,dest.stream];const stream=new MediaStream([...canvasStream.getVideoTracks(),...dest.stream.getAudioTracks()]);
          recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8000000});const chunks=[];
          recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
          let rejectRecording;const stopped=new Promise((resolve,reject)=>{recorder.onstop=()=>{clearTimeout(stopTimer);resolve();};recorder.onerror=event=>{const error=event.error||new Error('録画できませんでした');rejectRecording?.(error);reject(error);};});stopped.catch(()=>{});
          video.playbackRate=1;video.muted=false;video.volume=1;recorder.start(500);
          const played=new Promise((resolve,reject)=>{
            let lastTime=video.currentTime,lastAdvance=Date.now();
            const abort=()=>finish(new Error('保存を中止しました'));
            let finished=false;const finish=error=>{if(finished)return;finished=true;clearInterval(timer);controller.signal.removeEventListener('abort',abort);video.removeEventListener('error',bad);finishPlay=null;error?reject(error):resolve();};
            const bad=()=>finish(new Error('動画の再生が止まりました'));
            rejectRecording=finish;finishPlay=finish;controller.signal.addEventListener('abort',abort,{once:true});video.addEventListener('error',bad,{once:true});
            timer=setInterval(()=>{if(controller.signal.aborted||!ownsVideo()){abort();return;}try{draw(canvas,video,s);}catch(error){finish(error);return;}if(video.currentTime!==lastTime){lastTime=video.currentTime;lastAdvance=Date.now();}if(video.currentTime>=s.end-.025||video.ended){finish();return;}if(Date.now()-lastAdvance>15000){finish(new Error('再生が止まりました。画面を開いたまま、もう一度お試しください'));return;}status.textContent=`動画を作っています ${Math.min(99,Math.round((video.currentTime-s.start)/(s.end-s.start)*100))}%・画面を開いたままお待ちください`;},1000/30);
          });played.catch(()=>{});
          await wait(Promise.race([video.play(),played]));await wait(played);check();video.pause();
          if(recorder.state!=='inactive')recorder.stop();
          await wait(Promise.race([stopped,new Promise((_,reject)=>{stopTimer=setTimeout(()=>reject(new Error('録画の終了が止まりました。もう一度お試しください')),10000);})]));clearTimeout(stopTimer);
          blob=new Blob(chunks,{type:mime.split(';')[0]});ext=mime.includes('mp4')?'mp4':'webm';
        }
        if(controller.signal.aborted)throw new Error('保存を中止しました');if(!blob?.size)throw new Error('保存するデータを作れませんでした');
        const name=`frescoball-${options.format}-${s.style}-${Date.now()}.${ext}`;result={blob,name,file:new File([blob],name,{type:blob.type})};showResult();status.textContent='できました。下のボタンから保存できます。';
      }catch(error){if(active===controller)status.textContent=error.message;}finally{
        finishPlay?.(new Error('保存を終了しました'));clearInterval(timer);clearTimeout(stopTimer);if(recorder&&recorder.state!=='inactive'){try{recorder.stop();}catch(_){}}streams.forEach(stream=>stream.getTracks().forEach(t=>t.stop()));
        if(graph){try{graph.source.disconnect(dest);}catch(_){}if(speakerOwners.get(graph.speakerGain)?.controller===controller){graph.speakerGain.gain.value=oldGain;speakerOwners.delete(graph.speakerGain);}}
        if(ownsVideo()){video.pause();video.playbackRate=old.rate;video.muted=old.muted;video.volume=old.volume;if(!controller.signal.aborted){try{video.currentTime=old.t;}catch(_){}}}
        busy=false;form.disabled=false;preview.disabled=false;save.disabled=controller.signal.aborted;close.textContent='閉じる';
      }
    };
    document.body.append(dialog);dialog.showModal();update();return dialog;
  }
  return {open,cancel,draw};
})();
