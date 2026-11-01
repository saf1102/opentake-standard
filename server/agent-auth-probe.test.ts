import {fakeNodeCli} from './test-support/fake-cli.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {probeAcpAuthentication,createAuthProbeCache,AUTH_CONNECTED_TTL,AUTH_RETRY_TTL,probeAgentStatusCommand,acpSessionModelInfo} from './agent-auth-probe.ts';
import {getConnectionStatus,refreshAgentConnection,saveAgentConnection,getConnectionConfig,agentLoginArgs,type ConnectionDependencies} from './agent-connections.ts';
import {connectionReadyForFilm,connectionReadyForLight,AGENT_CONNECTION_IDS,agentAcpArgs,agentCliLoginArgs,connectionDefinition} from '../shared/agent-connections.ts';

test('ACP 只发 initialize 和 session/new：成功、auth_required、超时，结束清理空临时目录',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-acp-test-'));
 try{
  const script=path.join(root,'fake.mjs'),log=path.join(root,'requests.jsonl');
  fs.writeFileSync(script,`import fs from 'node:fs';import readline from 'node:readline';
const scenario=process.argv[2],log=process.argv[3];
readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);fs.appendFileSync(log,JSON.stringify({request,cwd:process.cwd(),files:fs.readdirSync(process.cwd())})+'\\n');if(scenario==='timeout')return;
 const result=request.method==='initialize'?{protocolVersion:1}:scenario==='success'?{sessionId:'fake-session'}:undefined;
 console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,...(result?{result}:{error:{code:-32000,message:'Authentication required'}})}));});`);
  for(const [scenario,state] of [['success','connected'],['auth','needs-login'],['timeout','unknown']] as const){
   fs.writeFileSync(log,'');
   const result=await probeAcpAuthentication(process.execPath,[script,scenario,log],{tempRoot:root,timeoutMs:scenario==='timeout'?100:5000});
   assert.equal(result.state,state);
   const requests=fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
   assert.deepEqual(requests.map(item=>item.request.method),scenario==='timeout'?['initialize']:['initialize','session/new']);
   for(const item of requests){assert.deepEqual(item.files,[]);assert.equal(fs.existsSync(item.cwd),false);}
   if(scenario!=='timeout')assert.deepEqual(requests[1].request.params.mcpServers,[]);
   assert.deepEqual(fs.readdirSync(root).sort(),['fake.mjs','requests.jsonl']);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('登录缓存：成功十分钟、失败十五秒；同家并发和强制刷新合为一次',async()=>{
 let now=0,calls=0;const cache=createAuthProbeCache(()=>now);
 const good=async()=>{calls++;return {state:'connected' as const,message:'已接通'}};
 await Promise.all(Array.from({length:20},()=>cache.check('kimi','v1',good,true)));assert.equal(calls,1);
 now=AUTH_CONNECTED_TTL-1;await cache.check('kimi','v1',good);assert.equal(calls,1);
 now=AUTH_CONNECTED_TTL;await cache.check('kimi','v1',good);assert.equal(calls,2);
 const bad=async()=>{calls++;return {state:'needs-login' as const,message:'还没登录'}};
 await cache.check('kimi','v2',bad);assert.equal(calls,3);
 now+=AUTH_RETRY_TTL-1;await cache.check('kimi','v2',bad);assert.equal(calls,3);
 now++;await cache.check('kimi','v2',bad);assert.equal(calls,4);
 await cache.check('codex','v1',good);assert.equal(calls,5,'另一家不共享状态');
});

test('配置变化仍不并发启动同一家，旧缓存不能用于新路径',async()=>{
 const cache=createAuthProbeCache();let release!:()=>void,calls=0;
 const first=cache.check('kimi','old',async()=>{calls++;await new Promise<void>(r=>{release=r});return {state:'connected',message:'旧路径'}});
 await Promise.resolve();const next=cache.check('kimi','new',async()=>{calls++;return {state:'needs-login',message:'新路径'}});
 await Promise.resolve();assert.equal(calls,1);release();await first;assert.equal((await next).state,'needs-login');assert.equal(calls,2);
});

test('自动接通 Kimi 可走通用 ACP 出片，单家刷新不检查其他 Agent，Claude 关闭时不执行探测',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-auto-auth-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 const calls:string[]=[],deps:ConnectionDependencies={detect:async id=>`/fixture/${id}`,cliTest:async id=>{calls.push(id);return {connected:true}}};
 try{
  const kimi=await getConnectionStatus('kimi',deps);assert.equal(kimi.connected,true);assert.equal(kimi.cliAuthState,'connected');assert.equal(kimi.cliLoginAvailable,true);assert.equal(connectionReadyForFilm(kimi),true);
  await getConnectionStatus('kimi',deps);assert.deepEqual(calls,['kimi']);await refreshAgentConnection('kimi',deps);assert.deepEqual(calls,['kimi','kimi']);
  const claude=await getConnectionStatus('claude',deps);assert.equal(claude.cliAuthState,'disabled');assert.equal(claude.cliAuthMessage,'已安装 · 默认不调用');assert.equal(claude.cliLoginAvailable,false);assert.deepEqual(calls,['kimi','kimi']);
  await saveAgentConnection('kimi',{mode:'api'},deps);assert.deepEqual(calls,['kimi','kimi'],'API 模式不启动 CLI');
  assert.deepEqual(agentLoginArgs('kimi'),['login']);assert.deepEqual(agentLoginArgs('codex'),['login']);assert.deepEqual(agentLoginArgs('claude'),['auth','login']);assert.deepEqual(agentLoginArgs('codebuddy'),[]);
 }finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true});}
});

