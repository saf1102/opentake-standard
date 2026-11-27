// Exercises the actual Electron-as-Node payload, using an ephemeral loopback model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildInstalledAgent} from './build.mjs';

const source = path.dirname(fileURLToPath(import.meta.url));
const picture = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/l8AAAAASUVORK5CYII=';
const key = 'fixture-no-account-only';
async function fixture(t, serve, allow = () => true) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'opentake-pi-'));
  const cwd = path.join(temp,'工程 A','工作 区');
  const root = path.dirname(cwd);
  const profile = path.join(temp,'配置');
  await fs.mkdir(cwd,{recursive:true});
  await fs.writeFile(path.join(temp,'AGENTS.md'),'GLOBAL-INSTRUCTION-SHOULD-NOT-LOAD');
  await fs.writeFile(path.join(root,'AGENTS.md'),'PROJECT-INSTRUCTION');
  await fs.writeFile(path.join(cwd,'frame.png'),Buffer.from(picture,'base64'));
  const raw=process.env.OPENTAKE_TEST_RAW_PI==='1';
  const payload = raw ? source : path.join(temp,'payload');
  if(!raw)await buildInstalledAgent(source,payload);
  const requests = [], permissions = [], updates = [];
  const server = http.createServer(async(req,res)=>{
    const chunks = []; for await(const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests.push({url:req.url,headers:req.headers,body});
    serve(res,requests.length);
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  let child;
  t.after(async()=>{
    if(child && child.exitCode === null && !child.signalCode) {
      const done = new Promise(resolve=>child.once('close',resolve));
      child.kill(); await done;
    }
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await fs.rm(temp,{recursive:true,force:true});
  });
  async function session(protocol='chat') {
    child = spawn(process.execPath,[path.join(payload,'agent.mjs')],{
      cwd,env:{PATH:process.env.PATH,GIT_ALLOW_PROTOCOL:'file',FIXTURE_OTHER_SECRET:'must-stay-private',SystemRoot:process.env.SystemRoot,HOME:temp,USERPROFILE:temp,
        PI_CODING_AGENT_DIR:profile,OPENTAKE_BUILTIN_BASE_URL:'http://127.0.0.1:'+server.address().port+(protocol==='anthropic'?'':'/v1'),
        OPENTAKE_BUILTIN_MODEL:'local-vision',OPENTAKE_BUILTIN_KEY:key,OPENTAKE_BUILTIN_PROTOCOL:protocol},
      stdio:['pipe','pipe','pipe'],
    });
    let sequence=0, stderr='';
    const pending=new Map();
    const send = data=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...data})+'\n');
    child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk});
    child.once('close',()=>{for(const f of pending.values())f({error:{message:'子进程提前结束 '+stderr}});});
    readline.createInterface({input:child.stdout}).on('line',line=>{
      const msg=JSON.parse(line);
      if(msg.method==='session/update') updates.push(msg.params.update);
      else if(msg.method==='session/request_permission') {
        permissions.push(msg.params.toolCall);
        send({id:msg.id,result:{outcome:{outcome:'selected',optionId:allow(msg.params.toolCall)?'once':'deny'}}});
      } else {pending.get(msg.id)?.(msg); pending.delete(msg.id);}
    });
    const rpc=(method,params)=>new Promise((resolve,reject)=>{
      const id=++sequence;
      const timeout=setTimeout(()=>reject(Error('测试超时')),10000);
      pending.set(id,msg=>{clearTimeout(timeout);msg.error?reject(Error(msg.error.message)):resolve(msg.result);});
      send({id,method,params});
    });
    assert.equal((await rpc('initialize',{protocolVersion:1})).protocolVersion,1);
    const {sessionId}=await rpc('session/new',{cwd,projectRoot:root});
    await rpc('session/set_model',{sessionId,modelId:'local-vision'});
    return rpc('session/prompt',{sessionId,prompt:[{type:'text',text:'在工程里制作素材并检查画面。'},{type:'image',mimeType:'image/png',data:picture}]});
  }
  return {session,cwd,root,temp,profile,requests,permissions,updates};
}
function chatReply(res,tool,content='完成') {
  res.writeHead(200,{'content-type':'text/event-stream'});
  const delta=tool ? {role:'assistant',tool_calls:[{index:0,id:'call-'+tool.name,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]} : {role:'assistant',content};
  const chunk={id:'local',model:'local-vision',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:null}]};
  const done={...chunk,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}};
  res.end('data: '+JSON.stringify(chunk)+'\n\ndata: '+JSON.stringify(done)+'\n\ndata: [DONE]\n\n');
}

