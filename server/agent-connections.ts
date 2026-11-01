import {serviceCliPath,saveServiceCliPath,testServiceCli} from './connection-services.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {execFileAsync} from './proc.ts';
import installations from './agent-installation.ts';
import {ROSTER_AGENTS,rosterAgentStatus,isClaudeExecutable} from './agent-roster.ts';
import {createAuthProbeCache,probeAcpAuthentication,probeAgentStatusCommand,type AuthProbeResult} from './agent-auth-probe.ts';
import {agentSettingsFile,atomicAgentJson,readAgentSettings,getAgentCatalog} from './agent-settings.ts';
import {connectionSecretStore,type ConnectionSecretStore} from './connection-secrets.ts';
import {filmVersionOutdated,agentAcpArgs,agentCliLoginArgs,CONNECTION_IDS,CONNECTION_DEFINITIONS,connectionDefinition,defaultConnection,isRelay,type ConnectionId,type ConnectionConfig,type ConnectionView,type ConnectionModel} from '../shared/agent-connections.ts';
const configSchema=z.object({authRejectedAt:z.string().optional(),revision:z.number().int().nonnegative().optional(),mode:z.enum(['cli','api']),enabled:z.boolean(),baseUrl:z.string().max(2048),model:z.string().regex(/^[\w.\/:_,-]+$/),cliPath:z.string().max(4096),hasKey:z.boolean(),models:z.array(z.object({id:z.string(),name:z.string(),isDefault:z.boolean().optional()})),checkedAt:z.string().optional(),connected:z.boolean().optional(),message:z.string().optional()}).strict();
const file=()=>process.env.LINKREADER_CONNECTION_SETTINGS_FILE||path.join(path.dirname(agentSettingsFile()),'agent-connections.json');
function readConfigs():Partial<Record<ConnectionId,ConnectionConfig>> {if(!fs.existsSync(file()))return {};try{return z.partialRecord(z.enum(CONNECTION_IDS),configSchema).parse(JSON.parse(fs.readFileSync(file(),'utf8')))}catch{throw Error('接入设置文件损坏，未覆盖原文件，请恢复备份');}}
export function getConnectionConfig(id:ConnectionId):ConnectionConfig{return {...defaultConnection(id),...readConfigs()[id]};}
function persist(id:ConnectionId,config:ConnectionConfig){atomicAgentJson(file(),{...readConfigs(),[id]:configSchema.parse(config)});}
const disabledListeners=new Set<(id:ConnectionId)=>void>();
const credentialRejectedListeners=new Set<(id:ConnectionId)=>void>();
const connectionStatusListeners=new Set<(event:{id:ConnectionId;revision:number})=>void>();
export function onAgentConnectionStatusChanged(listener:(event:{id:ConnectionId;revision:number})=>void){connectionStatusListeners.add(listener);return ()=>{connectionStatusListeners.delete(listener)}};
const emitConnectionStatus=(id:ConnectionId,revision:number)=>{for(const listener of connectionStatusListeners)listener({id,revision})};
export function onAgentCredentialsRejected(listener:(id:ConnectionId)=>void){credentialRejectedListeners.add(listener);return ()=>{credentialRejectedListeners.delete(listener)}};
export function onAgentDisabled(listener:(id:ConnectionId)=>void){disabledListeners.add(listener);return ()=>{disabledListeners.delete(listener);};}
const changingAccounts=new Set<ConnectionId>();
export function setAgentAccountChanging(id:ConnectionId,changing:boolean){if(changing)changingAccounts.add(id);else changingAccounts.delete(id);}
export function assertAgentWorkAllowed(id:ConnectionId){assertAgentExecutionAllowed(id);if(changingAccounts.has(id))throw Error('这家智能体正在换账号，请登录完成后再出片');}
export function assertAgentExecutionAllowed(id:ConnectionId){if(!getConnectionConfig(id).enabled)throw Error(id==='claude'?'Claude Code 开关已关闭，OpenTake 不会启动它':'所选智能体未接通，请到设置重新接通');}
export function connectionEndpoint(base:string,route:string){return `${base.replace(/\/$/,'')}/${route.replace(/^\//,'')}`;}
export function validateConnectionBaseUrl(value:string){let url:URL;try{url=new URL(value)}catch{throw Error('接口地址格式不正确，请填写完整 HTTPS 地址');}if(url.username||url.password||url.search||url.hash)throw Error('接口地址不能带密码、查询参数或片段');if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('接口地址必须使用 HTTPS（本机测试地址除外）');return value.replace(/\/$/,'');}
export type ConnectionDependencies={store?:ConnectionSecretStore;fetcher?:typeof fetch;detect?:(id:ConnectionId,config:ConnectionConfig)=>Promise<string|undefined>;cliTest?:(id:ConnectionId,executable:string)=>Promise<{connected:boolean;models?:ConnectionModel[]}>;timeoutMs?:number;version?:(file:string)=>Promise<string|undefined>};
export async function detectConnectionExecutable(id:ConnectionId,config:ConnectionConfig=getConnectionConfig(id)){
 const otherAgentPath=(candidate:string|undefined)=>candidate&&!isClaudeExecutable(candidate,process.env,getConnectionConfig('claude').cliPath)?candidate:undefined;
 if(id==='dreamina'&&!config.cliPath)return otherAgentPath(serviceCliPath(id));
 if(id==='codex'||id==='claude')return installations.detectAgent(id,{configured:config.cliPath||(id==='codex'?readAgentSettings().cliPath:''),env:installations.loginEnvironment()}).executable;
 if(config.cliPath){try{fs.accessSync(config.cliPath,fs.constants.X_OK);return path.isAbsolute(config.cliPath)&&fs.statSync(config.cliPath).isFile()?otherAgentPath(config.cliPath):undefined}catch{return undefined}}
 const agent=ROSTER_AGENTS.find(item=>item.id===id);
 return agent?otherAgentPath((await rosterAgentStatus(agent,{readVersion:false})).executable):undefined;
}
const detectExecutable=detectConnectionExecutable;
/** Fixed login-only commands, never a command supplied by a browser or an ACP server. */
export function agentLoginArgs(id:ConnectionId):string[]|undefined{
 return agentCliLoginArgs(id);
}
const authCache=createAuthProbeCache();
const authControllers=new Map<string,AbortController>();
const authKey=(id:ConnectionId)=>`${file()}:${id}`;
const authSignature=(config:ConnectionConfig,executable:string)=>JSON.stringify([executable,config.revision||0,config.enabled]);
onAgentDisabled(id=>{authControllers.get(authKey(id))?.abort();authCache.forget(authKey(id));});
async function cliAuthentication(id:ConnectionId,config:ConnectionConfig,executable:string,deps:ConnectionDependencies,force=false,afterLogin=false):Promise<AuthProbeResult>{
 if(config.authRejectedAt&&!afterLogin)return {state:'needs-login',message:'还没登录',checkedAt:config.authRejectedAt};
 const key=authKey(id),signature=authSignature(config,executable);
 return authCache.check(key,signature,async()=>{
  assertAgentExecutionAllowed(id);
  if(deps.cliTest)return (await deps.cliTest(id,executable)).connected?{state:'connected',message:'已接通'}:{state:'needs-login',message:'还没登录'};
  if(id!=='codex'&&id!=='claude'&&!agentAcpArgs(id))return {state:'pending',message:connectionDefinition(id).cliReason||'命令行登录检查待适配，可改用 API 密钥'};
  const controller=new AbortController();authControllers.set(key,controller);
  try{
   const env=installations.sanitizeAgentEnv(installations.loginEnvironment());
   assertAgentExecutionAllowed(id);
   if(id==='cursor'||id==='opencode')return await probeAgentStatusCommand(executable,[...connectionDefinition(id).authStatusArgs!],{env,signal:controller.signal,timeoutMs:deps.timeoutMs});
   if(agentAcpArgs(id))return await probeAcpAuthentication(executable,agentAcpArgs(id)!,{env,signal:controller.signal,timeoutMs:deps.timeoutMs});
   try{
    assertAgentExecutionAllowed(id);const result=await execFileAsync(executable,id==='claude'?['auth','status','--json']:['login','status'],{env,signal:controller.signal,timeout:deps.timeoutMs??8000,maxBuffer:65536});
    if(id==='claude'){try{const value=JSON.parse(result.stdout);if(value.loggedIn===true)return {state:'connected',message:'已接通'};if(value.loggedIn===false)return {state:'needs-login',message:'还没登录'};}catch{}return {state:'unknown',message:'没查到，请重新检查'};}
    const output=result.stdout+' '+result.stderr;
    return /not logged in|not authenticated/i.test(output)?{state:'needs-login',message:'还没登录'}:/logged in/i.test(output)?{state:'connected',message:'已接通'}:{state:'unknown',message:'没查到，请重新检查'};
   }catch(error){
    // Inspect known auth markers only; raw CLI output may contain account data and is never returned/logged.
    const value=error as {stdout?:string;stderr?:string};
    const output=String(value.stdout??'')+' '+String(value.stderr??'');
    if(id==='claude'){try{if(JSON.parse(String(value.stdout)).loggedIn===false)return {state:'needs-login',message:'还没登录'};}catch{}}
    return /not logged in|not authenticated/i.test(output)?{state:'needs-login',message:'还没登录'}:{state:'unknown',message:'没查到，请重新检查'};
   }
  }finally{if(authControllers.get(key)===controller)authControllers.delete(key);}
 },force);
}
/** Runtime auth rejection outweighs a cached session/new success (Kimi may open anonymous sessions). */
export function markAgentCredentialsRejected(id:ConnectionId,expectedMode?:ConnectionConfig['mode'],expectedRevision?:number){
 const config=getConnectionConfig(id);if(expectedMode&&config.mode!==expectedMode)return;
 if(expectedRevision!==undefined&&(config.revision||0)!==expectedRevision)return;
 if(config.authRejectedAt)return;
 const key=authKey(id);authControllers.get(key)?.abort();authCache.forget(key);
 persist(id,{...config,revision:(config.revision||0)+1,connected:false,checkedAt:new Date().toISOString(),authRejectedAt:new Date().toISOString(),message:'还没登录'});
 for(const listener of credentialRejectedListeners)listener(id);
 emitConnectionStatus(id,(config.revision||0)+1);
}
/** Called only after our user-started login command exits successfully; ordinary refresh cannot clear rejection. */
export async function completeAgentLogin(id:ConnectionId,revision:number|undefined,deps:ConnectionDependencies={}):Promise<ConnectionView>{
 const config=getConnectionConfig(id);
 if(config.revision!==revision||config.mode!=='cli'||!config.enabled)return getConnectionStatus(id,deps);
 const executable=await (deps.detect??detectExecutable)(id,config);if(!executable)return getConnectionStatus(id,deps);
 const auth=await cliAuthentication(id,config,executable,deps,true,true);
 if(auth.state==='connected'&&getConnectionConfig(id).revision===revision){
  const next={...config,revision:(config.revision||0)+1,authRejectedAt:undefined,connected:true,checkedAt:auth.checkedAt,message:'已接通'};
  persist(id,next);authCache.remember(authKey(id),authSignature(next,executable),auth);emitConnectionStatus(id,next.revision);
 }
 return getConnectionStatus(id,deps);
}
const versionCache=new Map<string,{at:number;value?:string}>();
async function connectionVersion(executable:string,deps:ConnectionDependencies,force:boolean){
 if(deps.version)return deps.version(executable);
 // Injected connection probes in tests must not unexpectedly execute host binaries.
 if(deps.detect||deps.cliTest)return undefined;
 let signature=executable;try{const stat=fs.statSync(executable);signature+=`:${stat.mtimeMs}:${stat.size}`}catch{return undefined}
 const cached=versionCache.get(signature);if(!force&&cached&&Date.now()-cached.at<600000)return cached.value;
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-agent-version-'));let value:string|undefined;
 try{const result=await execFileAsync(executable,['--version'],{cwd,env:installations.sanitizeAgentEnv(installations.loginEnvironment()),timeout:5000,maxBuffer:65536});value=(result.stdout+' '+result.stderr).match(/\b\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][a-zA-Z0-9.-]{1,40})?\b/)?.[0]}catch{}finally{fs.rmSync(cwd,{recursive:true,force:true})}
 versionCache.set(signature,{at:Date.now(),value});return value;
}
async function connectionStatus(id:ConnectionId,deps:ConnectionDependencies,force=false):Promise<ConnectionView>{
 const config=getConnectionConfig(id),definition=connectionDefinition(id),executable=await (deps.detect??detectExecutable)(id,config);
 let connected=!!config.connected,auth:AuthProbeResult|undefined;
 const cliVersion=definition.kind==='agent'&&config.enabled&&executable?await connectionVersion(executable,deps,force):undefined;
 if(definition.kind==='agent'){
  auth=!config.enabled?{state:'disabled',message:executable?'已安装 · 默认不调用':'默认不调用'}:!executable?{state:'missing',message:'未安装'}:config.mode==='cli'?await cliAuthentication(id,config,executable,deps,force):undefined;
  if(config.mode==='cli')connected=auth?.state==='connected';
 }
 // Discard stale results if the user changed a path, mode or the Claude switch while a check was in flight.
 if(getConnectionConfig(id).revision!==config.revision)return connectionStatus(id,deps);
 connected=connected&&config.enabled&&(config.mode==='api'?config.hasKey:!!executable);
 return {...config,...definition,heavySupported:definition.heavySupported&&!(process.platform==='win32'&&id==='claude'),cliVersion,filmOutdated:filmVersionOutdated(cliVersion,definition.filmMinimumVersion),baseUrl:config.baseUrl,model:config.model,connected,cliInstalled:!!executable,executable,relay:isRelay(id,config.baseUrl),
  ...(config.mode==='cli'&&agentAcpArgs(id)?{models:auth?.models??[],acpModelSelection:auth?.acpModelSelection??false}:{}),
  ...(auth?{cliAuthState:auth.state,cliAuthMessage:auth.message,checkedAt:auth.checkedAt,message:auth.message}:{}),cliLoginAvailable:!!agentLoginArgs(id)&&!!executable&&config.enabled,
  state:!config.enabled?'disabled':connected?'connected':config.mode==='cli'?(auth?.state==='pending'?'pending':'unconfigured'):definition.protocol==='pending'?'pending':'unconfigured'};
}
export function getConnectionStatus(id:ConnectionId,deps:ConnectionDependencies={}):Promise<ConnectionView>{return connectionStatus(id,deps);}
export function refreshAgentConnection(id:ConnectionId,deps:ConnectionDependencies={}):Promise<ConnectionView>{return connectionStatus(id,deps,true);}
export async function listAgentConnections(includeServices=true,deps:ConnectionDependencies={}){return {connections:await Promise.all(CONNECTION_DEFINITIONS.filter(item=>includeServices||item.kind==='agent').map(item=>getConnectionStatus(item.id,deps)))};}
export async function saveAgentConnection(id:ConnectionId,input:unknown,deps:ConnectionDependencies={}){
 const patch=z.object({mode:z.enum(['cli','api']).optional(),enabled:z.boolean().optional(),baseUrl:z.string().optional(),model:z.string().regex(/^[\w.\/:_,-]+$/).optional(),cliPath:z.string().optional(),apiKey:z.string().optional(),confirmSubscriptionRisk:z.boolean().optional()}).strict().parse(input);
 const previous=getConnectionConfig(id),next={...previous,...patch,revision:(previous.revision||0)+1};delete (next as Record<string,unknown>).apiKey;delete (next as Record<string,unknown>).confirmSubscriptionRisk;
 if(next.mode==='api'&&next.baseUrl)next.baseUrl=validateConnectionBaseUrl(next.baseUrl);
 if(id==='claude'&&next.enabled&&next.mode==='cli'&&(!previous.enabled||previous.mode!=='cli')&&!patch.confirmSubscriptionRisk)throw Error('使用 Claude Code 订阅账号前必须确认风险；推荐改用 API 密钥');
 if(patch.apiKey){await (deps.store??connectionSecretStore()).write(id,patch.apiKey);next.hasKey=true;}
 const changed=patch.apiKey||['mode','baseUrl','model','cliPath'].some(key=>next[key as keyof ConnectionConfig]!==previous[key as keyof ConnectionConfig]);
 if(changed){next.connected=false;next.checkedAt=undefined;next.message=undefined;}
 if(next.baseUrl!==previous.baseUrl)next.models=[];
 if(id==='dreamina'&&patch.cliPath!==undefined)saveServiceCliPath(id,patch.cliPath);
 persist(id,next);
 if(id==='codex'&&patch.cliPath!==undefined){const settings=readAgentSettings();if(settings.cliPath!==patch.cliPath)atomicAgentJson(agentSettingsFile(),{...settings,cliPath:patch.cliPath});}
 if(!next.enabled)for(const listener of disabledListeners)listener(id);
 return getConnectionStatus(id,deps);
}
export async function deleteConnectionKey(id:ConnectionId,deps:ConnectionDependencies={}){await (deps.store??connectionSecretStore()).remove(id);persist(id,{...getConnectionConfig(id),revision:(getConnectionConfig(id).revision||0)+1,hasKey:false,connected:false,checkedAt:undefined});return getConnectionStatus(id,deps);}
function statusError(status:number){if(status===401)return '智能体缺少有效登录凭据，请重新登录或补充 API 密钥';if(status===403)return '没有这个接口或模型的权限，请检查套餐与服务权限';if(status===402)return '账户余额不足，请到服务商后台检查';if(status===429)return '请求过于频繁，请稍后再试';if(status===404||status===405||status===415||status===422)return '接口格式不兼容，请核对地址及该 Agent 要求的接口格式';return `服务连接失败（HTTP ${status}），请检查接口地址和服务状态`;}
/** Bound provider error reads and expose only a fixed category, never account-bearing response text. */
async function providerResponseError(response:Response):Promise<Error>{
 if(response.status===401){await response.body?.cancel().catch(()=>{});return Object.assign(Error(statusError(401)),{kind:'credentials'})}
 const reader=response.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();
 try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;const remaining=16*1024-bytes;text+=decoder.decode(value.subarray(0,remaining),{stream:true});bytes+=value.byteLength;if(bytes>=16*1024)break}}catch{/* use status fallback */}finally{await reader?.cancel().catch(()=>{})}
 try{const body=JSON.parse(text);const error=body?.error??body;text=typeof error==='string'?error:error&&typeof error==='object'?[error.code,error.type,error.message].filter(value=>typeof value==='string').join(' '):''}catch{/* some providers return plain text */}
 const {classifyAgentFailure}=await import('./general/acp.ts');
 const failure=classifyAgentFailure(`HTTP ${response.status} ${text}`);
 return failure.kind==='other'?Error(statusError(response.status)):Object.assign(Error(failure.message),{kind:failure.kind});
}
async function requestJson(id:ConnectionId,route:string,deps:ConnectionDependencies={},body?:unknown,signal?:AbortSignal,transient?:{config:ConnectionConfig;key:string}){
 const config=transient?.config??getConnectionConfig(id),key=transient?.key??await (deps.store??connectionSecretStore()).read(id);if(!key)throw Error('请先保存 API 密钥');
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(connectionDefinition(id).protocol==='anthropic'){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';}else headers.Authorization=`Bearer ${key}`;
 let response:Response;try{response=await (deps.fetcher??fetch)(connectionEndpoint(validateConnectionBaseUrl(config.baseUrl),route),{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(deps.timeoutMs??15000)]):AbortSignal.timeout(deps.timeoutMs??15000)});}catch{throw Error('连接超时或网络不可用，请检查地址、代理和网络');}
 if(!response.ok)throw await providerResponseError(response);
 const raw=await response.text();if(raw.length>2*1024*1024)throw Error('服务返回内容过大');try{return JSON.parse(raw.split(key).join('[密钥已隐藏]')) as Record<string,unknown>}catch{throw Error('接口格式不兼容：服务没有返回 JSON');}
}
export async function refreshConnectionModels(id:ConnectionId,deps:ConnectionDependencies={}){
 const config=getConnectionConfig(id);let models:ConnectionModel[]=[];
 if(config.mode==='cli'){
  assertAgentExecutionAllowed(id);if(id!=='codex')throw Error('此命令行不提供模型列表，填写模型或跟随默认');
  const catalog=await getAgentCatalog(config.cliPath);models=catalog.models.map(({id,name,isDefault})=>({id,name,isDefault}));
 }else{
  models=await readApiModels(id,config,(route,body)=>requestJson(id,route,deps,body));
 }
 if(getConnectionConfig(id).revision!==config.revision)throw Error('配置已改变，请重新读取模型');persist(id,{...getConnectionConfig(id),models});return models;
}
export async function testUnifiedConnection(id:ConnectionId,deps:ConnectionDependencies={}){
 const config=getConnectionConfig(id),start=Date.now();let message='',cliExecutable:string|undefined,cliAuth:AuthProbeResult|undefined;
 try{
  if(config.mode==='cli'){
   assertAgentExecutionAllowed(id);
   const executable=await (deps.detect??detectExecutable)(id,config);if(!executable)throw Error('本机没有命令行，请先安装');cliExecutable=executable;
   if(id==='dreamina'){await testServiceCli(id);}
   else {const auth=await cliAuthentication(id,config,executable,deps,true);if(auth.state!=='connected')throw Error(auth.message);cliAuth=auth;}
   message='账号连接正常；未运行生成任务';
  }else{
   message=await probeApiConnection(id,config,(route,body)=>requestJson(id,route,deps,body),()=>refreshConnectionModels(id,deps));
  }
  if(getConnectionConfig(id).revision!==config.revision)throw Error('配置已改变，请重新测试连接');
  const next={...getConnectionConfig(id),revision:(config.revision||0)+1,authRejectedAt:undefined,connected:true,checkedAt:new Date().toISOString(),message};
  persist(id,next);if(cliAuth&&cliExecutable)authCache.remember(authKey(id),authSignature(next,cliExecutable),cliAuth);emitConnectionStatus(id,next.revision);
  return {ok:true,durationMs:Date.now()-start,connection:await getConnectionStatus(id,deps)};
 }catch(error){message=error instanceof Error?error.message:'连接失败，请检查配置';if(getConnectionConfig(id).revision===config.revision)persist(id,{...getConnectionConfig(id),connected:false,checkedAt:new Date().toISOString(),message});return {ok:false,durationMs:Date.now()-start,error:message,connection:await getConnectionStatus(id,deps)};}
}

