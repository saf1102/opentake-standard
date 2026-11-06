import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {connectionDefinition,defaultConnection,type ConnectionId,type ConnectionView} from '../shared/agent-connections.ts';
const root=fileURLToPath(new URL('../',import.meta.url));

test('任务24第二部分：失败卡只列可出片的接通家，明确换家或原家继续，状态变化立即移除',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task24b-failover-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const saved=new Map<string,PropertyDescriptor|undefined>(),oldFetch=globalThis.fetch;
 for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const view=(id:ConnectionId,patch:Partial<ConnectionView>={}):ConnectionView=>({...defaultConnection(id),...connectionDefinition(id),cliInstalled:true,connected:true,enabled:true,state:'connected',relay:false,cliAuthState:'connected',...patch});
 const connections=[view('codex'),view('kimi'),view('minimax'),view('deepseek',{heavySupported:false}),view('claude',{enabled:false}),view('copilot',{connected:false}),view('qwen',{cliInstalled:false})];
 const calls:unknown[]=[],requests:string[]=[];let app:any,unmounted=false;
 try {
  const outfile=path.join(dir,'harness.mjs');await build({stdin:{contents:`import React,{act}from'react';import{createRoot}from'react-dom/client';import{GeneralFailoverCard}from'./src/general/GeneralFailoverCard';export{React,act,createRoot,GeneralFailoverCard};`,resolveDir:root,loader:'tsx'},outfile,jsx:'automatic',bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
  globalThis.fetch=(async(input:any)=>{requests.push(String(input));return Response.json({ok:true,result:{connections}})}) as typeof fetch;
  const h=await import(pathToFileURL(outfile).href);app=h.createRoot(document.getElementById('root'));
  const run={id:'failed-1',state:'failed',agent:'codex',purpose:'first',steps:[],startedAt:'2026-10-30',queued:0,error:'Codex 额度用完了'};
  const render=async(busy='')=>h.act(async()=>app.render(h.React.createElement(h.GeneralFailoverCard,{run,busy,onSwitch:(choice:unknown)=>calls.push(choice),onResume:()=>calls.push('resume')})));
  await render();
  const buttons=()=>[...document.querySelectorAll<HTMLButtonElement>('button')];
  assert.deepEqual(buttons().map(button=>button.textContent),['换 Kimi 接着做','换 MiniMax Code','稍后用 Codex 接着做']);
  assert.match(document.body.textContent!,/已完成的计划、代码和画面都保留着/);
  assert.equal(document.querySelectorAll('button.primary').length,1);
  assert.deepEqual(calls,[],'不得自动换家');
  await h.act(async()=>buttons()[0].click());assert.deepEqual(calls[0],{agent:'kimi',model:'default',effort:'medium'});
  await h.act(async()=>buttons()[1].click());assert.deepEqual(calls[1],{agent:'minimax',model:'default',effort:'medium'});
  await h.act(async()=>buttons()[2].click());assert.equal(calls[2],'resume');
  await render('switch-agent-kimi');assert.ok(buttons().every(button=>button.disabled));assert.match(document.body.textContent!,/正在接着做/);
  await render();
  await h.act(async()=>window.dispatchEvent(new CustomEvent('opentake-connections-changed',{detail:{connection:view('kimi',{connected:false,revision:2})}})));
  assert.equal(buttons()[0].textContent,'换 MiniMax Code 接着做');
  await h.act(async()=>window.dispatchEvent(new CustomEvent('opentake-connections-changed',{detail:{connection:view('minimax',{connected:false,revision:2})}})));
  assert.deepEqual(buttons().map(button=>button.textContent),['稍后用 Codex 接着做']);
  assert.match(document.body.textContent!,/还没有其他已接通且能出片/);
  assert.ok(requests.every(url=>url==='/api/editor/agent-connections'),'呈现不会调用真实换家或登录接口');
  await h.act(async()=>app.unmount());unmounted=true;
 } finally {if(app&&!unmounted)app.unmount();globalThis.fetch=oldFetch;dom.window.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete(globalThis as any)[key]}fs.rmSync(dir,{recursive:true,force:true});}
});

test('任务24第二部分：换家客户端发单个switch-agent请求，不重建工程或先改工程选择',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task24b-client-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 const oldFetch=globalThis.fetch;try{
  const outfile=path.join(dir,'client.mjs');await build({entryPoints:[path.join(root,'src/general/general-api.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',define:{'import.meta.env.DEV':'false'}});
  const requests:{url:string;method?:string;body:any}[]=[];const project={id:'film / 1',agent:{agent:'kimi',model:'default',effort:'medium'},plan:{title:'保留计划'},versions:[{n:1}]};
  globalThis.fetch=(async(input:any,init:any)=>{requests.push({url:String(input),method:init?.method,body:JSON.parse(init?.body||'null')});return Response.json({ok:true,result:project})}) as typeof fetch;
  const {generalApi}=await import(pathToFileURL(outfile).href);assert.deepEqual(await generalApi.switchAgent(project.id,project.agent),project);
  assert.deepEqual(requests,[{url:'/api/general/projects/film%20%2F%201/switch-agent',method:'POST',body:{agent:project.agent}}]);
 }finally{globalThis.fetch=oldFetch;fs.rmSync(dir,{recursive:true,force:true});}
});
