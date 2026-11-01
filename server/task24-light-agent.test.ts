import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultConnection,connectionDefinition,connectionReadyForFilm,connectionReadyForLight,type ConnectionView,type ConnectionId} from '../shared/agent-connections.ts';
import {defaultAgentSettings} from '../src/studio/agent-settings.ts';
import {resolveAgent,runAgent} from './agent-runtime.ts';
import {recentAgentRuns,validateModuleAgentChoice} from './agent-settings.ts';
import {getConnectionStatus,refreshAgentConnection} from './agent-connections.ts';
import {startFilmAgent} from './general/agent-adapter.ts';

test('任务24：选择规则只接受已接通且有对应接法的智能体，API轻活与CLI出片边界独立',()=>{
 const view=(id:ConnectionId,patch:Partial<ConnectionView>={}):ConnectionView=>({...defaultConnection(id),...connectionDefinition(id),cliInstalled:true,connected:true,enabled:true,state:'connected',relay:false,...patch});
 for(const id of ['codex','claude','kimi','minimax','copilot','cursor','opencode','qwen','codebuddy'] as const){
  assert.equal(connectionReadyForFilm(view(id)),true,id);assert.equal(connectionReadyForLight(view(id)),true,id);
  assert.equal(connectionReadyForFilm(view(id,{connected:false})),false);assert.equal(connectionReadyForLight(view(id,{connected:false})),false);
  assert.equal(connectionReadyForFilm(view(id,{enabled:false})),false);assert.equal(connectionReadyForLight(view(id,{enabled:false})),false);
 }
 assert.equal(connectionReadyForFilm(view('deepseek')),false);
 assert.equal(connectionReadyForLight(view('deepseek')),false);
 assert.equal(connectionReadyForLight(view('kimi',{mode:'api',cliInstalled:false})),true);
 assert.equal(connectionReadyForFilm(view('kimi',{mode:'api'})),false);
 assert.equal(connectionReadyForLight(view('copilot',{mode:'api'})),false);
 assert.equal(connectionReadyForLight(view('dreamina')),false);
});

