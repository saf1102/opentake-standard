/** Build-time download/extraction only. No installer execution, login, or system changes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {constants,createWriteStream} from 'node:fs';
import release from '../desktop/release-contract.cjs';
import {prepareWindowsExportRuntimes} from './prepare-windows-export-runtimes.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const exists=async file=>{try{await fs.access(file);return true}catch{return false}};
export function safeArchivePaths(list){
 const entries=list.split(/\r?\n----------\r?\n/).slice(1).join('\n');
 if(!entries)throw Error('Archive listing is empty');
 for(const match of entries.matchAll(/^Path = (.*)$/gm)){
  const name=match[1].trim();
  if(!name||path.win32.isAbsolute(name)||path.posix.isAbsolute(name)||name.includes(':')||name.includes('\0')||name.split(/[\\/]/).includes('..'))throw Error('Unsafe archive path');
 }
 if(entries.split(/\r?\n/).some(line=>/^(?:Symbolic|Hard) Link = \S/.test(line)))throw Error('Archive links are not supported');
}
export async function lockedDownload(item,cache,fetcher=fetch){
 const url=new URL(item.url),expected=item.sha256||item.installerSha256;
 if(url.protocol!=='https:'||url.username||url.password||!/^[a-f0-9]{64}$/.test(expected||''))throw Error('Invalid locked download');
 const name=item.file||path.posix.basename(url.pathname);
 if(name!==path.basename(name)||/[\\/:]/.test(name))throw Error('Invalid cache name');
 await fs.mkdir(cache,{recursive:true});const file=path.join(cache,name);
 if(await exists(file)&&await release.fileSha256(file)===expected)return file;
 const pending=file+'.'+crypto.randomUUID()+'.download';
 const response=await fetcher(url.href,{signal:AbortSignal.timeout(300000)});
 if(!response.ok||!response.body)throw Error('Runtime download failed: '+response.status+' '+name);
 await pipeline(response.body,createWriteStream(pending,{flags:'wx'}));
 if(await release.fileSha256(pending)!==expected)throw Error('Runtime SHA-256 differs; pending archive retained: '+pending);
 if(await exists(file))throw Error('Existing cache differs; preserve it and select a new cache: '+file);
 await fs.rename(pending,file);return file;
}
async function inventory(root){
 const files=[];
 async function walk(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){
  const file=path.join(folder,entry.name);
  if(entry.isSymbolicLink())throw Error('Runtime tree contains a link');
  if(entry.isDirectory())await walk(file);
  else if(path.relative(root,file)!=='manifest.json')files.push({path:path.relative(root,file).split(path.sep).join('/'),bytes:(await fs.stat(file)).size,sha256:await release.fileSha256(file)});
 }}
 await walk(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function verifyRuntimeTree(root,lock){
 root=path.resolve(root);
 const provenance=JSON.parse(await fs.readFile(path.join(root,'provenance.json'),'utf8'));
 for(const item of lock.components){
  const actual=provenance.components?.find(row=>row.name===item.name);
  if(!actual||actual.version!==item.version||actual.url!==item.url||(actual.sha256||actual.installerSha256)!==(item.sha256||item.installerSha256))throw Error('Runtime provenance differs: '+item.name);
 }
 const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
 if(manifest.schema!==1||manifest.platform!=='win32-x64'||!Array.isArray(manifest.files)||manifest.files.length===0)throw Error('Runtime manifest is missing/incomplete');
 for(const row of manifest.files){
  if(typeof row.path!=='string'||row.path.includes('\\')||row.path.includes(':')||row.path.startsWith('/')||row.path.split('/').some(p=>!p||p==='..'||p==='.'))throw Error('Unsafe runtime inventory path');
  const file=path.join(root,row.path);let part=file;
  while(part!==root){if((await fs.lstat(part)).isSymbolicLink())throw Error('Runtime inventory contains a link');part=path.dirname(part)}
  if((await fs.stat(file)).size!==row.bytes||await release.fileSha256(file)!==row.sha256)throw Error('Runtime file differs: '+row.path);
 }
 for(const item of lock.runtimeSourceArchives||[])if(await release.fileSha256(path.join(root,'sources',item.file))!==item.sha256)throw Error('Corresponding source differs: '+item.file);
 for(const item of lock.runtimeFiles||[])if(await release.fileSha256(path.join(root,item.target))!==item.sha256)throw Error('Runtime license differs: '+item.target);
 const openscreen=lock.components.find(row=>row.name==='OpenScreen');
 if(openscreen&&await release.fileSha256(path.join(root,'openscreen/resources/app.asar'))!==openscreen.appAsarSha256)throw Error('OpenScreen app.asar differs');
 return {files:manifest.files.length};
}
export async function prepareWindowsRuntimes({root=path.resolve(source,'../runtime-payload'),cache=path.resolve(source,'../runtime-downloads')}={}){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows runtime assembly requires Windows x64');
 root=path.resolve(root);cache=path.resolve(cache);
 const lock=JSON.parse(await fs.readFile(path.join(source,'WINDOWS-RUNTIME-LOCK.json'),'utf8'));
 if(await exists(root)){await verifyRuntimeTree(root,lock);console.log('已校验并复用运行库：'+root);return root;}
 await fs.mkdir(path.dirname(root),{recursive:true});
 const stage=await fs.mkdtemp(root+'.staging-'),scratch=await fs.mkdtemp(path.join(path.dirname(root),'runtime-extract-'));
 const seven=await require('app-builder-lib/out/toolsets/7zip').getPath7za();
 const run=args=>{const r=spawnSync(seven,args,{encoding:'utf8',windowsHide:true,maxBuffer:32<<20});if(r.error)throw r.error;if(r.status!==0)throw Error('Runtime archive extraction failed: '+r.stderr);return r.stdout};
 async function extract(archive){
  safeArchivePaths(run(['l','-slt','-sccUTF-8',archive]));
  const folder=await fs.mkdtemp(path.join(scratch,'archive-'));
  run(['x','-y','-bd','-sccUTF-8',archive,'-o'+folder]);
  const entries=await fs.readdir(folder);
  if(entries.length===1&&entries[0].endsWith('.tar'))return extract(path.join(folder,entries[0]));
  return folder;
 }
 async function copy(from,to){
  const info=await fs.lstat(from);if(info.isSymbolicLink())throw Error('Extracted runtime contains a link');
  if(['__pycache__','tests','test'].includes(path.basename(from))||from.endsWith('.pyc'))return;
  if(info.isDirectory()){await fs.mkdir(to,{recursive:true});for(const name of await fs.readdir(from))await copy(path.join(from,name),path.join(to,name));}
  else {await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(from,to,constants.COPYFILE_EXCL);}
 }
 const component=name=>{const item=lock.components.find(row=>row.name===name);if(!item)throw Error('Missing runtime lock: '+name);return item};
 const unpack=async name=>extract(await lockedDownload(component(name),cache));
 await copy(await unpack('Python'),path.join(stage,'python'));
 const pth=(await fs.readdir(path.join(stage,'python'))).find(name=>/^python\d+\._pth$/.test(name));
 if(!pth)throw Error('Embedded Python path configuration missing');
 const zip=pth.replace('._pth','.zip');
 await fs.writeFile(path.join(stage,'python',pth),`${zip}\n.\nLib/site-packages\n../../app/server/general/kit/audio\nimport site\n`);
 for(const name of ['numpy','scipy','numba','llvmlite','pillow'])await copy(await unpack(name),path.join(stage,'python/Lib/site-packages'));
 const ffmpeg=await unpack('FFmpeg / ffprobe'),ffmpegEntries=await fs.readdir(ffmpeg);
 if(ffmpegEntries.length!==1)throw Error('Unexpected FFmpeg archive layout');
 await copy(path.join(ffmpeg,ffmpegEntries[0]),path.join(stage,'ffmpeg'));
 const codex=await unpack('Codex CLI');await copy(path.join(codex,'package'),path.join(stage,'codex'));
 for(const item of lock.runtimeFiles||[])await fs.copyFile(await lockedDownload(item,cache),path.join(stage,item.target));
 await copy(await unpack('Chromium Headless Shell'),path.join(stage,'browsers/chromium_headless_shell-1243'));
 const setup=await unpack('OpenScreen');
 async function find(folder,name){for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.name===name)return file;if(entry.isDirectory()){const found=await find(file,name);if(found)return found;}}}
 if(await exists(path.join(setup,'Openscreen.exe'))&&await exists(path.join(setup,'resources/app.asar')))await copy(setup,path.join(stage,'openscreen'));
 else {const inner=await find(setup,'app-64.7z');if(!inner)throw Error('OpenScreen installer payload missing');await copy(await extract(inner),path.join(stage,'openscreen'));}
 await fs.mkdir(path.join(stage,'sources'),{recursive:true});
 for(const item of lock.runtimeSourceArchives)await fs.copyFile(await lockedDownload(item,cache),path.join(stage,'sources',item.file));
 await fs.writeFile(path.join(stage,'provenance.json'),JSON.stringify(lock,null,2)+'\n');
 await prepareWindowsExportRuntimes(stage);
 await fs.copyFile(path.join(source,'desktop/python-sitecustomize.py'),path.join(stage,'python/sitecustomize.py'));
 const files=await inventory(stage);
 await fs.writeFile(path.join(stage,'manifest.json'),JSON.stringify({schema:1,platform:'win32-x64',components:lock.components,files},null,2)+'\n');
 await verifyRuntimeTree(stage,lock);
 await fs.rename(stage,root);
 // Only remove the successful, task-created extraction directory; failed work is retained.
 const scratchRoot=path.resolve(path.dirname(root));
 if(path.dirname(path.resolve(scratch))!==scratchRoot||!path.basename(scratch).startsWith('runtime-extract-'))throw Error('Unexpected extraction cleanup path');
 await fs.rm(scratch,{recursive:true});
 console.log('已从固定归档准备运行库：'+root);
 return root;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i+=2){if(!['--root','--cache'].includes(args[i])||!args[i+1])throw Error('Usage: [--root new-folder] [--cache folder]');options[args[i].slice(2)]=args[i+1];}
 await prepareWindowsRuntimes(options);
}
