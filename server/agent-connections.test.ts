import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {connectionSecretStore} from './connection-secrets.ts';
import {getConnectionConfig,saveAgentConnection,getConnectionStatus,testUnifiedConnection,deleteConnectionKey,assertAgentExecutionAllowed,onAgentDisabled,validateConnectionBaseUrl,runConnectionText,type ConnectionDependencies} from './agent-connections.ts';
import {isRelay,type ConnectionId} from '../shared/agent-connections.ts';
const KEY='fixture-key-not-real-12345678';
const chatFixture=(model:string):typeof fetch=>async(_input,init)=>Response.json(init?.method==='POST'?{choices:[{message:{content:'好'}}]}:{data:[{id:model}]});
async function fixture(work:(deps:ConnectionDependencies,dir:string,keys:Map<string,string>)=>Promise<void>){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-connections-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(dir,'connections.json');const keys=new Map<string,string>();const deps:ConnectionDependencies={store:{async read(id){return keys.get(id)||''},async write(id,key){keys.set(id,key)},async remove(id){keys.delete(id)}},detect:async()=>undefined};try{await work(deps,dir,keys)}finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(dir,{recursive:true,force:true})}}
test('统一接入：配置只保存元数据，钥匙串存取删且不会返回密钥',async()=>fixture(async(deps,dir,keys)=>{
 const saved=await saveAgentConnection('kimi',{mode:'api',apiKey:KEY,model:'kimi-fixture'},deps);assert.equal(saved.hasKey,true);assert.equal(getConnectionConfig('kimi').model,'kimi-fixture');assert.equal(keys.get('kimi'),KEY);assert.ok(!JSON.stringify(saved).includes(KEY));assert.ok(!fs.readFileSync(path.join(dir,'connections.json'),'utf8').includes(KEY));await deleteConnectionKey('kimi',deps);assert.equal(keys.has('kimi'),false);assert.equal(getConnectionConfig('kimi').hasKey,false);
}));
test('统一接入：钥匙串写入走stdin，失败不泄露内容，命名空间按隔离目录分开',async()=>{
 const commands:{args:string[];stdin?:string}[]=[];const store=connectionSecretStore(async(args,stdin)=>{commands.push({args,stdin});return {code:0,stdout:args[0]==='find-generic-password'?KEY:''}},'darwin');await store.write('codex',KEY);assert.equal(await store.read('codex'),KEY);await store.remove('codex');assert.ok(commands[0].stdin?.includes(KEY));assert.ok(!commands[0].args.join(' ').includes(KEY));assert.ok(commands[1].args.some(x=>/^opentake\.connection\.[a-f0-9]{16}\.codex$/.test(x)));await assert.rejects(store.write('codex',KEY+'\nlist-keychains'),/格式/);await assert.rejects(connectionSecretStore(async()=>{throw Error(KEY)},'darwin').write('claude',KEY),error=>!String(error).includes(KEY));
});
test('统一接入：Claude默认关闭，API测试不会执行CLI，启用订阅方式要求确认，关闭发取消通知',async()=>fixture(async(deps)=>{
 assert.equal(getConnectionConfig('claude').enabled,false);assert.throws(()=>assertAgentExecutionAllowed('claude'),/开关已关闭/);let cliCalls=0;deps.cliTest=async()=>{cliCalls++;return {connected:true}};deps.fetcher=async(_input,init)=>Response.json(init?.method==='POST'?{input_tokens:4}:{data:[{id:'claude-fixture',display_name:'测试模型'}]});await saveAgentConnection('claude',{mode:'api',apiKey:KEY},deps);assert.equal((await testUnifiedConnection('claude',deps)).ok,true);assert.equal(cliCalls,0);assert.equal((await getConnectionStatus('claude',deps)).connected,false);await assert.rejects(saveAgentConnection('claude',{mode:'cli',enabled:true},deps),/确认风险/);let disabled=0;const off=onAgentDisabled(()=>{disabled++});await saveAgentConnection('claude',{mode:'cli',enabled:true,confirmSubscriptionRisk:true},deps);assert.doesNotThrow(()=>assertAgentExecutionAllowed('claude'));await saveAgentConnection('claude',{enabled:false},deps);assert.equal(disabled,1);off();
}));
test('统一接入：真实本地假服务器覆盖成功/鉴权/格式/余额/超时，不调用生成端点',async()=>fixture(async(deps)=>{
 const requests:string[]=[];let scenario='ok';const server=http.createServer((req,res)=>{requests.push(req.method+' '+req.url);if(scenario==='timeout')return;res.setHeader('content-type','application/json');if(scenario==='ok')res.end(JSON.stringify(req.method==='POST'?{input_tokens:4}:{data:[{id:'test-model',is_default:true}]}));else if(scenario==='format')res.end('<html>not api</html>');else {res.statusCode=Number(scenario);res.end(JSON.stringify({error:{message:KEY}}));}});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};
 try{await saveAgentConnection('codex',{mode:'api',apiKey:KEY,baseUrl:`http://127.0.0.1:${address.port}/v1`},deps);assert.equal((await testUnifiedConnection('codex',deps)).ok,true);assert.equal(getConnectionConfig('codex').models[0].id,'test-model');for(const [value,match] of [['401','密钥'],['402','余额'],['404','格式'],['format','格式'],['timeout','超时']]){scenario=value;const result=await testUnifiedConnection('codex',{...deps,timeoutMs:value==='timeout'?40:5000});assert.equal(result.ok,false);assert.match(result.error!,new RegExp(match));assert.ok(!JSON.stringify(result).includes(KEY));}assert.ok(requests.every(req=>req==='GET /v1/models'||req==='POST /v1/responses/input_tokens'));}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}));
