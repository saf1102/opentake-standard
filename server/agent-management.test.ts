import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAgentManagement,getAgentDiagnostics,setAgentProgramPath,type AgentManagementDeps} from './agent-management.ts';
import {connectionDefinition,defaultConnection,type ConnectionId,type ConnectionView} from '../shared/agent-connections.ts';
const view=(id:ConnectionId,patch:Partial<ConnectionView>={}):ConnectionView=>({...defaultConnection(id),...connectionDefinition(id),cliInstalled:false,relay:false,state:'unconfigured',...patch});

test('程序路径先验证 --version，只返回版本号，失败不保存；诊断不启动程序',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-management-'));
 try{
  const marker=path.join(root,'ran'),file=path.join(root,'qwen');
  fs.writeFileSync(file,`#!/bin/sh\ntouch '${marker}'\n`,{mode:0o755});
  let writes=0,versions=0;
  const deps:AgentManagementDeps={assertAllowed:()=>{},version:async executable=>{versions++;assert.equal(executable,file);return 'qwen 1.2.3 private@example.com'},save:async(id,input)=>{writes++;return view(id,{cliPath:input.cliPath})}};
  const result=await setAgentProgramPath('qwen',file,deps);
  assert.equal(result.version,'1.2.3');assert.doesNotMatch(JSON.stringify(result),/private@example/);assert.equal(writes,1);assert.equal(versions,1);
  await assert.rejects(setAgentProgramPath('qwen',file,{...deps,version:async()=>{throw Error('TOKEN must not leak')}}),/未能回答 --version/);assert.equal(writes,1);
  await assert.rejects(setAgentProgramPath('qwen','relative/qwen',deps),/完整绝对路径/);
  const diagnostics=getAgentDiagnostics('qwen',{home:root,env:{PATH:root},configured:file});
  assert.deepEqual(diagnostics.candidates,[{path:file,status:'executable'}]);assert.equal(fs.existsSync(marker),false);
  const claude=path.join(root,'claude');fs.writeFileSync(claude,'#!/bin/sh\n',{mode:0o755});
  await assert.rejects(setAgentProgramPath('qwen',claude,deps),/Claude Code/);assert.equal(versions,1);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('管理入口守住 Claude 关闭门禁，终端和版本命令一个都不启动',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-management-off-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 try{
  let calls=0;const deps:AgentManagementDeps={terminal:async()=>{calls++;return ''},version:async()=>{calls++;return '1.2.3'}};
  await assert.rejects(setAgentProgramPath('claude','/unused',deps),/开关已关闭/);
  const manager=createAgentManagement();await assert.rejects(manager.start('claude','logout',{},deps),/开关已关闭/);
  assert.equal(calls,0);
 }finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true})}
});

test('安装仅发送核实过的固定命令，结束自动刷新本家；重复/取消与超时不冒充成功',async()=>{
 const manager=createAgentManagement(),refreshed:ConnectionId[]=[],scripts:string[]=[];
 let terminalState='waiting',now=100;
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>undefined,pollMs:60000,now:()=>now,timeoutMs:1000,
  terminal:async script=>{scripts.push(script);return script.includes('do script')?'12:/dev/ttys007':terminalState},
  refresh:async id=>{refreshed.push(id);return view(id,{cliInstalled:true})}};
 const command=connectionDefinition('qwen').installCommand!;
 await assert.rejects(manager.start('qwen','install',{command:command+'; echo injected'},deps),/未经确认/);assert.equal(scripts.length,0);
 assert.equal((await manager.start('qwen','install',{command},deps)).state,'waiting');
 assert.match(scripts[0],/npm install -g @qwen-code\/qwen-code@latest/);
 await assert.rejects(manager.start('qwen','install',{command},deps),/操作未结束/);
 assert.equal((await manager.check('qwen')).state,'waiting');assert.deepEqual(refreshed,[]);
 terminalState='finished';assert.equal((await manager.check('qwen')).state,'complete');assert.deepEqual(refreshed,['qwen']);
 await manager.start('qwen','install',{command},deps);assert.equal(manager.cancel('qwen').state,'cancelled');assert.equal((await manager.check('qwen')).state,'cancelled');
 await manager.start('qwen','install',{command},deps);now=1200;assert.equal((await manager.check('qwen')).state,'failed');assert.deepEqual(refreshed,['qwen']);
});

test('退出只运行本家固定参数；关闭终端但仍登录不报告成功，取消不关闭用户终端',async()=>{
 const manager=createAgentManagement(),scripts:string[]=[];
 let loggedIn=true;
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>'/fixture/cursor agent',pollMs:60000,
  terminal:async script=>{scripts.push(script);return script.includes('do script')?'15:/dev/ttys008':'closed'},
  refresh:async id=>view(id,{cliInstalled:true,connected:loggedIn,cliAuthState:loggedIn?'connected':'needs-login'})};
 await assert.rejects(manager.start('kimi','logout',{},deps),/退出登录待适配/);assert.equal(scripts.length,0);
 await manager.start('cursor','logout',{},deps);assert.match(scripts[0],/'\/fixture\/cursor agent' 'logout'/);
 assert.equal((await manager.check('cursor')).state,'failed');
 loggedIn=false;await manager.start('cursor','logout',{},deps);assert.equal((await manager.check('cursor')).state,'complete');
 await manager.start('cursor','logout',{},deps);const count=scripts.length;manager.cancel('cursor');assert.equal(scripts.length,count);
});

