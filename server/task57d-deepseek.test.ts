import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getConnectionStatus, resolveAgentConnectionLaunch, saveAgentConnection, testUnifiedConnection, type ConnectionDependencies} from './agent-connections.ts';
import {startAcpAgent} from './general/acp.ts';
import {filmAgentArgs,startFilmAgent} from './general/agent-adapter.ts';

const official='deepseek-official', account='deepseek-account';
const savedKey='fixture-dsh-card-key-57d', unrelatedKey='fixture-dsh-inherited-key-57d';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
type Pair=[string,string];
type Scenario={options:Pair[]; current?:number; officialError?:401|429; accountFails?:boolean; toolBeforeError?:boolean; ignoreSwitch?:boolean; streamInvalidKey?:boolean; successText?:string; holdOfficialError?:boolean; rejectSession?:boolean};
type WireRow={pid:number;method:string;model?:Pair;keyDigest?:string;args?:string[]};
const both:Pair[]=[[official,'fixture-direct'],[account,'fixture-signed-in']];

// The fixture accepts only the exact option values sent by session/new. A successful
// handshake is deliberately independent of whether either provider accepts a prompt.
const peer=String.raw`
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const read=require('node:readline').createInterface({input:process.stdin});
const scenario=JSON.parse(fs.readFileSync(path.join(__dirname,'scenario.json'),'utf8'));
const options=scenario.options.map((pair,i)=>({value:JSON.stringify(pair,null,i%2?1:0).replace(/\n/g,''),name:pair[1]}));
let value=options[scenario.current||0]?.value;
const sessionId='session-'+process.pid;
function trace(method,extra={}){fs.appendFileSync(path.join(__dirname,'wire.jsonl'),JSON.stringify({method,pid:process.pid,...extra})+'\n')}
const key=process.env.DEEPSEEK_API_KEY;
trace('spawn',{keyDigest:key?crypto.createHash('sha256').update(key).digest('hex'):'',args:process.argv.slice(2)});
if(process.argv.includes('--version')){console.log('dsh 0.2.2-rc.5');process.exit(0)}
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['--profile','acp']))process.exit(2);
const send=obj=>console.log(JSON.stringify({jsonrpc:'2.0',...obj}));
const config=()=>[{id:'reasoning_effort',category:'thought_level',type:'select',currentValue:'off',options:[{value:'off',name:'Off'}]},
  {id:'model',category:'model',type:'select',currentValue:value,options}];
const update=data=>send({method:'session/update',params:{sessionId,update:data}});
read.on('line',async line=>{
 const {method,id,params}=JSON.parse(line);
 if(!method)return;
 if(method==='initialize'){trace(method);return send({id,result:{protocolVersion:1,authMethods:[]}})}
 if(method==='session/new'){trace(method);if(scenario.rejectSession)return send({id,error:{code:401,message:'Unauthorized'}});return send({id,result:{sessionId,configOptions:config()}})}
 if(params.sessionId!==sessionId)return send({id,error:{code:-32602,message:'Unknown session'}});
 if(method==='session/set_config_option'){
  if(params.configId!=='model'||!options.some(option=>option.value===params.value))return send({id,error:{code:-32602,message:'Unknown option'}});
  if(!scenario.ignoreSwitch)value=params.value;trace(method,{model:JSON.parse(params.value)});return send({id,result:{configOptions:config()}})
 }
 if(method==='session/prompt'){
  const model=JSON.parse(value);trace(method,{model});
  if(model[0]==='deepseek-official'&&scenario.streamInvalidKey){
   update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Authentication Fails, Your api key '}});
   update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'****f57d is invalid'}});
   return send({id,result:{stopReason:'end_turn'}})
  }
  if(model[0]==='deepseek-official'&&(scenario.officialError||!key)){
   if(scenario.holdOfficialError){
    fs.writeFileSync(path.join(__dirname,'waiting'),'ready');
    while(!fs.existsSync(path.join(__dirname,'release')))await new Promise(resolve=>setTimeout(resolve,10));
   }
   if(scenario.toolBeforeError)update({sessionUpdate:'tool_call',toolCallId:'prior-write',kind:'edit',title:'写入工程',status:'completed'});
   if(scenario.officialError===429)return send({id,error:{code:429,message:'Rate limit exceeded'}});
   return send({id,error:{code:-32603,message:'Provider error',data:{status:401,message:key?'Authentication Fails, Your api key '+key+' is invalid':'no API key for provider route deepseek-official'}}})
  }
  if(model[0]==='deepseek-account'&&scenario.accountFails)return send({id,error:{code:401,message:'Account requires login'}});
  update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:scenario.successText||'OK'}});
  return send({id,result:{stopReason:'end_turn'}})
 }
 if(method==='session/cancel')return;
 send({id,error:{code:-32601,message:'Method not found'}})
});
`;

