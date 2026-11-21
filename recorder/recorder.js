const chooseBtn=document.getElementById("choose");
const pauseBtn=document.getElementById("pause");
const stopBtn=document.getElementById("stop");
const downloadBtn=document.getElementById("download");
const closeBtn=document.getElementById("close");
const stateEl=document.getElementById("state");
const timerEl=document.getElementById("timer");
const infoEl=document.getElementById("info");
const errorEl=document.getElementById("error");
const recordStatusEl=document.getElementById("recordStatus");
const fpsEl=document.getElementById("fps");
const qualityEl=document.getElementById("quality");
const micEl=document.getElementById("mic");
const selectionPanel=document.getElementById("selectionPanel");
const preview=document.getElementById("preview");
const selectionBox=document.getElementById("selectionBox");
const selectionHint=document.getElementById("selectionHint");
const selectionSize=document.getElementById("selectionSize");
const selectFullBtn=document.getElementById("selectFull");
const startRecordingBtn=document.getElementById("startRecording");

let sourceStream=null;
let recordStream=null;
let mediaRecorder=null;
let chunks=[];
let finalBlob=null;
let micStream=null;
let audioContext=null;
let audioInputStreams=[];
let canvas=null;
let canvasCtx=null;
let drawTimer=null;
let startedAt=0;
let elapsedBeforePause=0;
let timerId=null;
let paused=false;
let sourceWidth=0;
let sourceHeight=0;
let selection={x:0,y:0,w:0,h:0};
let dragging=false;
let dragStart=null;
let directVideoRecording=false;

// Ajusta a janela ao conteúdo visível. Mantemos a janela compacta
// quando o gravador está parado e ampliamos apenas durante a seleção.
async function fitRecorderWindow(selectionOpen=false, shareOpen=false){
  const width=600;
  const height=selectionOpen?520:(shareOpen?360:280);
  try{
    if(typeof chrome!=="undefined" && chrome.windows?.getCurrent && chrome.windows?.update){
      const win=await chrome.windows.getCurrent();
      if(win?.id)await chrome.windows.update(win.id,{width,height});
      return;
    }
  }catch(_){}
  try{window.resizeTo(width,height);}catch(_){}
}

fitRecorderWindow(false);

// A janela do gravador é identificada pelo popup através da URL da página.
 // Não é necessário persistir o ID da janela em storage.

const MIME_TYPES=[
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm"
];

function setState(text){
  stateEl.textContent=text;
  if(recordStatusEl)recordStatusEl.textContent=text;
  const map={
    "Pronto":"state-ready",
    "Selecionar área":"state-select",
    "Gravando":"state-recording",
    "Pausado":"state-paused",
    "Concluído":"state-done"
  };
  stateEl.className="state "+(map[text]||"state-ready");
  if(recordStatusEl){
    recordStatusEl.className="record-status "+(map[text]||"state-ready");
  }
}
function showError(msg){errorEl.textContent=msg;errorEl.classList.add("show");}
function clearError(){errorEl.textContent="";errorEl.classList.remove("show");}
function formatTime(ms){const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return [h,m,sec].map(v=>String(v).padStart(2,"0")).join(":");}
function startTimer(){startedAt=Date.now();timerId=setInterval(()=>{if(!paused)timerEl.textContent=formatTime(elapsedBeforePause+(Date.now()-startedAt));},200);}
function pauseTimer(){if(timerId){elapsedBeforePause+=Date.now()-startedAt;clearInterval(timerId);timerId=null;}startedAt=0;}
function resumeTimer(){startedAt=Date.now();timerId=setInterval(()=>{if(!paused)timerEl.textContent=formatTime(elapsedBeforePause+(Date.now()-startedAt));},200);}
function stopTimer(){if(timerId){elapsedBeforePause+=Date.now()-startedAt;clearInterval(timerId);timerId=null;}startedAt=0;timerEl.textContent=formatTime(elapsedBeforePause);}
function chooseMime(){return MIME_TYPES.find(t=>MediaRecorder.isTypeSupported(t))||"";}

