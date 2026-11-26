import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';import {JSDOM} from 'jsdom';

for(const mac of [true,false])test((mac?'Mac':'Windows')+' 升级提醒、申请、审核、登录、失败与重试',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pro-notice-ui-'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(tmp,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/general/projects/qa',pretendToBeVisual:true}),saved=new Map<string,PropertyDescriptor|undefined>();
 Object.defineProperty(dom.window.navigator,'platform',{value:mac?'MacIntel':'Win32'});
 const values:Record<string,unknown>={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true};
 for(const key of ['FormData','HTMLElement','HTMLInputElement','Node','NodeFilter','Element','Event','CustomEvent','KeyboardEvent','MutationObserver'])values[key]=(dom.window as any)[key];
 values.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);values.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);values.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
 for(const[key,value]of Object.entries(values)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 const oldFetch=globalThis.fetch;const calls:string[]=[];let offline=false,loginFailed=false,downloadError='',app:any;
 let account:any=null;
 const person={name:'测试用户',username:'fixture@example.test',purpose:'测试',createdAt:1,proStatus:'pending'};
 const upgrade={mode:'beta',notice:'可以升级 Pro'};
 Object.defineProperty(dom.window,'standardDesktop',{value:{downloadPro:async()=>downloadError?{error:downloadError}:{ok:true}}});
 globalThis.fetch=(async(input:any,opts:any)=>{
  const route=String(input).replace('/api/upgrade/','');calls.push(route);
  if(offline)throw Error('offline');
  if(route==='windows/daily')return Response.json({clientUpdate:{available:false}});
  if(route==='apply'||route==='login'){
   assert.ok(JSON.parse(opts.body).password);
   if(loginFailed)return Response.json({error:'账号或密码不正确'},{status:401});
   account={...person,proStatus:route==='login'?'approved':'pending'};
   return Response.json(account);
  }
  if(route==='logout'){account=null;return Response.json({ok:true})}
  return Response.json({upgrade,account,remind:route==='daily',...(!mac?{}:{clientUpdate:{available:false}})});
 }) as typeof fetch;
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
  const dialog=()=>{const all=document.querySelectorAll<HTMLElement>('[role="dialog"]');assert.equal(all.length,1);return all[0]};
  const submit=async()=>{const form=dialog().querySelector('form')!;
   for(const input of form.querySelectorAll('input'))if(input.name!=='website')input.value=input.name==='password'?'fixture-only-123':input.name==='contact'?person.username:person.name;
   await h.act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait()});
  };
  app=h.createRoot(document.getElementById('root'));await h.act(async()=>{app.render(React.createElement(h.Harness));await wait()});
  assert.equal(document.querySelector('.upgrade-dot')?.parentElement?.title,'可以升级 Pro');
  assert.equal(calls.includes('windows/daily'),!mac);
  await click('预览 Pro 风格');await click('升级到 Pro',dialog());
  assert.match(dialog().textContent||'',/申请 OpenTake Pro/);await submit();assert.match(dialog().textContent||'',/已提交，正在排队/);
  for(const [status,label] of [['rejected','未通过'],['ended','已到期'],['approved','下载 OpenTake Pro']]){
   account={...person,proStatus:status};await click('刷新状态');assert.ok(dialog().textContent?.includes(label));
  }
  assert.equal(dialog().textContent?.includes('第一次打开系统会提示未知发布者'),!mac);
  for(const reason of ['Windows 安装包暂未提供','下载链接已经过期']){
   downloadError=reason;await click(dialog().querySelector('button.primary')!.textContent!);
   assert.equal(dialog().querySelector('[role="alert"]')?.textContent,reason);
  }
  downloadError='';await click('重试下载 OpenTake Pro');assert.match(dialog().textContent||'',/已在系统浏览器/);
  await click('退出登录');await click('已经申请过？登录');
  loginFailed=true;await submit();assert.equal(dialog().querySelector('[role="alert"]')?.textContent,'账号或密码不正确');
  loginFailed=false;await submit();assert.match(dialog().textContent||'',/选上了/);
  offline=true;await click('刷新状态');assert.match(dialog().querySelector('[role="alert"]')?.textContent||'',/检查网络/);
  await click('关闭');assert.equal(document.querySelector('[role="dialog"]'),null);
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
