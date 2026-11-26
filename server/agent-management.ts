import {validateAgentProgram} from './agent-program-path.ts';
import {startWindowsAgentTerminal,systemPowerShell,windowsAgentTerminalState} from './windows-agent-terminal.ts';
/** 本机智能体管理：固定官方命令，账号切换按退出、关闭会话、登录顺序执行。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileAsync} from './proc.ts';
import {connectionDefinition,type ConnectionId,type AgentConnectionId,type ConnectionView} from '../shared/agent-connections.ts';
import {assertAgentExecutionAllowed,detectConnectionExecutable,getConnectionConfig,refreshAgentConnection,saveAgentConnection,markAgentCredentialsRejected,setAgentAccountChanging} from './agent-connections.ts';
import {ROSTER_AGENTS,isClaudeExecutable,rosterExecutableCandidates,rosterInstaller} from './agent-roster.ts';
import {codexInstallCommand} from './agent-installations.ts';
import installations from './agent-installation.ts';
import {readAgentSettings} from './agent-settings.ts';
import {cachedConnectionVersionFailed} from './agent-connections.ts';
import {agentLoginManager} from './agent-login.ts';

const exec=execFileAsync;
const quoteShell=(value:string)=>`'${value.replace(/'/g,`'\\''`)}'`;
const quoteApple=(value:string)=>`"${value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
const assertAgent=(id:ConnectionId)=>{if(connectionDefinition(id).kind!=='agent')throw Error('这里只能管理智能体程序');};
export type AgentManagementDeps={
 assertAllowed?:(id:ConnectionId)=>void;detect?:(id:ConnectionId)=>Promise<string|undefined>;
 refresh?:(id:ConnectionId)=>Promise<ConnectionView>;save?:(id:ConnectionId,input:{cliPath:string})=>Promise<ConnectionView>;
 version?:(file:string)=>Promise<string>;terminal?:(script:string)=>Promise<string>;
 exitCode?:(file:string)=>number|undefined;closeSessions?:(id:ConnectionId)=>Promise<void>;rejectCredentials?:(id:ConnectionId)=>void;
 loginStart?:(id:ConnectionId)=>Promise<{waiting:boolean;connection:ConnectionView}>;loginCheck?:(id:ConnectionId)=>Promise<{waiting:boolean;connection:ConnectionView}>;loginCancel?:(id:ConnectionId)=>Promise<unknown>;
 startWindowsTerminal?:typeof startWindowsAgentTerminal;arch?:NodeJS.Architecture;platform?:NodeJS.Platform;pollMs?:number;timeoutMs?:number;now?:()=>number;
};
const terminal=async(script:string)=>{try{return (await exec('/usr/bin/osascript',['-e',script],{timeout:8000,maxBuffer:4096})).stdout.trim()}catch{throw Error('无法控制终端，请检查系统自动化权限后重试');}};
const detect=(id:ConnectionId,deps:AgentManagementDeps)=>(deps.detect??detectConnectionExecutable)(id);
const refresh=(id:ConnectionId,deps:AgentManagementDeps)=>(deps.refresh??refreshAgentConnection)(id);
const allowed=(id:ConnectionId,deps:AgentManagementDeps)=>(deps.assertAllowed??assertAgentExecutionAllowed)(id);

/** Read-only path inventory: does not run --version, authentication or a generated prompt. */
export function getAgentDiagnostics(id:ConnectionId,options:{home?:string;env?:NodeJS.ProcessEnv;configured?:string}={}){
 assertAgent(id);
 const definition=connectionDefinition(id),home=options.home??os.homedir(),env=options.env??installations.loginEnvironment();
 const configured=options.configured??(getConnectionConfig(id).cliPath||(id==='codex'?readAgentSettings().cliPath:''));
 const roster=ROSTER_AGENTS.find(item=>item.id===id);
 const files=id==='codex'||id==='claude'
  ?installations.agentCandidates(id,{home,env,configured}).map(candidate=>candidate.path)
  :configured?[configured]:roster?rosterExecutableCandidates(roster,{home,env}):[];
 const claudePath=id==='claude'?'':getConnectionConfig('claude').cliPath;
 const candidates=[...new Set(files)].filter(file=>path.isAbsolute(file)).map(file=>{
  let status:ReturnType<typeof installations.agentFileStatus>|'version-unreadable'=installations.agentFileStatus(file);
  if(status==='executable'){
   if(id!=='claude'&&isClaudeExecutable(file,env,claudePath))status='invalid';
   else if(cachedConnectionVersionFailed(file)||(id==='codex'&&installations.codexVersionUnreadable(file)))status='version-unreadable';
  }
  return {path:file,status};
 });
 return {id,name:definition.name,mode:configured?'manual':'auto',acpVerification:definition.acpVerification,notice:definition.acpNote,candidates};
}