test('统一接入：代理提醒不阻止已验证API，改地址/密钥会使原连接失效',async()=>fixture(async(deps)=>{
 deps.fetcher=chatFixture('deepseek-test');await saveAgentConnection('deepseek',{mode:'api',apiKey:KEY,baseUrl:'https://relay.example/v1'},deps);const tested=await testUnifiedConnection('deepseek',deps);assert.equal(tested.connection.relay,true);assert.equal(tested.connection.connected,true);assert.equal(tested.connection.cliInstalled,false);await saveAgentConnection('deepseek',{baseUrl:'https://second.example/v1'},deps);assert.equal(getConnectionConfig('deepseek').connected,false);assert.equal(getConnectionConfig('deepseek').models.length,0);assert.equal(isRelay('claude','https://api.anthropic.com.evil.example'),true);assert.throws(()=>validateConnectionBaseUrl('https://secret@example.com'),/密码/);assert.throws(()=>validateConnectionBaseUrl('http://example.com'),/HTTPS/);
}));
test('统一接入：晚到的测试不能让变更后的配置变绿',async()=>fixture(async(deps)=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve});deps.fetcher=async()=>{await wait;return Response.json({data:[{id:'model'}]})};await saveAgentConnection('kimi',{mode:'api',apiKey:KEY},deps);const pending=testUnifiedConnection('kimi',deps);await new Promise(resolve=>setTimeout(resolve,5));await saveAgentConnection('kimi',{model:'new-model'},deps);release();assert.equal((await pending).ok,false);assert.equal(getConnectionConfig('kimi').connected,false);
}));
test('统一接入：各API纯文字调用使用所选协议，不执行CLI',async()=>fixture(async(deps)=>{
 for(const id of ['kimi','deepseek','minimax','claude','codex'] as ConnectionId[]){
  const requests:{url:string;body:any}[]=[];deps.fetcher=async(input,init)=>{if(init?.method==='GET')return Response.json({data:[{id:'default-fixture',is_default:true}]});if(/input_tokens|count_tokens/.test(String(input)))return Response.json({input_tokens:4});const body=JSON.parse(String(init?.body));if(body.messages?.[0]?.content==='Hi')return Response.json({choices:[{message:{content:'好'}}]});requests.push({url:String(input),body});return Response.json(id==='claude'?{content:[{type:'text',text:'答案'}]}:id==='codex'?{output:[{content:[{type:'output_text',text:'答案'}]}]}:{choices:[{message:{content:'答案'}}]});};await saveAgentConnection(id,{mode:'api',enabled:true,apiKey:KEY},deps);assert.equal((await testUnifiedConnection(id,deps)).ok,true);assert.equal(await runConnectionText(id,'纯文字提示','default',undefined,deps),'答案');assert.equal(requests.length,1);assert.equal(requests[0].body.model,'default-fixture');assert.ok(!('tools' in requests[0].body));
 }
}));
test('统一接入：待适配不会假装连通，CLI必须有真实登录结果',async()=>fixture(async(deps)=>{
 for(const id of ['codebuddy'] as ConnectionId[]){await saveAgentConnection(id,{mode:'api',apiKey:KEY},deps);assert.equal((await testUnifiedConnection(id,deps)).ok,false)}
 deps.detect=async()=>'/fixture/codex';deps.cliTest=async()=>({connected:true});await saveAgentConnection('codex',{mode:'cli'},deps);assert.equal((await testUnifiedConnection('codex',deps)).ok,true);deps.cliTest=async()=>({connected:false});assert.equal((await testUnifiedConnection('codex',deps)).ok,false);
}));

