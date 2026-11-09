const path = require('node:path');
const os = require('node:os');
const childProcess = require('node:child_process');
const {spawnSync} = childProcess;
const fs = require('node:fs');
function environmentPath(env=process.env,platform=process.platform){
 const key=platform==='win32'?Object.keys(env).find(name=>/^path$/i.test(name)):'PATH';
 return env.PATH??(key?env[key]:undefined)??'';
}
function environmentWithPath(env,value,platform=process.platform){
 const result={...env};
 // Node forwards only one case-insensitive Windows environment key to children.
 if(platform==='win32')for(const key of Object.keys(result))if(/^path$/i.test(key))delete result[key];
 result.PATH=value;return result;
}
function appDataRoot(platform=process.platform, env=process.env, home=os.homedir()) {
 const p=platform==='win32'?path.win32:path.posix;
 return platform==='win32' ? env.APPDATA||p.join(home,'AppData','Roaming') : platform==='darwin'?p.join(home,'Library','Application Support'):env.XDG_CONFIG_HOME||p.join(home,'.config');
}
function standardDataRoot(){return process.env.OPENTAKE_STANDARD_USER_DATA||path.join(appDataRoot(),'OpenTake Standard');}
// Compatibility aliases keep shared helpers inside the Standard profile.
function proDataRoot(platform=process.platform,env=process.env,home=os.homedir()){
 const p=platform==='win32'?path.win32:path.posix;
 return env.OPENTAKE_STANDARD_USER_DATA||p.join(appDataRoot(platform,env,home),'OpenTake Standard');
}
function desktopDataRoot(platform=process.platform,env=process.env,home=os.homedir()){
 const p=platform==='win32'?path.win32:path.posix;
 // Diagnostic and development paths keep their historical Mac location.
 return platform==='darwin'?p.join(appDataRoot(platform,env,home),'linkreader-desktop'):env.OPENTAKE_STANDARD_USER_DATA||p.join(appDataRoot(platform,env,home),'OpenTake Standard');
}
function projectsRoot(platform=process.platform,env=process.env,home=os.homedir()){
 const p=platform==='win32'?path.win32:path.posix;
 return env.LINK_READER_PROJECTS_DIR||p.join(home,platform==='win32'?'Videos':'Movies','LinkReader Projects');
}
function cacheRoot(name='OpenTake',platform=process.platform,env=process.env,home=os.homedir()){
 const p=platform==='win32'?path.win32:path.posix;
 return p.join(platform==='win32'?(env.LOCALAPPDATA||p.join(home,'AppData','Local')):platform==='darwin'?p.join(home,'Library','Caches'):(env.XDG_CACHE_HOME||p.join(home,'.cache')),name);
}
function runtimePath(env=process.env,front=[],platform=process.platform,home=os.homedir()){
 const p=platform==='win32'?path.win32:path.posix;
 return [...new Set([...front,env.LINKREADER_BIN_DIR,...(platform==='darwin'?['/opt/homebrew/bin','/usr/local/bin']:[]),environmentPath(env,platform)].filter(Boolean))].join(platform==='win32'?';':':');
}
function pythonEnv(env=process.env){return {...env,PYTHONUTF8:'1'};}
function runtimeBinaryCandidates(name,options={}){
 const platform=options.platform||process.platform,env=options.env||process.env,p=platform==='win32'?path.win32:path.posix;
 const names=platform==='win32'&&!/\.exe$/i.test(name)?[name+'.exe']:[name];
 const dirs=[env.LINKREADER_BIN_DIR,...(platform==='darwin'?['/opt/homebrew/bin','/usr/local/bin','/usr/bin']:[]),...environmentPath(env,platform).split(platform==='win32'?';':':')];
 return [...new Set([options.override,...dirs.filter(d=>d&&p.isAbsolute(d)).flatMap(d=>names.map(n=>p.join(d,n)))] .filter(Boolean))];
}
function runtimeBinaryPath(name,options={}){
 const exists=options.exists||((file)=>{try{return fs.statSync(file).isFile()}catch{return false}});
 const found=runtimeBinaryCandidates(name,options).find(exists);
 if(!found)throw Error('未找到运行组件：'+name+'，请配置 LINKREADER_BIN_DIR 或 PATH');
 return found;
}
function unsupportedWindows(feature,platform=process.platform){if(platform==='win32')throw Error('Windows 版暂未支持：'+feature);}

