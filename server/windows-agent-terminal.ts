import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {agentLaunch,quoteAgentArgument} from './agent-launch.ts';

export const powershellLiteral=(value:string)=>{
 if(/[\r\n\0]/.test(value))throw Error('命令参数不能包含换行或空字符');
 return "'"+value.replaceAll("'","''")+"'";
};
export function windowsAgentScript(executable:string,args:string[],resultFile:string){
 const launch=agentLaunch(executable,args,{},'win32');
 const commandLine=launch.options.windowsVerbatimArguments?launch.args.join(' '):launch.args.map(quoteAgentArgument).join(' ');
 const variables=Object.entries(launch.options.env||{}).filter(([key])=>key.startsWith('OPENTAKE_LITERAL_')).map(([key,value])=>`$start.EnvironmentVariables[${powershellLiteral(key)}]=${powershellLiteral(String(value))}`).join('\r\n');
 return "$ErrorActionPreference='Stop'\r\n$operationCode=1\r\ntry {\r\n"+
  "$start=New-Object System.Diagnostics.ProcessStartInfo\r\n$start.UseShellExecute=$false\r\n"+
  `$start.FileName=${powershellLiteral(launch.file)}\r\n$start.Arguments=${powershellLiteral(commandLine)}\r\n${variables}\r\n`+
  "$operation=New-Object System.Diagnostics.Process\r\n$operation.StartInfo=$start\r\n[void]$operation.Start()\r\n$operation.WaitForExit()\r\n$operationCode=$operation.ExitCode\r\n$operation.Dispose()\r\n} catch { Write-Host $_.Exception.Message }\r\n"+
  `$operationCode | Set-Content -LiteralPath ${powershellLiteral(resultFile)} -Encoding ascii\r\nWrite-Host '操作已结束。可以关闭此窗口。'\r\n`;

}
/** Only the exit code is collected. Provider output stays in the user's terminal. */
export async function startWindowsAgentTerminal(executable:string,args:string[],resultDir:string){
 const command=windowsAgentScript(executable,args,path.join(resultDir,'exit-code'));
 fs.writeFileSync(path.join(resultDir,'operation.ps1'),'\ufeff'+command,'utf8');
 const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const child=spawn(powershell,['-NoLogo','-NoProfile','-NoExit','-Command',command],{detached:true,windowsHide:false,stdio:'ignore'});
 await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
 child.unref();return child.pid!;
}
export function windowsAgentTerminalState(pid:number,resultDir:string){
 if(fs.existsSync(path.join(resultDir,'exit-code')))return 'finished';
 try{process.kill(pid,0);return 'waiting'}catch{return 'closed'}
}
