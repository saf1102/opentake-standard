/**
 * Codex 事件（codex exec --json 的每一行）和 Agent 写的 progress.json → 页面上的步骤。纯函数，便于用实测日志做夹具测试。
 * 规则：Agent 负责的步骤（读风格 … 渲染）只往前走：后面的步骤开始了，前面的就算做完；
 * Agent 回头改代码时不把已完成的步骤改回去，只更新当前步骤的说明。审片和交付由 OpenTake 自己推进。
 */
import { GENERAL_STEP_IDS } from '../../src/general/general-contract.ts';
import type { GeneralInputKind, GeneralRun, GeneralStep, GeneralStepId } from '../../src/general/general-contract.ts';

export const AGENT_STEPS: GeneralStepId[] = ['read-style', 'read-input', 'plan', 'code', 'self-check', 'render'];
export function stepLabel(id: GeneralStepId, kind: GeneralInputKind = 'topic'): string {
  return { 'read-style': '读风格', 'read-input': kind === 'footage' ? '看素材' : '读文案', plan: '定方案', code: '写画面', 'self-check': '自查样张', render: '渲染成片', review: '检查成片', deliver: '交付' }[id];
}
export function initialSteps(kind: GeneralInputKind, purpose: GeneralRun['purpose']): GeneralStep[] {
  const skip = purpose === 'revision' ? new Set<GeneralStepId>(['read-style', 'read-input', 'plan']) : new Set<GeneralStepId>();
  return GENERAL_STEP_IDS.map(id => ({ id, label: stepLabel(id, kind), state: skip.has(id) ? 'skipped' : 'waiting' }));
}

const order = (id: GeneralStepId) => GENERAL_STEP_IDS.indexOf(id);
const clip = (s: string, n = 140) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Move the agent's work to `target`: earlier agent steps finish, the target runs. Never moves backwards. */
export function advance(steps: GeneralStep[], target: GeneralStepId, at: string, detail?: string): GeneralStep[] {
  const running = steps.filter(s => s.state === 'running' && AGENT_STEPS.includes(s.id)).map(s => order(s.id));
  const current = running.length ? Math.max(...running) : -1;
  const furthestDone = Math.max(-1, ...steps.filter(s => s.state === 'done' && AGENT_STEPS.includes(s.id)).map(s => order(s.id)));
  const goal = order(target);
  if (goal <= Math.max(current, furthestDone)) {
    // going back (fixing code after a check) or staying: only the running step's description changes
    return detail ? steps.map(s => order(s.id) === current ? { ...s, detail } : s) : steps;
  }
  return steps.map(s => {
    const i = order(s.id);
    if (!AGENT_STEPS.includes(s.id)) return s;
    if (i < goal && (s.state === 'running' || s.state === 'waiting')) return { ...s, state: 'done', startedAt: s.startedAt ?? at, endedAt: at, progress: s.id === 'render' ? s.progress : undefined };
    if (i === goal) return { ...s, state: 'running', startedAt: s.state === 'running' ? s.startedAt : at, endedAt: undefined, ...(detail ? { detail } : {}) };
    return s;
  });
}
export function setStep(steps: GeneralStep[], id: GeneralStepId, patch: Partial<GeneralStep>): GeneralStep[] {
  return steps.map(s => s.id === id ? { ...s, ...patch } : s);
}
export function runningStep(steps: GeneralStep[]) { return steps.find(s => s.state === 'running'); }

