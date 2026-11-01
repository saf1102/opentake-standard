import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
import {defaultAgentSettings} from '../src/studio/agent-settings.ts';
import {connectionDefinition,defaultConnection,type ConnectionId,type ConnectionView} from '../shared/agent-connections.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
test('任务24：真实选择器组件列出接通的CLI，断开不换人；未安装卡片默认收起，定向设置仍展开',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task24-selectors-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});Object.defineProperty(dom.window.navigator,'platform',{value:'MacIntel'});
 const saved=new Map<string,PropertyDescriptor|undefined>(),oldFetch=globalThis.fetch;
 for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:(fn:()=>void)=>{fn();return 1},IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const view=(id:ConnectionId,patch:Partial<ConnectionView>={}):ConnectionView=>({...defaultConnection(id),...connectionDefinition(id),cliInstalled:true,connected:true,enabled:true,state:'connected',relay:false,cliAuthState:'connected',...patch});
 let connections=[view('codex'),view('kimi',{acpModelSelection:false}),view('deepseek'),view('claude',{enabled:false,connected:false}),view('copilot',{cliInstalled:false,connected:false}),view('minimax',{mode:'api',cliInstalled:false})];
 const settings=defaultAgentSettings();settings.modules.captionTranslation={agent:'kimi',model:'default',effort:'none'};settings.modules.generalEditing={agent:'kimi',model:'default',effort:'none'};
 let app:any;const changes:unknown[]=[];
 try{
  const outfile=path.join(dir,'harness.mjs');await build({stdin:{contents:`import React,{act}from'react';import{createRoot}from'react-dom/client';import{AgentPicker as LightPicker}from'./src/studio/components/AgentPicker';import{ScopedAgentChoice}from'./src/studio/components/ScopedAgentChoice';import{AgentPicker as FilmPicker}from'./src/general/AgentPicker';import{ConnectionList}from'./src/studio/components/ConnectionSettings';export{React,act,createRoot,LightPicker,ScopedAgentChoice,FilmPicker,ConnectionList};`,resolveDir:root,loader:'tsx'},outfile,jsx:'automatic',bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent',plugins:[{name:'dialog',setup(b){b.onResolve({filter:/components\/ui\/dialog$/},()=>({path:'dialog',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:root,loader:'tsx',contents:`export const Dialog=({open,children})=>open?<div role="dialog">{children}</div>:null;export const DialogContent=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;export const DialogTrigger=({children})=><>{children}</>;`}))}}]});
  globalThis.fetch=(async(input:any)=>{const url=String(input);return Response.json({ok:true,result:url.includes('agent-connections')?{connections}:{settings,catalog:{models:[],executable:'/fake/codex',cliVersion:'fixture'},runs:[]}})}) as typeof fetch;
  const h=await import(pathToFileURL(outfile).href);app=h.createRoot(document.getElementById('root'));
  await h.act(async()=>app.render(h.React.createElement(h.LightPicker,{work:'翻译',module:'captionTranslation',value:'kimi',onChange:(value:unknown)=>changes.push(value)})));
  let select=document.querySelector('select')!;assert.deepEqual([...select.options].map(o=>o.value),['codex','kimi','minimax']);assert.equal(select.value,'kimi');assert.deepEqual(changes,[]);
  connections=connections.map(c=>c.id==='kimi'?{...c,connected:false}:c);await h.act(async()=>window.dispatchEvent(new Event('opentake-connections-changed')));select=document.querySelector('select')!;assert.equal(select.value,'kimi');assert.equal(select.selectedOptions[0].textContent,'所选智能体未接通');assert.deepEqual(changes,[],'断开不会偷偷改选择');
  connections=connections.map(c=>c.id==='kimi'?{...c,connected:true}:c);
  await h.act(async()=>app.render(h.React.createElement(h.ScopedAgentChoice,{work:'captionTranslation',value:{agent:'kimi',model:'default',effort:'none'},onChange:()=>{}})));
  assert.match(document.body.textContent!,/跟随 Kimi 默认/);assert.equal(document.querySelector('input[aria-label="智能体模型"]'),null);
  await h.act(async()=>app.render(h.React.createElement(h.FilmPicker,{value:{agent:'kimi',model:'default',effort:'none'},onChange:(value:unknown)=>changes.push(value)})));
  await h.act(async()=>document.querySelector<HTMLButtonElement>('.ge-model-pick')!.click());
  const filmNames=[...document.querySelectorAll('.ge-model-opt b')].map(el=>el.textContent);assert.ok(filmNames.includes('Kimi'));assert.ok(filmNames.includes('Codex'));assert.ok(!filmNames.includes('DeepSeek'));assert.ok(!filmNames.includes('MiniMax Code'));assert.match(document.body.textContent!,/跟随 Kimi 默认/);
  await h.act(async()=>app.render(h.React.createElement(h.ConnectionList)));
  const more=document.querySelector<HTMLDetailsElement>('.connection-more')!;assert.ok(more);assert.equal(more.open,false);assert.ok(more.querySelector('#connection-row-copilot'));assert.equal(document.querySelector('#connection-row-kimi')?.closest('details'),null);
  await h.act(async()=>app.render(h.React.createElement(h.ConnectionList,{initialAgent:'copilot'})));
  assert.ok(document.querySelector('#connection-copilot-cli'));assert.equal(document.querySelector('#connection-row-copilot')?.closest('details'),null,'从部署指定进入的卡片不会藏在折叠里');
  await h.act(async()=>app.unmount());app=null;
 }finally{if(app)app.unmount();globalThis.fetch=oldFetch;dom.window.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete(globalThis as any)[key]}fs.rmSync(dir,{recursive:true,force:true});}
});