test('统一接入：海螺只查询已有任务，不创建视频或回传任务内容',async()=>fixture(async(deps)=>{
 const seen:string[]=[];deps.fetcher=async(input,init)=>{seen.push(`${init?.method} ${input}`);return Response.json({items:[{id:'private-task',content:{url:'private-video'}}],total:1})};await saveAgentConnection('hailuo',{mode:'api',apiKey:KEY},deps);const result=await testUnifiedConnection('hailuo',deps);assert.equal(result.ok,true);assert.deepEqual(seen,['GET https://api.minimax.io/v2/query/video_generation?page_num=1&page_size=1']);assert.ok(!JSON.stringify(result).includes('private-task'));assert.match(result.connection.message!,/生成业务待适配/);
}));

test('一次性API连通：八家复用无生成协议，不读写配置/钥匙串，不检测或启动CLI',async()=>fixture(async(_deps,dir)=>{
 const {testTransientConnection}=await import('./agent-connections.ts');
 const configFile=path.join(dir,'connections.json');fs.writeFileSync(configFile,'刻意损坏：一次性测试不得读取');
 const seen:string[]=[];
 for(const id of ['codex','claude','kimi','deepseek','minimax','minimax-speech','dreamina','hailuo'] as ConnectionId[]){
  const result=await testTransientConnection(id,{transient:true,apiKey:KEY},{fetcher:async(input,init)=>{
   const route=new URL(String(input)).pathname;seen.push(route);assert.equal((init!.headers as Record<string,string>)[id==='claude'?'x-api-key':'Authorization'],id==='claude'?KEY:`Bearer ${KEY}`);
   if(route.endsWith('/models'))return Response.json({data:[{id:'fixture-model'}]});
   if(/input_tokens|count_tokens/.test(route))return Response.json({input_tokens:3});
   if(route.endsWith('/get_voice'))return Response.json({system_voice:[]});
   if(/tasks|query\/video_generation/.test(route))return Response.json({items:[]});
   throw Error('禁止生成请求');
  }});
  assert.equal(result.ok,true,id);assert.ok(!JSON.stringify(result).includes(KEY));
 }
 assert.equal(seen.length,10);assert.equal(fs.readFileSync(configFile,'utf8'),'刻意损坏：一次性测试不得读取');assert.deepEqual(fs.readdirSync(dir),['connections.json']);
 for(const code of [401,429,500]){const r=await testTransientConnection('codex',{transient:true,apiKey:KEY},{fetcher:async()=>new Response(KEY,{status:code})});assert.equal(r.ok,false);assert.ok(!JSON.stringify(r).includes(KEY));}
 const bad=await testTransientConnection('codex',{transient:true,apiKey:KEY,baseUrl:'https://'+KEY+'@relay.invalid'});assert.equal(bad.ok,false);assert.ok(!JSON.stringify(bad).includes(KEY));
}));

