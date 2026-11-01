/** 本机智能体管理：固定官方命令，账号切换按退出、关闭会话、登录顺序执行。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {connectionDefinition,type ConnectionId,type AgentConnectionId,type ConnectionView} from '../shared/agent-connections.ts';
import {assertAgentExecutionAllowed,detectConnectionExecutable,getConnectionConfig,refreshAgentConnection,saveAgentConnection,markAgentCredentialsRejected,setAgentAccountChanging} from './agent-connections.ts';
import {ROSTER_AGENTS,isClaudeExecutable,rosterExecutableCandidates} from './agent-roster.ts';
import {CODEX_INSTALL_COMMAND} from './agent-installations.ts';
import installations from './agent-installation.ts';
import {agentLoginManager} from './agent-login.ts';

const exec=promisify(execFile);
const quoteShell=(value:string)=>`'${value.replace(/'/g,`'\\''`)}'`;
const quoteApple=(value:string)=>`"${value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
const assertAgent=(id:ConnectionId)=>{if(connectionDefinition(id).kind!=='agent')throw Error('这里只能管理智能体程序');};
export type AgentManagementDeps={
 assertAllowed?:(id:ConnectionId)=>void;detect?:(id:ConnectionId)=>Promise<string|undefined>;
 refresh?:(id:ConnectionId)=>Promise<ConnectionView>;save?:(id:ConnectionId,input:{cliPath:string})=>Promise<ConnectionView>;
 version?:(file:string)=>Promise<string>;terminal?:(script:string)=>Promise<string>;
 exitCode?:(file:string)=>number|undefined;closeSessions?:(id:ConnectionId)=>Promise<void>;rejectCredentials?:(id:ConnectionId)=>void;
 loginStart?:(id:ConnectionId)=>Promise<{waiting:boolean;connection:ConnectionView}>;loginCheck?:(id:ConnectionId)=>Promise<{waiting:boolean;connection:ConnectionView}>;loginCancel?:(id:ConnectionId)=>Promise<unknown>;
 platform?:NodeJS.Platform;pollMs?:number;timeoutMs?:number;now?:()=>number;
};
const terminal=async(script:string)=>{try{return (await exec('/usr/bin/osascript',['-e',script],{timeout:8000,maxBuffer:4096})).stdout.trim()}catch{throw Error('无法控制终端，请检查系统自动化权限后重试');}};
const detect=(id:ConnectionId,deps:AgentManagementDeps)=>(deps.detect??detectConnectionExecutable)(id);
const refresh=(id:ConnectionId,deps:AgentManagementDeps)=>(deps.refresh??refreshAgentConnection)(id);
const allowed=(id:ConnectionId,deps:AgentManagementDeps)=>(deps.assertAllowed??assertAgentExecutionAllowed)(id);

/** Read-only path inventory: does not run --version, authentication or a generated prompt. */
export function getAgentDiagnostics(id:ConnectionId,options:{home?:string;env?:NodeJS.ProcessEnv;configured?:string}={}){
 assertAgent(id);
 const definition=connectionDefinition(id),home=options.home??os.homedir(),env=options.env??installations.loginEnvironment();
 const configured=options.configured??getConnectionConfig(id).cliPath;
 const roster=ROSTER_AGENTS.find(item=>item.id===id);
 let candidates=roster?rosterExecutableCandidates(roster,{home,env}):rosterExecutableCandidates({id:'kimi',name:definition.name,names:definition.cliNames,page:definition.page},{home,env});
 if(id==='codex'){
  candidates.unshift(...[env.LINKREADER_CODEX_EXECUTABLE].filter((value):value is string=>!!value));
  for(const apps of [path.join(home,'Applications'),'/Applications'])for(const app of ['Codex.app','ChatGPT.app'])for(const relative of ['Contents/Resources/codex','Contents/Resources/codex-cli/bin/codex','Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'])candidates.push(path.join(apps,app,relative));
 }
 if(id==='claude'){
  candidates.unshift(...[env.LINKREADER_CLAUDE_EXECUTABLE].filter((value):value is string=>!!value));
  const dir=path.join(home,'Library/Application Support/Claude/claude-code');
  try{for(const version of fs.readdirSync(dir).filter(value=>/^\d+\.\d+\.\d+/.test(value))){
   for(const relative of ['claude','bin/claude','claude-code','claude.app/Contents/MacOS/claude'])candidates.push(path.join(dir,version,relative));
   try{for(const build of fs.readdirSync(path.join(dir,version)).filter(value=>!value.startsWith('.')&&!value.endsWith('.app')))candidates.push(path.join(dir,version,build,'claude.app/Contents/MacOS/claude'));}catch{}
  }}catch{}
 }
 if(configured)candidates=[configured];
 return {id,name:definition.name,mode:configured?'manual':'auto',acpVerification:definition.acpVerification,notice:definition.acpNote,
  candidates:[...new Set(candidates)].filter(value=>path.isAbsolute(value)).map(file=>{let status:'missing'|'executable'|'invalid'='missing';try{const stat=fs.statSync(file);fs.accessSync(file,fs.constants.X_OK);status=stat.isFile()?'executable':'invalid';}catch{}if(status==='executable'&&id!=='claude'&&isClaudeExecutable(file,env,getConnectionConfig('claude').cliPath))status='invalid';return {path:file,status};})};
}

