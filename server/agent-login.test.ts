import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentLoginManager,type LoginDependencies} from './agent-login.ts';
import {defaultConnection,type ConnectionId,type ConnectionView} from '../shared/agent-connections.ts';

function fixture(){
 const commands:string[]=[],queried:ConnectionId[]=[];
 let terminal='waiting',connected=false;
 const view=(id:ConnectionId):ConnectionView=>({...defaultConnection(id),id,name:id,kind:'agent',cliInstalled:true,relay:false,heavySupported:id==='codex',state:connected?'connected':'unconfigured',protocol:'chat',connected});
 const deps:LoginDependencies={platform:'darwin',assertAllowed:id=>{if(id==='claude')throw Error('开关已关闭')},detect:async()=>"/tmp/Sa's HD/kimi",status:async id=>{queried.push(id);return view(id)},refresh:async id=>{queried.push(id);return view(id)},run:async script=>{commands.push(script);return script.includes('do script')?'23:/dev/ttys023':terminal}};
 return {commands,queried,deps,setTerminal:(value:string)=>{terminal=value},setConnected:()=>{connected=true}};
}
test('登录只启动固定的本家命令，并合并重复点击；轮询只检查这一家',async()=>{
 const f=fixture(),manager=createAgentLoginManager();
 const [first,second]=await Promise.all([manager.start('kimi',f.deps),manager.start('kimi',f.deps)]);
 assert.equal(first.waiting,true);assert.equal(second.waiting,true);
 const starts=f.commands.filter(script=>script.includes('do script'));assert.equal(starts.length,1);
 assert.match(starts[0],/kimi' 'login'/);assert.doesNotMatch(starts[0],/prompt|session\/prompt|curl|install/);
 assert.equal((await manager.check('kimi',f.deps)).waiting,true);
 assert.match(f.commands.at(-1)!,/if id of w is 23 then/,'窗口与tty共同识别本次终端');
 assert.ok(f.queried.every(id=>id==='kimi'));
 f.setConnected();assert.equal((await manager.check('kimi',f.deps)).waiting,false);
});
test('终端关闭或登录命令结束时如实退出等待；取消不关闭终端',async()=>{
 for(const terminal of ['closed','finished']){
  const f=fixture(),manager=createAgentLoginManager();await manager.start('kimi',f.deps);f.setTerminal(terminal);
  const result=await manager.check('kimi',f.deps);assert.equal(result.waiting,false);assert.equal(result.connection.connected,false);
 }
 const f=fixture(),manager=createAgentLoginManager();await manager.start('kimi',f.deps);const count=f.commands.length;
 assert.equal((await manager.cancel('kimi',f.deps)).waiting,false);assert.equal(f.commands.length,count);
 assert.equal((await manager.check('kimi',f.deps)).waiting,false);assert.equal(f.commands.length,count);
});
test('Claude 关闭、未适配和缺失命令行不打开任何终端',async()=>{
 const f=fixture(),manager=createAgentLoginManager();
 await assert.rejects(manager.start('claude',f.deps),/开关已关闭/);
 await assert.rejects(manager.start('deepseek',f.deps),/待适配/);
 await assert.rejects(manager.start('kimi',{...f.deps,detect:async()=>undefined}),/先安装/);
 assert.equal(f.commands.length,0);
});
test('终端查询失败不伪造登录成功，取消能解除等待',async()=>{
 const f=fixture(),manager=createAgentLoginManager();await manager.start('kimi',f.deps);
 await assert.rejects(manager.check('kimi',{...f.deps,run:async()=>{throw Error('自动化未授权')}}),/自动化/);
 assert.equal((await manager.cancel('kimi',f.deps)).waiting,false);
});
test('取消能阻止迟到的启动响应恢复等待',async()=>{
 const f=fixture(),manager=createAgentLoginManager();let release!:(value:string)=>void;
 const started=manager.start('kimi',{...f.deps,run:()=>new Promise(resolve=>{release=resolve})});
 await new Promise(resolve=>setImmediate(resolve));await manager.cancel('kimi',f.deps);release('23:/dev/ttys023');
 assert.equal((await started).waiting,false);
});
test('旧登录检查的迟到成功不能删掉取消后新建的等待',async()=>{
 const f=fixture(),manager=createAgentLoginManager();await manager.start('kimi',f.deps);
 const view=await f.deps.status!('kimi');let release!:(value:ConnectionView)=>void;
 const oldCheck=manager.check('kimi',{...f.deps,status:()=>new Promise(resolve=>{release=resolve})});
 await manager.cancel('kimi',f.deps);await manager.start('kimi',f.deps);
 release({...view,connected:true});await oldCheck;
 assert.equal((await manager.check('kimi',f.deps)).waiting,true);
});

test('重新登录必须命令成功退出再探测；关闭、失败与取消不能解除运行时拒绝',async()=>{
 for(const exitCode of [undefined,1,0]){
  const f=fixture(),manager=createAgentLoginManager();let completed=0;
  const deps={...f.deps,exitCode:()=>exitCode,complete:async(id:ConnectionId)=>{completed++;f.setConnected();return f.deps.status!(id)}};
  await manager.start('kimi',deps);f.setTerminal('finished');
  const result=await manager.check('kimi',deps);
  assert.equal(completed,exitCode===0?1:0);assert.equal(result.connection.connected,exitCode===0);
  assert.match(f.commands[0],/printf '%s'/,'只采集退出码，不读取终端输出');
 }
 const f=fixture(),manager=createAgentLoginManager();let completed=0;
 const deps={...f.deps,exitCode:()=>0,complete:async(id:ConnectionId)=>{completed++;return f.deps.status!(id)}};
 await manager.start('kimi',deps);await manager.cancel('kimi',deps);f.setTerminal('finished');await manager.check('kimi',deps);
 assert.equal(completed,0);
});

test('登录包装只记录真实退出码，带空格引号的程序路径也能恢复并清理临时目录',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-login-wrapper-')),executable=path.join(root,"Sa's fake kimi");
 try{
  for(const code of [0,1]){
   fs.writeFileSync(executable,`#!/bin/sh\nexit ${code}\n`,{mode:0o755});
   const f=fixture(),manager=createAgentLoginManager();let completed=0,resultPath='';
   const deps:LoginDependencies={...f.deps,detect:async()=>executable,complete:async id=>{completed++;f.setConnected();return f.deps.status!(id)},run:async script=>{
    if(!script.includes('do script'))return 'finished';
    const command=JSON.parse(script.match(/set loginTab to do script ("[^\n]+")/)![1]);
    resultPath=command.match(/> '([^']+exit-code)'$/)![1];
    await promisify(execFile)('/bin/sh',['-c',command]);return '23:/dev/ttys023';
   }};
   await manager.start('kimi',deps);assert.equal(fs.readFileSync(resultPath,'utf8'),String(code));
   await manager.check('kimi',deps);assert.equal(completed,code===0?1:0);assert.equal(fs.existsSync(path.dirname(resultPath)),false);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
