import {defaultAgentSettings,AGENT_MODULES} from '../src/studio/agent-settings.ts';
import {randomUUID} from 'node:crypto';
import {testBuiltinVision} from './builtin-vision.ts';
import {builtinProtocol,builtinSupportsModule} from '../shared/builtin-models.ts';
import {validateAgentProgram} from './agent-program-path.ts';
import {serviceCliPath,saveServiceCliPath,testServiceCli} from './connection-services.ts';
import {codexInstallCommand} from './agent-installations.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {execFileAsync} from './proc.ts';
import installations from './agent-installation.ts';
import {ROSTER_AGENTS,rosterDesktopApp,rosterAgentStatus,isClaudeExecutable,rosterInstaller} from './agent-roster.ts';
import {deepseekInvalidKeyHint,deepseekLoginHint} from './deepseek-harness.ts';
import {createAuthProbeCache,probeAcpAuthentication,probeAgentStatusCommand,type AuthProbeResult} from './agent-auth-probe.ts';
import {agentSettingsFile,atomicAgentJson,readAgentSettings,getAgentCatalog} from './agent-settings.ts';
import {connectionSecretStore,type ConnectionSecretStore} from './connection-secrets.ts';
import {cliVersionNumber,agentFilmUnavailableReason,filmVersionOutdated,agentAcpArgs,agentCliLoginArgs,CONNECTION_IDS,CONNECTION_DEFINITIONS,connectionDefinition,defaultConnection,isRelay,normalizeConnectionBaseUrl,connectionProtocol,deepseekCodexEndpoint,deepseekResponsesModel,DEEPSEEK_CODEX_MODEL,API_TEST_CATEGORIES,type ApiTestCategory,type ConnectionId,type ConnectionConfig,type ConnectionView,type ConnectionModel} from '../shared/agent-connections.ts';
const configSchema=z.object({deepseekVerifiedRoute:z.enum(['official','account']).optional(),deepseekKeyRejected:z.boolean().optional(),keyId:z.uuid().optional(),profileId:z.string().regex(/^(main|[0-9a-f-]{36})$/).optional(),profileName:z.string().trim().min(1).max(80).optional(),format:z.enum(['auto','responses','chat','anthropic']).optional(),lastApiTest:z.object({httpStatus:z.number().int().min(100).max(599).optional(),category:z.enum(API_TEST_CATEGORIES)}).optional(),authRejectedAt:z.string().optional(),blockedReason:z.string().max(400).optional(),revision:z.number().int().nonnegative().optional(),mode:z.enum(['cli','api']),enabled:z.boolean(),baseUrl:z.string().max(2048),model:z.string().regex(/^[\w.\/:_,-]+$/),cliPath:z.string().max(4096),hasKey:z.boolean(),models:z.array(z.object({id:z.string(),name:z.string(),isDefault:z.boolean().optional()})),checkedAt:z.string().optional(),connected:z.boolean().optional(),message:z.string().optional()}).strict();
const file=()=>process.env.LINKREADER_CONNECTION_SETTINGS_FILE||path.join(path.dirname(agentSettingsFile()),'agent-connections.json');
const builtinFile=()=>file()+'.builtin.json';
const profileBook=z.object({active:z.string(),revision:z.number().int(),profiles:z.record(z.string(),configSchema)});
function builtinBook(){
 if(fs.existsSync(builtinFile()))return profileBook.parse(JSON.parse(fs.readFileSync(builtinFile(),'utf8')));
 return {active:'main',revision:0,profiles:{main:defaultConnection('builtin')} as Record<string,ConnectionConfig>};
}
export function secretId(id:ConnectionId,config:ConnectionConfig){return id==='builtin'?`builtin-${(config.keyId||config.profileId||'main').replaceAll('-','')}` as const:id;}
let profileLock:Promise<unknown>=Promise.resolve();
function serializeBuiltin<T>(work:()=>Promise<T>):Promise<T>{const next=profileLock.then(work,work);profileLock=next.catch(()=>{});return next;}
export function switchBuiltinProfile(profileId?:string){
 return serializeBuiltin(async()=>{
  const book=builtinBook();
  const id=profileId??randomUUID();
  if(profileId&&!Object.hasOwn(book.profiles,id))throw Error('找不到这个模型配置');
  if(!profileId)book.profiles[id]={...defaultConnection('builtin'),profileId:id,profileName:'模型 '+(Object.keys(book.profiles).length+1)};
  book.active=id;book.revision++;
  atomicAgentJson(builtinFile(),book);
  emitConnectionStatus('builtin',book.revision);
  return getConnectionStatus('builtin');
 });
}
function readConfigs():Partial<Record<ConnectionId,ConnectionConfig>> {if(!fs.existsSync(file()))return {};try{return z.partialRecord(z.enum(CONNECTION_IDS),configSchema).parse(JSON.parse(fs.readFileSync(file(),'utf8')))}catch{throw Error('接入设置文件损坏，未覆盖原文件，请恢复备份');}}
export function getConnectionConfig(id:ConnectionId):ConnectionConfig{
 if(id==='builtin'){const book=builtinBook();return {...book.profiles[book.active],revision:book.revision};}
 const saved=readConfigs()[id];
 const config={...defaultConnection(id),...saved};
 let cliPath=id==='codex'&&fs.existsSync(agentSettingsFile())?readAgentSettings().cliPath:config.cliPath;
 // Earlier versions allowed this desktop entry to be pinned. Resume automatic discovery.
 if(id==='codebuddy'&&installations.isWorkBuddyProgram(cliPath))cliPath='';
 return {...config,cliPath,baseUrl:normalizeConnectionBaseUrl(id,config.baseUrl)};
}
function persist(id:ConnectionId,config:ConnectionConfig){if(id==='builtin'){const book=builtinBook();if(config.profileId!==book.active)throw Error('当前模型配置已切换，请重新操作');book.profiles[book.active]=configSchema.parse(config);book.revision=config.revision??book.revision;atomicAgentJson(builtinFile(),book);return;}atomicAgentJson(file(),{...readConfigs(),[id]:configSchema.parse(config)});}
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
export function validateConnectionBaseUrl(value:string){
 const input=value.trim();
 if(!input||/[\\\s]/.test(input)||input.startsWith('/')||/^[a-z][a-z\d+.-]*:(?!\/\/|\d+(?:\/|$))/i.test(input))throw Error('接口地址格式不正确，请填写服务商提供的 HTTPS 地址');
 let url:URL;
 try{url=new URL(input.includes('://')?input:'https://'+input)}catch{throw Error('接口地址格式不正确，请填写服务商提供的 HTTPS 地址')}
 if(url.username||url.password||url.search||url.hash)throw Error('接口地址不能带密码、查询参数或片段');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('接口地址必须使用 HTTPS（本机测试地址除外）');
 return url.origin+url.pathname.replace(/\/{2,}/g,'/').replace(/\/+$/,'');
}
export type ConnectionDependencies={validatedPath?:string;discoveryEnv?:NodeJS.ProcessEnv;store?:ConnectionSecretStore;fetcher?:typeof fetch;detect?:(id:ConnectionId,config:ConnectionConfig)=>Promise<string|undefined>;cliTest?:(id:ConnectionId,executable:string,verify?:boolean)=>Promise<{connected:boolean;blocked?:string;models?:ConnectionModel[]}>;timeoutMs?:number;version?:(file:string)=>Promise<string|undefined>};
export async function detectConnectionExecutable(id:ConnectionId,config:ConnectionConfig=getConnectionConfig(id),env?:NodeJS.ProcessEnv,refresh=false){
 const otherAgentPath=(candidate:string|undefined)=>candidate&&!isClaudeExecutable(candidate,env??process.env,getConnectionConfig('claude').cliPath)?candidate:undefined;
 if(id==='dreamina'&&!config.cliPath)return otherAgentPath(serviceCliPath(id));
 if(id==='codex'||id==='claude')return installations.detectAgent(id,{configured:config.cliPath||(id==='codex'?readAgentSettings().cliPath:''),env,refresh}).executable;
 if(config.cliPath&&!(id==='codebuddy'&&installations.isWorkBuddyProgram(config.cliPath)))return path.isAbsolute(config.cliPath)&&installations.agentFileStatus(config.cliPath)==='executable'?otherAgentPath(config.cliPath):undefined;
 const agent=ROSTER_AGENTS.find(item=>item.id===id);
 return agent?otherAgentPath((await rosterAgentStatus(agent,{env,readVersion:false})).executable):undefined;
}
const detectExecutable=detectConnectionExecutable;
/** 腾讯国内站是此接入的默认值，保留用户显式选择的地区（包括空值）。 */
export function agentRegionEnvironment(id:ConnectionId,env:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
 if(id!=='codebuddy')return env;
 const key='CODEBUDDY_INTERNET_ENVIRONMENT';
 const exists=process.platform==='win32'?Object.keys(env).some(name=>name.toUpperCase()===key):env[key]!==undefined;
 return exists?env:{...env,[key]:'internal'};
}
/** Fixed login-only commands, never a command supplied by a browser or an ACP server. */
export function agentLoginArgs(id:ConnectionId):string[]|undefined{
 return agentCliLoginArgs(id);
}
const authCache=createAuthProbeCache();
const authControllers=new Map<string,AbortController>();
const authKey=(id:ConnectionId)=>`${file()}:${id}`;
const authSignature=(config:ConnectionConfig,executable:string)=>JSON.stringify([executable,config.revision||0,config.enabled]);
onAgentDisabled(id=>{for(const key of [authKey(id),authKey(id)+'#verify']){authControllers.get(key)?.abort();authCache.forget(key)}});
async function harnessEnvironment(config:ConnectionConfig,env:NodeJS.ProcessEnv,deps:ConnectionDependencies){
 // An environment key belongs to another session. Only the credential saved on this card authorizes official.
 const key=config.hasKey&&!config.deepseekKeyRejected?await (deps.store??connectionSecretStore()).read('deepseek'):undefined;
 if(getConnectionConfig('deepseek').revision!==config.revision)throw Error('接入配置已改变，请重新检查');
 if(config.hasKey&&!config.deepseekKeyRejected&&!key)throw Error('找不到已保存的 DeepSeek 密钥，请重新保存或删除密钥后使用 Harness 账号');
 return installations.sanitizeAgentEnv(env,{agent:'deepseek',variables:{DEEPSEEK_API_KEY:key}});
}
function updateHarnessRejection(expectedRevision:number,route:'official'|'account'){
 const config=getConnectionConfig('deepseek');
 if((config.revision??0)!==expectedRevision||config.mode!=='cli'||!config.enabled)return expectedRevision;
 if(route==='official'&&(!config.hasKey||config.deepseekKeyRejected)||route==='account'&&config.authRejectedAt)return expectedRevision;
 const revision=expectedRevision+1;
 persist('deepseek',{...config,revision,connected:false,deepseekVerifiedRoute:undefined,...(route==='official'?{deepseekKeyRejected:true}:{authRejectedAt:new Date().toISOString()}),message:route==='official'?deepseekInvalidKeyHint:deepseekLoginHint});
 authCache.forget(authKey('deepseek'));emitConnectionStatus('deepseek',revision);
 return revision;
}
export const recordDeepseekKeyRejection=(revision:number)=>updateHarnessRejection(revision,'official');
export const recordDeepseekAccountRejection=(revision:number)=>updateHarnessRejection(revision,'account');
export function recordDeepseekRouteVerified(expectedRevision:number,route:'official'|'account'){
 const config=getConnectionConfig('deepseek');
 if((config.revision??0)!==expectedRevision||config.mode!=='cli'||!config.enabled)return;
 const expectedRoute=config.hasKey&&!config.deepseekKeyRejected?'official':'account';
 if(route!==expectedRoute)return;
 persist('deepseek',{...config,deepseekVerifiedRoute:route,connected:true,authRejectedAt:undefined,checkedAt:new Date().toISOString()});
 authCache.forget(authKey('deepseek'));emitConnectionStatus('deepseek',expectedRevision);
}
async function cliAuthentication(id:ConnectionId,config:ConnectionConfig,executable:string,deps:ConnectionDependencies,force=false,afterLogin=false,verifyHarness=false):Promise<AuthProbeResult>{
 const rejected=id!=='deepseek'&&!!config.authRejectedAt;
 // 被拒标记只挡后台的自动查询；用户点「重新检查」或刚登录完，就用一句话测试真查一次，不能永远卡在「还没登录」。
 if(rejected&&!afterLogin&&!force)return {state:'needs-login',message:'还没登录',checkedAt:config.authRejectedAt};
 // 上次一句话测试查出套餐、余额问题：后台查询直接给出原因，不反复测试；用户点「重新检查」或重新登录时再测。
 if(id!=='deepseek'&&config.blockedReason&&!afterLogin&&!force)return {state:'unknown',message:config.blockedReason,blocked:true,checkedAt:config.checkedAt};
 // 一句话测试：明确要求、刚登录完、被拒后重查，或这家还没确认接通过时做。只开会话不够：
 // 有的智能体不登录也能开会话，套餐不含也能开，要等出片才发现。
 const verify=id==='deepseek'?verifyHarness:verifyHarness||afterLogin||rejected||config.connected!==true;
 const key=authKey(id)+(verify?'#verify':''),signature=authSignature(config,executable);
 return authCache.check(key,signature,async()=>{
  assertAgentExecutionAllowed(id);
  // 测试替身：verify 为真时代表做了一句话测试。
  if(deps.cliTest){const r=await deps.cliTest(id,executable,verify);return r.connected?{state:'connected',message:'已接通',...(verify?{verified:true}:{})}:r.blocked?{state:'unknown',message:r.blocked,blocked:true}:{state:'needs-login',message:'还没登录'};}
  if(id!=='codex'&&id!=='claude'&&!agentAcpArgs(id))return {state:'pending',message:connectionDefinition(id).cliReason||'命令行登录检查待适配，可改用 API 密钥'};
  const controller=new AbortController();authControllers.set(key,controller);
  try{
   const env=agentRegionEnvironment(id,installations.sanitizeAgentEnv(deps.discoveryEnv??installations.loginEnvironment()));
   assertAgentExecutionAllowed(id);
   if(id==='deepseek'){
    let childEnv:NodeJS.ProcessEnv;
    try{childEnv=await harnessEnvironment(config,env,deps)}catch(error){return {state:'unknown',message:error instanceof Error&&error.message.startsWith('找不到已保存')?error.message:'无法读取 DeepSeek 卡片密钥或配置已改变，请重新检查'}}
    return await probeAcpAuthentication(executable,agentAcpArgs(id)!,{env:childEnv,signal:controller.signal,timeoutMs:deps.timeoutMs,deepseek:{useKey:!!childEnv.DEEPSEEK_API_KEY,keyRejected:!!config.deepseekKeyRejected,verify:verifyHarness,model:verifyHarness?config.model:'default'}});
   }
   if(id==='cursor'||id==='opencode')return await probeAgentStatusCommand(executable,[...connectionDefinition(id).authStatusArgs!],{env,signal:controller.signal,timeoutMs:deps.timeoutMs});
   if(agentAcpArgs(id))return await probeAcpAuthentication(executable,agentAcpArgs(id)!,{env,signal:controller.signal,timeoutMs:deps.timeoutMs,verify});
   try{
    assertAgentExecutionAllowed(id);const result=await execFileAsync(executable,id==='claude'?['auth','status','--json']:['login','status'],{env,signal:controller.signal,timeout:deps.timeoutMs??8000,maxBuffer:65536});
    if(id==='claude'){try{const value=JSON.parse(result.stdout);if(value.loggedIn===true)return {state:'connected',message:'已接通'};if(value.loggedIn===false)return {state:'needs-login',message:'还没登录'};}catch{}return {state:'unknown',message:'没查到，请重新检查'};}
    const output=result.stdout+' '+result.stderr;
    return /not logged in|not authenticated/i.test(output)?{state:'needs-login',message:'还没登录'}:/logged in/i.test(output)?{state:'connected',message:'已接通'}:{state:'unknown',message:'没查到，请重新检查'};
   }catch(error){
    // Inspect known auth markers only; raw CLI output may contain account data and is never returned/logged.
    const value=error as {stdout?:string;stderr?:string;code?:string;message?:string};
    if(id==='codex'&&installations.storeCodexDenied(executable,value.code,value.stderr||value.message))return {state:'unknown',message:installations.storeAccessHint};
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
/** 一句话测试查出套餐、余额问题：账号已登录，清掉旧的「凭据被拒」，把原因留给卡片和登录提示。 */
function persistBlocked(id:ConnectionId,config:ConnectionConfig,auth:AuthProbeResult){
 const next={...config,revision:(config.revision||0)+1,authRejectedAt:undefined,blockedReason:auth.message,connected:false,checkedAt:auth.checkedAt??new Date().toISOString(),message:auth.message};
 persist(id,next);authCache.forget(authKey(id));emitConnectionStatus(id,next.revision);
}
/** User-started login may clear a previous rejection after an authenticated probe. */
export async function completeAgentLogin(id:ConnectionId,revision:number|undefined,deps:ConnectionDependencies={},stillWaiting=()=>true):Promise<ConnectionView>{
 const config=getConnectionConfig(id);
 if(config.revision!==revision||config.mode!=='cli'||!config.enabled)return getConnectionStatus(id,deps);
 const executable=await (deps.detect??detectExecutable)(id,config);if(!executable)return getConnectionStatus(id,deps);
 const auth=await cliAuthentication(id,config,executable,deps,true,true);
 if(auth.state==='connected'&&stillWaiting()&&getConnectionConfig(id).revision===revision){
  const next={...config,revision:(config.revision||0)+1,authRejectedAt:undefined,blockedReason:undefined,connected:true,checkedAt:auth.checkedAt,message:'已接通'};
  persist(id,next);authCache.remember(authKey(id),authSignature(next,executable),auth);emitConnectionStatus(id,next.revision);
 }else if(auth.blocked&&getConnectionConfig(id).revision===revision)persistBlocked(id,config,auth);
 return getConnectionStatus(id,deps);
}
const versionCache=new Map<string,{at:number;value?:string}>();
export function cachedConnectionVersionFailed(file:string){
 try{
  const stat=fs.statSync(file);
  const entry=versionCache.get(`${file}:${stat.mtimeMs}:${stat.size}`);
  return !!entry&&!entry.value;
 }catch{return false;}
}
async function connectionVersion(id:ConnectionId,executable:string,deps:ConnectionDependencies,force:boolean){
 if(deps.version)return deps.version(executable);
 // Injected connection probes in tests must not unexpectedly execute host binaries.
 if(deps.detect||deps.cliTest)return undefined;
 let signature=executable;try{const stat=fs.statSync(executable);signature+=`:${stat.mtimeMs}:${stat.size}`}catch{return undefined}
 const cached=versionCache.get(signature);if(!force&&cached&&Date.now()-cached.at<600000)return cached.value;
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-agent-version-'));let value:string|undefined;
 try{const result=await execFileAsync(executable,['--version'],{cwd,env:installations.sanitizeAgentEnv(deps.discoveryEnv??installations.loginEnvironment()),timeout:5000,maxBuffer:65536});value=cliVersionNumber(id,result.stdout+'\n'+result.stderr)}catch{}finally{fs.rmSync(cwd,{recursive:true,force:true})}
 versionCache.set(signature,{at:Date.now(),value});return value;
}
async function connectionStatus(id:ConnectionId,deps:ConnectionDependencies,force=false):Promise<ConnectionView>{
 const config=getConnectionConfig(id),definition=connectionDefinition(id);
 if(id==='builtin'){
  const profiles=Object.entries(builtinBook().profiles).map(([id,p])=>({id,name:p.profileName||p.model}));
  return {...definition,...config,profiles,protocol:builtinProtocol(config.baseUrl,config.format),relay:isRelay(id,config.baseUrl),cliInstalled:false,state:config.connected&&config.hasKey?'connected':'unconfigured'};
 }
 if(!deps.detect&&!deps.discoveryEnv)deps={...deps,discoveryEnv:installations.loginEnvironment(process.env,force)};
 const executable=deps.detect?await deps.detect(id,config):await detectExecutable(id,config,deps.discoveryEnv,force);
 let connected=!!config.connected,auth:AuthProbeResult|undefined;
 const roster=ROSTER_AGENTS.find(agent=>agent.id===id);
 let missingMessage='未安装',workBuddyNeedsCli=false;
 if(!executable&&!deps.detect){
  if(config.cliPath)missingMessage='指定的程序已失效，请重新指定或改回自动查找';
  else if(roster){
   const desktop=rosterDesktopApp(roster,{env:deps.discoveryEnv});
   workBuddyNeedsCli=id==='codebuddy'&&!!desktop&&/^WorkBuddy/i.test(desktop.name);
   if(workBuddyNeedsCli)missingMessage='已装 WorkBuddy。出片还需要腾讯官方的 CodeBuddy 命令行（约 94 MB），装好后登录一次。';
   else if(desktop)missingMessage=`已安装 ${desktop.name} 桌面版，还没有找到可用的命令行。请按官方说明安装命令行，再点重新查找。`;
  }
  if(id==='codex')missingMessage=installations.storeCodexAccessNotice(config.cliPath)||missingMessage;
 }
 const cliVersion=definition.kind==='agent'&&config.enabled&&executable?await connectionVersion(id,executable,deps,force):undefined;
 if(definition.kind==='agent'){
  auth=!config.enabled?{state:'disabled',message:executable?'已安装 · 默认不调用':'默认不调用'}:config.mode!=='cli'?undefined:!executable?{state:'missing',message:missingMessage}:await cliAuthentication(id,config,executable,deps,force);
  if(id==='deepseek'&&auth?.state==='connected'&&auth.deepseekRoute&&config.deepseekVerifiedRoute===auth.deepseekRoute&&config.connected&&!config.authRejectedAt&&!auth.deepseekVerified){
   auth={...auth,deepseekVerified:true,message:(config.deepseekKeyRejected?deepseekInvalidKeyHint+'已改用 DeepSeek 桌面账号':'当前使用'+(auth.deepseekRoute==='official'?'API 密钥':'DeepSeek 桌面账号'))+'，最近一次验证成功。'};
  }
  if(id==='deepseek'&&config.authRejectedAt&&auth?.state==='connected'&&!auth.deepseekVerified){
   auth={...auth,state:'needs-login',message:(config.deepseekKeyRejected?deepseekInvalidKeyHint:'')+deepseekLoginHint};
  }
  if(config.mode==='cli')connected=auth?.state==='connected';
  // 一句话测试通过：记下已确认接通，清掉旧的被拒标记，之后的后台查询不再重复测试。
  if(id!=='deepseek'&&config.mode==='cli'&&executable&&auth?.verified&&auth.state==='connected'&&(config.connected!==true||config.authRejectedAt||config.blockedReason)&&getConnectionConfig(id).revision===config.revision){
   const next={...config,revision:(config.revision||0)+1,authRejectedAt:undefined,blockedReason:undefined,connected:true,checkedAt:auth.checkedAt,message:'已接通'};
   persist(id,next);authCache.remember(authKey(id),authSignature(next,executable),auth);emitConnectionStatus(id,next.revision);
   return connectionStatus(id,deps);
  }
  if(id!=='deepseek'&&config.mode==='cli'&&auth?.blocked&&(config.blockedReason!==auth.message||config.authRejectedAt||config.connected)&&getConnectionConfig(id).revision===config.revision){
   persistBlocked(id,config,auth);
   return connectionStatus(id,deps);
  }
 }
 if(id==='deepseek'&&config.mode==='cli'&&auth?.deepseekKeyRejected&&!config.deepseekKeyRejected){
  recordDeepseekKeyRejection(config.revision??0);
 }
 if(id==='codebuddy'&&auth?.state==='needs-login')auth={...auth,message:`CodeBuddy 命令行还没登录。只用自己的模型（models.json）也要先登录${process.platform==='win32'?'，或设置环境变量 CODEBUDDY_API_KEY 后重启 OpenTake':''}。`};
 // Discard stale results if the user changed a path, mode or the Claude switch while a check was in flight.
 if(getConnectionConfig(id).revision!==config.revision)return connectionStatus(id,deps);
 connected=connected&&config.enabled&&(config.mode==='api'?config.hasKey:!!executable);
 return {...config,...definition,...(workBuddyNeedsCli?{workBuddyNeedsCli}:{}),...(missingMessage!=='未安装'?{cliNotice:missingMessage}:{}),installCommand:roster?rosterInstaller(roster):id==='codex'?codexInstallCommand():undefined,installPage:roster?.page??definition.page,protocol:connectionProtocol(id,config.baseUrl,config.format),heavySupported:definition.heavySupported&&!agentFilmUnavailableReason(id),...(agentFilmUnavailableReason(id)?{filmUnavailableReason:agentFilmUnavailableReason(id)}:{}),cliVersion,filmOutdated:filmVersionOutdated(cliVersion,definition.filmMinimumVersion),baseUrl:config.baseUrl,model:config.model,connected,cliInstalled:!!executable,executable,relay:isRelay(id,config.baseUrl),
  ...(config.mode==='cli'&&agentAcpArgs(id)?{models:auth?.models??[],acpModelSelection:auth?.acpModelSelection??false}:{}),
  ...(auth?.deepseekRoute?{deepseekRoute:auth.deepseekRoute,deepseekVerified:auth.deepseekVerified===true}:{}),
  ...(auth?{cliAuthState:auth.state,cliAuthMessage:auth.message,checkedAt:auth.checkedAt,message:auth.message}:{}),cliLoginAvailable:!!agentLoginArgs(id)&&!!executable&&config.enabled,
  state:!config.enabled?'disabled':connected?'connected':config.mode==='cli'?(auth?.state==='pending'?'pending':'unconfigured'):definition.protocol==='pending'?'pending':'unconfigured'};
}
export function getConnectionStatus(id:ConnectionId,deps:ConnectionDependencies={}):Promise<ConnectionView>{return connectionStatus(id,deps);}
export function refreshAgentConnection(id:ConnectionId,deps:ConnectionDependencies={}):Promise<ConnectionView>{return connectionStatus(id,deps,true);}
export async function listAgentConnections(includeServices=true,deps:ConnectionDependencies={},refresh=false){
 if(!deps.detect&&!deps.discoveryEnv)deps={...deps,discoveryEnv:installations.loginEnvironment(process.env,refresh)};
 const definitions=CONNECTION_DEFINITIONS.filter(item=>includeServices||item.kind==='agent');
 return {connections:await Promise.all(definitions.map(item=>connectionStatus(item.id,deps,refresh)))};
}
/** 控制台网址误填成接口地址时改成官方接口地址（只改已核实的几处）。 */
export function correctProviderBaseUrl(value:string){
 const text=value.trim();
 let url:URL;try{url=new URL(text.includes('://')?text:'https://'+text)}catch{return text}
 if(/^platform\.deepseek\.com$/i.test(url.hostname))return 'https://api.deepseek.com';
 return text;
}
export function saveAgentConnection(id:ConnectionId,input:unknown,deps:ConnectionDependencies={}){
 return id==='builtin'?serializeBuiltin(()=>saveConnection(id,input,deps)):saveConnection(id,input,deps);
}
async function saveConnection(id:ConnectionId,input:unknown,deps:ConnectionDependencies={}){
 const patch=z.object({profileId:z.string().optional(),profileName:z.string().trim().min(1).max(80).optional(),format:z.enum(['auto','responses','chat','anthropic']).optional(),mode:z.enum(['cli','api']).optional(),enabled:z.boolean().optional(),baseUrl:z.string().optional(),model:z.string().regex(/^[\w.\/:_,-]+$/).optional(),cliPath:z.string().max(4096).optional(),apiKey:z.string().optional(),confirmSubscriptionRisk:z.boolean().optional()}).strict().parse(input);
 // 复制密钥常带上前后空格或换行；DeepSeek 用户常把控制台地址 platform.deepseek.com 当成接口地址。
 if(typeof patch.apiKey==='string')patch.apiKey=patch.apiKey.trim();
 if(typeof patch.baseUrl==='string')patch.baseUrl=correctProviderBaseUrl(patch.baseUrl);
 const previous=getConnectionConfig(id),next={...previous,...patch,revision:(previous.revision||0)+1};delete (next as Record<string,unknown>).apiKey;delete (next as Record<string,unknown>).confirmSubscriptionRisk;
 if(id==='builtin'){
  if(next.profileId!==previous.profileId||next.mode!=='api'||next.cliPath)throw Error('内置智能体配置已改变，请重开设置');
  const raw=validateConnectionBaseUrl(next.baseUrl);
  if((!next.format||next.format==='auto')&&/\/(messages|responses|chat\/completions)\/?$/i.test(raw))next.format=builtinProtocol(raw);
  if(previous.hasKey&&!patch.apiKey&&new URL(raw).origin!==new URL(previous.baseUrl).origin)throw Error('服务商已更换，请输入新服务商的密钥');
 }else if(patch.profileId||patch.format||patch.profileName)throw Error('只有内置智能体可设置模型配置');
 if(next.mode==='api'&&next.baseUrl)next.baseUrl=normalizeConnectionBaseUrl(id,validateConnectionBaseUrl(next.baseUrl),next.format);
 if(id==='codex'&&next.mode==='api'&&previous.hasKey&&!patch.apiKey&&
    deepseekCodexEndpoint(id,next.baseUrl)!==deepseekCodexEndpoint(id,previous.baseUrl)&&URL.parse(next.baseUrl)?.origin!==URL.parse(previous.baseUrl)?.origin)
  throw Error('接口服务商已更换，请填写新服务商的 API 密钥后保存。');
 if(id==='claude'&&next.enabled&&next.mode==='cli'&&(!previous.enabled||previous.mode!=='cli')&&!patch.confirmSubscriptionRisk)throw Error('使用 Claude Code 订阅账号前必须确认风险；推荐改用 API 密钥');
 if(connectionDefinition(id).kind==='agent'&&patch.cliPath&&patch.cliPath!==previous.cliPath&&deps.validatedPath!==patch.cliPath){
  if(id==='claude'&&(!previous.enabled||!next.enabled))throw Error('请先启用 Claude Code，再验证程序路径');
  await validateAgentProgram(id,patch.cliPath,getConnectionConfig('claude').cliPath);
  if(getConnectionConfig(id).revision!==previous.revision)throw Error('接入设置已变更，请重新保存程序路径');
 }
 const vault=deps.store??connectionSecretStore();
 if(patch.apiKey){
  if(id==='builtin')next.keyId=randomUUID();
  await vault.write(secretId(id,next),patch.apiKey);
  if((id==='builtin')&&getConnectionConfig(id).revision!==previous.revision){
   await vault.remove(secretId(id,next));throw Error('配置已改变，请重新保存');
  }
  next.hasKey=true;
 }
 const changed=patch.apiKey||['mode','baseUrl','model','cliPath','format'].some(key=>next[key as keyof ConnectionConfig]!==previous[key as keyof ConnectionConfig]);
 if(id==='deepseek'){
  if(changed||next.enabled!==previous.enabled)next.deepseekVerifiedRoute=undefined;
  if(patch.apiKey){next.deepseekKeyRejected=undefined;next.authRejectedAt=undefined;next.blockedReason=undefined;}
  if(patch.mode&&patch.mode!==previous.mode){next.authRejectedAt=undefined;next.blockedReason=undefined;next.models=[];}
 }
 if(changed){next.connected=false;next.checkedAt=undefined;next.message=undefined;next.lastApiTest=undefined;}
 if(next.baseUrl!==previous.baseUrl)next.models=[];
 if(id==='dreamina'&&patch.cliPath!==undefined)saveServiceCliPath(id,patch.cliPath);
 try{persist(id,next);}catch(error){if((id==='builtin')&&patch.apiKey)await vault.remove(secretId(id,next));throw error;}
 if((id==='builtin')&&patch.apiKey&&previous.hasKey)await vault.remove(secretId(id,previous));
 if(id==='codex'&&patch.cliPath!==undefined){const settings=readAgentSettings();if(settings.cliPath!==patch.cliPath)atomicAgentJson(agentSettingsFile(),{...settings,cliPath:patch.cliPath});}
 if(!next.enabled)for(const listener of disabledListeners)listener(id);
 return getConnectionStatus(id,deps);
}
export function deleteConnectionKey(id:ConnectionId,deps:ConnectionDependencies={}){return id==='builtin'?serializeBuiltin(()=>deleteKey(id,deps)):deleteKey(id,deps);}
async function deleteKey(id:ConnectionId,deps:ConnectionDependencies){await (deps.store??connectionSecretStore()).remove(secretId(id,getConnectionConfig(id)));persist(id,{...getConnectionConfig(id),revision:(getConnectionConfig(id).revision||0)+1,hasKey:false,...(id==='deepseek'?{deepseekKeyRejected:undefined,deepseekVerifiedRoute:undefined,authRejectedAt:undefined}:{}),connected:false,checkedAt:undefined,message:undefined,lastApiTest:undefined});return getConnectionStatus(id,deps);}
function apiError(category:ApiTestCategory,message:string,httpStatus?:number){
 return Object.assign(Error(message),{category,httpStatus});
}
async function providerResponseError(response:Response):Promise<Error>{
 const status=response.status;
 if(status===401){await response.body?.cancel().catch(()=>{});return Object.assign(apiError('credentials','密钥凭据无效或已过期，请核对服务商和接口地址，重新保存 API 密钥。',status),{kind:'credentials'})}
 const reader=response.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();
 try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;const remaining=16*1024-bytes;text+=decoder.decode(value.subarray(0,remaining),{stream:true});bytes+=value.byteLength;if(bytes>=16*1024)break}}finally{await reader?.cancel().catch(()=>{})}
 try{const body=JSON.parse(text);const error=body?.error??body;text=typeof error==='string'?error:error&&typeof error==='object'?[error.code,error.type,error.message].filter(value=>typeof value==='string').join(' '):''}catch{/* Some providers return plain text. */}
 // Return fixed text only. Error payloads can contain keys, account IDs or request data.
 if(/(?:insufficient|low)[ _-](?:balance|credits?)|credit balance is too low|balance_not_enough/i.test(text))return Object.assign(apiError('balance','账户余额不足，请到服务商后台检查余额并补充额度。',status),{kind:'quota'});
 const {classifyAgentFailure}=await import('./general/acp.ts');
 const failure=classifyAgentFailure(`HTTP ${status} ${text}`);
 if(failure.kind==='quota'||failure.kind==='model-plan'||failure.kind==='busy'||failure.kind==='rate-limit'){
  const category={quota:'balance','model-plan':'permission',busy:'busy','rate-limit':'rate-limit'} as const;
  return Object.assign(apiError(category[failure.kind],failure.message,status),{kind:failure.kind});
 }
 if(status===403)return apiError('permission','密钥没有这个接口或模型的权限，请检查密钥所属项目、套餐和模型授权。',status);
 if(/model[ _-](?:not[ _-](?:found|exist)|does[ _-]not[ _-]exist|unknown|invalid)|(?:invalid|unknown|unsupported|unrecognized)[ _-]model|model.{0,80}(?:does not exist|not found|not supported)|模型.{0,20}(?:不存在|无效)/i.test(text))return apiError('model','模型名不可用，请读取模型列表或按服务商文档填写准确的模型 ID。',status);
 if(status===404)return apiError('address','找不到接口地址，请核对域名、路径和服务商要求的 /v1 前缀。',status);
 if([405,415,422,501].includes(status)||/unsupported.{0,16}(?:protocol|endpoint)|only supports? chat/i.test(text))return apiError('protocol','请求协议不受支持，请核对服务商提供的接口协议与地址。',status);
 if(status===408||status===504)return apiError('timeout','服务响应超时，请检查网络或代理后重试。',status);
 return apiError('provider',`服务返回 HTTP ${status}，请到服务商后台检查接口状态和请求权限。`,status);
}
type RequestContext={config:ConnectionConfig;key:string;onResponse?:(status:number|undefined)=>void};
async function requestJson(id:ConnectionId,route:string,deps:ConnectionDependencies={},body?:unknown,signal?:AbortSignal,context?:RequestContext){
 const config=context?.config??getConnectionConfig(id),key=context?.key??await (deps.store??connectionSecretStore()).read(secretId(id,config));
 if(!context&&getConnectionConfig(id).revision!==config.revision)throw Error('配置已改变，请重试');
 if(!key)throw apiError('configuration','请先保存 API 密钥');
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(connectionProtocol(id,config.baseUrl,config.format)==='anthropic'){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01'}else headers.Authorization=`Bearer ${key}`;
 const endpoint=connectionEndpoint(validateConnectionBaseUrl(config.baseUrl),route);
 const timeout=AbortSignal.timeout(deps.timeoutMs??15000);
 let response:Response;
 context?.onResponse?.(undefined);
 try{
  response=await (deps.fetcher??fetch)(endpoint,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout});
  context?.onResponse?.(response.status);
  if(!response.ok)throw await providerResponseError(response);
  const raw=await response.text();
  if(raw.length>2*1024*1024)throw apiError('protocol','服务返回内容过大，请核对接口地址。',response.status);
  try{const data:unknown=JSON.parse(raw.split(key).join('[密钥已隐藏]'));if(data&&typeof data==='object'&&!Array.isArray(data))return data as Record<string,unknown>}catch{/* Report a fixed message, without the upstream response. */}
  throw Object.assign(apiError('protocol','服务没有返回预期的 JSON 格式，请检查是否填成了网页地址。',response.status),{routeMissing:true});
 }catch(error){
  if(error instanceof Error&&'category' in error)throw error;
  if(signal?.aborted)throw Error('任务已取消');
  if(timeout.aborted||error instanceof Error&&/timeout|timed out/i.test(error.name+' '+error.message))throw apiError('timeout','连接超时，请检查代理和网络后重试。');
  throw apiError('address','无法连接接口地址，请检查域名拼写、端口、网络和代理设置。');
 }
}
export async function refreshConnectionModels(id:ConnectionId,deps:ConnectionDependencies={}){
 const config=getConnectionConfig(id);let models:ConnectionModel[]=[];
 if(config.mode==='cli'){
  assertAgentExecutionAllowed(id);
  if(id==='deepseek'){
   const view=await refreshAgentConnection(id,deps);
   if(view.mode!=='cli'||!view.models.length)throw Error(view.cliAuthMessage||deepseekLoginHint);
   return view.models;
  }
  if(id!=='codex')throw Error('此命令行不提供模型列表，填写模型或跟随默认');
  const catalog=await getAgentCatalog(config.cliPath);models=catalog.models.map(({id,name,isDefault})=>({id,name,isDefault}));
 }else{
  models=await readApiModels(id,config,await savedProbeRequest(id,config,deps));
 }
 if(getConnectionConfig(id).revision!==config.revision)throw Error('配置已改变，请重新读取模型');persist(id,{...getConnectionConfig(id),models});return models;
}
export async function testUnifiedConnection(id:ConnectionId,deps:ConnectionDependencies={}){
 const config=getConnectionConfig(id),start=Date.now();let httpStatus:number|undefined;let message='',cliExecutable:string|undefined,cliAuth:AuthProbeResult|undefined;
 try{
  if(config.mode==='cli'){
   assertAgentExecutionAllowed(id);
   const executable=await (deps.detect??detectExecutable)(id,config);if(!executable)throw Error('本机没有命令行，请先安装');cliExecutable=executable;
   if(id==='dreamina'){await testServiceCli(id);}
   else {cliAuth=await cliAuthentication(id,config,executable,deps,true,false,true);if(cliAuth.state!=='connected')throw Error(cliAuth.message);}
   message=id==='deepseek'||cliAuth?.verified?cliAuth!.message:'账号连接正常；未运行生成任务';
  }else{
   const request=await savedProbeRequest(id,config,deps,status=>{httpStatus=status});
   message=await probeApiConnection(id,config,request,async()=>{
    const models=await readApiModels(id,config,request);
    if(getConnectionConfig(id).revision!==config.revision)throw Error('配置已改变，请重新测试连接');
    persist(id,{...getConnectionConfig(id),models});return models;
   },true);
  }
  if(getConnectionConfig(id).revision!==config.revision)throw Error('配置已改变，请重新测试连接');
  const tested=getConnectionConfig(id);
  if(config.mode==='api'&&!deepseekCodexEndpoint(id,config.baseUrl)&&connectionDefinition(id).kind==='agent'&&config.model==='default'&&!tested.models.some(item=>item.isDefault)){
   message+='。使用文字功能前，请在接入设置中选定一个模型。';
  }
  const next={...tested,...(id==='deepseek'&&cliAuth?{deepseekKeyRejected:!!(tested.deepseekKeyRejected||cliAuth.deepseekKeyRejected),deepseekVerifiedRoute:cliAuth.deepseekVerified?cliAuth.deepseekRoute:undefined}:{}),revision:(config.revision||0)+1,lastApiTest:config.mode==='api'?{category:'success' as const,httpStatus}:undefined,authRejectedAt:undefined,connected:true,checkedAt:new Date().toISOString(),message};
  persist(id,next);
  if(id==='builtin'&&!fs.existsSync(agentSettingsFile())){
   const defaults=defaultAgentSettings();
   for(const module of AGENT_MODULES)if(builtinSupportsModule(module.id))defaults.modules[module.id]={agent:'builtin',model:'default',effort:'none'};
   atomicAgentJson(agentSettingsFile(),defaults);
  }
  if(cliAuth&&cliExecutable)authCache.remember(authKey(id),authSignature(next,cliExecutable),cliAuth);emitConnectionStatus(id,next.revision);
  return {ok:true,durationMs:Date.now()-start,connection:await getConnectionStatus(id,deps)};
 }catch(error){message=error instanceof Error?error.message:'连接失败，请检查配置';const category=(error as {category?:ApiTestCategory})?.category??'configuration';if(id==='deepseek'&&config.mode==='cli'&&cliAuth&&cliExecutable&&getConnectionConfig(id).revision===config.revision){
   const revision=(config.revision??0)+1;
   const next={...config,revision,deepseekVerifiedRoute:undefined,deepseekKeyRejected:!!(config.deepseekKeyRejected||cliAuth.deepseekKeyRejected),authRejectedAt:cliAuth.deepseekAccountRejected?new Date().toISOString():config.authRejectedAt,connected:false,checkedAt:new Date().toISOString(),message};
   persist(id,next);authCache.remember(authKey(id),authSignature(next,cliExecutable),cliAuth);emitConnectionStatus(id,revision);
  }else if(getConnectionConfig(id).revision===config.revision&&cliAuth?.blocked&&id!=='deepseek')persistBlocked(id,getConnectionConfig(id),cliAuth);
  else if(getConnectionConfig(id).revision===config.revision)persist(id,{...getConnectionConfig(id),lastApiTest:config.mode==='api'?{category,httpStatus}:undefined,connected:false,checkedAt:new Date().toISOString(),message});return {ok:false,durationMs:Date.now()-start,error:message,connection:await getConnectionStatus(id,deps)};}
}

type ProbeRequest=(route:string,body?:unknown)=>Promise<Record<string,unknown>>;
async function savedProbeRequest(id:ConnectionId,config:ConnectionConfig,deps:ConnectionDependencies,onResponse?:RequestContext['onResponse']):Promise<ProbeRequest>{
 const key=await (deps.store??connectionSecretStore()).read(secretId(id,config));
 return async(route,body)=>{
  if(getConnectionConfig(id).revision!==config.revision)throw Error('配置已改变，请重新测试连接');
  return requestJson(id,route,deps,body,undefined,{config,key,onResponse});
 };
}
async function readApiModels(id:ConnectionId,config:ConnectionConfig,request:ProbeRequest):Promise<ConnectionModel[]>{
 const protocol=connectionProtocol(id,config.baseUrl,config.format);
  if(!['responses','anthropic','chat'].includes(protocol))throw Error('官方未提供可读取的模型列表，请手动填写模型');
  const route=protocol==='anthropic'&&!/\/v1$/.test(config.baseUrl)?'v1/models':'models';
  const models:ConnectionModel[]=[],cursors=new Set<string>();
  let page=route;
  for(;;){
   const data=await request(page);
   const items=z.array(z.object({id:z.string().min(1),display_name:z.string().optional(),name:z.string().optional(),is_default:z.boolean().optional()})).safeParse(data.data);
   if(!items.success||!items.data.length)throw Object.assign(apiError('protocol','接口没有返回可用模型列表，请核对接口格式或手动填写模型名称。'),{routeMissing:true});
   models.push(...items.data.map(m=>({id:m.id,name:m.display_name||m.name||m.id,isDefault:m.is_default})));
   if(protocol!=='anthropic'||data.has_more!==true)return models;
   if(typeof data.last_id!=='string'||!data.last_id||cursors.has(data.last_id)||cursors.size>=50)throw apiError('protocol','服务返回的模型分页不完整，请检查模型列表接口。');
   cursors.add(data.last_id);
   page=route+'?after_id='+encodeURIComponent(data.last_id);
  }
}
const routeMissing=(error:unknown)=>{const value=error as {category?:ApiTestCategory;httpStatus?:number;routeMissing?:boolean};return value?.routeMissing===true||(value?.category==='address'||value?.category==='protocol')&&[404,405,501].includes(value?.httpStatus??0)};
async function probeApiConnection(id:ConnectionId,config:ConnectionConfig,request:ProbeRequest,loadModels:()=>Promise<ConnectionModel[]>,testChat=false){
 const definition=connectionDefinition(id),protocol=connectionProtocol(id,config.baseUrl,config.format);
   if(id==='builtin')return testBuiltinVision(config,request);
   if(protocol==='pending')throw Error(definition.apiReason||'API 接入待适配');
   if(protocol==='voices'){const data=await request('get_voice',{voice_type:'system'});const status=data.base_resp as {status_code?:number}|undefined;if(status?.status_code!==undefined&&status.status_code!==0)throw Error('密钥或服务权限不可用，请到 MiniMax 后台检查');if(!('system_voice' in data))throw Error('接口格式不兼容：没有返回音色列表');}
   else if(protocol==='hailuo'){const data=await request('query/video_generation?page_num=1&page_size=1');if(!Array.isArray(data.items))throw Error('接口格式不兼容：没有返回任务列表');}
   else if(protocol==='ark'){const data=await request('contents/generations/tasks?page_size=1');if(!Array.isArray(data.items))throw Error('接口格式不兼容：没有返回任务列表');}
   else {
    const deepseekCodex=deepseekCodexEndpoint(id,config.baseUrl);
    if(deepseekCodex&&config.model!=='default'&&!deepseekResponsesModel(config.model))
     throw apiError('model',`这个模型不支持 Codex 用的协议，请选 ${DEEPSEEK_CODEX_MODEL}。`);
    let models:ConnectionModel[]=[];
    // Many relays have no model list. A model the user typed in can still be checked below.
    try{models=await loadModels();}
    catch(error){if(!routeMissing(error))throw error;if(!deepseekCodex&&(!config.model||config.model==='default'))throw apiError((error as {category?:ApiTestCategory}).category??'model','此地址读不到模型列表，请核对域名及 /v1 路径格式。若服务商不提供列表，请手动填写模型名称后再测试。');}
    const selected=deepseekCodex?(config.model==='default'?DEEPSEEK_CODEX_MODEL:config.model):modelFromConfig({...config,models});
    if(!deepseekCodex&&config.model!=='default'&&models.length&&!models.some(item=>item.id===config.model))throw apiError('model','列表中没有所填模型，请按返回列表重新选择模型 ID 后测试。');
    // A token-only probe may use a listed model; generation must use the same resolved model as film work.
    const model=selected==='default'?models[0].id:selected;
    const minimalProbe=async()=>{
     const name=protocol==='responses'?'Responses':protocol==='anthropic'?'Anthropic Messages':'Chat Completions';
     let response:Record<string,unknown>;
     try{
      response=protocol==='responses'?await request('responses',{model,input:'Hi',max_output_tokens:16,store:false})
       :protocol==='anthropic'?await request(/\/v1$/.test(config.baseUrl)?'messages':'v1/messages',{model,max_tokens:16,messages:[{role:'user',content:'Hi'}]})
       :await request('chat/completions',{model,max_tokens:16,messages:[{role:'user',content:'Hi'}]});
     }catch(fallbackError){if(routeMissing(fallbackError)){
       if(!models.length&&(fallbackError as {httpStatus?:number}).httpStatus===404)throw apiError('address',`找不到接口地址，请核对服务路径和 /v1 前缀，并确认是否支持 ${name} 协议。`);
       throw apiError('protocol',`这个接口不支持 ${name} 协议，请改填支持 ${name} 的接口地址。`);
      }throw fallbackError;}
     if(protocol==='responses'){
      const result=z.object({id:z.string().min(1),object:z.literal('response'),status:z.enum(['completed','incomplete']),error:z.null().optional(),incomplete_details:z.object({reason:z.literal('max_output_tokens')}).nullable().optional(),output:z.array(z.object({type:z.string(),content:z.array(z.object({type:z.string(),text:z.string().optional()})).optional()}))}).safeParse(response);
      if(!result.success||(result.data.status==='incomplete'&&!result.data.incomplete_details)||(result.data.status==='completed'&&!result.data.output.some(item=>item.type==='message'&&item.content?.some(content=>content.type==='output_text'&&typeof content.text==='string'))))throw apiError('protocol','Responses 返回结构不正确，请更换支持 Responses 协议的接口地址。');
     }else{
      const valid=protocol==='anthropic'
       ?z.array(z.object({type:z.string()})).min(1).safeParse(response.content).success
       :z.array(z.object({message:z.object({content:z.string().nullable()})})).min(1).safeParse(response.choices).success;
      if(!valid)throw apiError('protocol',`${name} 返回结构不正确，请更换支持该协议的接口地址。`);
     }
     return '连接正常；已发送一次最小请求，会用掉极少量额度';
    };
    if(protocol==='responses'||protocol==='anthropic'){
     let data:Record<string,unknown>;
     try{
      data=await request(protocol==='responses'?'responses/input_tokens':(/\/v1$/.test(config.baseUrl)?'messages/count_tokens':'v1/messages/count_tokens'),protocol==='responses'?{model,input:'OpenTake connectivity check'}:{model,messages:[{role:'user',content:'OpenTake connectivity check'}]});
     }catch(error){if(!routeMissing(error))throw error;return await minimalProbe();}
     if(typeof data.input_tokens!=='number'||!Number.isFinite(data.input_tokens)||data.input_tokens<0)throw apiError('protocol','接口没有返回输入 Token 计数，请确认中转站支持所选协议。');
    }else if(testChat||!models.length)return await minimalProbe();
   }
 return ['hailuo','ark'].includes(protocol)?'连接正常；仅查询已有任务，API 生成业务待适配':definition.kind==='agent'&&protocol==='chat'?'连接正常；API 密钥只能处理纯文字，出片要用命令行接入':'连接正常；已读取模型或音色列表，未运行生成任务';
}
/** 一次性 API 连通检查：不读取/保存配置，不访问钥匙串，不检测或执行 CLI。 */
export async function testTransientConnection(id:ConnectionId,input:unknown,deps:Pick<ConnectionDependencies,'fetcher'|'timeoutMs'>={}){
 const start=Date.now();
 const parsed=z.object({transient:z.literal(true),apiKey:z.string().min(8).max(4096).regex(/^[A-Za-z0-9._~+\/-]+={0,2}$/),baseUrl:z.string().max(2048).optional()}).strict().safeParse(input);
 if(!parsed.success)return {ok:false,error:'一次性测试参数不正确，请检查密钥格式和接口地址',durationMs:Date.now()-start};
 const {apiKey,baseUrl}=parsed.data;
 try{
  const config={...defaultConnection(id),mode:'api' as const,baseUrl:normalizeConnectionBaseUrl(id,validateConnectionBaseUrl(baseUrl||connectionDefinition(id).baseUrl))};
  const request:ProbeRequest=(route,body)=>requestJson(id,route,deps,body,undefined,{config,key:apiKey});
  const message=await probeApiConnection(id,config,request,()=>readApiModels(id,config,request));
  return {ok:true,message,durationMs:Date.now()-start};
 }catch(error){return {ok:false,error:error instanceof Error?error.message:'连接失败，请检查配置',durationMs:Date.now()-start};}
}
function modelFromConfig(config:ConnectionConfig,requested?:string){const selected=requested&&requested!=='default'?requested:config.model;if(selected==='default')return config.models.find(m=>m.isDefault)?.id||'default';return config.models.length&&!config.models.some(m=>m.id===selected)?config.models.find(m=>m.isDefault)?.id||'default':selected;}
export function effectiveConnectionModel(id:ConnectionId,requested?:string){
 const config=getConnectionConfig(id);
 if(id==='builtin'){
  if(requested&&requested!=='default'&&requested!==config.model)throw Error('当前内置模型与工程所选模型不同，请切回已经测试的配置');
  return config.model;
 }
 if(config.mode==='api'&&deepseekCodexEndpoint(id,config.baseUrl)){
  const model=requested&&requested!=='default'?requested:config.model;
  if(model==='default')return DEEPSEEK_CODEX_MODEL;
  if(!deepseekResponsesModel(model))throw apiError('model',`这个模型不支持 Codex 用的协议，请选 ${DEEPSEEK_CODEX_MODEL}。`);
  return model;
 }
 if(id==='deepseek'&&config.mode==='cli')return requested&&requested!=='default'?requested:config.model;
 return modelFromConfig(config,requested);
}
/** Only the canonical official endpoint may delegate an unresolved model to its own CLI default. */
export function assertConnectionModel(id:ConnectionId,model:string,config=getConnectionConfig(id)){
 if(config.mode==='api'&&deepseekCodexEndpoint(id,config.baseUrl)&&!deepseekResponsesModel(model))throw apiError('model',`这个模型不支持 Codex 用的协议，请选 ${DEEPSEEK_CODEX_MODEL}。`);
 if(config.mode!=='api'||model&&model!=='default')return;
 const normalize=(base:string)=>{try{const url=new URL(base);return url.origin+url.pathname.replace(/\/+$/,'');}catch{return base}};
 if(normalize(config.baseUrl)!==normalize(connectionDefinition(id).baseUrl))throw Object.assign(Error('服务没有声明默认模型，请在接入设置里选择模型'),{status:412});
}
export async function resolveAgentConnectionLaunch(id:ConnectionId,baseEnv?:NodeJS.ProcessEnv,deps:ConnectionDependencies={},requestedModel?:string,expectedProfile?:string):Promise<{executable:string;env:NodeJS.ProcessEnv;args:string[];model:string;method:ConnectionConfig['mode'];transport?:'acp';connectionRevision?:number}>{
 assertAgentExecutionAllowed(id);const config=getConnectionConfig(id),definition=connectionDefinition(id);
 const model=effectiveConnectionModel(id,requestedModel);
 if(id==='builtin'){
  if(expectedProfile&&config.profileId!==expectedProfile)throw Error('当前模型配置已切换，请重新开始任务');
  if(!config.hasKey||!config.connected||model!==config.model)throw Error('请先在内置智能体中选定模型并通过看图测试');
  const key=await (deps.store??connectionSecretStore()).read(secretId(id,config));
  if(!key||getConnectionConfig(id).revision!==config.revision)throw Error('模型或密钥已变更，请重新连接');
  const root=process.env.LINKREADER_RUNTIME_ROOT||process.cwd();
  const bundled=path.join(root,'desktop','builtin-runtime','agent.mjs');
  const entry=fs.existsSync(bundled)?bundled:path.join(root,'desktop','builtin-agent','agent.mjs');
  if(!fs.existsSync(entry))throw Error('安装中缺少内置智能体组件');
  const inherited={...process.env,...baseEnv};
  const env:NodeJS.ProcessEnv={};
  for(const [name,value] of Object.entries(inherited))if(/^(PATH|SystemRoot|WINDIR|ComSpec|PATHEXT|TEMP|TMP|TMPDIR|LANG|LC_ALL|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LINKREADER_PYTHON|LINKREADER_FFMPEG)$/i.test(name))env[name]=value;
  Object.assign(env,{ELECTRON_RUN_AS_NODE:'1',PI_CODING_AGENT_DIR:path.join(path.dirname(file()),'builtin-agent'),OPENTAKE_BUILTIN_KEY:key,OPENTAKE_BUILTIN_MODEL:model,OPENTAKE_BUILTIN_PROTOCOL:builtinProtocol(config.baseUrl,config.format),OPENTAKE_BUILTIN_BASE_URL:config.baseUrl});
  return {executable:process.execPath,env,args:[entry],model,method:config.mode,transport:'acp' as const};
 }
 if(!definition.heavySupported)throw Error(`${definition.name} 命令行出片待适配`);
 if(id==='codex'||id==='claude')assertConnectionModel(id,model,config);
 let env=agentRegionEnvironment(id,installations.sanitizeAgentEnv(deps.discoveryEnv??installations.loginEnvironment({...process.env,...baseEnv})));
 const executable=deps.detect?await deps.detect(id,config):await detectExecutable(id,config,env);if(!executable)throw Error((id==='codex'&&installations.storeCodexAccessNotice(config.cliPath))||'出片和写卡片代码需要安装命令行；只有 API 密钥时可处理纯文字');
 const args:string[]=[];
 if(id!=='codex'&&id!=='claude'){
  if(config.mode!=='cli')throw Error('此智能体的出片需要命令行账号接通；API 密钥仅支持轻活');
  const acpArgs=agentAcpArgs(id);if(!acpArgs)throw Error(`${definition.name} 命令行出片待适配`);
  const status=await getConnectionStatus(id,{...deps,discoveryEnv:env});if(!status.enabled||!status.connected)throw Error(id==='deepseek'&&status.cliAuthMessage?status.cliAuthMessage:'所选智能体未接通，请到设置重新接通');
  if(status.filmOutdated)throw Error(`${definition.name} ${status.cliVersion} 太旧，需要 ${status.filmMinimumVersion} 以上才能出片`);
  let resolvedModel=model;
  let connectionRevision:number|undefined;
  if(id==='deepseek'){
   const latest=getConnectionConfig(id);
   // A passive route switch can discover the old key was rejected while preparing this launch.
   const knownFallback=!config.deepseekKeyRejected&&latest.deepseekKeyRejected&&(latest.revision??0)===(config.revision??0)+1;
   if(latest.revision!==config.revision&&!knownFallback)throw Error('接入配置已改变，请重新开始任务');
   env=await harnessEnvironment(latest,env,deps);
   if(latest.deepseekKeyRejected&&status.deepseekRoute==='account'&&!status.models.some(entry=>entry.id===model))resolvedModel='default';
   connectionRevision=latest.revision??0;
  }
  assertAgentWorkAllowed(id);return {connectionRevision,executable,env,args:[...acpArgs],model:resolvedModel,method:config.mode,transport:'acp'};
 }
 if(config.mode==='api'){
  if(!config.connected)throw Error('API 接入还没有测试通过，请先测试连接');const key=await (deps.store??connectionSecretStore()).read(id);if(!key)throw Error('系统钥匙串中没有 API 密钥，请重新保存');
  if(id==='claude')env=installations.sanitizeAgentEnv(env,{agent:id,variables:{ANTHROPIC_API_KEY:key,ANTHROPIC_BASE_URL:config.baseUrl}});
  else {
   const provider=deepseekCodexEndpoint(id,config.baseUrl)?'deepseek':'opentake';
   env=installations.sanitizeAgentEnv(env,{agent:id,variables:{OPENTAKE_CODEX_API_KEY:key}});
   args.push('-c',`model_provider="${provider}"`,'-c',`model_providers.${provider}={name="${provider==='deepseek'?'deepseek':'OpenTake'}",base_url=${JSON.stringify(config.baseUrl)},env_key="OPENTAKE_CODEX_API_KEY",wire_api="responses",requires_openai_auth=false}`);
  }
 }
 assertAgentExecutionAllowed(id);return {executable,env,args,model,method:config.mode};
}
/** 轻活只发送文字，不授予工具、文件或 shell。业务调用与测试连接分离。 */
export async function runConnectionText(id:ConnectionId,prompt:string,model?:string,signal?:AbortSignal,deps:ConnectionDependencies={}){
 assertAgentExecutionAllowed(id);const config=getConnectionConfig(id),protocol=connectionProtocol(id,config.baseUrl,config.format);if(config.mode!=='api'||!config.connected)throw Error('请先接通 API 密钥');
 const selected=effectiveConnectionModel(id,model);if(selected==='default')throw Error('服务没有声明默认模型，请在接入设置里选择模型');if(signal?.aborted)throw Error('任务已取消');
 const body=protocol==='responses'?{model:selected,input:prompt}:protocol==='anthropic'?{model:selected,max_tokens:4096,messages:[{role:'user',content:prompt}]}:{model:selected,messages:[{role:'user',content:prompt}]};
 const route=protocol==='responses'?'responses':protocol==='anthropic'?(/\/v1$/.test(config.baseUrl)?'messages':'v1/messages'):'chat/completions';
 const cancelled=new AbortController();const stop=onAgentDisabled(disabled=>{if(disabled===id)cancelled.abort()});
 let data:Record<string,unknown>;try{assertAgentExecutionAllowed(id);data=await requestJson(id,route,{...deps,timeoutMs:deps.timeoutMs??600000},body,signal?AbortSignal.any([signal,cancelled.signal]):cancelled.signal)}catch(error){if((error as {kind?:string})?.kind==='credentials')markAgentCredentialsRejected(id,'api',config.revision||0);throw error}finally{stop();}
 if(signal?.aborted)throw Error('任务已取消');
 if(protocol==='anthropic')return z.array(z.object({type:z.string(),text:z.string().optional()})).parse(data.content).filter(c=>c.type==='text').map(c=>c.text||'').join('');
 if(protocol==='responses')return z.array(z.object({content:z.array(z.object({type:z.string(),text:z.string().optional()})).optional()})).parse(data.output).flatMap(item=>item.content??[]).filter(c=>c.type==='output_text').map(c=>c.text||'').join('');
 return z.object({choices:z.array(z.object({message:z.object({content:z.string()})})).min(1)}).parse(data).choices[0].message.content;
}