/** Validate a manual binary in an empty temporary cwd before persisting any path. */
export async function setAgentProgramPath(id:ConnectionId,cliPath:string,deps:AgentManagementDeps={}){
 assertAgent(id);allowed(id,deps);
 if(typeof cliPath!=='string'||/[\r\n\0]/.test(cliPath)||cliPath.length>4096)throw Error('程序路径不正确');
 let version:string|undefined;
 if(cliPath){
  if(!path.isAbsolute(cliPath))throw Error('请填写程序的完整绝对路径');
  try{fs.accessSync(cliPath,fs.constants.X_OK);if(!fs.statSync(cliPath).isFile())throw Error();}catch{throw Error('这个程序不存在或不可执行');}
  if(id!=='claude'&&isClaudeExecutable(cliPath,process.env,getConnectionConfig('claude').cliPath))throw Error('不能把 Claude Code 程序绑定为其他智能体');
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-version-'));
  try{
   allowed(id,deps);
   const raw=deps.version?await deps.version(cliPath):(await exec(cliPath,['--version'],{cwd,env:installations.sanitizeAgentEnv(installations.loginEnvironment()),timeout:8000,maxBuffer:65536})).stdout;
   version=raw.match(/\b\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][a-zA-Z0-9.-]{1,40})?\b/)?.[0];
   if(!version)throw Error();
  }catch{throw Error('程序未能回答 --version，请检查路径和安装状态');}
  finally{fs.rmSync(cwd,{recursive:true,force:true});}
 }
 allowed(id,deps);
 return {version,connection:await (deps.save??saveAgentConnection)(id,{cliPath})};
}

