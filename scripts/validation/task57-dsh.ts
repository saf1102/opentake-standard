// 在沙盒外运行。参数为已安装 dsh 的绝对路径；不发送 prompt，不需任何账号或密钥。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileAsync} from '../../server/proc.ts';
import {probeAcpAuthentication} from '../../server/agent-auth-probe.ts';
import {agentAcpArgs} from '../../shared/agent-connections.ts';

const executable=process.argv[2];
if(!executable||!path.isAbsolute(executable)||!fs.statSync(executable,{throwIfNoEntry:false})?.isFile()){
 console.error('请传入已安装 dsh 程序的绝对路径。');process.exit(2);
}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-dsh-check-'));
try{
 const env:NodeJS.ProcessEnv={HOME:root,USERPROFILE:root,DSH_HOME:path.join(root,'dsh'),APPDATA:path.join(root,'roaming'),LOCALAPPDATA:path.join(root,'local'),TEMP:root,TMP:root,TMPDIR:root,XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),XDG_CACHE_HOME:path.join(root,'cache')};
 for(const [name,value] of Object.entries(process.env)){
  if(/^(path|systemroot|comspec|pathext|windir|programfiles|programfiles\(x86\)|lang)$/i.test(name))env[name]=value;
 }
 const result=await execFileAsync(executable,['--version'],{env,cwd:root,timeout:10000,maxBuffer:65536});
 const version=(result.stdout+' '+result.stderr).match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]{1,40})?\b/)?.[0];
 if(!version)throw Error('无法读取版本');
 const session=await probeAcpAuthentication(executable,agentAcpArgs('deepseek')!,{env,tempRoot:root,timeoutMs:60000});
 console.log(JSON.stringify({系统:process.platform,版本:version,协议:'ACP v1',建立隔离会话:session.state==='connected',提示:session.message,发送模型请求:false}));
 if(session.state!=='connected')process.exitCode=1;
}catch{console.error('验证失败，请确认 dsh 路径、运行权限和版本。');process.exitCode=1}
finally{fs.rmSync(root,{recursive:true,force:true})}