test('一次性POST测试连接入口：两版共用，Standard拒绝Pro服务，配置与钥匙串不参与',async()=>fixture(async(_deps,dir)=>{
 const {handleAgentConnectionsApi}=await import('./agent-connections-api.ts');let calls=0;
 const provider=http.createServer((req,res)=>{calls++;assert.equal(req.headers.authorization,`Bearer ${KEY}`);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url?.endsWith('models')?{data:[{id:'fixture-model'}]}:{input_tokens:3}));});
 const app=http.createServer((req,res)=>{void handleAgentConnectionsApi(req,res,req.url!.split('/').filter(Boolean),req.headers['x-test-edition']!=='Standard')});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${(app.address() as any).port}`,baseUrl=`http://127.0.0.1:${(provider.address() as any).port}`;
  for(const edition of ['Pro','Standard']){const response=await fetch(base+'/agent-connections/codex/test',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'x-test-edition':edition},body:JSON.stringify({transient:true,apiKey:KEY,baseUrl})});const data=await response.json();assert.equal(data.result.ok,true);assert.ok(!JSON.stringify(data).includes(KEY));}
  for(const edition of ['Pro','Standard']){
   const response=await fetch(base+'/agent-connections/diagnostics',{headers:{Origin:base,'x-test-edition':edition}});
   const payload=await response.json();assert.equal(response.status,200);
   assert.ok(payload.result.startsWith('OpenTake '+(edition==='Pro'?'Pro':'标准版')));
   assert.ok(payload.result.includes('Qwen Code'));assert.ok(!payload.result.includes(dir));assert.ok(!payload.result.includes(KEY));
  }
  const blocked=await fetch(base+'/agent-connections/dreamina/test',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'x-test-edition':'Standard'},body:JSON.stringify({transient:true,apiKey:KEY,baseUrl})});assert.equal(blocked.status,404);assert.equal(calls,4);assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{provider.closeAllConnections();app.closeAllConnections();await Promise.all([new Promise<void>(r=>provider.close(()=>r())),new Promise<void>(r=>app.close(()=>r()))]);}
}));

test('API轻活401撤销连接，新密钥测试成功可恢复，403权限拒绝不算未登录',async()=>fixture(async(deps)=>{
 deps.fetcher=chatFixture('fixture-model');
 await saveAgentConnection('kimi',{mode:'api',apiKey:KEY},deps);assert.equal((await testUnifiedConnection('kimi',deps)).ok,true);
 deps.fetcher=async()=>new Response('',{status:403});
 await assert.rejects(runConnectionText('kimi','纯文字','fixture-model',undefined,deps),/权限/);assert.equal(getConnectionConfig('kimi').connected,true);assert.equal(getConnectionConfig('kimi').authRejectedAt,undefined);
 deps.fetcher=async()=>new Response('',{status:401});
 await assert.rejects(runConnectionText('kimi','纯文字','fixture-model',undefined,deps),/凭据/);assert.equal(getConnectionConfig('kimi').connected,false);assert.ok(getConnectionConfig('kimi').authRejectedAt);
 await saveAgentConnection('kimi',{apiKey:KEY+'new'},deps);assert.equal(getConnectionConfig('kimi').connected,false);
 deps.fetcher=chatFixture('fixture-model');assert.equal((await testUnifiedConnection('kimi',deps)).ok,true);assert.equal(getConnectionConfig('kimi').authRejectedAt,undefined);
}));


