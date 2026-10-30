import {AsyncLocalStorage} from 'node:async_hooks';
import {LIGHT_AGENT_MODULES,type AgentConnectionId} from '../shared/agent-connections.ts';
import {assertAgentExecutionAllowed,getConnectionConfig,getConnectionStatus,effectiveConnectionModel,runConnectionText,resolveAgentConnectionLaunch,type ConnectionDependencies} from './agent-connections.ts';
import installations from './agent-installation.ts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AgentModule, AgentSettings, AgentRun, AgentChoice } from '../src/studio/agent-settings.ts';
import { agentSettingsFile, atomicAgentJson, getAgentCatalog, readAgentSettings, validateAgentChoice } from './agent-settings.ts';
import { runWithClosedStdin, type ClosedStdinProcessOptions } from './proc.ts';
import { recordCodexUsage } from './general/edition.ts';

const choiceScope=new AsyncLocalStorage<Partial<Record<AgentModule,AgentChoice>>>();
/** Scoped choices survive asynchronous jobs; no global settings are modified. Nested overrides preserve other modules. */
export function withAgentChoiceScope<T>(choices:Partial<Record<AgentModule,AgentChoice>>,work:()=>Promise<T>):Promise<T>{return choiceScope.run({...choiceScope.getStore(),...choices},work);}
export function currentAgentChoice(module:AgentModule,settings:AgentSettings=readAgentSettings()):AgentChoice{return choiceScope.getStore()?.[module]||settings.modules[module];}
export type ResolvedAgent = Readonly<{ agent?: AgentConnectionId; module: AgentModule; executable: string; cliVersion: string; model: string; effort: string; requested?: { model: string; effort: string } }>;
export async function resolveAgent(module: AgentModule, settings: AgentSettings = readAgentSettings()): Promise<ResolvedAgent> {
  const unified=process.platform==='darwin';
  const choice=unified?currentAgentChoice(module,settings):settings.modules[module];settings={...settings,modules:{...settings.modules,[module]:choice}};
  const id=unified?(choice.agent||'codex'):'codex';
  if(unified)assertAgentExecutionAllowed(id);
  const connection=unified?getConnectionConfig(id):undefined;
  if(id==='codex'&&connection?.mode==='api'&&(LIGHT_AGENT_MODULES as readonly string[]).includes(module)){
    if(!connection.enabled||!connection.connected||!connection.hasKey)throw Error('请先接通 Codex API 密钥');
    const model=effectiveConnectionModel(id,choice.model);
    return Object.freeze({agent:id,module,executable:'',cliVersion:'API 密钥',model,effort:'none',...(model!==choice.model&&choice.model!=='default'?{requested:choice}:{})});
  }
  if(id!=='codex'){
    if(!(LIGHT_AGENT_MODULES as readonly string[]).includes(module))throw Error('此工作模块的智能体代码执行待适配，请使用 Codex；Claude Code 出片请从通用剪辑进入');
    const connection=await getConnectionStatus(id);if(!connection.connected||connection.mode!=='api')throw Error('此模块需要已接通的 API 密钥');
    const model=effectiveConnectionModel(id,settings.modules[module].model);
    return Object.freeze({agent:id,module,executable:'',cliVersion:'API 密钥',model,effort:'none',...(model!==settings.modules[module].model&&settings.modules[module].model!=='default'?{requested:settings.modules[module]}:{})});
  }
  const catalog = await getAgentCatalog(settings.cliPath);
  if(connection?.mode==='api'&&!catalog.executable)throw Error('此任务需要命令行，只有 API 密钥时只能处理纯文字');
  const resolvedChoice = validateAgentChoice(module, settings, catalog);
  return Object.freeze({ module, executable: catalog.executable, cliVersion: catalog.cliVersion, ...resolvedChoice, ...(!unified?{agent:undefined}:{}) });
}
/** API credentials can cross process chunks; only complete lines (and the final tail) reach logs or callbacks. */
export function bufferedAgentOutput(redact:(text:string)=>string,write:(text:string)=>void){
  let pending='';
  return {push(chunk:string){pending+=chunk;const end=pending.lastIndexOf('\n');if(end>=0){write(redact(pending.slice(0,end+1)));pending=pending.slice(end+1);}},flush(){if(pending){write(redact(pending));pending='';}}};
}
export function agentFingerprint(agent: ResolvedAgent) { return crypto.createHash('sha256').update(JSON.stringify(agent)).digest('hex'); }
export function agentExecArgs(agent: ResolvedAgent, args: string[]) {
  if (args[0] !== 'exec' || args.slice(0, -1).some(a => a === '-m' || a === '--model' || a.startsWith('--model=') || a.includes('model_reasoning_effort='))) throw new Error('Agent 执行参数必须由模块配置统一提供');
  return ['exec', '-m', agent.model, '-c', `model_reasoning_effort="${agent.effort}"`, ...args.slice(1)];
}
/** One immutable choice per job. CLI failure is surfaced; a fallback model is never silent — `requested` stays on the run record. */
export type AgentProcessOptions=ClosedStdinProcessOptions&{signal?:AbortSignal};
export async function runAgent(agent: ResolvedAgent, args: string[], options: AgentProcessOptions = {}, purpose?: 'connectivity', connectionDeps:ConnectionDependencies={}) {
  const unified=process.platform==='darwin';
  if(unified)assertAgentExecutionAllowed(agent.agent||'codex');
  const argv = agentExecArgs(agent, args);
  const id = crypto.randomUUID(), started = Date.now();
  const outputIndex = argv.indexOf('--output-last-message');
  const output = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
  const record: AgentRun = { ...agent, id, startedAt: new Date(started).toISOString(), status: 'running', ...(purpose ? { purpose } : {}) };
  const globalFile = path.join(path.dirname(agentSettingsFile()), 'agent-runs', `${record.startedAt.replace(/[:.]/g,'-')}-${id}.json`);
  const persist = () => { atomicAgentJson(globalFile, record); if (output) atomicAgentJson(`${output}.agent.json`, record); };
  persist();
  let stderr = '';
  const stderrFile = output ? `${output}.stderr.log` : undefined, stdoutFile = output ? `${output}.stdout.log` : undefined;
  if (stderrFile) fs.writeFileSync(stderrFile, '');
  if (stdoutFile) fs.writeFileSync(stdoutFile, '');
  try {
    if(unified&&(agent.agent&&agent.agent!=='codex'||!agent.executable&&getConnectionConfig('codex').mode==='api')){
      if(!(LIGHT_AGENT_MODULES as readonly string[]).includes(agent.module))throw Error('此任务需要命令行，不能交给只有 API 密钥的接入');
      if(argv.includes('--image'))throw Error('此 API 适配只接受纯文字，图片任务请使用 Codex');
      let prompt=argv.at(-1)||'';const schemaIndex=argv.indexOf('--output-schema');
      if(schemaIndex>=0)prompt+=`\n只返回符合此 JSON Schema 的 JSON，不要代码围栏：\n${fs.readFileSync(argv[schemaIndex+1],'utf8')}`;
      const text=await runConnectionText(agent.agent||'codex',prompt,agent.model,options.signal,connectionDeps);
      if(output)fs.writeFileSync(output,text.replace(/^```(?:json)?\s*\n?|\n?```$/g,''));
      record.status='completed';return {stdout:text,stderr:''};
    }
    const connection=unified?getConnectionConfig('codex'):undefined;
    const launch=connection?.mode==='api'?await resolveAgentConnectionLaunch('codex',options.env):undefined;
    if(launch)argv.splice(1,0,...launch.args);
    const secrets=launch?Object.entries(launch.env).filter(([key])=>/API_KEY|AUTH_TOKEN/.test(key)).map(([,value])=>value).filter((v):v is string=>!!v):[];
    const redact=(value:string)=>secrets.reduce((text,key)=>text.split(key).join('[密钥已隐藏]'),value);
    const writeStderr=(chunk:string)=>{if(stderr.length<64_000)stderr+=chunk;if(stderrFile)fs.appendFileSync(stderrFile,chunk);options.onStderr?.(chunk);};
    const writeStdout=(chunk:string)=>{if(stdoutFile)fs.appendFileSync(stdoutFile,chunk);options.onStdout?.(chunk);};
    const stderrBuffer=launch?bufferedAgentOutput(redact,writeStderr):undefined;
    const stdoutBuffer=launch?bufferedAgentOutput(redact,writeStdout):undefined;
    let result:Awaited<ReturnType<typeof runWithClosedStdin>>;
    try{
      result=await runWithClosedStdin(agent.executable,argv,{...options,env:launch?.env??installations.sanitizeAgentEnv({...installations.loginEnvironment(),...options.env}),
        onStderr:chunk=>stderrBuffer?stderrBuffer.push(chunk):writeStderr(chunk),
        onStdout:chunk=>stdoutBuffer?stdoutBuffer.push(chunk):writeStdout(chunk),
      });
    }finally{stderrBuffer?.flush();stdoutBuffer?.flush();}
    if(launch)result={...result,stdout:redact(result.stdout),stderr:redact(result.stderr)};
    record.reportedModel = stderr.match(/^model:\s*(.+)$/m)?.[1]?.trim();
    record.reportedEffort = stderr.match(/^reasoning effort:\s*(.+)$/m)?.[1]?.trim();
    if (record.reportedModel && record.reportedModel !== agent.model) throw new Error(`CLI 返回模型 ${record.reportedModel}，与设置 ${agent.model} 不一致`);
    if (record.reportedEffort && record.reportedEffort !== agent.effort) throw new Error(`CLI 返回推理强度 ${record.reportedEffort}，与设置 ${agent.effort} 不一致`);
    record.status = 'completed';
    return result;
  } catch (error) {
    record.status = 'failed'; record.error = unified&&getConnectionConfig(agent.agent||'codex').mode==='api' ? 'API 调用失败，请检查连接、模型和任务要求（密钥及原始响应未记录）' : error instanceof Error ? error.message : String(error);
    throw new Error(`${agent.module} · ${agent.model} / ${agent.effort}：${record.error}`);
  } finally { record.durationMs = Date.now() - started; if(!agent.agent||agent.agent==='codex')recordCodexUsage(); persist(); }
}
