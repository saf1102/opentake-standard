import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';import {JSDOM} from 'jsdom';

test('Windows Pro notice opens immediately, keeps updates independent, and replaces the style dialog without forms',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pro-notice-ui-'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(tmp,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/general/projects/qa',pretendToBeVisual:true}),saved=new Map<string,PropertyDescriptor|undefined>();
 const values:Record<string,unknown>={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true};
 for(const key of ['HTMLElement','HTMLInputElement','Node','NodeFilter','Element','Event','CustomEvent','KeyboardEvent','MutationObserver'])values[key]=(dom.window as any)[key];
 values.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);values.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);values.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
 for(const[key,value]of Object.entries(values)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 const oldFetch=globalThis.fetch;const calls:string[]=[];let resolveDaily!:(response:Response)=>void;let offline=false;let app:any;
 globalThis.fetch=(async(input:any)=>{calls.push(String(input));if(offline)throw Error('offline');return new Promise<Response>(resolve=>{resolveDaily=resolve})}) as typeof fetch;
 try{
  const outfile=path.join(tmp,'harness.mjs');
  await build({stdin:{contents:`
   import React,{act,useState} from 'react';import{createRoot}from'react-dom/client';
   import{UpgradeDialog,UpgradeButton,openUpgrade}from'./src/standard/Upgrade';
   import{ProStyleDialog}from'./src/standard/ProStyleDialog';
   import{LIBRARY_STYLES}from'./src/workspace/style-library/library-styles';import allowed from'./src/standard/styles.json';
   export{act,createRoot,openUpgrade};
   export function Harness(){const[style,setStyle]=useState(null);return <><UpgradeDialog/><UpgradeButton/><button onClick={()=>setStyle(LIBRARY_STYLES.find(s=>!allowed.includes(s.id)).id)}>预览 Pro 风格</button><ProStyleDialog id={style} onClose={()=>setStyle(null)}/></>}
  `,resolveDir:root,loader:'tsx'},outfile,jsx:'automatic',bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent'});
  const h=await import(pathToFileURL(outfile).href),React=await import('react');
  const wait=()=>new Promise(resolve=>setTimeout(resolve,20));
  const click=async(label:string,scope:ParentNode=document)=>{const button=[...scope.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label);assert.ok(button,label);await h.act(async()=>{button.focus();button.click();await wait()});return button};
  const notice=()=>{const dialogs=[...document.querySelectorAll<HTMLElement>('[role="dialog"]')];assert.equal(dialogs.length,1);assert.match(dialogs[0].textContent||'',/OpenTake Pro 开发中/);assert.match(dialogs[0].textContent||'',/敬请期待/);assert.equal(dialogs[0].querySelector('form,input,a'),null);return dialogs[0]};
  app=h.createRoot(document.getElementById('root'));await h.act(async()=>app.render(React.createElement(h.Harness)));
  const trigger=await click('升级到 Pro');notice();assert.deepEqual(calls,['/api/upgrade/windows/daily'],'click must not wait for account or network state');
  let update:any;window.addEventListener('standard-update-state',(event:any)=>{update=event.detail},{once:true});
  await h.act(async()=>{resolveDaily(Response.json({upgrade:{mode:'paid'},account:{proStatus:'active'},clientUpdate:{currentVersion:'1.1.0',available:false}}));await wait()});
  notice();assert.equal(update.currentVersion,'1.1.0');await click('知道了');assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(document.activeElement,trigger);
  await h.act(async()=>{h.openUpgrade();h.openUpgrade();await wait()});notice();
  await h.act(async()=>{document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait()});assert.equal(document.querySelector('[role="dialog"]'),null);
  await click('预览 Pro 风格');const preview=document.querySelector<HTMLElement>('[role="dialog"]');assert.ok(preview);assert.doesNotMatch(preview.textContent||'',/开发中/);
  await click('升级到 Pro',preview);notice();await click('知道了');assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(window.location.pathname,'/general/projects/qa');assert.deepEqual(calls,['/api/upgrade/windows/daily']);
  await h.act(async()=>app.unmount());app=null;offline=true;
  app=h.createRoot(document.getElementById('root'));await h.act(async()=>{app.render(React.createElement(h.Harness));await wait()});await click('升级到 Pro');notice();assert.deepEqual(calls,['/api/upgrade/windows/daily','/api/upgrade/windows/daily']);
  await h.act(async()=>app.unmount());app=null;
 }finally{
  if(app)app.unmount();
  // Radix restores focus in a zero-delay timer on unmount; keep the DOM's Event
  // constructors alive until that cleanup has run, including when assertions fail.
  await new Promise(resolve=>setTimeout(resolve,0));
  globalThis.fetch=oldFetch;dom.window.close();
  for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete(globalThis as any)[key]}
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});