export type AgentManagementAction='install'|'logout'|'switch-account'|'upgrade';
export type AgentManagementState={id:ConnectionId;action:AgentManagementAction;phase?:'logout'|'login';state:'waiting'|'complete'|'failed'|'cancelled';message:string;connection?:ConnectionView};
type ManagedSession={resultDir?:string;state:AgentManagementState;windowId:number;tty:string;started:number;deps:AgentManagementDeps;timer?:ReturnType<typeof setTimeout>;checking?:Promise<AgentManagementState>};
/** Only a fixed official command is sent to Terminal; output and account files are never read. */
export function createAgentManagement(){
 const sessions=new Map<ConnectionId,ManagedSession>();
 const starts=new Set<ConnectionId>();
 const finish=(session:ManagedSession,state:AgentManagementState['state'],message:string)=>{if(sessions.get(session.state.id)!==session||session.state.state!=='waiting')return {...session.state};if(session.state.phase==='login'&&state!=='complete')void (session.deps.loginCancel??(agent=>agentLoginManager.cancel(agent)))(session.state.id).catch(()=>{});if(session.state.action==='switch-account')setAgentAccountChanging(session.state.id,false);if(session.resultDir){fs.rmSync(session.resultDir,{recursive:true,force:true});session.resultDir=undefined;}if(session.timer)clearTimeout(session.timer);session.timer=undefined;Object.assign(session.state,{state,message});return {...session.state};};
 const schedule=(id:ConnectionId,session:ManagedSession)=>{if(session.state.state!=='waiting')return;session.timer=setTimeout(()=>{void check(id).catch(()=>finish(session,'failed','没查到结果，请重新检查'));},session.deps.pollMs??3000);session.timer.unref?.();};
 async function check(id:ConnectionId):Promise<AgentManagementState>{
  const session=sessions.get(id);if(!session)throw Error('没有等待中的操作');
  if(session.state.state!=='waiting')return {...session.state};
  if(session.checking)return session.checking;
  const promise=(async()=>{
   if(session.timer)clearTimeout(session.timer);session.timer=undefined;
   try{allowed(id,session.deps);}catch{return finish(session,'cancelled','智能体已停用，已停止检查');}
   if((session.deps.now??Date.now)()-session.started>(session.deps.timeoutMs??10*60*1000))return finish(session,'failed','等待超时，请重新检查安装或登录状态');
   if(session.state.phase==='login'){
    const result=await (session.deps.loginCheck??(agent=>agentLoginManager.check(agent)))(id);
    if(session.state.state!=='waiting')return {...session.state};
    session.state.connection=result.connection;
    if(result.waiting){schedule(id,session);return {...session.state};}
    return finish(session,result.connection.connected?'complete':'failed',result.connection.connected?'新账号已接通':'登录未完成，请重新登录');
   }
   const terminalState=await (session.deps.terminal??terminal)(`if application "Terminal" is not running then return "closed"\ntell application "Terminal"\nrepeat with w in windows\nif id of w is ${session.windowId} then\nrepeat with t in tabs of w\nif tty of t is ${quoteApple(session.tty)} then\nif busy of t then return "waiting"\nreturn "finished"\nend if\nend repeat\nend if\nend repeat\nend tell\nreturn "closed"`);
   if(session.state.state!=='waiting')return {...session.state};
   if(terminalState==='waiting'){schedule(id,session);return {...session.state};}
   if(!['closed','finished'].includes(terminalState))return finish(session,'failed','没查到终端状态，请重新检查');
   allowed(id,session.deps);
   if(session.state.action==='switch-account'||session.state.action==='upgrade'){
    const code=session.deps.exitCode?session.deps.exitCode(path.join(session.resultDir!,'exit-code')):(()=>{try{const text=fs.readFileSync(path.join(session.resultDir!,'exit-code'),'utf8').trim();return /^\d{1,3}$/.test(text)?Number(text):undefined}catch{return undefined}})();
    if(code!==0)return finish(session,'failed','命令没有成功结束，请在终端检查后重试');
    if(session.state.action==='switch-account'){
     await (session.deps.closeSessions??(async agent=>{const {closeGeneralAgentSessions}=await import('./general/runner.ts');await closeGeneralAgentSessions(agent as AgentConnectionId)}))(id);
     if(session.state.state!=='waiting')return {...session.state};
     allowed(id,session.deps);
     session.state.phase='login';session.state.message='旧账号已退出，等你登录新账号';
     const result=await (session.deps.loginStart??(agent=>agentLoginManager.start(agent)))(id);
     if(session.state.state!=='waiting')return {...session.state};
     session.state.connection=result.connection;
     if(result.waiting){schedule(id,session);return {...session.state};}
     return finish(session,result.connection.connected?'complete':'failed',result.connection.connected?'新账号已接通':'登录未完成，请重新登录');
    }
   }
   const connection=await refresh(id,session.deps);
   if(session.state.state!=='waiting')return {...session.state};
   session.state.connection=connection;
   const complete=session.state.action==='upgrade'?connection.cliInstalled&&!!connection.cliVersion&&!connection.filmOutdated:session.state.action==='install'?connection.cliInstalled:connection.cliAuthState==='needs-login';
   return finish(session,complete?'complete':'failed',complete?(session.state.action==='upgrade'?'已升级并重新检查':session.state.action==='install'?'已找到新安装的程序':'已退出登录，可重新登录换账号'):'操作结束，但还没有确认成功，请重新检查');
  })().catch(()=>finish(session,'failed','操作未完成，请重新检查或重试')).finally(()=>{session.checking=undefined;});
  session.checking=promise;return promise;
 }
 async function start(id:ConnectionId,action:AgentManagementAction,input:{command?:unknown}={},deps:AgentManagementDeps={}){
  assertAgent(id);allowed(id,deps);
  if(!['install','logout','switch-account','upgrade'].includes(action))throw Error('未知管理操作');
  if(starts.has(id)||sessions.get(id)?.state.state==='waiting')throw Error('这家智能体还有操作未结束');
  if((deps.platform??process.platform)!=='darwin')throw Error('终端管理操作目前只支持 macOS');
  starts.add(id);
  try{
   const definition=connectionDefinition(id);let command:string;
   if(action==='install'){
    if(await detect(id,deps))throw Error('已经找到程序，无需再次安装');
    const official=definition.installCommand??ROSTER_AGENTS.find(item=>item.id===id)?.installer??(id==='codex'?CODEX_INSTALL_COMMAND:undefined);
    if(!official)throw Error('这家没有已核实的安装命令，请使用官方安装页');
    if(input.command!==official)throw Error('安装命令未经确认或已变化，请重新确认');
    command=official;
   }else if(action==='upgrade'){
    if(!definition.upgradeCommand)throw Error('这家没有已核实的升级命令，请到它自己的 App 或官网升级');
    if(input.command!==definition.upgradeCommand)throw Error('升级命令未经确认或已变化，请重新确认');
    if(!await detect(id,deps))throw Error('本机没有找到这家程序');
    command=definition.upgradeCommand;
   }else{
    if(!definition.logoutArgs)throw Error('这家命令行退出登录待适配，请到它自己的 App 里换账号');
    const executable=await detect(id,deps);if(!executable||/[\r\n\0]/.test(executable))throw Error('没有找到可用的程序');
    if(id!=='claude'&&isClaudeExecutable(executable,process.env,getConnectionConfig('claude').cliPath))throw Error('程序路径不能指向 Claude Code');
    command=[executable,...definition.logoutArgs].map(quoteShell).join(' ');
   }
   allowed(id,deps);
   const resultDir=action==='switch-account'||action==='upgrade'?fs.mkdtempSync(path.join(os.tmpdir(),'opentake-management-result-')):undefined;
   if(resultDir)command=`( ${command} ); printf '%s' \"$?\" > ${quoteShell(path.join(resultDir,'exit-code'))}`;
   let identity:string;try{identity=await (deps.terminal??terminal)(`tell application "Terminal"\nactivate\nset operationTab to do script ${quoteApple(command)}\nrepeat with w in windows\nrepeat with t in tabs of w\nif tty of t is tty of operationTab then return (id of w as text) & ":" & (tty of operationTab)\nend repeat\nend repeat\nend tell`);}catch(error){if(resultDir)fs.rmSync(resultDir,{recursive:true,force:true});throw error}
   const match=identity.match(/^(\d+):(\/dev\/ttys?[\w-]+)$/);
   if(!match||!Number.isSafeInteger(Number(match[1]))){if(resultDir)fs.rmSync(resultDir,{recursive:true,force:true});throw Error('没查到操作终端，请重新检查');}
   const session:ManagedSession={resultDir,state:{id,action,...(action==='switch-account'?{phase:'logout' as const}:{}),state:'waiting',message:action==='upgrade'?'等你升级，好了自动重新检查':action==='install'?'等你安装，好了自动查找':'正在退出旧账号'},windowId:Number(match[1]),tty:match[2],started:(deps.now??Date.now)(),deps};
   if(action==='switch-account'){(deps.rejectCredentials??(agent=>markAgentCredentialsRejected(agent,'cli')))(id);setAgentAccountChanging(id,true);}
   sessions.set(id,session);schedule(id,session);return {...session.state};
  }finally{starts.delete(id);}
 }
 function cancel(id:ConnectionId){const session=sessions.get(id);if(!session)throw Error('没有等待中的操作');return finish(session,'cancelled','已停止等待；终端由你自行关闭');}
 return {start,check,cancel};
}
export const agentManagement=createAgentManagement();
