import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cliVersionNumber,type ConnectionId} from '../shared/agent-connections.ts';
import installations from './agent-installation.ts';
import {isClaudeExecutable} from './agent-roster.ts';
import {execFileAsync} from './proc.ts';

/** Run the selected CLI in an empty directory. Only its version number leaves the probe. */
export async function validateAgentProgram(id:ConnectionId,file:string,claudePath?:string,readVersion?:(file:string)=>Promise<string|undefined>){
 if(typeof file!=='string'||file.length>4096||/[\r\n\0]/.test(file))throw Error('程序路径不正确');
 if(!path.isAbsolute(file))throw Error('请填写程序的完整绝对路径');
 if(id==='codebuddy'&&installations.isWorkBuddyProgram(file))throw Error('请选择腾讯官方独立的 CodeBuddy 命令行，WorkBuddy 桌面版的内置程序无法登录或出片');
 if(installations.agentFileStatus(file)!=='executable')throw Error('这个文件不是可运行的命令行程序，请检查路径和权限');
 if(id!=='claude'&&isClaudeExecutable(file,process.env,claudePath))throw Error('不能把 Claude Code 程序绑定为其他智能体');
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-version-'));
 try{
  let output:string|undefined;
  if(readVersion)output=await readVersion(file);
  else{
   const result=await execFileAsync(file,['--version'],{cwd,env:installations.sanitizeAgentEnv(installations.loginEnvironment()),timeout:8000,maxBuffer:65536});
   output=result.stdout+'\n'+result.stderr;
  }
  const version=cliVersionNumber(id,output||'');
  if(!version||id==='codex'&&!/^codex(?:-cli)?\b/i.test(output!.trim()))throw Error();
  return version;
 }catch{throw Error('程序未能回答 --version，请检查路径和安装状态');}
 finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
