export type ProDownloadPlatform='darwin-arm64'|'win32-x64';

export function proDownloadPlatform(os:NodeJS.Platform=process.platform,arch:string=process.arch):ProDownloadPlatform {
 if(os==='win32'&&arch==='x64')return 'win32-x64';
 if(os==='darwin'&&arch==='arm64')return 'darwin-arm64';
 throw Object.assign(Error('当前系统或芯片暂无可用的 Pro 安装包。'),{status:409});
}

/** Check the server's platform binding before sending the browser to its signed
 * URL. The signature itself is verified by the download server, not the client. */
export function proDownloadUrl(value:Record<string,unknown>,origin:string,target:ProDownloadPlatform,testOrigin?:string,now=Date.now()):string {
 if(!value.downloadUrl)throw Error(typeof value.downloadMessage==='string'?value.downloadMessage:'当前账号没有可用下载');
 if(value.downloadPlatform!==target)throw Object.assign(Error('下载服务尚未提供匹配本机系统的安装包，请稍后重试。'),{status:409});
 if(typeof value.downloadUrl!=='string')throw Error('下载地址无效');
 const u=new URL(value.downloadUrl,origin);
 const local=testOrigin===origin&&/^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
 if(u.origin!==origin||(!local&&u.protocol!=='https:')||u.username||u.password||u.hash)throw Error('下载地址无效');
 const validName=target==='win32-x64'
  ? /^\/releases\/OpenTake-Pro-\d{1,3}\.\d{1,3}\.\d{1,3}-win32-x64-installer\.exe$/
  : /^\/releases\/OpenTake-Pro-[a-zA-Z0-9_.-]+\.(zip|dmg)$/;
 if(!validName.test(u.pathname)||(target==='darwin-arm64'&&/win32/i.test(u.pathname)))throw Error('下载地址无效');
 const keys=['platform','expires','nonce','signature'];
 if([...u.searchParams.keys()].some(key=>!keys.includes(key))||keys.some(key=>u.searchParams.getAll(key).length!==1))throw Error('下载链接校验信息无效，请重新获取。');
 const expires=Number(u.searchParams.get('expires'));
 if(u.searchParams.get('platform')!==target||!Number.isSafeInteger(expires)||expires<=now||expires>now+6*3600000||!/^\d+$/.test(u.searchParams.get('expires')||'')||!/^[\w-]{16}$/.test(u.searchParams.get('nonce')||'')||!/^[\w-]{43}$/.test(u.searchParams.get('signature')||''))throw Error('下载链接校验信息无效，请重新获取。');
 return u.href;
}
