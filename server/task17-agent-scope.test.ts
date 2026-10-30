import test from 'node:test';import assert from 'node:assert/strict';
import {withAgentChoiceScope,currentAgentChoice} from './agent-runtime.ts';
import {defaultAgentSettings} from '../src/studio/agent-settings.ts';
test('工作模块作用域：并发工程和稿子各自选择，嵌套保留其他模块，退出不改全局设置',async()=>{
 const defaults=defaultAgentSettings(),original=structuredClone(defaults);
 const values=await Promise.all(['first','second'].map(model=>withAgentChoiceScope({captionTranslation:{agent:'kimi',model,effort:'none'}},async()=>{await new Promise(resolve=>setTimeout(resolve,model==='first'?8:1));const before=currentAgentChoice('captionTranslation',defaults);const nested=await withAgentChoiceScope({generalEditing:{agent:'claude',model:'claude-fixture',effort:'medium'}},async()=>({caption:currentAgentChoice('captionTranslation',defaults),film:currentAgentChoice('generalEditing',defaults)}));return {before,nested};})));
 assert.equal(values[0].before.model,'first');assert.equal(values[1].before.model,'second');assert.equal(values[0].nested.caption.model,'first');assert.equal(values[1].nested.film.agent,'claude');assert.deepEqual(currentAgentChoice('captionTranslation',defaults),original.modules.captionTranslation);assert.deepEqual(defaults,original);
});

test('API-only Codex：纯文字解析与执行完全不检测CLI，取消信号到达网络请求',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {resolveAgent,runAgent}=await import('./agent-runtime.ts');const {default:installations}=await import('./agent-installation.ts');
 const {defaultConnection}=await import('../shared/agent-connections.ts');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task17-api-only-'));const previousSettings=process.env.LINKREADER_AGENT_SETTINGS_FILE,previousConnections=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_AGENT_SETTINGS_FILE=path.join(dir,'settings.json');process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(dir,'connections.json');
 const oldDetect=installations.detectAgent;let detections=0;installations.detectAgent=()=>{detections++;throw Error('API纯文字不得检测命令行')};
 try{
  fs.writeFileSync(process.env.LINKREADER_CONNECTION_SETTINGS_FILE,JSON.stringify({codex:{...defaultConnection('codex'),mode:'api',enabled:true,hasKey:true,connected:true,model:'api-model',models:[{id:'api-model',name:'API模型',isDefault:true}]}}));
  const settings=defaultAgentSettings();settings.cliPath='/definitely-not-installed/codex';settings.modules.captionTranslation={agent:'codex',model:'default',effort:'medium'};
  const agent=await resolveAgent('captionTranslation',settings);assert.equal(agent.executable,'');assert.equal(agent.model,'api-model');assert.equal(detections,0);
  const requests:string[]=[];const store={async read(){return 'fake-isolated-key-123'},async write(){},async remove(){}};
  const output=path.join(dir,'answer.json');await runAgent(agent,['exec','--output-last-message',output,'翻译为中文'],{},undefined,{store,fetcher:async(input,init)=>{requests.push(String(input));assert.equal(JSON.parse(String(init?.body)).model,'api-model');return Response.json({output:[{content:[{type:'output_text',text:'{"text":"你好"}'}]}]})}});
  assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),{text:'你好'});assert.deepEqual(requests,['https://api.openai.com/v1/responses']);assert.equal(detections,0);
  const controller=new AbortController();let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve});let aborted=false;
  const running=runAgent(agent,['exec','--output-last-message',path.join(dir,'cancelled.json'),'等待取消'],{signal:controller.signal},undefined,{store,fetcher:async(_input,init)=>new Promise<Response>((_resolve,reject)=>{entered();init?.signal?.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'))},{once:true})})});
  await started;controller.abort();await assert.rejects(running,/API 调用失败/);assert.equal(aborted,true);assert.equal(fs.existsSync(path.join(dir,'cancelled.json')),false);assert.equal(detections,0);
 }finally{installations.detectAgent=oldDetect;if(previousSettings===undefined)delete process.env.LINKREADER_AGENT_SETTINGS_FILE;else process.env.LINKREADER_AGENT_SETTINGS_FILE=previousSettings;if(previousConnections===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=previousConnections;fs.rmSync(dir,{recursive:true,force:true})}
});


test('API 子进程分块输出：跨 chunk 密钥和末尾残行不进入日志或回调',async()=>{
 const {bufferedAgentOutput}=await import('./agent-runtime.ts');
 const secret='fixture-api-key-must-stay-private';const chunks:string[]=[];
 const sink=bufferedAgentOutput(text=>text.split(secret).join('[密钥已隐藏]'),text=>chunks.push(text));
 sink.push('before '+secret.slice(0,7));assert.deepEqual(chunks,[]);
 sink.push(secret.slice(7)+' after\nsecond '+secret.slice(0,12));assert.deepEqual(chunks,['before [密钥已隐藏] after\n']);
 sink.push(secret.slice(12));sink.flush();sink.flush();
 assert.deepEqual(chunks,['before [密钥已隐藏] after\n','second [密钥已隐藏]']);assert.ok(!chunks.join('').includes(secret));
});
