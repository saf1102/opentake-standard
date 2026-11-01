/** 出片 Agent 的唯一入口。Codex 参数和事件原样透传；Claude 只在显式开关打开时启动。
 * Claude CLI 契约：https://code.claude.com/docs/en/headless 和 /cli-reference。
 * 测试仅使用假进程和事件，不能据此声称真实 Claude 出片已经验收。
 */
import fs from 'node:fs';
import type {GeneralAgentChoice, GeneralStep} from '../../src/general/general-contract.ts';
import {assertAgentWorkAllowed, onAgentDisabled, markAgentCredentialsRejected, getConnectionConfig} from '../agent-connections.ts';
import {filmTurnArgs, startCodex, type CodexProcess, type TurnArgs} from './codex.ts';
import {applyCodexEvent, type EventOutcome} from './events.ts';
import {agentAcpArgs,connectionDefinition,type AgentConnectionId} from '../../shared/agent-connections.ts';
import {startAcpAgent,applyAcpEvent,classifyAgentFailure} from './acp.ts';

export type FilmAgentId = AgentConnectionId;
export type ResolvedFilmAgent = {
  agent?: FilmAgentId; executable:string; model:string; effort:string;
  requested?:GeneralAgentChoice; env?:NodeJS.ProcessEnv; args?:string[]; method?:'cli'|'api'; transport?:'acp';
};
export function filmAgentId(choice?: {agent?:string}): FilmAgentId {
  const id=choice?.agent || 'codex';
  if(id!=='codex' && id!=='claude' && (!agentAcpArgs(id as AgentConnectionId) || !connectionDefinition(id as AgentConnectionId).heavySupported)) throw Object.assign(Error('这个智能体的出片适配还没完成，请选择已适配的智能体'),{status:412});
  if(id==='claude' && process.platform==='win32') throw Object.assign(Error('Windows 的 Claude Code 出片暂未适配'),{status:412});
  return id as FilmAgentId;
}
export function claudeTurnArgs(a:TurnArgs & {method?:'cli'|'api'}):string[] {
  // No persistent config writes and no bypassPermissions. Bash must stay in Claude's own sandbox.
  const settings={disableAllHooks:true,autoMemoryEnabled:false,sandbox:{enabled:true,failIfUnavailable:true,autoAllowBashIfSandboxed:true,allowUnsandboxedCommands:false,excludedCommands:[],network:{allowedDomains:a.network?['*']:[],allowLocalBinding:true},filesystem:{allowWrite:[a.work]}},permissions:{allow:['Read','Glob','Grep','Edit','Write'],deny:['Agent','Task','Skill','WebSearch','WebFetch','mcp__*']}};
  return ['-p','--output-format','stream-json','--verbose',a.method==='api'?'--bare':'--safe-mode','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--permission-mode','dontAsk','--tools','Bash,Read,Glob,Grep,Edit,Write','--settings',JSON.stringify(settings),...(a.model && a.model!=='default'?['--model',a.model]:[]),...(['low','medium','high','xhigh','max'].includes(a.effort)?['--effort',a.effort]:[]),...(a.resumeThread?['--resume',a.resumeThread]:[])];
}
export function filmAgentArgs(agent:ResolvedFilmAgent,a:TurnArgs):string[] {
  const id=filmAgentId(agent);
  if(id!=='codex'&&id!=='claude')return [...(agent.args??agentAcpArgs(id)??[])];
  if(id==='claude')return [...claudeTurnArgs({...a,method:agent.method}),...(agent.args||[])];
  const args=filmTurnArgs(a);
  if(agent.method==='api' && a.model==='default') { const at=args.indexOf('-m'); if(at>=0)args.splice(at,2); }
  // Additional provider options are session-local; default Codex args remain byte-for-byte unchanged.
  return agent.args?.length?[args[0],...agent.args,...args.slice(1)]:args;
}
export function applyClaudeEvent(steps:GeneralStep[],event:Record<string,unknown>,at:string):EventOutcome {
  if(event.type==='system' && event.subtype==='init') return {steps,threadId:String(event.session_id||'')||undefined};
  if(event.type==='result') {
    const u=(event.usage||{}) as Record<string,number>;
    const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined;
    const input=number(u.input_tokens),output=number(u.output_tokens),cached=number(u.cache_read_input_tokens)??0,creation=number(u.cache_creation_input_tokens)??0;
    const usage=input!==undefined&&output!==undefined?{input,cached,output,reasoning:0,total:input+cached+creation+output}:undefined;
    const error=event.is_error || event.subtype!=='success';
    return {steps,turnDone:true,...(error?{error:Array.isArray(event.errors)?event.errors.map(String).join('；'):String(event.result||'Claude Code 这一轮没有完成')}:{message:String(event.result||'')}),...(usage?{usage}:{})};
  }
  if(event.type==='system' && event.subtype==='permission_denied')return {steps,error:'Claude Code 的工具权限或沙盒检查没有通过，请检查运行环境'};
  if(event.type==='error')return {steps,error:String(event.message||(event.error as {message?:string})?.message||'Claude Code 报错')};
  if(event.type!=='assistant')return {steps};
  const blocks=((event.message as {content?:unknown[]})?.content||[]) as Record<string,unknown>[];
  let out:EventOutcome={steps};
  for(const b of blocks) {
    if(b.type==='text')out={...out,...applyCodexEvent(out.steps,{type:'item.completed',item:{type:'agent_message',text:b.text}},at)};
    if(b.type==='tool_use') {
      const input=(b.input||{}) as Record<string,unknown>;
      const item=b.name==='Bash'?{type:'command_execution',command:input.command}
        :['Write','Edit'].includes(String(b.name))?{type:'file_change',changes:[{path:String(input.file_path||'')}]}
        :b.name==='Read'?{type:'command_execution',command:`cat ${String(input.file_path||'')}`} :undefined;
      if(item)out={...out,...applyCodexEvent(out.steps,{type:'item.started',item},at)};
    }
  }
  return out;
}
export const applyFilmAgentEvent=(id:FilmAgentId,steps:GeneralStep[],event:Record<string,unknown>,at:string)=>id==='codex'?applyCodexEvent(steps,event,at):id==='claude'?applyClaudeEvent(steps,event,at):applyAcpEvent(steps,event,at);

