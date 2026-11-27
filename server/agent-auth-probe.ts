import platform from './platform.ts';
import {deepseekHarnessRoute,deepseekKeyRejected,deepseekNoKey,deepseekAuthReply,deepseekAccountRejected,deepseekInvalidKeyHint,deepseekLoginHint,deepseekModelHint,deepseekSwitchHint} from './deepseek-harness.ts';
import {execFileAsync} from './proc.ts';
import {spawnAgentProcess} from './agent-launch.ts';
import {classifyAgentFailure} from './agent-failure.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

import type {CliAuthState,ConnectionModel} from '../shared/agent-connections.ts';

export type AuthProbeResult={state:CliAuthState;message:string;checkedAt?:string;models?:ConnectionModel[];acpModelSelection?:boolean;deepseekRoute?:'official'|'account';deepseekVerified?:boolean;deepseekKeyRejected?:boolean;deepseekAccountRejected?:boolean;verified?:boolean};
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

type DshProbe={useKey:boolean;keyRejected:boolean;verify:boolean;model:string};
type AcpResult={protocolVersion?:number;sessionId?:string;models?:unknown;configOptions?:unknown;stopReason?:string};
type Request=(method:string,params:Record<string,unknown>)=>Promise<AcpResult>;
type AcpError={code?:number;message?:string;data?:unknown};
function authRequired(error:unknown){
 const rpc=error as AcpError;
 return rpc?.code===-32000||/auth(?:entication)?[_ -]required|not logged in|please (?:log|sign) in/i.test(rpc?.message??'');
}
async function checkHarnessSession(session:AcpResult,options:DshProbe,request:Request,reply:{text:string;keyRejected:boolean}):Promise<AuthProbeResult>{
 let keyRejected=options.keyRejected;
 let configOptions=session.configOptions;
 let provider=options.useKey?'deepseek-official' as const:'deepseek-account' as const;
 for(;;){
  const usingKey=provider==='deepseek-official';
  const warning=keyRejected?deepseekInvalidKeyHint:'';
  let route;
  try{route=deepseekHarnessRoute(configOptions,provider,options.model)}
  catch{
   const available=deepseekHarnessRoute(configOptions,provider);
   if(keyRejected&&!usingKey)route=available;
   else return {state:'unknown',message:warning+deepseekModelHint,models:available?.models,acpModelSelection:!!available};
  }
  if(!route)return {state:'needs-login',message:warning+deepseekLoginHint,deepseekKeyRejected:keyRejected};
  const selection={deepseekRoute:usingKey?'official' as const:'account' as const,models:route.models,acpModelSelection:true};
  try{
   if(!route.current||options.useKey&&!usingKey){
    const selected=await request('session/set_config_option',{sessionId:session.sessionId,configId:route.configId,value:route.value});
    if(selected.configOptions!==undefined)configOptions=selected.configOptions;
    if(selected.configOptions!==undefined&&!deepseekHarnessRoute(configOptions,provider,route.model)?.current)return {...selection,state:'unknown',message:warning+deepseekSwitchHint,deepseekKeyRejected:keyRejected};
   }
   if(options.verify){
    reply.text='';
    const response=await request('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'只回复 OK。'}]});
    const authReply=deepseekAuthReply(reply.text);
    if(authReply==='invalid-key'||authReply==='unauthorized')throw {code:401,message:'Credentials rejected'};
    if(authReply==='missing-key')throw Error(deepseekLoginHint);
    if(authReply==='login')throw {code:-32000,message:'Authentication required'};
    const text=reply.text.trim();
    if(response.stopReason!=='end_turn'||!text||/^(?:(?:api |http |provider )?(?:error|failure)\b|access denied\b|unauthorized\b|forbidden\b|操作失败|请求失败|认证失败|错误[：:])/i.test(text))throw Error('invalid probe reply');
   }
   const label=usingKey?'API 密钥':'DeepSeek 桌面账号';
   const models=deepseekHarnessRoute(configOptions,provider,route.model)?.models??route.models;
   const message=keyRejected?'已改用 DeepSeek 桌面账号':('当前使用'+label);
   return {state:'connected',...selection,models,deepseekKeyRejected:keyRejected,deepseekVerified:options.verify,message:warning+message+(options.verify?'，已验证。':'，可点「检查」验证。')};
  }catch(error){
   if(usingKey&&deepseekKeyRejected(error)){keyRejected=true;reply.keyRejected=true;provider='deepseek-account';continue;}
   if(usingKey&&(authRequired(error)||deepseekNoKey(error)||error instanceof Error&&error.message===deepseekLoginHint))return {...selection,state:'needs-login',message:deepseekLoginHint};
   if(!usingKey&&(authRequired(error)||deepseekAccountRejected(error)))return {...selection,state:'needs-login',message:warning+deepseekLoginHint,deepseekKeyRejected:keyRejected,deepseekAccountRejected:true};
   return {...selection,state:'unknown',message:warning+'DeepSeek Harness 未能完成检查，请重新检查',deepseekKeyRejected:keyRejected};
  }
 }
}

export const VERIFY_PROMPT='只回复 OK。';
/** 接通时的一句话测试：只开会话不够（有的智能体不登录也能开会话，套餐不含也能开），要让它真回一句话。 */
function verifyFailure(error:unknown,info:Pick<AuthProbeResult,'models'|'acpModelSelection'>):AuthProbeResult{
 const failure=classifyAgentFailure(error);
 // 套餐、额度先于「要登录」判断：Kimi 的「套餐不含」报错也带 auth_required。
 if(failure.kind==='model-plan'||failure.kind==='quota'||failure.kind==='rate-limit'||failure.kind==='busy')return {state:'unknown',message:failure.message,...info};
 if(failure.kind==='credentials'||authRequired(error))return {state:'needs-login',message:'还没登录',...info};
 return {state:'unknown',message:'一句话测试没通过：智能体没有正常回复，请重新检查',...info};
}
async function verifyAgentReply(session:AcpResult,request:Request,reply:{text:string}):Promise<AuthProbeResult>{
 const info=acpSessionModelInfo(session);
 reply.text='';
 try{
  const response=await request('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:VERIFY_PROMPT}]});
  const text=reply.text.trim();
  // 有的智能体把服务端错误当成普通回复文字返回，所以文字本身也要过一遍失败分类。
  if(text&&classifyAgentFailure(text).kind!=='other')return verifyFailure(text,info);
  if(response.stopReason==='end_turn'&&text)return {state:'connected',message:'已接通，一句话测试通过',verified:true,...info};
  return {state:'unknown',message:'一句话测试没通过：智能体没有正常回复，请重新检查',...info};
 }catch(error){return verifyFailure(error,info)}
}

/** Login probes advertise no tools. A user-initiated Harness check also verifies one short reply. */
export async function probeAcpAuthentication(executable:string,args:readonly string[],options:{env?:NodeJS.ProcessEnv;timeoutMs?:number;signal?:AbortSignal;tempRoot?:string;deepseek?:DshProbe;verify?:boolean}={}):Promise<AuthProbeResult>{
 if(options.signal?.aborted)return {state:'unknown',message:'检查已取消'};
 const cwd=fs.mkdtempSync(path.join(options.tempRoot??os.tmpdir(),'opentake-auth-'));
 try{return await new Promise<AuthProbeResult>(resolve=>{
  let child:ReturnType<typeof spawn>;
  try{child=spawnAgentProcess(executable,[...args],{cwd,env:options.env,stdio:['pipe','pipe','ignore'],detached:process.platform!=='win32'});}catch{resolve({state:'unknown',message:'没查到，命令行未能启动'});return;}
  let buffer='',bytes=0,finished=false,answer:AuthProbeResult|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
  let id=0,sessionId:string|undefined;
  const reply={text:'',keyRejected:options.deepseek?.keyRejected??false};
  let pending:{id:number;resolve:(response:AcpResult)=>void;reject:(error:unknown)=>void}|undefined;
  const terminate=(signal:NodeJS.Signals)=>{try{if(child.pid)platform.killTree(child.pid,signal);else child.kill(signal)}catch{/* already exited */}};
  const clean=()=>{clearTimeout(timeout);if(killTimer)clearTimeout(killTimer);options.signal?.removeEventListener('abort',abort);finished=true;pending?.reject(Error('closed'));const result:AuthProbeResult=answer??{state:'unknown',message:'没查到，命令行提前退出'};
   resolve(reply.keyRejected&&!result.deepseekKeyRejected?{...result,deepseekKeyRejected:true,message:deepseekInvalidKeyHint+result.message}:result);
  };
  const finish=(result:AuthProbeResult)=>{if(finished)return;finished=true;answer=result;clearTimeout(timeout);child.stdin?.end();terminate('SIGTERM');killTimer=setTimeout(()=>terminate('SIGKILL'),500);};
  const abort=()=>finish({state:'unknown',message:'检查已取消'});
  const timeout=setTimeout(()=>finish({state:'unknown',message:'没查到，检查超时，请重新检查'}),options.timeoutMs??(options.verify||options.deepseek?.verify?60000:30000));
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)abort();
  child.once('error',()=>{answer={state:'unknown',message:'没查到，命令行未能启动'};clean()});
  child.once('close',clean);
  child.stdin?.on('error',()=>finish({state:'unknown',message:'没查到，连接已中断'}));
  const send=(value:unknown)=>{if(!finished)child.stdin?.write(JSON.stringify(value)+'\n')};
  const request:Request=(method,params)=>new Promise((resolve,reject)=>{
   if(finished){reject(Error('closed'));return}
   pending={id:++id,resolve,reject};send({jsonrpc:'2.0',id,method,params});
  });
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data',(chunk:string)=>{
   if(finished)return;bytes+=Buffer.byteLength(chunk);if(bytes>1024*1024){finish({state:'unknown',message:'没查到，命令行返回异常'});return;}
   buffer+=chunk;let end:number;
   while((end=buffer.indexOf('\n'))!==-1&&!finished){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
    let response:{jsonrpc?:string;id?:number|string;method?:string;params?:{sessionId?:string;update?:{sessionUpdate?:string;content?:{type?:string;text?:string}}};error?:AcpError;result?:AcpResult};
    try{response=JSON.parse(line)}catch{finish({state:'unknown',message:'没查到，ACP 返回格式不正确'});break;}
    if(response===null||typeof response!=='object'||response.jsonrpc!=='2.0'){finish({state:'unknown',message:'没查到，ACP 返回格式不正确'});break;}
    if(typeof response.method==='string'){
     if(response.id!==undefined)send({jsonrpc:'2.0',id:response.id,error:{code:-32601,message:'Login check does not provide client methods'}});
     else if((options.deepseek?.verify||options.verify)&&response.method==='session/update'&&sessionId&&sessionId===response.params?.sessionId){
      const update=response.params.update;
      if(update?.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text'&&typeof update.content.text==='string')reply.text+=update.content.text;
     }
     continue;
    }
    if(pending&&response.id===pending.id){
     const waiter=pending;pending=undefined;
     if(response.error)waiter.reject(response.error);else waiter.resolve(response.result??{});
    }
   }
  });
  void (async()=>{
   const init=await request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'opentake-login-check',version:'1'}});
   if(init.protocolVersion!==1){finish({state:'pending',message:'这个 ACP 版本待适配，可改用 API 密钥'});return;}
   const session=await request('session/new',{cwd,mcpServers:[]});sessionId=session.sessionId;
   if(typeof sessionId!=='string'||!sessionId){finish({state:'unknown',message:'没查到，没有返回有效会话'});return;}
   finish(options.deepseek?await checkHarnessSession(session,options.deepseek,request,reply):options.verify?await verifyAgentReply(session,request,reply):{state:'connected',message:'已接通',...acpSessionModelInfo(session)});
  })().catch((error:AcpError)=>{
   if(options.deepseek?.useKey&&deepseekKeyRejected(error)){
    finish({state:'needs-login',deepseekKeyRejected:true,message:deepseekInvalidKeyHint+deepseekLoginHint});
   }else if(options.deepseek&&!options.deepseek.useKey&&(deepseekAccountRejected(error)||authRequired(error))){
    finish({state:'needs-login',deepseekAccountRejected:true,message:deepseekLoginHint});
   }else if(!options.deepseek&&classifyAgentFailure(error).kind!=='other'){
    finish(verifyFailure(error,{}));
   }else if(authRequired(error)){
    finish({state:'needs-login',message:options.deepseek?deepseekLoginHint:'还没登录'});
   }else{
    finish({state:'unknown',message:/EPERM|EACCES|operation not permitted|permission denied/i.test(error?.message??'')?'没查到，本机权限不足，请重新检查':'没查到，ACP 检查失败，请重新检查'});
   }
  });
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
