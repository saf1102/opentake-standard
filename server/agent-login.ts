import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startWindowsAgentTerminal,windowsAgentTerminalState} from './windows-agent-terminal.ts';
import {type ConnectionId, type ConnectionView} from '../shared/agent-connections.ts';
import {assertAgentExecutionAllowed, getConnectionConfig, getConnectionStatus, detectConnectionExecutable, refreshAgentConnection, completeAgentLogin, agentLoginArgs} from './agent-connections.ts';

const execFileAsync=promisify(execFile);
type TerminalRun=(script:string)=>Promise<string>;
export type LoginDependencies={complete?:(id:ConnectionId,revision:number|undefined)=>Promise<ConnectionView>;exitCode?:(file:string)=>number|undefined;platform?:NodeJS.Platform;run?:TerminalRun;status?:(id:ConnectionId)=>Promise<ConnectionView>;refresh?:(id:ConnectionId)=>Promise<ConnectionView>;detect?:(id:ConnectionId)=>Promise<string|undefined>;assertAllowed?:(id:ConnectionId)=>void};
const runTerminal:TerminalRun=async script=>{
 try{return (await execFileAsync('/usr/bin/osascript',['-e',script],{timeout:8000,maxBuffer:4096})).stdout.trim()}
 catch{throw Error('无法查看或打开终端，请在系统设置的「隐私与安全性 → 自动化」中允许 OpenTake 控制终端');}
};
const quoteShell=(value:string)=>`'${value.replace(/'/g,`'\\''`)}'`;
const quoteApple=(value:string)=>`"${value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
type Session={tty:string;windowId:number;resultDir:string;revision?:number;windowsPid?:number};
const removeResult=(session:Session)=>fs.rmSync(session.resultDir,{recursive:true,force:true});
const loginExitCode=(file:string)=>{try{const value=fs.readFileSync(file,'utf8').trim();return /^\d{1,3}$/.test(value)?Number(value):undefined}catch{return undefined}};
/** 只跟踪本次打开的终端标签；从不读取终端文字或对方账号文件。 */
export function createAgentLoginManager(){
 const sessions=new Map<ConnectionId,Session>();
 const starting=new Map<ConnectionId,Promise<{waiting:boolean;connection:ConnectionView}>>();
 const revisions=new Map<ConnectionId,number>();
 const status=(id:ConnectionId,deps:LoginDependencies)=> (deps.status??getConnectionStatus)(id);
 async function check(id:ConnectionId,deps:LoginDependencies={}){
  const session=sessions.get(id);
  if(!session)return {waiting:false,connection:await status(id,deps)};
  try{(deps.assertAllowed??assertAgentExecutionAllowed)(id)}catch{sessions.delete(id);removeResult(session);return {waiting:false,connection:await status(id,deps)}}
  const connection=await status(id,deps);
  if(connection.connected||connection.mode!=='cli'||!connection.enabled){if(sessions.get(id)===session){sessions.delete(id);removeResult(session)}return {waiting:false,connection};}
  const result=session.windowsPid?windowsAgentTerminalState(session.windowsPid,session.resultDir):await (deps.run??runTerminal)(`if application "Terminal" is not running then return "closed"\ntell application "Terminal"\nrepeat with w in windows\nif id of w is ${session.windowId} then\nrepeat with t in tabs of w\nif tty of t is ${quoteApple(session.tty)} then\nif busy of t then return "waiting"\nreturn "finished"\nend if\nend repeat\nend if\nend repeat\nend tell\nreturn "closed"`);
  if(result==='waiting')return {waiting:sessions.get(id)===session,connection};
  if(!['closed','finished'].includes(result))throw Error('没查到终端状态，请重新检查或取消等待');
  if(sessions.get(id)!==session)return {waiting:false,connection:await status(id,deps)};
  sessions.delete(id);
  const succeeded=(deps.exitCode??loginExitCode)(path.join(session.resultDir,'exit-code'))===0;
  removeResult(session);
  // Closing the Terminal or a failed login must not turn an anonymous ACP session back into a login.
  return {waiting:false,connection:await (succeeded?(deps.complete??((agent,revision)=>completeAgentLogin(agent,revision)))(id,session.revision):(deps.refresh??refreshAgentConnection)(id))};
 }
 async function start(id:ConnectionId,deps:LoginDependencies={}){
  (deps.assertAllowed??assertAgentExecutionAllowed)(id);
  if(starting.has(id))return starting.get(id)!;
  if(sessions.has(id))return check(id,deps);
  const revision=revisions.get(id)||0;
  const work=(async()=>{
   const platform=deps.platform??process.platform;
   if(platform!=='darwin'&&platform!=='win32')throw Error('请在这家智能体自己的终端里登录');
   const args=agentLoginArgs(id);if(!args)throw Error('这家命令行登录待适配，请改用 API 密钥');
   const before=await status(id,deps);
   if(before.mode!=='cli')throw Error('请先切换到「命令行 · 账号登录」');
   if(before.connected)return {waiting:false,connection:before};
   const executable=await (deps.detect??(agent=>detectConnectionExecutable(agent,getConnectionConfig(agent))))(id);
   if(!executable)throw Error('本机没有找到命令行，请先安装');
   if(/[\r\n\0]/.test(executable))throw Error('命令行路径不正确');
   (deps.assertAllowed??assertAgentExecutionAllowed)(id);
   if((revisions.get(id)||0)!==revision)return {waiting:false,connection:await status(id,deps)};
   const resultDir=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-login-result-'));
   if(platform==='win32'){
    try{
     const pid=await startWindowsAgentTerminal(executable,args,resultDir);
     const session={tty:'windows',windowId:pid,windowsPid:pid,resultDir,revision:before.revision};
     if((revisions.get(id)||0)===revision)sessions.set(id,session);else removeResult(session);
     return {waiting:sessions.get(id)===session,connection:await status(id,deps)};
    }catch(error){fs.rmSync(resultDir,{recursive:true,force:true});throw error}
   }
   // Only our command's exit code is written; never collect terminal output or provider files.
   const command=`( ${[executable,...args].map(quoteShell).join(' ')} ); printf '%s' \"$?\" > ${quoteShell(path.join(resultDir,'exit-code'))}`;
   let identity:string;
   try{identity=await (deps.run??runTerminal)(`tell application "Terminal"\nactivate\nset loginTab to do script ${quoteApple(command)}\nrepeat with w in windows\nrepeat with t in tabs of w\nif tty of t is tty of loginTab then return (id of w as text) & ":" & (tty of loginTab)\nend repeat\nend repeat\nend tell`);
   }catch(error){fs.rmSync(resultDir,{recursive:true,force:true});throw error}
   const matched=identity.match(/^(\d+):(\/dev\/ttys?[\w-]+)$/);
   if(!matched){fs.rmSync(resultDir,{recursive:true,force:true});throw Error('没查到登录终端，请重新检查')}
   const session={windowId:Number(matched[1]),tty:matched[2],resultDir,revision:before.revision};
   if(!Number.isSafeInteger(session.windowId)){removeResult(session);throw Error('没查到登录终端，请重新检查')}
   if((revisions.get(id)||0)===revision)sessions.set(id,session);else removeResult(session);
   const connection=await status(id,deps);
   if((!connection.enabled||connection.connected||connection.mode!=='cli')&&sessions.get(id)===session){sessions.delete(id);removeResult(session)}
   return {waiting:sessions.get(id)===session&&(revisions.get(id)||0)===revision,connection};
  })();
  starting.set(id,work);
  try{return await work}finally{starting.delete(id)}
 }
 async function cancel(id:ConnectionId,deps:LoginDependencies={}){
  revisions.set(id,(revisions.get(id)||0)+1);const session=sessions.get(id);sessions.delete(id);if(session)removeResult(session);
  // 取消等待不关闭用户的终端、不终止用户正在进行的登录。
  return {waiting:false,connection:await status(id,deps)};
 }
 return {start,check,cancel};
}
export const agentLoginManager=createAgentLoginManager();
