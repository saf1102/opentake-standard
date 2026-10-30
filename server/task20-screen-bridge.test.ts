import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
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
