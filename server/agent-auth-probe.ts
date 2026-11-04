import {execFileAsync} from './proc.ts';
import {spawnAgentProcess} from './agent-launch.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {CliAuthState,ConnectionModel} from '../shared/agent-connections.ts';

export type AuthProbeResult={state:CliAuthState;message:string;checkedAt?:string;models?:ConnectionModel[];acpModelSelection?:boolean};
export const AUTH_CONNECTED_TTL=10*60*1000;
export const AUTH_RETRY_TTL=15*1000;

/** Per-agent single flight. A changed executable/configuration waits for the previous check to finish. */
export function createAuthProbeCache(now:()=>number=Date.now){
 const cached=new Map<string,{signature:string;expires:number;result:AuthProbeResult}>();
 const running=new Map<string,{signature:string;promise:Promise<AuthProbeResult>}>();
 const generations=new Map<string,number>();
 async function check(key:string,signature:string,probe:()=>Promise<AuthProbeResult>,force=false):Promise<AuthProbeResult>{
  const active=running.get(key);
  if(active){if(active.signature===signature)return active.promise;await active.promise;return check(key,signature,probe,force);}
  const old=cached.get(key);if(!force&&old?.signature===signature&&old.expires>now())return old.result;
  const generation=generations.get(key)||0;
  const promise=Promise.resolve().then(probe).catch(()=>({state:'unknown' as const,message:'没查到，请重新检查'})).then(value=>{
   const result={...value,checkedAt:new Date(now()).toISOString()};
   if((generations.get(key)||0)===generation)cached.set(key,{signature,result,expires:now()+(result.state==='connected'?AUTH_CONNECTED_TTL:AUTH_RETRY_TTL)});
   return result;
  }).finally(()=>{if(running.get(key)?.promise===promise)running.delete(key)});
  running.set(key,{signature,promise});return promise;
 }
 const remember=(key:string,signature:string,result:AuthProbeResult)=>{cached.set(key,{signature,result,expires:now()+(result.state==='connected'?AUTH_CONNECTED_TTL:AUTH_RETRY_TTL)})};
 return {check,remember,forget:(key:string)=>{cached.delete(key);generations.set(key,(generations.get(key)||0)+1)}};
}

/** ACP v1 login-only handshake. No prompt, tools, filesystem access or MCP servers are offered.
 * Kimi 等可在未登录时建立 session；成功只说明握手可用。运行时凭据拒绝优先，
 * agent-connections 会锁定「还没登录」，重新完成登录并探测成功前不得用握手覆盖。 */
export async function probeAcpAuthentication(executable:string,args:readonly string[],options:{env?:NodeJS.ProcessEnv;timeoutMs?:number;signal?:AbortSignal;tempRoot?:string}={}):Promise<AuthProbeResult>{
 if(options.signal?.aborted)return {state:'unknown',message:'检查已取消'};
 const cwd=fs.mkdtempSync(path.join(options.tempRoot??os.tmpdir(),'opentake-auth-'));
 try{return await new Promise<AuthProbeResult>(resolve=>{
  let child:ReturnType<typeof spawn>;
  try{child=spawnAgentProcess(executable,[...args],{cwd,env:options.env,stdio:['pipe','pipe','ignore'],detached:process.platform!=='win32'});}catch{resolve({state:'unknown',message:'没查到，命令行未能启动'});return;}
  let buffer='',bytes=0,finished=false,phase:'initialize'|'session'='initialize',answer:AuthProbeResult|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
  const terminate=(signal:NodeJS.Signals)=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,signal);else child.kill(signal)}catch{/* already exited */}};
  const clean=()=>{clearTimeout(timeout);if(killTimer)clearTimeout(killTimer);options.signal?.removeEventListener('abort',abort);resolve(answer??{state:'unknown',message:'没查到，命令行提前退出'});};
  const finish=(result:AuthProbeResult)=>{if(finished)return;finished=true;answer=result;clearTimeout(timeout);child.stdin?.end();terminate('SIGTERM');killTimer=setTimeout(()=>terminate('SIGKILL'),500);};
  const abort=()=>finish({state:'unknown',message:'检查已取消'});
  const timeout=setTimeout(()=>finish({state:'unknown',message:'没查到，检查超时，请重新检查'}),options.timeoutMs??30000);
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)abort();
  child.once('error',()=>{finished=true;answer={state:'unknown',message:'没查到，命令行未能启动'};clean()});
  child.once('close',clean);
  child.stdin?.on('error',()=>finish({state:'unknown',message:'没查到，连接已中断'}));
  const send=(value:unknown)=>{if(!finished)child.stdin?.write(JSON.stringify(value)+'\n')};
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data',(chunk:string)=>{
   if(finished)return;bytes+=Buffer.byteLength(chunk);if(bytes>1024*1024){finish({state:'unknown',message:'没查到，命令行返回异常'});return;}
   buffer+=chunk;let end:number;
   while((end=buffer.indexOf('\n'))!==-1&&!finished){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
    let response:{jsonrpc?:string;id?:number|string;method?:string;error?:{code?:number;message?:string};result?:{protocolVersion?:number;sessionId?:string;models?:unknown;configOptions?:unknown}};
    try{response=JSON.parse(line)}catch{finish({state:'unknown',message:'没查到，ACP 返回格式不正确'});break;}
    if(response===null||typeof response!=='object'||response.jsonrpc!=='2.0'){finish({state:'unknown',message:'没查到，ACP 返回格式不正确'});break;}
    // Never execute a server-initiated tool/permission request while checking login.
    if(response.method){if(response.id!==undefined)send({jsonrpc:'2.0',id:response.id,error:{code:-32601,message:'Login check does not provide client methods'}});continue;}
    if(response.id!==(phase==='initialize'?1:2))continue;
    if(response.error){finish(response.error.code===-32000||/auth(?:entication)?[_ -]required/i.test(response.error.message??'')?{state:'needs-login',message:'还没登录'}:{state:'unknown',message:/EPERM|EACCES|operation not permitted|permission denied/i.test(response.error.message??'')?'没查到，本机权限不足，请重新检查':'没查到，ACP 检查失败，请重新检查'});break;}
    if(response.id===1){
     if(response.result?.protocolVersion!==1){finish({state:'pending',message:'这个 ACP 版本待适配，可改用 API 密钥'});break;}
     phase='session';
     send({jsonrpc:'2.0',id:2,method:'session/new',params:{cwd,mcpServers:[]}});
    }else finish(typeof response.result?.sessionId==='string'&&response.result.sessionId.length>0?{state:'connected',message:'已接通',...acpSessionModelInfo(response.result)}:{state:'unknown',message:'没查到，没有返回有效会话'});
   }
  });
  send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'opentake-login-check',version:'1'}}});
 });}finally{fs.rmSync(cwd,{recursive:true,force:true})}
}