test('API模型繁忙单独归类且保留登录，裸503不猜繁忙，错误读取有界且不泄露原文',async()=>fixture(async(deps)=>{
 deps.fetcher=chatFixture('fixture-model');
 await saveAgentConnection('kimi',{mode:'api',apiKey:KEY},deps);assert.equal((await testUnifiedConnection('kimi',deps)).ok,true);
 for(const message of ['Selected model is at capacity. Please try a different model.','overloaded']){
  deps.fetcher=async()=>Response.json({error:{message:message+' private@example.com '+KEY}},{status:503});
  await assert.rejects(runConnectionText('kimi','纯文字','fixture-model',undefined,deps),error=>{assert.equal((error as any).kind,'busy');assert.match(String(error),/这个模型现在繁忙/);assert.doesNotMatch(String(error),/private@example|fixture-key/);return true});
  assert.equal(getConnectionConfig('kimi').connected,true);assert.equal(getConnectionConfig('kimi').authRejectedAt,undefined);
 }
 deps.fetcher=async()=>new Response('',{status:503});
 await assert.rejects(runConnectionText('kimi','纯文字','fixture-model',undefined,deps),error=>{assert.equal((error as any).kind,undefined);return true});
 let cancelled=false,pulls=0;deps.fetcher=async()=>new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(20000).fill(120))},cancel(){cancelled=true}}),{status:503});
 await assert.rejects(runConnectionText('kimi','纯文字','fixture-model',undefined,deps),/HTTP 503/);assert.equal(cancelled,true);assert.ok(pulls<=2);
 deps.fetcher=async()=>Response.json({error:{message:'Your subscription does not include this model'}},{status:403});
 await assert.rejects(runConnectionText('kimi','纯文字','fixture-model',undefined,deps),error=>{assert.equal((error as any).kind,'model-plan');return true});assert.equal(getConnectionConfig('kimi').connected,true);
}));

test('拒绝和恢复发送无账号的版本通知，晚到失败不能覆盖已经恢复的API连接',async()=>fixture(async(deps)=>{
 const {onAgentConnectionStatusChanged,markAgentCredentialsRejected}=await import('./agent-connections.ts');
 const events:unknown[]=[];const off=onAgentConnectionStatusChanged(event=>events.push(event));
 try{
  deps.fetcher=chatFixture('fixture-model');
  await saveAgentConnection('kimi',{mode:'api',apiKey:KEY},deps);await testUnifiedConnection('kimi',deps);
  const connectedRevision=getConnectionConfig('kimi').revision!;assert.deepEqual(events,[{id:'kimi',revision:connectedRevision}]);
  markAgentCredentialsRejected('kimi','api',connectedRevision);const rejectedRevision=getConnectionConfig('kimi').revision!;assert.ok(rejectedRevision>connectedRevision);
  let release!:()=>void;const oldTest=testUnifiedConnection('kimi',{...deps,fetcher:async()=>{await new Promise<void>(resolve=>{release=resolve});return new Response('',{status:401})}});
  await new Promise(resolve=>setImmediate(resolve));await testUnifiedConnection('kimi',deps);const restoredRevision=getConnectionConfig('kimi').revision!;
  assert.ok(restoredRevision>rejectedRevision);release();assert.equal((await oldTest).ok,false);assert.equal(getConnectionConfig('kimi').connected,true);
  assert.deepEqual(events,[{id:'kimi',revision:connectedRevision},{id:'kimi',revision:rejectedRevision},{id:'kimi',revision:restoredRevision}]);
 }finally{off()}
}));
test('API密钥方式没找到命令行时不报「未安装」：密钥状态和命令行状态分开',async()=>fixture(async(deps)=>{
 const noCli={...deps,detect:async()=>undefined};
 const saved=await saveAgentConnection('codex',{mode:'api',apiKey:KEY},noCli);
 assert.equal(saved.cliInstalled,false);assert.equal(saved.cliAuthState,undefined);assert.notEqual(saved.message,'未安装');
 const cli=await saveAgentConnection('codex',{mode:'cli'},noCli);
 assert.equal(cli.cliAuthState,'missing');assert.equal(cli.message,'未安装');
}));