test('错误绑定 Claude 的路径、符号链接和硬链接不能作为其他 Agent 执行，自动发现也不读版本',async()=>{
 const {detectConnectionExecutable}=await import('./agent-connections.ts');
 const {isClaudeExecutable,rosterAgentStatus,ROSTER_AGENTS}=await import('./agent-roster.ts');
 const {defaultConnection}=await import('../shared/agent-connections.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-wrong-agent-'));
 const old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 try{
  const marked=path.join(root,'started'),bin=path.join(root,'bin');fs.mkdirSync(bin);
  const claude=path.join(bin,'claude'),alias=path.join(bin,'kimi'),hard=path.join(bin,'renamed');
  fs.writeFileSync(claude,`#!/bin/sh\necho ran > '${marked}'\nexit 1\n`,{mode:0o755});fs.symlinkSync(claude,alias);fs.linkSync(claude,hard);
  assert.equal(isClaudeExecutable(claude,{PATH:bin}),true);assert.equal(isClaudeExecutable(alias,{PATH:bin}),true);assert.equal(isClaudeExecutable(hard,{PATH:bin}),true);
  let versions=0;
  const roster=await rosterAgentStatus(ROSTER_AGENTS.find(a=>a.id==='kimi')!,{home:root,env:{PATH:bin},applicationDirs:[],version:async()=>{versions++;return 'must-not-run'}});
  assert.equal(roster.executable,undefined);assert.equal(versions,0);
  for(const id of ['kimi','minimax','codebuddy','deepseek','copilot','cursor','opencode','qwen','dreamina'] as const)for(const cliPath of [claude,alias,hard]){
   // The configured Claude path makes even a renamed hard link a known Claude executable.
   fs.writeFileSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE!,JSON.stringify({claude:{...defaultConnection('claude'),cliPath:claude},[id]:{...defaultConnection(id),cliPath}}));
   assert.equal(await detectConnectionExecutable(id),undefined,`${id}: ${path.basename(cliPath)}`);
   const view=await getConnectionStatus(id);assert.equal(view.cliInstalled,false);assert.equal(view.connected,false);
  }
  assert.equal(fs.existsSync(marked),false,'没有执行任何误绑程序');
 }finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true});}
});


test('十家智能体共享明确的 ACP/登录命令；未知 DeepSeek 保留待适配',()=>{
 assert.equal(AGENT_CONNECTION_IDS.length,10);
 for(const id of AGENT_CONNECTION_IDS){
  const def=connectionDefinition(id);
  if(id==='deepseek'){assert.equal(def.heavySupported,false);assert.equal(agentAcpArgs(id),undefined);continue;}
  assert.equal(def.heavySupported,true);
  assert.ok(agentCliLoginArgs(id));
  if(id!=='codex'&&id!=='claude')assert.ok(agentAcpArgs(id)?.length);
 }
 assert.deepEqual(agentAcpArgs('copilot'),['--acp','--stdio']);
 assert.deepEqual(agentAcpArgs('qwen'),['--acp']);
 assert.equal(agentAcpArgs('claude'),undefined,'Claude 保留现有适配，不能绕进 ACP');
});