/** Reuse the existing process-group transport, including descendant cancellation and event log handling. */
export function startFilmAgent(agent:ResolvedFilmAgent,args:string[],options:Parameters<typeof startCodex>[2] & {lastMessage?:string;images?:string[];projectRoot?:string}):CodexProcess {
  const id=filmAgentId(agent);
  // Kept immediately before transport start; even stale jobs must re-read the current switch.
  assertAgentWorkAllowed(id);
  const config=getConnectionConfig(id),method=agent.method||config.mode,revision=config.revision||0;
  // session/new can succeed without usable credentials (observed with Kimi).
  // The actual prompt rejection overrides the cached, non-generating probe immediately.
  const rejected=(error:unknown)=>{if(classifyAgentFailure(error).kind==='credentials')markAgentCredentialsRejected(id,method,revision);};
  const onEvent=(event:Record<string,unknown>)=>{
    const error=applyFilmAgentEvent(id,[],event,new Date().toISOString()).error;
    if(event.type==='acp.error'&&event.kind==='credentials')markAgentCredentialsRejected(id,method,revision);
    else if(error)rejected(error);
    options.onEvent(event);
  };
  const observe=(proc:CodexProcess):CodexProcess=>{
    const unsubscribe=onAgentDisabled(disabled=>{if(disabled===id)proc.stop()});
    return {...proc,done:proc.done.then(result=>{if(result.code!==0)rejected(result.stderr);return result;}).finally(unsubscribe)};
  };
  if(id!=='codex'&&id!=='claude'){
    return observe(startAcpAgent(agent.executable,args,{...options,onEvent,agent:id,model:agent.model,redact:filmAgentRedactor(options.env)}));
  }
  const prompt=id==='claude' && options.images?.length?`${options.prompt}\n\n请用 Read 查看以下参考图片：\n${options.images.join('\n')}`:options.prompt;
  const redact=filmAgentRedactor(options.env);
  const proc=startCodex(agent.executable,args,{...options,prompt,redact,onEvent:event=>{
    if(id==='claude' && event.type==='result' && !event.is_error && typeof event.result==='string' && options.lastMessage)fs.writeFileSync(options.lastMessage,event.result);
    onEvent(event);
  }});
  return observe(proc);
}

/** API credentials stay in the child environment only; even an echoed provider error is scrubbed. */
export function filmAgentRedactor(env:NodeJS.ProcessEnv):(text:string)=>string {
  const keys=['OPENTAKE_CODEX_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'].map(key=>env[key]).filter((key):key is string=>!!key);
  return text=>keys.reduce((value,key)=>value.split(key).join('[已隐藏密钥]'),text);
}
