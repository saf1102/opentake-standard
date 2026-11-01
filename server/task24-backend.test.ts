import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {compareProjectAgentRuns} from './agent-comparison.ts';
import {createGeneral,findGeneral,updateGeneral} from './general/store.ts';
import {readSession,writeSession,switchRunAgent,setGeneralRuntime,stopRun,isLive,closeGeneralAgentSessions,resumeRun} from './general/runner.ts';
import {initialSteps} from './general/events.ts';

test('任务24：每片调用按智能体累计，未知用量保持未知，拒绝其他工程与符号链接',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-compare-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(name:string,row:unknown)=>fs.writeFileSync(path.join(root,name+'.json'),JSON.stringify(row));
 const base={projectId:'film',module:'generalEditing',status:'completed',durationMs:12};
 write('a',{...base,agent:'kimi',transport:'acp'});write('b',{...base,agent:'kimi',status:'failed',durationMs:7});
 write('c',{...base,agent:'codex',usage:{input:3,cached:1,output:2,reasoning:0}});
 write('d',{...base,projectId:'other',agent:'kimi',durationMs:999});
 fs.symlinkSync(path.join(root,'a.json'),path.join(root,'symlink.json'));
 const result=compareProjectAgentRuns('film',root);
 assert.deepEqual(result.find(r=>r.agent==='kimi'),{agent:'kimi',name:'Kimi',calls:2,completed:1,failed:1,durationMs:19,usage:null,usageComplete:false,transports:['acp','cli']});
 assert.equal(result.find(r=>r.agent==='codex')?.usage?.input,3);
 assert.deepEqual(compareProjectAgentRuns('absent',root),[]);
});