function termination(pid, signal='SIGTERM', platform=process.platform){
 if(!Number.isSafeInteger(pid)||pid<=0||pid===process.pid)throw Error('无效的子进程 ID');
 return platform==='win32'?{command:'taskkill.exe',args:['/PID',String(pid),'/T','/F']}:{pid:-pid,signal};
}
// Call only for workers owned by this runtime. Never terminate by executable name.
function killTree(pid,signal='SIGTERM',platform=process.platform,run=spawnSync,kill=process.kill){
 const action=termination(pid,signal,platform);
 try{if(action.command)run(action.command,action.args,{windowsHide:true,stdio:'ignore',timeout:5000});else {try{kill(action.pid,action.signal)}catch{kill(pid,signal)}}}catch{/* already gone */}
}
function revealCommand(target,platform=process.platform,env=process.env){
 const p=platform==='win32'?path.win32:path.posix;
 if(!p.isAbsolute(target)||target.includes('\0'))throw Error('文件路径必须是绝对路径');
 if(platform==='win32'){
  const systemRoot=env[Object.keys(env).find(key=>/^systemroot$/i.test(key))]||env[Object.keys(env).find(key=>/^windir$/i.test(key))];
  if(typeof systemRoot!=='string'||!p.isAbsolute(systemRoot)||systemRoot.includes('\0'))throw Error('Windows 系统目录无效，无法打开文件夹');
  return {command:p.join(systemRoot,'explorer.exe'),args:['/select,',target]};
 }
 if(platform==='darwin')return {command:'/usr/bin/open',args:['-R',target]};
 return {command:'xdg-open',args:[p.dirname(target)]};
}
async function revealPath(target,platform=process.platform,options={}){
 const command=revealCommand(target,platform,options.env||process.env);
 (options.stat||fs.statSync)(target);
 if(options.select===false&&platform==='darwin')command.args=[target];
 if(options.select===false&&platform==='win32')command.args=[target];
 // This is a user-requested file manager window. Hiding Explorer can silently
 // hide directory reveals even when the shell accepts the request.
 const child=(options.spawn||childProcess.spawn)(command.command,command.args,{detached:true,stdio:'ignore',windowsHide:false});
 await new Promise((resolve,reject)=>{
  child.once('error',reject);
  // Explorer hands the request to the desktop shell and can then exit with 1,
  // even after opening and selecting the requested item successfully.
  if(platform==='win32')child.once('spawn',resolve);
  else child.once('close',(code,signal)=>code===0?resolve():reject(Error(`文件管理器启动失败（${signal||code}）`)));
 });
 child.unref();
}
function buildTarget(platform=process.platform,arch=process.arch,release=os.release()){
 if(platform==='darwin'){if(!['arm64','x64'].includes(arch))throw Error('macOS 仅支持 Apple 芯片 arm64 或 Intel x64');return 'mac';}
 if(platform!=='win32'||arch!=='x64')throw Error('仅支持 macOS 和 Windows 10/11 x64 本机构建');
 const [major,,build]=release.split('.').map(Number);
 if(major!==10||!Number.isInteger(build)||build<19045)throw Error('需要 Windows 10 22H2 或 Windows 11');
 return build>=22000?'win11':'win10';
}
// sysctl.proc_translated is 1 only when an Intel process runs under Rosetta.
function macTranslated(run=spawnSync){
 const result=run('/usr/sbin/sysctl',['-in','sysctl.proc_translated'],{encoding:'utf8'});
 if(result.error)throw Error('无法检查 Mac 芯片，请确认系统工具可用。');
 return result.status===0 && String(result.stdout).trim()==='1';
}
function validateMacArch(arch,translated=false){
 if(!['arm64','x64'].includes(arch))throw Error('macOS 仅支持 Apple 芯片 arm64 或 Intel x64。');
 if(translated)throw Error('请使用 Apple 芯片 Mac 的原生终端与 arm64 Node，不要在 Rosetta 下运行。');
 return arch;
}
function macBuildArch({arch=process.arch,env=process.env,translated=macTranslated()}={}){
 validateMacArch(arch,translated);
 const target=env.OPENTAKE_MAC_BUILD_ARCH || arch;
 validateMacArch(target);
 if(target!==arch && !(arch==='arm64' && target==='x64'))throw Error('仅允许 Apple 芯片 Mac 显式交叉构建 Intel x64。');
 return target;
}
function macAppDirectory(arch){validateMacArch(arch);return arch==='arm64'?'mac-arm64':'mac';}
const workers=new Set();
function trackWorker(child){
 if(!child)return child;
 workers.add(child);child.once('close',()=>workers.delete(child));child.once('error',()=>workers.delete(child));
 return child;
}
function stopWorkers(){for(const child of workers){if(child.pid&&child.exitCode==null)killTree(child.pid,'SIGTERM');}workers.clear();}
// Windows local-volume identity is checked before resumable migration. UNC is
// deliberately rejected until its volume identity can be verified.
function windowsVolumeIdentity(target,env=process.env,run=spawnSync){
 const root=path.win32.parse(target).root;
 if(!/^[a-z]:\\$/i.test(root))throw Error('Windows 版暂未支持：网络共享目录迁移');
 const drive=root.slice(0,2).toUpperCase();
 const script=`$ErrorActionPreference='Stop'; $v=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'"; if(!$v.VolumeSerialNumber){exit 2}; [Console]::Out.Write($v.VolumeSerialNumber)`;
 const r=run(path.win32.join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000});
 const serial=String(r.stdout||'').trim();
 if(r.error||r.status!==0||!/^[a-f0-9-]{4,32}$/i.test(serial))throw Error('无法确认Windows磁盘身份，请重新连接后再试');
 return drive+':'+serial.toUpperCase();
}

module.exports={trackWorker,stopWorkers,windowsVolumeIdentity,proDataRoot,desktopDataRoot,cacheRoot,runtimePath,pythonEnv,runtimeBinaryCandidates,runtimeBinaryPath,unsupportedWindows,macTranslated,validateMacArch,macBuildArch,macAppDirectory,environmentPath,environmentWithPath,appDataRoot,standardDataRoot,projectsRoot,termination,killTree,revealCommand,revealPath,buildTarget};