test('任务57：五家接入的官方域名、协议、前缀和完整端点在测试和轻活中一致',async()=>fixture(async deps=>{
 const examples=[
  ['codex','api.openai.com','https://api.openai.com/v1','responses'],
  ['claude','api.anthropic.com//v1///messages/','https://api.anthropic.com','anthropic'],
  ['kimi','api.moonshot.cn///chat//completions','https://api.moonshot.cn/v1','chat'],
  ['kimi','api.moonshot.ai/v1/','https://api.moonshot.ai/v1','chat'],
  ['kimi','api.kimi.ai/coding/','https://api.kimi.ai/coding','anthropic'],
  ['kimi','api.kimi.com/coding/v1/chat/completions','https://api.kimi.com/coding/v1','chat'],
  ['deepseek','https://api.deepseek.com','https://api.deepseek.com','chat'],
  ['deepseek','api.deepseek.com/v1//','https://api.deepseek.com/v1','chat'],
  ['deepseek','api.deepseek.com/anthropic','https://api.deepseek.com/anthropic','anthropic'],
  ['minimax','api.minimax.io','https://api.minimax.io/v1','chat'],
  ['minimax','api.minimax.io/anthropic/v1/messages','https://api.minimax.io/anthropic','anthropic'],
  ['kimi','relay.invalid/proxy//v1','https://relay.invalid/proxy/v1','chat'],
 ] as const;
 for(const [id,baseUrl,expected,protocol] of examples){
  const requests:string[]=[];
  deps.fetcher=async(input,init)=>{
   const url=String(input);requests.push(url);
   const headers=new Headers(init?.headers);
   assert.equal(headers.get(protocol==='anthropic'?'x-api-key':'authorization'),protocol==='anthropic'?KEY:'Bearer '+KEY);
   if(url.endsWith('/models'))return Response.json({data:[{id:'fixture',is_default:true}]});
   if(url.endsWith('tokens'))return Response.json({input_tokens:1});
   return Response.json(protocol==='anthropic'?{content:[{type:'text',text:'好'}]}:protocol==='responses'?{output:[{content:[{type:'output_text',text:'好'}]}]}:{choices:[{message:{content:'好'}}]});
  };
  const saved=await saveAgentConnection(id,{enabled:true,mode:'api',apiKey:KEY,baseUrl,model:'fixture'},deps);
  assert.equal(saved.baseUrl,expected);assert.equal(saved.protocol,protocol);
  const tested=await testUnifiedConnection(id,deps);assert.equal(tested.ok,true,tested.error);assert.deepEqual(tested.connection.lastApiTest,{category:'success',httpStatus:200});
  assert.equal(await runConnectionText(id,'问题','fixture',undefined,deps),'好');
  const prefix=expected+(protocol==='anthropic'?'/v1':'');
  assert.deepEqual(requests,[prefix+'/models',prefix+({anthropic:'/messages/count_tokens',responses:'/responses/input_tokens',chat:'/chat/completions'}[protocol]),prefix+({anthropic:'/messages',responses:'/responses',chat:'/chat/completions'}[protocol])]);
 }
}));
test('任务57：诊断区分密钥、权限、余额、地址、协议、模型、超时，记录真实状态且不泄露原始错误',async()=>fixture(async deps=>{
 await saveAgentConnection('codex',{mode:'api',apiKey:KEY,baseUrl:'relay.invalid/prefix',model:'specified'},deps);
 const cases=[
  [401,'','credentials',/密钥/],[403,'','permission',/授权/],
  [402,'','balance',/余额/],[429,'insufficient_quota','balance',/额度/],
  [404,'','address',/接口地址/],[404,'model_not_found','model',/模型 ID/],
  [400,'unsupported protocol','protocol',/协议/],[408,'','timeout',/超时/],
  [429,'rate_limit','rate-limit',/限流/],[503,'overloaded','busy',/繁忙/],
 ] as const;
 for(const [status,code,category,expected] of cases){
  deps.fetcher=async()=>Response.json({error:{code,message:KEY+' private@example.invalid'}},{status});
  const result=await testUnifiedConnection('codex',deps);assert.equal(result.ok,false);
  assert.match(result.error!,expected);assert.deepEqual(getConnectionConfig('codex').lastApiTest,{httpStatus:status,category});
  assert.doesNotMatch(JSON.stringify(result),/fixture-key|private@example/);
 }
 for(const [error,expected] of [[new TypeError('fetch failed'),'address'],[new DOMException('测试超时','TimeoutError'),'timeout']] as const){
  deps.fetcher=async()=>{throw error};
  await testUnifiedConnection('codex',deps);assert.deepEqual(getConnectionConfig('codex').lastApiTest,{category:expected});
 }
 await saveAgentConnection('codex',{apiKey:KEY+'2'},deps);assert.equal(getConnectionConfig('codex').lastApiTest,undefined);
}));
test('任务57：模型列表可读但文字协议或指定模型不通时，接入不能变绿',async()=>fixture(async deps=>{
 for(const id of ['codex','kimi'] as const){
  await saveAgentConnection(id,{mode:'api',apiKey:KEY,model:'listed'},deps);
  deps.fetcher=async(url)=>String(url).endsWith('/models')?Response.json({data:[{id:'listed'}]}):new Response('',{status:404});
  const result=await testUnifiedConnection(id,deps);
  assert.equal(result.connection.connected,false);assert.deepEqual(result.connection.lastApiTest,{httpStatus:404,category:'protocol'});
  deps.fetcher=async()=>Response.json({data:[{id:'other-model'}]});
  const missing=await testUnifiedConnection(id,deps);assert.deepEqual(missing.connection.lastApiTest,{httpStatus:200,category:'model'});
  assert.match(missing.error!,/重新选择模型/);
 }
}));
test('任务57：Messages 分页读到所选模型，也会拒绝重复游标',async()=>fixture(async deps=>{
 await saveAgentConnection('claude',{mode:'api',enabled:true,apiKey:KEY,model:'second'},deps);
 for(const repeated of [false,true]){
  const seen:string[]=[];
  deps.fetcher=async input=>{
   const route=new URL(String(input));seen.push(route.pathname+route.search);
   if(route.pathname.endsWith('count_tokens'))return Response.json({input_tokens:1});
   if(!route.search||repeated)return Response.json({data:[{id:'first'}],has_more:true,last_id:'first'});
   return Response.json({data:[{id:'second'}],has_more:false});
  };
  const result=await testUnifiedConnection('claude',deps);
  assert.equal(result.ok,!repeated);
  assert.deepEqual(seen.slice(0,2),['/v1/models','/v1/models?after_id=first']);
  if(repeated)assert.match(result.error!,/分页不完整/);
 }
}));

