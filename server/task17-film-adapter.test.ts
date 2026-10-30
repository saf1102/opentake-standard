import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {filmAgentArgs,filmAgentId,applyClaudeEvent,startFilmAgent,filmAgentRedactor} from './general/agent-adapter.ts';
import {filmTurnArgs} from './general/codex.ts';
import {initialSteps} from './general/events.ts';
import {saveAgentConnection} from './agent-connections.ts';
import {defaultConnection} from '../shared/agent-connections.ts';

const turn={model:'model-existing',effort:'high',work:'/tmp/work',lastMessage:'/tmp/last',network:false,resumeThread:'old-thread',images:['/tmp/ref.png']};
test('任务17：Codex 原参数不变；API 地址仅作为本轮参数传入',()=>{
 const agent={executable:'/fixture/codex',model:turn.model,effort:turn.effort};
 assert.deepEqual(filmAgentArgs(agent,turn),filmTurnArgs(turn));
 const injected=filmAgentArgs({...agent,args:['-c','model_provider="opentake"']},turn);
 assert.deepEqual(injected.slice(0,3),['exec','-c','model_provider="opentake"']);
 assert.deepEqual(injected.slice(3),filmTurnArgs(turn).slice(1));
 assert.ok(!filmAgentArgs({...agent,method:'api',model:'default'},{...turn,model:'default'}).includes('-m'),'API默认跟随CLI，不把default当作模型ID');
 assert.throws(()=>filmAgentId({agent:'kimi'}),/待|还没完成/);
});
test('任务17：Claude 使用无头流式、临时配置和强制沙盒，API不使用订阅凭据',()=>{
 const args=filmAgentArgs({agent:'claude',executable:'/fixture/agent',model:'default',effort:'medium',method:'api'},{...turn,model:'default'});
 assert.ok(args.includes('--bare'));assert.ok(args.includes('stream-json'));assert.ok(args.includes('--resume'));
 assert.ok(!args.includes('--model'));assert.ok(!args.includes('--dangerously-skip-permissions'));
 const settings=JSON.parse(args[args.indexOf('--settings')+1]);
 assert.equal(settings.sandbox.enabled,true);assert.equal(settings.sandbox.failIfUnavailable,true);assert.equal(settings.sandbox.allowUnsandboxedCommands,false);
 assert.deepEqual(settings.sandbox.network.allowedDomains,[]);assert.deepEqual(settings.sandbox.filesystem.allowWrite,[turn.work]);
});
test('任务17：Claude 模拟事件映射进度、会话、用量与失败',()=>{
 const at='2026-10-29T00:00:00Z';let steps=initialSteps('topic','first');
 assert.equal(applyClaudeEvent(steps,{type:'system',subtype:'init',session_id:'claude-thread'},at).threadId,'claude-thread');
 steps=applyClaudeEvent(steps,{type:'assistant',message:{content:[{type:'tool_use',name:'Read',input:{file_path:'/kit/HF.md'}}]}},at).steps;
 assert.equal(steps.find(s=>s.id==='read-style')?.state,'running');
 steps=applyClaudeEvent(steps,{type:'assistant',message:{content:[{type:'tool_use',name:'Write',input:{file_path:'/work/compositions/scene.html'}}]}},at).steps;
 assert.equal(steps.find(s=>s.id==='code')?.state,'running');
 steps=applyClaudeEvent(steps,{type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command:'hfx render'}}]}},at).steps;
 assert.equal(steps.find(s=>s.id==='render')?.state,'running');
 const final=applyClaudeEvent(steps,{type:'result',subtype:'success',result:'已完成',usage:{input_tokens:20,output_tokens:10,cache_read_input_tokens:5}},at);
 assert.deepEqual(final.usage,{input:20,output:10,cached:5,reasoning:0});assert.equal(final.message,'已完成');
 assert.match(applyClaudeEvent(steps,{type:'result',subtype:'error_during_execution',is_error:true,errors:['模拟失败']},at).error||'',/模拟失败/);
 assert.match(applyClaudeEvent(steps,{type:'system',subtype:'permission_denied'},at).error||'',/沙盒/);
});
test('任务17：假进程流式完成、密钥脱敏、关开关立即取消；无真实Agent任务',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task17-film-'));const previous=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(dir,'connections.json');
 const writeGate=()=>fs.writeFileSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE!,JSON.stringify({claude:{...defaultConnection('claude'),mode:'api',enabled:true}}));
 const fixture=path.join(dir,'fixture.cjs');
 fs.writeFileSync(fixture,`console.log(JSON.stringify({type:'system',subtype:'init',session_id:'fixture-thread'}));if(process.env.FIXTURE_WAIT){setInterval(()=>{},100)}else{console.error(process.env.ANTHROPIC_API_KEY);console.log(JSON.stringify({type:'result',subtype:'success',result:'fixture '+process.env.ANTHROPIC_API_KEY}))}`);
 try {
  writeGate();const last=path.join(dir,'last.txt'),events=path.join(dir,'events.jsonl');const seen:Record<string,unknown>[]=[];
  const proc=startFilmAgent({agent:'claude',executable:process.execPath,model:'default',effort:'medium'},[fixture],{cwd:dir,env:{PATH:process.env.PATH,ANTHROPIC_API_KEY:'fake-secret-task17'},prompt:'fixture',eventLog:events,lastMessage:last,onEvent:event=>seen.push(event)});
  const done=await proc.done;assert.equal(done.code,0);assert.equal(seen.length,2);
  assert.equal(fs.readFileSync(last,'utf8'),'fixture [已隐藏密钥]');assert.doesNotMatch(fs.readFileSync(events,'utf8')+done.stderr,/fake-secret-task17/);
  const waiting=startFilmAgent({agent:'claude',executable:process.execPath,model:'default',effort:'medium'},[fixture],{cwd:dir,env:{PATH:process.env.PATH,FIXTURE_WAIT:'1'},prompt:'fixture',onEvent(){}});
  await saveAgentConnection('claude',{enabled:false},{detect:async()=>undefined});
  const stopped=await waiting.done;assert.notEqual(stopped.code,0);
  assert.throws(()=>startFilmAgent({agent:'claude',executable:process.execPath,model:'default',effort:'medium'},[fixture],{cwd:dir,env:{},prompt:'fixture',onEvent(){}}),/开关已关闭/);
  assert.equal(filmAgentRedactor({ANTHROPIC_API_KEY:'abc'})('xabcx'),'x[已隐藏密钥]x');
 }finally {if(previous===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=previous;fs.rmSync(dir,{recursive:true,force:true});}
});

