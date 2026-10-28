const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
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
function revealCommand(target,platform=process.platform){
 const p=platform==='win32'?path.win32:path.posix;
 if(!p.isAbsolute(target)||target.includes('\0'))throw Error('文件路径必须是绝对路径');
 if(platform==='win32')return {command:'explorer.exe',args:['/select,',target]};
 if(platform==='darwin')return {command:'/usr/bin/open',args:['-R',target]};
 return {command:'xdg-open',args:[p.dirname(target)]};
}
function buildTarget(platform=process.platform,arch=process.arch,release=os.release()){
 if(platform==='darwin')return 'mac';
 if(platform!=='win32'||arch!=='x64')throw Error('仅支持 macOS 和 Windows 10/11 x64 本机构建');
 const [major,,build]=release.split('.').map(Number);
 if(major!==10||!Number.isInteger(build)||build<19045)throw Error('需要 Windows 10 22H2 或 Windows 11');
 return build>=22000?'win11':'win10';
}
module.exports={appDataRoot,standardDataRoot,projectsRoot,termination,killTree,revealCommand,buildTarget};
