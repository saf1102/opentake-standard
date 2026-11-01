const {randomUUID}=require('node:crypto');
const SOURCE_OPTIONS=Object.freeze({types:['window','screen'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});
function captureSources(sources,displayIds){
 return sources.map(source=>{
  const type=source.id.startsWith('screen:')?'display':'window';
  const displayIndex=type==='display'?displayIds.indexOf(String(source.display_id)):undefined;
  if(type==='display'&&displayIndex<0)throw Error('屏幕列表已变化，请刷新录制来源。');
  return {id:source.id,type,name:source.name,captureValue:type==='display'?String(displayIndex):source.name,
   ...(type==='display'?{displayIndex}:{}),...(source.display_id?{displayId:String(source.display_id)}:{})};
 });
}
function validSources(sources){
 return Array.isArray(sources)&&sources.length<=5000&&sources.every(s=>s&&typeof s.name==='string'&&s.name.length<=4096&&
  /^(?:window|screen):\d+:\d+$/.test(s.id)&&['window','display'].includes(s.type)&&typeof s.captureValue==='string'&&
  (s.type!=='display'||Number.isInteger(s.displayIndex)&&s.displayIndex>=0&&s.captureValue===String(s.displayIndex)));
}
// Only the owned service uses this IPC channel. No renderer or network peer can
// request a screenshot; enumeration deliberately disables thumbnails and icons.
function installCaptureSourceBridge(child,provider){
 let pending;
 const receive=message=>{
  const id=message?.captureSourcesRequest?.id;
  if(typeof id!=='string'||!/^[a-f\d-]{36}$/.test(id)||!child.connected)return;
  if(!pending){pending=Promise.resolve().then(provider).then(sources=>{if(!validSources(sources))throw Error('Windows 录制来源格式无效。');return sources});pending.then(()=>{pending=undefined},()=>{pending=undefined})}
  const reply=body=>{try{if(child.connected)child.send({captureSourcesResponse:{id,...body}},()=>{})}catch{/* owned service disconnected */}};
  pending.then(sources=>reply({sources}),error=>reply({error:error instanceof Error?error.message:String(error)}));
 };
 child.on('message',receive);child.once('exit',()=>child.off('message',receive));
}
function requestCaptureSources(channel=process,timeoutMs=20000){
 return new Promise((resolve,reject)=>{
  if(!channel.connected||typeof channel.send!=='function')return reject(Error('本机窗口服务未连接，请重新打开程序。'));
  const id=randomUUID();let timer;
  const finish=(error,sources)=>{clearTimeout(timer);channel.off('message',receive);channel.off('disconnect',disconnected);error?reject(error):resolve(sources)};
  const disconnected=()=>finish(Error('读取录制来源时本机窗口服务已断开。'));
  const receive=message=>{const response=message?.captureSourcesResponse;if(response?.id!==id)return;
   if(response.error)return finish(Error(String(response.error)));
   if(!validSources(response.sources))return finish(Error('Windows 录制来源格式无效。'));
   finish(null,response.sources);
  };
  channel.on('message',receive);channel.once('disconnect',disconnected);
  timer=setTimeout(()=>finish(Error('读取 Windows 录制来源超时，请保留工程并重试。')),timeoutMs);
  try{channel.send({captureSourcesRequest:{id}},error=>{if(error)finish(error)})}catch(error){finish(error)}
 });
}
module.exports={SOURCE_OPTIONS,captureSources,installCaptureSourceBridge,requestCaptureSources};
