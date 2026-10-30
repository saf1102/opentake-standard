import tools from './agent-installation.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
const execFileAsync=promisify(execFile);
import {readAgentSettings,atomicAgentJson,agentSettingsFile,forgetStaleCliPath} from './agent-settings.ts';
import path from 'node:path';
/** Codex's standalone installer, as its official CLI page gives it first (learn.chatgpt.com/docs/codex/cli). It puts `codex` in ~/.local/bin, which detection searches. */
export const CODEX_INSTALL_COMMAND='curl -fsSL https://chatgpt.com/codex/install.sh | sh';
type DetectOptions={home?:string;env?:NodeJS.ProcessEnv;applicationDirs?:string[]};
/** What the settings page shows: detection plus, for Codex, the exact commands its one-click actions run and an app found without its CLI. */
export type InstallationStatus=ReturnType<typeof tools.detectAgent>&{error?:string;notice?:string;loginCommand?:string;installCommand?:string;app?:{name:string;path:string}};
export type TerminalRunner=(file:string,args:string[])=>Promise<unknown>;
const shq=(s:string)=>`'${s.replace(/'/g,`'\\''`)}'`;
/** AppleScript that has Terminal run one command line, as it is, in a new window the person sees. */
export const terminalScript=(command:string)=>`tell application "Terminal"\nactivate\ndo script "${command.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"\nend tell`;
/** The Codex or ChatGPT app, told from its bundle alone (nothing started): shown when it is here but no usable Codex CLI is. */
export function codexDesktopApp(applicationDirs=[path.join(os.homedir(),'Applications'),'/Applications']){
 for(const dir of applicationDirs)for(const name of ['Codex','ChatGPT']){const file=path.join(dir,`${name}.app`);try{if(fs.statSync(file).isDirectory())return {name,path:file}}catch{/* Not installed here. */}}
}
/**
 * Claude Code, as Settings › 已接入的 Agent lists it: only whether its program file is there and executable, with the
 * version read from its install folder. OpenTake never runs Claude Code — no `--version`, no `auth status`, no
 * generation — because running it may go online or update itself (S先生: no account risk). There is no saved path for
 * it: the old enhanced-agent.json is neither read nor removed. `configured` only names one file to look at.
 */
export function claudeInstallationStatus(configured?:string,options:DetectOptions={}):InstallationStatus{
 const detected=tools.detectAgent('claude',{configured,refresh:true,...options});
 return {...detected,error:detected.state==='invalid'?'指定的文件不存在或不可执行':undefined};
}
export async function agentInstallationStatus(kind:'codex'|'claude',configured?:string,options:DetectOptions={}):Promise<InstallationStatus>{
 if(kind==='claude')return claudeInstallationStatus(configured,options);
 const saved=configured===undefined,pinned=configured??readAgentSettings().cliPath;
 let detected=tools.detectAgent('codex',{configured:pinned,refresh:true,...options}),notice:string|undefined;
 // A saved path that stopped working (often the Codex bundled in a pre-1.0 app) gives way to auto-detection.
 if(saved&&pinned&&!detected.executable){
  const auto=tools.detectAgent('codex',{configured:'',refresh:true,...options});
  if(auto.executable){forgetStaleCliPath(pinned);detected=auto;notice=`原来指定的 ${pinned} 已失效，已改用自动找到的 Codex`}
 }
 if(!detected.executable){
  const missing=detected.state==='missing'?{installCommand:CODEX_INSTALL_COMMAND,app:codexDesktopApp(options.applicationDirs)}:{};
  return {...detected,...missing,state:detected.state,error:detected.state==='invalid'?'手动路径无效，请重新指定或改回自动检测':undefined};
 }
 const login={loginCommand:`${shq(detected.executable)} login`,...(notice?{notice}:{})};
 try{
  const result=await execFileAsync(detected.executable,['login','status'],{env:tools.loginEnvironment(),timeout:8000,maxBuffer:65536});
  const loggedIn=/logged in/i.test(result.stdout+' '+result.stderr)&&!/not logged in/i.test(result.stdout+' '+result.stderr);
  return {...detected,...login,state:loggedIn?'ready':'needs-login'};
 }catch(error){
  const message=String(error);
  return {...detected,...login,state:/not logged in|not authenticated/i.test(message)?'needs-login':'unknown',error:/not logged in|not authenticated/i.test(message)?undefined:'无法读取登录状态，请在服务主机的智能体中确认登录后重试'};
 }
}
/**
 * One-click Codex sign-in or install: the command runs in a visible Terminal window on the service host, where the
 * person answers it; the app never reads its output or credentials. Success only means Terminal opened — the UI's
 * re-detection reports whether login or installation actually finished. Install runs only the exact command the
 * person confirmed.
 */
export async function openCodexTerminal(action:'login'|'install',body:{command?:unknown}={},deps:DetectOptions&{configured?:string;platform?:NodeJS.Platform;run?:TerminalRunner}={}){
 const {configured=readAgentSettings().cliPath,platform=process.platform,run=(file,args)=>execFileAsync(file,args,{timeout:60000,maxBuffer:65536}),...options}=deps;
 const detected=tools.detectAgent('codex',{configured,refresh:true,...options});
 let command=CODEX_INSTALL_COMMAND;
 if(action==='login'){
  if(!detected.executable)throw Error('未找到可用的 Codex，请先安装或手动指定');
  command=`${shq(detected.executable)} login`;
 }else{
  if(detected.executable)throw Error(`已找到可用的 Codex，无需安装：${detected.executable}`);
  if(detected.mode==='manual')throw Error('当前是手动指定路径，请先恢复自动检测再安装');
  if(body.command!==CODEX_INSTALL_COMMAND)throw Error('安装命令未经确认或已变化，请重新确认后再运行');
 }
 return openTerminal(command,{platform,run});
}
/** Runs one command line, as it is, in a new Terminal window on the service host the person sees and answers. */
export async function openTerminal(command:string,{platform=process.platform,run=(file:string,args:string[])=>execFileAsync(file,args,{timeout:60000,maxBuffer:65536})}:{platform?:NodeJS.Platform;run?:TerminalRunner}={}){
 if(platform!=='darwin')throw Error(`服务主机不是 macOS，无法自动打开终端；请在服务主机的终端运行：${command}`);
 try{await run('/usr/bin/osascript',['-e',terminalScript(command)])}
 catch(error){
  const message=String((error as {stderr?:string}).stderr||(error instanceof Error?error.message:error)).trim();
  throw Error(/-1743|not authori[sz]ed/i.test(message)?'没有权限控制「终端」：请在 系统设置 › 隐私与安全性 › 自动化 中允许工作台控制「终端」后重试':`没有打开终端：${message}`);
 }
 return {command};
}
/** Pins or clears Codex's program path. Claude Code has none to save: it is only detected, never run. */
export async function saveAgentInstallation(kind:'codex',configured:string){
 if(kind!=='codex')throw Error('工作台不调用 Claude Code，只检测它是否安装');
 // Pin only validated binaries; automatic mode remains empty and follows newer installs.
 if(configured)tools.resolveAgent('codex',configured);
 atomicAgentJson(agentSettingsFile(),{...readAgentSettings(),cliPath:configured});
 return agentInstallationStatus('codex',configured);
}