function getVideoRect(){
  const r=preview.getBoundingClientRect();
  const vw=preview.videoWidth, vh=preview.videoHeight;
  const scale=Math.min(r.width/vw,r.height/vh);
  const dw=vw*scale, dh=vh*scale;
  return {left:r.left+(r.width-dw)/2,top:r.top+(r.height-dh)/2,width:dw,height:dh,scale};
}

function clampSelection(x,y,w,h){
  x=Math.max(0,Math.min(x,sourceWidth)); y=Math.max(0,Math.min(y,sourceHeight));
  w=Math.max(2,Math.min(w,sourceWidth-x)); h=Math.max(2,Math.min(h,sourceHeight-y));
  return {x,y,w,h};
}

function setFullSelection(){
  selection={x:0,y:0,w:sourceWidth,h:sourceHeight};
  selectionSize.textContent=`Área: ${sourceWidth} × ${sourceHeight}`;
  updateSelectionBox();
  startRecordingBtn.disabled=false;
  selectionHint.classList.add("hidden");
}

function updateSelectionBox(){
  if(!selection.w||!selection.h){selectionBox.classList.add("hidden");return;}
  const vr=getVideoRect();
  const x=vr.left+(selection.x/sourceWidth)*vr.width;
  const y=vr.top+(selection.y/sourceHeight)*vr.height;
  const w=(selection.w/sourceWidth)*vr.width;
  const h=(selection.h/sourceHeight)*vr.height;
  const wrap=preview.parentElement.getBoundingClientRect();
  selectionBox.style.left=`${x-wrap.left}px`;
  selectionBox.style.top=`${y-wrap.top}px`;
  selectionBox.style.width=`${w}px`;
  selectionBox.style.height=`${h}px`;
  selectionBox.classList.remove("hidden");
}

function pointerToSource(e){
  const vr=getVideoRect();
  const px=Math.max(vr.left,Math.min(e.clientX,vr.left+vr.width));
  const py=Math.max(vr.top,Math.min(e.clientY,vr.top+vr.height));
  return {x:(px-vr.left)/vr.scale,y:(py-vr.top)/vr.scale};
}

function beginDrag(e){
  if(!sourceStream)return;
  dragging=true; dragStart=pointerToSource(e); selectionHint.classList.add("hidden");
  selection={x:dragStart.x,y:dragStart.y,w:2,h:2};
  updateSelectionBox(); startRecordingBtn.disabled=true;
  e.preventDefault();
}
function moveDrag(e){
  if(!dragging)return;
  const p=pointerToSource(e);
  const x=Math.min(dragStart.x,p.x), y=Math.min(dragStart.y,p.y);
  const w=Math.abs(p.x-dragStart.x), h=Math.abs(p.y-dragStart.y);
  selection=clampSelection(x,y,w,h);
  selectionSize.textContent=`Área: ${Math.round(selection.w)} × ${Math.round(selection.h)}`;
  updateSelectionBox();
}
function endDrag(){
  if(!dragging)return;
  dragging=false;
  if(selection.w>=10&&selection.h>=10) startRecordingBtn.disabled=false;
  else setFullSelection();
}

preview.addEventListener("pointerdown",beginDrag);
window.addEventListener("pointermove",moveDrag);
window.addEventListener("pointerup",endDrag);
window.addEventListener("resize",updateSelectionBox);
selectFullBtn.addEventListener("click",setFullSelection);

