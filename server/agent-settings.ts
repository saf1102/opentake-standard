import installations from './agent-installation.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { AGENT_MODULES, defaultAgentSettings, type AgentCatalog, type AgentModule, type AgentSettings, type AgentRun, type AgentSettingsView } from '../src/studio/agent-settings.ts';
import { execFileAsync } from './proc.ts';

export const agentSettingsFile = () => process.env.LINKREADER_AGENT_SETTINGS_FILE || path.join(os.homedir(), 'Library', 'Application Support', 'OpenTake Standard', 'agent-settings.json');
export function atomicAgentJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, { force: true }); }
}
const choiceSchema = z.object({ model: z.string().regex(/^[a-zA-Z0-9._-]+$/), effort: z.enum(['none','minimal','low','medium','high','xhigh','max','ultra']) }).strict();
const settingsSchema = z.object({ version: z.literal(1), allowRemoteAi: z.boolean().default(false), cliPath: z.string().trim(), modules: z.record(z.enum(AGENT_MODULES.map(m => m.id)), choiceSchema) }).strict();
export function readAgentSettings(): AgentSettings {
  const file = agentSettingsFile();
  if (!fs.existsSync(file)) return defaultAgentSettings();
  try { const stored=JSON.parse(fs.readFileSync(file,'utf8')); return settingsSchema.parse({...stored,modules:{...defaultAgentSettings().modules,...stored.modules}}); }
  catch { throw new Error('Agent 配置文件损坏，请检查 agent-settings.json；未自动改用其他模型'); }
}
/**
 * A saved path that no longer works falls back to auto-detection. Versions before 1.0.0 saved whatever they found,
 * often the Codex bundled inside the old app, which 1.0.0 removed. A path being typed in still fails on its own.
 */
export function resolveCliPath(configured = readAgentSettings().cliPath): string {
  try { return installations.resolveAgent('codex', configured); }
  catch (error) {
    if (!configured || configured !== readAgentSettings().cliPath) throw error;
    return installations.resolveAgent('codex', '');
  }
}
/** Clears a saved Codex path that stopped working, only if it is still the one saved. */
export function forgetStaleCliPath(stale: string) {
  const settings = readAgentSettings();
  if (stale && settings.cliPath === stale) atomicAgentJson(agentSettingsFile(), { ...settings, cliPath: '' });
}
export async function checkCliPath(configured: string) {
  const executable = resolveCliPath(configured);
  const { stdout } = await execFileAsync(executable, ['--version'], { timeout: 8_000, maxBuffer: 64 * 1024, env: installations.loginEnvironment() });
  if (!/codex/i.test(stdout)) throw new Error('所选文件没有返回 Codex CLI 版本');
  return { executable, cliVersion: stdout.trim() };
}
const ModelPage = z.object({ data: z.array(z.object({ model: z.string(), displayName: z.string(), hidden: z.boolean().optional(), supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })), defaultReasoningEffort: z.string() })), nextCursor: z.string().nullable().optional() });
const catalogs = new Map<string, AgentCatalog>();
const pending = new Map<string, Promise<AgentCatalog>>();
/** Read the selected binary's real account model catalog, not a hardcoded UI list. */
export async function getAgentCatalog(configured: string, refresh = false): Promise<AgentCatalog> {
  const executable = resolveCliPath(configured);
  const stat = fs.statSync(executable);
  const key = `${executable}:${stat.mtimeMs}:${stat.size}`;
  const cached = catalogs.get(key);
  if (!refresh && cached && Date.now() - Date.parse(cached.checkedAt) < 300_000) return cached;
  if (pending.has(key)) return pending.get(key)!;
  const request = (async () => {
    const { cliVersion } = await checkCliPath(executable);
    const models = await new Promise<AgentCatalog['models']>((resolve, reject) => {
      const child = spawn(executable, ['app-server', '--stdio'], { stdio: ['pipe','pipe','ignore'], env: installations.loginEnvironment() });
      const lines = createInterface({ input: child.stdout });
      let settled = false, bytes = 0;
      const all: AgentCatalog['models'] = [];
      const finish = (error?: Error) => {
        if (settled) return; settled = true; clearTimeout(timer); lines.close(); child.stdin.end(); child.kill('SIGTERM');
        const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1000); kill.unref();
        if (error) reject(error); else resolve(all);
      };
      const timer = setTimeout(() => finish(new Error('读取 Codex 模型列表超时，请检查 CLI 登录与连接')), 25_000);
      const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
      child.on('error', finish); child.stdin.on('error', finish);
      child.on('exit', () => { if (!settled) finish(new Error('Codex 未返回模型列表，请确认 CLI 已登录且支持 app-server')); });
      lines.on('line', line => {
        bytes += line.length;
        if (bytes > 2 * 1024 * 1024) { finish(new Error('Codex 模型列表超过大小限制')); return; }
        try {
          const result = JSON.parse(line);
          if (result.error) { finish(new Error(result.error.message || '无法读取 Codex 模型列表')); return; }
          if (result.id === 1) { send({ method: 'initialized' }); send({ id: 2, method: 'model/list', params: { includeHidden: false, limit: 100 } }); }
          if (result.id === 2) {
            const page = ModelPage.parse(result.result);
            all.push(...page.data.filter(m => !m.hidden).map(m => ({ id: m.model, name: m.displayName, efforts: m.supportedReasoningEfforts.map(e => e.reasoningEffort), defaultEffort: m.defaultReasoningEffort })));
            if (page.nextCursor) send({ id: 2, method: 'model/list', params: { includeHidden: false, limit: 100, cursor: page.nextCursor } });
            else if (!all.length) finish(new Error('Codex 没有返回可选模型'));
            else finish();
          }
        } catch (error) { finish(new Error(`无法解析 Codex 模型列表：${String(error)}`)); }
      });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'linkreader_agents', version: '1.0.0' } } });
    });
    const catalog = { executable, cliVersion, models, checkedAt: new Date().toISOString() };
    catalogs.set(key, catalog);
    return catalog;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
