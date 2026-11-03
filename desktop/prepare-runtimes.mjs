import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import runtime from './bundled-runtimes.cjs';
import {verifyWindowsCompositor} from '../scripts/build-windows-compositor.mjs';
import {prepareWindowsExportRuntimes} from '../scripts/prepare-windows-export-runtimes.mjs';
export async function prepareRuntimeManifest(source){
 const root=path.resolve(source,'../runtime-payload');
 await prepareWindowsExportRuntimes(root);
 const origins=JSON.parse(await fs.readFile(path.join(root,'provenance.json'),'utf8'));
 if(origins.schema!==1||origins.components.length<10)throw Error('运行库来源清单不完整。');
 await fs.copyFile(path.join(source,'desktop/python-sitecustomize.py'),path.join(root,'python/sitecustomize.py'));
 // Only the bundled OpenScreen copy is patched; no installed user application is changed.
 const helper=path.join(root,'openscreen/resources/electron/native/bin/win32-x64/wgc-capture.exe');
 const original=path.join(root,'openscreen/original-components/wgc-capture-2.1.2.exe');
 await fs.mkdir(path.dirname(original),{recursive:true});
 try{await fs.access(original)}catch{await fs.copyFile(helper,original)}
 await fs.copyFile(path.join(source,'native/windows/wgc-capture.exe'),helper);
 await fs.copyFile(path.join(source,'native/windows/build.json'),path.join(root,'openscreen/original-components/OpenTake-wgc-build.json'));
 const compositor=verifyWindowsCompositor(source);
 const addon=path.join(root,'openscreen/resources/electron/native/bin/win32-x64/compositor_view.node');
 const originalAddon=path.join(root,'openscreen/original-components/compositor_view-2.1.2.node');
 try{await fs.access(originalAddon)}catch{await fs.copyFile(addon,originalAddon)}
 await fs.copyFile(path.join(source,'native/windows/compositor/compositor_view.node'),addon);
 await fs.copyFile(path.join(source,'native/windows/compositor/build.json'),path.join(root,'openscreen/original-components/OpenTake-compositor-build.json'));
 const sourceFolder=path.join(root,'sources/openscreen-compositor-windows-patch');await fs.mkdir(sourceFolder,{recursive:true});
 for(const name of ['LICENSE','upstream.json','windows-software-decode.patch','README.md'])await fs.copyFile(path.join(source,'vendor/openscreen-compositor',name),path.join(sourceFolder,name));
 const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const asar=await fs.readFile(path.join(root,'openscreen/resources/app.asar'));
 if(digest(asar)!=='d325092fa699ae2d9eb2ef4a9dad930abde7b89a68ae07e3a8a0706d5c063537')throw Error('OpenScreen 官方前端文件与已验证 2.1.2 不同。');
 for(const relative of Object.values(runtime.RUNTIME_LAYOUT))if(!(await fs.stat(path.join(root,relative))).isFile())throw Error('运行库缺少 '+relative);
 const files=[];
 async function visit(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  if(entry.name==='__pycache__'||entry.name.endsWith('.pyc')||entry.name.endsWith('.log')||dir===root&&entry.name==='manifest.json'||dir===path.join(root,'browsers')&&entry.name==='chromium-1243')continue;
  const file=path.join(dir,entry.name);
  if(entry.isSymbolicLink())throw Error('运行库不允许使用链接：'+file);
  if(entry.isDirectory())await visit(file);
  else {const data=await fs.readFile(file);files.push({path:path.relative(root,file).split(path.sep).join('/'),bytes:data.length,sha256:digest(data)})}
 }}
 await visit(root);files.sort((a,b)=>a.path.localeCompare(b.path));
 const manifest={schema:1,platform:'win32-x64',components:origins.components,modifications:[{component:'OpenScreen WGC helper',reason:'原生 MP4 时钟修复',source:'vendor/openscreen-wgc',originalPreserved:true,officialAppAsarUnchanged:true},{component:'OpenScreen native compositor',reason:'D3D11VA 初始化失败时回退软件解码；编码帧池不可用时改用系统内存帧，沿用原生合成器',source:'vendor/openscreen-compositor',binarySha256:compositor.binarySha256,originalPreserved:true,officialAppAsarUnchanged:true},{component:'runtime packaging',reason:'Exclude Python test suites and FFmpeg development-only files; preserve runtime libraries, licenses and corresponding source archives.'}],files};
 await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log(`内置运行库：${origins.components.length} 个组件，${files.length} 个文件，${files.reduce((sum,row)=>sum+row.bytes,0)} 字节。`);
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareRuntimeManifest(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
