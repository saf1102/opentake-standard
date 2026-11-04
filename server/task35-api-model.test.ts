import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {defaultConnection,type ConnectionConfig,type ConnectionId} from '../shared/agent-connections.ts';
import {effectiveConnectionModel,assertConnectionModel,resolveAgentConnectionLaunch,testUnifiedConnection,runConnectionText,type ConnectionDependencies,testTransientConnection} from './agent-connections.ts';
import {filmAgentArgs,startFilmAgent} from './general/agent-adapter.ts';

const KEY='task35-fixture-not-a-real-key';
const message='服务没有声明默认模型，请在接入设置里选择模型';
async function fixture(work:(save:(id:ConnectionId,patch:Partial<ConnectionConfig>)=>void,deps:ConnectionDependencies)=>Promise<void>){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-task35-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 const file=path.join(dir,'connections.json');process.env.LINKREADER_CONNECTION_SETTINGS_FILE=file;
 const save=(id:ConnectionId,patch:Partial<ConnectionConfig>)=>fs.writeFileSync(file,JSON.stringify({[id]:{...defaultConnection(id),mode:'api',enabled:true,connected:true,hasKey:true,...patch}}));
 const deps:ConnectionDependencies={store:{read:async()=>KEY,write:async()=>{},remove:async()=>{}},detect:async()=>'/fixture/agent'};
 try{await work(save,deps)}finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(dir,{recursive:true,force:true})}
}

test('任务35：模型优先级覆盖工程 default、设置选择、声明默认、失效选择和手填模型',async()=>fixture(async(save)=>{
 const models=[{id:'configured',name:'设置模型'},{id:'declared',name:'默认模型',isDefault:true}];
 for(const id of ['codex','claude'] as const){
  save(id,{model:'configured',models});
  assert.equal(effectiveConnectionModel(id),'configured');assert.equal(effectiveConnectionModel(id,''),'configured');assert.equal(effectiveConnectionModel(id,'default'),'configured');
  assert.equal(effectiveConnectionModel(id,'declared'),'declared');assert.equal(effectiveConnectionModel(id,'removed'),'declared');
  save(id,{model:'default',models});assert.equal(effectiveConnectionModel(id,'default'),'declared');
  save(id,{model:'default',models:[{id:'configured',name:'设置模型'}]});assert.equal(effectiveConnectionModel(id),'default');
  save(id,{model:'manual',models:[]});assert.equal(effectiveConnectionModel(id,'default'),'manual');
 }
}));

test('任务35：第三方缺模型在检测及启动前拒绝，工程显式模型可用，官方默认不变',async()=>fixture(async(save,deps)=>{
 for(const id of ['codex','claude'] as const){
  save(id,{baseUrl:'https://relay.example/v1'});let detects=0;
  await assert.rejects(resolveAgentConnectionLaunch(id,{}, {...deps,detect:async()=>{detects++;return '/fixture/agent'}}),new RegExp(message));assert.equal(detects,0);
  const film={agent:id,method:'api' as const,executable:'/must-not-start',model:'default',effort:'medium'};
  const filmError=id==='claude'&&process.platform==='win32'?/Windows 的 Claude Code 出片暂未适配/:new RegExp(message);
  assert.throws(()=>filmAgentArgs(film,{work:'/fixture',lastMessage:'/fixture/out',model:'default',effort:'medium',network:false}),filmError);
  assert.throws(()=>startFilmAgent(film,[],{cwd:'/fixture',env:{},prompt:'',onEvent:()=>{}}),filmError);
  const explicit=await resolveAgentConnectionLaunch(id,{},deps,'project-model');assert.equal(explicit.model,'project-model');
  save(id,{baseUrl:defaultConnection(id).baseUrl+'/'});const official=await resolveAgentConnectionLaunch(id,{},deps);assert.equal(official.model,'default');
  if(id==='claude'&&process.platform==='win32')assert.throws(()=>filmAgentArgs({...film,...official},{work:'/fixture',lastMessage:'/fixture/out',model:'default',effort:'medium',network:false}),filmError);
  else {const args=filmAgentArgs({...film,...official},{work:'/fixture',lastMessage:'/fixture/out',model:'default',effort:'medium',network:false});assert.ok(!args.includes(id==='codex'?'-m':'--model'));}
  save(id,{baseUrl:defaultConnection(id).baseUrl+'/proxy'});assert.throws(()=>assertConnectionModel(id,'default'),new RegExp(message));
 }
}));

