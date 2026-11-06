import {spawnAgentProcess} from '../agent-launch.ts';
/** ACP v1 stdio transport. Provider programs retain their own login; no credentials are read here.
 * https://agentclientprotocol.com/protocol/v1/tool-calls
 * https://agentclientprotocol.com/protocol/v1/session-config-options
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {agentAcpArgs,connectionDefinition,CONNECTION_DEFINITIONS,type AgentConnectionId} from '../../shared/agent-connections.ts';
import type {GeneralStep,GeneralAgentErrorKind} from '../../src/general/general-contract.ts';
import {assertAgentExecutionAllowed,getConnectionConfig} from '../agent-connections.ts';
import {isClaudeExecutable} from '../agent-roster.ts';
import {descendants,type CodexProcess} from './codex.ts';
import {advance,applyCodexEvent,type EventOutcome,type Usage} from './events.ts';

type Obj=Record<string,unknown>;
const object=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
/** Account identifiers and secrets never belong in user-visible errors or diagnostic excerpts. */
export function redactAcpText(value:string):string {
 return value.replace(/\bBearer\s+\S+/gi,'Bearer [已隐藏]')
  .replace(/\b(?:sk|sess|token|key)-[\w-]+/gi,'[已隐藏]')
  .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|authorization|password|secret|account(?:[_ -]?id)?|user[_ -]?id|email)["']?\s*[=:]\s*["']?)[^\s,"';}]+/gi,'$1[已隐藏]')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[已隐藏邮箱]')
  .replace(/https?:\/\/[^\s"']+/g,'[已隐藏地址]');
}
export type AgentFailure={kind:GeneralAgentErrorKind;message:string;excerpt:string};
export function noAgentResponse(agent:AgentConnectionId):AgentFailure {
 const name=connectionDefinition(agent).name;
 return {kind:'no-response',message:`${name}没有回应。常见原因是套餐不含这项服务或额度用完，请到${name}官网确认。`,excerpt:''};
}
export function classifyAgentFailure(error:unknown):AgentFailure {
 const text=(error instanceof Error?error.message:typeof error==='string'?error:JSON.stringify(error))||'';
 // A possible cause in the fixed no-response explanation must not be reclassified as confirmed quota/plan failure.
 const silent=CONNECTION_DEFINITIONS.find(agent=>agent.kind==='agent'&&text.startsWith(`${agent.name}没有回应`));
 if(silent)return noAgentResponse(silent.id as AgentConnectionId);
 const excerpt=redactAcpText(text||'').replace(/\s+/g,' ').slice(0,240);
 // Explicit exhausted-quota codes override HTTP 429; a bare 429 is only transient throttling.
 const kind:AgentFailure['kind']=/insufficient_quota|quota.{0,25}(?:exhaust|exceed)|(?:credit|balance).{0,25}(?:insufficient|exhaust|deplet)|(?:额度|余额).{0,12}(?:不足|耗尽|用完)|payment_required|\b402\b/i.test(text)?'quota'
  :/(?:subscription|plan).{0,50}(?:not include|does not include|not support|not cover)|(?:model).{0,40}(?:not available.{0,20}(?:plan|subscription))|(?:订阅|套餐).{0,20}(?:不含|不包含|不支持|无权)|model_not_allowed/i.test(text)?'model-plan'
  :/auth_required|authentication[_ ]required|missing.{0,15}(?:key|credential|token)|invalid[_ ](?:api[_ ]?key|credential)|(?:缺少|未配置|无效|过期).{0,12}(?:密钥|凭据)|(?:密钥|凭据).{0,12}(?:缺失|未配置|过期)|not (?:logged in|authenticated)|\b401\b/i.test(text)?'credentials'
  :/at[ _-]+capacity|overload(?:ed)?|(?:模型|服务).{0,12}(?:繁忙|忙碌)|(?:繁忙|忙碌).{0,12}模型/i.test(text)?'busy'
  :/\b429\b|rate[_ -]?limit|too many requests|请求过于频繁/i.test(text)?'rate-limit':'other';
 const message={quota:'智能体额度或余额已用完，请到该服务商补充额度，或选择其他已接通的智能体。',credentials:'智能体缺少有效登录凭据，请在设置中重新登录或补充 API 密钥。','model-plan':'当前订阅不包含所选模型，请在工程中改选可用模型，或到服务商调整套餐。','rate-limit':'智能体暂时限流，请稍后重试。',busy:'这个模型现在繁忙，可以稍后重试或换个模型/智能体',other:'智能体本轮未完成，请查看运行记录并重试。'}[kind];
 return {kind,message,excerpt};
}

/** Resolve symlink ancestors even when the final output does not exist yet. */
export function acpPathInside(root:string,candidate:string):boolean {
 if(!candidate||candidate.includes('\0'))return false;
 const canonical=(value:string):string=>{let current=path.resolve(value),tail:string[]=[];for(;;){try{return path.resolve(fs.realpathSync(current),...tail.reverse())}catch{const parent=path.dirname(current);if(parent===current)return path.resolve(value);tail.push(path.basename(current));current=parent;}}};
 const base=canonical(root),resolved=canonical(path.resolve(root,candidate)),rel=path.relative(base,resolved);
 return rel===''||(!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel));
}
/** Kimi emits complete tool JSON in content.text instead of rawInput/kind.
 * Decode only structured JSON and known names; never infer authority from prose.
 */
