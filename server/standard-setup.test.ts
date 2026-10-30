import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Public installation script intentionally runs before dependencies exist.
import {validateHost, installPlan} from '../scripts/setup.mjs';
const good={platform:'darwin',arch:'arm64',node:'24.15.0',mac:'14.0',freeBytes:12*1024**3};
test('安装前挡住不支持的系统、芯片、Node 和磁盘',()=>{
 assert.doesNotThrow(()=>validateHost(good));
 for(const change of [{platform:'win32'},{arch:'x64'},{node:'24.14.0'},{node:'25.0.0'},{mac:'11.7'},{mac:''},{freeBytes:1024}])assert.throws(()=>validateHost({...good,...change}));
});
test('两份锁定安装不能漏掉录屏依赖，不执行其原生安装脚本',()=>{
 assert.deepEqual(installPlan().map((p:{cwd:string})=>p.cwd),['.','vendor/openscreen']);
 assert.deepEqual(installPlan()[1].args,['ci','--ignore-scripts','--no-audit','--no-fund']);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore Script is dependency-free JavaScript by design.
import {setup} from '../scripts/setup.mjs';
test('重复安装检查依赖树，失败不写成功回执，重试可继续',async()=>{
 if(process.platform!=='darwin'||process.arch!=='arm64')return;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-setup-test-'));
 try{
  for(const dir of [root,path.join(root,'vendor/openscreen')]){
   fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),'{}');fs.writeFileSync(path.join(dir,'package-lock.json'),'{}');
  }
  const venv=path.join(root,'python'),calls:string[]=[];let broken=false,failInstall=true;
  const run=(command:string,args:string[],extra:{cwd?:string}={})=>{
   calls.push(command+' '+args.join(' '));
   if(command==='/usr/bin/sw_vers')return {status:0,stdout:'14.0'};
   if(args[0]==='ls')return {status:broken?1:0};
   if(command==='npm'&&args[0]==='ci'){
    if(failInstall)return {status:1};
    fs.mkdirSync(path.join(extra.cwd||root,'node_modules'),{recursive:true});
   }
   if(command==='python3'&&args[1]==='venv'){fs.mkdirSync(path.join(venv,'bin'),{recursive:true});fs.writeFileSync(path.join(venv,'bin/python3'),'fixture');}
   return {status:0,stdout:''};
  };
  const options={root,env:{...process.env,OPENTAKE_SETUP_VENV:venv},run,log:()=>{},media:{doctor:()=>({ok:true})},screenCheck:async()=>({state:'opt',text:'未安装'})};
  await assert.rejects(setup(options),/根目录依赖失败/);
  assert.equal(fs.existsSync(path.join(root,'.setup-state.json')),false);
  failInstall=false;await setup(options);
  assert.equal(calls.filter(s=>s.startsWith('npm ci')).length,3);
  calls.length=0;await setup(options);
  assert.equal(calls.some(s=>s.startsWith('npm ci')),false,'完整依赖应复用');
  broken=true;await setup(options);
  assert.equal(calls.filter(s=>s.startsWith('npm ci')).length,2,'依赖损坏须重装两份');
  await assert.rejects(setup({...options,media:{doctor:()=>({ok:false})}}),/FFmpeg/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
