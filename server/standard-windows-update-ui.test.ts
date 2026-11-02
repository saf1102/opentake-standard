import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';import {JSDOM} from 'jsdom';
test('Windows update controls use the installer feed and expose only a manual download; offline checks clear the link',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'windows-update-ui-'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(tmp,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true}),saved=new Map<string,PropertyDescriptor|undefined>();
 const values:Record<string,unknown>={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true};
 for(const key of ['HTMLElement','HTMLInputElement','Node','NodeFilter','Element','Event','CustomEvent','KeyboardEvent','MutationObserver'])values[key]=(dom.window as any)[key];
 values.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);values.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);values.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
 for(const[key,value]of Object.entries(values)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 const oldFetch=globalThis.fetch;const calls:string[]=[];let app:any;
 const release={version:'1.1.0',windowsBuild:2026110302,notes:'测试修订',sha256:'ab'.repeat(32),size:123456,url:'https://github.com/steven90s/opentake-standard/releases/download/windows-v1.1.0-2026110302/OpenTake-Standard-Setup-1.1.0-x64.exe'};
 let next:any={currentVersion:'1.1.0',currentBuild:2026110301,release,available:true,notify:true};
 globalThis.fetch=(async(input:any,init:any)=>{calls.push(String(input));assert.ok(String(input).startsWith('/api/upgrade/windows/'));const route=String(input).split('/').at(-1);return Response.json(route==='preferences'?{daily:init?.body?JSON.parse(init.body).daily:true}:route==='state'?{clientUpdate:next}:route==='dismiss'?{...next,notify:false}:next)}) as typeof fetch;
 try{
  const outfile=path.join(tmp,'harness.mjs');
  await build({stdin:{contents:`import React,{act} from 'react';import{createRoot}from'react-dom/client';import{AboutUpdate,ClientUpdate,UpdateReminder}from'./src/standard/ClientUpdate';export{act,createRoot};export function Harness(){return <><AboutUpdate/><ClientUpdate/><UpdateReminder/></>}`,resolveDir:root,loader:'tsx'},outfile,jsx:'automatic',bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent'});
  const h=await import(pathToFileURL(outfile).href),React=await import('react');const wait=()=>new Promise(resolve=>setTimeout(resolve,20));
  const click=async(label:string)=>{const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label);assert.ok(button,label);await h.act(async()=>{button.click();await wait()})};
  app=h.createRoot(document.getElementById('root'));await h.act(async()=>{app.render(React.createElement(h.Harness));await wait()});
  await click('检查更新');const link=document.querySelector<HTMLAnchorElement>('[role="dialog"] a');assert.ok(link);assert.equal(link.href,release.url);assert.equal(link.target,'_blank');assert.equal(link.rel,'noreferrer');assert.doesNotMatch(document.querySelector('[role="dialog"]')!.textContent!,/交给智能体|一键更新|下载新版源码/);
  await click('跳过这个版本');assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(document.querySelector('.standard-update-remind'),null);
  next={...next,release:null,available:false,notify:false,offline:true,message:'Windows 更新源尚未发布，请稍后再试。'};await click('检查更新');assert.match(document.querySelector('[role="status"]')!.textContent!,/尚未发布/);assert.doesNotMatch(document.body.textContent!,/已是最新/);
  await click('查看 ›');assert.equal(document.querySelector('[role="dialog"] a'),null);assert.match(document.querySelector('[role="dialog"]')!.textContent!,/尚未发布/);
  assert.ok(calls.includes('/api/upgrade/windows/dismiss'));
 }finally{if(app)await (await import('react')).act(async()=>app.unmount());await new Promise(resolve=>setTimeout(resolve,0));globalThis.fetch=oldFetch;dom.window.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete(globalThis as any)[key]}fs.rmSync(tmp,{recursive:true,force:true})}
});
