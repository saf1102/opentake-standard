const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const installations=require('./agent-installation.cjs');
const executable=p=>{try{fs.accessSync(p,fs.constants.X_OK);return fs.statSync(p).isFile()}catch{return false}};
function findTools(options={}){
 const platform=options.platform||process.platform,env=options.env||process.env,login=options.loginEnv||installations.loginEnvironment(env),delimiter=platform==='win32'?';':':';
 const directories=[...new Set([env.LINKREADER_BIN_DIR,...(login.PATH||login.Path||'').split(delimiter),...(env.PATH||env.Path||'').split(delimiter),...(options.fallbackDirectories??(platform==='darwin'?['/opt/homebrew/bin','/usr/local/bin',path.join(os.homedir(),'.local/bin')]:[]))].filter(p=>p&&path.isAbsolute(p)))];
 const suffix=platform==='win32'?'.exe':'';const checked=directories.map(dir=>({dir,ffmpeg:executable(path.join(dir,'ffmpeg'+suffix)),ffprobe:executable(path.join(dir,'ffprobe'+suffix))}));const found=checked.find(v=>v.ffmpeg&&v.ffprobe);
 if(found)return {directory:found.dir,ffmpeg:path.join(found.dir,'ffmpeg'+suffix),ffprobe:path.join(found.dir,'ffprobe'+suffix)};
 const missing=['ffmpeg','ffprobe'].filter(name=>!checked.some(v=>v[name]));
 throw Error(`${missing.length?'缺少可执行的 '+missing.join(' 和 '):'ffmpeg 与 ffprobe 不在同一个可用目录'}。查找过：${directories.join('、')||'无绝对路径目录'}。${platform==='darwin'?'macOS 安装：brew install ffmpeg。':'Windows 请按 README 的 FFmpeg 安装步骤安装，并将含 ffmpeg.exe、ffprobe.exe 的目录加入 PATH。'}`);
}
const ffmpegPath=()=>findTools().ffmpeg,ffprobePath=()=>findTools().ffprobe,supportBin=()=>findTools().directory;
function doctor(){try{const found=findTools();const versions={};for(const name of ['ffmpeg','ffprobe']){const r=spawnSync(found[name],['-version'],{encoding:'utf8',timeout:5000,maxBuffer:65536});if(r.status!==0||r.error)throw Error(name+' 无法运行，请检查安装。');versions[name]=r.stdout.split('\n')[0]}return {ok:true,...found,versions}}catch(e){return {ok:false,message:e.message,color:'#9869dc'}}}
module.exports={findTools,ffmpegPath,ffprobePath,supportBin,doctor};
