import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

if(process.platform!=='win32'){
  fs.writeSync(1,'Windows 采集组件：当前平台无需构建。\n');
  process.exit(0);
}
if(process.arch!=='x64')throw Error('Windows 采集组件目前仅验收 x64。');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'vendor','openscreen-wgc');
const build=path.join(root,'.build','windows-recording');
const output=path.join(root,'native','windows');
function run(executable,args,options={}){
  const r=spawnSync(executable,args,{cwd:root,windowsHide:true,encoding:'utf8',...options});
  if(r.error)throw r.error;
  if(r.status!==0)throw Error(`Windows 采集组件构建失败（${r.status}），请检查 MSVC/CMake/Windows SDK。`);
  return r.stdout;
}
const where=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio','Installer','vswhere.exe');
if(!fs.existsSync(where))throw Error('缺少 Visual Studio C++ 构建工具；请按 README 安装后重试。');
const installations=JSON.parse(run(where,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-format','json']));
const vs=installations[0];
if(!vs)throw Error('未找到带 MSVC x64 和 Windows SDK 的 Visual Studio C++ 工具链。');
const major=Number(vs.installationVersion.split('.')[0]);
if(major!==17&&major!==18)throw Error('请使用 Visual Studio 2022 或 2026 的 C++ 工具链。');
const cmake=path.join(vs.installationPath,'Common7','IDE','CommonExtensions','Microsoft','CMake','CMake','bin','cmake.exe');
if(!fs.existsSync(cmake))throw Error('缺少 C++ CMake 工具，请在 Visual Studio 安装器中添加该组件。');
run(cmake,['-S',source,'-B',build,'-G',major===18?'Visual Studio 18 2026':'Visual Studio 17 2022','-A','x64',`-DCMAKE_GENERATOR_INSTANCE=${vs.installationPath}`],{stdio:'inherit'});
run(cmake,['--build',build,'--config','Release','--target','wgc-capture','--parallel','4'],{stdio:'inherit'});
fs.mkdirSync(output,{recursive:true});
const binary=path.join(output,'wgc-capture.exe');
fs.copyFileSync(path.join(build,'Release','wgc-capture.exe'),binary);
fs.copyFileSync(path.join(source,'LICENSE'),path.join(output,'LICENSE'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=['CMakeLists.txt',...fs.readdirSync(path.join(source,'src')).sort().map(n=>'src/'+n)];
const manifest={kind:'opentake-wgc-clock-v2',containerTiming:'native-finalized-v1',upstream:'getopenscreen/openscreen@v2.1.2',
  binarySha256:sha(binary),sources:files.map(name=>({path:name,sha256:sha(path.join(source,name))}))};
fs.writeFileSync(path.join(output,'build.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Windows 逐帧时钟采集组件已构建。');
