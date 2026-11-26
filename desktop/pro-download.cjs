function proDownloadPlatform(os=process.platform,arch=process.arch) {
 if(os==='win32'&&arch==='x64')return 'win32-x64';
 if(os==='darwin'&&arch==='arm64')return 'darwin-arm64';
 throw Object.assign(Error('当前系统或芯片暂无可用的 Pro 安装包。'),{status:409});
}

function proDownloadUrl(value,origin,target,testOrigin,now=Date.now()) {
 if(!value.downloadUrl)throw Error(typeof value.downloadMessage==='string'?value.downloadMessage:'当前账号没有可用下载');
 if(value.downloadPlatform!==target)throw Object.assign(Error('下载服务尚未提供匹配本机系统的安装包，请稍后重试。'),{status:409});
 if(typeof value.downloadUrl!=='string')throw Error('下载地址无效');
 const u=new URL(value.downloadUrl,origin);
 const local=testOrigin===origin&&/^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
 if(u.origin!==origin||(!local&&u.protocol!=='https:')||u.username||u.password||u.hash)throw Error('下载地址无效');
 const validName=target==='win32-x64'
  ? /^\/releases\/OpenTake-Pro-\d{1,3}\.\d{1,3}\.\d{1,3}-win32-x64-installer\.exe$/
  : /^\/releases\/OpenTake-Pro-\d{1,3}\.\d{1,3}\.\d{1,3}-arm64(?:-mac\.zip|\.dmg)$/;
 if(!validName.test(u.pathname))throw Error('下载地址无效');
 const keys=['platform','expires','nonce','signature'];
 if([...u.searchParams.keys()].some(key=>!keys.includes(key))||keys.some(key=>u.searchParams.getAll(key).length!==1))throw Error('下载链接校验信息无效，请重新获取。');
 const expires=Number(u.searchParams.get('expires'));
 if(u.searchParams.get('platform')!==target||!Number.isSafeInteger(expires)||expires<=now||expires>now+6*3600000||!/^\d+$/.test(u.searchParams.get('expires')||'')||!/^[\w-]{16}$/.test(u.searchParams.get('nonce')||'')||!/^[\w-]{43}$/.test(u.searchParams.get('signature')||''))throw Error('下载链接校验信息无效，请重新获取。');
 return u.href;
}

const officialOrigin = new URL(require('../upgrade.json').endpoint).origin;
function installProDownload({ipcMain,trusted,getOrigin,shell,platform=process.platform,arch=process.arch}) {
 ipcMain.handle('standard:pro-download',async (event,...args)=>{
  if (!trusted(event)||args.length) return {error:'无效的下载请求。'};
  try {
   const target=proDownloadPlatform(platform,arch);
   const service=getOrigin();
   if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(service)) throw Error('本机升级服务未连接。');
   const response=await fetch(service+'/api/upgrade/download',{redirect:'manual',signal:AbortSignal.timeout(15000)});
   if(response.status!==302){
    const body=await response.json().catch(()=>null);
    throw Error(typeof body?.error==='string'?body.error:'暂时无法取得下载链接，请重试。');
   }
   const url=proDownloadUrl({downloadUrl:response.headers.get('location'),downloadPlatform:target},officialOrigin,target);
   try{await shell.openExternal(url)}catch{throw Error('无法打开系统浏览器，请检查默认浏览器后重试。')}
   return {ok:true};
  }catch(error){return {error:error instanceof TypeError||error.name==='TimeoutError'?'暂时连不上升级服务，请检查网络后重试。':error.message}}
 });
}
module.exports={proDownloadUrl,proDownloadPlatform,installProDownload};