test('任务35：本地模拟 Responses 只对 404/405/501 回退一次，测试/出片/轻活同一模型',async()=>fixture(async(save,deps)=>{
 let status=404,fallbackStatus=200,invalid=false;const requests:{route:string;body:any}[]=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;requests.push({route:req.url!,body:raw?JSON.parse(raw):undefined});res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'first-model'},{id:'chosen-model'}]}));
  if(req.url==='/v1/responses/input_tokens'){res.statusCode=status;return res.end(JSON.stringify(status===200?{input_tokens:2}:{error:{message:KEY}}));}
  res.statusCode=fallbackStatus;res.end(JSON.stringify(invalid?{choices:[]}:fallbackStatus===200?{id:'resp_fixture',object:'response',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'好'}]}]}:{error:{message:KEY}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`;
 try{
  for(status of [404,405,501]){
   save('codex',{baseUrl,model:'chosen-model'});requests.length=0;const result=await testUnifiedConnection('codex',deps);assert.equal(result.ok,true);assert.match(result.connection.message!,/一次最小请求.*极少量额度/);
   assert.deepEqual(requests.map(r=>r.route),['/v1/models','/v1/responses/input_tokens','/v1/responses']);
   assert.deepEqual(requests[2].body,{model:'chosen-model',input:'Hi',max_output_tokens:16,store:false});
   const launch=await resolveAgentConnectionLaunch('codex',{},deps,'default');assert.equal(launch.model,'chosen-model');
   assert.equal(await runConnectionText('codex','轻活','default',undefined,deps),'好');assert.equal(requests.at(-1)!.body.model,launch.model);
  }
  for(status of [401,403,429,500,502,503]){
   save('codex',{baseUrl,model:'chosen-model'});requests.length=0;const result=await testUnifiedConnection('codex',deps);assert.equal(result.ok,false);assert.equal(requests.length,2);assert.ok(!JSON.stringify(result).includes(KEY));
  }
  status=404;fallbackStatus=404;save('codex',{baseUrl,model:'chosen-model'});requests.length=0;
  const unsupported=await testUnifiedConnection('codex',deps);assert.equal(unsupported.error,'这个接口不支持 Responses 协议，不能用于出片');assert.equal(requests.length,3);
  fallbackStatus=200;invalid=true;save('codex',{baseUrl,model:'chosen-model'});assert.match((await testUnifiedConnection('codex',deps)).error!,/返回结构不正确/);
  invalid=false;save('codex',{baseUrl,model:'default'});requests.length=0;assert.equal((await testUnifiedConnection('codex',deps)).ok,true);assert.equal(requests.length,3);
  status=200;save('codex',{baseUrl,model:'chosen-model'});requests.length=0;assert.equal((await testUnifiedConnection('codex',deps)).ok,true);assert.equal(requests.length,2);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}));

test('任务35：计数超时不回退，官方计数成功不生成，回退失败不伪报成功',async()=>fixture(async(save,deps)=>{
 for(const failure of ['timeout','401','429','500','invalid'] as const){
  let calls=0;save('codex',{model:'chosen'});
  const result=await testUnifiedConnection('codex',{...deps,fetcher:async(_input,init)=>{
   calls++;if(calls===1)return Response.json({data:[{id:'chosen'}]});if(calls===2)return new Response('',{status:404});
   if(failure==='timeout')throw Error('network timeout');if(failure==='invalid')return Response.json({id:'bad',object:'response',status:'failed',output:[]});
   assert.equal(JSON.parse(String(init?.body)).model,'chosen');return new Response('',{status:Number(failure)});
  }});assert.equal(result.ok,false);assert.equal(calls,3);
 }
 let calls=0;save('codex',{model:'chosen'});
 const timed=await testUnifiedConnection('codex',{...deps,fetcher:async()=>{calls++;if(calls===1)return Response.json({data:[{id:'chosen'}]});throw Error('timeout')}});assert.equal(timed.ok,false);assert.match(timed.error!,/超时/);assert.equal(calls,2);
 calls=0;save('codex',{});const official=await testUnifiedConnection('codex',{...deps,fetcher:async()=>{calls++;return Response.json(calls===1?{data:[{id:'listed-without-default'}]}:{input_tokens:2})}});assert.equal(official.ok,true);assert.equal(calls,2);assert.match(official.connection.message!,/未运行生成任务/);
}));

test('任务35：第三方接口没标默认模型时，测试连接用列表第一个模型验证，一次性测试也能通过',async()=>{
 const bodies:any[]=[];
 const fetcher=(async(url:string|URL|Request,init?:RequestInit)=>{
  const route=String(url);
  if(route.endsWith('/models'))return new Response(JSON.stringify({data:[{id:'first-model'},{id:'second-model'}]}));
  if(route.endsWith('/responses/input_tokens'))return new Response('{}',{status:404});
  bodies.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({id:'resp_fixture',object:'response',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]}));
 }) as typeof fetch;
 const result=await testTransientConnection('codex',{transient:true,apiKey:'fixture-key-123',baseUrl:'https://gateway.example.com/v1'},{fetcher});
 assert.equal(result.ok,true);
 assert.match(String(result.message),/最小请求/);
 assert.equal(bodies.length,1);assert.equal(bodies[0].model,'first-model');
});