test('修复一：Codex原生出片和轻活的凭据拒绝也清连接，普通文字不误判',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task24-codex-auth-'));
 const previous=process.env.LINKREADER_CONNECTION_SETTINGS_FILE,settings=process.env.LINKREADER_AGENT_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(dir,'connections.json');process.env.LINKREADER_AGENT_SETTINGS_FILE=path.join(dir,'settings.json');
 const fake=path.join(dir,'fixture.cjs');
 fs.writeFileSync(fake,`console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'文档中的 auth_required 不是运行失败'}}));console.log(JSON.stringify({type:'turn.failed',error:{message:'invalid credentials'}}));setTimeout(()=>process.exit(0),100);`);
 const save=()=>fs.writeFileSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE!,JSON.stringify({codex:{...defaultConnection('codex'),connected:true}}));
 try{
  save();let immediate=false,ordinary=true;
  const proc=startFilmAgent({agent:'codex',method:'cli',executable:process.execPath,model:'default',effort:'medium'},[fake],{cwd:dir,env:{},prompt:'fake',onEvent:event=>{
   const config=JSON.parse(fs.readFileSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE!,'utf8')).codex;
   if(event.type==='item.completed')ordinary=!config.authRejectedAt;
   if(event.type==='turn.failed')immediate=!!config.authRejectedAt;
  }});
  await proc.done;assert.equal(ordinary,true);assert.equal(immediate,true,'退出码0的失败事件也立即清缓存');
  save();const cli=path.join(dir,'codex-fake');fs.writeFileSync(cli,`#!${process.execPath}\nconsole.error('not logged in');process.exit(1);`,{mode:0o755});
  await assert.rejects(runAgent({module:'captionTranslation',agent:'codex',method:'cli',executable:cli,model:'default',effort:'medium',cliVersion:'fake'},['exec','fixture']),/缺少有效登录凭据/);
  assert.ok(JSON.parse(fs.readFileSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE!,'utf8')).codex.authRejectedAt);
 }finally{
  if(previous===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=previous;
  if(settings===undefined)delete process.env.LINKREADER_AGENT_SETTINGS_FILE;else process.env.LINKREADER_AGENT_SETTINGS_FILE=settings;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('任务24：假 ACP 命令行处理字幕轻活，遵守工程选择、Schema、取消与最近调用，不替换断开的选择',async()=>{
 if(process.platform!=='darwin')return;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task24-light-'));
 const previousSettings=process.env.LINKREADER_AGENT_SETTINGS_FILE,previousConnections=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_AGENT_SETTINGS_FILE=path.join(dir,'settings.json');process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(dir,'connections.json');
 const log=path.join(dir,'requests.jsonl'),fake=path.join(dir,'fake-kimi');
 fs.writeFileSync(fake,`#!${process.execPath}
import fs from 'node:fs';import readline from 'node:readline';
const log=${JSON.stringify(log)};
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);fs.appendFileSync(log,JSON.stringify({method:r.method,cwd:process.cwd(),params:r.params})+'\\n');const send=result=>console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));
if(r.method==='initialize')send({protocolVersion:1});
if(r.method==='session/new')send({sessionId:'light-fixture'});
if(r.method==='session/prompt'){if(JSON.stringify(r.params).includes('WAIT_FOR_CANCEL'))return;if(JSON.stringify(r.params).includes('REJECT_AUTH')){console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:'Authentication required'}}));return;}if(JSON.stringify(r.params).includes('MODEL_BUSY')){console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32603,message:'model overloaded'}}));return;}console.log(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'light-fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'{"text":"你好"}'}}}}));send({stopReason:'end_turn'});}
});`,{mode:0o755});
 const save=(cliPath=fake)=>fs.writeFileSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE!,JSON.stringify({kimi:{...defaultConnection('kimi'),cliPath}}));
 try{
  save();const settings=defaultAgentSettings();settings.modules.captionTranslation={agent:'kimi',model:'default',effort:'none'};
  const agent=await resolveAgent('captionTranslation',settings);assert.equal(agent.agent,'kimi');assert.equal(agent.transport,'acp');assert.equal(agent.method,'cli');assert.equal(agent.executable,fake);
  assert.deepEqual(await validateModuleAgentChoice('captionTranslation',settings.modules.captionTranslation),settings.modules.captionTranslation);
  const output=path.join(dir,'answer.json'),schema=path.join(dir,'schema.json');fs.writeFileSync(schema,'{"type":"object"}');
  await runAgent(agent,['exec','--output-schema',schema,'--output-last-message',output,'翻译为中文'],{timeout:5000});
  assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),{text:'你好'});
  const record=recentAgentRuns()[0];assert.equal(record.agent,'kimi');assert.equal(record.method,'cli');assert.equal(record.transport,'acp');assert.equal(record.status,'completed');
  const requests=fs.readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));const prompt=requests.find(r=>r.method==='session/prompt');assert.match(JSON.stringify(prompt.params),/JSON Schema/);assert.equal(fs.existsSync(prompt.cwd),false,'临时文字工作目录已清理');
  const controller=new AbortController();const pending=runAgent(agent,['exec','--output-last-message',path.join(dir,'cancelled.json'),'WAIT_FOR_CANCEL'],{timeout:5000,signal:controller.signal});
  const start=Date.now();while(!fs.readFileSync(log,'utf8').includes('WAIT_FOR_CANCEL')){assert.ok(Date.now()-start<4000);await new Promise(r=>setTimeout(r,20));}controller.abort();await assert.rejects(pending,/abort|取消/i);assert.equal(fs.existsSync(path.join(dir,'cancelled.json')),false);assert.match(fs.readFileSync(log,'utf8'),/session\/cancel/);
  await assert.rejects(runAgent(agent,['exec','MODEL_BUSY'],{timeout:5000}),/这个模型现在繁忙/);
  assert.equal((await getConnectionStatus('kimi')).connected,true,'繁忙不清登录状态');
  assert.equal(recentAgentRuns()[0].errorKind,'busy');
  await assert.rejects(runAgent(agent,['exec','REJECT_AUTH'],{timeout:5000}),/缺少有效登录凭据/);
  const rejected=await refreshAgentConnection('kimi');
  assert.equal(rejected.connected,false);assert.equal(rejected.cliAuthState,'needs-login','空会话仍会成功，但不能覆盖真实prompt认证拒绝');
  assert.equal(recentAgentRuns()[0].errorKind,'credentials');
  fs.writeFileSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE!,JSON.stringify({kimi:{...defaultConnection('kimi'),cliPath:fake,mode:'api',connected:true,hasKey:true}}));
  await assert.rejects(validateModuleAgentChoice('generalEditing',{agent:'kimi',model:'default',effort:'none'}),/已适配的命令行/,'Kimi API 轻活不能误当出片接法');
  await assert.rejects(validateModuleAgentChoice('screenEditing',{agent:'kimi',model:'default',effort:'none'}),/待适配/);
  save(path.join(dir,'missing'));await assert.rejects(resolveAgent('captionTranslation',settings),/所选智能体未接通/);await assert.rejects(runAgent(agent,['exec','断开后不能换人']),/所选智能体未接通/);
 }finally{if(previousSettings===undefined)delete process.env.LINKREADER_AGENT_SETTINGS_FILE;else process.env.LINKREADER_AGENT_SETTINGS_FILE=previousSettings;if(previousConnections===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=previousConnections;fs.rmSync(dir,{recursive:true,force:true});}
});
