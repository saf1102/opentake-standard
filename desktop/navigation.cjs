const {sameOrigin}=require('./policy.cjs');

function navigationTarget(value,origin){
 try{
  const url=new URL(value);
  if(url.username||url.password)return null;
  if((url.protocol==='http:'||url.protocol==='https:')&&sameOrigin(url.href,origin))return {kind:'internal',url:url.href};
  if(url.protocol==='https:')return {kind:'external',url:url.href};
 }catch{}
 return null;
}

function installNavigation({window,origin,shell,dialog}){
 const contents=window.webContents;
 const trusted=()=>!window.isDestroyed()&&sameOrigin(contents.getURL(),origin);
 async function open(target){
  try{
   if(target.kind==='internal')await window.loadURL(target.url);
   else await shell.openExternal(target.url,{activate:true});
  }catch{
   if(window.isDestroyed())return;
   dialog.showErrorBox(target.kind==='external'?'无法打开网页':'无法打开页面',
    target.kind==='external'?`无法启动系统浏览器，请检查默认浏览器后重试。\n\n网页地址：${target.url}`:'页面未能打开，请重试。');
  }
 }
 contents.on('will-navigate',(event,url)=>{
  const target=navigationTarget(url,origin);
  if(target?.kind==='internal')return;
  event.preventDefault();
  if(trusted()&&target)void open(target);
 });
 // A local redirect must not replace the desktop workspace with remote content.
 contents.on('will-redirect',(event,url)=>{
  if(navigationTarget(url,origin)?.kind!=='internal')event.preventDefault();
 });
 contents.setWindowOpenHandler(({url,postBody})=>{
  const target=navigationTarget(url,origin);
  // Keep the workspace in one window; never reinterpret a POST as a browser GET.
  if(trusted()&&target&&!postBody)void open(target);
  return {action:'deny'};
 });
}

module.exports={installNavigation};
