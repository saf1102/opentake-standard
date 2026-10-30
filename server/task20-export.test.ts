import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {build} from 'esbuild';
import {ExportSettingsSchema} from '../src/types/editor.ts';
import {screenClockArguments} from './editor/openscreen-encode.ts';
import {screenExportFrameRate,savedExportDocument,mp4ExportArguments} from './editor/openscreen-export.ts';
const require=createRequire(import.meta.url);

test('P06：工程、24、60 使用明确时钟及按时长算出的帧数',()=>{
  for(const [option,fps] of [['project',30],[24,24],[60,60]] as const){
    const settings=ExportSettingsSchema.parse({fps:option});
    assert.equal(screenExportFrameRate(settings,30,{assets:[{video:{fps:29.97}}]}),fps);
    const args=screenClockArguments(fps,2.5);
    assert.equal(args[args.indexOf('-fps_mode')+1],'cfr');
    assert.equal(args[args.indexOf('-frames:v')+1],String(Math.round(2.5*fps)));
  }
  assert.throws(()=>screenClockArguments(30,NaN),/时钟无效/);
});
test('P07：原生中间片接受三种最终编码，编码由共用收尾执行',()=>{
  for(const codec of ['h264','hevc','h265','prores422'])assert.deepEqual(mp4ExportArguments(24,codec),['--fps','24']);
});
test('P08：只读导出拒绝过期 revision，不接受未保存设置覆盖',()=>{
 const current={revision:7,document:{legacyEditor:{padding:20}}};
 assert.deepEqual(savedExportDocument(current,{useSavedDocument:true,documentRevision:7,exportEditor:{padding:99},savedEditor:{padding:88}}),current.document);
 assert.throws(()=>savedExportDocument(current,{useSavedDocument:true,documentRevision:6}),/已保存版本已变化/);
});

