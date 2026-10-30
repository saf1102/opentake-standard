import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import type {AddressInfo} from 'node:net';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
import {handleGeneralApi} from './general/api.ts';
import {createGeneral,findGeneral} from './general/store.ts';
import {setGeneralRuntime,stopRun,isLive} from './general/runner.ts';
import {prepareWork} from './general/kit-env.ts';
const checker=createRequire(import.meta.url)('../desktop/creation-tools.cjs');

test('generate API rejects missing tools before run or work mutation; repaired retry starts same project',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'creation-gate-')),old=process.env.LINK_READER_PROJECTS_DIR;
 process.env.LINK_READER_PROJECTS_DIR=root;
 let release!:(v:any)=>void,calls=0;const gate=new Promise<any>(r=>release=r);
 setGeneralRuntime({resolveCodex:()=>{calls++;return gate}});
 const {dir,project}=createGeneral({styleId:'whiteboard',inputs:{kind:'topic',text:'勾股定理，讲解一下原理'},settings:{aspect:'16:9',length:15}},'白板');
 fs.writeFileSync(path.join(dir,'work','keep.txt'),'原内容');
 const original=checker.doctor;
 const server=http.createServer((req,res)=>void handleGeneralApi(req,res));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/projects/${project.id}/generate`;
 try{
  for(const id of ['python','chromium','ffmpeg','codex']){
   checker.doctor=async()=>({ok:false,checkedAt:'test',items:[{id,label:id,ok:false,message:'缺少工具',install:'安装后重新检查'}]});
   const result=await fetch(url,{method:'POST'});assert.equal(result.status,412);assert.match((await result.json()).error,/安装后重新检查/);
   assert.equal(findGeneral(project.id).project.run,undefined);assert.equal(calls,0);assert.equal(fs.readFileSync(path.join(dir,'work/keep.txt'),'utf8'),'原内容');
  }
  checker.doctor=async()=>({ok:true,checkedAt:'test',items:[],tools:{python:process.execPath,chromium:process.execPath,ffmpeg:process.execPath,ffprobe:process.execPath,codex:process.execPath}});
  const result=await fetch(url,{method:'POST'});assert.equal(result.status,200);assert.equal((await result.json()).result.run.state,'running');assert.equal(calls,1);
 }finally{
  stopRun(project.id);release({executable:process.execPath,model:'test',effort:'low'});
  for(let i=0;i<100&&isLive(project.id);i++)await new Promise(r=>setImmediate(r));
  checker.doctor=original;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  if(old===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=old;
  fs.rmSync(root,{recursive:true,force:true});
 }
});

test('verified wrappers and kit use exact paths even after discovery environment changes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"pin tools ' 中文-"));
 try{
  const file=path.join(root,"chosen ' tool");fs.writeFileSync(file,'#!/bin/sh\nprintf verified\n',{mode:0o755});
  const tools={python:file,ffmpeg:file,ffprobe:file,chromium:file,codex:file};
  const env=prepareWork(root,{PATH:'/missing',LINKREADER_PYTHON:'/missing',CW_HFX_CHROME:'/missing'},false,tools);
  for(const name of ['python3','python','ffmpeg','ffprobe','chromium'])assert.equal(execFileSync(path.join(root,'work/.opentake/bin',name),[],{env,encoding:'utf8'}),'verified');
  assert.equal(env.CW_HFX_CHROME,file);assert.equal(env.CW_CHROME,file);assert.equal(env.CW_FFMPEG,file);assert.equal(env.CW_PYTHON,file);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'work/.opentake/tools.json'),'utf8')),tools);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
