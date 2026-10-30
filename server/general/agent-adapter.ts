/** 出片 Agent 的唯一入口。Codex 参数和事件原样透传；Claude 只在显式开关打开时启动。
 * Claude CLI 契约：https://code.claude.com/docs/en/headless 和 /cli-reference。
 * 测试仅使用假进程和事件，不能据此声称真实 Claude 出片已经验收。
 */
import fs from 'node:fs';
import type {GeneralAgentChoice, GeneralStep} from '../../src/general/general-contract.ts';
import {assertAgentExecutionAllowed, onAgentDisabled} from '../agent-connections.ts';
import {filmTurnArgs, startCodex, type CodexProcess, type TurnArgs} from './codex.ts';
import {applyCodexEvent, type EventOutcome} from './events.ts';

export type FilmAgentId = 'codex' | 'claude';
export type ResolvedFilmAgent = {
  agent?: FilmAgentId; executable:string; model:string; effort:string;
  requested?:GeneralAgentChoice; env?:NodeJS.ProcessEnv; args?:string[]; method?:'cli'|'api';
};
export function filmAgentId(choice?: {agent?:string}): FilmAgentId {
  const id=choice?.agent || 'codex';
  if(id!=='codex' && id!=='claude') throw Object.assign(Error('这个智能体的出片适配还没完成，请选 Codex 或 Claude Code'),{status:412});
  if(id==='claude' && process.platform==='win32') throw Object.assign(Error('Windows 的 Claude Code 出片暂未适配'),{status:412});
  return id;
}
export function claudeTurnArgs(a:TurnArgs & {method?:'cli'|'api'}):string[] {
  // No persistent config writes and no bypassPermissions. Bash must stay in Claude's own sandbox.
  const settings={disableAllHooks:true,autoMemoryEnabled:false,sandbox:{enabled:true,failIfUnavailable:true,autoAllowBashIfSandboxed:true,allowUnsandboxedCommands:false,excludedCommands:[],network:{allowedDomains:a.network?['*']:[],allowLocalBinding:true},filesystem:{allowWrite:[a.work]}},permissions:{allow:['Read','Glob','Grep','Edit','Write'],deny:['Agent','Task','Skill','WebSearch','WebFetch','mcp__*']}};
  return ['-p','--output-format','stream-json','--verbose',a.method==='api'?'--bare':'--safe-mode','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--permission-mode','dontAsk','--tools','Bash,Read,Glob,Grep,Edit,Write','--settings',JSON.stringify(settings),...(a.model && a.model!=='default'?['--model',a.model]:[]),...(['low','medium','high','xhigh','max'].includes(a.effort)?['--effort',a.effort]:[]),...(a.resumeThread?['--resume',a.resumeThread]:[])];
}
export function filmAgentArgs(agent:ResolvedFilmAgent,a:TurnArgs):string[] {
  if(filmAgentId(agent)==='claude')return [...claudeTurnArgs({...a,method:agent.method}),...(agent.args||[])];
  const args=filmTurnArgs(a);
  if(agent.method==='api' && a.model==='default') { const at=args.indexOf('-m'); if(at>=0)args.splice(at,2); }
  // Additional provider options are session-local; default Codex args remain byte-for-byte unchanged.
  return agent.args?.length?[args[0],...agent.args,...args.slice(1)]:args;
}
export function applyClaudeEvent(steps:GeneralStep[],event:Record<string,unknown>,at:string):EventOutcome {
  if(event.type==='system' && event.subtype==='init') return {steps,threadId:String(event.session_id||'')||undefined};
  if(event.type==='result') {
    const u=(event.usage||{}) as Record<string,number>;
    const error=event.is_error || event.subtype!=='success';
    return {steps,turnDone:true,...(error?{error:Array.isArray(event.errors)?event.errors.map(String).join('；'):String(event.result||'Claude Code 这一轮没有完成')}:{message:String(event.result||'')}),usage:{input:u.input_tokens||0,cached:u.cache_read_input_tokens||0,output:u.output_tokens||0,reasoning:0}};
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
export const applyFilmAgentEvent=(id:FilmAgentId,steps:GeneralStep[],event:Record<string,unknown>,at:string)=>id==='codex'?applyCodexEvent(steps,event,at):applyClaudeEvent(steps,event,at);

/** Reuse the existing process-group transport, including descendant cancellation and event log handling. */
export function startFilmAgent(agent:ResolvedFilmAgent,args:string[],options:Parameters<typeof startCodex>[2] & {lastMessage?:string;images?:string[]}):CodexProcess {
  const id=filmAgentId(agent);
  // Kept immediately before transport start; even stale jobs must re-read the current switch.
  assertAgentExecutionAllowed(id);
  const prompt=id==='claude' && options.images?.length?`${options.prompt}\n\n请用 Read 查看以下参考图片：\n${options.images.join('\n')}`:options.prompt;
  const redact=filmAgentRedactor(options.env);
  const proc=startCodex(agent.executable,args,{...options,prompt,redact,onEvent:event=>{
    if(id==='claude' && event.type==='result' && !event.is_error && typeof event.result==='string' && options.lastMessage)fs.writeFileSync(options.lastMessage,event.result);
    options.onEvent(event);
  }});
  const unsubscribe=onAgentDisabled(disabled=>{if(disabled===id)proc.stop()});
  void proc.done.finally(unsubscribe);
  return proc;
}

/** API credentials stay in the child environment only; even an echoed provider error is scrubbed. */
export function filmAgentRedactor(env:NodeJS.ProcessEnv):(text:string)=>string {
  const keys=['OPENTAKE_CODEX_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'].map(key=>env[key]).filter((key):key is string=>!!key);
  return text=>keys.reduce((value,key)=>value.split(key).join('[已隐藏密钥]'),text);
}
