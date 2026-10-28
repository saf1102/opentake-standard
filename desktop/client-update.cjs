const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn,spawnSync}=require('node:child_process');
function installUpdateIPC({app,ipcMain,trusted,root,getOrigin}){
 const profile=app.getPath('userData'),updates=path.join(profile,'updates');fs.mkdirSync(updates,{recursive:true});
 const state=path.join(updates,'state.json'),cancel=path.join(updates,'cancel');let running=false;
 function capability(){
  if(process.platform!=='darwin'||!app.isPackaged)return {supported:false,reason:'此运行方式请交给智能体更新；Windows 暂不支持一键替换。'};
  try{const receipt=JSON.parse(fs.readFileSync(path.join(root,'release-source.json')));if(receipt.localCandidate&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.OPENTAKE_UPGRADE_TEST_URL||''))throw Error();if(receipt.repository!=='saf1102/opentake-standard'||receipt.version!==app.getVersion()||!receipt.files)throw Error();
   // electron-builder omits type declarations; they contain no executable code.
   for(const [rel,expected] of Object.entries(receipt.files)){if(!/^(src|server|shared|desktop)\//.test(rel)||(/\.test\./.test(rel)||/\.d\.ts$/.test(rel))||['desktop/build-app.mjs','desktop/builder.config.cjs'].includes(rel))continue;const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep))throw Error();const b=fs.readFileSync(file);if(crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex')!==expected)throw Error();}}
  catch{return {supported:false,reason:'此 App 无官方源码来源记录，请交给智能体更新。'}}
  return {supported:true};
 }
 ipcMain.handle('standard:update-status',event=>{if(!trusted(event))throw Error('无效窗口');let value={step:0,status:'idle'};try{value=JSON.parse(fs.readFileSync(state))}catch{}return {...value,...capability()}});
 ipcMain.handle('standard:update-cancel',event=>{if(!trusted(event))throw Error('无效窗口');fs.writeFileSync(cancel,'cancel')});
 ipcMain.handle('standard:update-restart',event=>{if(!trusted(event))throw Error('无效窗口');const s=JSON.parse(fs.readFileSync(state));if(s.status!=='prepared'||!Number.isSafeInteger(s.pid)||s.pid<=0)throw Error('新版尚未准备完成');try{process.kill(s.pid,0)}catch{throw Error('更新进程已经退出，请重新开始')}app.quit()});
 ipcMain.handle('standard:update-start',async(event,release)=>{
  if(!trusted(event))throw Error('无效窗口');if(running)throw Error('正在更新');const cap=capability();if(!cap.supported)throw Error(cap.reason);
  const v=await (await fetch(getOrigin()+'/api/upgrade/client')).json();if(!v.available||JSON.stringify(v.release)!==JSON.stringify(release))throw Error('更新清单已改变，请重新检查');
  // No workspace is overwritten. Only the explicitly running packaged Standard app is a replacement target.
  const target=path.dirname(path.dirname(path.dirname(process.execPath)));if(path.basename(target)!=='OpenTake Standard.app')throw Error('安装位置不支持自动更新');fs.accessSync(path.dirname(target),fs.constants.W_OK);
  const buildEnv=require('./agent-installation.cjs').loginEnvironment();
  const locate=name=>[...(buildEnv.PATH||'').split(path.delimiter),'/opt/homebrew/bin','/usr/local/bin'].filter(p=>path.isAbsolute(p)).map(p=>path.join(p,name)).find(p=>{try{fs.accessSync(p,fs.constants.X_OK);return true}catch{return false}});
  const npm=locate('npm'),python=locate('python3');if(!npm||!python)throw Error('请先安装 Node/npm 与 Python 3，或交给智能体更新');
  const work=path.join(updates,crypto.randomUUID());fs.mkdirSync(work);for(const name of ['update-worker.cjs','update-engine.cjs','update-extract.py','platform.cjs','update-source.cjs'])fs.copyFileSync(path.join(__dirname,name),path.join(work,name));
  fs.rmSync(cancel,{force:true});fs.writeFileSync(state,JSON.stringify({step:0,status:'running'}));const config={release,work,state,cancel,target,testOrigin:process.env.OPENTAKE_UPGRADE_TEST_URL,pid:process.pid,backups:path.join(profile,'backups'),profile,npm,python,extract:path.join(work,'update-extract.py')};const file=path.join(work,'job.json');fs.writeFileSync(file,JSON.stringify(config));
  running=true;const child=spawn(process.execPath,[path.join(work,'update-worker.cjs'),file],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PATH:[path.dirname(npm),buildEnv.PATH,'/opt/homebrew/bin','/usr/local/bin'].filter(Boolean).join(path.delimiter)},detached:true,stdio:'ignore'});child.unref();
  const timer=setInterval(()=>{try{const s=JSON.parse(fs.readFileSync(state));if(['completed','failed','cancelled'].includes(s.status)){running=false;clearInterval(timer)}}catch{}},500);timer.unref();
 });
}
module.exports={installUpdateIPC};