export function normalizeAcpTool(tool:Obj,cwd:string):Obj {
 let raw=object(tool.rawInput);
 if(typeof tool.rawInput==='string')try{raw=object(JSON.parse(tool.rawInput))}catch{/* streaming partial JSON */}
 if(!Object.keys(raw).length)for(const block of Array.isArray(tool.content)?tool.content:[]){const content=object(object(block).content);if(content.type==='text'&&typeof content.text==='string')try{const parsed=object(JSON.parse(content.text));if(Object.keys(parsed).length){raw=parsed;break;}}catch{/* descriptive text is not permission evidence */}}
 const name=String(tool.name||String(tool.title||'').split(':')[0]).trim();
 const kinds:Record<string,string>={Shell:'execute',Bash:'execute',Read:'read',ReadFile:'read',Write:'edit',WriteFile:'edit',Edit:'edit',StrReplaceFile:'edit',Grep:'search',Glob:'search',Search:'search'};
 const kind=tool.kind||kinds[name];
 // In Kimi's Shell/Bash contract cwd is optional and inherits session/new's cwd.
 if((name==='Shell'||name==='Bash')&&typeof raw.command==='string'&&!raw.cwd&&!raw.working_directory&&!raw.workdir)raw={...raw,cwd};
 return {...tool,...(kind?{kind}:{}),...(Object.keys(raw).length?{rawInput:raw}:{})};
}
function reportedUsage(value:unknown):Usage|undefined {
 const u=object(value),input=u.inputTokens??u.input_tokens,output=u.outputTokens??u.output_tokens;
 if(typeof input!=='number'||!Number.isFinite(input)||input<0||typeof output!=='number'||!Number.isFinite(output)||output<0)return;
 const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
 return {input,output,cached:number(u.cachedReadTokens??u.cache_read_input_tokens),reasoning:number(u.thoughtTokens??u.reasoning_output_tokens)};
}