/** Only the advertised model catalog is exposed, never authMethods or provider/account metadata. */
export function acpSessionModelInfo(result:{models?:unknown;configOptions?:unknown}):{models:ConnectionModel[];acpModelSelection:boolean}{
 const safeId=(value:unknown):value is string=>typeof value==='string'&&/^[\w.\/:_,-]{1,180}$/.test(value);
 const state=result.models&&typeof result.models==='object'?result.models as Record<string,unknown>:{};
 const current=typeof state.currentModelId==='string'?state.currentModelId:'';
 const catalog=Array.isArray(state.availableModels)?state.availableModels:[];
 const models:ConnectionModel[]=catalog.flatMap(value=>{
  if(!value||typeof value!=='object')return [];
  const model=value as Record<string,unknown>;
  return safeId(model.modelId)?[{id:model.modelId,name:typeof model.name==='string'?model.name.replace(/[\r\n\0]/g,' ').slice(0,100):model.modelId,isDefault:model.modelId===current}]:[];
 });
 if(!models.length&&Array.isArray(result.configOptions)){
  const option=result.configOptions.find(value=>value&&typeof value==='object'&&(value as Record<string,unknown>).category==='model') as Record<string,unknown>|undefined;
  if(option&&Array.isArray(option.options))for(const value of option.options){
   const entries=value&&typeof value==='object'&&Array.isArray((value as Record<string,unknown>).options)?(value as {options:unknown[]}).options:[value];
   for(const item of entries){if(!item||typeof item!=='object')continue;const entry=item as Record<string,unknown>;
    if(safeId(entry.value))models.push({id:entry.value,name:typeof entry.name==='string'?entry.name.replace(/[\r\n\0]/g,' ').slice(0,100):entry.value,isDefault:entry.value===option.currentValue});
   }
  }
 }
 return {models:models.slice(0,200),acpModelSelection:models.length>0};
}

/** CLI status commands may print an account name. Parse in memory, never return or log their raw output. */
export async function probeAgentStatusCommand(executable:string,args:readonly string[],options:{env?:NodeJS.ProcessEnv;timeoutMs?:number;signal?:AbortSignal;tempRoot?:string}={}):Promise<AuthProbeResult>{
 const cwd=fs.mkdtempSync(path.join(options.tempRoot??os.tmpdir(),'opentake-status-'));
 try{
  let output='',failed=false;
  try{const result=await execFileAsync(executable,[...args],{cwd,env:options.env,timeout:options.timeoutMs??8000,signal:options.signal,maxBuffer:65536});output=result.stdout+' '+result.stderr;}
  catch(error){failed=true;const result=error as {stdout?:string;stderr?:string};output=String(result.stdout??'')+' '+String(result.stderr??'');}
  const text=output.replace(/\x1b\[[0-9;]*m/g,'');
  if(/not (?:logged in|authenticated)|unauthenticated|authentication required|please (?:log|sign) in/i.test(text))return {state:'needs-login',message:'还没登录'};
  if(failed)return {state:'unknown',message:'没查到，请重新检查'};
  if(args[0]==='auth'&&args[1]==='list'){
   const totals=[...text.matchAll(/\b(\d+)\s+(?:credentials?|environment variables?)\b/gi)].map(match=>Number(match[1]));
   if(totals.some(count=>count>0))return {state:'connected',message:'已接通'};
   if(totals.length||/no (?:credentials|authenticated providers)/i.test(text))return {state:'needs-login',message:'还没登录'};
  }else if(/(?:logged in|authenticated|signed in)(?:\s+(?:as|with)|\s*[:✓]|\s*$)/im.test(text))return {state:'connected',message:'已接通'};
  return {state:'unknown',message:'没查到，请重新检查'};
 }finally{fs.rmSync(cwd,{recursive:true,force:true})}
}
