import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../',import.meta.url));
test('统一接入界面：Claude风险确认推荐API、代理提醒不挡测试、只显示真实连接结果',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task17-connection-ui-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}const oldFetch=globalThis.fetch;let app:any;const calls:{url:string;body:any}[]=[];
 try{
  const outfile=path.join(dir,'harness.mjs');await build({stdin:{contents:`import React,{act,useState} from 'react';import {createRoot} from 'react-dom/client';import {ConnectionList,ConnectionEditor} from './src/studio/components/ConnectionSettings';export {act,createRoot,ConnectionList,ConnectionEditor};export function Harness(){const [connection,setConnection]=useState({id:'claude',name:'Claude Code',kind:'agent',enabled:false,mode:'cli',model:'default',models:[],baseUrl:'https://relay.example/v1',hasKey:true,cliInstalled:true,heavySupported:true,connected:false,relay:true,state:'disabled',cliPath:'',protocol:'anthropic'});return <ConnectionEditor connection={connection} onChanged={setConnection}/>}`,resolveDir:root,loader:'tsx'},outfile,jsx:'automatic',bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));b.onResolve({filter:/components\/ui\/dialog$/},()=>({path:'dialog',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:root,loader:'tsx',contents:`export const Dialog=({open,children})=>open?<div role="dialog">{children}</div>:null;export const DialogContent=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;`}))}}]});
  const h=await import(pathToFileURL(outfile).href);let state:any={id:'claude',name:'Claude Code',kind:'agent',enabled:false,mode:'cli',model:'default',models:[],baseUrl:'https://relay.example/v1',hasKey:true,cliInstalled:true,heavySupported:true,connected:false,relay:true,state:'disabled',cliPath:'',protocol:'anthropic'};
  globalThis.fetch=(async(input:any,init:any={})=>{const url=String(input),body=init.body?JSON.parse(init.body):undefined;calls.push({url,body});if(init.method==='PUT'){state={...state,...body};return Response.json({ok:true,result:state})}if(url.endsWith('/test')){state={...state,connected:true,state:'connected',message:'连接正常；未运行生成任务'};return Response.json({ok:true,result:{ok:true,connection:state}})}throw Error('unexpected')}) as typeof fetch;
  app=h.createRoot(document.getElementById('root'));const click=async(label:string)=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent?.trim()===label);assert.ok(button,label);await h.act(async()=>{button.click();await new Promise(resolve=>setTimeout(resolve,2))})};
  await h.act(async()=>app.render((await import('react')).createElement(h.Harness)));await h.act(async()=>{(document.querySelector('[role="switch"]') as HTMLInputElement).click()});assert.match(document.body.textContent||'',/有封号风险/);assert.equal(calls.length,0);assert.equal((document.querySelector('[role="switch"]') as HTMLInputElement).checked,false);await click('取消');assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal((document.querySelector('[role="switch"]') as HTMLInputElement).checked,false);assert.equal(calls.length,0,'取消不得提交开启');await h.act(async()=>{(document.querySelector('[role="switch"]') as HTMLInputElement).click()});assert.ok(document.querySelector('[role="dialog"]'));await click('改用 API 密钥');assert.equal((document.querySelector('[role="switch"]') as HTMLInputElement).checked,true);assert.ok(document.querySelector('#connection-claude-url'));assert.ok(calls.some(c=>c.body.mode==='api'&&c.body.enabled===true));assert.ok(!calls.some(c=>c.body?.confirmSubscriptionRisk));assert.match(document.body.textContent||'',/中转站/);const testButton=[...document.querySelectorAll('button')].find(b=>b.textContent==='测试连接');assert.ok(testButton);assert.equal(testButton.disabled,false);await click('测试连接');assert.match(document.body.textContent||'',/连接正常/);const {CONNECTION_DEFINITIONS,defaultConnection}=await import('../shared/agent-connections.ts');
  for(const d of CONNECTION_DEFINITIONS.filter(d=>d.kind==='agent')){
   const view={...defaultConnection(d.id),...d,mode:'api',enabled:true,cliInstalled:false,connected:false};
   await h.act(async()=>app.render((await import('react')).createElement(h.ConnectionEditor,{key:d.id,connection:view,onChanged:()=>{}})));
   assert.equal(document.body.textContent!.includes('只能做轻活，出片要先装好命令行'),d.id!=='builtin'&&!d.apiReason,d.name);
   if(d.id==='builtin'){
    const style=document.createElement('style');style.textContent=fs.readFileSync(path.join(root,'src/studio/components/connection-settings.css'),'utf8');document.head.append(style);
    for(const theme of ['original','warm']){
     document.documentElement.dataset.uiTheme=theme;
     const primary=document.querySelector('.connection-builtin-primary')!;
     assert.equal(primary.textContent,'测试连接');assert.equal(dom.window.getComputedStyle(primary).backgroundColor,'rgb(245, 179, 22)');
     assert.equal(document.querySelectorAll('[aria-label="填入官方地址"] button').length,6);
     await click('Kimi（月之暗面）');
     assert.equal((document.querySelector('#connection-builtin-url') as HTMLInputElement).value,'https://api.moonshot.cn/v1');
     assert.equal((document.querySelector('#connection-builtin-model') as HTMLInputElement).value,'kimi-k3.1-pro');
     assert.equal((document.querySelector('#builtin-format') as HTMLSelectElement).options.length,4);
    }
    style.remove();
   }
   if(d.apiReason)assert.match(document.body.textContent!,/待适配/);
  }
  const view=(id:'codex'|'deepseek')=>({...defaultConnection(id),...CONNECTION_DEFINITIONS.find(d=>d.id===id),mode:'api',enabled:true,cliInstalled:true,connected:false});
  const models=['deepseek-flash','deepseek-v4-pro','chat-only'].map(id=>({id,name:id}));
  const fixtures=[{...view('codex'),baseUrl:'https://api.deepseek.com',models},view('deepseek')];
  let writes=0;globalThis.fetch=(async(_url,init)=>{if(init?.method==='PUT'||init?.method==='POST')writes++;return Response.json({ok:true,result:{connections:fixtures}})}) as typeof fetch;
  const oldFrame=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>0;
  try{
   await h.act(async()=>app.render((await import('react')).createElement(h.ConnectionList,{initialAgent:'deepseek',initialMode:'api'})));
   await click('去 Codex 填 DeepSeek 地址');
   assert.ok(document.querySelector('#connection-editor-codex'));
   assert.equal((document.querySelector('#connection-codex-url') as HTMLInputElement).value,'https://api.deepseek.com');
   const select=document.querySelector('#connection-codex-model') as HTMLSelectElement;
   assert.equal(select.value,'deepseek-flash');
   assert.equal(select.querySelector<HTMLOptionElement>('[value="chat-only"]')!.disabled,true);
   assert.equal(select.querySelector<HTMLOptionElement>('[value="deepseek-v4-pro"]')!.disabled,false);
   assert.equal(writes,0);
  }finally{if(oldFrame)globalThis.requestAnimationFrame=oldFrame;else delete (globalThis as any).requestAnimationFrame}
  await h.act(async()=>app.unmount());app=null;
 }finally{if(app)app.unmount();globalThis.fetch=oldFetch;dom.window.close();for(const [key,value] of saved){if(value)Object.defineProperty(globalThis,key,value);else delete (globalThis as any)[key]}fs.rmSync(dir,{recursive:true,force:true})}
});
