let current={},stopPending=false,confirmationTimer;
const byId=id=>document.getElementById(id);
const rank={starting:0,recording:1,stopping:2,saved:3,failed:3};
function clearConfirmation(){clearTimeout(confirmationTimer);confirmationTimer=undefined}
function render(state){
 const next=state||{};
 // A delayed initial IPC reply must not restore an older enabled Stop button.
 if(next.id&&next.id===current.id&&rank[next.phase]<rank[current.phase])return;
 if(next.id!==current.id||!['starting','recording'].includes(next.phase)){stopPending=false;clearConfirmation()}
 current=next;
 const phase=stopPending?'stopping':current.phase;
 byId('source').textContent=current.sourceName||'本机录制';
 byId('status').textContent=({starting:'正在准备录制…',recording:'正在录制',stopping:'正在停止并保存…',saved:'录制已保存',failed:'录制未完成'})[phase]||'尚未开始录制';
 byId('stop').textContent=phase==='saved'?'录制已保存':phase==='stopping'?'正在停止并保存…':'停止并保存';
 byId('stop').disabled=stopPending||!['starting','recording'].includes(current.phase);
 byId('shortcut').textContent=current.shortcutAvailable?'停止快捷键：'+current.shortcut:'快捷键被其他程序占用，请使用按钮或 OpenTake 托盘停止。';
 byId('error').hidden=!current.error;byId('error').textContent=current.error||'';
 document.body.dataset.phase=phase||'idle';tick();
}
function showError(error){byId('error').hidden=false;byId('error').textContent=error instanceof Error?error.message:String(error)}
function tick(){const seconds=current.startedAt?Math.max(0,Math.floor(((current.finishedAt||Date.now())-current.startedAt)/1000)):0;byId('elapsed').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
byId('stop').addEventListener('click',async()=>{
 if(stopPending||!['starting','recording'].includes(current.phase))return;
 const id=current.id;stopPending=true;render(current);
 try{
  const result=await window.recordingDesktop.stop();
  if(current.id!==id)return;
  if(result?.accepted===false){stopPending=false;render(result.state||await window.recordingDesktop.getState());return}
  render(await window.recordingDesktop.getState());
  if(current.id===id&&stopPending)confirmationTimer=setTimeout(async()=>{
   try{
    const state=await window.recordingDesktop.getState();if(current.id!==id)return;render(state);
    if(stopPending){stopPending=false;render(current);showError(new Error('停止请求尚未确认，请重试或使用 OpenTake 托盘停止。'))}
   }catch(error){if(current.id===id){stopPending=false;render(current);showError(error)}}
  },5000);
 }catch(error){if(current.id===id){stopPending=false;render(current);showError(error)}}
});
byId('project').addEventListener('click',()=>window.recordingDesktop.project().catch(showError));
byId('menu').addEventListener('click',()=>window.recordingDesktop.menu().catch(showError));
window.recordingDesktop.onState(render);window.recordingDesktop.getState().then(render).catch(showError);setInterval(tick,250);