test('锁定 SDK 的实际 ACP 子进程读取工程指令、写文件、看图和运行命令，统计各轮用量',async t=>{
  const tasks = [
    {name:'write',args:{path:'../字幕.txt',content:'镜头一'}},
    {name:'read',args:{path:'frame.png'}},
    {name:process.platform==='win32'?'powershell':'bash',args:{command:process.platform==='win32'?'if ($env:GIT_ALLOW_PROTOCOL -eq "file" -and !$env:FIXTURE_OTHER_SECRET -and !$env:OPENTAKE_BUILTIN_KEY) { Write-Output 完成 }':'test "$GIT_ALLOW_PROTOCOL" = file && test -z "$FIXTURE_OTHER_SECRET" && test -z "$OPENTAKE_BUILTIN_KEY" && echo 完成' }},
  ];
  const f=await fixture(t,(res,count)=>chatReply(res,tasks[count-1]));
  const result=await f.session();
  assert.equal(result.stopReason,'end_turn');
  assert.equal(await fs.readFile(path.join(f.root,'字幕.txt'),'utf8'),'镜头一');
  assert.deepEqual(f.permissions.map(x=>x.kind),['edit','read','execute']);
  // Windows may spell the same folder with a short 8.3 name (RUNNER~1); compare the canonical long paths.
  assert.equal(realpathSync.native(f.permissions[2].rawInput.cwd),realpathSync.native(f.cwd));
  assert.deepEqual(result.usage,{inputTokens:16,outputTokens:8,cachedReadTokens:0});
  const transcript=JSON.stringify(f.requests[0].body);
  assert.match(transcript,/PROJECT-INSTRUCTION/);
  assert.doesNotMatch(transcript,/GLOBAL-INSTRUCTION/);
  assert.ok(transcript.includes(picture));
  assert.match(JSON.stringify(f.requests[2].body.messages.slice(-2)),/image\/png/);
  assert.match(JSON.stringify(f.requests[3].body.messages.at(-1)),/完成/);
  assert.equal(f.requests[0].headers.authorization,'Bearer '+key);
  assert.equal(f.requests[0].url,'/v1/chat/completions');
  assert.equal(f.updates.filter(x=>x.sessionUpdate==='tool_call_update'&&x.status==='completed').length,3);
  assert.equal(JSON.stringify(f.updates).includes(key),false);
  assert.deepEqual(await fs.readdir(f.profile),[]);
  assert.equal(await fs.stat(path.join(f.temp,'.pi')).catch(()=>null),null);
});

test('宿主拒绝一次写入后工程不变',async t=>{
  const f=await fixture(t,(res,count)=>chatReply(res,count===1?{name:'write',args:{path:'blocked.txt',content:'拒绝'}}:null),()=>false);
  await f.session();
  assert.equal(f.permissions.length,1);
  assert.equal(await fs.stat(path.join(f.cwd,'blocked.txt')).catch(()=>null),null);
  assert.match(JSON.stringify(f.requests[1].body.messages),/工程权限检查拒绝/);
});

test('工程外写入被拒绝，即使宿主会同意请求',async t=>{
  const f=await fixture(t,(res,count)=>chatReply(res,count===1?{name:'write',args:{path:'../../outside.txt',content:'fixture'}}:null));
  await f.session();
  assert.equal(await fs.stat(path.join(f.temp,'outside.txt')).catch(()=>null),null);
  assert.equal(f.permissions.length,0);
  assert.match(JSON.stringify(f.requests.at(-1).body),/工程范围外/);
});
for(const [protocol,route] of [['responses','/v1/responses'],['anthropic','/v1/messages']]) {
  test(protocol+' 经过 SDK 的实际端点、图片、认证和 HTTP 错误',async t=>{
    const f=await fixture(t,res=>{res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{type:'authentication_error',message:'401 invalid_api_key '+key}}));});
    await assert.rejects(f.session(protocol),e=>e.message.includes('401') && !e.message.includes(key));
    assert.equal(f.requests[0].url.split('?')[0],route);
    assert.ok(JSON.stringify(f.requests[0].body).includes(picture));
    assert.equal(protocol==='responses'?f.requests[0].headers.authorization:f.requests[0].headers['x-api-key'],protocol==='responses'?'Bearer '+key:key);
  });
}

function responsesEvents(answer) {
  const part={type:'output_text',text:'',annotations:[]};
  const message={id:'msg_local',type:'message',role:'assistant',status:'in_progress',content:[]};
  const complete={...message,status:'completed',content:[{...part,text:answer}]};
  return [
    {type:'response.created',response:{id:'resp_local',status:'in_progress',output:[]}},
    {type:'response.output_item.added',output_index:0,item:message},
    {type:'response.content_part.added',output_index:0,content_index:0,item_id:message.id,part},
    ...[answer.slice(0,2),answer.slice(2)].map(delta=>({type:'response.output_text.delta',output_index:0,content_index:0,item_id:message.id,delta})),
    {type:'response.output_text.done',output_index:0,content_index:0,item_id:message.id,text:answer},
    {type:'response.output_item.done',output_index:0,item:complete},
    {type:'response.completed',response:{id:'resp_local',status:'completed',output:[complete],usage:{input_tokens:7,output_tokens:3,total_tokens:10}}},
  ];
}
function anthropicEvents(answer) {
  return [
    {type:'message_start',message:{id:'msg_local',type:'message',role:'assistant',model:'local-vision',content:[],stop_reason:null,usage:{input_tokens:7,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    ...[answer.slice(0,2),answer.slice(2)].map(text=>({type:'content_block_delta',index:0,delta:{type:'text_delta',text}})),
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}},
    {type:'message_stop'},
  ];
}

for(const [protocol,events,endpoint] of [
  ['responses',responsesEvents,'/v1/responses'],
  ['anthropic',anthropicEvents,'/v1/messages'],
])test(protocol+' 的图片请求经实际 SDK 收取多段文字、结束原因和用量',async t=>{
  const answer='画面已核对';
  const f=await fixture(t,res=>{
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(const frame of events(answer))res.write('event: '+frame.type+'\ndata: '+JSON.stringify(frame)+'\n\n');
    res.end();
  });
  const result=await f.session(protocol);
  assert.equal(result.stopReason,'end_turn');
  assert.deepEqual(result.usage,{inputTokens:7,outputTokens:3,cachedReadTokens:0});
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].url.split('?')[0],endpoint);
  assert.equal(f.requests[0].body.stream,true);
  assert.ok(JSON.stringify(f.requests[0].body).includes(picture));
  const text=f.updates.filter(update=>update.sessionUpdate==='agent_message_chunk').map(update=>update.content.text).join('');
  assert.equal(text,answer);
});