test('ACP 模型目录保留默认项，缺目录跟随默认，兼容 configOptions',()=>{
 assert.deepEqual(acpSessionModelInfo({}),{models:[],acpModelSelection:false});
 assert.deepEqual(acpSessionModelInfo({models:{currentModelId:'model-a',availableModels:[{modelId:'model-a',name:'模型 A'},{modelId:'bad id',name:'bad'}]}}),{models:[{id:'model-a',name:'模型 A',isDefault:true}],acpModelSelection:true});
 assert.deepEqual(acpSessionModelInfo({configOptions:[{id:'model',category:'model',currentValue:'p/m',options:[{name:'provider',options:[{value:'p/m',name:'模型'}]}]}]}),{models:[{id:'p/m',name:'模型',isDefault:true}],acpModelSelection:true});
});

test('状态命令只返回归类；Cursor negative优先，OpenCode凭据列表不泄露账号',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-status-test-'));
 try{
  const executable=path.join(root,'fake-cli'+(process.platform==='win32'?'.exe':''));
  for(const [output,args,state] of [
   ['Logged in as private@example.com',['status'],'connected'],
   ['Not authenticated. Previously logged in as private@example.com',['status'],'needs-login'],
   ['Checking connection',['status'],'unknown'],
   ['provider-name OAuth\n└ 1 credentials',['auth','list'],'connected'],
   ['└ 0 credentials',['auth','list'],'needs-login'],
  ] as const){
   fakeNodeCli(executable,`console.log(${JSON.stringify(output)});`);const files=fs.readdirSync(root);
   const result=await probeAgentStatusCommand(executable,args,{tempRoot:root});
   assert.equal(result.state,state);assert.doesNotMatch(JSON.stringify(result),/private@example|provider-name/);
   assert.deepEqual(fs.readdirSync(root),files);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('轻活允许已接通的 ACP 命令行，但不允许断开/待适配和伪API出片',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-light-select-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 try{
  const view=await getConnectionStatus('kimi',{detect:async()=>'/fixture/kimi',cliTest:async()=>({connected:true})});
  assert.equal(connectionReadyForLight(view),true);assert.equal(connectionReadyForLight({...view,connected:false}),false);
  assert.equal(connectionReadyForFilm({...view,mode:'api'}),false);
  assert.equal(connectionReadyForLight({...view,id:'deepseek',heavySupported:false}),false);
 }finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true})}
});


test('Kimi 带逗号的 thinking 模型在接入设置、模块设置和工程选择里原样往返',async()=>{
 const {parseAgentChoice,atomicAgentJson,readAgentSettings}=await import('./agent-settings.ts');
 const {defaultAgentSettings}=await import('../src/studio/agent-settings.ts');
 const {parseAgent}=await import('./general/store.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-model-comma-'));
 const oldConnections=process.env.LINKREADER_CONNECTION_SETTINGS_FILE,oldSettings=process.env.LINKREADER_AGENT_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');process.env.LINKREADER_AGENT_SETTINGS_FILE=path.join(root,'settings.json');
 try{
  const model='kimi-code/kimi-for-coding,thinking';
  const parsed=acpSessionModelInfo({models:{currentModelId:model,availableModels:[{modelId:model,name:'Kimi 思考'}]}});
  assert.equal(parsed.models[0]?.id,model);assert.equal(parsed.acpModelSelection,true);
  await saveAgentConnection('kimi',{model},{detect:async()=>undefined});
  assert.equal(getConnectionConfig('kimi').model,model);
  const choice={agent:'kimi' as const,model,effort:'medium'};
  assert.deepEqual(parseAgentChoice(choice),choice);assert.deepEqual(parseAgent(choice),choice);
  const settings=defaultAgentSettings();settings.modules.generalEditing=choice;
  atomicAgentJson(process.env.LINKREADER_AGENT_SETTINGS_FILE!,settings);
  assert.deepEqual(readAgentSettings().modules.generalEditing,choice);
  for(const bad of ['model;echo secret','model$(echo secret)','model\nsecret']){
   assert.throws(()=>parseAgentChoice({...choice,model:bad}));assert.throws(()=>parseAgent({...choice,model:bad}));
   await assert.rejects(saveAgentConnection('kimi',{model:bad},{detect:async()=>undefined}));
  }
 }finally{
  if(oldConnections===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=oldConnections;
  if(oldSettings===undefined)delete process.env.LINKREADER_AGENT_SETTINGS_FILE;else process.env.LINKREADER_AGENT_SETTINGS_FILE=oldSettings;
  fs.rmSync(root,{recursive:true,force:true});
 }
});