function harness(t:TestContext, scenario:Scenario){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task57d-dsh-'));
 const script=path.join(dir,'peer.cjs');
 const file=path.join(dir,process.platform==='win32'?'dsh.cmd':'dsh');
 fs.writeFileSync(script,peer);
 const shQuote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
 fs.writeFileSync(file,process.platform==='win32'?'@"'+process.execPath+'" "%~dp0peer.cjs" %*\r\n':
  '#!/bin/sh\nexec '+shQuote(process.execPath)+' '+shQuote(script)+' "$@"\n',{mode:0o755});
 const previous=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(dir,'connections.json');
 t.after(()=>{
  if(previous===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
  else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=previous;
  fs.rmSync(dir,{recursive:true,force:true});
 });
 const setScenario=(next:Scenario)=>fs.writeFileSync(path.join(dir,'scenario.json'),JSON.stringify(next));
 setScenario(scenario);
 const keys=new Map<string,string>();
 const deps:ConnectionDependencies={detect:async()=>file,version:async()=> '0.2.2-rc.5',timeoutMs:4000,
  discoveryEnv:{PATH:path.dirname(process.execPath),DEEPSEEK_API_KEY:unrelatedKey},store:{
   async read(id){return keys.get(id)||''},async write(id,key){keys.set(id,key)},async remove(id){keys.delete(id)}
  }};
 const wire=():WireRow[]=>{
  const log=path.join(dir,'wire.jsonl');
  return fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line)):[];
 };
 const safe=(value:unknown)=>{
  const text=JSON.stringify(value);
  assert.ok(![savedKey,unrelatedKey].some(key=>text.includes(key)),'连接状态、错误、事件、参数或工程结果中出现凭据');
 };
 const card=async()=>{
  const result=await testUnifiedConnection('deepseek',deps);
  safe(result);safe(fs.readFileSync(path.join(dir,'connections.json'),'utf8'));
  return result;
 };
 const withKey=async(key=savedKey)=>{safe(await saveAgentConnection('deepseek',{apiKey:key,mode:'cli'},deps))};
 const launch=()=>resolveAgentConnectionLaunch('deepseek',{DEEPSEEK_API_KEY:unrelatedKey},deps);
 const run=async(key?:string,model='default')=>{
  const from=wire().length,events:Record<string,unknown>[]=[];
  const eventLog=path.join(dir,'events.jsonl'),lastMessage=path.join(dir,'last.txt');
  const proc=startAcpAgent(file,['--profile','acp'],{agent:'deepseek',cwd:dir,env:key?{DEEPSEEK_API_KEY:key}:{},model,
   prompt:'请回复 OK',eventLog,lastMessage,timeoutMs:4000,onEvent:event=>events.push(event)});
  t.after(()=>proc.stop());
  const result=await proc.done;
  const rows=wire().slice(from);
  safe([rows,events,result,fs.readFileSync(eventLog,'utf8')]);
  if(fs.existsSync(lastMessage))safe(fs.readFileSync(lastMessage,'utf8'));
  return {result,events,rows,prompts:rows.filter(row=>row.method==='session/prompt')};
 };
 return {wire,safe,card,dir,launch,withKey,run,setScenario,status:()=>getConnectionStatus('deepseek',deps)};
}

