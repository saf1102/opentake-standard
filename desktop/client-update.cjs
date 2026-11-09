const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn,spawnSync}=require('node:child_process');
// Packaging omits these; they contain no code the app runs, so the receipt check must skip them too.
const unpackaged=rel=>/\.test\./.test(rel)||/\.d\.ts$/.test(rel)||rel.startsWith('server/test-support/')||['desktop/build-app.mjs','desktop/builder.config.cjs'].includes(rel);
/** True when the app's code still matches the official source receipt (i.e. nobody edited it locally). */
function receiptMatches(root,version,testMode=false){
 try{const receipt=JSON.parse(fs.readFileSync(path.join(root,'release-source.json')));if(receipt.localCandidate&&!testMode)return false;if(receipt.repository!=='saf1102/opentake-standard'||receipt.version!==version||!receipt.files)return false;
  for(const [rel,expected] of Object.entries(receipt.files)){if(!/^(src|server|shared|desktop)\//.test(rel)||unpackaged(rel))continue;const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep))return false;const b=fs.readFileSync(file);if(crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex')!==expected)return false;}
  return true}catch{return false}
}
/**
 * After the Windows installer relaunches the app, the old run's state still says "installing" and its downloaded
 * installer is still on disk. If this app is that version (or newer), the update finished: mark it and clean up.
 */
function reconcileAfterInstall(state,version,newer){
 if(!state||state.status!=='installing'||typeof state.version!=='string')return null;
 return state.version===version||newer(version,state.version)?{...state,status:'completed',step:3,installer:undefined}:null;
}
const testOrigin=()=>{const feed=process.env.OPENTAKE_MAC_UPDATE_TEST_URL,win=process.env.OPENTAKE_WINDOWS_UPDATE_TEST_URL,legacy=process.env.OPENTAKE_UPGRADE_TEST_URL;for(const value of [feed,win])if(value&&/^http:\/\/127\.0\.0\.1:\d+\//.test(value))return new URL(value).origin;return /^http:\/\/127\.0\.0\.1:\d+$/.test(legacy||'')?legacy:undefined};
function installUpdateIPC({app,ipcMain,trusted,root,getOrigin}){
 const profile=app.getPath('userData'),updates=path.join(profile,'updates');fs.mkdirSync(updates,{recursive:true});
 const state=path.join(updates,'state.json'),cancel=path.join(updates,'cancel');let running=false;
 const macTarget=()=>path.dirname(path.dirname(path.dirname(process.execPath)));
 function capability(){
  if(!app.isPackaged)return {supported:false,reason:'从源码运行时，请按 AGENTS.md 交给智能体更新。'};
  if(process.platform==='win32')return {supported:true};
  if(process.platform!=='darwin')return {supported:false,reason:'当前系统暂不支持一键更新。'};
  const target=macTarget();if(path.basename(target)!=='OpenTake Standard.app')return {supported:false,reason:'安装位置不支持自动更新，请从「应用程序」打开 OpenTake Standard。'};
  try{fs.accessSync(path.dirname(target),fs.constants.W_OK)}catch{return {supported:false,reason:'没有权限替换「'+path.dirname(target)+'」里的 App，请把 OpenTake Standard 放进「应用程序」后再更新。'}}
  // A locally edited build still updates, but the user is told the edits will be replaced by the official app.
  return {supported:true,modified:!receiptMatches(root,app.getVersion(),Boolean(testOrigin()))};
 }
 const readState=()=>{try{return JSON.parse(fs.readFileSync(state))}catch{return {step:0,status:'idle'}}};
 {const done=reconcileAfterInstall(readState(),app.getVersion(),(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false});
  if(done){fs.writeFileSync(state,JSON.stringify(done));for(const name of fs.readdirSync(updates))if(/^[0-9a-f-]{36}$/.test(name))fs.rmSync(path.join(updates,name),{recursive:true,force:true})}}
 ipcMain.handle('standard:update-status',event=>{if(!trusted(event))throw Error('无效窗口');return {...readState(),...capability()}});
 ipcMain.handle('standard:update-cancel',event=>{if(!trusted(event))throw Error('无效窗口');fs.writeFileSync(cancel,'cancel')});
 ipcMain.handle('standard:update-restart',event=>{
  if(!trusted(event))throw Error('无效窗口');const s=readState();if(s.status!=='prepared')throw Error('新版尚未准备完成');
  if(process.platform==='win32'){
   // Silent install into the existing location, then the installer starts the new version (--force-run).
   const installer=path.resolve(String(s.installer||''));if(!installer.startsWith(updates+path.sep)||!/\.exe$/i.test(installer)||!fs.existsSync(installer))throw Error('安装程序不存在，请重新开始更新');
   if(fs.statSync(installer).size!==s.totalBytes)throw Error('安装程序已改变，请重新开始更新');
   fs.writeFileSync(state,JSON.stringify({...s,status:'installing'}));
   spawn(installer,['/S','--updated','--force-run'],{detached:true,stdio:'ignore',windowsHide:false}).unref();app.quit();return;
  }
  if(!Number.isSafeInteger(s.pid)||s.pid<=0)throw Error('新版尚未准备完成');try{process.kill(s.pid,0)}catch{throw Error('更新进程已经退出，请重新开始')}app.quit();
 });
 ipcMain.handle('standard:update-start',async(event,release)=>{
  if(!trusted(event))throw Error('无效窗口');if(running)throw Error('正在更新');const cap=capability();if(!cap.supported)throw Error(cap.reason);
  const view=await (await fetch(getOrigin()+(process.platform==='win32'?'/api/upgrade/windows/client':'/api/upgrade/client'))).json();
  if(!view.available||JSON.stringify(view.release)!==JSON.stringify(release))throw Error('更新清单已改变，请重新检查');
  let target,bundleId;
  if(process.platform==='darwin'){
   // No workspace is overwritten. Only the explicitly running packaged Standard app is a replacement target.
   target=macTarget();const id=spawnSync('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw',path.join(target,'Contents/Info.plist')],{encoding:'utf8'});bundleId=id.status===0?id.stdout.trim():'';if(!bundleId)throw Error('无法读取当前 App 的标识');
  }
  for(const name of fs.readdirSync(updates))if(/^[0-9a-f-]{36}$/.test(name))fs.rmSync(path.join(updates,name),{recursive:true,force:true});
  const work=path.join(updates,crypto.randomUUID());fs.mkdirSync(work);for(const name of ['update-worker.cjs','update-engine.cjs','platform.cjs','update-source.cjs'])fs.copyFileSync(path.join(__dirname,name),path.join(work,name));
  fs.rmSync(cancel,{force:true});fs.writeFileSync(state,JSON.stringify({step:0,status:'running',totalBytes:release.size}));
  const config={platform:process.platform,release,work,state,cancel,target,bundleId,testOrigin:testOrigin(),pid:process.pid,backups:path.join(profile,'backups'),profile};const file=path.join(work,'job.json');fs.writeFileSync(file,JSON.stringify(config));
  running=true;const child=spawn(process.execPath,[path.join(work,'update-worker.cjs'),file],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},detached:true,stdio:'ignore',windowsHide:true});child.unref();
  const timer=setInterval(()=>{const s=readState();if(['prepared','completed','failed','cancelled'].includes(s.status)){running=s.status==='prepared'&&process.platform==='darwin';clearInterval(timer)}},500);timer.unref();
 });
}
module.exports={installUpdateIPC,receiptMatches,reconcileAfterInstall};