test('运行时凭据拒绝立即清缓存并持久锁定未登录，刷新不能用匿名 ACP 会话覆盖',async()=>{
 const {markAgentCredentialsRejected,onAgentCredentialsRejected,onAgentConnectionStatusChanged,testUnifiedConnection,completeAgentLogin}=await import('./agent-connections.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-auth-rejected-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 let probes=0,events=0,loggedIn=true;
 const deps:ConnectionDependencies={detect:async id=>`/fixture/${id}`,cliTest:async()=>{probes++;return {connected:loggedIn}}};
 const off=onAgentCredentialsRejected(id=>{assert.equal(id,'kimi');assert.ok(getConnectionConfig(id).authRejectedAt);events++});
 const statusEvents:{id:string;revision:number}[]=[];const offStatus=onAgentConnectionStatusChanged(event=>statusEvents.push(event));
 try{
  assert.equal((await getConnectionStatus('kimi',deps)).connected,true);assert.equal(probes,1);
  markAgentCredentialsRejected('kimi','api');assert.equal(events,0,'旧API任务不污染当前CLI');
  markAgentCredentialsRejected('kimi','cli');assert.equal(events,1);markAgentCredentialsRejected('kimi','cli');assert.equal(events,1,'重复回调幂等');
  assert.equal(getConnectionConfig('kimi').connected,false);
  for(const get of [getConnectionStatus,refreshAgentConnection]){
   const view=await get('kimi',deps);assert.equal(view.connected,false);assert.equal(view.cliAuthState,'needs-login');assert.equal(view.cliAuthMessage,'还没登录');assert.equal(view.cliLoginAvailable,true);
  }
  assert.equal((await testUnifiedConnection('kimi',deps)).ok,false);assert.equal(probes,1,'普通强制刷新仍不能假恢复');
  const persisted=JSON.parse(fs.readFileSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE!,'utf8'));assert.ok(persisted.kimi.authRejectedAt,'重启后保留拒绝证据');
  const revision=getConnectionConfig('kimi').revision;
  loggedIn=false;assert.equal((await completeAgentLogin('kimi',revision,deps)).connected,false);assert.ok(getConnectionConfig('kimi').authRejectedAt);
  loggedIn=true;assert.equal((await completeAgentLogin('kimi',revision,deps)).connected,true);assert.equal(getConnectionConfig('kimi').authRejectedAt,undefined);assert.equal(probes,3);
  assert.equal(statusEvents.length,2);assert.ok(statusEvents[1].revision>statusEvents[0].revision);assert.deepEqual(Object.keys(statusEvents[1]).sort(),['id','revision']);
  markAgentCredentialsRejected('kimi','cli',0);assert.equal(getConnectionConfig('kimi').authRejectedAt,undefined,'迟到的旧任务不能撤销新登录');
 }finally{off();offStatus();if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true})}
});

test('运行中旧探测与旧登录完成都不能覆盖较新的凭据拒绝',async()=>{
 const {markAgentCredentialsRejected,completeAgentLogin}=await import('./agent-connections.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-auth-race-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 let release!:(value:{connected:boolean})=>void;
 const deps:ConnectionDependencies={detect:async()=>'/fixture/kimi',cliTest:()=>new Promise(resolve=>{release=resolve})};
 try{
  const pending=getConnectionStatus('kimi',deps);await new Promise(resolve=>setImmediate(resolve));
  markAgentCredentialsRejected('kimi','cli');release({connected:true});assert.equal((await pending).cliAuthState,'needs-login');
  const revision=getConnectionConfig('kimi').revision;
  const login=completeAgentLogin('kimi',revision,deps);await new Promise(resolve=>setImmediate(resolve));
  await saveAgentConnection('kimi',{model:'changed'},{detect:async()=>undefined});release({connected:true});assert.equal((await login).cliAuthState,'needs-login');
  assert.ok(getConnectionConfig('kimi').authRejectedAt);
 }finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true})}
});

test('forget 使进行中的旧探测不能重新填满十分钟缓存',async()=>{
 const cache=createAuthProbeCache();let release!:()=>void,calls=0;
 const pending=cache.check('kimi','v1',async()=>{await new Promise<void>(resolve=>{release=resolve});return {state:'connected',message:'旧成功'}});
 await Promise.resolve();cache.forget('kimi');release();await pending;
 const current=await cache.check('kimi','v1',async()=>{calls++;return {state:'needs-login',message:'还没登录'}});
 assert.equal(calls,1);assert.equal(current.state,'needs-login');
});
