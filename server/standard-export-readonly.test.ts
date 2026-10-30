import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {savedExportDocument} from './editor/openscreen-export.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

const require=createRequire(import.meta.url);
test('只读、未改动和保存时失锁均请求共享弹窗并使用已保存文档；失败通知宿主',async()=>{
 const built=await build({stdin:{contents:"export {requestSharedExportDialog} from './vendor/openscreen/src/linkreader/bridge';export {createEmptyDocument} from './vendor/openscreen/src/lib/ai-edition/schema';",resolveDir:process.cwd(),loader:'ts'},tsconfig:'vendor/openscreen/tsconfig.json',bundle:true,write:false,format:'cjs',platform:'node',packages:'external',jsx:'automatic'});
 for(const scenario of ['readonly','clean','unchanged-dirty','lost-lock','dirty','read-failed']){
  const dom=new JSDOM('',{url:`http://localhost/openscreen/?linkreaderProjectId=p&linkreaderClientId=reader&linkreaderWritable=${scenario==='readonly'||scenario==='read-failed'?'0':'1'}`});
  const previous=new Map<string,PropertyDescriptor|undefined>(),messages:any[]=[],calls:string[]=[];
  dom.window.postMessage=((value:unknown)=>{messages.push(value);}) as typeof dom.window.postMessage;
  let saved:any;
  const globals={window:dom.window,location:dom.window.location,document:dom.window.document,fetch:async(_url:unknown,init?:RequestInit)=>{
   const method=init?.method||'GET';calls.push(method);
   const failed=scenario==='read-failed'||scenario==='lost-lock'&&method==='PUT';
   if(method==='PUT'&&!failed)saved=JSON.parse(String(init?.body)).document;
   return {ok:!failed,status:failed?scenario==='lost-lock'?423:500:200,json:async()=>failed?{ok:false,error:'验证用读取/锁失败'}:{ok:true,result:{document:saved,ref:{id:saved.project.id},revision:7}}};
  }};
  for(const [key,value]of Object.entries(globals)){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
  try{
   const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
   saved=mod.exports.createEmptyDocument({projectId:'saved-doc',title:'已保存录屏'});
   saved.assets=[{id:'video',kind:'video',label:'saved',originalPath:'/original.mp4',durationSec:5,video:{width:1920,height:1080,fps:30,codec:'h264'}}];
   saved.timeline.clips=[{id:'clip',assetId:'video',sourceStartSec:0,sourceEndSec:5,timelineStartSec:0,timelineEndSec:5,wordRefs:[],origin:'system'}];
   saved.project.primaryAssetId='video';saved.legacyEditor={aspectRatio:'16:9',padding:20};
   const local=structuredClone(saved);
   if(scenario==='unchanged-dirty'){await mod.exports.requestSharedExportDialog(saved,true);calls.length=0;messages.length=0;}
   else {local.assets[0].video={...local.assets[0].video,width:640,height:360};local.legacyEditor.padding=99;}
   if(scenario==='read-failed'){
    await assert.rejects(mod.exports.requestSharedExportDialog(local,false),/读取/);
    assert(messages.some(m=>m.type==='error'&&m.payload.message.startsWith('无法打开导出：')));
    assert(!messages.some(m=>m.type==='export-dialog'));continue;
   }
   await mod.exports.requestSharedExportDialog(local,scenario!=='clean');
   const payload=messages.find(m=>m.type==='export-dialog')?.payload;assert(payload);
   assert.equal(payload.documentId,'saved-doc');assert.equal(payload.revision,7);assert.equal(payload.useSavedDocument,true);
   assert.equal(payload.canvas.width,scenario==='dirty'?640:1920);
   assert.equal(payload.canvas.height,scenario==='dirty'?360:1080);
   assert.equal(payload.exportEditor,undefined,'不夹带窗口内未保存的 editor 设置');
   assert.equal(payload.savedEditor.padding,scenario==='dirty'?99:20);
   assert.deepEqual(calls,scenario==='dirty'?['PUT']:scenario==='lost-lock'?['PUT','GET']:['GET']);
   assert.equal(payload.notice,scenario==='readonly'||scenario==='lost-lock'?'另一个窗口正在编辑，导出的是上次保存的版本':undefined);
   assert(!messages.some(m=>m.type==='error'),'成功回退不留下错误横条');
   if(scenario==='dirty'){
    calls.length=0;await mod.exports.requestSharedExportDialog(local,true);
    assert.deepEqual(calls,['GET'],'同页再次打开不能重复保存相同文档');
   }
  }finally{dom.window.close();for(const [key,value]of previous){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
 }
});

test('服务端已保存版本导出拒绝旧版本号并忽略未保存的 editor 覆盖',()=>{
 const current={revision:7,document:{legacyEditor:{padding:20,backgroundColor:'#123456'}}};
 const before=structuredClone(current);
 const result=savedExportDocument(current,{useSavedDocument:true,documentRevision:7,exportEditor:{padding:99,backgroundColor:'#ffffff'},savedEditor:{padding:99}});
 assert.deepEqual(result,current.document);assert.deepEqual(current,before);
 assert.throws(()=>savedExportDocument(current,{useSavedDocument:true,documentRevision:6}),/已保存版本已变化/);
 assert.throws(()=>savedExportDocument(current,{useSavedDocument:true}),/已保存版本已变化/);
});

test('真实 HTTP 路由：他人持锁仍可导出保存版本和取消自己的任务，不能保存或取消他人任务',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'screen-readonly-api-'));
 const lockFile=path.join(folder,'analysis','openscreen','editor-lock.json');
 fs.mkdirSync(path.dirname(lockFile),{recursive:true});
 const lock={clientId:'owner',clientName:'另一个录屏窗口',expiresAt:Date.now()+60000};fs.writeFileSync(lockFile,JSON.stringify(lock));
 const requests:any[]=[];const stored={revision:7,document:{legacyEditor:{padding:20}}};
 const globalRecord=globalThis as any,previous=globalRecord.__task13ExportTest;
 globalRecord.__task13ExportTest={job:{id:'job',requestClientId:'reader',savedDocumentRevision:7},start:(_p:string,_d:string,input:any)=>{requests.push({input,document:savedExportDocument(stored,input)});return globalRecord.__task13ExportTest.job;}};
 const built=await build({entryPoints:['server/editor/api/openscreen.ts'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'isolate-native-renderer',setup(b){
  b.onResolve({filter:/\/openscreen-export\.ts$/},()=>({path:'export',namespace:'stub'}));
  b.onResolve({filter:/^\.\.\//},a=>({path:path.resolve(path.dirname(a.importer),a.path),external:true}));
  b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`export const startOpenScreenExport=(...a)=>globalThis.__task13ExportTest.start(...a);export const readOpenScreenExport=()=>globalThis.__task13ExportTest.job;export const cancelOpenScreenExport=()=>({status:'cancelled'});export const createOpenScreenExportTarget=()=>{throw Error('unexpected')};export const revealOpenScreenExport=()=>{};`}));
 }}]});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
 const server=http.createServer((req,res)=>{void mod.exports.handleOpenScreenApi({req,res,parts:req.url!.slice(1).split('/'),id:'p',dir:folder}).catch((e:Error)=>{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/projects/p/openscreen/documents/doc`;
 const call=async(suffix:string,body:unknown,method='POST')=>{const r=await fetch(base+suffix,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{
  assert.equal((await call('/exports',{clientId:'reader'})).status,423);
  assert.equal((await call('/exports',{clientId:'reader',useSavedDocument:true,documentRevision:7,exportEditor:{padding:99}})).status,201);
  assert.deepEqual(requests[0].document,stored.document);
  assert.equal((await call('/exports',{clientId:'reader',useSavedDocument:true,documentRevision:6})).status,400);
  assert.equal((await call('',{clientId:'reader',document:{},revision:7},'PUT')).status,423);
  assert.equal((await call('/exports/job/cancel',{clientId:'reader'})).status,200);
  assert.equal((await call('/exports/job/cancel',{clientId:'someone-else'})).status,423);
  assert.deepEqual(JSON.parse(fs.readFileSync(lockFile,'utf8')),lock);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));if(previous===undefined)delete globalRecord.__task13ExportTest;else globalRecord.__task13ExportTest=previous;fs.rmSync(folder,{recursive:true,force:true});}
});

test('只读宿主收到导出请求会展示真实共享弹窗；打开失败显示可见亮紫横条',async()=>{
 const built=await build({entryPoints:['src/pages/OpenScreenWorkspace.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'isolated-host-services',setup(b){
  b.onResolve({filter:/^(react-router|@\/workspace\/navigation-guard|@\/studio\/api|.*\.css\?inline)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='react-router'?"export const useParams=()=>({id:'p'});":a.path.includes('navigation-guard')?"export const useWorkspaceLeaveGuard=()=>{};export const WorkspaceLink=({children})=>children;":a.path.endsWith('?inline')?'export default "";':"export const getProject=async()=>({id:'p',name:'只读工程',settings:{fps:30}});export const acquireLock=async()=>({acquired:false,lock:{clientName:'另一个窗口'}});export const archiveLegacyScreenMotion=async()=>{};export const cancelOpenScreenHostSession=async()=>{},confirmOpenScreenHostCandidate=async()=>{},getOpenScreenHostSession=async()=>{},launchOpenScreenHost=async()=>{};"}));
 }}]});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),previous=new Map<string,PropertyDescriptor|undefined>();
 Object.defineProperty(dom.window.navigator,'platform',{value:'MacIntel'});
 const leaseCalls:any[]=[];
 const globals={window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,fetch:async(url:unknown,init?:RequestInit)=>{if(String(url).endsWith('/openscreen/lock')){const body=JSON.parse(String(init?.body));leaseCalls.push(body);return {ok:true,json:async()=>({ok:true,result:{acquired:false,lock:{clientName:'另一个窗口'}}})}}return {ok:true,json:async()=>({ok:true,result:String(url).endsWith('/history?kind=screen')?[]:String(url).endsWith('/capabilities')?{defaultDestination:'/tmp/exports',jianying:{available:false}}:null})}}};
 for(const [key,value]of Object.entries(globals)){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const root=createRoot(dom.window.document.getElementById('root')!);
 try{
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  await act(async()=>root.render(React.createElement(mod.exports.default)));
  const iframe=dom.window.document.querySelector('iframe')!;assert(iframe.src.includes('linkreaderWritable=0'));
  const send=async(type:string,payload:unknown)=>{await act(async()=>{dom.window.dispatchEvent(new dom.window.MessageEvent('message',{origin:'http://localhost',source:iframe.contentWindow,data:{type,projectId:'p',payload}}));});};
  await send('error',{message:'无法打开导出：已保存文件读取失败'});
  const error=dom.window.document.querySelector<HTMLElement>('.openscreen-host-error[role="alert"]');assert(error);
  assert.match(error.textContent!,/已保存文件读取失败/);assert.equal(error.style.color,'rgb(152, 105, 220)');
  await send('export-dialog',{documentId:'doc',revision:7,useSavedDocument:true,canvas:{width:1920,height:1080,fps:30},notice:'另一个窗口正在编辑，导出的是上次保存的版本'});
  assert(dom.window.document.querySelector('.export-dialog[role="dialog"]'));
  assert.equal(dom.window.document.querySelector('.export-notice')?.textContent,'另一个窗口正在编辑，导出的是上次保存的版本');
  assert.equal(dom.window.document.querySelector('.openscreen-host-error'),null);
  assert.equal(leaseCalls.length,1);assert.equal(leaseCalls[0].takeover,false);
  assert.equal(dom.window.sessionStorage.getItem('opentake-screen-editor-client'),leaseCalls[0].clientId);
 }finally{await act(async()=>root.unmount());dom.window.close();for(const [key,value]of previous){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});