/** Validate a manual binary in an empty temporary cwd before persisting any path. */
export async function setAgentProgramPath(id:ConnectionId,cliPath:string,deps:AgentManagementDeps={}){
 assertAgent(id);allowed(id,deps);
 const version=cliPath===''?undefined:await validateAgentProgram(id,cliPath,getConnectionConfig('claude').cliPath,deps.version);
 allowed(id,deps);
 const connection=deps.save?await deps.save(id,{cliPath}):await saveAgentConnection(id,{cliPath},{validatedPath:cliPath});
 return {version,connection};
}

export const agentManagementActions=['install','install-and-login','logout','switch-account','upgrade'] as const;
export type AgentManagementAction=typeof agentManagementActions[number];
const isInstallation=(action:AgentManagementAction)=>action==='install'||action==='install-and-login';
export type AgentManagementState={id:ConnectionId;action:AgentManagementAction;phase?:'install'|'logout'|'login';state:'waiting'|'complete'|'failed'|'cancelled';message:string;connection?:ConnectionView};
type ManagedSession={installFinished?:boolean;windowsPid?:number;resultDir?:string;state:AgentManagementState;windowId:number;tty:string;started:number;deps:AgentManagementDeps;timer?:ReturnType<typeof setTimeout>;checking?:Promise<AgentManagementState>};
/** Only a fixed official command is sent to Terminal; output and account files are never read. */
export function createAgentManagement(){
 const sessions=new Map<ConnectionId,ManagedSession>();
 const starts=new Set<ConnectionId>();
 const finish=(session:ManagedSession,state:AgentManagementState['state'],message:string)=>{if(sessions.get(session.state.id)!==session||session.state.state!=='waiting')return {...session.state};if(session.state.phase==='login'&&state!=='complete')void (session.deps.loginCancel??(agent=>agentLoginManager.cancel(agent)))(session.state.id).catch(()=>{});if(session.state.action==='switch-account')setAgentAccountChanging(session.state.id,false);if(session.resultDir){fs.rmSync(session.resultDir,{recursive:true,force:true});session.resultDir=undefined;}if(session.timer)clearTimeout(session.timer);session.timer=undefined;Object.assign(session.state,{state,message});return {...session.state};};
 const schedule=(id:ConnectionId,session:ManagedSession)=>{if(session.state.state!=='waiting')return;session.timer=setTimeout(()=>{void check(id).catch(()=>finish(session,'failed','没查到结果，请重新检查'));},session.deps.pollMs??3000);session.timer.unref?.();};
 function loginResult(session:ManagedSession,result:{waiting:boolean;connection:ConnectionView}){
  if(session.state.state!=='waiting')return {...session.state};
  session.state.connection=result.connection;
  if(session.state.action==='install-and-login'&&(result.connection.mode!=='cli'||!result.connection.enabled))return finish(session,'cancelled','接入方式已改变，已停止登录');
  if(result.waiting){schedule(session.state.id,session);return {...session.state};}
  const connected=result.connection.mode==='cli'&&result.connection.connected;
  return finish(session,connected?'complete':'failed',connected?(session.state.action==='switch-account'?'新账号已接通':'已接通'):'登录未完成，请重新登录');
 }
 async function openLogin(session:ManagedSession){
  allowed(session.state.id,session.deps);
  session.state.phase='login';
  session.state.message=session.state.action==='switch-account'?'旧账号已退出，等你登录新账号':'输入 /login 回车，在浏览器里确认';
  return loginResult(session,await (session.deps.loginStart??(agent=>agentLoginManager.start(agent)))(session.state.id));
 }
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
    return loginResult(session,result);
   }
   const terminalState=session.installFinished?'finished':session.windowsPid?windowsAgentTerminalState(session.windowsPid,session.resultDir!):await (session.deps.terminal??terminal)(`if application "Terminal" is not running then return "closed"\ntell application "Terminal"\nrepeat with w in windows\nif id of w is ${session.windowId} then\nrepeat with t in tabs of w\nif tty of t is ${quoteApple(session.tty)} then\nif busy of t then return "waiting"\nreturn "finished"\nend if\nend repeat\nend if\nend repeat\nend tell\nreturn "closed"`);
   if(session.state.state!=='waiting')return {...session.state};
   if(terminalState==='waiting'){schedule(id,session);return {...session.state};}
   if(!['closed','finished'].includes(terminalState))return finish(session,'failed','没查到终端状态，请重新检查');
   allowed(id,session.deps);
   if(session.state.action==='switch-account'||session.state.action==='upgrade'||(isInstallation(session.state.action)&&!session.installFinished)){
    const code=session.deps.exitCode?session.deps.exitCode(path.join(session.resultDir!,'exit-code')):(()=>{try{const text=fs.readFileSync(path.join(session.resultDir!,'exit-code'),'utf8').trim();return /^\d{1,3}$/.test(text)?Number(text):undefined}catch{return undefined}})();
    if(code!==0)return finish(session,'failed','命令没有成功结束，请在终端检查后重试');
    if(isInstallation(session.state.action))session.installFinished=true;
    if(session.state.action==='switch-account'){
     await (session.deps.closeSessions??(async agent=>{const {closeGeneralAgentSessions}=await import('./general/runner.ts');await closeGeneralAgentSessions(agent as AgentConnectionId)}))(id);
     if(session.state.state!=='waiting')return {...session.state};
     return openLogin(session);
    }
   }
   const connection=await refresh(id,session.deps);
   if(session.state.state!=='waiting')return {...session.state};
   session.state.connection=connection;
   if(session.state.action==='install-and-login'&&(connection.mode!=='cli'||!connection.enabled))return finish(session,'cancelled','接入方式已改变，已停止登录');
   if(isInstallation(session.state.action)&&!connection.cliInstalled){
    session.state.message='安装终端已结束，正在重新查找程序';
    schedule(id,session);return {...session.state};
   }
   if(session.state.action==='install-and-login'){
    if(connection.connected)return finish(session,'complete','已接通');
    return openLogin(session);
   }
   const complete=session.state.action==='upgrade'?connection.cliInstalled&&!!connection.cliVersion&&!connection.filmOutdated:session.state.action==='install'?connection.cliInstalled:connection.cliAuthState==='needs-login';
   return finish(session,complete?'complete':'failed',complete?(session.state.action==='upgrade'?'已升级并重新检查':session.state.action==='install'?'已找到新安装的程序':'已退出登录，可重新登录换账号'):'操作结束，但还没有确认成功，请重新检查');
  })().catch(()=>finish(session,'failed','操作未完成，请重新检查或重试')).finally(()=>{session.checking=undefined;});
  session.checking=promise;return promise;
 }
 async function start(id:ConnectionId,action:AgentManagementAction,input:{command?:unknown}={},deps:AgentManagementDeps={}){
  assertAgent(id);allowed(id,deps);
  if(!agentManagementActions.includes(action))throw Error('未知管理操作');
  if(action==='install-and-login'&&id!=='codebuddy')throw Error('此操作仅适用于 CodeBuddy 命令行账号登录');
  if(starts.has(id)||sessions.get(id)?.state.state==='waiting')throw Error('这家智能体还有操作未结束');
  const host=deps.platform??process.platform;
  if(host!=='darwin'&&host!=='win32')throw Error('此主机不支持终端管理');
  starts.add(id);
  try{
   const definition=connectionDefinition(id);let command:string;let nativeCommand:{executable:string;args:string[]}|undefined;
   if(isInstallation(action)){
    if(await detect(id,deps))throw Error('已经找到程序，无需再次安装');
    const roster=ROSTER_AGENTS.find(item=>item.id===id);
    const official=roster?rosterInstaller(roster,host,deps.arch):id==='codex'?codexInstallCommand(host):undefined;
    if(!official)throw Error('这家没有已核实的安装命令，请使用官方安装页');
    if(input.command!==official)throw Error('安装命令未经确认或已变化，请重新确认');
    if(action==='install-and-login'&&getConnectionConfig(id).mode!=='cli')await saveAgentConnection(id,{mode:'cli'});
    command=official;
    if(host==='win32'){
     if(official.startsWith('irm '))nativeCommand={executable:systemPowerShell(),args:['-NoLogo','-NoProfile','-Command',official]};
     if(official==='winget install GitHub.Copilot')nativeCommand={executable:'winget.exe',args:['install','GitHub.Copilot']};
    }
   }else if(action==='upgrade'){
    if(!definition.upgradeCommand)throw Error('这家没有已核实的升级命令，请到它自己的 App 或官网升级');
    if(input.command!==definition.upgradeCommand)throw Error('升级命令未经确认或已变化，请重新确认');
    if(!await detect(id,deps))throw Error('本机没有找到这家程序');
    command=definition.upgradeCommand;
   }else{
    if(!definition.logoutArgs)throw Error('这家命令行退出登录待适配，请到它自己的 App 里换账号');
    const executable=await detect(id,deps);if(!executable||/[\r\n\0]/.test(executable))throw Error('没有找到可用的程序');
    if(id!=='claude'&&isClaudeExecutable(executable,process.env,getConnectionConfig('claude').cliPath))throw Error('程序路径不能指向 Claude Code');
    command=[executable,...definition.logoutArgs].map(quoteShell).join(' ');nativeCommand={executable,args:[...definition.logoutArgs]};
   }
   const state:AgentManagementState={id,action,state:'waiting',message:action==='upgrade'?'等你升级，好了自动重新检查':isInstallation(action)?'等你安装，好了自动查找':'正在退出旧账号'};
   if(action==='switch-account')state.phase='logout';
   if(action==='install-and-login'){state.phase='install';state.message='已打开安装终端，装好后会自动检查登录';}
   if(host==='win32'){
    if(!nativeCommand){
     if(!/^npm (?:install|update) -g [@a-zA-Z0-9_./-]+(?:@[a-zA-Z0-9_.-]+)?$/.test(command))throw Error('此安装或升级命令仅适用于 macOS，请使用这家智能体的 Windows 官方安装页');
     const [executable,...args]=command.split(' ');nativeCommand={executable:executable+'.cmd',args};
    }
    allowed(id,deps);const resultDir=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-management-result-'));
    try{
     const pid=await (deps.startWindowsTerminal??startWindowsAgentTerminal)(nativeCommand.executable,nativeCommand.args,resultDir);
     const session:ManagedSession={windowsPid:pid,resultDir,state,windowId:pid,tty:'windows',started:(deps.now??Date.now)(),deps};
     if(action==='switch-account'){(deps.rejectCredentials??(agent=>markAgentCredentialsRejected(agent,'cli')))(id);setAgentAccountChanging(id,true);}
     sessions.set(id,session);schedule(id,session);return {...session.state};
    }catch(error){fs.rmSync(resultDir,{recursive:true,force:true});throw error}
   }
   allowed(id,deps);
   const resultDir=action!=='logout'?fs.mkdtempSync(path.join(os.tmpdir(),'opentake-management-result-')):undefined;
   if(resultDir)command=`( ${command} ); printf '%s' \"$?\" > ${quoteShell(path.join(resultDir,'exit-code'))}`;
   let identity:string;try{identity=await (deps.terminal??terminal)(`tell application "Terminal"\nactivate\nset operationTab to do script ${quoteApple(command)}\nrepeat with w in windows\nrepeat with t in tabs of w\nif tty of t is tty of operationTab then return (id of w as text) & ":" & (tty of operationTab)\nend repeat\nend repeat\nend tell`);}catch(error){if(resultDir)fs.rmSync(resultDir,{recursive:true,force:true});throw error}
   const match=identity.match(/^(\d+):(\/dev\/ttys?[\w-]+)$/);
   if(!match||!Number.isSafeInteger(Number(match[1]))){if(resultDir)fs.rmSync(resultDir,{recursive:true,force:true});throw Error('没查到操作终端，请重新检查');}
   const session:ManagedSession={resultDir,state,windowId:Number(match[1]),tty:match[2],started:(deps.now??Date.now)(),deps};
   if(action==='switch-account'){(deps.rejectCredentials??(agent=>markAgentCredentialsRejected(agent,'cli')))(id);setAgentAccountChanging(id,true);}
   sessions.set(id,session);schedule(id,session);return {...session.state};
  }finally{starts.delete(id);}
 }
 function cancel(id:ConnectionId){const session=sessions.get(id);if(!session)throw Error('没有等待中的操作');return finish(session,'cancelled','已停止等待；终端由你自行关闭');}
 function workBuddySetup(cancelWaiting=false){
  if(sessions.get('codebuddy')?.state.action!=='install-and-login')return null;
  return cancelWaiting?cancel('codebuddy'):check('codebuddy');
 }
 return {start,check,cancel,workBuddySetup};
}
export const agentManagement=createAgentManagement();
