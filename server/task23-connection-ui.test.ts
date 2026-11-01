import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../',import.meta.url));
test('任务23：部署与设置共享单家登录状态、仅轮询登录的Agent、关闭终端/取消回到登录、互跳带Agent编号',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task23-ui-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true}),saved=new Map<string,PropertyDescriptor|undefined>();
 const oldFetch=globalThis.fetch,oldTimeout=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
 const timers=new Map<number,()=>Promise<void>>();let timerId=90000;
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:(fn:()=>void)=>{fn();return 1},IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 let app:any;const calls:{url:string;method:string}[]=[];
 let connection:any={revision:0,id:'kimi',name:'Kimi',kind:'agent',enabled:true,mode:'cli',model:'default',models:[],baseUrl:'https://api.moonshot.cn/v1',hasKey:false,cliInstalled:true,heavySupported:false,connected:false,relay:false,state:'unconfigured',cliPath:'',protocol:'chat',cliAuthState:'needs-login',cliLoginAvailable:true};
 let waiting=false;
 const streams:{url:string;closed:boolean;send:(id:string,revision:number,type?:string)=>void}[]=[];
 class FakeEventSource extends dom.window.EventTarget {closed=false;url:string;constructor(url:string){super();this.url=url;streams.push(this)}close(){this.closed=true}send(id:string,revision:number,type='credentials-rejected'){this.dispatchEvent(new dom.window.MessageEvent(type,{data:JSON.stringify({id,revision})}))}}
 Object.defineProperty(dom.window,'EventSource',{value:FakeEventSource,configurable:true});
 let delayedList:((value:Response)=>void)|undefined;let delayList=false;
 let delayedRecheck:((value:Response)=>void)|undefined;let delayRecheck=false;
 try{
  const outfile=path.join(dir,'harness.mjs');await build({stdin:{contents:`import React,{act} from 'react';import{createRoot}from'react-dom/client';import{ConnectionList}from'./src/studio/components/ConnectionSettings';import{ConnectionActions}from'./src/studio/components/ConnectionActions';import{useConnections}from'./src/studio/connection-store';export * from './src/studio/connection-store';export{openSettings}from'./src/onboarding/onboarding-store';export{act,createRoot};export function Harness(){const state=useConnections();return <><aside>{state.connections.map(connection=><ConnectionActions key={connection.id} compact connection={connection} onConfigure={()=>{}}/>)}</aside><ConnectionList initialAgent="kimi"/></>}`,resolveDir:root,loader:'tsx'},outfile,jsx:'automatic',bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent',plugins:[{name:'dialog',setup(b){b.onResolve({filter:/components\/ui\/dialog$/},()=>({path:'dialog',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:root,loader:'tsx',contents:`export const Dialog=({open,children})=>open?<div role="dialog">{children}</div>:null;export const DialogContent=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;`}))}}]});
  const h=await import(pathToFileURL(outfile).href);
  globalThis.setTimeout=((fn:any,delay:number,...args:any[])=>{if(delay===4000){const id=timerId++;timers.set(id,fn);return id}return oldTimeout(fn,delay,...args)}) as any;
  globalThis.clearTimeout=((id:any)=>{if(timers.has(id)){timers.delete(id);return}oldClear(id)}) as any;
  globalThis.fetch=(async(input:any,init:any={})=>{const url=String(input),method=init.method||'GET';calls.push({url,method});if(url.endsWith('/login')){if(method==='POST')waiting=true;if(method==='DELETE')waiting=false;return Response.json({ok:true,result:{waiting,connection}})}if(delayRecheck&&url.endsWith('/recheck'))return new Promise<Response>(resolve=>{delayedRecheck=resolve});if(url.endsWith('/recheck')||url.endsWith('/agent-connections/kimi'))return Response.json({ok:true,result:connection});if(delayList)return new Promise<Response>(resolve=>{delayedList=resolve});return Response.json({ok:true,result:{connections:[connection]}})}) as typeof fetch;
  app=h.createRoot(document.getElementById('root'));await h.act(async()=>app.render((await import('react')).createElement(h.Harness)));
  assert.ok(document.querySelector('#connection-kimi-cli'),'指定Agent自动展开');
  const click=async(label:string,scope:ParentNode=document)=>{const button=[...scope.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label);assert.ok(button,label);await h.act(async()=>{button.click()})};
  const poll=async()=>{assert.equal(timers.size,1);const [id,fn]=[...timers][0];timers.delete(id);await h.act(async()=>{await fn()})};
  await click('登录',document.querySelector('aside')!);assert.equal(document.querySelectorAll('.connection-wait-copy').length>=2,true,'两处立即同步等待');assert.equal(calls.filter(c=>c.method==='POST').length,1);
  const count=calls.length;await poll();assert.deepEqual(calls.slice(count),[{url:'/api/editor/agent-connections/kimi/login',method:'GET'}],'轮询不能启动其他Agent');
  waiting=false;await poll();assert.match(document.querySelector('aside')!.textContent!,/登录/);assert.equal(timers.size,0,'终端关闭后停止轮询');
  await click('登录',document.querySelector('aside')!);await click('取消',document.querySelector('aside')!);assert.equal(timers.size,0,'取消清除轮询');assert.ok(calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/kimi/login')));
  await click('登录',document.querySelector('aside')!);connection={...connection,connected:true,state:'connected',cliAuthState:'connected'};waiting=false;await poll();assert.match(document.querySelector('aside')!.textContent!,/已接通/);assert.match(document.querySelector('.connection-pill')!.textContent!,/已接通/);assert.equal(timers.size,0);
  assert.equal(streams.length,1,'部署与设置共享一个实时连接');
  delayList=true;let staleRefresh:Promise<void>;await h.act(async()=>{staleRefresh=h.refreshConnections()});
  delayRecheck=true;let staleRecheck:Promise<void>;await h.act(async()=>{staleRecheck=h.recheckConnection('kimi')});
  const staleConnection=connection;connection={...connection,revision:1,connected:false,state:'unconfigured',cliAuthState:'needs-login'};
  const rejectedAt=calls.length;await h.act(async()=>streams[0].send('kimi',1));
  assert.match(document.querySelector('aside')!.textContent!,/还没登录/);assert.ok(document.querySelector('aside .connection-login'),'部署立即恢复登录按钮');
  assert.ok(document.querySelector('.connection-row .connection-login'),'设置立即恢复登录按钮');
  assert.deepEqual(calls.slice(rejectedAt),[{url:'/api/editor/agent-connections/kimi',method:'GET'}],'运行时拒绝只刷新这一家，不重新探测所有Agent');
  await h.act(async()=>{delayedList!(Response.json({ok:true,result:{connections:[staleConnection]}}));await staleRefresh!});delayList=false;
  assert.match(document.querySelector('.connection-pill')!.textContent!,/还没登录/,'较早发出的已接通列表不能覆盖运行时拒绝');
  await h.act(async()=>{delayedRecheck!(Response.json({ok:true,result:staleConnection}));await staleRecheck!});delayRecheck=false;
  assert.ok(document.querySelector('aside .connection-login'),'迟到的单家重新检查也不能恢复旧的已接通');
  await h.act(async()=>h.acceptConnection(staleConnection));assert.ok(document.querySelector('.connection-row .connection-login'),'设置保存/测试迟到的旧revision统一丢弃');
  connection={...connection,revision:2,connected:true,state:'connected',cliAuthState:'connected'};
  await h.act(async()=>streams[0].send('kimi',2,'connection-changed'));
  assert.match(document.querySelector('.connection-pill')!.textContent!,/已接通/,'另一窗口重新登录成功后，本窗口不用重开也恢复');
  assert.match(document.querySelector('aside')!.textContent!,/已接通/);
  await h.act(async()=>streams[0].send('kimi',1));assert.equal(document.querySelector('aside .connection-login'),null,'迟到的旧拒绝事件不能覆盖重新登录');
  connection={...connection,revision:3,connected:false,state:'unconfigured',cliAuthState:'needs-login'};await h.act(async()=>streams[0].send('kimi',3));
  await click('登录',document.querySelector('aside')!);connection={...connection,revision:4,connected:true,state:'connected',cliAuthState:'connected'};waiting=false;await poll();
  assert.match(document.querySelector('.connection-pill')!.textContent!,/已接通/,'本窗口重新登录成功仍恢复两处状态');
  let detail:any;window.addEventListener('opentake:open-settings',(event:any)=>{detail=event.detail},{once:true});h.openSettings('agents','kimi',true,'api');assert.deepEqual(detail,{group:'agents',agentId:'kimi',fromDeploy:true,mode:'api'});
  await h.act(async()=>app.unmount());app=null;assert.equal(streams[0].closed,true,'最后一处界面卸载关闭实时连接');
 }finally{if(app)app.unmount();globalThis.fetch=oldFetch;globalThis.setTimeout=oldTimeout;globalThis.clearTimeout=oldClear;dom.window.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete(globalThis as any)[key]}fs.rmSync(dir,{recursive:true,force:true})}
});
