import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {defaultAgentSettings} from '../src/studio/agent-settings.ts';
import {readAgentSettings,saveAgentSettings,recentAgentRuns,validateAgentChoice} from './agent-settings.ts';
import {resolveAgent,runAgent} from './agent-runtime.ts';

test('empty catalog is an explicit error',()=>{
 assert.throws(()=>validateAgentChoice('generalEditing',defaultAgentSettings(),{executable:'fixture',cliVersion:'test',checkedAt:'',models:[]}),/没有返回可选模型/);
});
test('fake Codex uses default, preserves requested and settings, rejects unsupported effort', {skip:process.platform==='win32'?'POSIX subprocess fixture; Windows native CLI acceptance required':false},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standard-model-'));
 const previous=process.env.LINKREADER_AGENT_SETTINGS_FILE;
 process.env.LINKREADER_AGENT_SETTINGS_FILE=path.join(root,'settings.json');
 const cli=path.join(root,'codex fixture');
 const models=[{model:'first-model',displayName:'First',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]},
 {model:'gpt-6.1-sol',displayName:'GPT-6.1-Sol',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}];
 fs.writeFileSync(cli,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex-cli fixture');process.exit(0)}
if(args[0]==='app-server')require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.method==='initialize')console.log(JSON.stringify({id:q.id,result:{}}));if(q.method==='model/list')console.log(JSON.stringify({id:q.id,result:{data:${JSON.stringify(models)},nextCursor:null}}));});
else {fs.writeFileSync(${JSON.stringify(path.join(root,'argv.json'))},JSON.stringify(args));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({ok:true}));console.error('model: '+args[args.indexOf('-m')+1]);console.error('reasoning effort: medium');}
`,{mode:0o700});
 try{
  assert.ok(Object.values(readAgentSettings().modules).every(c=>c.model==='default'));
  const settings=defaultAgentSettings();settings.cliPath=cli;
  settings.modules.generalEditing={model:'gpt-6-astra',effort:'ultra'};
  await saveAgentSettings(settings);
  const before=fs.readFileSync(process.env.LINKREADER_AGENT_SETTINGS_FILE,'utf8');
  const agent=await resolveAgent('generalEditing');
  assert.equal(agent.model,'gpt-6.1-sol');assert.equal(agent.effort,'medium');
  await runAgent(agent,['exec','--output-last-message',path.join(root,'result.json'),'fixture']);
  const argv=JSON.parse(fs.readFileSync(path.join(root,'argv.json'),'utf8'));
  assert.equal(argv[argv.indexOf('-m')+1],'gpt-6.1-sol');
  const record=recentAgentRuns()[0];assert.equal(record.status,'completed');assert.deepEqual(record.requested,settings.modules.generalEditing);
  assert.equal(fs.readFileSync(process.env.LINKREADER_AGENT_SETTINGS_FILE,'utf8'),before);
  console.log(JSON.stringify({evidence:'fake Codex only',argv:['exec','-m',agent.model,'-c',`model_reasoning_effort="${agent.effort}"`],run:{module:record.module,model:record.model,effort:record.effort,requested:record.requested,status:record.status}}));
  settings.modules.generalEditing={model:'gpt-6.1-sol',effort:'ultra'};
  await assert.rejects(saveAgentSettings(settings),/不支持推理强度/);
  assert.equal(fs.readFileSync(process.env.LINKREADER_AGENT_SETTINGS_FILE,'utf8'),before);
 }finally{if(previous===undefined)delete process.env.LINKREADER_AGENT_SETTINGS_FILE;else process.env.LINKREADER_AGENT_SETTINGS_FILE=previous;fs.rmSync(root,{recursive:true,force:true});}
});
