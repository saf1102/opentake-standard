import installations from './agent-installation.ts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AgentModule, AgentSettings, AgentRun } from '../src/studio/agent-settings.ts';
import { agentSettingsFile, atomicAgentJson, getAgentCatalog, readAgentSettings, validateAgentChoice } from './agent-settings.ts';
import { runWithClosedStdin, type ClosedStdinProcessOptions } from './proc.ts';

export type ResolvedAgent = Readonly<{ module: AgentModule; executable: string; cliVersion: string; model: string; effort: string }>;
export async function resolveAgent(module: AgentModule, settings: AgentSettings = readAgentSettings()): Promise<ResolvedAgent> {
  const catalog = await getAgentCatalog(settings.cliPath);
  validateAgentChoice(module, settings, catalog);
  return Object.freeze({ module, executable: catalog.executable, cliVersion: catalog.cliVersion, ...settings.modules[module] });
}
export function agentFingerprint(agent: ResolvedAgent) { return crypto.createHash('sha256').update(JSON.stringify(agent)).digest('hex'); }
export function agentExecArgs(agent: ResolvedAgent, args: string[]) {
  if (args[0] !== 'exec' || args.slice(0, -1).some(a => a === '-m' || a === '--model' || a.startsWith('--model=') || a.includes('model_reasoning_effort='))) throw new Error('Agent 执行参数必须由模块配置统一提供');
  return ['exec', '-m', agent.model, '-c', `model_reasoning_effort="${agent.effort}"`, ...args.slice(1)];
}
/** One immutable choice per job. CLI failure is surfaced; no silent model downgrade. */
export async function runAgent(agent: ResolvedAgent, args: string[], options: ClosedStdinProcessOptions = {}, purpose?: 'connectivity') {
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
    const result = await runWithClosedStdin(agent.executable, argv, { ...options, env: installations.sanitizeAgentEnv({...installations.loginEnvironment(), ...options.env}),
      onStderr: chunk => { if (stderr.length < 64_000) stderr += chunk; if (stderrFile) fs.appendFileSync(stderrFile, chunk); options.onStderr?.(chunk); },
      onStdout: chunk => { if (stdoutFile) fs.appendFileSync(stdoutFile, chunk); options.onStdout?.(chunk); },
    });
    record.reportedModel = stderr.match(/^model:\s*(.+)$/m)?.[1]?.trim();
    record.reportedEffort = stderr.match(/^reasoning effort:\s*(.+)$/m)?.[1]?.trim();
    if (record.reportedModel && record.reportedModel !== agent.model) throw new Error(`CLI 返回模型 ${record.reportedModel}，与设置 ${agent.model} 不一致`);
    if (record.reportedEffort && record.reportedEffort !== agent.effort) throw new Error(`CLI 返回推理强度 ${record.reportedEffort}，与设置 ${agent.effort} 不一致`);
    record.status = 'completed';
    return result;
  } catch (error) {
    record.status = 'failed'; record.error = error instanceof Error ? error.message : String(error);
    throw new Error(`${agent.module} · ${agent.model} / ${agent.effort}：${record.error}`);
  } finally { record.durationMs = Date.now() - started; persist(); }
}
