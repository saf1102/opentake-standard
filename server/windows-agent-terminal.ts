import fs from 'node:fs';
import os from 'node:os';
import installations from './agent-installation.ts';
import path from 'node:path';
import {execFile,type ExecFileOptions} from 'node:child_process';
import {promisify} from 'node:util';
import {agentLaunch,quoteAgentArgument} from './agent-launch.ts';
const execWindow=promisify(execFile);
type WindowOpener=(file:string,args:string[],options:ExecFileOptions)=>Promise<{stdout:string|Buffer}>;

export const systemPowerShell=()=>path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
export const powershellLiteral=(value:string)=>{
 if(/[\r\n\0]/.test(value))throw Error('命令参数不能包含换行或空字符');
 return "'"+value.replaceAll("'","''")+"'";
};
export function windowsAgentScript(executable:string,args:string[],resultFile:string,env:NodeJS.ProcessEnv=process.env,cwd?:string){
 const launch=agentLaunch(executable,args,{env},'win32');
 const commandLine=launch.options.windowsVerbatimArguments?launch.args.join(' '):launch.args.map(quoteAgentArgument).join(' ');
 // Keep generated launch variables in this operation's ProcessStartInfo only.
 const variables=Object.entries(launch.options.env||{}).filter(([key,value])=>value!==undefined&&value!==env[key]).map(([key,value])=>`$start.EnvironmentVariables[${powershellLiteral(key)}]=${powershellLiteral(String(value))}`).join('\r\n');
 return "$ErrorActionPreference='Stop'\r\n$operationCode=1\r\ntry {\r\n"+
  "$start=New-Object System.Diagnostics.ProcessStartInfo\r\n$start.UseShellExecute=$false\r\n"+(cwd?`$start.WorkingDirectory=${powershellLiteral(cwd)}\r\n`:'')+
  `$start.FileName=${powershellLiteral(launch.file)}\r\n$start.Arguments=${powershellLiteral(commandLine)}\r\n${variables}\r\n`+
  "$operation=New-Object System.Diagnostics.Process\r\n$operation.StartInfo=$start\r\n[void]$operation.Start()\r\n$operation.WaitForExit()\r\n$operationCode=$operation.ExitCode\r\n$operation.Dispose()\r\n} catch { Write-Host $_.Exception.Message }\r\n"+
  `if (Test-Path -LiteralPath ${powershellLiteral(path.win32.dirname(resultFile))}) {\r\n$operationCode | Set-Content -LiteralPath ${powershellLiteral(resultFile+'.tmp')} -Encoding ascii\r\nMove-Item -LiteralPath ${powershellLiteral(resultFile+'.tmp')} -Destination ${powershellLiteral(resultFile)}\r\n}\r\nWrite-Host '操作已结束。可以关闭此窗口。'\r\n`;

}
/** Only the exit code is collected. Provider output stays in the user's terminal. */
/** 终端窗口在用户主目录打开。不能落在 OpenTake 安装目录里：登录窗口常常一直开着，会占住 resources，覆盖安装和软件内更新都换不了文件。 */
export const agentTerminalHome=(env:NodeJS.ProcessEnv)=>{const home=env.USERPROFILE||env.HOME||os.homedir();return home&&/^(?:[A-Za-z]:[\\/]|\\\\)/.test(home)?home:undefined;};
export async function startWindowsAgentTerminal(executable:string,args:string[],resultDir:string,env=installations.loginEnvironment(),run:WindowOpener=execWindow){
 const home=agentTerminalHome(env);
 const command=windowsAgentScript(executable,args,path.join(resultDir,'exit-code'),env,home);
 const encoded=Buffer.from(command,'utf16le').toString('base64');
 const powershell=systemPowerShell();
 // Start-Process creates an interactive console, independent of the desktop app's redirected stdio.
 const opener=`$ErrorActionPreference='Stop'; $window=Start-Process -FilePath ${powershellLiteral(powershell)} -ArgumentList '-NoLogo -NoProfile -NoExit -EncodedCommand ${encoded}' -WindowStyle Normal${home?' -WorkingDirectory '+powershellLiteral(home):''} -PassThru; [Console]::WriteLine($window.Id)`;
 try{
  const {stdout}=await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',opener],{windowsHide:true,env,timeout:10000,maxBuffer:4096,...(home?{cwd:home}:{})});
  const pid=Number(String(stdout).trim());
  if(Number.isSafeInteger(pid)&&pid>0)return pid;
 }catch{}
 throw Error('未能打开 Windows 终端，请检查 PowerShell 后重试');
}
export function windowsAgentTerminalState(pid:number,resultDir:string){
 if(fs.existsSync(path.join(resultDir,'exit-code')))return 'finished';
 try{process.kill(pid,0);return 'waiting'}catch{return 'closed'}
}