async function requestMicrophone(){
  if(!micEl.checked)return null;

  try{
    micStream=await navigator.mediaDevices.getUserMedia({
      audio:{
        echoCancellation:true,
        noiseSuppression:true,
        autoGainControl:true,
        channelCount:1
      },
      video:false
    });

    const track=micStream.getAudioTracks().find(t=>t.readyState==="live");
    if(!track)throw new Error("O navegador não disponibilizou uma faixa de áudio do microfone.");

    // Em vez de anexar diretamente a faixa do microfone ao MediaStream
    // de captura da tela, passamos o microfone por um AudioContext.
    // Essa abordagem é mais estável no Chrome para MediaRecorder.
    audioInputStreams=[micStream];
    audioContext=new AudioContext();
    if(audioContext.state==="suspended")await audioContext.resume();

    const destination=audioContext.createMediaStreamDestination();
    const source=audioContext.createMediaStreamSource(micStream);
    const gain=audioContext.createGain();
    gain.gain.value=1;
    source.connect(gain).connect(destination);

    const mixedTrack=destination.stream.getAudioTracks().find(t=>t.readyState==="live");
    if(!mixedTrack)throw new Error("Não foi possível criar a faixa de áudio do microfone.");

    return mixedTrack;
  }catch(e){
    stopAudioResources();
    throw new Error("Não foi possível acessar o microfone: "+(e?.name||e?.message||e));
  }
}

function stopAudioResources(){
  for(const s of audioInputStreams){
    try{s.getTracks().forEach(t=>t.stop());}catch(_){}
  }
  audioInputStreams=[];
  if(micStream){
    try{micStream.getTracks().forEach(t=>t.stop());}catch(_){}
    micStream=null;
  }
  if(audioContext){
    try{audioContext.close();}catch(_){}
    audioContext=null;
  }
}

function createRecorder(){
  const mimeType=chooseMime();
  const bitrate={high:8000000,medium:5000000,low:2500000}[qualityEl.value];
  const options=mimeType?{mimeType,videoBitsPerSecond:bitrate}:{videoBitsPerSecond:bitrate};
  const recorder=new MediaRecorder(recordStream,options);
  recorder.ondataavailable=e=>{
    if(e.data&&e.data.size)chunks.push(e.data);
  };
  recorder.onerror=e=>{
    showError("Erro durante a gravação: "+(e.error?.message||"desconhecido"));
  };
  return recorder;
}

async function startRecorderSegment(){
  mediaRecorder=createRecorder();
  mediaRecorder.start(500);
}

function isFullSelection(){
  return Math.round(selection.x)===0 && Math.round(selection.y)===0 &&
         Math.round(selection.w)===sourceWidth && Math.round(selection.h)===sourceHeight;
}

function startCanvasLoop(){
  if(drawTimer)clearInterval(drawTimer);
  const fps=Number(fpsEl.value);
  const drawFrame=()=>{
    if(!sourceStream||!canvasCtx||!preview.videoWidth)return;
    canvasCtx.drawImage(preview,selection.x,selection.y,selection.w,selection.h,0,0,canvas.width,canvas.height);
  };
  drawFrame();
  drawTimer=setInterval(drawFrame,Math.max(10,Math.round(1000/fps)));
}

async function startRecording(){
  clearError();
  if(!sourceStream||!selection.w||!selection.h){
    showError("Escolha a área que será gravada.");
    return;
  }

  const full=isFullSelection();
  directVideoRecording=full;

  try{
    let videoTrack;

    if(full){
      // Para tela inteira, grava diretamente a faixa capturada.
      // Isso evita renderizar a tela inteira novamente em um canvas,
      // reduzindo muito o uso de CPU/GPU e evitando travamentos ao parar.
      videoTrack=sourceStream.getVideoTracks()[0];
      if(!videoTrack)throw new Error("A captura não possui uma faixa de vídeo ativa.");
    }else{
      canvas=document.createElement("canvas");
      canvas.width=Math.max(2,Math.round(selection.w));
      canvas.height=Math.max(2,Math.round(selection.h));
      canvasCtx=canvas.getContext("2d",{alpha:false});
      const fps=Number(fpsEl.value);
      videoTrack=canvas.captureStream(fps).getVideoTracks()[0];
      if(!videoTrack)throw new Error("Não foi possível criar a faixa de vídeo da área selecionada.");
    }

    const tracks=[videoTrack];
    const micTrack=await requestMicrophone();
    if(micTrack)tracks.push(micTrack);

    recordStream=new MediaStream(tracks);
    chunks=[];
    await startRecorderSegment();

    if(!full)startCanvasLoop();

    selectionPanel.classList.add("hidden");
    fitRecorderWindow(false);
    chooseBtn.disabled=true;
    pauseBtn.disabled=false;
    stopBtn.disabled=false;
    paused=false;
    pauseBtn.innerHTML="<span class=\"icon icon-pause\"></span><span class=\"btn-label\">Pausar</span>";
    setState("Gravando");
    infoEl.textContent=full
      ? `Gravando tela inteira • ${sourceWidth} × ${sourceHeight} • microfone: ${micTrack?"ativo":"desativado"}`
      : `Gravando área selecionada • ${canvas.width} × ${canvas.height} • microfone: ${micTrack?"ativo":"desativado"}`;
    startTimer();
  }catch(e){
    if(drawTimer){clearInterval(drawTimer);drawTimer=null;}
    if(recordStream){try{recordStream.getTracks().forEach(t=>t.stop());}catch(_){} recordStream=null;}
    stopAudioResources();
    showError(e?.message||"Não foi possível iniciar a gravação.");
  }
}

