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
 try{await saveAgentConnection('codex',{mode:'api',apiKey:KEY,baseUrl:`http://127.0.0.1:${address.port}/v1`},deps);assert.equal((await testUnifiedConnection('codex',deps)).ok,true);assert.equal(getConnectionConfig('codex').models[0].id,'test-model');for(const [value,match] of [['401','密钥'],['402','余额'],['404','格式'],['format','格式'],['timeout','超时']]){scenario=value;const result=await testUnifiedConnection('codex',{...deps,timeoutMs:40});assert.equal(result.ok,false);assert.match(result.error!,new RegExp(match));assert.ok(!JSON.stringify(result).includes(KEY));}assert.ok(requests.every(req=>req==='GET /v1/models'||req==='POST /v1/responses/input_tokens'));}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}));
test('统一接入：代理提醒不阻止已验证API，改地址/密钥会使原连接失效',async()=>fixture(async(deps)=>{
 deps.fetcher=async()=>Response.json({data:[{id:'deepseek-test'}]});await saveAgentConnection('deepseek',{mode:'api',apiKey:KEY,baseUrl:'https://relay.example/v1'},deps);const tested=await testUnifiedConnection('deepseek',deps);assert.equal(tested.connection.relay,true);assert.equal(tested.connection.connected,true);assert.equal(tested.connection.cliInstalled,false);await saveAgentConnection('deepseek',{baseUrl:'https://second.example/v1'},deps);assert.equal(getConnectionConfig('deepseek').connected,false);assert.equal(getConnectionConfig('deepseek').models.length,0);assert.equal(isRelay('claude','https://api.anthropic.com.evil.example'),true);assert.throws(()=>validateConnectionBaseUrl('https://secret@example.com'),/密码/);assert.throws(()=>validateConnectionBaseUrl('http://example.com'),/HTTPS/);
}));
test('统一接入：晚到的测试不能让变更后的配置变绿',async()=>fixture(async(deps)=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve});deps.fetcher=async()=>{await wait;return Response.json({data:[{id:'model'}]})};await saveAgentConnection('kimi',{mode:'api',apiKey:KEY},deps);const pending=testUnifiedConnection('kimi',deps);await new Promise(resolve=>setTimeout(resolve,5));await saveAgentConnection('kimi',{model:'new-model'},deps);release();assert.equal((await pending).ok,false);assert.equal(getConnectionConfig('kimi').connected,false);
}));
test('统一接入：各API纯文字调用使用所选协议，不执行CLI',async()=>fixture(async(deps)=>{
 for(const id of ['kimi','deepseek','minimax','claude','codex'] as ConnectionId[]){
  const requests:{url:string;body:any}[]=[];deps.fetcher=async(input,init)=>{if(init?.method==='GET')return Response.json({data:[{id:'default-fixture',is_default:true}]});if(/input_tokens|count_tokens/.test(String(input)))return Response.json({input_tokens:4});requests.push({url:String(input),body:JSON.parse(String(init?.body))});return Response.json(id==='claude'?{content:[{type:'text',text:'答案'}]}:id==='codex'?{output:[{content:[{type:'output_text',text:'答案'}]}]}:{choices:[{message:{content:'答案'}}]});};await saveAgentConnection(id,{mode:'api',enabled:true,apiKey:KEY},deps);assert.equal((await testUnifiedConnection(id,deps)).ok,true);assert.equal(await runConnectionText(id,'纯文字提示','default',undefined,deps),'答案');assert.equal(requests.length,1);assert.equal(requests[0].body.model,'default-fixture');assert.ok(!('tools' in requests[0].body));
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
  const blocked=await fetch(base+'/agent-connections/dreamina/test',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'x-test-edition':'Standard'},body:JSON.stringify({transient:true,apiKey:KEY,baseUrl})});assert.equal(blocked.status,404);assert.equal(calls,4);assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{provider.closeAllConnections();app.closeAllConnections();await Promise.all([new Promise<void>(r=>provider.close(()=>r())),new Promise<void>(r=>app.close(()=>r()))]);}
}));
