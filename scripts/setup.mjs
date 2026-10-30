// macOS source installation. Never installs an agent, logs in, or changes system settings.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export function validateHost({platform, arch, node, mac, freeBytes}) {
 if(platform !== 'darwin') throw Error('一键安装目前只支持 macOS；其他系统请按 README 原有步骤安装。');
 if(arch !== 'arm64') throw Error('一键安装需要 Apple 芯片。请使用 Apple 芯片 Mac 的原生终端与 arm64 Node，不要在 Rosetta 下运行。');
 const n=node.replace(/^v/,'').split('.').map(Number);
 if(n[0] !== 24 || n[1] < 15) throw Error('需要 Node.js 24.15.0 或更新的 24.x。请从 https://nodejs.org 安装后重新打开终端，再运行 npm run setup。');
 if(!/^\d+(\.\d+)*$/.test(mac) || Number(mac.split('.')[0]) < 12) throw Error('需要 macOS 12 或更新版本（锁定 Electron 的最低系统版本），请先确认系统版本。');
 if(freeBytes < 8 * 1024 ** 3) throw Error('源码所在磁盘至少需要 8 GB 可用空间，请腾出空间后重试；不会删除已有文件。');
}
export function installPlan() { return [
 {id:'root', cwd:'.', args:['ci','--no-audit','--no-fund'], label:'根目录依赖'},
 {id:'openscreen', cwd:'vendor/openscreen', args:['ci','--ignore-scripts','--no-audit','--no-fund'], label:'录屏编辑器依赖'},
]; }
export async function setup(options = {}) {
 const dir=options.root || root, env=options.env || process.env;
 const log=options.log || console.log;
 const run=options.run || ((file,args,extra={})=>spawnSync(file,args,{cwd:dir,env,encoding:'utf8',timeout:20*60*1000,maxBuffer:4*1024*1024,...extra}));
 const must=(file,args,label,extra={})=>{const r=run(file,args,extra);if(r.error || r.status!==0)throw Error(`${label}失败。请检查网络、磁盘和工具版本后重试 npm run setup；已有文件会保留。${r.error?.code==='ENOENT'?'未找到命令 '+file+'。':''}`);return r.stdout?.trim() || '';};
 const stat=fs.statfsSync(dir);
 const mac=run('/usr/bin/sw_vers',['-productVersion']);
 validateHost({platform:process.platform,arch:process.arch,node:process.version,mac:mac.stdout?.trim() || '',freeBytes:Number(stat.bavail)*Number(stat.bsize)});
 log('1/7 系统、Apple 芯片、Node 和磁盘检查通过');
 const stampFile=path.join(dir,'.setup-state.json');
 let state={};try{state=JSON.parse(fs.readFileSync(stampFile,'utf8'))}catch{}
 const save=()=>fs.writeFileSync(stampFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});
 for(const [i,step] of installPlan().entries()){
  const cwd=path.join(dir,step.cwd), lock=path.join(cwd,'package-lock.json');
  if(!fs.existsSync(lock))throw Error(`缺少${step.label}的 package-lock.json，请重新取得完整官方源码。`);
  const digest=crypto.createHash('sha256').update(fs.readFileSync(lock)).update(fs.readFileSync(path.join(cwd,'package.json'))).update(process.version).digest('hex');
  const modules=path.join(cwd,'node_modules');
  // Validate the installed dependency tree as well as the receipt: partial removals must reinstall.
  const intact=state[step.id]===digest && fs.existsSync(modules) && run('npm',['ls','--depth=0','--omit=optional'],{cwd}).status===0;
  log(`${i+2}/7 ${step.label}：${intact?'已安装，检查通过':'安装中'}`);
  if(!intact){must('npm',step.args,step.label,{cwd});state[step.id]=digest;save();}
 }
 log('4/7 准备 Playwright Chromium（已安装的版本自动复用）');
 must('npx',['--no-install','playwright-core','install','chromium'],'Chromium 安装');
 log('5/7 准备独立 Python + numpy');
 const venv=env.OPENTAKE_SETUP_VENV || path.join(os.homedir(),'.opentake-venv');
 if(!path.isAbsolute(venv))throw Error('OPENTAKE_SETUP_VENV 必须是独立虚拟环境的绝对路径。');
 const py=path.join(venv,'bin/python3');
 const pyEnv={...env,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:''};
 if(!fs.existsSync(py)){
  if(fs.existsSync(venv))throw Error('Python 虚拟环境目录已存在但不完整，请使用新的 OPENTAKE_SETUP_VENV 目录；不会覆盖它。');
  if(run('python3',['--version'],{env:pyEnv}).status!==0)throw Error('没找到 Python 3。请从 https://www.python.org/downloads/macos/ 安装，或运行 brew install python，再重试；不要使用 sudo。');
  must('python3',['-m','venv',venv],'创建独立 Python 环境',{env:pyEnv});
 }
 if(run(py,['-c','import numpy'],{env:pyEnv}).status!==0)must(py,['-m','pip','install','numpy'],'numpy 安装',{env:pyEnv});
 must(py,['-c','import sys, numpy; assert sys.version_info.major == 3'],'Python 与 numpy 检查',{env:pyEnv});
 log('6/7 检查 FFmpeg / ffprobe');
 const media=options.media || require('../desktop/media-tools.cjs');
 const result=media.doctor({env});
 if(!result.ok)throw Error('缺少可运行且位于同一目录的 FFmpeg / ffprobe。请运行 brew install ffmpeg，或把工具目录设为 LINKREADER_BIN_DIR，再重试 npm run setup。不会自动下载或替换 FFmpeg。');
 log('7/7 检查 OpenScreen（可选）并构建界面');
 try {
  const probe=options.screenCheck || (await import('../server/onboarding-common.ts')).openscreen;
  const status=await probe(); log(`OpenScreen：${status.text}`);
  if(status.state!=='ok')log('官方下载：https://github.com/getopenscreen/openscreen/releases/latest；安装后请到系统设置授予屏幕录制权限。');
 } catch { log('OpenScreen 暂未确认；录屏前请在一键部署中重新检测。通用剪辑安装继续。'); }
 must('npm',['run','build:live'],'界面构建');
 log('安装完成。运行 npm start 打开；在设置中接入智能体，再运行 npm run doctor 检查出片环境。');
 if(env.OPENTAKE_SETUP_VENV)log(`本次使用自选 Python 环境；启动与 doctor 时设置 LINKREADER_PYTHON=${py}`);
 return {ok:true,python:py};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))setup().catch(error=>{console.error(`安装未完成：${error.message}`);process.exitCode=1;});
