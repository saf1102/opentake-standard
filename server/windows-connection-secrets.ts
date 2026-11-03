import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {atomicWriteFileSync} from './file-ops.ts';
import type {ConnectionSecretStore} from './connection-secrets.ts';

const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security;
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json;
$bytes=[Convert]::FromBase64String($request.data);
$entropy=[Text.Encoding]::UTF8.GetBytes($request.scope);
if($request.action -eq 'protect'){$result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
else{$result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)};
[Console]::Out.Write([Convert]::ToBase64String($result));`;
async function transform(action:'protect'|'unprotect',data:Buffer,scope:string){
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 return new Promise<Buffer>((resolve,reject)=>{
  const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  let output='',settled=false;
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(Buffer.from(output.trim(),'base64'));};
  const timer=setTimeout(()=>{child.kill();finish(Error('Windows 密钥保护操作超时'));},15000);
  child.stdout.setEncoding('ascii');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){child.kill();finish(Error('Windows 密钥保护返回无效数据'));}});
  child.once('error',()=>finish(Error('Windows 密钥保护不可用')));
  child.once('close',code=>finish(code===0?undefined:Error('Windows 无法保护或读取此用户的 API 密钥')));
  child.stdin.on('error',()=>{});
  // Secrets travel only on stdin; they never appear in command arguments or environment.
  child.stdin.end(JSON.stringify({action,scope,data:data.toString('base64')}));
 });
}
export function windowsConnectionSecretStore(directory:string,scope:string):ConnectionSecretStore{
 const file=(id:string)=>{if(!/^[a-z][a-z0-9-]{0,40}$/.test(id))throw Error('接入标识无效');return path.join(directory,id+'.dpapi');};
 return {
  async read(id){const target=file(id);if(!fs.existsSync(target))return '';return (await transform('unprotect',fs.readFileSync(target),scope)).toString('utf8');},
  async write(id,key){if(!/^[A-Za-z0-9._~+\/-]{8,4096}={0,2}$/.test(key))throw Error('密钥格式不正确，请勿包含空格、换行或引号');const encrypted=await transform('protect',Buffer.from(key,'utf8'),scope);atomicWriteFileSync(file(id),encrypted,{mode:0o600});},
  async remove(id){fs.rmSync(file(id),{force:true});},
 };
}
