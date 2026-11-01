import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';import {JSDOM} from 'jsdom';
import {connectionDefinition,defaultConnection,type ConnectionId} from '../shared/agent-connections.ts';
const root=fileURLToPath(new URL('../',import.meta.url));

test('修复二：真实选择器与空闲顶栏同步，运行中显示实际家；空回应只给官网和换家',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task24c-panel-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});Object.defineProperty(dom.window.navigator,'platform',{value:'MacIntel'});
 const saved=new Map<string,PropertyDescriptor|undefined>(),oldFetch=globalThis.fetch;
 for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,IS_REACT_ACT_ENVIRONMENT:true})){
  saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 }
 const views=(['codex','kimi','minimax'] as ConnectionId[]).map(id=>({...defaultConnection(id),...connectionDefinition(id),enabled:true,connected:true,cliInstalled:true,state:'connected',cliAuthState:'connected',models:[]}));
 let standard='kimi',app:any,h:any;const calls:unknown[]=[],requests:{url:string;method:string}[]=[];
 let project:any={id:'panel-fixture',name:'示例',kind:'general',settings:{aspect:'16:9',length:15},inputs:{kind:'topic',text:'白板',note:'',media:[]},versions:[],messages:[],agent:{agent:'codex',model:'default',effort:'medium'},run:{id:'last-codex',state:'failed',agent:'codex',purpose:'first',steps:[],queued:0,startedAt:'2026-10-30T00:00:00Z',error:'额度用完了'}};
 const noop=()=>{};
 try{
  const outfile=path.join(dir,'harness.mjs');await build({stdin:{contents:`import React,{act}from'react';import{createRoot}from'react-dom/client';import{GeneralAgentPanel}from'./src/general/GeneralAgentPanel';export{React,act,createRoot,GeneralAgentPanel};`,resolveDir:root,loader:'tsx'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
  globalThis.fetch=(async(input:any,init?:RequestInit)=>{const url=String(input);requests.push({url,method:init?.method||'GET'});return Response.json({ok:true,result:url.includes('agent-connections')?{connections:views}:{settings:{modules:{generalEditing:{agent:standard,model:'default',effort:'medium'}}},catalog:{models:[]},runs:[]}})}) as typeof fetch;
  h=await import(pathToFileURL(outfile).href);app=h.createRoot(document.getElementById('root'));
  const render=()=>app.render(h.React.createElement(h.GeneralAgentPanel,{project,brief:'白板',canQuote:false,draft:'',setDraft:noop,clearReference:noop,busy:'',onPickVersion:noop,connection:'open',resizer:null,actions:{stop:noop,resume:()=>calls.push('resume'),switchAgent:(value:unknown)=>calls.push(value),generate:noop,network:noop,send:noop,setNetwork:noop,setAgent:(choice:unknown)=>{project={...project,agent:choice};render()}}}));
  const name=()=>document.querySelector('.ge-ahead .name')!.textContent;
  const status=()=>document.querySelector('.ge-ahead .st')!.textContent;
  await h.act(async()=>render());assert.equal(name(),'Codex');assert.equal(status(),'没做完');
  await h.act(async()=>document.querySelector<HTMLButtonElement>('.ge-model-pick')!.click());
  await h.act(async()=>[...document.querySelectorAll<HTMLButtonElement>('.ge-model-opt')].find(el=>el.querySelector('b')?.textContent==='Kimi')!.click());
  assert.equal(name(),'Kimi');assert.equal(status(),'上一轮（Codex）没做完');assert.match(document.querySelector('.ge-model-pick')!.textContent!,/Kimi/);
  assert.equal(document.querySelector('.ge-ahead .st')!.getAttribute('data-tone'),'failed');
  project={...project,run:{...project.run,state:'running'}};await h.act(async()=>render());assert.equal(name(),'Codex');assert.match(status()!,/正在做片/);
  project={...project,run:{...project.run,state:'stopping'}};await h.act(async()=>render());assert.equal(name(),'Codex');
  project={...project,run:{...project.run,state:'failed'}};await h.act(async()=>render());assert.equal(name(),'Kimi');
  project={...project,agent:undefined};await h.act(async()=>render());assert.equal(name(),'Kimi','系统默认同样来自选择器，不能回落到旧Codex运行');
  standard='minimax';await h.act(async()=>window.dispatchEvent(new Event('opentake:general-agent-changed')));assert.equal(name(),'MiniMax Code');assert.match(document.querySelector('.ge-model-pick')!.textContent!,/MiniMax Code/);
  project={...project,agent:{agent:'kimi',model:'default',effort:'medium'},run:{...project.run,id:'empty-kimi',agent:'kimi',errorKind:'no-response',error:'Kimi没有回应。常见原因是套餐不含这项服务或额度用完，请到Kimi官网确认。'}};
  await h.act(async()=>render());assert.equal(name(),'Kimi');assert.equal(status(),'没有回应');
  const card=document.querySelector('.ge-failover')!;assert.equal(card.querySelector('b')!.textContent,'Kimi没有回应');assert.match(card.textContent!,/常见原因是套餐不含这项服务或额度用完/);
  assert.equal(card.querySelector('a')!.getAttribute('href'),'https://www.kimi.com/code/#pricing');
  const buttons=[...card.querySelectorAll<HTMLButtonElement>('button')];assert.deepEqual(buttons.map(b=>b.textContent),['换 Codex 接着做','换 MiniMax Code']);
  assert.ok(!card.textContent!.includes('稍后用 Kimi'));assert.ok(!card.textContent!.includes('没有交出片子'));
  await h.act(async()=>buttons[0].click());assert.deepEqual(calls,[{agent:'codex',model:'default',effort:'medium'}]);
  assert.ok(requests.every(({url,method})=>method==='GET'&&['/api/editor/agent-connections','/api/editor/agent-settings','/api/agent-settings'].includes(url)),`界面展示不调用prompt、不读账号/日志: ${JSON.stringify(requests)}`);
 }finally{if(app)await h.act(async()=>app.unmount());globalThis.fetch=oldFetch;dom.window.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete(globalThis as any)[key]}fs.rmSync(dir,{recursive:true,force:true});}
});
