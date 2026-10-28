import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';import {JSDOM} from 'jsdom';

test('缺项保留文案、亮紫提示、重查通过才建工程和开始；双击只检查一次',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'creation-ui-'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(tmp,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const saved=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){
  saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 }
 const oldFetch=globalThis.fetch;const calls:string[]=[];let missing='python';let createdText='';
 globalThis.fetch=(async(input:any,init:any)=>{
  const url=String(input);calls.push(url);
  if(url==='/api/environment')return Response.json({ok:!missing,checkedAt:'test',items:missing?[{id:missing,label:missing,ok:false,message:'缺少依赖',install:'安装后重新检查'}]:[]});
  if(url==='/api/general/projects'){createdText=JSON.parse(init.body).inputs.text;return Response.json({ok:true,result:{id:'fixture',inputs:{media:[]}}})}
  if(url.endsWith('/generate'))return Response.json({ok:true,result:{id:'fixture'}});
  throw Error('意外请求：'+url);
 }) as typeof fetch;
 let app:any;
 try{
  const outfile=path.join(tmp,'harness.mjs');
  await build({stdin:{contents:`
   import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router';
   import {useGeneralStart} from './src/general/general-start';import {EnvironmentResults} from './src/standard/EnvironmentResults';
   export {act,createRoot};
   function Form(){const {start,environment,busy}=useGeneralStart();return <><textarea defaultValue="勾股定理，讲解一下原理"/><button disabled={!!busy} onClick={()=>start({styleId:'whiteboard',kind:'topic',text:document.querySelector('textarea').value,note:'',settings:{aspect:'16:9',length:15},files:[]})}>{environment&&!environment.ok?'重新检查':'开始生成'}</button>{environment&&!environment.ok&&<EnvironmentResults value={environment}/>}</>}
   export const element=<MemoryRouter><Form/></MemoryRouter>;
  `,resolveDir:root,loader:'tsx'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
  const h=await import(pathToFileURL(outfile).href);app=h.createRoot(document.getElementById('root'));
  await h.act(async()=>app.render(h.element));
  for(const id of ['python','chromium','ffmpeg']){
   missing=id;const before=calls.length;
   await h.act(async()=>{document.querySelector('button')!.click();document.querySelector('button')!.click();await new Promise(r=>setTimeout(r,20));});
   assert.equal(calls.length,before+1);assert.equal(document.querySelector('button')!.textContent,'重新检查');
   assert.equal(document.querySelector('textarea')!.value,'勾股定理，讲解一下原理');
   assert.match(document.body.textContent||'',/安装后重新检查/);
   assert.ok([...document.querySelectorAll('div')].some(el=>el.style.color==='rgb(152, 105, 220)'));
   assert.equal(calls.some(c=>c.includes('/projects')),false);
  }
  missing='';await h.act(async()=>{document.querySelector('button')!.click();await new Promise(r=>setTimeout(r,30));});
  assert.equal(createdText,'勾股定理，讲解一下原理');assert.equal(calls.filter(c=>c.endsWith('/generate')).length,1);
  await h.act(async()=>app.unmount());app=null;
 }finally{
  if(app)app.unmount();globalThis.fetch=oldFetch;dom.window.close();
  for(const [key,value] of saved){if(value)Object.defineProperty(globalThis,key,value);else delete (globalThis as any)[key]}
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});