test('DeepSeek · 仅登录账号时，卡片与出片均从默认密钥模型切到账号',async t=>{
 const h=harness(t,{options:both});
 const check=await h.card();
 assert.ok(check.ok,check.error);assert.equal(check.connection.deepseekRoute,'account');
 assert.match(check.connection.cliAuthMessage||'',/账号/);
 assert.deepEqual(check.connection.models.map(x=>x.id),['fixture-signed-in']);
 const checkPrompt=h.wire().find(row=>row.method==='session/prompt');
 assert.deepEqual(checkPrompt?.model,both[1]);
 assert.equal(h.wire().find(row=>row.pid===checkPrompt?.pid&&row.method==='spawn')?.keyDigest,'');
 const launch=await h.launch();
 assert.equal(launch.env.DEEPSEEK_API_KEY,undefined);
 const {result,prompts}=await h.run(launch.env.DEEPSEEK_API_KEY,launch.model);
 assert.equal(result.code,0,result.stderr);assert.deepEqual(prompts.map(p=>p.model),[both[1]]);
});

test('DeepSeek · 卡片保存的密钥只给 dsh，按当前目录中独立的 official 模型选择',async t=>{
 const h=harness(t,{options:both,current:1});
 await h.withKey();
 const check=await h.card();
 assert.ok(check.ok,check.error);assert.equal(check.connection.deepseekRoute,'official');
 assert.match(check.connection.cliAuthMessage||'',/密钥/);assert.deepEqual(check.connection.models.map(x=>x.id),['fixture-direct']);
 const checkPrompt=h.wire().find(row=>row.method==='session/prompt');
 assert.deepEqual(checkPrompt?.model,both[0]);
 assert.equal(h.wire().find(row=>row.method==='spawn'&&row.pid===checkPrompt?.pid)?.keyDigest,digest(savedKey));
 const launch=await h.launch();assert.equal(launch.env.DEEPSEEK_API_KEY,savedKey);
 const film=await h.run(launch.env.DEEPSEEK_API_KEY,launch.model);
 assert.equal(film.result.code,0,film.result.stderr);assert.deepEqual(film.prompts.map(p=>p.model),[both[0]]);
});

test('DeepSeek · 卡片检查实际请求收到 401，账号确认可用才报告切换',async t=>{
 const h=harness(t,{options:both,officialError:401});
 await h.withKey();
 const check=await h.card();
 assert.ok(check.ok,check.error);assert.equal(check.connection.deepseekRoute,'account');
 assert.match(JSON.stringify(check.connection),/platform\.deepseek\.com/);
 assert.match(check.connection.cliAuthMessage||'',/账号/);
 const prompts=h.wire().filter(row=>row.method==='session/prompt');
 assert.deepEqual(prompts.map(row=>row.model),both);
 assert.equal(prompts[0].pid,prompts[1].pid);
});

test('DeepSeek · 出片首次发言才收到 401，同一会话通过账号只重试一次',async t=>{
 const h=harness(t,{options:both,officialError:401});
 const {result,events,prompts}=await h.run(savedKey,both[0][1]);
 assert.equal(result.code,0,result.stderr);assert.deepEqual(prompts.map(p=>p.model),both);
 assert.equal(prompts[0].pid,prompts[1].pid);
 const notice=events.find(e=>e.type==='acp.deepseek-route'&&e.keyRejected);
 assert.ok(notice);assert.match(String(notice.message),/platform\.deepseek\.com/);assert.match(String(notice.message),/账号/);
});

test('DeepSeek · 密钥被拒且未提供账号选项，卡片与出片给出更换密钥地址',async t=>{
 const h=harness(t,{options:[both[0]],officialError:401});
 await h.withKey();
 const check=await h.card();
 assert.equal(check.ok,false);assert.equal(check.connection.connected,false);assert.match(check.error||'',/platform\.deepseek\.com/);
 const film=await h.run(savedKey);
 assert.notEqual(film.result.code,0);assert.match(film.result.stderr,/platform\.deepseek\.com/);
 assert.deepEqual(film.prompts.map(p=>p.model),[both[0]]);
});

