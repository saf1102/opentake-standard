import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {clientHeaders,clientVersion} from './standard/client-update.ts';
import {proDownloadPlatform,proDownloadUrl} from './standard/pro-download.ts';
const origin='https://download.example.test';
const win='win32-x64',mac='darwin-arm64';
const now=Date.now();
const signed=(platform=win)=>`/releases/OpenTake-Pro-1.1.2-${platform===win?'win32-x64-installer.exe':'arm64-mac.zip'}?platform=${platform}&expires=${now+3600000}&nonce=${'a'.repeat(16)}&signature=${'b'.repeat(43)}`;
const info=(platform=win)=>({downloadPlatform:platform,downloadUrl:signed(platform)});

test('按任务45格式报告系统，授权范围不从报告标记推断',()=>{
 assert.equal(clientHeaders(false,'win32')['X-OpenTake-Client'],`standard-win/${clientVersion}`);
 assert.equal(clientHeaders(false,'darwin')['X-OpenTake-Client'],`standard-mac/${clientVersion}`);
 assert.equal(clientHeaders(false,'linux')['X-OpenTake-Client'],`standard/${clientVersion}`);
 assert.equal(clientHeaders(false,'win32')['X-OpenTake-Install'],undefined);
 assert.equal(proDownloadPlatform('win32','x64'),win);assert.equal(proDownloadPlatform('darwin','arm64'),mac);
 for(const [platform,arch] of [['win32','arm64'],['win32','ia32'],['darwin','x64'],['linux','x64']] as const)assert.throws(()=>proDownloadPlatform(platform,arch),/暂无可用/);
});
test('限时下载要求本机平台、同源HTTPS和完整签名参数，保留原签名字节',()=>{
 for(const platform of [win,mac])assert.equal(proDownloadUrl(info(platform),origin,platform as any,undefined,now),origin+signed(platform));
 for(const downloadUrl of [
  'http://download.example.test'+signed(), 'https://other.example.test'+signed(),
  'https://user:password@download.example.test'+signed(), signed()+'#fragment',
  signed().replace('installer.exe','full.exe'),signed().replace('/releases/','/elsewhere/'),
  signed()+'&platform='+win,signed()+'&expires='+now,signed()+'&signature=x',signed()+'&nonce=x',signed()+'&extra=x',
  signed().replace('platform='+win,'platform='+mac),signed().replace(/&signature=.*/,''),
  signed().replace(String(now+3600000),String(now-1)),signed().replace(String(now+3600000),String(now+7*3600000)),
  signed().replace('nonce='+ 'a'.repeat(16),'nonce=bad'),signed().replace('signature='+ 'b'.repeat(43),'signature=bad'),
  '/releases/%2e%2e/elsewhere.exe'+signed().slice(signed().indexOf('?')),
 ])assert.throws(()=>proDownloadUrl({...info(),downloadUrl},origin,win,undefined,now));
 assert.throws(()=>proDownloadUrl(info(mac),origin,win),/匹配本机/);
 assert.throws(()=>proDownloadUrl({downloadUrl:signed()},origin,win),/匹配本机/);
 assert.throws(()=>proDownloadUrl({downloadMessage:'Windows 版 Pro 尚未提供，请勿下载 macOS 安装包。'},origin,win),/Windows 版 Pro 尚未提供/);
 assert.throws(()=>proDownloadUrl(info(),'http://127.0.0.1:1234',win),/下载地址无效/);
 assert.equal(proDownloadUrl(info(),'http://127.0.0.1:1234',win,'http://127.0.0.1:1234',now),'http://127.0.0.1:1234'+signed());
});