async function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task20-export-'));
 const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill(){queueMicrotask(()=>child.emit('close',null,'SIGTERM'));return true;}});
 const data:any={root,child,project:{id:'p',settings:{fps:30},media:[],openScreenDocuments:[]},document:{document:{assets:[],legacyEditor:{}},revision:7,ref:{id:'d',title:'录屏',relativePath:'d.json',duration:2.5}},encode:async()=>{},args:[]};
 const key='__task20ExportFixture';(globalThis as any)[key]=data;
 const built=await build({entryPoints:['server/editor/openscreen-export.ts'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'isolated-export',setup(b){
  b.onResolve({filter:/.*/},a=>{
   if(!a.importer)return;
   if(a.path==='node:child_process')return {path:'child',namespace:'fixture'};
   if(a.path.endsWith('src/types/editor.ts'))return {path:path.resolve(path.dirname(a.importer),a.path),external:true};
   if(a.path.startsWith('.'))return {path:a.path,namespace:'fixture'};
  });
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>{
   const prefix=`const f=globalThis.${key};`;
   const sources:Record<string,string>={
    child:`export const spawn=(_exe,args)=>{f.args=args;return f.child;};`,
    './store.ts':`import fs from 'node:fs';import path from 'node:path';export const findProject=()=>({dir:f.root,project:f.project});export const atomicJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};`,
    './openscreen-profile.ts':`export const openScreenProjectProfile=()=>f.root+'/profile';`,
    './openscreen.ts':`export const findOpenScreenExecutable=()=>'/fake/openscreen';export const openScreenProfileArgs=()=>[];`,
    './openscreen-documents.ts':`export const readOpenScreenDocument=()=>f.document;`,
    './openscreen-export-edition.ts':`export const screenPublishingEnabled=false;export const screenSpawnOptions={};export const stopScreenExport=w=>w?.kill();export const revealScreenCommand=()=>({});export const registerPublishedAsset=()=>{};`,
    './openscreen-encode.ts':`export const encodeScreenExportMedia=(...a)=>f.encode(...a);`,
    '../general/export-media.ts':`export const probeExportMedia=async()=>({});`,
    '../general/export-draft.ts':`export const flatGeneralDraft=async()=>{};`,
    '../export-preferences.ts':`export const writeExportPreferences=()=>{};`,
    '../system-settings.ts':`export const validateDirectory=v=>v;`,
   };
   if(!(a.path in sources))throw Error('未声明测试依赖 '+a.path);
   return {contents:prefix+sources[a.path]};
  });
 }}]});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
 return {data,api:mod.exports,close(){delete(globalThis as any)[key];fs.rmSync(root,{recursive:true,force:true});}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
test('S08：准备失败持久化 failed，并删除暂存目录与本次输出目录',async()=>{
 const f=await fixture();try{
  f.data.document.document.legacyEditor={wallpaper:'/wallpapers/wallpaper99999.jpg'};
  assert.throws(()=>f.api.startOpenScreenExport('p','d',{settings:{}}),/背景资源缺失/);
  const dir=path.join(f.data.root,'analysis/openscreen/d/export-jobs');
  const files=fs.readdirSync(dir);assert.equal(files.length,1);assert(files[0].endsWith('.json'));
  const job=JSON.parse(fs.readFileSync(path.join(dir,files[0]),'utf8'));assert.equal(job.status,'failed');assert(!fs.existsSync(job.outputDir));
 }finally{f.close();}
});
test('T05：原生导出取消清理已写半成品，保留其他导出',async()=>{
 const f=await fixture();try{
  const keep=path.join(f.data.root,'exports/已完成.mp4');fs.mkdirSync(path.dirname(keep));fs.writeFileSync(keep,'completed');
  const job=f.api.startOpenScreenExport('p','d',{settings:{}});
  fs.writeFileSync(path.join(job.outputDir,'source.mp4'),'partial');
  f.api.cancelOpenScreenExport('p','d',job.id);await tick();
  assert.equal(f.api.readOpenScreenExport('p','d',job.id).status,'cancelled');assert(!fs.existsSync(job.outputDir));assert.equal(fs.readFileSync(keep,'utf8'),'completed');
  assert.equal(f.api.activeOpenScreenExports(),0);
 }finally{f.close();}
});
test('T05：编码收尾阶段取消也清理目标，并终止编码信号',async()=>{
 const f=await fixture();try{
  let encoding=false;
  f.data.encode=async(_source:string,target:string,_settings:unknown,_fps:number,_duration:number,signal:AbortSignal)=>{
    fs.writeFileSync(target,'partial');encoding=true;
    await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('停止')),{once:true}));
  };
  const job=f.api.startOpenScreenExport('p','d',{settings:{video:{codec:'h265'}}});
  fs.writeFileSync(path.join(job.outputDir,'source.mp4'),'native');f.data.child.emit('close',0,null);await tick();assert(encoding);
  f.api.cancelOpenScreenExport('p','d',job.id);await tick();
  assert.equal(f.api.readOpenScreenExport('p','d',job.id).status,'cancelled');assert(!fs.existsSync(job.outputDir));assert.equal(f.api.activeOpenScreenExports(),0);
 }finally{f.close();}
});

