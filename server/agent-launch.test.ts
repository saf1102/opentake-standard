import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile as rawExecFile} from 'node:child_process';
import {promisify} from 'node:util';
import {agentLaunch,spawnAgentProcess} from './agent-launch.ts';
import {execFileAsync,runWithClosedStdin} from './proc.ts';
import {windowsAgentScript} from './windows-agent-terminal.ts';
import {ROSTER_AGENTS,rosterAgentStatus} from './agent-roster.ts';
import {setAgentProgramPath} from './agent-management.ts';
import {probeAcpAuthentication} from './agent-auth-probe.ts';
import {defaultConnection,connectionReadyForFilm} from '../shared/agent-connections.ts';
import installations from './agent-installation.ts';

test('batch launch disables AutoRun/delayed expansion and never uses shell:true',()=>{
 const args=['中文 空格','x & echo unsafe','%PATH%','a^b','say "hello"','trailing\\',''];
 const env={SystemRoot:'C:\\Windows',PATH:'test'};
 const spec=agentLaunch('D:\\中文 & %PATH%\\dsh.cmd',args,{env},'win32');
 assert.equal(spec.file,'C:\\Windows\\System32\\cmd.exe');
 assert.deepEqual(spec.args.slice(0,4),['/d','/s','/v:off','/c']);
 assert.equal(spec.options.shell,false);assert.equal(spec.options.windowsVerbatimArguments,true);
 assert.doesNotMatch(spec.args[4],/%PATH%/);assert.equal(Object.keys(env).length,2);
 assert.throws(()=>agentLaunch('a.cmd',['ok\nwhoami'],{},'win32'));
 assert.deepEqual(agentLaunch('/tmp/cli',['line\nnext'],{},'darwin').args,['line\nnext']);
 assert.equal(agentLaunch('C:\\cli.exe',args,{},'win32').file,'C:\\cli.exe');
});

test('Windows cmd/bat paths and argv roundtrip, login, discovery, validation and ACP use real subprocesses',{skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-batch-'));
 const bin=path.join(root,'中文 空格 & ^ %PATH% !');fs.mkdirSync(bin);
 const old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 try{
  const script=path.join(root,'fixture.cjs');
  fs.writeFileSync(script,`const args=process.argv.slice(2);if(args[0]==='--version')console.log('codex-cli 1.2.3');else if(args[0]==='--acp'){require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result:r.method==='initialize'?{protocolVersion:1}:{sessionId:'fixture'}}))})}else console.log(JSON.stringify(args));`);
  const args=['中文 空格','a&b','a^b','%PATH%','%UNSET%','say "hello"','x" & echo INJECTED>sentinel & rem "','!name!','x|y','<input>','trailing\\',''];
  const cmd=path.join(bin,'dsh.cmd');
  for(const ext of ['cmd','bat']){
   const file=path.join(bin,'dsh.'+ext);
   fs.writeFileSync(file,`@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
   assert.deepEqual(JSON.parse((await execFileAsync(file,args,{cwd:root})).stdout),args);
   assert.deepEqual(JSON.parse((await runWithClosedStdin(file,args,{cwd:root,timeout:8000})).stdout),args);
   const actual=await new Promise<string>((resolve,reject)=>{let text='';const child=spawnAgentProcess(file,args,{cwd:root,stdio:['ignore','pipe','pipe']});child.stdout!.on('data',chunk=>text+=chunk);child.once('error',reject);child.once('close',code=>code===0?resolve(text):reject(Error(String(code))));});
   assert.deepEqual(JSON.parse(actual),args);assert.equal(fs.existsSync(path.join(root,'sentinel')),false);
  }
  const result=path.join(root,'exit-code');
  const ps=path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const login=await promisify(rawExecFile)(ps,['-NoProfile','-Command',windowsAgentScript(cmd,args,result)],{encoding:'utf8',timeout:10000,cwd:root});
  assert.deepEqual(JSON.parse(login.stdout.split(/\r?\n/)[0]),args);assert.equal(fs.readFileSync(result,'utf8').trim(),'0');
  assert.equal((await probeAcpAuthentication(cmd,['--acp'],{tempRoot:root,timeoutMs:8000})).state,'connected');
  const agent=ROSTER_AGENTS.find(item=>item.id==='deepseek')!;
  const found=await rosterAgentStatus(agent,{home:root,applicationDirs:[],env:{...process.env,PATH:bin}});
  assert.equal(found.executable,cmd);assert.equal(found.state,'found');assert.match(found.version!,/1.2.3/);
  let saved='';const validated=await setAgentProgramPath('deepseek',cmd,{assertAllowed:()=>{},save:async(id,patch)=>{saved=patch.cliPath;return {...defaultConnection(id),id,name:'DeepSeek',kind:'agent',cliInstalled:true,heavySupported:false,state:'pending',protocol:'chat',relay:false};}});
  assert.equal(validated.version,'1.2.3');assert.equal(saved,cmd);assert.equal(connectionReadyForFilm({...validated.connection,connected:true}),false);
  fs.copyFileSync(cmd,path.join(bin,'codex.cmd'));
  assert.equal(installations.detectAgent('codex',{configured:path.join(bin,'codex.cmd'),env:{...process.env},home:root,applicationDirs:[]}).state,'installed');
  for(const key of ['APPDATA','LOCALAPPDATA']){
   const folder=path.join(root,key,key==='APPDATA'?'npm':'Programs');fs.mkdirSync(folder,{recursive:true});fs.copyFileSync(cmd,path.join(folder,'dsh.cmd'));
   const detected=await rosterAgentStatus(agent,{home:root,applicationDirs:[],env:{[key]:path.join(root,key),PATH:''},readVersion:false});assert.equal(detected.executable,path.join(folder,'dsh.cmd'));
  }
 }finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true});}
});