test('DeepSeek Harness 接入会检查账号或密钥，启动只接受卡片保存的密钥',async()=>fixture(async(deps,dir)=>{
 const {resolveAgentConnectionLaunch}=await import('./agent-connections.ts');
 const {filmAgentRedactor}=await import('./general/agent-adapter.ts');
 const {default:installations}=await import('./agent-installation.ts');
 deps.discoveryEnv=installations.sanitizeAgentEnv({PATH:'/fixture',deepseek_api_key:KEY,OPENTAKE_CODEX_API_KEY:KEY});
 assert.equal(deps.discoveryEnv.deepseek_api_key,undefined);assert.equal(deps.discoveryEnv.OPENTAKE_CODEX_API_KEY,undefined);
 let probes=0,reads=0;deps.cliTest=async()=>{probes++;return {connected:true}};deps.detect=async id=>'/fixture/'+(id==='deepseek'?'dsh':id);
 const read=deps.store!.read;deps.store!.read=async id=>{reads++;return read(id)};
 await saveAgentConnection('deepseek',{mode:'api',apiKey:KEY},deps);
 const ready=await saveAgentConnection('deepseek',{mode:'cli'},deps);
 assert.equal(ready.connected,true);assert.equal(ready.cliLoginAvailable,false);assert.equal((await testUnifiedConnection('deepseek',deps)).ok,true);
 assert.equal(reads,0);assert.ok(probes>=2);
 const dsh=await resolveAgentConnectionLaunch('deepseek',{DEEPSEEK_API_KEY:'fixture-shell-key'},deps);
 assert.deepEqual(dsh.args,['--profile','acp']);assert.equal(dsh.env.DEEPSEEK_API_KEY,KEY);
 assert.doesNotMatch(JSON.stringify(dsh.args),/fixture-key/);
 assert.equal(filmAgentRedactor(dsh.env)(KEY),'[已隐藏密钥]');
 const other=await resolveAgentConnectionLaunch('codex',{DEEPSEEK_API_KEY:'fixture-shell-key'},deps);
 assert.equal(other.env.DEEPSEEK_API_KEY,undefined);assert.equal(reads,1);
 await deleteConnectionKey('deepseek',deps);
 assert.equal((await resolveAgentConnectionLaunch('deepseek',{DEEPSEEK_API_KEY:'fixture-shell-key'},deps)).env.DEEPSEEK_API_KEY,undefined);
 assert.equal(reads,1);assert.ok(!fs.readFileSync(path.join(dir,'connections.json'),'utf8').includes(KEY));
}));
test('Codex 的 DeepSeek 官方预设选择支持 Responses 的模型，订阅和中转站保留原行为',async()=>fixture(async deps=>{
 const {resolveAgentConnectionLaunch}=await import('./agent-connections.ts');
 const {DEEPSEEK_CODEX_MODEL,deepseekCodexEndpoint}=await import('../shared/agent-connections.ts');
 deps.detect=async()=>'/fixture/codex';deps.discoveryEnv={PATH:'/fixture'};
 assert.equal(deepseekCodexEndpoint('codex','api.deepseek.com/v1/responses'),true);
 assert.equal(deepseekCodexEndpoint('codex','https://api.deepseek.com.relay.invalid'),false);
 assert.equal(isRelay('codex','https://api.deepseek.com'),false);
 const requests:{route:string;model?:string}[]=[];
 deps.fetcher=async(url,init)=>{
  const route=new URL(String(url)).pathname;
  requests.push({route,model:init?.body?JSON.parse(String(init.body)).model:undefined});
  return Response.json(route==='/models'?{data:[{id:'fake-chat-only'},{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]}:{input_tokens:1});
 };
 for(const chosen of ['default','deepseek-v4-pro','deepseek-v4-flash']){
  await saveAgentConnection('codex',{mode:'api',baseUrl:'api.deepseek.com',model:chosen,apiKey:KEY},deps);
  const result=await testUnifiedConnection('codex',deps);assert.equal(result.ok,true,result.error);
  const launch=await resolveAgentConnectionLaunch('codex',undefined,deps);
  assert.equal(launch.model,chosen==='default'?DEEPSEEK_CODEX_MODEL:chosen);
  assert.equal(requests.at(-1)?.model,launch.model);
  assert.deepEqual(launch.args.slice(0,2),['-c','model_provider="deepseek"']);
  assert.match(launch.args[3],/base_url="https:\/\/api\.deepseek\.com".*env_key="OPENTAKE_CODEX_API_KEY".*wire_api="responses"/);
  assert.equal(launch.env.OPENTAKE_CODEX_API_KEY,KEY);assert.ok(!JSON.stringify(launch.args).includes(KEY));
 }
 await saveAgentConnection('codex',{model:'fake-chat-only'},deps);
 const unsupported=await testUnifiedConnection('codex',deps);assert.equal(unsupported.ok,false);assert.match(unsupported.error!,/不支持 Codex 用的协议，请选 deepseek-flash/);
 assert.equal(unsupported.connection.lastApiTest?.category,'model');
 await assert.rejects(resolveAgentConnectionLaunch('codex',undefined,deps),/请选 deepseek-flash/);
 await assert.rejects(saveAgentConnection('codex',{baseUrl:'https://relay.invalid/v1'},deps),/新服务商的 API 密钥/);
}));

test('保存密钥自动去掉前后空格和换行；DeepSeek 控制台地址改成接口地址',()=>fixture(async(deps,_dir,keys)=>{
 const {correctProviderBaseUrl}=await import('./agent-connections.ts');
 assert.equal(correctProviderBaseUrl('https://platform.deepseek.com/api_keys'),'https://api.deepseek.com');
 assert.equal(correctProviderBaseUrl(' platform.deepseek.com '),'https://api.deepseek.com');
 assert.equal(correctProviderBaseUrl('https://api.deepseek.com'),'https://api.deepseek.com');
 assert.equal(correctProviderBaseUrl('https://relay.example/v1'),'https://relay.example/v1');
 await saveAgentConnection('kimi',{mode:'api',apiKey:`  ${KEY}\r\n`,model:'kimi-fixture'},deps);
 assert.equal(keys.get('kimi'),KEY);
 await saveAgentConnection('deepseek',{mode:'api',apiKey:KEY,baseUrl:'https://platform.deepseek.com/'},deps);
 assert.equal(getConnectionConfig('deepseek').baseUrl,'https://api.deepseek.com');
}));