/** Which step a shell command belongs to (undefined: it tells nothing about the step). */
export function classifyCommand(command: string): { step: GeneralStepId; detail?: string } | undefined {
  const c = command;
  // File bodies can mention check/render: classify the write before inspecting quoted commands.
  if (/write_text|writeFileSync|writeFile|\bcat\s*(?:<<[^\n]*|)\s*>|\btee\s|apply_patch|\bmkdir\s+[^;\n]*compositions/.test(c)) {
    if (/compositions\b|index\.html|film\.json|\.(?:html|m?js|py|css|sh)\b/.test(c)) return { step: 'code', detail: '正在写画面和声音' };
    if (/TREATMENT\.md|plan\.json/.test(c)) return { step: 'plan', detail: '正在写方案' };
  }
  const progress = /\bfilm(?:\.mjs)?["']?\s+progress\s+(read-style|read-input|plan|code|self-check|render)\b/.exec(c);
  if (progress) return { step: progress[1] as GeneralStepId, detail: `正在${stepLabel(progress[1] as GeneralStepId)}` };
  const film = /\b(?:film|hfx)(?:\.mjs)?["']?\s+(render|mux|poster|look|still|check|probe|frames|progress|need-network)\b/.exec(c)?.[1];
  if (film === 'progress' || film === 'need-network') return undefined;
  if (film === 'render') return { step: 'render', detail: '正在逐帧渲染' };
  if (film === 'mux') return { step: 'render', detail: '正在混音并统一响度' };
  if (film === 'poster') return { step: 'render', detail: '正在生成封面' };
  if (film === 'look' || film === 'still') return { step: 'self-check', detail: '正在检查样张' };
  if (film === 'check') return { step: 'self-check', detail: '正在检查片段和页面' };
  if (film === 'probe' || film === 'frames') return { step: 'read-input', detail: film === 'probe' ? '正在读取素材信息' : '正在素材拆帧' };
  if (/\bnode\s+[^\s;|&]*video\.mjs|\bsh\s+[^\s;|&]*mux\.sh|\bsh\s+(?:\.\/)?build\.sh|(?:^|[\s;'"])\.\/build\.sh/.test(c)) return { step: 'render', detail: '渲染成片' };
  if (/\bnode\s+[^\s;|&]*(?:still|readcheck)\.mjs|--stills|blackdetect|ebur128|\bqc\.py|contact[-_ ]?sheet|sheet\.py/.test(c)) return { step: 'self-check', detail: '自查' };
  if (/HF\.md|STYLE\.md|DIRECTOR\.md|TECHNIQUE\.md|MANUAL\.md|core\/README\.md/.test(c)) return { step: 'read-style', detail: '阅读风格说明' };
  if (/\bffprobe\b|CW_MEDIA|(?:^|[\s'"/])input\/|BRIEF\.md|gt\(scene/.test(c)) return { step: 'read-input', detail: '查看素材和文案' };
  if (/\bcp\s+-R\b|apply_patch/.test(c)) return { step: 'code', detail: '写画面代码' };
  return undefined;
}
export function classifyFiles(paths: string[]): { step: GeneralStepId; detail?: string } | undefined {
  const names = paths.map(p => p.split('/').pop() || p);
  if (paths.some(p => /(?:^|\/)compositions\//.test(p))) return { step: 'code', detail: '正在写画面代码' };
  if (names.some(n => n === 'TREATMENT.md' || n === 'plan.json')) return { step: 'plan', detail: '写方案' };
  if (names.some(n => /\.(html|m?js|py|css|glsl|frag|vert|sh)$/.test(n) || n === 'film.json')) return { step: 'code', detail: '写画面代码' };
  return undefined;
}

export type Usage = { input: number; cached: number; output: number; reasoning: number };
export type EventOutcome = { steps: GeneralStep[]; threadId?: string; usage?: Usage; message?: string; error?: string; turnDone?: boolean };

/** Fold one `codex exec --json` event into the steps. */
export function applyCodexEvent(steps: GeneralStep[], event: Record<string, unknown>, at: string): EventOutcome {
  const type = String(event.type || '');
  if (type === 'thread.started') return { steps, threadId: String(event.thread_id || '') || undefined };
  if (type === 'turn.completed') {
    const u = (event.usage || {}) as Record<string, number>;
    return { steps, turnDone: true, usage: { input: u.input_tokens || 0, cached: u.cached_input_tokens || 0, output: u.output_tokens || 0, reasoning: u.reasoning_output_tokens || 0 } };
  }
  if (type === 'turn.failed') return { steps, turnDone: true, error: String((event.error as { message?: string })?.message || 'Codex 这一轮失败') };
  if (type === 'error') return { steps, error: String(event.message || 'Codex 报错') };
  const item = event.item as Record<string, unknown> | undefined;
  if (!item || !type.startsWith('item.')) return { steps };
  if (item.type === 'agent_message' && type === 'item.completed') {
    const text = String(item.text || '').trim();
    const run = runningStep(steps);
    return { steps: run && text ? setStep(steps, run.id, { detail: clip(text) }) : steps, message: text || undefined };
  }
  const hit = item.type === 'command_execution' && type === 'item.started' ? classifyCommand(String(item.command || ''))
    : item.type === 'file_change' && (type === 'item.started' || type === 'item.completed') ? classifyFiles(((item.changes || []) as { path: string }[]).map(c => c.path)) : undefined;
  if (!hit) return { steps };
  // scripts written before the plan exists are tools for reading the input, not the film's code
  const plan = steps.find(s => s.id === 'plan');
  if (hit.step === 'code' && plan && plan.state === 'waiting' && !/compositions|index\.html|film progress code/.test(JSON.stringify(item))) return { steps };
  return { steps: advance(steps, hit.step, at, hit.detail) };
}

export type Progress = { step?: string; detail?: string; thumbs?: string[]; progress?: { done: number; total: number }; at?: string };
/** progress.json written by the agent (or by `film render`). Thumbs are paths in the work folder; `toUrl` serves them. */
export function applyProgress(steps: GeneralStep[], progress: Progress, at: string, toUrl: (rel: string) => string | undefined): GeneralStep[] {
  const id = progress.step as GeneralStepId;
  if (!AGENT_STEPS.includes(id)) return steps;
  let next = advance(steps, id, at, progress.detail ? clip(progress.detail) : undefined);
  const target = next.find(s => s.id === id)!;
  const patch: Partial<GeneralStep> = {};
  if (Array.isArray(progress.thumbs)) { const urls = progress.thumbs.map(String).map(toUrl).filter((u): u is string => !!u).slice(0, 24); if (urls.length) patch.thumbs = urls; }
  if (id === 'render' && progress.progress && Number.isFinite(progress.progress.done) && Number.isFinite(progress.progress.total)) patch.progress = { done: Number(progress.progress.done), total: Number(progress.progress.total) };
  if (target.state === 'done' || target.state === 'running') next = setStep(next, id, patch);
  return next;
}

/** 没有执行证据的步骤明确跳过，不能编造完成时间。 */
export function finishAgentSteps(steps: GeneralStep[], at: string): GeneralStep[] {
  return steps.map(s => !AGENT_STEPS.includes(s.id) ? s
    : s.state === 'running' ? { ...s, state: 'done', endedAt: at }
    : s.state === 'waiting' && s.id !== 'render' ? { ...s, state: 'skipped', detail: '未单独执行，由成片机检继续检查' } : s);
}
export function beginRepair(run: GeneralRun, reason: string, at: string): void {
  (run.rounds ??= []).push({ round: run.round ?? 1, steps: run.steps.map(s => ({ ...s })) });
  run.round = (run.round ?? 1) + 1;
  run.repairReason = clip(reason, 140);
  run.steps = run.steps.map(s => ['code', 'self-check', 'render', 'review', 'deliver'].includes(s.id)
    ? { ...s, state: s.id === 'code' ? 'running' : 'waiting', detail: s.id === 'code' ? `正在修正：${reason}` : undefined,
        startedAt: s.id === 'code' ? at : undefined, endedAt: undefined, progress: undefined, thumbs: undefined } : s);
}

/** A phase transition is not evidence of a visual check. */
export function verifySelfCheck(steps: GeneralStep[], hasSheet: boolean, at: string): GeneralStep[] {
  return hasSheet ? steps : setStep(steps, 'self-check', {state:'skipped',endedAt:at,detail:'未生成自查样张；继续执行成片检查',thumbs:undefined});
}