/** ACP permission requests are evidence, not trusted declarations: unknown scope fails closed. */
export function acpPermissionDecision(root:string,tool:Obj,cwd:string=root):{allowed:boolean;reason:string} {
 const raw=object(tool.rawInput),kind=String(tool.kind||'');
 const paths:string[]=[];
 for(const key of ['path','file_path','filePath','filepath','directory','cwd','working_directory','workdir','source','destination','old_path','new_path'])if(typeof raw[key]==='string')paths.push(raw[key] as string);
 for(const location of Array.isArray(tool.locations)?tool.locations:[]){const p=object(location).path;if(typeof p==='string')paths.push(p);}
 for(const entry of Array.isArray(tool.content)?tool.content:[]){const p=object(entry).path;if(typeof p==='string')paths.push(p);}
 if(paths.some(p=>!acpPathInside(root,path.resolve(cwd,p))))return {allowed:false,reason:'拒绝工程目录外的访问'};
 if(['read','edit','delete','move','search'].includes(kind))return {allowed:paths.length>0,reason:paths.length?'允许工程内文件操作':'拒绝未声明路径的文件操作'};
 if(kind==='execute'){
  if(!paths.length)return {allowed:false,reason:'拒绝未声明工程范围的命令'};
  const command=raw.command??raw.cmd??raw.command_line;
  if(typeof command!=='string'&& !Array.isArray(command))return {allowed:false,reason:'拒绝未声明命令的执行'};
  const text=Array.isArray(command)?command.map(String).join(' '):command;
  // Never grant a blanket/always option; reject hidden expansion and any explicit outside path.
  if(/[`$~]|\b(?:sudo|eval|exec|source|cd|pushd|popd)\b|(?:^|\s)\.\s|[\r\n]|\b(?:python[\d.]*|node|ruby|perl|sh|bash|zsh)\s+(?:-[A-Za-z]*[ce]|--eval)\b|\b(?:curl|wget|ssh|scp)\b|\\/.test(text))return {allowed:false,reason:'拒绝无法确认范围的命令'};
  const tokens=(text.match(/"[^"]*"|'[^']*'|[^\s;|&<>]+/g)||[]).map(p=>p.replace(/^['"]|['"]$/g,''));
  if(tokens.some((p,i)=>/^(?:python[\d.]*|node|ruby|perl|sh|bash|zsh)$/.test(path.basename(p))&&tokens.slice(i+1).some(a=>/^(?:-[A-Za-z]*[ce]|--eval)(?:=|$)/.test(a))))return {allowed:false,reason:'拒绝脚本内联求值'};
  const references=tokens.map(p=>p.includes('=')?p.slice(p.indexOf('=')+1):p).filter(p=>p&&!p.startsWith('-')); // Bare names can also be symlinks outside the project.
  const commandCwd=typeof raw.cwd==='string'?path.resolve(cwd,raw.cwd):typeof raw.working_directory==='string'?path.resolve(cwd,raw.working_directory):typeof raw.workdir==='string'?path.resolve(cwd,raw.workdir):cwd;
  if(references.some(p=>!acpPathInside(root,path.resolve(commandCwd,p))))return {allowed:false,reason:'拒绝命令中的工程外路径'};
  return {allowed:true,reason:'允许工程内命令'};
 }
 return {allowed:false,reason:'拒绝未声明工程范围的操作'};
}

export function applyAcpEvent(steps:GeneralStep[],event:Obj,at:string):EventOutcome {
 if(event.type==='acp.session')return {steps,threadId:String(event.sessionId||'')||undefined};
 if(event.type==='acp.error')return {steps,error:String(event.message||'智能体本轮未完成'),turnDone:true};
 if(event.type==='acp.completed')return {steps,turnDone:true,message:String(event.text||'')||undefined,...(event.usage?{usage:event.usage as Usage}:{})};
 if(event.type==='acp.usage')return {steps,usage:event.usage as Usage};
 if(event.type==='acp.message')return applyCodexEvent(steps,{type:'item.completed',item:{type:'agent_message',text:event.text}},at);
 if(event.type!=='acp.update')return {steps};
 const update=object(event.update),raw=object(update.rawInput);
 if(update.sessionUpdate==='plan')return {steps:advance(steps,'plan',at,'正在制定出片方案')};
 if(update.sessionUpdate!=='tool_call'&&update.sessionUpdate!=='tool_call_update')return {steps};
 const command=raw.command??raw.cmd??raw.command_line;
 if(update.kind==='execute'&&command)return applyCodexEvent(steps,{type:'item.started',item:{type:'command_execution',command:Array.isArray(command)?command.join(' '):command}},at);
 const locations=Array.isArray(update.locations)?update.locations:[];
 const files=[...locations.map(v=>object(v).path),raw.path,raw.file_path,raw.filePath].filter((p):p is string=>typeof p==='string');
 if(update.kind==='read'||update.kind==='search')return applyCodexEvent(steps,{type:'item.started',item:{type:'command_execution',command:`cat ${files.join(' ')}`}},at);
 if(['edit','delete','move'].includes(String(update.kind)))return applyCodexEvent(steps,{type:'item.started',item:{type:'file_change',changes:files.map(p=>({path:p}))}},at);
 return {steps};
}

export type AcpOptions={agent:AgentConnectionId;cwd:string;projectRoot?:string;env:NodeJS.ProcessEnv;prompt:string;model?:string;eventLog?:string;lastMessage?:string;images?:string[];onEvent:(event:Obj)=>void;redact?:(text:string)=>string;timeoutMs?:number};
export function startAcpAgent(executable:string,args:readonly string[],options:AcpOptions):CodexProcess {
 assertAgentExecutionAllowed(options.agent);
 // ACP never hosts Codex/Claude adapters; check file identity too so an alias cannot evade the switch.
 if(options.agent==='codex'||options.agent==='claude'||isClaudeExecutable(executable,options.env,getConnectionConfig('claude').cliPath))throw Error('此程序不能通过通用 ACP 入口启动');
 if(!agentAcpArgs(options.agent))throw Error('这个智能体的 ACP 出片还没完成适配');
 const root=path.resolve(options.projectRoot||options.cwd);
 if(!acpPathInside(root,options.cwd))throw Error('ACP 工作目录必须位于工程目录内');
 const child=spawnAgentProcess(executable,[...args],{cwd:options.cwd,env:options.env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
 const secretSafe=(text:string)=>options.redact?options.redact(text):text;
 const safe=(text:string)=>redactAcpText(secretSafe(text));
 let closed=false,stopping=false,completed=false,hasOutput=false,hasToolActivity=false,sessionId='',text='',stderr='',buffer='',sequence=0,killTimer:ReturnType<typeof setTimeout>|undefined;
 let shutdownTree:number[]=[];
 const pending=new Map<number,{resolve:(v:Obj)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const tools=new Map<string,Obj>();
 const log=options.eventLog?fs.createWriteStream(options.eventLog,{flags:'a'}):undefined;
 const emit=(event:Obj)=>{const payload=JSON.stringify(event);log?.write(safe(payload)+'\n');options.onEvent(JSON.parse(secretSafe(payload)) as Obj)};
 const send=(data:unknown)=>{if(!closed&&!child.stdin!.destroyed)child.stdin!.write(JSON.stringify(data)+'\n')};
 const rpc=(method:string,params:Obj,timeout=30000)=>new Promise<Obj>((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('ACP 请求超时'))},timeout);pending.set(id,{resolve,reject,timer});send({jsonrpc:'2.0',id,method,params});});
 const kill=(signal:NodeJS.Signals,pids:number[]=[])=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,signal);else child.kill(signal)}catch{/* gone */}for(const pid of pids)try{process.kill(pid,signal)}catch{/* gone */}};
 const shutdown=()=>{shutdownTree=child.pid?descendants(child.pid):[];kill('SIGTERM',shutdownTree);killTimer=setTimeout(()=>kill('SIGKILL',shutdownTree),500);};
 const stop=()=>{if(stopping||closed)return;stopping=true;if(sessionId)send({jsonrpc:'2.0',method:'session/cancel',params:{sessionId}});setTimeout(shutdown,50);};
 const fail=(error:unknown)=>{if(completed||stopping)return;const failure=classifyAgentFailure(error);stderr=failure.message;emit({type:'acp.error',...failure});stop();};
 const done=new Promise<{code:number|null;signal:NodeJS.Signals|null;stderr:string}>(resolve=>{
  const finish=(code:number|null,signal:NodeJS.Signals|null)=>{if(closed)return;closed=true;if(killTimer)clearTimeout(killTimer);kill('SIGKILL',shutdownTree);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('ACP 连接已结束'));}pending.clear();log?.end();resolve({code:completed?0:code===0?-1:code,signal,stderr:safe(stderr)});};
  child.once('error',error=>{fail(error);finish(-1,null)});
  child.once('close',(code,signal)=>{if(!completed&&!stopping)fail(stderr||'ACP 命令行提前退出');finish(code,signal)});
 });
 child.stdin!.on('error',error=>{if(!stopping&&!completed)fail(error)});
 child.stderr!.on('data',chunk=>{if(stderr.length<16384)stderr+=String(chunk)});
 const handle=async(message:Obj)=>{
  if(message.jsonrpc!=='2.0')throw Error('ACP 返回格式不正确');
  if(typeof message.method!=='string'){
   const waiter=pending.get(Number(message.id));if(!waiter)return;pending.delete(Number(message.id));clearTimeout(waiter.timer);
   if(message.error){const e=object(message.error);waiter.reject(Error(`${e.code===-32000?'auth_required':e.code??''} ${e.message??''} ${JSON.stringify(e.data??'')}`))}else waiter.resolve(object(message.result));return;
  }
  const params=object(message.params);
  if(params.sessionId!==sessionId||!sessionId){if(message.id!==undefined)send({jsonrpc:'2.0',id:message.id,error:{code:-32602,message:'Unknown session'}});return;}
  if(message.method==='session/update'){
   const update=object(params.update),id=String(update.toolCallId||'');
   if(update.sessionUpdate==='tool_call'||update.sessionUpdate==='tool_call_update')hasToolActivity=true;
   const content=object(update.content);
   if(['agent_message_chunk','agent_thought_chunk'].includes(String(update.sessionUpdate))){
    if(content.type==='text'&&typeof content.text==='string'&&content.text.trim())hasOutput=true;
    else if(['image','audio','resource_link'].includes(String(content.type))&&Object.keys(content).some(key=>key!=='type'&&typeof content[key]==='string'&&String(content[key]).trim()))hasOutput=true;
    else if(content.type==='resource'&&['text','blob','uri'].some(key=>typeof object(content.resource)[key]==='string'&&String(object(content.resource)[key]).trim()))hasOutput=true;
   }
   if(update.sessionUpdate==='plan'&&Array.isArray(update.entries)&&update.entries.some(entry=>typeof object(entry).content==='string'&&String(object(entry).content).trim()))hasOutput=true;
   if(id){tools.set(id,normalizeAcpTool({...tools.get(id),...update},options.cwd));emit({type:'acp.update',update:tools.get(id)});}
   else if(update.sessionUpdate==='agent_message_chunk'&&object(update.content).type==='text'){const chunk=String(object(update.content).text||'');text+=chunk;if(text.length>2*1024*1024)throw Error('ACP 回复过大');emit({type:'acp.message',text:chunk});}
   else {const usage=reportedUsage(update.usage);if(usage)emit({type:'acp.usage',usage});emit({type:'acp.update',update});}return;
  }
  if(message.method==='session/request_permission'){
   hasToolActivity=true;
   const tool=normalizeAcpTool({...tools.get(String(object(params.toolCall).toolCallId||'')),...object(params.toolCall)},options.cwd),decision=acpPermissionDecision(root,tool,options.cwd);
   const opts=(Array.isArray(params.options)?params.options:[]).map(object),selected=opts.find(o=>o.kind===(decision.allowed&&!stopping?'allow_once':'reject_once'));
   emit({type:'acp.permission',allowed:!!selected&&decision.allowed&&!stopping,reason:decision.reason,toolCallId:String(tool.toolCallId||'').slice(0,80)});
   send({jsonrpc:'2.0',id:message.id,result:{outcome:selected?{outcome:'selected',optionId:selected.optionId}:{outcome:'cancelled'}}});return;
  }
  if(message.method==='fs/read_text_file'||message.method==='fs/write_text_file'){
   hasToolActivity=true;
   const file=String(params.path||''),allowed=path.isAbsolute(file)&&acpPathInside(root,file)&&!stopping;
   emit({type:'acp.permission',allowed,reason:allowed?'允许工程内文件操作':'拒绝工程目录外的访问'});
   if(!allowed){send({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Project boundary denied'}});return;}
   try{let result:Obj={};if(message.method==='fs/read_text_file'){if(fs.statSync(file).size>4*1024*1024)throw Error('文件过大');let content=fs.readFileSync(file,'utf8');if(typeof params.line==='number')content=content.split('\n').slice(Math.max(0,params.line-1),typeof params.limit==='number'?Math.max(0,params.line-1)+params.limit:undefined).join('\n');result={content};}else{if(typeof params.content!=='string'||params.content.length>4*1024*1024)throw Error('文件内容无效');fs.writeFileSync(file,params.content);}send({jsonrpc:'2.0',id:message.id,result});}catch{send({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'Project file operation failed'}});}return;
  }
  if(message.id!==undefined)send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Unsupported client method'}});
 };
 child.stdout!.setEncoding('utf8');child.stdout!.on('data',(chunk:string)=>{if(closed)return;buffer+=chunk;if(buffer.length>4*1024*1024){fail('ACP 消息过大');return;}let at:number;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line.trim())continue;try{void handle(object(JSON.parse(line))).catch(fail)}catch{fail('ACP 返回格式不正确')}}});
 void (async()=>{
  const init=await rpc('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:true,writeTextFile:true},terminal:false},clientInfo:{name:'opentake',version:'1'}});
  if(init.protocolVersion!==1)throw Error('ACP 协议版本暂不支持');if(stopping)return;
  const session=await rpc('session/new',{cwd:options.cwd,mcpServers:[]});sessionId=String(session.sessionId||'');if(!sessionId)throw Error('ACP 没有返回有效会话');emit({type:'acp.session',sessionId});if(stopping){send({jsonrpc:'2.0',method:'session/cancel',params:{sessionId}});return;}
  const configs=(Array.isArray(session.configOptions)?session.configOptions:[]).map(object),config=configs.find(c=>c.category==='model'&&c.type==='select');
  const models=object(session.models);let actual=String(config?.currentValue||models.currentModelId||'default'),selected=false;
  const requested=options.model||'default';
  const configValues=config?(Array.isArray(config.options)?config.options:[]).map(object).flatMap(o=>Array.isArray(o.options)?o.options.map(object):[o]):[],catalogued=Array.isArray(models.availableModels)&&models.availableModels.some(m=>object(m).modelId===requested);
  if(requested!=='default'&&config&&(configValues.some(o=>o.value===requested)||!catalogued)){const values=configValues;if(!values.some(o=>o.value===requested))throw Error('所选模型不在智能体可用模型列表中，请修改工程模型设置');await rpc('session/set_config_option',{sessionId,configId:config.id,value:requested});actual=requested;selected=true;}
  else if(requested!=='default'&&Array.isArray(models.availableModels)){if(!models.availableModels.some(m=>object(m).modelId===requested))throw Error('所选模型不在智能体可用模型列表中，请修改工程模型设置');await rpc('session/set_model',{sessionId,modelId:requested});actual=requested;selected=true;}
  emit({type:'acp.model',model:actual,modelSelection:selected?'selected':'default',requestedModel:requested});if(stopping)return;
  const prompt=options.prompt+(options.images?.length?`\n\n请读取以下工程内参考图片：\n${options.images.filter(p=>acpPathInside(root,p)).join('\n')}`:'');
  const result=await rpc('session/prompt',{sessionId,prompt:[{type:'text',text:prompt}]},options.timeoutMs??60*60*1000);
  if(stopping)return;if(result.stopReason!=='end_turn')throw Error(`ACP 本轮未完成：${String(result.stopReason||'unknown')}`);
  if(!hasOutput&&!hasToolActivity){const failure=noAgentResponse(options.agent);throw Object.assign(Error(failure.message),failure);}
  if(options.lastMessage)fs.writeFileSync(options.lastMessage,secretSafe(text));const usage=reportedUsage(result.usage);emit({type:'acp.completed',text:secretSafe(text),...(usage?{usage}:{})});completed=true;shutdown();
 })().catch(fail);
 return {child,done,stop};
}