test('DeepSeek · 有账号选项但桌面登录无效，检查不可显示已接通',async t=>{
 const h=harness(t,{options:both,accountFails:true,officialError:401});
 await h.withKey();
 const check=await h.card();assert.equal(check.ok,false);assert.equal(check.connection.connected,false);assert.match(check.error||'',/账号|登录/);
 const film=await h.run(savedKey);assert.notEqual(film.result.code,0);assert.deepEqual(film.prompts.map(p=>p.model),both);
});

test('DeepSeek · 未填卡片密钥且没有账号路线时不发提示词',async t=>{
 const h=harness(t,{options:[both[0],['unrelated-provider','fixture-other']]});
 const check=await h.card();
 assert.equal(check.ok,false);assert.equal(check.connection.connected,false);assert.match(check.error||'',/桌面版.*登录.*密钥/);
 const film=await h.run();assert.notEqual(film.result.code,0);assert.match(film.result.stderr,/登录.*密钥/);
 assert.equal(h.wire().filter(row=>row.method==='session/prompt').length,0);
});

test('DeepSeek · 模型随 dsh 本次目录更新，已删除的工程模型在发言前报错',async t=>{
 const h=harness(t,{options:both});await h.card();
 const newer:Pair[]=[[account,'model-next-summer'],[official,'fixture-other']];
 h.setScenario({options:newer,current:1,successText:'好的，收到。'});
 const check=await h.card();assert.ok(check.ok,check.error);assert.deepEqual(check.connection.models.map(m=>m.id),['model-next-summer']);
 const film=await h.run(undefined,'model-next-summer');assert.equal(film.result.code,0,film.result.stderr);assert.deepEqual(film.prompts.map(p=>p.model),[newer[0]]);
 const stale=await h.run(undefined,'fixture-signed-in');assert.notEqual(stale.result.code,0);assert.equal(stale.prompts.length,0);
});

test('DeepSeek · 限流或已有工具动作的请求不自动重发',async t=>{
 const h=harness(t,{options:both,officialError:429});
 const limited=await h.run(savedKey);assert.notEqual(limited.result.code,0);assert.deepEqual(limited.prompts.map(p=>p.model),[both[0]]);
 h.setScenario({options:both,officialError:401,toolBeforeError:true});
 const touched=await h.run(savedKey);assert.notEqual(touched.result.code,0);assert.deepEqual(touched.prompts.map(p=>p.model),[both[0]]);
});


test('DeepSeek · dsh 返回的当前模型未切换时，不向默认密钥路线发送账号任务',async t=>{
 const h=harness(t,{options:both,ignoreSwitch:true});
 const check=await h.card();assert.equal(check.ok,false);assert.equal(check.connection.connected,false);
 const film=await h.run();assert.notEqual(film.result.code,0);assert.equal(film.prompts.length,0);
});

test('DeepSeek · 正常出片入口回写账号回退，重新保存密钥后恢复 official',async t=>{
 const h=harness(t,{options:both});
 await h.withKey();assert.ok((await h.card()).ok);
 const launch=await h.launch(),agent={...launch,agent:'deepseek' as const,effort:'none'};
 h.setScenario({options:both,officialError:401});
 const lastMessage=path.join(h.dir,'film-result.txt'),eventLog=path.join(h.dir,'film-events.jsonl');
 const args=filmAgentArgs(agent,{work:h.dir,lastMessage,effort:'none',model:agent.model,network:false});
 const proc=startFilmAgent(agent,args,{cwd:h.dir,env:agent.env,lastMessage,eventLog,prompt:'请回复 OK',onEvent:()=>{}});
 t.after(()=>proc.stop());
 const result=await proc.done;
 assert.equal(result.code,0,result.stderr);assert.equal(fs.readFileSync(lastMessage,'utf8'),'OK');
 const status=await h.status();h.safe(status);h.safe(fs.readFileSync(eventLog,'utf8'));
 assert.equal(status.deepseekRoute,'account');assert.equal(status.deepseekVerified,true);assert.match(status.cliAuthMessage||'',/platform\.deepseek\.com/);
 assert.equal((await h.launch()).env.DEEPSEEK_API_KEY,undefined);
 h.setScenario({options:both});
 const replacement='fixture-new-key-57d';await h.withKey(replacement);
 const changed=await h.card();assert.ok(changed.ok,changed.error);assert.equal(changed.connection.deepseekRoute,'official');
 assert.equal((await h.launch()).env.DEEPSEEK_API_KEY,replacement);
 assert.ok(!JSON.stringify(changed).includes(replacement));assert.ok(!fs.readFileSync(path.join(h.dir,'connections.json'),'utf8').includes(replacement));
});