test('换账号必须成功退出后关闭本家会话再登录；失败与取消不越过顺序',async()=>{
 const manager=createAgentManagement(),order:string[]=[];let code:number|undefined,terminalState='waiting',connected=false;
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>'/fixture/cursor',pollMs:60000,
  terminal:async script=>script.includes('do script')?'17:/dev/ttys009':terminalState,exitCode:()=>code,
  rejectCredentials:id=>{order.push(`reject:${id}`)},closeSessions:async id=>{order.push(`close:${id}`)},
  loginStart:async id=>{order.push(`login:${id}`);return {waiting:true,connection:view(id,{cliInstalled:true,connected:false})}},
  loginCheck:async id=>({waiting:!connected,connection:view(id,{cliInstalled:true,connected})}),loginCancel:async()=>{order.push('cancel-login')},
  refresh:async id=>view(id,{cliInstalled:true})};
 await manager.start('cursor','switch-account',{},deps);assert.equal((await manager.check('cursor')).phase,'logout');assert.deepEqual(order,['reject:cursor']);
 terminalState='closed';assert.equal((await manager.check('cursor')).state,'failed');assert.deepEqual(order,['reject:cursor']);order.length=0;
 code=0;await manager.start('cursor','switch-account',{},deps);assert.equal((await manager.check('cursor')).phase,'login');assert.deepEqual(order,['reject:cursor','close:cursor','login:cursor']);
 assert.equal((await manager.check('cursor')).state,'waiting');connected=true;assert.equal((await manager.check('cursor')).state,'complete');
 connected=false;await manager.start('cursor','switch-account',{},deps);await manager.check('cursor');manager.cancel('cursor');assert.equal(order.at(-1),'cancel-login');assert.equal((await manager.check('cursor')).state,'cancelled');
});

test('升级仅接受本家官方固定命令，退出码为0且版本复查达标才成功',async()=>{
 const manager=createAgentManagement();let code=1,old=true,refreshes=0;const scripts:string[]=[];
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>'/fixture/qwen',pollMs:60000,exitCode:()=>code,
 terminal:async script=>{scripts.push(script);return script.includes('do script')?'18:/dev/ttys010':'finished'},
 refresh:async id=>{refreshes++;return view(id,{cliInstalled:true,cliVersion:old?'0.6.0':'0.6.1',filmOutdated:old})}};
 const command=connectionDefinition('qwen').upgradeCommand!;
 await assert.rejects(manager.start('qwen','upgrade',{command:command+'; false'},deps),/未经确认/);assert.equal(scripts.length,0);
 await manager.start('qwen','upgrade',{command},deps);assert.equal((await manager.check('qwen')).state,'failed');assert.equal(refreshes,0);
 code=0;await manager.start('qwen','upgrade',{command},deps);assert.equal((await manager.check('qwen')).state,'failed');assert.equal(refreshes,1);
 old=false;await manager.start('qwen','upgrade',{command},deps);assert.equal((await manager.check('qwen')).state,'complete');assert.equal(refreshes,2);
});

test('取消后旧检查迟到失败不能解锁新换账号；登录超时会清掉登录等待',async()=>{
 const {assertAgentWorkAllowed}=await import('./agent-connections.ts');
 const manager=createAgentManagement();let rejectClose:(error:Error)=>void=()=>{};let hold=true,now=0,cancels=0;
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>'/fixture/cursor',pollMs:60000,now:()=>now,timeoutMs:100,
  terminal:async script=>script.includes('do script')?'19:/dev/ttys011':'finished',exitCode:()=>0,rejectCredentials:()=>{},
  closeSessions:async()=>{if(hold)await new Promise<void>((_resolve,reject)=>{rejectClose=reject})},
  loginStart:async id=>({waiting:true,connection:view(id)}),loginCheck:async id=>({waiting:true,connection:view(id)}),loginCancel:async()=>{cancels++}};
 await manager.start('cursor','switch-account',{},deps);const old=manager.check('cursor');await new Promise(resolve=>setImmediate(resolve));manager.cancel('cursor');
 await manager.start('cursor','switch-account',{},deps);rejectClose(Error('old close failed'));await old;
 assert.throws(()=>assertAgentWorkAllowed('cursor'),/正在换账号/);
 hold=false;await manager.check('cursor');now=200;assert.equal((await manager.check('cursor')).state,'failed');assert.equal(cancels,1);assert.doesNotThrow(()=>assertAgentWorkAllowed('cursor'));
});