test('真实本机HTTP：旧网关丢弃新标记仍可申请/登录，新后台Windows下载、缺包和错包边界',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standard-pro-http-'));
 const keys=['OPENTAKE_STANDARD_USER_DATA','OPENTAKE_UPGRADE_TEST_URL'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const platform=Object.getOwnPropertyDescriptor(process,'platform')!,arch=Object.getOwnPropertyDescriptor(process,'arch')!;
 const seen:{url:string;header:string;forwarded?:string;body:any}[]=[];let legacy=true,response:Record<string,unknown>=info();let rejectLogin=false;
 const backend=http.createServer(async(req,res)=>{
  let bytes='';for await(const chunk of req)bytes+=chunk;
  const body=bytes?JSON.parse(bytes):{};const header=String(req.headers['x-opentake-client']);
  // Exact legacy public-gateway reporting allowlist: unknown reports are dropped,
  // not converted to scope and not an authorization error.
  const forwarded=legacy?(/^(pro|standard)\/\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(header)?header:undefined):header;
  seen.push({url:req.url!,header,forwarded,body});res.setHeader('Content-Type','application/json');
  if(req.url==='/api/login'||req.url==='/api/standard/apply'){
   if(rejectLogin){res.writeHead(401);return res.end(JSON.stringify({error:'账号或密码不正确'}));}
   if(req.url==='/api/login')assert.equal(body.scope,'standard');
   return res.end(JSON.stringify({token:'synthetic-local-session',status:'pending'}));
  }
  assert.equal(req.headers.authorization,'Bearer synthetic-local-session');
  res.end(JSON.stringify(response));
 });
 await new Promise<void>(r=>backend.listen(0,'127.0.0.1',r));
 const backendOrigin='http://127.0.0.1:'+(backend.address() as any).port;
 process.env.OPENTAKE_STANDARD_USER_DATA=root;process.env.OPENTAKE_UPGRADE_TEST_URL=backendOrigin;
 const {upgradeApi}=await import('./standard/upgrade.ts');
 const local=http.createServer((req,res)=>void upgradeApi(req,res));await new Promise<void>(r=>local.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+(local.address() as any).port+'/api/upgrade';
 const call=(route:string,body?:unknown)=>fetch(url+route,{method:body?'POST':'GET',redirect:'manual',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 try{
  for(const system of ['win32','darwin']){
   Object.defineProperty(process,'platform',{value:system});Object.defineProperty(process,'arch',{value:system==='win32'?'x64':'arm64'});
   for(const route of ['/apply','/login']){
    const r=await call(route,{username:'synthetic@example.test',password:'synthetic-only',scope:'pro'});
    assert.equal(r.status,200);assert.equal((await r.json()).token,undefined);assert.equal(seen.at(-1)!.forwarded,undefined);
    assert.equal(seen.at(-1)!.header,`standard-${system==='win32'?'win':'mac'}/${clientVersion}`);
   }
  }
  Object.defineProperty(process,'platform',{value:'win32'});Object.defineProperty(process,'arch',{value:'x64'});
  legacy=false;
  let r=await call('/download');assert.equal(r.status,302);assert.equal(r.headers.get('location'),backendOrigin+signed());
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(seen.at(-1)!.url,'/api/me?platform=win32-x64');assert.equal(seen.at(-1)!.forwarded,`standard-win/${clientVersion}`);
  response={downloadMessage:'Windows 版 Pro 尚未提供，请勿下载 macOS 安装包。'};
  r=await call('/download');assert.equal(r.status,503);assert.equal((await r.json()).error,response.downloadMessage);
  response=info(mac);r=await call('/download');assert.equal(r.status,409);assert.equal(r.headers.get('location'),null);
  response={downloadUrl:signed(mac)};r=await call('/download');assert.equal(r.status,409);
  Object.defineProperty(process,'platform',{value:'darwin'});Object.defineProperty(process,'arch',{value:'arm64'});
  response=info(mac);r=await call('/download');assert.equal(r.status,302);assert.equal(seen.at(-1)!.url,'/api/me?platform=darwin-arm64');
  Object.defineProperty(process,'arch',{value:'x64'});const count=seen.length;r=await call('/download');assert.equal(r.status,409);assert.equal(seen.length,count);
  rejectLogin=true;const calls=seen.length;r=await call('/login',{username:'synthetic@example.test',password:'wrong'});assert.equal(r.status,401);assert.equal(seen.length,calls+1,'不重放登录请求或掩盖密码错误');
 }finally{
  Object.defineProperty(process,'platform',platform);Object.defineProperty(process,'arch',arch);
  await Promise.all([new Promise<void>(r=>local.close(()=>r())),new Promise<void>(r=>backend.close(()=>r()))]);
  for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}
  fs.rmSync(root,{recursive:true,force:true});
 }
});

for(const platform of ['darwin','win32'])test(platform+' 回环账号审批、每日提醒防重和关闭设置',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pro-daily-'));
 const savedPlatform=Object.getOwnPropertyDescriptor(process,'platform')!,savedArch=Object.getOwnPropertyDescriptor(process,'arch')!;
 let state='pending',checks=0,blocked=0;
 const remote=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/standard/upgrade.json'){checks++;return res.end(JSON.stringify({mode:'beta',notice:'可以升级 Pro'}))}
  if(req.url?.endsWith('.json')){res.writeHead(404);return res.end('{}')}
  if(req.url==='/api/standard/apply'||req.url==='/api/login')return res.end(JSON.stringify({token:'local-test-only',proStatus:state}));
  if(req.url?.startsWith('/api/me?')){
   assert.equal(req.url,'/api/me?platform='+(platform==='win32'?win:mac));assert.equal(req.headers.authorization,'Bearer local-test-only');
   if(blocked){res.writeHead(blocked);return res.end(JSON.stringify({error:'本机假后台原话 '+blocked}))}
   return res.end(JSON.stringify({username:'user@example.test',proStatus:state,downloadMessage:'本平台安装包暂未提供'}));
  }
  throw Error('意外路由 '+req.url);
 });
 await new Promise<void>(r=>remote.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(remote.address() as any).port;
 const vars={OPENTAKE_STANDARD_USER_DATA:root,OPENTAKE_UPGRADE_TEST_URL:origin,OPENTAKE_MAC_UPDATE_TEST_URL:origin+'/mac-update.json',OPENTAKE_UPGRADE_FALLBACK_URL:origin+'/fallback.json'};
 const before=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));
 Object.assign(process.env,vars);Object.defineProperty(process,'platform',{value:platform});Object.defineProperty(process,'arch',{value:platform==='win32'?'x64':'arm64'});
 const {upgradeApi}=await import('./standard/upgrade.ts?daily-'+platform);
 const local=http.createServer((req,res)=>void upgradeApi(req,res));await new Promise<void>(r=>local.listen(0,'127.0.0.1',r));
 t.after(async()=>{Object.defineProperty(process,'platform',savedPlatform);Object.defineProperty(process,'arch',savedArch);
  for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v}
  for(const s of [local,remote])await new Promise<void>(r=>s.close(()=>r()));fs.rmSync(root,{recursive:true,force:true})});
 const call=(route:string,method='GET',body?:unknown)=>fetch('http://127.0.0.1:'+(local.address() as any).port+'/api/upgrade/'+route,{method,redirect:'manual',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const prefs=platform==='win32'?'windows/preferences':'preferences';
 await call(prefs,'PUT',{daily:false});assert.deepEqual(await (await call('daily')).json(),{skipped:true});assert.equal(checks,0);
 await call(prefs,'PUT',{daily:true});assert.equal((await (await call('apply','POST',{name:'fixture'})).json()).proStatus,'pending');
 const responses=await Promise.all([call('daily'),call('daily')]);const pair=await Promise.all(responses.map(r=>r.json()));
 assert.equal(pair.filter(x=>x.remind&&x.account.proStatus==='pending').length,1);assert.equal(pair.filter(x=>x.skipped).length,1);assert.equal(checks,1);
 for(state of ['rejected','ended','approved']){
  const value=await (await call('state')).json();assert.equal(value.account.proStatus,state);assert.equal(value.remind,false);
  if(platform==='win32')assert.equal(value.clientUpdate,undefined);
 }
 await call('login','POST',{username:'fixture',password:'synthetic-only'});
 for(blocked of [409,503]){const r=await call('download');assert.equal(r.status,blocked);assert.equal((await r.json()).error,'本机假后台原话 '+blocked);}
});
