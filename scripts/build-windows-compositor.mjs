// Rebuild the pinned OpenScreen addon; keep its official Electron app.asar intact.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function compositorBuildInputs(root=defaultRoot){
 const vendor=path.join(root,'vendor/openscreen-compositor');
 const metadata=Buffer.from(fs.readFileSync(path.join(vendor,'upstream.json'),'utf8').replaceAll('\r\n','\n'));
 const patch=path.join(vendor,'windows-software-decode.patch');
 return {vendor,patch,upstream:JSON.parse(metadata),sourceSha256:sha(Buffer.concat([metadata,Buffer.from(fs.readFileSync(patch,'utf8').replaceAll('\r\n','\n'))]))};
}
export function verifyWindowsCompositor(root=defaultRoot){
 const input=compositorBuildInputs(root),out=path.join(root,'native/windows/compositor');
 const receipt=JSON.parse(fs.readFileSync(path.join(out,'build.json'),'utf8'));
 if(receipt.kind!=='opentake-compositor-software-video-v2'||receipt.upstreamCommit!==input.upstream.commit||receipt.sourceSha256!==input.sourceSha256||receipt.binarySha256!==sha(fs.readFileSync(path.join(out,'compositor_view.node'))))throw Error('原生合成器与固定源码或构建回执不一致，请重新构建。');
 return receipt;
}
function run(file,args,options={}){
 const result=spawnSync(file,args,{cwd:defaultRoot,windowsHide:true,encoding:'utf8',...options});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`原生合成器构建失败 (${path.basename(file)} ${result.status})：${result.stderr||''}`);
 return result.stdout;
}
async function build(){
 if(process.platform!=='win32'){console.log('Windows 原生合成器：当前平台无需构建。');return;}
 if(process.arch!=='x64')throw Error('原生合成器当前仅验收 Windows x64。');
 try{verifyWindowsCompositor();console.log('Windows 原生合成器：已校验固定源码及现有构建。');return;}catch{/* Missing/stale build: compile below. */}
 const {vendor,patch,upstream,sourceSha256}=compositorBuildInputs();
 const work=path.join(defaultRoot,'.build/windows-compositor'),checkout=path.join(work,'checkout');
 fs.mkdirSync(work,{recursive:true});
 if(!fs.existsSync(checkout))run('git',['clone','-c','core.autocrlf=false','--depth','1','--branch',upstream.tag,upstream.repository,checkout],{stdio:'inherit'});
 if(run('git',['rev-parse','HEAD'],{cwd:checkout}).trim()!==upstream.commit)throw Error('OpenScreen 原生源码提交不匹配；保留目录，未覆盖。');
 const reverse=spawnSync('git',['apply','--reverse','--check',patch],{cwd:checkout,windowsHide:true});
 if(reverse.status!==0)run('git',['apply',patch],{cwd:checkout});
 if(sha(fs.readFileSync(path.join(checkout,upstream.patchedFile),'utf8').replaceAll('\r\n','\n'))!==upstream.patchedFileSha256)throw Error('原生解码补丁结果不匹配。');
 const changed=run('git',['diff','--name-only'],{cwd:checkout}).trim().split(/\r?\n/).filter(Boolean);
 if(changed.some(file=>file!==upstream.patchedFile))throw Error('原生源码目录有其他改动；保留目录，未继续编译。');
 const archive=path.join(work,'ffmpeg-sdk.zip'),sdkRoot=path.join(work,'sdk'),sdk=path.join(sdkRoot,upstream.sdkDirectory);
 if(!fs.existsSync(archive)||sha(fs.readFileSync(archive))!==upstream.sdkSha256){
  const response=await fetch(upstream.sdkUrl,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('无法下载固定 FFmpeg SDK：'+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());if(sha(bytes)!==upstream.sdkSha256)throw Error('FFmpeg SDK SHA256 校验失败。');fs.writeFileSync(archive,bytes);
 }
 if(!fs.existsSync(path.join(sdk,'include/libavcodec/avcodec.h'))){fs.mkdirSync(sdkRoot,{recursive:true});run(path.join(process.env.SystemRoot||'C:\\Windows','System32/tar.exe'),['-xf',archive,'-C',sdkRoot]);}
 const clang=process.env.LIBCLANG_PATH||path.join(process.env.ProgramFiles||'C:\\Program Files','LLVM/bin');
 if(!fs.existsSync(path.join(clang,'libclang.dll')))throw Error('缺少 libclang.dll，请安装 LLVM 或设置 LIBCLANG_PATH 后重试。');
 const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
 const vs=run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath']).trim();
 const vcvars=path.join(vs,'VC/Auxiliary/Build/vcvarsall.bat');
 if(!fs.existsSync(vcvars))throw Error('缺少 Visual Studio C++ x64 和 Windows SDK。');
 const cargo=path.join(process.env.USERPROFILE||'','.cargo/bin/cargo.exe');
 if(!fs.existsSync(cargo))throw Error('缺少 Rust MSVC 工具链，请安装 rustup 后重试。');
 const quote=value=>{if(/["\r\n]/.test(value))throw Error('构建路径无效');return '"'+value.replaceAll('%','%%')+'"';};
 const command=path.join(work,'build.cmd');
 fs.writeFileSync(command,`@echo off\r\n${quote(path.join(process.env.SystemRoot||'C:\\Windows','System32/chcp.com'))} 65001 >nul\r\ncall ${quote(vcvars)} x64\r\nif errorlevel 1 exit /b %errorlevel%\r\n${quote(cargo)} build --locked --release -j 2 -p compositor-view-napi\r\nexit /b %errorlevel%\r\n`);
 run(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`""${command}""`],{cwd:path.join(checkout,'crates'),windowsVerbatimArguments:true,env:{...process.env,FFMPEG_DIR:sdk,LIBCLANG_PATH:clang},stdio:'inherit'});
 const out=path.join(defaultRoot,'native/windows/compositor');fs.mkdirSync(out,{recursive:true});
 const binary=path.join(out,'compositor_view.node');fs.copyFileSync(path.join(checkout,'crates/target/release/compositor_view.dll'),binary);
 fs.copyFileSync(path.join(vendor,'LICENSE'),path.join(out,'LICENSE'));
 fs.writeFileSync(path.join(out,'build.json'),JSON.stringify({kind:'opentake-compositor-software-video-v2',upstreamCommit:upstream.commit,sourceSha256,binarySha256:sha(fs.readFileSync(binary)),ffmpegSdkSha256:upstream.sdkSha256},null,2)+'\n');
 verifyWindowsCompositor();console.log('Windows 原生合成器已构建，支持视频硬件初始化失败后的软件解码及编码回退。');
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url)))await build();