function finalizeRecording(){
  if(drawTimer){clearInterval(drawTimer);drawTimer=null;}

  const type=mediaRecorder?.mimeType||chooseMime()||"video/webm";
  finalBlob=new Blob(chunks,{type});

  if(recordStream){
    try{recordStream.getTracks().forEach(t=>t.stop());}catch(_){}
    recordStream=null;
  }
  if(sourceStream){
    try{sourceStream.getTracks().forEach(t=>t.stop());}catch(_){}
    sourceStream=null;
  }

  stopAudioResources();
  stopTimer();
  fitRecorderWindow(false);
  paused=false;
  directVideoRecording=false;
  chooseBtn.disabled=false;
  pauseBtn.disabled=true;
  stopBtn.disabled=true;
  downloadBtn.disabled=finalBlob.size===0;
  if(uploadDriveBtn)uploadDriveBtn.disabled=finalBlob.size===0;
  if(shareResultEl)shareResultEl.classList.add("hidden");
  if(cloudStatusEl)cloudStatusEl.classList.remove("show");
  sharedVideoUrl="";
  setState("Concluído");
  infoEl.textContent=`Gravação finalizada: ${finalBlob.size?Math.round(finalBlob.size/1024/1024):0} MB. Clique em “Baixar vídeo”.`;
}

function stopCurrentSegment(finalize){
  return new Promise(resolve=>{
    if(!mediaRecorder || mediaRecorder.state==="inactive"){
      if(finalize)finalizeRecording();
      resolve();
      return;
    }
    const recorder=mediaRecorder;
    let settled=false;
    const finish=()=>{
      if(settled)return;
      settled=true;
      recorder.removeEventListener("stop",finish);
      if(finalize)finalizeRecording();
      resolve();
    };
    recorder.addEventListener("stop",finish,{once:true});
    try{
      // O timeslice já entrega os dados periodicamente. Não chamamos
      // requestData() imediatamente antes de stop(), pois isso pode
      // provocar uma finalização inconsistente no Chrome.
      if(recorder.state!=="inactive")recorder.stop();
      else finish();
    }catch(e){finish();}
  });
}

async function pauseRecording(){
  if(!mediaRecorder || mediaRecorder.state!=="recording")return;
  await stopCurrentSegment(false);
  paused=true;
  pauseTimer();
  pauseBtn.innerHTML="<span class=\"icon icon-play\"></span><span class=\"btn-label\">Continuar</span>";
  setState("Pausado");
  infoEl.textContent="Gravação pausada.";
}

async function resumeRecording(){
  if(!recordStream)return;
  try{
    await startRecorderSegment();
    paused=false;
    resumeTimer();
    pauseBtn.innerHTML="<span class=\"icon icon-pause\"></span><span class=\"btn-label\">Pausar</span>";
    setState("Gravando");
    infoEl.textContent=directVideoRecording?"Gravando tela inteira.":"Gravando a área selecionada.";
  }catch(e){
    showError("Não foi possível continuar a gravação: "+(e?.message||e));
  }
}

