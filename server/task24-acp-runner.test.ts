import {fakeNodeCli} from './test-support/fake-cli.ts';
/** Real runner/store/prepareWork + a fake ACP process; no model call, browser or rendering. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGeneral,findGeneral} from './general/store.ts';
import {startFirst,stopRun,resumeRun,setGeneralRuntime,readSession} from './general/runner.ts';

test('任务24：实际runner走ACP预检、共享工具、模型记录、失败和取消续做',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-acp-runner-'));
 const saved={LINK_READER_PROJECTS_DIR:process.env.LINK_READER_PROJECTS_DIR,LINKREADER_AGENT_SETTINGS_FILE:process.env.LINKREADER_AGENT_SETTINGS_FILE,LINKREADER_CONNECTION_SETTINGS_FILE:process.env.LINKREADER_CONNECTION_SETTINGS_FILE};
 Object.assign(process.env,{LINK_READER_PROJECTS_DIR:path.join(root,'projects'),LINKREADER_AGENT_SETTINGS_FILE:path.join(root,'settings','agent-settings.json'),LINKREADER_CONNECTION_SETTINGS_FILE:path.join(root,'connections.json')});
 fs.mkdirSync(path.join(root,'projects'));
 const fake=path.join(root,'fake.cjs');
 fs.writeFileSync(fake,`process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),1000));const fs=require('node:fs');const rl=require('node:readline').createInterface({input:process.stdin});const out=v=>console.log(JSON.stringify({jsonrpc:'2.0',...v}));rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync('calls.jsonl',line+'\\n');if(m.method==='initialize')out({id:m.id,result:{protocolVersion:1}});else if(m.method==='session/new')out({id:m.id,result:{sessionId:'fixture-session',models:{currentModelId:'real-default',availableModels:[{modelId:'real-default',name:'Default'}]}}});else if(m.method==='session/prompt'){fs.writeFileSync('prompt.txt',m.params.prompt[0].text);out({method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'plan',entries:[]}}});if(process.env.TEST_MODE==='error')out({id:m.id,error:{code:403,message:'当前订阅不含此模型 email=private@example.org'}});else setInterval(()=>{},1000);}else if(m.method==='session/cancel')fs.writeFileSync('cancelled','yes');});`);
 let mode='error',checks=0,renders=0;
 setGeneralRuntime({creationTools:async()=>{checks++;return undefined},resolveCodex:async()=>({agent:'kimi',transport:'acp',method:'cli',executable:process.execPath,args:[fake],model:'default',effort:'medium'}),baseEnv:()=>({PATH:process.env.PATH,TEST_MODE:mode}),agentReview:false,render:async()=>{renders++;throw Error('不应渲染')}});
 const wait=async(id:string,condition:()=>boolean)=>{for(let i=0;i<200;i++){if(condition())return;await new Promise(r=>setTimeout(r,20));}throw Error(`等待超时：${findGeneral(id).project.run?.state}`)};
 const fresh=()=>createGeneral({styleId:'whiteboard',settings:{length:15,aspect:'16:9'},inputs:{kind:'topic',text:'同题15秒模拟，不能调用真实模型'},agent:{agent:'kimi',model:'default',effort:'medium'}},'测试').project.id;
 let active:string|undefined;
 try{
  const id=fresh();active=id;startFirst(id);await wait(id,()=>findGeneral(id).project.run?.state==='failed');
  const {project,dir}=findGeneral(id);assert.match(project.run!.error||'',/当前订阅不包含/);assert.equal(project.run!.agent,'kimi');assert.equal(project.run!.transport,'acp');assert.equal(project.run!.model,'real-default');assert.equal(project.run!.modelSelection,'default');
  assert.equal(fs.existsSync(path.join(dir,'work','.opentake','bin',process.platform==='win32'?'film.cmd':'film')),true);
  const prompt=fs.readFileSync(path.join(dir,'work','prompt.txt'),'utf8');assert.match(prompt,/同题15秒模拟/);assert.match(prompt,/\.opentake[\\/]guide-/);
  const calls=fs.readFileSync(path.join(dir,'work','calls.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.equal(calls.find(c=>c.method==='session/new').params.cwd,path.join(dir,'work'));assert.equal(calls.some(c=>c.method==='session/set_model'),false);
  assert.match(readSession(dir).turns[0].error||'',/订阅/);
  const records=fs.readdirSync(path.join(root,'settings','agent-runs')).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(root,'settings','agent-runs',f),'utf8')));assert.equal(records.some(r=>r.agent==='kimi'&&r.transport==='acp'&&r.model==='real-default'&&r.status==='failed'),true);
  mode='wait';const second=fresh();active=second;startFirst(second);const secondDir=findGeneral(second).dir;await wait(second,()=>fs.existsSync(path.join(secondDir,'work','prompt.txt')));stopRun(second);await wait(second,()=>findGeneral(second).project.run?.state==='stopped');assert.equal(fs.readFileSync(path.join(secondDir,'work','cancelled'),'utf8'),'yes');
  fs.writeFileSync(path.join(secondDir,'work','keep.txt'),'original');mode='error';resumeRun(second);await wait(second,()=>findGeneral(second).project.run?.state==='failed');assert.equal(fs.readFileSync(path.join(secondDir,'work','keep.txt'),'utf8'),'original');assert.match(fs.readFileSync(path.join(secondDir,'work','prompt.txt'),'utf8'),/同题15秒模拟/);const resumedCalls=fs.readFileSync(path.join(secondDir,'work','calls.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.equal(resumedCalls.filter(c=>c.method==='session/new').length,2);assert.equal(resumedCalls.some(c=>c.method==='session/load'),false);assert.equal(renders,0);if(process.platform==='darwin')assert.ok(checks>=2);
 }finally{if(active&&['running','stopping'].includes(findGeneral(active).project.run?.state||'')){stopRun(active);await wait(active,()=>findGeneral(active!).project.run?.state==='stopped');}for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;fs.rmSync(root,{recursive:true,force:true});}
});

test('任务24修复一：ACP和Codex模型繁忙只重试一次，保留同家模型文件和排队意见；等待可取消或禁用',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-busy-runner-'));
 const saved={LINK_READER_PROJECTS_DIR:process.env.LINK_READER_PROJECTS_DIR,LINKREADER_AGENT_SETTINGS_FILE:process.env.LINKREADER_AGENT_SETTINGS_FILE,LINKREADER_CONNECTION_SETTINGS_FILE:process.env.LINKREADER_CONNECTION_SETTINGS_FILE};
 Object.assign(process.env,{LINK_READER_PROJECTS_DIR:path.join(root,'projects'),LINKREADER_AGENT_SETTINGS_FILE:path.join(root,'settings','agent-settings.json'),LINKREADER_CONNECTION_SETTINGS_FILE:path.join(root,'connections.json')});
 fs.mkdirSync(path.join(root,'projects'));
 const {saveAgentConnection,getConnectionConfig}=await import('./agent-connections.ts');
 const {postMessage,isLive}=await import('./general/runner.ts');
 const fake=path.join(root,'fake.cjs');
 fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');const out=v=>console.log(JSON.stringify(v));
let count=0;try{count=Number(fs.readFileSync('attempts','utf8'))}catch{};fs.writeFileSync('attempts',String(++count));
const busy=()=>process.env.BUSY_MODE!=='recover'||count===1;
const record=prompt=>{fs.appendFileSync('prompts.jsonl',JSON.stringify(prompt)+'\\n');if(count===1)fs.writeFileSync('keep.txt','original');};
const success=()=>fs.writeFileSync('network-request.json',JSON.stringify({hosts:['example.org'],reason:'仅验证运行器成功分支，不做真实联网'}));
if(process.env.BUSY_AGENT==='codex'){
 let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>{record(prompt);out({type:'thread.started',thread_id:'fake-thread'});if(busy())out({type:'turn.failed',error:{message:'Selected model is at capacity. Please try a different model.'}});else{success();out({type:'turn.completed'})}});
}else{
 const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);const reply=v=>out({jsonrpc:'2.0',id:m.id,...v});if(m.method==='initialize')reply({result:{protocolVersion:1}});else if(m.method==='session/new')reply({result:{sessionId:'fake-session',models:{currentModelId:'busy-model',availableModels:[{modelId:'busy-model',name:'Busy model'}]}}});else if(m.method==='session/set_model'){fs.writeFileSync('selected.txt',m.params.modelId);reply({result:{}})}else if(m.method==='session/prompt'){record(m.params.prompt[0].text);if(busy())reply({error:{code:503,message:'model overloaded'}});else{success();out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fake-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'需要联网检查素材'}}}});reply({result:{stopReason:'end_turn'}})}}});
}
`,{mode:0o755});
 const codexFixture=fakeNodeCli(path.join(root,'codex-fixture'),fs.readFileSync(fake,'utf8'));
 let mode='always',agent:'kimi'|'codex'='kimi',resolved=0;
 setGeneralRuntime({busyRetryDelayMs:150,creationTools:async()=>undefined,resolveCodex:async()=>{resolved++;return {agent,...(agent==='kimi'?{transport:'acp' as const,args:[fake],executable:process.execPath}:{executable:codexFixture}),method:'cli',model:'default',effort:'medium'}},baseEnv:()=>({PATH:process.env.PATH,BUSY_MODE:mode,BUSY_AGENT:agent}),agentReview:false,render:async()=>{throw Error('不应渲染')}});
 const wait=async(id:string,condition:()=>boolean)=>{for(let i=0;i<300;i++){if(condition())return;await new Promise(r=>setTimeout(r,20))}throw Error(`等待超时：${findGeneral(id).project.run?.state}`)};
 const fresh=()=>createGeneral({styleId:'whiteboard',settings:{length:15,aspect:'16:9'},inputs:{kind:'topic',text:'模型繁忙模拟'},agent:{agent,model:'default',effort:'medium'}},'测试').project.id;
 let active:string|undefined;
 try{
  for(agent of ['kimi','codex'] as const){
   for(mode of ['always','recover']){
    const before=resolved,id=fresh();active=id;startFirst(id);const dir=findGeneral(id).dir;
    await wait(id,()=>findGeneral(id).project.messages.some(m=>m.text.includes('自动重试一次')));
    postMessage(id,{text:'重试时保留这句排队意见'});
    await wait(id,()=>['failed','needs-network'].includes(findGeneral(id).project.run?.state||''));
    const p=findGeneral(id).project;
    assert.equal(p.run!.state,mode==='always'?'failed':'needs-network');
    if(mode==='always')assert.match(p.run!.error||'',/这个模型现在繁忙，可以稍后重试或换个模型\/智能体/);
    assert.equal(fs.readFileSync(path.join(dir,'work','attempts'),'utf8'),'2');assert.equal(resolved,before+1,'重试不得重新解析或自动换家换模型');
    assert.equal(fs.readFileSync(path.join(dir,'work','keep.txt'),'utf8'),'original');
    const prompts=fs.readFileSync(path.join(dir,'work','prompts.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.match(prompts[1],/重试时保留这句排队意见/);
    assert.equal(readSession(dir).turns.length,2);assert.equal(fs.existsSync(path.join(dir,'work','selected.txt')),false,'默认模型重试不调用持久set_model');
    assert.equal(getConnectionConfig(agent).authRejectedAt,undefined,'繁忙不得标为未登录');
    if(p.run!.state==='needs-network')stopRun(id);
    await wait(id,()=>!isLive(id));
   }
  }
  agent='kimi';mode='always';setGeneralRuntime({busyRetryDelayMs:1000});
  for(const action of ['cancel','disable']){
   const id=fresh();active=id;startFirst(id);const dir=findGeneral(id).dir;
   await wait(id,()=>findGeneral(id).project.messages.some(m=>m.text.includes('自动重试一次')));
   if(action==='cancel')stopRun(id);else await saveAgentConnection('kimi',{enabled:false},{detect:async()=>undefined});
   await wait(id,()=>!isLive(id));assert.equal(fs.readFileSync(path.join(dir,'work','attempts'),'utf8'),'1');
   assert.equal(findGeneral(id).project.run!.state,action==='cancel'?'stopped':'failed');
   if(action==='disable')await saveAgentConnection('kimi',{enabled:true},{detect:async()=>undefined});
  }
 }finally{
  if(active&&isLive(active)){stopRun(active);await wait(active,()=>!isLive(active!))}
  setGeneralRuntime({busyRetryDelayMs:3000});
  for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  fs.rmSync(root,{recursive:true,force:true});
 }
});


test('任务24修复二：真实runner保留空回应分类与检查点，不伪装成功、不重试、不改为未登录',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24c-empty-runner-'));
 const saved={LINK_READER_PROJECTS_DIR:process.env.LINK_READER_PROJECTS_DIR,LINKREADER_AGENT_SETTINGS_FILE:process.env.LINKREADER_AGENT_SETTINGS_FILE,LINKREADER_CONNECTION_SETTINGS_FILE:process.env.LINKREADER_CONNECTION_SETTINGS_FILE};
 Object.assign(process.env,{LINK_READER_PROJECTS_DIR:path.join(root,'projects'),LINKREADER_AGENT_SETTINGS_FILE:path.join(root,'settings','agent-settings.json'),LINKREADER_CONNECTION_SETTINGS_FILE:path.join(root,'connections.json')});
 fs.mkdirSync(path.join(root,'projects'));
 const fake=path.join(root,'empty.cjs');
 fs.writeFileSync(fake,`const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});const out=v=>console.log(JSON.stringify({jsonrpc:'2.0',...v}));rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')out({id:m.id,result:{protocolVersion:1}});else if(m.method==='session/new')out({id:m.id,result:{sessionId:'empty-session'}});else if(m.method==='session/prompt'){fs.appendFileSync('prompt-count','1');out({id:m.id,result:{stopReason:'end_turn'}})}});`);
 let renders=0;
 setGeneralRuntime({creationTools:async()=>undefined,resolveCodex:async()=>({agent:'kimi',transport:'acp',method:'cli',executable:process.execPath,args:[fake],model:'default',effort:'medium'}),baseEnv:()=>({PATH:process.env.PATH}),agentReview:false,render:async()=>{renders++;throw Error('不得渲染')}});
 const {getConnectionConfig}=await import('./agent-connections.ts');const {isLive}=await import('./general/runner.ts');
 const id=createGeneral({styleId:'whiteboard',settings:{length:15,aspect:'16:9'},inputs:{kind:'topic',text:'空回应测试，不调用真实模型'},agent:{agent:'kimi',model:'default',effort:'medium'}},'测试').project.id;
 try{
  startFirst(id);const pendingBefore=readSession(findGeneral(id).dir).pending;for(let i=0;i<200&&isLive(id);i++)await new Promise(resolve=>setTimeout(resolve,20));
  const {project,dir}=findGeneral(id);assert.equal(project.run?.state,'failed');assert.equal(project.run?.errorKind,'no-response');
  assert.equal(project.run?.error,'Kimi没有回应。常见原因是套餐不含这项服务或额度用完，请到Kimi官网确认。');
  assert.equal(readSession(dir).pending,pendingBefore);assert.equal(project.versions.length,0);assert.equal(renders,0);assert.equal(getConnectionConfig('kimi').authRejectedAt,undefined);
  assert.equal(fs.readFileSync(path.join(dir,'work','prompt-count'),'utf8'),'1');
  const records=fs.readdirSync(path.join(root,'settings','agent-runs')).map(name=>JSON.parse(fs.readFileSync(path.join(root,'settings','agent-runs',name),'utf8')));
  assert.equal(records.length,1);assert.equal(records[0].status,'failed');assert.equal(records[0].errorKind,'no-response');assert.equal(records[0].usage,undefined);
  assert.equal(fs.existsSync(path.join(dir,'work','BRIEF.md')),true);assert.equal(isLive(id),false);
  fs.writeFileSync(path.join(dir,'work','keep.ts'),'已完成的画面代码');
  resumeRun(id);for(let i=0;i<200&&isLive(id);i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(findGeneral(id).project.run?.errorKind,'no-response');assert.equal(readSession(dir).pending,pendingBefore);assert.equal(fs.readFileSync(path.join(dir,'work','keep.ts'),'utf8'),'已完成的画面代码');assert.equal(fs.readFileSync(path.join(dir,'work','prompt-count'),'utf8'),'11');
 }finally{
  if(isLive(id)){stopRun(id);for(let i=0;i<200&&isLive(id);i++)await new Promise(resolve=>setTimeout(resolve,20));}
  for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  fs.rmSync(root,{recursive:true,force:true});
 }
});
