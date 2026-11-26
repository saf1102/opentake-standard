import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {connectionReadyForFilm, normalizeConnectionBaseUrl} from '../shared/agent-connections.ts';
import {refreshConnectionModels,resolveAgentConnectionLaunch,saveAgentConnection,switchBuiltinProfile,testUnifiedConnection} from './agent-connections.ts';
import {filmAgentArgs,startFilmAgent} from './general/agent-adapter.ts';
import {readAgentSettings} from './agent-settings.ts';

function identifyPicture(body:string){
 const encoded=body.match(/iVBORw0KGgo[A-Za-z0-9+/=]+/)?.[0];
 assert.ok(encoded,'每次连接测试都必须携带图片');
 const png=Buffer.from(encoded,'base64');
 const index=png.indexOf('IDAT');
 const [r,g,b]=inflateSync(png.subarray(index+4,index+4+png.readUInt32BE(index-4))).subarray(1,4);
 return r&&g?'yellow':r?'red':g?'green':b?'blue':'black';
}
test('从密钥卡片到实际 ACP 子进程：三协议、独立密钥、错误分类及工程内出片',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'task58-内置 测试-'));
 const work=path.join(temp,'工程 A');fs.mkdirSync(work);
 const previous=[process.env.LINKREADER_CONNECTION_SETTINGS_FILE,process.env.LINKREADER_AGENT_SETTINGS_FILE];
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(temp,'connections.json');
 process.env.LINKREADER_AGENT_SETTINGS_FILE=path.join(temp,'settings.json');
 const vault=new Map<string,string>();
 const store={read:async(id:string)=>vault.get(id)||'',write:async(id:string,key:string)=>{assert.match(id,/^[a-z][a-z0-9-]{0,40}$/);vault.set(id,key)},remove:async(id:string)=>{vault.delete(id)}};
 let status=200, silent=false,wrongColor=false, turns=0;const requests:{route:string;key?:string}[]=[];
 let cancelRun=false;
 const server=http.createServer(async(req,res)=>{
  const buffers=[];for await(const chunk of req)buffers.push(chunk);
  const raw=Buffer.concat(buffers).toString(), route=req.url||'';
  requests.push({route,key:String(req.headers.authorization||req.headers['x-api-key'])});
  if(silent)return;
  if(status!==200){res.writeHead(status);return res.end('{}')}
  if(route.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'vision-local'}]}));
  if(JSON.parse(raw).stream){
   const command=cancelRun?'node wait.cjs':'ffmpeg -hide_banner -loglevel error -f lavfi -i color=blue:s=64x64:r=2 -frames:v 2 -c:v mpeg4 fixture.mp4';
   const tool=turns++===0;
   const delta=tool?{role:'assistant',tool_calls:[{index:0,id:'call-render',type:'function',function:{name:process.platform==='win32'?'powershell':'bash',arguments:JSON.stringify({command})}}]}:{role:'assistant',content:'成片已生成'};
   const emit=(delta:unknown,finish_reason:string|null)=>JSON.stringify({id:'local',model:'vision-local',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}],usage:{prompt_tokens:9,completion_tokens:4}});
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   return res.end('data: '+emit(delta,null)+'\n\ndata: '+emit({},tool?'tool_calls':'stop')+'\n\ndata: [DONE]\n\n');
  }
  const text=wrongColor?'没有收到图片':identifyPicture(raw);
  const result=route.endsWith('/messages')?{content:[{type:'text',text}]}:route.endsWith('/responses')?{output:[{type:'message',content:[{type:'output_text',text}]}]}:{choices:[{message:{content:text}}]};
  res.end(JSON.stringify(result));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const [i,key] of ['LINKREADER_CONNECTION_SETTINGS_FILE','LINKREADER_AGENT_SETTINGS_FILE'].entries()){if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i]}fs.rmSync(temp,{recursive:true,force:true})});
 const port=(server.address() as {port:number}).port;
 const baseUrl='http://127.0.0.1:'+port+'/v1';
 const beforeSetup=readAgentSettings();
 assert.notEqual(beforeSetup.modules.generalEditing.agent,'builtin');
 await assert.rejects(saveAgentConnection('builtin',{baseUrl,apiKey:'fixture-denied',model:'vision-local'},{store:{...store,write:async()=>{throw Error('无法保存到系统钥匙串')}}}),/无法保存到系统钥匙串/);
 assert.deepEqual(readAgentSettings(),beforeSetup);
 for(const format of ['responses','anthropic','chat']){
  const view=await saveAgentConnection('builtin',{baseUrl,format,apiKey:'fixture-key-alpha',model:'vision-local'},{store});
  assert.equal(view.cliInstalled,false);
  assert.equal((await refreshConnectionModels('builtin',{store}))[0].id,'vision-local');
  const tested=await testUnifiedConnection('builtin',{store});
  assert.ok(tested.ok,tested.error);
  assert.ok(connectionReadyForFilm(tested.connection));
  assert.equal(requests.at(-1)?.route,'/v1/'+({responses:'responses',anthropic:'messages',chat:'chat/completions'}[format]));
 }
 assert.equal(readAgentSettings().modules.generalEditing.agent,'builtin');
 const modules=readAgentSettings().modules;
 assert.equal(modules.captionTranslation.agent,'builtin');
 if('roughcut' in modules)assert.equal((modules.roughcut as {agent:string}).agent,'builtin');
 assert.equal(normalizeConnectionBaseUrl('builtin','https://api.openai.com'),'https://api.openai.com/v1');
 const second=await switchBuiltinProfile();assert.equal(second.hasKey,false);
 await saveAgentConnection('builtin',{baseUrl,apiKey:'fixture-key-beta',model:'vision-local'},{store});
 await testUnifiedConnection('builtin',{store});
 assert.equal(requests.at(-1)?.key,'Bearer fixture-key-beta');
 await assert.rejects(resolveAgentConnectionLaunch('builtin',undefined,{store},'vision-local','main'),/已切换/);
 await switchBuiltinProfile('main');
 for(const [code,category] of [[401,'credentials'],[403,'permission'],[402,'balance'],[404,'address'],[429,'rate-limit']] as const){
  status=code;const result=await testUnifiedConnection('builtin',{store});assert.equal(result.connection.lastApiTest?.category,category);
  await assert.rejects(resolveAgentConnectionLaunch('builtin',undefined,{store}),/看图测试/);
 }
 status=200;silent=true;assert.equal((await testUnifiedConnection('builtin',{store,timeoutMs:50})).connection.lastApiTest?.category,'timeout');silent=false;
 wrongColor=true;assert.match((await testUnifiedConnection('builtin',{store})).error||'',/换用/);wrongColor=false;
 assert.ok((await testUnifiedConnection('builtin',{store})).ok);
 const launch=await resolveAgentConnectionLaunch('builtin',{UNRELATED_SECRET:'private-fixture'},{store});
 assert.equal(launch.env.UNRELATED_SECRET,undefined);
 const agent={...launch,agent:'builtin' as const,effort:'none'};
 const lastMessage=path.join(work,'result.txt'),eventLog=path.join(work,'events.jsonl');
 const args=filmAgentArgs(agent,{work,lastMessage,effort:'none',model:launch.model,network:false});
 const seen:Record<string,unknown>[]=[];
 const proc=startFilmAgent(agent,args,{cwd:work,env:launch.env,lastMessage,eventLog,prompt:'请生成测试短片',onEvent:e=>seen.push(e)});
 const result=await proc.done;
 assert.equal(result.code,0,result.stderr);
 assert.equal(requests.at(-1)?.key,'Bearer fixture-key-alpha');
 assert.ok(seen.some(e=>e.type==='acp.permission'&&e.allowed===true));
 assert.ok(seen.some(e=>e.type==='acp.completed'&&e.usage));
 const stream=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',path.join(work,'fixture.mp4')],{encoding:'utf8'})).streams[0];
 assert.equal(stream.width,64);assert.equal(stream.nb_frames,'2');
 const clip=fs.readFileSync(path.join(work,'fixture.mp4'));
 t.diagnostic(`工程内视频 ${stream.width}×${stream.height}，${stream.nb_frames} 帧，${clip.length} 字节，SHA-256 ${createHash('sha256').update(clip).digest('hex')}`);
 // Exercise cancellation with a real SDK command still running, including its shell descendant.
 cancelRun=true;turns=0;
 fs.writeFileSync(path.join(work,'wait.cjs'),"require('node:fs').writeFileSync('worker.pid',String(process.pid));setInterval(()=>{},1000)");
 const running=startFilmAgent(agent,args,{cwd:work,env:launch.env,prompt:'运行本工程的合成等待任务',onEvent:()=>{}});
 let pid=0;
 try{
  const file=path.join(work,'worker.pid');
  for(let i=0;i<200&&!fs.existsSync(file);i++)await new Promise(r=>setTimeout(r,25));
  pid=Number(fs.readFileSync(file,'utf8'));
  running.stop();await running.done;
  for(let i=0;i<100;i++){try{process.kill(pid,0)}catch{break}await new Promise(r=>setTimeout(r,20))}
  assert.throws(()=>process.kill(pid,0));
 }finally{running.stop();if(pid)try{process.kill(pid,'SIGKILL')}catch{/* already reaped */}}
 const existing=readAgentSettings();existing.modules.generalEditing={agent:'kimi',model:'default',effort:'none'};
 fs.writeFileSync(process.env.LINKREADER_AGENT_SETTINGS_FILE!,JSON.stringify(existing));
 assert.ok((await testUnifiedConnection('builtin',{store})).ok);
 assert.deepEqual(readAgentSettings().modules.generalEditing,existing.modules.generalEditing);
 for(const file of [eventLog,...fs.readdirSync(temp).filter(f=>f.endsWith('json')).map(f=>path.join(temp,f))])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/fixture-key/);
});