export function validateAgentChoice(module: AgentModule, settings: AgentSettings, catalog: AgentCatalog) {
  const choice = settings.modules[module];
  const model = catalog.models.find(m => m.id === choice.model);
  const name = AGENT_MODULES.find(m => m.id === module)!.name;
  if (!model) throw new Error(`${name}：当前 CLI 未提供模型 ${choice.model}，请重新选择`);
  if (!model.efforts.includes(choice.effort)) throw new Error(`${name}：${choice.model} 不支持推理强度 ${choice.effort}`);
}
export async function saveAgentSettings(value: unknown) {
  const settings = settingsSchema.parse(value);
  const catalog = await getAgentCatalog(settings.cliPath, true);
  for (const module of AGENT_MODULES) validateAgentChoice(module.id, settings, catalog);
  // Empty path keeps automatic detection enabled.
  atomicAgentJson(agentSettingsFile(), settings);
  return { settings, catalog, runs: recentAgentRuns() };
}
export function recentAgentRuns(): AgentRun[] {
  const dir = path.join(path.dirname(agentSettingsFile()), 'agent-runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 20).flatMap(f => {
    try { return [JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as AgentRun]; } catch { return []; }
  });
}
export async function agentSettingsView(): Promise<AgentSettingsView> {
  const settings = readAgentSettings();
  try { return { settings, catalog: await getAgentCatalog(settings.cliPath), runs: recentAgentRuns() }; }
  catch (error) { return { settings, catalog: null, catalogError: error instanceof Error ? error.message : String(error), runs: recentAgentRuns() }; }
}
export async function chooseAgentCli() {
  if (process.platform !== 'darwin') throw new Error('此主机不支持文件选择器，请输入 CLI 的绝对路径');
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', 'POSIX path of (choose file with prompt "选择 Codex CLI 可执行文件" with invisibles)'], { timeout: 120_000 });
    return { path: stdout.trim() };
  } catch (error) { if (String(error).includes('-128')) return { path: null }; throw error; }
}
