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
function projectsRoot(){return path.join(os.homedir(),process.platform==='win32'?'Videos':'Movies','LinkReader Projects');}
function termination(pid, signal='SIGTERM', platform=process.platform){
 if(!Number.isSafeInteger(pid)||pid<=0||pid===process.pid)throw Error('无效的子进程 ID');
 return platform==='win32'?{command:'taskkill.exe',args:['/PID',String(pid),'/T','/F']}:{pid:-pid,signal};
}
// Call only for workers owned by this runtime. Never terminate by executable name.
function killTree(pid,signal='SIGTERM'){
 const action=termination(pid,signal);
 try{if(action.command)spawnSync(action.command,action.args,{windowsHide:true,stdio:'ignore',timeout:5000});else process.kill(action.pid,action.signal);}catch{/* already gone */}
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
async function revealPath(target,platform=process.platform){
 const command=revealCommand(target,platform);
 fs.statSync(target);
 // This is a user-requested file manager window. Hiding Explorer can silently
 // hide directory reveals even when the shell accepts the request.
 const child=childProcess.spawn(command.command,command.args,{detached:true,stdio:'ignore',windowsHide:false});
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
 if(platform==='darwin')return 'mac';
 if(platform!=='win32'||arch!=='x64')throw Error('仅支持 macOS 和 Windows 10/11 x64 本机构建');
 const [major,,build]=release.split('.').map(Number);
 if(major!==10||!Number.isInteger(build)||build<19045)throw Error('需要 Windows 10 22H2 或 Windows 11');
 return build>=22000?'win11':'win10';
}
module.exports={environmentPath,environmentWithPath,appDataRoot,standardDataRoot,projectsRoot,termination,killTree,revealCommand,revealPath,buildTarget};
