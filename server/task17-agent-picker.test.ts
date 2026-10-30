import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../',import.meta.url));
for (const platform of ['MacIntel','Win32']) test(`任务17：${platform} 工程选择器保留平台接入边界`,async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'task17-picker-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0)})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 Object.defineProperty(dom.window.navigator,'platform',{value:platform,configurable:true});
 const oldFetch=globalThis.fetch;let app:any,claudeEnabled=true,connectionRequests=0;const picked:unknown[]=[];
 try {
  const outfile=path.join(temp,'harness.mjs');await build({stdin:{contents:`import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {AgentPicker} from './src/general/AgentPicker';import {defaultAgentSettings} from './src/studio/agent-settings';export {act,createRoot,defaultAgentSettings};export const picker=(onChange)=><AgentPicker onChange={onChange}/>;`,resolveDir:root,loader:'tsx'},outfile,jsx:'automatic',bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
  const h=await import(pathToFileURL(outfile).href);const settings=h.defaultAgentSettings();
  globalThis.fetch=(async(input:any)=>{const url=String(input);let result:unknown;
   if(url.endsWith('/agent-settings'))result={settings,catalog:{models:[{id:'m',name:'模型M',efforts:['medium'],defaultEffort:'medium',isDefault:true}]},runs:[]};
   else if(url.endsWith('/agent-connections')){connectionRequests++;result={connections:[
    {id:'codex',name:'Codex',kind:'agent',mode:'cli',connected:true,enabled:true,cliInstalled:true,heavySupported:true,models:[]},
    {id:'claude',name:'Claude Code',kind:'agent',mode:'api',connected:true,enabled:claudeEnabled,cliInstalled:true,heavySupported:true,models:[]},
    {id:'kimi',name:'Kimi',kind:'agent',mode:'api',connected:true,enabled:true,cliInstalled:false,heavySupported:false,models:[]},
    {id:'deepseek',name:'DeepSeek',kind:'agent',mode:'api',connected:false,enabled:true,cliInstalled:false,heavySupported:false,models:[]},
   ]};}else throw Error('意外请求 '+url);
   return Response.json({ok:true,result});}) as typeof fetch;
  app=h.createRoot(document.getElementById('root'));await h.act(async()=>{app.render(h.picker((next:unknown)=>picked.push(next)));await new Promise(r=>setTimeout(r,5))});
  await h.act(async()=>{(document.querySelector('button') as HTMLButtonElement).click();await new Promise(r=>setTimeout(r,5))});
  if(platform==='Win32'){
   assert.equal(connectionRequests,0,'Windows must not call its unavailable connections endpoint');
   assert.doesNotMatch(document.body.textContent||'',/已接通的智能体|Claude Code|Kimi|接入读取失败/);
   const model=[...document.querySelectorAll('button')].find(b=>b.textContent==='模型M');assert.ok(model);assert.equal(model.disabled,false);
   await h.act(async()=>model.click());assert.deepEqual(picked.at(-1),{model:'m',effort:'medium'},'legacy project choice has no new Agent field');
   const standard=[...document.querySelectorAll('button')].find(b=>b.textContent?.startsWith('系统默认')&&b.className==='ge-model-opt');assert.ok(standard);assert.equal(standard.disabled,false);
   await h.act(async()=>standard.click());assert.equal(picked.at(-1),undefined);
  }else{
  assert.match(document.body.textContent||'',/Claude Code/);assert.doesNotMatch(document.body.textContent||'',/DeepSeek/);
  const kimi=[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Kimi'));assert.equal(kimi?.disabled,true);assert.match(kimi?.textContent||'',/仅轻活/);
  const claude=[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Claude Code'));assert.ok(claude);await h.act(async()=>claude.click());assert.deepEqual(picked.at(-1),{agent:'claude',model:'default',effort:'medium'});
  claudeEnabled=false;await h.act(async()=>{window.dispatchEvent(new dom.window.Event('opentake-connections-changed'));await new Promise(r=>setTimeout(r,5))});assert.doesNotMatch(document.body.textContent||'',/Claude Code/);
  assert.ok(connectionRequests>0);
  }
  await h.act(async()=>app.unmount());app=null;
 }finally{if(app)app.unmount();globalThis.fetch=oldFetch;dom.window.close();for(const [key,value] of saved){if(value)Object.defineProperty(globalThis,key,value);else delete (globalThis as any)[key]}fs.rmSync(temp,{recursive:true,force:true});}
});