test('DeepSeek · 分片返回的无效密钥提示和普通提到 401 的回答能区分',async t=>{
 const h=harness(t,{options:both,streamInvalidKey:true});await h.withKey();
 const check=await h.card();assert.ok(check.ok,check.error);assert.equal(check.connection.deepseekRoute,'account');
 const film=await h.run(savedKey);assert.equal(film.result.code,0,film.result.stderr);
 assert.deepEqual(film.prompts.map(p=>p.model),both);
 assert.equal(fs.readFileSync(path.join(h.dir,'last.txt'),'utf8'),'OK');
 assert.doesNotMatch(fs.readFileSync(path.join(h.dir,'events.jsonl'),'utf8'),/f57d/);
 const answer='HTTP 401 表示服务要求身份验证。这是接口文档的说明。';
 h.setScenario({options:both,successText:answer});
 const normal=await h.run(savedKey);assert.equal(normal.result.code,0,normal.result.stderr);
 assert.deepEqual(normal.prompts.map(p=>p.model),[both[0]]);assert.equal(fs.readFileSync(path.join(h.dir,'last.txt'),'utf8'),answer);
});


test('DeepSeek · 更换密钥后旧出片才返回 401，新配置仍使用新密钥',async t=>{
 const h=harness(t,{options:both});await h.withKey();assert.ok((await h.card()).ok);
 const launch=await h.launch(),agent={...launch,agent:'deepseek' as const,effort:'none'};
 h.setScenario({options:both,officialError:401,holdOfficialError:true});
 const lastMessage=path.join(h.dir,'stale-result.txt'),eventLog=path.join(h.dir,'stale-events.jsonl');
 const args=filmAgentArgs(agent,{work:h.dir,lastMessage,effort:'none',model:agent.model,network:false});
 const proc=startFilmAgent(agent,args,{cwd:h.dir,env:agent.env,lastMessage,eventLog,prompt:'请回复 OK',onEvent:()=>{}});
 try{
  const until=Date.now()+5000;
  while(!fs.existsSync(path.join(h.dir,'waiting'))&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(fs.existsSync(path.join(h.dir,'waiting')),'旧进程应已发起 official 请求');
  h.setScenario({options:both});const replacement='fixture-race-key-57d';await h.withKey(replacement);
  fs.writeFileSync(path.join(h.dir,'release'),'go');await proc.done;
  const current=await h.status();assert.equal(current.deepseekRoute,'official');assert.doesNotMatch(current.cliAuthMessage||'',/密钥无效/);
  assert.equal((await h.launch()).env.DEEPSEEK_API_KEY,replacement);
 }finally{proc.stop()}
});

test('DeepSeek · 完整的 HTTP 401 回复不能被卡片当作正常回答',async t=>{
 const h=harness(t,{options:both,successText:'HTTP 401 Unauthorized'});
 await h.withKey();
 const check=await h.card();assert.equal(check.ok,false);assert.equal(check.connection.connected,false);
 assert.match(check.error||'',/platform\.deepseek\.com/);
 assert.deepEqual(h.wire().filter(row=>row.method==='session/prompt').map(row=>row.model),both);
});

test('DeepSeek · 建会话时已拒绝账号，既不发送提示词也不显示接通',async t=>{
 const h=harness(t,{options:both,rejectSession:true});
 const check=await h.card();assert.equal(check.ok,false);assert.match(check.error||'',/桌面版.*登录/);
 assert.equal(check.connection.connected,false);assert.equal(h.wire().some(row=>row.method==='session/prompt'),false);
});