test('任务24：换家前检查失败不改工程；成功从原检查点继续，保留文件与旧记录',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-switch-'));
 const old=process.env.LINK_READER_PROJECTS_DIR,oldConfig=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINK_READER_PROJECTS_DIR=root;process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 t.after(()=>{if(old===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=old;if(oldConfig===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=oldConfig;fs.rmSync(root,{recursive:true,force:true});});
 const {project,dir}=createGeneral({styleId:'whiteboard',inputs:{text:'测试',kind:'topic'},agent:{agent:'codex',model:'default',effort:'medium'}},'白板');
 fs.mkdirSync(path.join(dir,'work'),{recursive:true});fs.writeFileSync(path.join(dir,'work','retained.txt'),'keep');
 updateGeneral(project.id,p=>{p.run={id:'old-run',agent:'codex',state:'failed',purpose:'first',steps:initialSteps('topic','first'),startedAt:new Date().toISOString(),queued:0};});
 const session=readSession(dir);session.pending='make';session.threadId='codex-thread';session.turns=[{runId:'old-run',phase:'make',startedAt:'2026-10-30'}];writeSession(dir,session);
 setGeneralRuntime({resolveCodex:async()=>{throw Error('所选智能体未接通')},creationTools:async()=>undefined});
 const before=JSON.stringify(findGeneral(project.id).project),beforeSession=fs.readFileSync(path.join(dir,'agent','session.json'),'utf8');
 await assert.rejects(()=>switchRunAgent(project.id,{agent:'kimi',model:'default',effort:'medium'}),/未接通/);
 assert.equal(JSON.stringify(findGeneral(project.id).project),before);assert.equal(fs.readFileSync(path.join(dir,'agent','session.json'),'utf8'),beforeSession);
 await assert.rejects(()=>switchRunAgent(project.id,{agent:'claude',model:'default',effort:'medium'}),/开关已关闭/);
 let resolveDrive!:(value:never)=>void,calls=0;
 setGeneralRuntime({resolveCodex:async()=>{calls++;if(calls===1)return {agent:'kimi',executable:'/fake/kimi',model:'default',effort:'medium',transport:'acp'};return new Promise(resolve=>{resolveDrive=resolve;});}});
 const next=await switchRunAgent(project.id,{agent:'kimi',model:'default',effort:'medium'});
 assert.equal(next.agent?.agent,'kimi');assert.equal(next.run?.purpose,'resume');assert.notEqual(next.run?.id,'old-run');
 assert.match(next.messages.at(-1)?.text||'',/中途换了智能体：Codex → Kimi/);
 assert.deepEqual(readSession(dir).handoffs?.map(({from,to,previousRunId})=>({from,to,previousRunId})),[{from:'codex',to:'kimi',previousRunId:'old-run'}]);
 assert.equal(readSession(dir).threadId,undefined);assert.equal(readSession(dir).turns[0].runId,'old-run');assert.equal(readSession(dir).pending,'make');assert.equal(fs.readFileSync(path.join(dir,'work','retained.txt'),'utf8'),'keep');
 stopRun(project.id);resolveDrive({agent:'kimi',executable:'/fake/kimi',model:'default',effort:'medium',transport:'acp'} as never);
 for(let n=0;n<50&&isLive(project.id);n++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(isLive(project.id),false);
});

test('任务24：管理HTTP路由同源与标准版范围门禁；关闭Claude不触发管理命令',async t=>{
 const {EventEmitter}=await import('node:events');
 const {handleAgentConnectionsApi}=await import('./agent-connections-api.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-routes-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 t.after(()=>{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true});});
 async function request(id:string,action:string,method='GET',body:unknown={},remote='127.0.0.1',origin='http://localhost',services=false){
  const req=Object.assign(new EventEmitter(),{method,socket:{remoteAddress:remote},headers:{host:'localhost',origin}});
  let payload:any;const res={statusCode:0,setHeader(){},end(value:string){payload=JSON.parse(value)}};
  const pending=handleAgentConnectionsApi(req as never,res as never,['agent-connections',id,action],services);
  queueMicrotask(()=>{req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});
  await pending;return {status:res.statusCode,...payload};
 }
 assert.equal((await request('kimi','diagnostics','GET',{},'203.0.113.7')).status,403);
 assert.equal((await request('kimi','diagnostics','GET',{},'127.0.0.1','https://foreign.example')).status,403);
 assert.equal((await request('dreamina','diagnostics')).status,404);
 const info=await request('kimi','diagnostics');assert.equal(info.status,200);assert.equal(info.result.id,'kimi');assert.ok(Array.isArray(info.result.candidates));
 for(const action of ['program','install','logout']){const result=await request('claude',action,action==='program'?'PUT':'POST',action==='program'?{cliPath:'/missing'}:{});assert.equal(result.status,400);assert.match(result.error,/开关已关闭/);}
 const invalid=await request('kimi','program','PUT',{cliPath:'relative'});assert.equal(invalid.status,400);assert.match(invalid.error,/绝对路径/);
 assert.equal(fs.existsSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE!),false);
});

test('任务24修复一：凭据拒绝与登录恢复实时通知仅含智能体编号和状态版本；同源/本机门禁与关闭清理',async t=>{
 const {EventEmitter}=await import('node:events');
 const {handleAgentConnectionsApi}=await import('./agent-connections-api.ts');
 const {markAgentCredentialsRejected,completeAgentLogin,getConnectionConfig}=await import('./agent-connections.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-status-stream-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 t.after(()=>{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true})});
 async function connect(remote='127.0.0.1',origin='http://localhost',services=false){
  const req=Object.assign(new EventEmitter(),{method:'GET',socket:{remoteAddress:remote},headers:{host:'localhost',origin}});
  const chunks:string[]=[],headers:Record<string,string>={};
  const res=Object.assign(new EventEmitter(),{statusCode:0,setHeader(key:string,value:string){headers[key]=value},flushHeaders(){},write(value:string){chunks.push(value);return true},end(value:string){chunks.push(value)}});
  await handleAgentConnectionsApi(req as never,res as never,['agent-connections','events'],services);
  return {res,chunks,headers};
 }
 assert.equal((await connect('203.0.113.7')).res.statusCode,403);
 assert.equal((await connect('127.0.0.1','https://foreign.example')).res.statusCode,403);
 const stream=await connect();t.after(()=>stream.res.emit('close'));
 assert.match(stream.headers['Content-Type'],/^text\/event-stream/);
 markAgentCredentialsRejected('kimi');
 assert.equal(stream.chunks.at(-1),'event: credentials-rejected\ndata: {"id":"kimi","revision":1}\n\n');
 await completeAgentLogin('kimi',getConnectionConfig('kimi').revision,{detect:async()=>'/fake/kimi',cliTest:async()=>({connected:true})});
 assert.equal(stream.chunks.at(-1),'event: connection-changed\ndata: {"id":"kimi","revision":2}\n\n','登录成功广播给其他窗口');
 const before=stream.chunks.length;markAgentCredentialsRejected('dreamina');assert.equal(stream.chunks.length,before,'标准版不发送Pro服务状态');
 stream.res.emit('close');markAgentCredentialsRejected('qwen');assert.equal(stream.chunks.length,before,'关闭后移除订阅');
});


test('任务24第二部分：换账号清掉本家旧会话，保留检查点、计划、代码和其他家会话',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24b-account-sessions-'));
 const previous=process.env.LINK_READER_PROJECTS_DIR;process.env.LINK_READER_PROJECTS_DIR=root;
 t.after(()=>{if(previous===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=previous;fs.rmSync(root,{recursive:true,force:true})});
 const films=['codex','kimi'].map(agent=>{
  const {project,dir}=createGeneral({styleId:'whiteboard',inputs:{text:'保留工程',kind:'topic'},agent:{agent,model:'default',effort:'medium'}},'白板');
  const session=readSession(dir);session.agent=agent as 'codex'|'kimi';session.threadId=`${agent}-old-account`;session.pending='make';session.turns=[{runId:`${agent}-run`,phase:'make',startedAt:'2026-10-30'}];writeSession(dir,session);
  fs.mkdirSync(path.join(dir,'work'),{recursive:true});fs.writeFileSync(path.join(dir,'work','index.html'),'保留代码');
  updateGeneral(project.id,p=>{p.plan={title:'保留计划',logline:'',duration:15,segments:[]};p.run={id:`${agent}-run`,state:'failed',agent:agent as 'codex'|'kimi',purpose:'first',steps:initialSteps('topic','first'),startedAt:'2026-10-30',queued:0}});
  return {project,dir};
 });
 await closeGeneralAgentSessions('codex');
 const codex=readSession(films[0].dir);assert.equal(codex.threadId,undefined);assert.equal(codex.pending,'make');assert.equal(codex.resumed,true);assert.equal(codex.turns.length,1);
 assert.equal(findGeneral(films[0].project.id).project.plan?.title,'保留计划');assert.equal(fs.readFileSync(path.join(films[0].dir,'work','index.html'),'utf8'),'保留代码');
 assert.equal(readSession(films[1].dir).threadId,'kimi-old-account');
});


test('任务24第二部分：等待旧账号会话退出时出现别家新运行，不清掉新会话',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24b-session-race-')),previous=process.env.LINK_READER_PROJECTS_DIR;
 process.env.LINK_READER_PROJECTS_DIR=root;
 t.after(()=>{if(previous===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=previous;fs.rmSync(root,{recursive:true,force:true})});
 const {project,dir}=createGeneral({styleId:'whiteboard',inputs:{text:'保留',kind:'topic'},agent:{agent:'codex',model:'default',effort:'medium'}},'白板');
 updateGeneral(project.id,p=>{p.run={id:'before',state:'failed',agent:'codex',purpose:'first',steps:initialSteps('topic','first'),startedAt:'2026-10-30',queued:0}});
 const session=readSession(dir);session.agent='codex';session.threadId='old-account';session.pending='make';writeSession(dir,session);
 let release!:(value:any)=>void;
 setGeneralRuntime({creationTools:async()=>undefined,resolveCodex:()=>new Promise(resolve=>{release=resolve})});
 resumeRun(project.id);assert.equal(isLive(project.id),true);
 const closing=closeGeneralAgentSessions('codex');
 updateGeneral(project.id,p=>{p.run={...p.run!,id:'different-run',agent:'kimi',state:'stopped'}});
 const newer=readSession(dir);newer.agent='kimi';newer.threadId='other-account-thread';writeSession(dir,newer);
 await closing;assert.equal(readSession(dir).threadId,'other-account-thread');
 release({agent:'codex',executable:'/fake/codex',model:'default',effort:'medium'});
 for(let n=0;n<50&&isLive(project.id);n++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(isLive(project.id),false);assert.equal(readSession(dir).threadId,'other-account-thread');
});