async function stopRecording(){
  clearError();
  if(mediaRecorder && mediaRecorder.state!=="inactive")await stopCurrentSegment(true);
  else finalizeRecording();
}

startRecordingBtn.addEventListener("click",startRecording);

chooseBtn.addEventListener("click",async()=>{
  clearError();
  // Aumenta a janela ANTES de abrir o seletor nativo do Chrome.
  // O chooseDesktopMedia é exibido dentro desta janela e, se ela estiver
  // compacta, o seletor fica sem espaço e pode aparecer cortado.
  await fitRecorderWindow(true);
  downloadBtn.disabled=true;
  finalBlob=null;
  chunks=[];
  elapsedBeforePause=0;
  timerEl.textContent="00:00:00";
  startRecordingBtn.disabled=true;

  try{
    infoEl.textContent="Escolha primeiro a opção Tela inteira, Janela ou Guia.";
    sourceStream=await getCaptureStream();
    const vt=sourceStream.getVideoTracks()[0];
    if(!vt)throw new Error("Nenhuma faixa de vídeo foi disponibilizada.");
    const settings=vt.getSettings();
    sourceWidth=settings.width||0;
    sourceHeight=settings.height||0;
    if(!sourceWidth||!sourceHeight)throw new Error("Não foi possível obter a resolução da captura.");

    preview.srcObject=sourceStream;
    await preview.play();
    selectionPanel.classList.remove("hidden");
    fitRecorderWindow(true);
    setFullSelection();
    selectionHint.classList.remove("hidden");
    setState("Selecionar área");
    infoEl.textContent=`Captura pronta • ${sourceWidth} × ${sourceHeight} • áudio do computador desativado • microfone: ${micEl.checked?"será solicitado ao iniciar":"desativado"}`;
    chooseBtn.disabled=true;
  }catch(err){
    await fitRecorderWindow(false);
    if(sourceStream){try{sourceStream.getTracks().forEach(t=>t.stop());}catch(_){} sourceStream=null;}
    stopAudioResources();
    showError(err?.message||"Não foi possível iniciar a captura.");
    setState("Pronto");
    infoEl.textContent="Clique em “Escolher tela” para tentar novamente.";
  }
});

pauseBtn.addEventListener("click",async()=>{
  clearError();
  pauseBtn.disabled=true;
  try{
    if(!paused)await pauseRecording();
    else await resumeRecording();
  }finally{
    pauseBtn.disabled=false;
  }
});

stopBtn.addEventListener("click",async()=>{
  clearError();
  pauseBtn.disabled=true;
  stopBtn.disabled=true;
  try{
    await stopRecording();
  }catch(e){
    showError("Não foi possível finalizar a gravação: "+(e?.message||e));
    chooseBtn.disabled=false;
    stopBtn.disabled=true;
    pauseBtn.disabled=true;
  }
});

