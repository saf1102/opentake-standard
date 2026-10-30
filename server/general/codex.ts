import {killProcessGroup} from './edition.ts';
/**
 * 通用剪辑怎样调用 Codex：非交互的 `codex exec --json`。
 * - 出片：workspace-write 沙盒，只能写本工程的 work/；默认不联网；不加载用户的 config.toml、规则、技能目录；
 *   关掉网页搜索、生图、多 agent、记忆、电脑操控和插件。用户的技能用 skills.include_instructions=false 挡住：
 *   技能清单不再进入提示词（用 `codex debug prompt-input` 核对过：36 条 → 0 条）。登录仍走原来的 CODEX_HOME，不复制任何凭据。
 * - 审片：只读沙盒、临时会话（--ephemeral），把抽出的画面用 -i 附上，用 --output-schema 要结构化结论。
 */
import fs from 'node:fs';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export const DISABLED_FEATURES = ['image_generation', 'multi_agent', 'multi_agent_v2', 'memories', 'computer_use', 'browser_use', 'browser_use_external', 'in_app_browser', 'apps', 'plugins', 'remote_plugin', 'tool_suggest'];

export type CodexChoice = { model: string; effort: string };
export type TurnArgs = CodexChoice & { work: string; lastMessage: string; network: boolean; resumeThread?: string; images?: string[] };
export type ReviewArgs = CodexChoice & { dir: string; lastMessage: string; schema: string; images: string[] };

function shared({ model, effort }: CodexChoice) {
  return ['--json', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '-m', model, '-c', `model_reasoning_effort="${effort}"`,
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"', '-c', 'skills.include_instructions=false',
    ...DISABLED_FEATURES.flatMap(f => ['--disable', f])];
}

/** One turn of the film agent. The prompt comes on stdin ("-"); images follow it. */
export function filmTurnArgs(a: TurnArgs): string[] {
  const sandbox = ['-c', 'sandbox_mode="workspace-write"', '-c', `sandbox_workspace_write.network_access=${a.network ? 'true' : 'false'}`,
    '-c', 'sandbox_workspace_write.exclude_slash_tmp=true', '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true'];
  const images = (a.images || []).flatMap(file => ['-i', file]);
  // `exec resume` has no -C: the process runs in the work folder instead.
  return a.resumeThread
    ? ['exec', 'resume', ...shared(a), ...sandbox, '-o', a.lastMessage, a.resumeThread, '-', ...images]
    : ['exec', ...shared(a), ...sandbox, '-C', a.work, '-o', a.lastMessage, '-', ...images];
}

/** The read-only reviewer: a fresh, ephemeral session that only looks at the attached frames and answers in JSON. */
export function reviewArgs(a: ReviewArgs): string[] {
  return ['exec', ...shared(a), '--ephemeral', '-c', 'sandbox_mode="read-only"', '--output-schema', a.schema, '-C', a.dir, '-o', a.lastMessage, '-', ...a.images.flatMap(file => ['-i', file])];
}

export type CodexProcess = { child: ChildProcess; done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>; stop: () => void };

/** Start Codex in its own process group so stopping it also stops the commands it started (renders, Chrome). */
export function startCodex(executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; prompt: string; eventLog?: string; redact?: (text:string)=>string; onEvent: (event: Record<string, unknown>) => void }): CodexProcess {
  const child = spawn(executable, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  let stderr = '';
  const redact=options.redact || ((text:string)=>text);
  const log = options.eventLog ? fs.createWriteStream(options.eventLog, { flags: 'a' }) : undefined;
  child.stderr!.on('data', chunk => { if (stderr.length < 200_000) stderr += String(chunk); });
  const lines = createInterface({ input: child.stdout! });
  lines.on('line', line => {
    line=redact(line);
    log?.write(`${line}\n`);
    if (!line.trim().startsWith('{')) return;
    try { options.onEvent(JSON.parse(line)); } catch { /* a malformed line is kept in the log, not fatal */ }
  });
  child.stdin!.on('error', () => { /* Codex may exit before reading all of stdin */ });
  child.stdin!.end(options.prompt);
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>(resolve => {
    let settled = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => { if (settled) return; settled = true; lines.close(); log?.end(); resolve({ code, signal, stderr:redact(stderr) }); };
    child.on('error', error => { stderr += `\n${redact(error.message)}`; finish(-1, null); });
    child.on('close', finish);
  });
  const group = (signal: NodeJS.Signals) => { try { if (child.pid) killProcessGroup(child.pid, signal); } catch { try { child.kill(signal); } catch { /* already gone */ } } };
  // Commands run in a terminal get their own session, outside the group: note every descendant before Codex goes.
  const stop = () => {
    const tree = child.pid ? descendants(child.pid) : [];
    const signal = (s: NodeJS.Signals) => { group(s); for (const pid of tree) { try { process.kill(pid, s); } catch { /* gone */ } } };
    signal('SIGTERM');
    const timer = setTimeout(() => signal('SIGKILL'), 4000);
    timer.unref();
    void done.then(() => { setTimeout(() => { clearTimeout(timer); signal('SIGKILL'); }, 1500).unref(); });
  };
  void done.then(() => group('SIGKILL'));
  return { child, done, stop };
}

/** Every process below `root` (pid, ppid from ps), deepest last. */
export function descendants(root: number): number[] {
  let table: string;
  try { table = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 3000 }); } catch { return []; }
  const children = new Map<number, number[]>();
  for (const line of table.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid) children.set(ppid, [...(children.get(ppid) || []), pid]);
  }
  const out: number[] = [], queue = [root];
  while (queue.length) for (const pid of children.get(queue.shift()!) || []) { out.push(pid); queue.push(pid); }
  return out;
}
