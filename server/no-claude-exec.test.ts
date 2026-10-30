/** 任务17：Claude Code 开关关闭时，检测、设置、接入测试及所有出片入口绝不执行它。
 * 静态扫描约束可执行 Claude 的代码边界，动态拦截 child_process 并使用会留标记的假 CLI。
 * 不使用订阅账号、不读取凭据，也不运行真实 Claude 出片。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import type {IncomingMessage,ServerResponse} from 'node:http';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const self=fileURLToPath(import.meta.url);
// Everything the workbench service, desktop shell, relay and build scripts are made of; historical snapshots in
// artifacts/ and third-party vendor code are not run by OpenTake.
const SCANNED=['server','desktop','scripts','shared','src','internal-service'];
function sources(dir:string):string[]{
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  if(entry.name.startsWith('.')||entry.name.startsWith('._')||entry.name==='node_modules'||entry.name==='dist')return [];
  const file=path.join(dir,entry.name);
  return entry.isDirectory()?sources(file):/\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)?[file]:[];
 });
}
const C='claude';
// A call that starts a program whose name is (or path ends in) claude, through child_process or the workbench's wrappers,
// as a program name or at the head of a shell command line.
const startsClaude=new RegExp(String.raw`\b(?:spawn|spawnSync|execFile|execFileSync|execFileAsync|exec|execSync|execAsync|fork|runWithClosedStdin|runAgent|execa)\s*\(\s*(['"\x60])(?:[^'"\x60]*[\\/])?${C}(?:\.exe)?(?:\1|\s)`);
// Options only Claude Code's own command line takes, and its login-state query.
const claudeOnly=new RegExp(String.raw`--strict-mcp-config|--setting-sources|--no-session-persistence|--dangerously-skip-permissions|--append-system-prompt|['"]auth['"]\s*,\s*['"]status['"]`);
const resolvesClaude=new RegExp(String.raw`resolveAgent\(\s*['"]${C}['"]|enhancedExecutable|runEnhancedAgent|testEnhancedAgent|enhancedAgentStatus`);

test('Claude execution is confined to explicit gated adapters',()=>{
 const files=SCANNED.flatMap(dir=>fs.existsSync(path.join(root,dir))?sources(path.join(root,dir)):[]).filter(file=>file!==self);
 assert.ok(files.length>200,`scanned only ${files.length} files`);
 const found:string[]=[];
 const gated=new Set(['server/general/agent-adapter.ts','server/agent-connections.ts','desktop/agent-installation.cjs','scripts/standard/overlays/desktop/agent-installation.cjs']);
 for(const file of files){
  const text=fs.readFileSync(file,'utf8'),name=path.relative(root,file),isTest=/\.test\.[cm]?[jt]s$/.test(name);
  text.split('\n').forEach((line,i)=>{
   if(startsClaude.test(line))found.push(`${name}:${i+1} starts claude: ${line.trim().slice(0,120)}`);
   if(!isTest&&!gated.has(name)&&claudeOnly.test(line))found.push(`${name}:${i+1} Claude Code option: ${line.trim().slice(0,120)}`);
   // Tests may check that these refuse; nothing else may name them.
   if(!isTest&&!gated.has(name)&&resolvesClaude.test(line))found.push(`${name}:${i+1} resolves claude to run: ${line.trim().slice(0,120)}`);
   // The old enhanced-agent.json (Claude Code path, model, effort) is no longer read; users' copies stay on disk.
   if(!isTest&&!/^\s*(?:\/\/|\/?\*)/.test(line)&&line.includes('enhanced-agent.json'))found.push(`${name}:${i+1} reads enhanced-agent.json`);
  });
 }
 assert.deepEqual(found,[]);
 assert.equal(fs.existsSync(path.join(root,'server','enhanced-agent.ts')),false,'the old unguarded module must not return');
 const adapter=fs.readFileSync(path.join(root,'server/general/agent-adapter.ts'),'utf8');
 assert.match(adapter,/assertAgentExecutionAllowed\(id\);[\s\S]*?startCodex\(agent.executable/);
 assert.match(adapter,/onAgentDisabled\([\s\S]*?proc.stop\(\)/);
 const connection=fs.readFileSync(path.join(root,'server/agent-connections.ts'),'utf8');
 assert.match(connection,/assertAgentExecutionAllowed\(id\);const config/);
});

test('closed switch: settings, connectivity and film launch never start Claude Code',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'cw-no-claude-'));
 const ran=path.join(home,'claude-ran');
 const fake=(file:string)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`#!/bin/sh\necho "$0 $@" >> '${ran}'\necho '2.1.300 (Claude Code)'\n`,{mode:0o755});return file};
 const bin=path.join(home,'bin');
 const onPath=fake(path.join(bin,C));
 const inApp=fake(path.join(home,'Library/Application Support/Claude/claude-code/2.1.300/build/claude.app/Contents/MacOS/claude'));
 const legacy=fake(path.join(home,'legacy',C));
 const settingsDir=path.join(home,'settings');fs.mkdirSync(settingsDir);
 const legacyConfig=path.join(settingsDir,'enhanced-agent.json'),legacyText=JSON.stringify({cliPath:legacy,model:'claude-opus-5-5',effort:'high'});
 fs.writeFileSync(legacyConfig,legacyText);
 // The login shell OpenTake reads PATH from: a stand-in that answers at once, so no real shell profile runs.
 const shell=path.join(home,'login-shell');
 fs.writeFileSync(shell,`#!/bin/sh\nprintf '__CW_LOGIN_ENV_7B31__\\0PATH=${bin}:/usr/bin:/bin\\0'\n`,{mode:0o755});
 const saved={HOME:process.env.HOME,PATH:process.env.PATH,SHELL:process.env.SHELL,LINKREADER_AGENT_SETTINGS_FILE:process.env.LINKREADER_AGENT_SETTINGS_FILE,LINKREADER_CLAUDE_EXECUTABLE:process.env.LINKREADER_CLAUDE_EXECUTABLE,LINKREADER_CONNECTION_SETTINGS_FILE:process.env.LINKREADER_CONNECTION_SETTINGS_FILE};
 Object.assign(process.env,{HOME:home,PATH:`${bin}:${process.env.PATH}`,SHELL:shell,LINKREADER_AGENT_SETTINGS_FILE:path.join(settingsDir,'agent-settings.json'),LINKREADER_CLAUDE_EXECUTABLE:onPath,LINKREADER_CONNECTION_SETTINGS_FILE:path.join(settingsDir,'connections.json')});

 // Watch every way child_process starts a program, before any workbench module captures it.
 const require=createRequire(import.meta.url);
 const cp=require('node:child_process') as typeof import('node:child_process');
 const started:string[]=[],claudeStarts:string[]=[];
 const isClaude=(file:unknown,args:unknown)=>{
  const words=[String(file??''),...(Array.isArray(args)?args.map(String):[])];
  return words.some(word=>/(?:^|[\s/\\'"=;&|])claude(?:\.exe)?(?:$|[\s'";&|])/.test(word))||[onPath,inApp,legacy].some(f=>words.some(w=>w.includes(f)));
 };
 // Nothing real runs here except the stand-in login shell and the system proxy query: every other start is recorded
 // and answered as a failure, so the test never touches Codex or any other agent installed on this computer.
 const allowed=new Set([shell,'/usr/sbin/scutil']);
 const notRun=()=>Object.assign(Error('not started in this test'),{code:'ENOENT'});
 const blocked=()=>Error('blocked: Claude Code must never be started');
 const watch=(name:'spawn'|'spawnSync'|'execFile'|'execFileSync'|'exec'|'execSync'|'fork')=>{
  const original=cp[name] as (...a:unknown[])=>unknown;
  const shellString=name==='exec'||name==='execSync';
  const watched=function(this:unknown,...a:unknown[]){
   const file=String(a[0]),args=shellString?[]:a[1];
   started.push(`${name} ${file}`);
   if(isClaude(a[0],args)){claudeStarts.push(`${name} ${file} ${JSON.stringify(Array.isArray(args)?args:[])}`);throw blocked();}
   if(allowed.has(file))return original.apply(this,a);
   if(name==='spawnSync')return {pid:0,output:[null,'',''],stdout:'',stderr:'',status:null,signal:null,error:notRun()};
   throw notRun();
  };
  const key=Symbol.for('nodejs.util.promisify.custom');
  const custom=(original as unknown as Record<symbol,unknown>)[key];
  if(typeof custom==='function')Object.defineProperty(watched,key,{value:(...a:unknown[])=>{
   const file=String(a[0]),args=shellString?[]:a[1];
   started.push(`${name} ${file}`);
   if(isClaude(a[0],args)){claudeStarts.push(`${name} ${file} ${JSON.stringify(Array.isArray(args)?args:[])}`);return Promise.reject(blocked());}
   return allowed.has(file)?(custom as (...b:unknown[])=>unknown)(...a):Promise.reject(notRun());
  }});
  (cp as unknown as Record<string,unknown>)[name]=watched;
  return ()=>{(cp as unknown as Record<string,unknown>)[name]=original};
 };
 const restores=(['spawn','spawnSync','execFile','execFileSync','exec','execSync','fork'] as const).map(watch);
 // The lowest asynchronous layer too, in case anything reaches ChildProcess directly.
 const proto=cp.ChildProcess.prototype as unknown as {spawn:(options:{file?:string;args?:string[]})=>unknown};
 const lowSpawn=proto.spawn;
 proto.spawn=function(this:unknown,options){if(isClaude(options?.file,options?.args?.slice(1))){claudeStarts.push(`ChildProcess ${options?.file}`);throw blocked();}return lowSpawn.call(this,options)};
 syncBuiltinESMExports();
 try{
  const isStandard=!fs.existsSync(path.join(root,'server/editor/api/root.ts'));
  const routeModule=isStandard?'./standard/settings-api.ts':'./editor/api/root.ts';
  const handlers=await import(routeModule);
  const handleEditorRootApi=handlers.handleEditorRootApi||handlers.handleSharedSettings;
  const call=async(method:string,route:string,body?:unknown)=>{
   const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
   Object.assign(req,{method,url:`/${route}`,headers:{host:'127.0.0.1','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});
   let text='';const res={statusCode:0,setHeader(){},end(value:string){text=value}};
   let handledBy=false,error:unknown;
   try{handledBy=await handleEditorRootApi(req,res as unknown as ServerResponse,route.split('/'))}catch(e){error=e}
   return {status:res.statusCode,handled:handledBy,error,body:text?JSON.parse(text):undefined};
  };
  // Standard uses the new unified endpoint, and does not expose the legacy Claude installation route.
  const claude=isStandard?{status:200,error:undefined,body:{result:await (await import('./agent-installations.ts')).agentInstallationStatus('claude')}}:await call('GET','agent-settings/installation/claude');
  assert.equal(claude.status,200,String(claude.error??''));
  type Candidate={path:string;status:string;version?:string};
  const candidates=claude.body.result.candidates as Candidate[];
  assert.equal(claude.body.result.state,'installed');
  assert.equal('loginCommand' in claude.body.result,false);
  assert.deepEqual(candidates.find(c=>c.path===inApp)&&{status:candidates.find(c=>c.path===inApp)!.status,version:candidates.find(c=>c.path===inApp)!.version},{status:'valid',version:'2.1.300'},'found from its file, version from its folder');
  assert.equal(candidates.find(c=>c.path===onPath)?.status,'valid','PATH and LINKREADER_CLAUDE_EXECUTABLE are looked at');
  assert.ok(!candidates.some(c=>c.path===legacy),'enhanced-agent.json is not read');
  for(const [method,route] of [['PUT','agent-settings/installation/claude'],['POST','agent-settings/installation/claude'],['POST','agent-settings/installation/claude/login'],['POST','agent-settings/installation/claude/test']]){
   const refused=await call(method,route,{cliPath:legacy});
   assert.equal(refused.status,isStandard?404:405,`${method} ${route}`);if(!isStandard)assert.match(refused.body.error,/不调用 Claude Code/);
  }
  const connections=await import('./agent-connections.ts');
  assert.throws(()=>connections.assertAgentExecutionAllowed('claude'),/开关已关闭/);
  await assert.rejects(()=>connections.resolveAgentConnectionLaunch('claude'),/开关已关闭/);
  const tested=await connections.testUnifiedConnection('claude');
  assert.equal(tested.ok,false); assert.match(tested.error||'',/开关已关闭/);
  const {startFilmAgent}=await import('./general/agent-adapter.ts');
  assert.throws(()=>startFilmAgent({agent:'claude',executable:onPath,model:'default',effort:'medium'},[],{cwd:home,env:{PATH:bin},prompt:'不应执行',onEvent(){}}),/开关已关闭/);
  // The rest of Settings › AI 与 Agent and the system settings page, run the same way.
  for(const route of ['agent-settings/installation/codex','agent-settings/roster','agent-settings','system-settings'])await call('GET',route);
  assert.ok(started.length>0,'the watch saw no program start at all');
  assert.deepEqual(claudeStarts,[]);
  assert.equal(fs.existsSync(ran),false,`Claude Code was started: ${fs.existsSync(ran)?fs.readFileSync(ran,'utf8'):''}`);
  assert.equal(fs.readFileSync(legacyConfig,'utf8'),legacyText,'the old enhanced-agent.json stays as it was');
  const tools=require('../desktop/agent-installation.cjs') as {resolveAgent:(kind:string,configured?:string)=>string};
  assert.throws(()=>tools.resolveAgent(C,onPath),/不调用 Claude Code/);
 }finally{
  proto.spawn=lowSpawn;restores.forEach(restore=>restore());syncBuiltinESMExports();
  for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  fs.rmSync(home,{recursive:true,force:true});
 }
});