downloadBtn.addEventListener("click",()=>{
  if(!finalBlob||!finalBlob.size)return;
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const url=URL.createObjectURL(finalBlob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`Gravacao_${stamp}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
});

closeBtn.addEventListener("click",async()=>{
  if(mediaRecorder&&mediaRecorder.state!=="inactive"){
    if(!confirm("Há uma gravação em andamento. Deseja realmente fechar e perder a gravação?"))return;
    try{await stopCurrentSegment(false);}catch(e){}
  }
  if(sourceStream)try{sourceStream.getTracks().forEach(t=>t.stop());}catch(_){}
  if(recordStream)try{recordStream.getTracks().forEach(t=>t.stop());}catch(_){}
  stopAudioResources();
  window.close();
});

window.addEventListener("beforeunload",()=>{
  if(sourceStream)try{sourceStream.getTracks().forEach(t=>t.stop());}catch(_){}
  if(recordStream)try{recordStream.getTracks().forEach(t=>t.stop());}catch(_){}
  stopAudioResources();
});

async function getCaptureStream(){
  if(!chrome?.desktopCapture?.chooseDesktopMedia){
    throw new Error("A API de captura do Chrome não está disponível nesta versão da extensão.");
  }

  const streamId=await new Promise((resolve,reject)=>{
    chrome.desktopCapture.chooseDesktopMedia(
      ["screen","window","tab"],
      null,
      (id)=>resolve(id)
    );
  });

  if(!streamId)throw new Error("A captura foi cancelada.");

  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{
        mandatory:{
          chromeMediaSource:"desktop",
          chromeMediaSourceId:streamId
        }
      }
    });
  }catch(err){
    throw new Error(`Não foi possível obter o vídeo da fonte escolhida: ${err?.name||err?.message||err}`);
  }

  const videoTrack=stream.getVideoTracks()[0];
  if(!videoTrack){
    stream.getTracks().forEach(t=>t.stop());
    throw new Error("Nenhuma faixa de vídeo foi disponibilizada pelo Chrome.");
  }

  videoTrack.addEventListener("ended",()=>{
    if(mediaRecorder&&mediaRecorder.state!=="inactive")stopRecording().catch(()=>{});
  });

  return stream;
}

// --- Google Drive (opcional) ---
const uploadDriveBtn = document.getElementById("uploadDrive");
const cloudStatusEl = document.getElementById("cloudStatus");
const shareResultEl = document.getElementById("shareResult");
const copyLinkBtn = document.getElementById("copyLink");
const openLinkBtn = document.getElementById("openLink");
let sharedVideoUrl = "";

function showCloudStatus(text, show=true){
  cloudStatusEl.textContent=text;
  cloudStatusEl.classList.toggle("show",show);
}
async function showShareResult(url){
  sharedVideoUrl=url;
  shareResultEl.classList.remove("hidden");
  // Expande a janela para que o bloco de compartilhamento fique totalmente visível.
  await fitRecorderWindow(false,true);
}

uploadDriveBtn?.addEventListener("click", async ()=>{
  if(!finalBlob || !finalBlob.size || !window.uploadBlobToDrive)return;
  uploadDriveBtn.disabled=true;
  downloadBtn.disabled=true;
  shareResultEl.classList.add("hidden");
  showCloudStatus("Autenticando sua conta Google…");
  try{
    const stamp=new Date().toISOString().replace(/[:.]/g,"-");
    const filename=`Gravacao_${stamp}.webm`;
    showCloudStatus("Enviando vídeo para o Google Drive… 0%");
    const result=await uploadBlobToDrive(finalBlob,filename,p=>showCloudStatus(`Enviando vídeo para o Google Drive… ${p}%`));
    if(result.shareWarning){
      showCloudStatus(`Vídeo enviado, mas o compartilhamento público não foi habilitado: ${result.shareWarning}`);
    }else{
      showCloudStatus(`Vídeo enviado para o Google Drive • ${result.folderName || "Ext-gravações de tela"}`);
    }
    showShareResult(result.url);
  }catch(e){
    showCloudStatus(e?.message||"Não foi possível enviar o vídeo para o Google Drive.");
  }finally{
    uploadDriveBtn.disabled=finalBlob?.size===0;
    downloadBtn.disabled=finalBlob?.size===0;
  }
});

copyLinkBtn?.addEventListener("click", async ()=>{
  if(!sharedVideoUrl)return;
  try{
    await navigator.clipboard.writeText(sharedVideoUrl);
    const old=copyLinkBtn.innerHTML;
    copyLinkBtn.textContent="✓ Link copiado";
    setTimeout(()=>copyLinkBtn.innerHTML=old,1500);
  }catch(_){
    showCloudStatus("Não foi possível copiar o link automaticamente.");
  }
});

openLinkBtn?.addEventListener("click",()=>{
  if(sharedVideoUrl)window.open(sharedVideoUrl,"_blank","noopener,noreferrer");
});
