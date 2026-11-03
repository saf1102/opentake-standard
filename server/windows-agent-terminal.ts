import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

export const powershellLiteral=(value:string)=>{
 if(/[\r\n\0]/.test(value))throw Error('命令参数不能包含换行或空字符');
 return "'"+value.replaceAll("'","''")+"'";
};
export function windowsAgentScript(executable:string,args:string[],resultFile:string){
 return "$ErrorActionPreference='Stop'\r\n$operationCode=1\r\ntry {\r\n & "+[executable,...args].map(powershellLiteral).join(' ')+
  "\r\n if($null -ne $LASTEXITCODE){$operationCode=$LASTEXITCODE}else{$operationCode=0}\r\n} catch { Write-Host $_.Exception.Message }\r\n"+
  `$operationCode | Set-Content -LiteralPath ${powershellLiteral(resultFile)} -Encoding ascii\r\nWrite-Host '操作已结束。可以关闭此窗口。'\r\n`;
}
/** Only the exit code is collected. Provider output stays in the user's terminal. */
export async function startWindowsAgentTerminal(executable:string,args:string[],resultDir:string){
 const script=path.join(resultDir,'operation.ps1');
 fs.writeFileSync(script,'\ufeff'+windowsAgentScript(executable,args,path.join(resultDir,'exit-code')),'utf8');
 const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const child=spawn(powershell,['-NoLogo','-NoProfile','-NoExit','-Command',windowsAgentScript(executable,args,path.join(resultDir,'exit-code'))],{detached:true,windowsHide:false,stdio:'ignore'});
 await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
 child.unref();return child.pid!;
}
export function windowsAgentTerminalState(pid:number,resultDir:string){
 if(fs.existsSync(path.join(resultDir,'exit-code')))return 'finished';
 try{process.kill(pid,0);return 'waiting'}catch{return 'closed'}
}
