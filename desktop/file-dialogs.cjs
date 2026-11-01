const {randomUUID}=require('node:crypto');
const path=require('node:path');
function installFileDialogBridge(child,dialog,parent){
 let busy=false;
 const receive=async message=>{
  const request=message?.fileDialogRequest;
  if(!request||!/^[a-f\d-]{36}$/.test(request.id)||!['folder','executable'].includes(request.kind)||!child.connected)return;
  const send=value=>{try{if(child.connected)child.send({fileDialogResponse:{id:request.id,...value}},()=>{})}catch{}};
  if(busy)return send({error:'还有一个文件选择窗口未关闭'});
  busy=true;
  try{
   const result=await dialog.showOpenDialog(parent(),{title:request.kind==='folder'?'选择文件夹':'选择智能体程序',properties:[request.kind==='folder'?'openDirectory':'openFile'],...(request.kind==='executable'?{filters:[{name:'Windows 程序',extensions:['exe']}]}:{})});
   send({path:result.canceled?null:result.filePaths[0]||null});
  }catch{send({error:'无法打开文件选择窗口'})}finally{busy=false}
 };
 child.on('message',receive);child.once('exit',()=>child.off('message',receive));
}
function requestFileDialog(kind,channel=process,timeoutMs=120000){
 return new Promise((resolve,reject)=>{
  if(!channel.connected||typeof channel.send!=='function')return reject(Error('文件选择器需要桌面窗口，请输入绝对路径'));
  const id=randomUUID();let timer,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);channel.off('message',receive);channel.off('disconnect',disconnected);error?reject(error):resolve(value)};
  const receive=message=>{const response=message?.fileDialogResponse;if(response?.id!==id)return;if(response.error)return finish(Error(response.error));if(response.path!==null&&(typeof response.path!=='string'||!path.isAbsolute(response.path)))return finish(Error('文件选择结果无效'));finish(null,response.path)};
  const disconnected=()=>finish(Error('桌面窗口已断开'));
  channel.on('message',receive);channel.once('disconnect',disconnected);timer=setTimeout(()=>finish(Error('文件选择超时，请重试')),timeoutMs);
  try{channel.send({fileDialogRequest:{id,kind}},error=>{if(error)finish(error)})}catch(error){finish(error)}
 });
}
module.exports={installFileDialogBridge,requestFileDialog};