test('P08：真实路由函数允许只读导出及取消自己的任务，保留原锁',async()=>{
 const key='__task20Route';const lock={clientId:'owner'};const calls:any[]=[];
 (globalThis as any)[key]={lock,job:{requestClientId:'reader',savedDocumentRevision:7},calls};
 const built=await build({entryPoints:['server/editor/api/openscreen.ts'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'route-fixture',setup(b){
  b.onResolve({filter:/.*/},a=>a.importer&&a.path.startsWith('.')?{path:a.path,namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>{
   const source=a.path.endsWith('http.ts')?`export async function bodyJson(req){let s='';for await(const c of req)s+=c;return JSON.parse(s)}export const sendJson=(res,status,body)=>{res.status=status;res.body=body;};`
    :a.path.endsWith('openscreen-lock.ts')?'export const readScreenLock=()=>f.lock;export const acquireScreenLock=()=>{};'
    :a.path.endsWith('openscreen-edition.ts')?'export const handleScreenEditionApi=async()=>false;'
    :a.path.endsWith('openscreen-export.ts')?`export const startOpenScreenExport=(...a)=>{f.calls.push(a);return f.job};export const readOpenScreenExport=()=>f.job;export const cancelOpenScreenExport=()=>({status:'cancelled'});export const createOpenScreenExportTarget=()=>{};export const revealOpenScreenExport=()=>{};`
    :null;
   if(source)return {contents:`const f=globalThis.${key};`+source};
   // Unused route domains cannot start native work in this regression.
   const names=a.path.includes('documents')?['archiveOpenScreenDocument','createOpenScreenDocument','duplicateOpenScreenDocument','listOpenScreenDocuments','readOpenScreenDocument','saveOpenScreenDocument']:a.path.includes('host')?['cancelOpenScreenHostSession','importOpenScreenHostCandidate','launchOpenScreenHud','listOpenScreenHostSessions','readOpenScreenHostSession']:['compactOpenScreenCodexSession','createOpenScreenCodexSession','deleteOpenScreenCodexSession','getOpenScreenCodexSession','listOpenScreenCodexSessions','openScreenCodexBudget','renameOpenScreenCodexSession','rewindOpenScreenCodexSession','runOpenScreenCodexTurn','translateOpenScreenCaptions'];
   return {contents:names.map(n=>`export const ${n}=()=>{};`).join('')};
  });
 }}]});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
 const call=async(suffix:string,body:unknown)=>{const res:any={};const req=Object.assign(Readable.from([JSON.stringify(body)]),{method:'POST'});await mod.exports.handleOpenScreenApi({req,res,id:'p',dir:'/isolated',parts:['projects','p','openscreen','documents','d',...suffix.split('/')]});return res;};
 try{
  assert.equal((await call('exports',{clientId:'reader'})).status,423);
  assert.equal((await call('exports',{clientId:'reader',useSavedDocument:true,documentRevision:7,purpose:'publish'})).status,201);
  assert.equal(calls[0][2].purpose,'export');
  assert.equal((await call('exports/job/cancel',{clientId:'reader'})).status,200);
  assert.equal((await call('exports/job/cancel',{clientId:'other'})).status,423);
  assert.deepEqual(lock,{clientId:'owner'});
 }finally{delete(globalThis as any)[key];}
});

test('P06：真实短源补足最后一帧，ProRes 的帧率和帧数精确',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {ffmpegPath,ffprobePath}=await import('./general/kit-env.ts');
 const {encodeScreenExportMedia}=await import('./editor/openscreen-encode.ts');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task20-clock-'));
 try {
  const source=path.join(dir,'short.mp4');
  execFileSync(ffmpegPath(),['-v','error','-y','-f','lavfi','-i','color=c=red:s=64x64:r=30','-frames:v','29','-c:v','mpeg4',source]);
  for(const fps of [24,30,60]){
   const target=path.join(dir,`${fps}.mov`);
   await encodeScreenExportMedia(source,target,ExportSettingsSchema.parse({resolution:'original',video:{codec:'prores422',container:'mov'}}),fps,1);
   const data=JSON.parse(execFileSync(ffprobePath(),['-v','error','-count_frames','-show_streams','-of','json',target],{encoding:'utf8'}));
   const v=data.streams.find((s:any)=>s.codec_type==='video');assert.equal(v.r_frame_rate,`${fps}/1`);assert.equal(v.avg_frame_rate,`${fps}/1`);assert.equal(Number(v.nb_read_frames),fps);assert.equal(v.codec_name,'prores');assert.equal(v.width,64);assert.equal(v.height,64);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P08：录屏窗口租约真实落盘，另一窗口不能覆盖、抢锁或续约',async()=>{
 const {acquireScreenLock,readScreenLock,screenLockFile}=await import('./editor/openscreen-lock.ts');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task20-lock-'));
 try {
  assert.equal(acquireScreenLock(dir,{clientId:'editor-a'}).acquired,true);
  const before=fs.readFileSync(screenLockFile(dir));
  assert.equal(acquireScreenLock(dir,{clientId:'reader-b'}).acquired,false);
  assert.deepEqual(fs.readFileSync(screenLockFile(dir)),before);
  assert.equal(readScreenLock(dir)?.clientId,'editor-a');
  assert.equal(acquireScreenLock(dir,{clientId:'editor-a'}).acquired,true);
  assert.equal(acquireScreenLock(dir,{clientId:'reader-b',takeover:true}).acquired,true);
  const current=JSON.parse(fs.readFileSync(screenLockFile(dir),'utf8'));current.expiresAt=Date.now()-1;fs.writeFileSync(screenLockFile(dir),JSON.stringify(current));
  assert.equal(readScreenLock(dir),undefined);
  assert.equal(acquireScreenLock(dir,{clientId:'editor-c'}).acquired,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
