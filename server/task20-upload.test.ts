import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {uploadMediaStream} from './editor/media-upload.ts';

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'task20-upload-'));return {root,dest:path.join(root,'media/originals/sample.mp4'),close(){fs.rmSync(root,{recursive:true,force:true});}};}
test('复审1：不存在的多级素材目录自动创建，写完关闭再提升正式文件',async()=>{
 const f=fixture();try{const chunks=[Buffer.from('first'),Buffer.from('second')];assert.equal(await uploadMediaStream(Readable.from(chunks),f.dest),11);assert.deepEqual(fs.readFileSync(f.dest),Buffer.concat(chunks));assert.equal(fs.existsSync(f.dest+'.upload'),false);}finally{f.close();}
});
test('复审1：上传中断清理本次临时文件，保留原文件',async()=>{
 const f=fixture();try{fs.mkdirSync(path.dirname(f.dest),{recursive:true});fs.writeFileSync(f.dest,'previous');
 const req=new Readable({read(){this.push(Buffer.from('partial'));this._read=()=>{};}});
 const pending=uploadMediaStream(req,f.dest);
 while(!fs.existsSync(f.dest+'.upload'))await new Promise(r=>setTimeout(r,5));
 req.destroy(Error('上传连接中断'));await assert.rejects(pending,/上传连接中断/);
 assert.equal(fs.existsSync(f.dest+'.upload'),false);assert.equal(fs.readFileSync(f.dest,'utf8'),'previous');
 }finally{f.close();}
});
test('复审1：同名临时文件属于另一上传时不能删除',async()=>{
 const f=fixture();try{fs.mkdirSync(path.dirname(f.dest),{recursive:true});fs.writeFileSync(f.dest+'.upload','other upload');await assert.rejects(uploadMediaStream(Readable.from(['new']),f.dest),{code:'EEXIST'});assert.equal(fs.readFileSync(f.dest+'.upload','utf8'),'other upload');assert.equal(fs.existsSync(f.dest),false);}finally{f.close();}
});
test('复审1：提升正式文件失败会拒绝请求并清理暂存，不抛出未捕获异常',async()=>{
 const f=fixture();try{fs.mkdirSync(f.dest,{recursive:true});fs.writeFileSync(path.join(f.dest,'keep'),'existing');await assert.rejects(uploadMediaStream(Readable.from(['new']),f.dest));assert.equal(fs.existsSync(f.dest+'.upload'),false);assert.equal(fs.readFileSync(path.join(f.dest,'keep'),'utf8'),'existing');}finally{f.close();}
});

test('复审1：本版真实上传路由不依赖预建media目录，接收后才登记素材',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),f=fixture();
 const standard=fs.existsSync(path.join(root,'server/standard/openscreen-api.ts'));
 const entry=path.join(root,standard?'server/standard/openscreen-api.ts':'server/editor/api/media.ts');
 const key='__task20UploadRoute';
 const project:any={id:'screen',media:[],revision:0};let saved=0;
 (globalThis as any)[key]={dir:f.root,project,processed:[],save(){saved++;}};
 try {
  // Exercise the production route, stream and filesystem. Only project storage
  // and post-upload transcoding are controlled; no native encoder is involved.
  const bundled=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'upload-boundaries',setup(b){
   b.onResolve({filter:/.*/},a=>{
    if(!a.importer)return;
    if(path.isAbsolute(a.path))return {path:a.path,external:true};
    if(a.importer===entry&&a.path.endsWith('/store.ts'))return {path:'store',namespace:'fixture'};
    if(a.importer===entry&&a.path.endsWith('/media.ts'))return {path:'media',namespace:'fixture'};
    if(a.importer===entry&&a.path.endsWith('/screen-migration.ts'))return {path:'migration',namespace:'fixture'};
    if(a.path.startsWith('.'))return {path:path.resolve(path.dirname(a.importer),a.path),external:true};
   });
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:`const f=globalThis.${key};`+(a.path==='store'?`export const findProject=()=>({dir:f.dir,project:f.project});export const save=()=>{f.save()};export const safeName=v=>v;export const createScreenProject=()=>{};export const listScreenProjects=()=>[];export const projectFolder=()=>f.dir;export const atomicJson=()=>{};export const acquireLock=()=>{};export const readLock=()=>{};export const trashDir=()=>f.dir;export const projectLibrary=()=>f.dir;`:a.path==='migration'?`export const migrateLegacyScreen=()=>{};`:`${standard?'':`export {streamUpload} from ${JSON.stringify(path.join(root,'server/editor/media.ts'))};`}export const processMedia=async(_id,assetId)=>{f.processed.push(assetId);return f.project.media.find(a=>a.id===assetId)};export const ensureClearPreviewProxy=()=>{};export const serveFile=()=>{};`)}));
  }}]});
  // Standard's media module only needs processMedia; omit its unused re-export.
  const mod={exports:{} as any};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
  const bytes=Buffer.from('uploaded bytes'),url=new URL('http://localhost/api/editor/projects/screen/media?filename=sample.mp4&capture=screen');
  const req=Object.assign(Readable.from([bytes]),{method:'PUT',url:url.pathname+url.search,headers:{'content-type':'video/mp4'}});
  let response:any;const res:any={setHeader(){},end(s:string){response=JSON.parse(s)}};
  assert.equal(fs.existsSync(path.join(f.root,'media')),false);
  if(standard)await mod.exports.handleEditorApi(req,res);
  else await mod.exports.handleMediaApi({req,res,url,id:'screen',dir:f.root,project,parts:['projects','screen','media']});
  assert.equal(response.ok,true);assert.equal(res.statusCode,standard?200:202);assert.equal(saved,1);assert.equal(project.media.length,1);
  const asset=project.media[0];assert.deepEqual(fs.readFileSync(path.join(f.root,asset.originalFile)),bytes);assert.equal(fs.existsSync(path.join(f.root,asset.originalFile)+'.upload'),false);assert.equal(asset.size,bytes.length);assert.deepEqual((globalThis as any)[key].processed,[asset.id]);
 }finally{delete(globalThis as any)[key];f.close();}
});
