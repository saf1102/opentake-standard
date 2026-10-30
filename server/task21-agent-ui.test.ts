import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../',import.meta.url));
test('S07：共享 Codex 安装组件可选择程序并验证保存，模型页调用当前模型连通测试，错误原样显示',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'task21-codex-ui-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0)})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 Object.defineProperty(dom.window.navigator,'platform',{value:'Win32',configurable:true});
 const oldFetch=globalThis.fetch,calls:{url:string;body:any}[]=[];let cliPath='/fixture/codex',app:any;
 try{
  const outfile=path.join(temp,'harness.mjs');await build({stdin:{contents:`import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {AgentInstallation} from './src/studio/components/AgentInstallation';import {AgentSettingsDialog} from './src/studio/components/AgentSettingsDialog';import {defaultAgentSettings} from './src/studio/agent-settings';import {testAllCatalogModels} from './src/studio/components/agent-settings-edition';export {act,createRoot,defaultAgentSettings,testAllCatalogModels};export const installation=<AgentInstallation kind="codex"/>;export const models=<AgentSettingsDialog embedded/>;`,resolveDir:root,loader:'tsx'},outfile,jsx:'automatic',bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'isolate-private-panels',setup(b){
   b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
   b.onResolve({filter:/^\.\/VoiceSettings$|^\.\/AgentPicker$/},a=>({path:a.path.slice(2),namespace:'fixture'}));
   b.onResolve({filter:/components\/ui\/dropdown-menu$/},()=>({path:'dropdown',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:root,loader:'tsx',contents:a.path==='dropdown'?`export const DropdownMenu=({children})=><div>{children}</div>,DropdownMenuContent=({children})=><div>{children}</div>,DropdownMenuTrigger=({children})=><>{children}</>;export const DropdownMenuItem=({children,onSelect,asChild})=>asChild?<>{children}</>:<button onClick={onSelect}>{children}</button>;`:`export const ${a.path}=()=>null;`}));
  }}]});
  const h=await import(pathToFileURL(outfile).href);const settings=h.defaultAgentSettings();settings.cliPath=cliPath;
  const catalog=()=>({executable:cliPath,cliVersion:'codex test',checkedAt:new Date().toISOString(),models:[{id:'model-current',name:'当前模型',efforts:['medium'],defaultEffort:'medium',isDefault:true},{id:'model-other',name:'另一个模型',efforts:['medium'],defaultEffort:'medium'}]});
  globalThis.fetch=(async(input:any,init:any={})=>{const url=String(input),body=init.body?JSON.parse(init.body):undefined;calls.push({url,body});let result:any;
   if(url.endsWith('/choose-cli'))result={path:'/fixture/selected-codex'};
   else if(url.endsWith('/installation/codex')){if(init.method==='PUT')cliPath=body.cliPath;result={host:'test',mode:'manual',state:'ready',executable:cliPath,version:'test',candidates:[]}}
   else if(url.endsWith('/catalog'))result=catalog();
   else if(url.endsWith('/test'))result={...body,ok:false,durationMs:4,checkedAt:new Date().toISOString(),error:'测试连接失败示例'};
   else if(url.endsWith('/agent-settings'))result={settings:{...settings,cliPath},catalog:catalog(),runs:[]};else throw Error('意外请求 '+url);
   return Response.json({ok:true,result});}) as typeof fetch;
  app=h.createRoot(document.getElementById('root'));const click=async(label:string)=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===label);assert.ok(el,label);await h.act(async()=>{el.click();await new Promise(r=>setTimeout(r,5))})};
  await h.act(async()=>{app.render(h.installation);await new Promise(r=>setTimeout(r,5))});await click('手动指定…');await click('选择程序');assert.equal((document.querySelector('input') as HTMLInputElement).value,'/fixture/selected-codex');await click('验证并保存路径');assert.ok(calls.some(c=>c.url.endsWith('/installation/codex')&&c.body?.cliPath==='/fixture/selected-codex'));
  await h.act(async()=>{app.render(h.models);await new Promise(r=>setTimeout(r,5))});await click('连通测试');const tested=calls.filter(c=>c.url.endsWith('/test'));assert.ok(tested.some(c=>c.body.model==='model-current'));assert.equal(tested.some(c=>c.body.model==='model-other'),h.testAllCatalogModels);assert.match(document.body.textContent||'',/测试连接失败示例/);assert.equal(calls.some(c=>c.url.includes('/agent-connections')),false,'Windows模型页保留旧API，不请求Mac统一接入');
  await h.act(async()=>app.unmount());app=null;
 }finally{if(app)app.unmount();globalThis.fetch=oldFetch;dom.window.close();for(const [key,value] of saved){if(value)Object.defineProperty(globalThis,key,value);else delete (globalThis as any)[key]}fs.rmSync(temp,{recursive:true,force:true})}
});
