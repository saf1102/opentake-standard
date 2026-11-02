const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createReadStream}=require('node:fs');
const MANIFEST='opentake-payload.json';
const critical=new Set(['OpenTake Standard.exe','resources/app/package.json','resources/app/desktop/main.cjs','resources/app/desktop/service.mjs',
 'resources/app/desktop/install-verify.py','resources/app/desktop/sandbox-read-access.ps1','resources/app/desktop/browser-diagnostic.cjs',
 'resources/app/desktop/creation-tools.cjs','resources/app/desktop/probe-creation-browser.cjs','resources/app/server/frame-render/index.ts','resources/app/server/general/hf-render.ts',
 'resources/app/native/windows/wgc-capture.exe','resources/runtimes/manifest.json','resources/runtimes/python/python.exe',
 'resources/runtimes/ffmpeg/bin/ffmpeg.exe','resources/runtimes/ffmpeg/bin/ffprobe.exe','resources/runtimes/openscreen/Openscreen.exe',
 'resources/runtimes/openscreen/resources/electron/native/bin/win32-x64/wgc-capture.exe',
 'resources/runtimes/openscreen/resources/electron/native/bin/win32-x64/compositor_view.node',
 'resources/runtimes/browsers/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe',
 'resources/runtimes/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe']);
async function writePayloadManifest(root){
 const files=[];
 async function visit(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,item.name),relative=path.relative(root,file).split(path.sep).join('/');
  if(relative===MANIFEST)continue;
  if(item.isSymbolicLink())throw Error('Installer payload contains a link: '+relative);
  if(item.isDirectory())await visit(file);
  else if(item.isFile()){
   const row={path:relative,bytes:(await fs.stat(file)).size};
   if(critical.has(relative)){const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);row.sha256=hash.digest('hex');}
   files.push(row);
  }else throw Error('Installer payload contains a non-file: '+relative);
 }}
 await visit(root);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
 for(const file of critical)if(!files.some(row=>row.path===file))throw Error('Installer critical file missing: '+file);
 const manifest={format:'opentake.windows.payload',version:1,fileCount:files.length,totalBytes:files.reduce((n,row)=>n+row.bytes,0),files};
 await fs.writeFile(path.join(root,MANIFEST),JSON.stringify(manifest));
 return {files:files.length,criticalHashes:critical.size,bytes:manifest.totalBytes};
}
module.exports={writePayloadManifest};
