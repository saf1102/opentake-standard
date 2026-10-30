import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url));

test('任务17：工程选择真实落盘、隔离口播/录屏、复制保留，实际resolveAgent继承异步scope且不污染默认',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'task17-project-agent-'));const outfile=path.join(temp,'harness.mjs');
 const state={lock:undefined as undefined|{clientId:string},screenLock:undefined as undefined|{clientId:string}};(globalThis as any).__task17ProjectChoice=state;
 const settings=`const modules=Object.fromEntries(['roughcut','chapters','cardPlanning','smallCard','halfDiagram','fullDiagram','captionTranslation','screenEditing'].map(id=>[id,{agent:'codex',model:'global-default',effort:'medium'}]));export const readAgentSettings=()=>({version:1,cliPath:'',modules});export const agentSettingsFile=()=>${JSON.stringify(path.join(temp,'global-settings.json'))};export const parseAgentChoice=value=>{if(!value||typeof value.model!=='string'||typeof value.effort!=='string')throw Error('选择无效');return {...value}};export const validateModuleAgentChoice=async(module,value)=>{await new Promise(r=>setTimeout(r,5));return parseAgentChoice(value)};export const getAgentCatalog=async()=>({executable:'/fake/codex',cliVersion:'fixture',models:[]});export const validateAgentChoice=(module,settings)=>settings.modules[module];export const atomicAgentJson=()=>{throw Error('不应写全局设置')};`;
 const connection=`export const assertAgentExecutionAllowed=()=>{};export const getConnectionConfig=()=>({mode:'cli'});export const getConnectionStatus=async()=>({mode:'cli',connected:true,cliInstalled:true});export const effectiveConnectionModel=()=>'';export const runConnectionText=async()=>{throw Error('不得执行模型')};export const resolveAgentConnectionLaunch=async()=>{throw Error('不得执行命令行')};`;
 try{
  await build({stdin:{contents:`export * from './server/editor/project-agent-choices.ts';export {resolveAgent} from './server/agent-runtime.ts';`,loader:'ts',resolveDir:root},outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'isolated-runtime',setup(b){
   b.onResolve({filter:/agent-settings\.ts$|agent-connections\.ts$|agent-installation\.ts$|proc\.ts$|general\/edition\.ts$|\.\/store\.ts$|openscreen-lock\.ts$/},a=>{
    if(a.path.includes('src/studio/agent-settings')||a.path.includes('shared/agent-connections'))return;
    return {path:a.path,namespace:'fixture'};
   });
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('agent-settings.ts')?settings:a.path.endsWith('agent-connections.ts')?connection:a.path.endsWith('agent-installation.ts')?`export default {};`:a.path.endsWith('proc.ts')?`export const runWithClosedStdin=()=>{throw Error('不得执行子进程')};`:a.path.endsWith('edition.ts')?`export const recordCodexUsage=()=>{};`:a.path.endsWith('openscreen-lock.ts')?`export const readScreenLock=()=>globalThis.__task17ProjectChoice.screenLock;`:`import fs from'node:fs';export const readLock=()=>globalThis.__task17ProjectChoice.lock;export const atomicJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));`,loader:'js'}));
  }}]});
  const h=await import(pathToFileURL(outfile).href);const first=path.join(temp,'first'),second=path.join(temp,'second');fs.mkdirSync(first);fs.mkdirSync(second);
  const choice=(model:string)=>({agent:'codex',model,effort:'medium'});
  if(h.PROJECT_AGENT_MODULES.spoken.length===0){
   assert.deepEqual(h.PROJECT_AGENT_MODULES.screen,['screenEditing','captionTranslation']);
   await assert.rejects(h.writeProjectAgentChoice(first,'spoken',{module:'roughcut',choice:choice('forbidden'),revision:0,clientId:'a'}),/没有该/);
   fs.mkdirSync(path.join(first,'.opentake'));fs.writeFileSync(path.join(first,'.opentake/agent-choices.json'),JSON.stringify({version:1,revision:0,spoken:{roughcut:choice('preserved-pro-choice')},screen:{}}));
   await h.writeProjectAgentChoice(first,'screen',{module:'screenEditing',choice:choice('screen-model'),revision:0,clientId:'s'});
   assert.equal(h.readProjectAgentDocument(first).spoken.roughcut.model,'preserved-pro-choice');
   assert.equal((await h.withProjectAgentChoices(first,'screen',()=>h.resolveAgent('screenEditing'))).model,'screen-model');
   assert.equal((await h.withProjectAgentChoices(first,'spoken',()=>h.resolveAgent('roughcut'))).model,'global-default');
   const copy=path.join(temp,'copied');fs.cpSync(first,copy,{recursive:true});assert.deepEqual(h.readProjectAgentDocument(copy),h.readProjectAgentDocument(first));return;
  }
  assert.deepEqual(h.readProjectAgentDocument(first),{version:1,revision:0,spoken:{},screen:{}});
  await h.writeProjectAgentChoice(first,'spoken',{module:'roughcut',choice:choice('spoken-model'),revision:0,clientId:'a'});
  await h.writeProjectAgentChoice(first,'screen',{module:'screenEditing',choice:choice('screen-model'),revision:1,clientId:'s'});
  await h.writeProjectAgentChoice(second,'spoken',{module:'roughcut',choice:choice('second-model'),revision:0,clientId:'b'});
  const saved=h.readProjectAgentDocument(first);assert.equal(saved.spoken.chapters.model,'spoken-model');assert.equal(saved.screen.screenEditing.model,'screen-model');assert.equal(saved.spoken.screenEditing,undefined);
  const copy=path.join(temp,'copied');fs.cpSync(first,copy,{recursive:true});assert.deepEqual(h.readProjectAgentDocument(copy),saved);
  const result=await Promise.all([h.withProjectAgentChoices(first,'spoken',async()=>{await new Promise(r=>setTimeout(r,20));return h.resolveAgent('roughcut')}),h.withProjectAgentChoices(second,'spoken',async()=>{await new Promise(r=>setTimeout(r,5));return h.resolveAgent('roughcut')}),h.withProjectAgentChoices(first,'screen',()=>h.resolveAgent('screenEditing'))]);
  assert.deepEqual(result.map(item=>item.model),['spoken-model','second-model','screen-model']);assert.equal((await h.resolveAgent('roughcut')).model,'global-default');
  let later:Promise<any>|undefined;await h.withProjectAgentChoices(first,'spoken',async()=>{later=new Promise(resolve=>setTimeout(()=>void h.resolveAgent('roughcut').then(resolve),10))});assert.equal((await later).model,'spoken-model');
  state.lock={clientId:'other'};await assert.rejects(h.writeProjectAgentChoice(first,'spoken',{module:'roughcut',choice:null,revision:2,clientId:'a'}),/另一个窗口/);state.lock=undefined;
  state.screenLock={clientId:'other-screen'};await assert.rejects(h.writeProjectAgentChoice(first,'screen',{module:'screenEditing',choice:null,revision:2,clientId:'s'}),/另一个窗口/);state.screenLock=undefined;
  await assert.rejects(h.writeProjectAgentChoice(first,'screen',{module:'roughcut',choice:choice('wrong'),revision:2,clientId:'s'}),/没有该/);
  await assert.rejects(h.writeProjectAgentChoice(first,'spoken',{module:'roughcut',choice:choice('stale'),revision:0,clientId:'a'}),/已被修改/);
  const raced=await Promise.allSettled([h.writeProjectAgentChoice(first,'spoken',{module:'roughcut',choice:choice('one'),revision:2,clientId:'a'}),h.writeProjectAgentChoice(first,'spoken',{module:'roughcut',choice:choice('two'),revision:2,clientId:'a'})]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);
  await h.writeProjectAgentChoice(first,'spoken',{module:'roughcut',choice:null,revision:3,clientId:'a'});assert.deepEqual(h.readProjectAgentDocument(first).spoken,{});assert.equal(h.readProjectAgentDocument(first).screen.screenEditing.model,'screen-model');
  const file=path.join(first,'.opentake','agent-choices.json');fs.writeFileSync(file,'broken');assert.throws(()=>h.readProjectAgentDocument(first),/原文件已保留/);await assert.rejects(h.writeProjectAgentChoice(first,'spoken',{module:'roughcut',choice:choice('x'),revision:4,clientId:'a'}),/原文件已保留/);assert.equal(fs.readFileSync(file,'utf8'),'broken');assert.equal(fs.existsSync(path.join(temp,'global-settings.json')),false);assert.throws(()=>h.readProjectAgentDocument(path.join(temp,'missing-project')),/工程目录不可用/);
 }finally{delete(globalThis as any).__task17ProjectChoice;fs.rmSync(temp,{recursive:true,force:true})}
});

test('任务17：两版Mac实际dispatch包工程scope，Windows保留原dispatch',()=>{
 const proFile=path.join(root,'server/editor-api.ts');if(fs.existsSync(proFile)){const pro=fs.readFileSync(proFile,'utf8');assert.match(pro,/withProjectAgentChoices\(dir,\['openscreen','capture-jobs'\]/);assert.match(pro,/processOwner\.run\(quickEditOwner\(id,token\),scopedDispatch\)/);}
 const standardFile=path.join(root,'server/standard/openscreen-api.ts'),standard=fs.readFileSync(fs.existsSync(standardFile)?standardFile:path.join(root,'scripts/standard/overlays/server/standard/openscreen-api.ts'),'utf8');assert.match(standard,/process\.platform==='darwin'.*withProjectAgentChoices\(dir,'screen',screenDispatch\):screenDispatch\(\)/);
});
