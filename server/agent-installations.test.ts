import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {agentInstallationStatus} from './agent-installations.ts';
test('installation status distinguishes ready, logged-out, invalid and auth failure without credentials',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-auth-status-'));
 const fixture=(name:string,version:string,body:string)=>{const file=path.join(dir,name);fs.writeFileSync(file,`#!${process.execPath}\nif(process.argv[2]==='--version'){console.log(${JSON.stringify(version)});}else{${body}}`,{mode:0o700});return file};
 try{
  const codex=fixture('codex','codex-cli 1.0.0',"console.error('Logged in using ChatGPT')");
  assert.equal((await agentInstallationStatus('codex',codex)).state,'ready');
  const loggedOut=fixture('codex-logged-out','codex-cli 1.0.0',"console.error('Not logged in');process.exitCode=1;");
  assert.equal((await agentInstallationStatus('codex',loggedOut)).state,'needs-login');
  const bad=fixture('codex-bad','codex-cli 1.0.0',"console.error('network unavailable');process.exitCode=1;");
  assert.equal((await agentInstallationStatus('codex',bad)).state,'unknown');
  assert.equal((await agentInstallationStatus('codex',path.join(dir,'missing'))).state,'invalid');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('Claude Code is found from its file alone and never run, not even for its version or login state',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-claude-file-'));
 const ran=path.join(dir,'ran');
 // Any start of this program leaves a mark; detection must leave none.
 const claude=path.join(dir,'claude');fs.writeFileSync(claude,`#!/bin/sh\necho "$@" >> '${ran}'\necho '2.1.300 (Claude Code)'\n`,{mode:0o755});
 try{
  const status=await agentInstallationStatus('claude',claude);
  assert.equal(status.state,'installed');assert.equal(status.executable,claude);
  assert.equal('loginCommand' in status,false);assert.equal(fs.existsSync(ran),false);
  assert.equal((await agentInstallationStatus('claude',path.join(dir,'missing'))).state,'invalid');
  fs.chmodSync(claude,0o644);
  assert.equal((await agentInstallationStatus('claude',claude)).state,'invalid','a file that cannot be executed is not an installation');
  assert.equal(fs.existsSync(ran),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('a saved Codex path stays pinned when unavailable until the user clears it',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-stale-codex-')),before=process.env.LINKREADER_AGENT_SETTINGS_FILE;
 const settingsFile=path.join(dir,'agent-settings.json');process.env.LINKREADER_AGENT_SETTINGS_FILE=settingsFile;
 const {defaultAgentSettings}=await import('../src/studio/agent-settings.ts');const {resolveCliPath,readAgentSettings}=await import('./agent-settings.ts');
 // What 0.2.x saved: the Codex bundled inside the old app, which 1.0.0 no longer ships.
 const stale='/Applications/OpenTake.app/Contents/Resources/runtime/support/bin/codex';
 const codex=path.join(dir,'bin','codex');fs.mkdirSync(path.dirname(codex));
 fs.writeFileSync(codex,`#!${process.execPath}\nif(process.argv[2]==='--version'){console.log('codex-cli 1.0.0');}else{console.error('Logged in using ChatGPT')}`,{mode:0o755});
 const options={home:dir,env:{HOME:dir,PATH:path.dirname(codex)},applicationDirs:[path.join(dir,'Applications')]};
 try{
  fs.writeFileSync(settingsFile,JSON.stringify({...defaultAgentSettings(),cliPath:stale}));
  const status=await agentInstallationStatus('codex',undefined,options);
  assert.equal(status.executable,undefined);assert.equal(status.mode,'manual');assert.equal(status.state,'invalid');
  assert.match(status.error||'',/手动路径/);
  assert.equal(readAgentSettings().cliPath,stale);
  assert.throws(()=>resolveCliPath(stale));
  assert.equal((await agentInstallationStatus('codex','',options)).executable,codex);
  assert.equal((await agentInstallationStatus('codex',path.join(dir,'missing'),options)).state,'invalid','a path being typed in is not replaced');
  fs.writeFileSync(settingsFile,JSON.stringify({...defaultAgentSettings(),cliPath:path.join(dir,'gone')}));
  assert.throws(()=>resolveCliPath(path.join(dir,'other')),'an unavailable path never selects another binary');
 }finally{if(before===undefined)delete process.env.LINKREADER_AGENT_SETTINGS_FILE;else process.env.LINKREADER_AGENT_SETTINGS_FILE=before;fs.rmSync(dir,{recursive:true,force:true})}
});