test('任务17：出片工具检查可检查Claude接入且不执行Codex登录或Claude任务',async()=>{
 const {createRequire}=await import('node:module');
 const {doctor}=createRequire(import.meta.url)('../desktop/creation-tools.cjs');
 let checked=0;
 const result=await doctor({onlyCodex:true,env:{PATH:'/fixture'},agentLabel:'Claude Code 接入',agentCheck:async()=>{checked++;return {id:'claude',executable:'/fixture/claude'}},run:async()=>{throw Error('不应执行命令')}});
 assert.equal(result.ok,true);assert.equal(checked,1);assert.equal(result.items[0].id,'agent');assert.equal(result.tools.codex,undefined);assert.equal(result.tools.agent.id,'claude');
});

test('任务17：工程分别保存智能体和模型，服务不能冒充出片智能体',async()=>{
 const {createGeneral,patchGeneral,findGeneral}=await import('./general/store.ts');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task17-project-choice-')),previous=process.env.LINK_READER_PROJECTS_DIR;
 process.env.LINK_READER_PROJECTS_DIR=dir;
 try {
  const {project}=createGeneral({styleId:'whiteboard',inputs:{kind:'topic',text:'测试'},agent:{agent:'claude',model:'claude-sonnet-test',effort:'medium'}},'白板');
  assert.deepEqual(findGeneral(project.id).project.agent,{agent:'claude',model:'claude-sonnet-test',effort:'medium'});
  patchGeneral(project.id,{agent:{agent:'codex',model:'provider/model:test',effort:'high'}});
  assert.deepEqual(findGeneral(project.id).project.agent,{agent:'codex',model:'provider/model:test',effort:'high'});
  assert.throws(()=>patchGeneral(project.id,{agent:{agent:'hailuo',model:'test',effort:'medium'}}),/智能体/);
 }finally{if(previous===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