type ProbeRequest=(route:string,body?:unknown)=>Promise<Record<string,unknown>>;
async function readApiModels(id:ConnectionId,config:ConnectionConfig,request:ProbeRequest):Promise<ConnectionModel[]>{
 const definition=connectionDefinition(id);
  if(!['responses','anthropic','chat'].includes(definition.protocol))throw Error('官方未提供可读取的模型列表，请手动填写模型');
  const data=await request(definition.protocol==='anthropic'&&!/\/v1$/.test(config.baseUrl)?'v1/models':'models');
  const items=z.array(z.object({id:z.string(),display_name:z.string().optional(),name:z.string().optional(),is_default:z.boolean().optional()})).safeParse(data.data);
  if(!items.success||!items.data.length)throw Error('接口格式不兼容：没有返回可用模型列表');
  return items.data.map(m=>({id:m.id,name:m.display_name||m.name||m.id,isDefault:m.is_default}));
}
async function probeApiConnection(id:ConnectionId,config:ConnectionConfig,request:ProbeRequest,loadModels:()=>Promise<ConnectionModel[]>){
 const definition=connectionDefinition(id);
   if(definition.protocol==='pending')throw Error(definition.apiReason||'API 接入待适配');
   if(definition.protocol==='voices'){const data=await request('get_voice',{voice_type:'system'});const status=data.base_resp as {status_code?:number}|undefined;if(status?.status_code!==undefined&&status.status_code!==0)throw Error('密钥或服务权限不可用，请到 MiniMax 后台检查');if(!('system_voice' in data))throw Error('接口格式不兼容：没有返回音色列表');}
   else if(definition.protocol==='hailuo'){const data=await request('query/video_generation?page_num=1&page_size=1');if(!Array.isArray(data.items))throw Error('接口格式不兼容：没有返回任务列表');}
   else if(definition.protocol==='ark'){const data=await request('contents/generations/tasks?page_size=1');if(!Array.isArray(data.items))throw Error('接口格式不兼容：没有返回任务列表');}
   else {
    const models=await loadModels();
    if(definition.protocol==='responses'||definition.protocol==='anthropic'){
     const model=config.model!=='default'&&models.some(m=>m.id===config.model)?config.model:models.find(m=>m.isDefault)?.id||models[0].id;
     const data=await request(definition.protocol==='responses'?'responses/input_tokens':(/\/v1$/.test(config.baseUrl)?'messages/count_tokens':'v1/messages/count_tokens'),definition.protocol==='responses'?{model,input:'OpenTake connectivity check'}:{model,messages:[{role:'user',content:'OpenTake connectivity check'}]});
     if(typeof data.input_tokens!=='number')throw Error('接口格式不兼容：没有返回输入Token计数；未发送生成请求');
    }
   }
 return ['hailuo','ark'].includes(definition.protocol)?'连接正常；仅查询已有任务，API 生成业务待适配':'连接正常；已读取模型或音色列表，未运行生成任务';
}
/** 一次性 API 连通检查：不读取/保存配置，不访问钥匙串，不检测或执行 CLI。 */
export async function testTransientConnection(id:ConnectionId,input:unknown,deps:Pick<ConnectionDependencies,'fetcher'|'timeoutMs'>={}){
 const start=Date.now();
 const parsed=z.object({transient:z.literal(true),apiKey:z.string().min(8).max(4096).regex(/^[A-Za-z0-9._~+\/-]+={0,2}$/),baseUrl:z.string().max(2048).optional()}).strict().safeParse(input);
 if(!parsed.success)return {ok:false,error:'一次性测试参数不正确，请检查密钥格式和接口地址',durationMs:Date.now()-start};
 const {apiKey,baseUrl}=parsed.data;
 try{
  const config={...defaultConnection(id),mode:'api' as const,baseUrl:validateConnectionBaseUrl(baseUrl||connectionDefinition(id).baseUrl)};
  const request:ProbeRequest=(route,body)=>requestJson(id,route,deps,body,undefined,{config,key:apiKey});
  const message=await probeApiConnection(id,config,request,()=>readApiModels(id,config,request));
  return {ok:true,message,durationMs:Date.now()-start};
 }catch(error){return {ok:false,error:error instanceof Error?error.message:'连接失败，请检查配置',durationMs:Date.now()-start};}
}
export function effectiveConnectionModel(id:ConnectionId,requested?:string){const config=getConnectionConfig(id);const selected=requested||config.model;if(selected==='default')return config.models.find(m=>m.isDefault)?.id||'default';return config.models.length&&!config.models.some(m=>m.id===selected)?config.models.find(m=>m.isDefault)?.id||'default':selected;}
export async function resolveAgentConnectionLaunch(id:ConnectionId,baseEnv?:NodeJS.ProcessEnv,deps:ConnectionDependencies={}){
 assertAgentExecutionAllowed(id);const config=getConnectionConfig(id),definition=connectionDefinition(id);
 if(!definition.heavySupported)throw Error(`${definition.name} 命令行出片待适配`);
 const executable=await (deps.detect??detectExecutable)(id,config);if(!executable)throw Error('出片和写卡片代码需要安装命令行；只有 API 密钥时可处理纯文字');
 let env=installations.sanitizeAgentEnv({...installations.loginEnvironment(),...baseEnv});const args:string[]=[];
 if(id!=='codex'&&id!=='claude'){
  if(config.mode!=='cli')throw Error('此智能体的出片需要命令行账号接通；API 密钥仅支持轻活');
  const acpArgs=agentAcpArgs(id);if(!acpArgs)throw Error(`${definition.name} 命令行出片待适配`);
  const status=await getConnectionStatus(id,deps);if(!status.enabled||!status.connected)throw Error('所选智能体未接通，请到设置重新接通');
  if(status.filmOutdated)throw Error(`${definition.name} ${status.cliVersion} 太旧，需要 ${status.filmMinimumVersion} 以上才能出片`);
  assertAgentWorkAllowed(id);return {executable,env,args:[...acpArgs],model:effectiveConnectionModel(id),method:config.mode,transport:'acp' as const};
 }
 if(config.mode==='api'){
  if(!config.connected)throw Error('API 接入还没有测试通过，请先测试连接');const key=await connectionSecretStore().read(id);if(!key)throw Error('系统钥匙串中没有 API 密钥，请重新保存');
  if(id==='claude')env=installations.sanitizeAgentEnv(env,{agent:id,variables:{ANTHROPIC_API_KEY:key,ANTHROPIC_BASE_URL:config.baseUrl}});
  else {env=installations.sanitizeAgentEnv(env,{agent:id,variables:{OPENTAKE_CODEX_API_KEY:key}});args.push('-c','model_provider="opentake"','-c',`model_providers.opentake={name="OpenTake",base_url=${JSON.stringify(config.baseUrl)},env_key="OPENTAKE_CODEX_API_KEY",wire_api="responses",requires_openai_auth=false}`);}
 }
 assertAgentExecutionAllowed(id);return {executable,env,args,model:effectiveConnectionModel(id),method:config.mode};
}
/** 轻活只发送文字，不授予工具、文件或 shell。业务调用与测试连接分离。 */
export async function runConnectionText(id:ConnectionId,prompt:string,model?:string,signal?:AbortSignal,deps:ConnectionDependencies={}){
 assertAgentExecutionAllowed(id);const config=getConnectionConfig(id),definition=connectionDefinition(id);if(config.mode!=='api'||!config.connected)throw Error('请先接通 API 密钥');
 const selected=effectiveConnectionModel(id,model);if(selected==='default')throw Error('服务没有声明默认模型，请在接入设置里选择模型');if(signal?.aborted)throw Error('任务已取消');
 const body=definition.protocol==='responses'?{model:selected,input:prompt}:definition.protocol==='anthropic'?{model:selected,max_tokens:4096,messages:[{role:'user',content:prompt}]}:{model:selected,messages:[{role:'user',content:prompt}]};
 const route=definition.protocol==='responses'?'responses':definition.protocol==='anthropic'?(/\/v1$/.test(config.baseUrl)?'messages':'v1/messages'):'chat/completions';
 const cancelled=new AbortController();const stop=onAgentDisabled(disabled=>{if(disabled===id)cancelled.abort()});
 let data:Record<string,unknown>;try{assertAgentExecutionAllowed(id);data=await requestJson(id,route,{...deps,timeoutMs:deps.timeoutMs??600000},body,signal?AbortSignal.any([signal,cancelled.signal]):cancelled.signal)}catch(error){if((error as {kind?:string})?.kind==='credentials')markAgentCredentialsRejected(id,'api',config.revision||0);throw error}finally{stop();}
 if(signal?.aborted)throw Error('任务已取消');
 if(definition.protocol==='anthropic')return z.array(z.object({type:z.string(),text:z.string().optional()})).parse(data.content).filter(c=>c.type==='text').map(c=>c.text||'').join('');
 if(definition.protocol==='responses')return z.array(z.object({content:z.array(z.object({type:z.string(),text:z.string().optional()})).optional()})).parse(data.output).flatMap(item=>item.content??[]).filter(c=>c.type==='output_text').map(c=>c.text||'').join('');
 return z.object({choices:z.array(z.object({message:z.object({content:z.string()})})).min(1)}).parse(data).choices[0].message.content;
}
