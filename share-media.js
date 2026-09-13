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
  function trajectory(g,tracks,t,width){
    const points=window.FrescoBallTracker?(window.FrescoBallTracker.at(tracks,t)?.trail||[]):C.trajectoryAt(tracks,t);if(points.length<2)return false;
    g.strokeStyle='#ffce59';g.lineWidth=Math.max(3,width/480);
    for(let i=1;i<points.length;i++){g.globalAlpha=.2+.8*i/points.length;g.setLineDash?.(points[i].predicted?[5,5]:[]);g.beginPath();g.moveTo(points[i-1].x,points[i-1].y);g.lineTo(points[i].x,points[i].y);g.stroke();}g.globalAlpha=1;g.setLineDash?.([]);
    const last=points.at(-1);g.beginPath();g.arc(last.x,last.y,Math.max(4,width/240),0,Math.PI*2);g.stroke();return true;
  }
  function draw(canvas,video,state){
    const {format,style,motion,record,start,end,title,focus,measurementSource,statsLabel}=state;
    const confirmed=measurementSource==='confirmed';
    const W=canvas.width,H=canvas.height,g=canvas.getContext('2d');
    const crop=C.crop(video.videoWidth,video.videoHeight,motion?.regions,focus);
    const story=format==='story',stats=C.stats(record?.hits||[],start,end),distance=record?.settings?.values?.distance;
    g.fillStyle='#120a2e';g.fillRect(0,0,W,H);
    const closeups=story&&motion?.regions?.length===2;
    let box=story?C.fit(crop.w,crop.h,0,340,W,closeups?720:1120):{x:0,y:0,w:W,h:H};
    if(story){
      g.save();g.globalAlpha=.25;g.filter='blur(32px)';g.drawImage(video,0,200,W,1280);g.restore();
      g.textAlign='left';g.fillStyle='#16e6c3';g.font='700 28px "Hiragino Sans", sans-serif';g.fillText('FRESCOBALL',64,164);
      g.fillStyle='#fff';g.font='800 64px "Hiragino Sans", sans-serif';g.fillText(title||'今日のラリー',64,246,W-128);
      g.fillStyle='#d7d4e6';g.font='400 30px "Hiragino Sans", sans-serif';g.fillText(style==='skeleton'?'ふたりの動きを見返す':'ふたりでつないだラリー',64,294);
    }
    g.drawImage(video,crop.x,crop.y,crop.w,crop.h,box.x,box.y,box.w,box.h);
    if(style==='skeleton'){
      g.save();g.beginPath();g.rect(box.x,box.y,box.w,box.h);g.clip();g.translate(box.x,box.y);g.scale(box.w/crop.w,box.h/crop.h);g.translate(-crop.x,-crop.y);const drawn=skeleton(g,motion,video.currentTime);g.restore();

    }
    if(state.showTrajectory){g.save();g.beginPath();g.rect(box.x,box.y,box.w,box.h);g.clip();g.translate(box.x,box.y);g.scale(box.w/crop.w,box.h/crop.h);g.translate(-crop.x,-crop.y);trajectory(g,state.trajectoryTracks,video.currentTime,video.videoWidth);g.restore();g.fillStyle='#ffce59';g.font=`${20*W/1080}px sans-serif`;g.fillText('球の軌跡候補',box.x+20*W/1080,box.y+box.h-18*W/1080);}
    const shot=(state.shotEstimates||[]).filter(e=>e.t<=video.currentTime&&video.currentTime-e.t<.9).at(-1);
    if(shot?.type){g.fillStyle='rgba(9,6,25,.75)';g.fillRect(box.x+18*W/1080,box.y+120*W/1080,270*W/1080,42*W/1080);g.fillStyle='#ffd23f';g.font=`${24*W/1080}px "Hiragino Sans",sans-serif`;g.fillText(`${shot.type==='attack'?'アタック':'ディフェンス'}（推定）`,box.x+30*W/1080,box.y+149*W/1080);}
    const hit=C.hitAt(record?.playbackHits||record?.hits||[],video.currentTime,start),u=W/1080;
    g.textAlign='left';g.fillStyle='rgba(9,6,25,.75)';g.fillRect(box.x+18*u,box.y+18*u,252*u,92*u);
    g.fillStyle='#fff';g.font=`800 ${38*u}px "Hiragino Sans", sans-serif`;g.fillText(hit?`${hit.speed.toFixed(0)} km/h`:'-- km/h',box.x+34*u,box.y+64*u);
    g.font=`${20*u}px "Hiragino Sans", sans-serif`;g.fillStyle='#ddd8ef';g.fillText(confirmed?'対象打点の区間平均':'音から推定した初速',box.x+34*u,box.y+94*u);
    if(story){
      if(closeups)motion.regions.forEach((region,i)=>{
        const area={x:64+i*496,y:1120,w:456,h:300};
        const fitted=C.fit(region.w,region.h,area.x,area.y,area.w,area.h);
        g.fillStyle='rgba(9,6,25,.5)';g.fillRect(area.x,area.y,area.w,area.h);
        g.drawImage(video,region.x,region.y,region.w,region.h,fitted.x,fitted.y,fitted.w,fitted.h);
        if(style==='skeleton'){g.save();g.beginPath();g.rect(fitted.x,fitted.y,fitted.w,fitted.h);g.clip();g.translate(fitted.x,fitted.y);g.scale(fitted.w/region.w,fitted.h/region.h);g.translate(-region.x,-region.y);skeleton(g,motion,video.currentTime);g.restore();}
        g.fillStyle=i?'#ffd23f':'#16e6c3';g.font='700 24px "Hiragino Sans", sans-serif';g.fillText(record?.playerLabels?.[i?'b':'a']||`${i+1}人目`,area.x,area.y-18,area.w);
      });
      const cells=[[confirmed?'対象の打数':'連続した打数',`${confirmed?stats.total:stats.rally} 回`],[confirmed?'区間平均球速':'推定初速の平均',stats.average==null?'--':`${stats.average.toFixed(0)} km/h`],['選手間の距離',record?.variedDistances?'区間ごと':distance?`${distance} m`:'未設定']];
      cells.forEach(([label,value],i)=>{const x=64+i*328;g.fillStyle='#bcb4d3';g.font='500 27px "Hiragino Sans", sans-serif';g.fillText(label,x,1540);g.fillStyle=i===0?'#ffd23f':'#fff';g.font='800 49px "Hiragino Sans", sans-serif';g.fillText(value,x,1615,304);});
      g.fillStyle='#c4bdd5';g.font='400 25px "Hiragino Sans", sans-serif';g.fillText(`${statsLabel||'この動画区間の記録'}・${confirmed?'対象打球の区間平均（自動・仮判定を含む）':'音から求めた初速推定値'}`,64,1700,952);
      g.fillStyle='#9c92b3';g.font='400 24px "Hiragino Sans", sans-serif';g.fillText('FRESCOBALL  /  PRACTICE',64,1770);
    }
    if(!story){g.fillStyle='rgba(9,6,25,.75)';g.fillRect(0,H-40*u,W,40*u);g.fillStyle='#fff';g.font=`${22*u}px "Hiragino Sans", sans-serif`;g.fillText(confirmed?'対象2人の記録（自動・仮判定を含む）・設定距離による区間平均':'音からの記録・設定距離に基づく初速推定',18*u,H-12*u,W-36*u);}
    return canvas;
  }
  function open(options){
    cancel();document.getElementById('sharePreview')?.remove();
    const controller=new AbortController();active=controller;
    const video=options.video,record=structuredClone(options.record),motion=options.motion?structuredClone(options.motion):null;
    const displayTracks=window.FrescoBallTracker&&motion?.frames?window.FrescoBallTracker.track(motion.frames,video.videoWidth,motion.regions):C.trajectoryTracks(motion?.tracks||(motion?.frames?window.FrescoMotion.track(motion.frames,video.videoWidth):[]),motion?.regions,video.videoWidth,video.videoHeight);
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
    if(!C.motionRange(motion))e('p','骨格付きにするには、先に「2人を選んで詳しく解析」で解析してください。',form);
    const trailLabel=label('球の軌跡'),trail=e('select','',trailLabel);for(const [value,text]of [['off','表示しない'],['on','軌跡候補を表示']]){const o=e('option',text,trail);o.value=value;if(value==='on'&&!displayTracks.length)o.disabled=true;}
    if(displayTracks.length)trail.value='on';
    const measurementLabel=label('表示する記録'),measurement=e('select','',measurementLabel);
    const hasAudio=record?.analysisMode!=='motion'||Array.isArray(record?.audioHits);
    for(const [value,text]of [['audio','音から計算した記録'],['confirmed','対象2人の記録（自動・仮判定を含む）']]){const o=e('option',text,measurement);o.value=value;if(value==='audio'&&!hasAudio)o.disabled=true;if(value==='confirmed'&&!motion?.events?.some(event=>['auto','confirmed'].includes(event.status)&&['a','b'].includes(event.player)))o.disabled=true;}
    if(record?.analysisMode==='motion')measurement.value='confirmed';
    e('p','音からの候補と、映像で自動判定または手動確認した対象2人の記録を切り替えます。腕の動きによる仮判定も含み、打者不明の音は含みません。映像の球速は区間平均の推定です。',form);
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
        const reviewed=window.FrescoVideoQuality?window.FrescoVideoQuality.review(audioHits,record.speedReview||{}).hits:audioHits;
        selectedRecord={...record,hits:reviewed,playbackHits:reviewed};
      }
      if(measurement.value==='confirmed'){
        const estimates=window.FrescoMotion.speeds(motion?.events||[],motion?.settings?.distanceM);
        const verified=event=>['auto','confirmed'].includes(event.status)&&['a','b'].includes(event.player);
        const measured=estimates.filter(verified).map(event=>({...event,speed:event.averageKmh}));
        const hits=window.FrescoVideoQuality?window.FrescoVideoQuality.review(measured,record.speedReview||{}).hits:measured;
        const reviewedByTime=new Map(hits.map(h=>[h.t,h]));
        const playbackHits=estimates.map(event=>({...event,speed:verified(event)?reviewedByTime.get(event.t)?.speed??null:null}));
        const distances=new Set(hits.filter(h=>h.t>=range.start&&h.t<=range.end&&h.usedDistanceM!=null).map(h=>h.usedDistanceM));
        selectedRecord={hits,playbackHits,settings:{values:{distance:distances.size===1?[...distances][0]:motion.settings.distanceM}},variedDistances:distances.size>1};
      }
      state={shotEstimates:window.FrescoShots&&motion?.frames?window.FrescoShots.classify(motion.events,motion.frames):[],format:options.format,style:style.value,motion,record:selectedRecord,measurementSource:measurement.value,start:range.start,end:range.end,captureTime:range.captureTime,statsLabel:range.statsLabel,title:title.value,focus:focus.value==='pair',showTrajectory:trail.value==='on',trajectoryTracks:displayTracks};
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
