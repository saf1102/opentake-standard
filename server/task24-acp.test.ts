import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startAcpAgent,acpPermissionDecision,acpPathInside,classifyAgentFailure,applyAcpEvent,redactAcpText,normalizeAcpTool} from './general/acp.ts';
import {initialSteps} from './general/events.ts';

const fixture=String.raw`
const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});
const out=v=>console.log(JSON.stringify({jsonrpc:'2.0',...v}));
const update=u=>out({method:'session/update',params:{sessionId:'test-session',update:u}});
const mode=process.env.TEST_ACP_MODE||'model';
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync('received.jsonl',line+'\n');
 if(m.method==='initialize')out({id:m.id,result:{protocolVersion:1}});
 else if(m.method==='session/new')out({id:m.id,result:{sessionId:'test-session',...(mode==='model'?{configOptions:[{id:'pick-model',category:'model',type:'select',currentValue:'default-model',options:[{value:'chosen-model',name:'Chosen'}]}]}:mode==='legacy'?{models:{currentModelId:'legacy-default',availableModels:[{modelId:'chosen-model',name:'Chosen'}]}}:{})}});
 else if((m.method==='session/set_config_option'||m.method==='session/set_model'))out({id:m.id,result:{}});
 else if(m.method==='session/prompt'){
  if(['empty','whitespace','tools-only','thought-only','plan-only'].includes(mode)){
   if(mode==='whitespace')update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'  \n\t'}});
   if(mode==='tools-only')update({sessionUpdate:'tool_call',toolCallId:'only-tool',kind:'read',rawInput:{path:'inside.txt'}});
   if(mode==='thought-only')update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'正在检查素材'}});
   if(mode==='plan-only')update({sessionUpdate:'plan',entries:[{content:'检查素材',status:'pending',priority:'high'}]});
   update({sessionUpdate:'usage_update',usage:{inputTokens:40,outputTokens:0}});
   out({id:m.id,result:{stopReason:'end_turn',usage:{inputTokens:40,outputTokens:0}}});return;
  }
  if(mode==='auth-code'){out({id:m.id,error:{code:-32000,message:'Request rejected'}});return;}
  if(mode==='error'){out({id:m.id,error:{code:403,message:'当前订阅不含此模型 account=abc email=person@example.com api_key=sk-secret-test'}});return;}
  if(mode==='wait'){const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('descendant.pid',String(child.pid));setInterval(()=>{},1000);return;}
  if(mode==='kimi'){update({sessionUpdate:'tool_call',toolCallId:'kimi-shell',title:'Shell: node .opentake/film.mjs render',content:[{type:'content',content:{type:'text',text:JSON.stringify({command:'node .opentake/film.mjs render'})}}]});out({id:94,method:'session/request_permission',params:{sessionId:'test-session',toolCall:{toolCallId:'kimi-shell',title:'Shell: node .opentake/film.mjs render',content:[{type:'content',content:{type:'text',text:'Requesting approval to perform shell command'}}]},options:[{optionId:'yes',kind:'allow_once'},{optionId:'no',kind:'reject_once'}]}});}
  update({sessionUpdate:'plan',entries:[{content:'先定方案',status:'in_progress',priority:'high'}]});
  update({sessionUpdate:'tool_call',toolCallId:'edit-1',kind:'edit',title:'写画面',rawInput:{path:'compositions/scene.html'},locations:[{path:process.cwd()+'/compositions/scene.html'}]});
  update({sessionUpdate:'tool_call_update',toolCallId:'edit-1',status:'completed'});
  update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:mode==='content'?'参考 https://example.org/film 联系 hello@example.org':'已完成'}});
  out({id:90,method:'session/request_permission',params:{sessionId:'test-session',toolCall:{toolCallId:'edit-1'},options:[{optionId:'yes',kind:'allow_once'},{optionId:'no',kind:'reject_once'}]}});
  out({id:91,method:'session/request_permission',params:{sessionId:'test-session',toolCall:{kind:'read',rawInput:{path:'/outside/private.txt'}},options:[{optionId:'yes',kind:'allow_once'},{optionId:'no',kind:'reject_once'}]}});
  out({id:95,method:'session/request_permission',params:{sessionId:'test-session',toolCall:{kind:'edit',rawInput:{path:'inside.txt'}},options:[{optionId:'always',kind:'allow_always'}]}});
  out({id:92,method:'fs/write_text_file',params:{sessionId:'test-session',path:process.cwd()+'/client.txt',content:'written'}});
  out({id:93,method:'fs/write_text_file',params:{sessionId:'other',path:process.cwd()+'/wrong-session.txt',content:'bad'}});
  setTimeout(()=>out({id:m.id,result:{stopReason:'end_turn',usage:{inputTokens:40,outputTokens:20,cachedReadTokens:5}}}),80);
 }
 else if(m.method==='session/cancel'){fs.writeFileSync('cancelled','yes');}
});
`;
async function run(mode:string,model='chosen-model'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task24-acp-'));
 fs.writeFileSync(path.join(dir,'agent.cjs'),fixture);const events:Record<string,unknown>[]=[];
 const proc=startAcpAgent(process.execPath,[path.join(dir,'agent.cjs')],{agent:'kimi',cwd:dir,env:{PATH:process.env.PATH,TEST_ACP_MODE:mode},model,prompt:'仅模拟15秒出片',eventLog:path.join(dir,'events.jsonl'),lastMessage:path.join(dir,'last.txt'),onEvent:e=>events.push(e)});
 return {dir,events,proc};
}
test('任务24：ACP握手、模型选择、prompt、消息计划工具映射和权限回复',async()=>{
 const {dir,events,proc}=await run('model');
 try{
  assert.equal((await proc.done).code,0);
  const wire=fs.readFileSync(path.join(dir,'received.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
  assert.deepEqual(wire.filter(m=>m.method).map(m=>m.method),['initialize','session/new','session/set_config_option','session/prompt']);
  assert.equal(wire[1].params.cwd,dir);assert.deepEqual(wire[1].params.mcpServers,[]);
  assert.equal(wire[2].params.value,'chosen-model');assert.equal(wire[3].params.prompt[0].text,'仅模拟15秒出片');
  assert.equal(wire.find(m=>m.id===90).result.outcome.optionId,'yes');assert.equal(wire.find(m=>m.id===91).result.outcome.optionId,'no');assert.equal(wire.find(m=>m.id===95).result.outcome.outcome,'cancelled');
  assert.equal(fs.readFileSync(path.join(dir,'client.txt'),'utf8'),'written');assert.equal(fs.existsSync(path.join(dir,'wrong-session.txt')),false);
  assert.equal(fs.readFileSync(path.join(dir,'last.txt'),'utf8'),'已完成');
  assert.deepEqual(events.find(e=>e.type==='acp.model'),{type:'acp.model',model:'chosen-model',modelSelection:'selected',requestedModel:'chosen-model'});
  let steps=initialSteps('topic','first');for(const e of events)steps=applyAcpEvent(steps,e,'now').steps;
  assert.equal(steps.find(s=>s.id==='plan')?.state,'done');assert.equal(steps.find(s=>s.id==='code')?.state,'running');
  assert.equal(events.filter(e=>e.type==='acp.permission').length,4);
 }finally{proc.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('任务24：不支持模型选择时跟随默认；失败分类和日志不暴露账号',async()=>{
 for(const mode of ['default','error']){const {dir,events,proc}=await run(mode);try{
  const done=await proc.done;
  assert.equal(events.find(e=>e.type==='acp.model')?.modelSelection,'default');
  if(mode==='auth-code'){out({id:m.id,error:{code:-32000,message:'Request rejected'}});return;}
  if(mode==='error'){assert.notEqual(done.code,0);assert.match(done.stderr,/订阅/);const log=fs.readFileSync(path.join(dir,'events.jsonl'),'utf8');assert.doesNotMatch(log,/person@example|sk-secret-test|account=abc/);assert.equal(events.find(e=>e.type==='acp.error')?.kind,'model-plan');}
  else assert.equal(done.code,0);
 }finally{proc.stop();fs.rmSync(dir,{recursive:true,force:true});}}
});
test('任务24：取消先通知ACP，然后清除子进程组',async()=>{
 const {dir,proc}=await run('wait');
 try{
  for(let i=0;i<100&&!fs.existsSync(path.join(dir,'descendant.pid'));i++)await new Promise(r=>setTimeout(r,10));
  assert.ok(fs.existsSync(path.join(dir,'descendant.pid')));const pid=Number(fs.readFileSync(path.join(dir,'descendant.pid'),'utf8'));
  proc.stop();await proc.done;assert.equal(fs.readFileSync(path.join(dir,'cancelled'),'utf8'),'yes');
  for(let i=0;i<100;i++){try{process.kill(pid,0);await new Promise(r=>setTimeout(r,10))}catch{break}}
  assert.throws(()=>process.kill(pid,0));
 }finally{proc.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('任务24：权限拒绝越界、符号链接、无路径、扩展和永久放行',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task24-boundary-'));fs.symlinkSync(os.tmpdir(),path.join(dir,'escape'));
 try{
  assert.equal(acpPathInside(dir,path.join(dir,'escape','outside.txt')),false);
  for(const p of ['../outside','/etc/passwd','escape/outside.txt'])assert.equal(acpPermissionDecision(dir,{kind:'edit',rawInput:{path:p}}).allowed,false);
  assert.equal(acpPermissionDecision(dir,{kind:'read'}).allowed,false);
  assert.equal(acpPermissionDecision(dir,{kind:'read',rawInput:{path:'input/story.txt'}}).allowed,true);
  assert.equal(acpPermissionDecision(dir,{kind:'execute',rawInput:{command:'node .opentake/film.mjs render',cwd:dir}}).allowed,true);
  for(const command of ['cat escape','cat /etc/passwd','cat ../outside','echo $HOME','node `which bad`','source setup.sh','python -c "print(1)"','node --eval "1"','python3 -I -c "print(1)"','cd ..; cd ..; cat secret','cat --file=/etc/passwd'])assert.equal(acpPermissionDecision(dir,{kind:'execute',rawInput:{command,cwd:dir}}).allowed,false,command);
  assert.equal(acpPermissionDecision(dir,{kind:'execute',rawInput:{command:'node script.mjs'}}).allowed,false);
  assert.equal(acpPermissionDecision(dir,{kind:'other',rawInput:{path:'local'}}).allowed,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('任务24：额度、凭据、套餐错误独立；临时429不是额度用完',()=>{
 for(const [raw,kind] of [['insufficient_quota 429','quota'],['balance insufficient','quota'],['missing API key','credentials'],['auth_required','credentials'],['403 当前订阅不含此模型','model-plan'],['429 rate_limit_exceeded','rate-limit'],['broken','other']])assert.equal(classifyAgentFailure(raw).kind,kind,raw);
 assert.doesNotMatch(redactAcpText('email=test@example.org token=private-value Bearer secret'),/test@example|private-value|Bearer secret/);
 assert.ok(classifyAgentFailure('a'.repeat(2000)).excerpt.length<=240);
});

test('任务24：旧版models选择与不可用模型提前停止，不偷偷换模型',async()=>{
 const old=await run('legacy');try{assert.equal((await old.proc.done).code,0);const wire=fs.readFileSync(path.join(old.dir,'received.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.equal(wire.find(m=>m.method==='session/set_model').params.modelId,'chosen-model');assert.equal(old.events.find(e=>e.type==='acp.model')?.model,'chosen-model');}finally{old.proc.stop();fs.rmSync(old.dir,{recursive:true,force:true});}
 const bad=await run('model','not-available');try{assert.notEqual((await bad.proc.done).code,0);const wire=fs.readFileSync(path.join(bad.dir,'received.jsonl'),'utf8');assert.doesNotMatch(wire,/session\/prompt/);assert.equal(bad.events.some(e=>e.type==='acp.error'),true);}finally{bad.proc.stop();fs.rmSync(bad.dir,{recursive:true,force:true});}
});

test('任务24：Kimi官方content JSON工具格式可映射并用session cwd审批',async()=>{
 const {dir,events,proc}=await run('kimi');try{assert.equal((await proc.done).code,0);const wire=fs.readFileSync(path.join(dir,'received.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.equal(wire.find(m=>m.id===94).result.outcome.optionId,'yes');const update=events.find(e=>(e.update as {toolCallId?:string})?.toolCallId==='kimi-shell');assert.equal((update!.update as {kind:string}).kind,'execute');assert.equal(applyAcpEvent(initialSteps('topic','first'),update!,'now').steps.find(s=>s.id==='render')?.state,'running');}finally{proc.stop();fs.rmSync(dir,{recursive:true,force:true});}
 const raw=normalizeAcpTool({title:'Unknown: harmless',content:[{type:'content',content:{type:'text',text:'please approve'}}]},'/project');assert.equal(acpPermissionDecision('/project',raw).allowed,false);
});
test('任务24：正文保留合法URL邮箱，错误记录脱敏；只记录协议真实用量',async()=>{
 const {dir,events,proc}=await run('content');try{assert.equal((await proc.done).code,0);assert.equal(fs.readFileSync(path.join(dir,'last.txt'),'utf8'),'参考 https://example.org/film 联系 hello@example.org');const final=events.find(e=>e.type==='acp.completed')!;assert.deepEqual(final.usage,{input:40,output:20,cached:5,reasoning:0});assert.match(String(final.text),/https:\/\/example.org/);assert.doesNotMatch(fs.readFileSync(path.join(dir,'events.jsonl'),'utf8'),/hello@example.org/);}finally{proc.stop();fs.rmSync(dir,{recursive:true,force:true});}
});


test('任务24修复一：模型繁忙独立分类，中文归一化仍可识别，429不混为额度或未登录',()=>{
 for(const raw of ['Selected model is at capacity. Please try a different model.','503 model overloaded','模型繁忙','这个模型现在繁忙，可以稍后重试或换个模型/智能体','429 overloaded']){
  const failure=classifyAgentFailure(raw);assert.equal(failure.kind,'busy',raw);assert.equal(failure.message,'这个模型现在繁忙，可以稍后重试或换个模型/智能体');
  assert.equal(classifyAgentFailure(failure.message).kind,'busy');
 }
 assert.equal(classifyAgentFailure('429 rate_limit_exceeded').kind,'rate-limit');
 assert.equal(classifyAgentFailure('insufficient_quota 429').kind,'quota');
 assert.equal(classifyAgentFailure('auth_required').kind,'credentials');
 assert.equal(classifyAgentFailure(undefined).kind,'other');
});


test('任务24修复一：ACP标准auth_required错误码即使通用文字也归为凭据错误',async()=>{
 const {dir,events,proc}=await run('auth-code');try{
  assert.notEqual((await proc.done).code,0);
  assert.equal(events.find(e=>e.type==='acp.error')?.kind,'credentials');
  assert.match(String(events.find(e=>e.type==='acp.error')?.message),/登录凭据/);
 }finally{proc.stop();fs.rmSync(dir,{recursive:true,force:true});}
});


test('任务24修复二：ACP空完成与空白回复是没有回应，usage与握手不冒充输出',async()=>{
 for(const mode of ['empty','whitespace']){
  const {dir,events,proc}=await run(mode,'default');try{
   const result=await proc.done;assert.notEqual(result.code,0);
   const failure=events.find(event=>event.type==='acp.error');assert.equal(failure?.kind,'no-response');
   assert.equal(failure?.message,'Kimi没有回应。常见原因是套餐不含这项服务或额度用完，请到Kimi官网确认。');
   assert.equal(classifyAgentFailure(failure!.message).kind,'no-response','提示可能原因不得变成确诊额度或套餐');
   assert.equal(events.some(event=>event.type==='acp.completed'),false);assert.equal(fs.existsSync(path.join(dir,'last.txt')),false);
  }finally{proc.stop();fs.rmSync(dir,{recursive:true,force:true})}
 }
});

test('任务24修复二：只有工具、思考或计划输出不是空回应，不误伤合法无正文轮次',async()=>{
 for(const mode of ['tools-only','thought-only','plan-only']){
  const {dir,events,proc}=await run(mode,'default');try{assert.equal((await proc.done).code,0);assert.equal(events.some(event=>event.type==='acp.error'),false);assert.equal(events.some(event=>event.type==='acp.completed'),true);}finally{proc.stop();fs.rmSync(dir,{recursive:true,force:true})}
 }
});
