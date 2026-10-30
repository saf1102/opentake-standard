import crypto from 'node:crypto';
import {agentSettingsFile} from './agent-settings.ts';
import {spawn} from 'node:child_process';
import type {ConnectionId} from '../shared/agent-connections.ts';
export type ConnectionSecretStore={read(id:ConnectionId):Promise<string>;write(id:ConnectionId,key:string):Promise<void>;remove(id:ConnectionId):Promise<void>};
export type SecurityRun=(args:string[],stdin?:string)=>Promise<{code:number;stdout:string}>;
const runSecurity:SecurityRun=(args,stdin)=>new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/security',args,{stdio:[stdin===undefined?'ignore':'pipe','pipe','ignore']});let stdout='';
 const timer=setTimeout(()=>{child.kill();reject(Error('钥匙串操作超时'));},15000);
 child.stdout?.setEncoding('utf8');child.stdout?.on('data',chunk=>{stdout+=chunk;if(stdout.length>65536)child.kill();});
 child.on('error',()=>{clearTimeout(timer);reject(Error('钥匙串不可用'));});child.on('close',code=>{clearTimeout(timer);resolve({code:code??1,stdout});});child.stdin?.on('error',()=>{});if(stdin!==undefined)child.stdin?.end(stdin);
});
export function connectionSecretStore(run:SecurityRun=runSecurity,platform=process.platform):ConnectionSecretStore {
 const scope=crypto.createHash('sha256').update(process.env.LINKREADER_CONNECTION_SETTINGS_FILE||agentSettingsFile()).digest('hex').slice(0,16);
 const service=(id:ConnectionId)=>`opentake.connection.${scope}.${id}`;
 const args=(action:string,id:ConnectionId)=>[action,'-a','opentake','-s',service(id)];
 const requireMac=()=>{if(platform!=='darwin')throw Error('当前系统尚未适配统一接入钥匙串；不会把密钥存入明文文件');};
 return {
 async read(id){requireMac();const result=await run([...args('find-generic-password',id),'-w']).catch(()=>{throw Error('读不了系统钥匙串，请检查访问权限');});if(result.code===44)return '';if(result.code!==0)throw Error('读不了系统钥匙串，请检查访问权限');return result.stdout.trim();},
 async write(id,key){requireMac();if(!/^[A-Za-z0-9._~+\/-]{8,4096}={0,2}$/.test(key))throw Error('密钥格式不正确，请勿包含空格、换行或引号');const result=await run(['-i'],`add-generic-password -U -a opentake -s ${service(id)} -w ${key}\n`).catch(()=>{throw Error('无法保存到系统钥匙串');});if(result.code!==0)throw Error('无法保存到系统钥匙串');},
 async remove(id){requireMac();const result=await run(args('delete-generic-password',id)).catch(()=>{throw Error('无法删除系统钥匙串中的密钥');});if(result.code!==0&&result.code!==44)throw Error('无法删除系统钥匙串中的密钥');},
 };
}
