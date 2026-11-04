import {classifyAgentFailure,redactAcpText} from './acp.ts';
import {recordFilmOutcome} from '../agent-comparison.ts';
import {prepareAcpGuide} from './acp-work.ts';
import {connectionDefinition,type AgentConnectionId} from '../../shared/agent-connections.ts';
import type {CreationTools} from '../../shared/creation-tools.ts';
import {requireCreationTools} from '../creation-tools.ts';
import {standardEdition,extraStyle,includeStyle,recordCodexUsage} from './edition.ts';
import {renameWithRetrySync,removeWithRetrySync} from '../file-ops.ts';
import {atomicJsonSync} from '../file-ops.ts';
/**
 * 通用剪辑的一次运行：一轮做片（读需求、设计、写、自己看一遍、渲染）→ OpenTake 机检（不过才改一轮）→ 交付第 N 版。
 * 由 Agent 自己看接触表；另开一个 Codex 看图审片（agentReview）默认关掉，它又慢又费 token。
 * - 每一轮是一次 `codex exec`（第一轮新开会话，之后用 `exec resume` 续接同一个会话）。
 * - 停止：结束 Codex 和它启动的进程，文件都留着；接着做：续接同一个会话把停下的那一轮做完。
 * - 插话：codex exec 没有中途插话的接口（app-server 有 turn/steer，但 app-server 不能忽略用户配置，见交回说明），
 *   所以运行中收到的话先排队，下一轮开始时一起发给它；最后一轮之后才到的话，交付后自动开一轮修改。
 * - 联网：Agent 写 network-request.json 并结束这一轮 → 页面问用户 → 允许后下一轮打开沙盒网络。
 * 内部状态（会话号、待做的下一步、排队的话）放在 agent/session.json，不进 GeneralProject。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { snapshotLayers } from './layers.ts';
import { carryEdits, describeEdits, stampHfWork } from './hf-carry.ts';
import { carryTimeline, describeTimeline } from './hf-timeline.ts';
import { quarantineSoftware } from './net-guard.ts';
import { hyperframesToLayers, isHyperframesWork } from './hf-project.ts';
import { renderHyperframes } from './hf-render.ts';
import { PageExecutionError, type PageExecutionDiagnostic } from '../frame-render/page-execution.ts';
import { h264Encode, macVideoEncodingError } from '../editor/video-encode.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GeneralAgentChoice, GeneralLayers, GeneralMessage, GeneralProject, GeneralReference, GeneralRun, GeneralSegment, GeneralStep } from '../../src/general/general-contract.ts';
import type { AgentRun } from '../../src/studio/agent-settings.ts';
import installations from '../agent-installation.ts';
import { agentSettingsFile, atomicAgentJson, readAgentSettings } from '../agent-settings.ts';
import { buildBrief, turnPrompt, type Phase, type QueuedNote, type StyleInfo } from './brief.ts';
import { reviewArgs, type CodexProcess } from './codex.ts';
import {filmAgentId,filmAgentArgs,startFilmAgent,applyFilmAgentEvent,filmAgentRedactor,type ResolvedFilmAgent} from './agent-adapter.ts';
import {assertAgentExecutionAllowed,resolveAgentConnectionLaunch,getConnectionConfig,effectiveConnectionModel} from '../agent-connections.ts';
import { beginRepair, finishAgentSteps, verifySelfCheck, applyCodexEvent, applyProgress, initialSteps, setStep, type Progress, type Usage } from './events.ts';
import { KIT_DIR, ffmpegPath, ffprobePath, prepareWork } from './kit-env.ts';
import { REVIEW_SCHEMA, extractFrames, machineChecks, parseVerdict, reviewPrompt, verdictText, type Verdict } from './review.ts';
import { parseAgent, fileUrl, findGeneral, scanGeneral, updateGeneral, type GeneralLocation } from './store.ts';

const exec = promisify(execFile);
const now = () => new Date().toISOString();

// ——— what the runner needs from outside (replaced in tests) ———
export type ResolvedCodex = ResolvedFilmAgent;
export type GeneralRuntime = {
  /** the project's own choice, or the settings' 通用剪辑出片 when it has none (系统默认) */
  creationTools: (choice?:GeneralAgentChoice) => Promise<CreationTools | undefined>;
  render: typeof renderHyperframes;
  resolveCodex: (choice?: GeneralAgentChoice) => Promise<ResolvedCodex>;
  style: (id: string) => StyleInfo | undefined;
  baseEnv: () => NodeJS.ProcessEnv;
  maxTurns: number;
  /** Only model-busy failures get one automatic retry; injectable delay keeps fake-process tests fast. */
  busyRetryDelayMs: number;
  /** a second Codex looks at the frames and judges the cut (off: the agent's own look plus OpenTake's machine checks) */
  agentReview: boolean;
  renderFilm: typeof renderHyperframes;
};
let runtime: GeneralRuntime = {
  creationTools: requireCreationTools,
  render: (work,output,options) => runtime.renderFilm(work,output,options),
  resolveCodex: async choice => {
    const { resolveAgent } = await import('../agent-runtime.ts');
    const { readAgentSettings } = await import('../agent-settings.ts');
    const settings = readAgentSettings();
    const selected=choice ?? settings.modules.generalEditing;
    const id=filmAgentId(selected);
    assertAgentExecutionAllowed(id);
    const connection=getConnectionConfig(id);
    // Subscription Codex keeps its original catalog, model validation and argv.
    if(id==='codex' && connection.mode!=='api') {
      const selectedSettings={...settings,cliPath:connection.cliPath||settings.cliPath};
      const agent = await resolveAgent('generalEditing', choice ? { ...selectedSettings, modules: { ...settings.modules, generalEditing: choice } } : selectedSettings);
      return { executable: agent.executable, model: agent.model, effort: agent.effort, ...(agent.requested ? {requested: agent.requested} : {}) };
    }
    const launch=await resolveAgentConnectionLaunch(id);
    const model=launch.transport==='acp'?(selected.model||'default'):effectiveConnectionModel(id,selected.model);
    const requested=selected.model && selected.model!=='default' && selected.model!==model?selected:undefined;
    return {agent:id,executable:launch.executable,model,effort:selected.effort||'medium',env:launch.env,args:launch.args,method:launch.method,...(launch.transport?{transport:launch.transport}:{}),...(requested?{requested}:{})};
  },
  style: id => extraStyle?.id === id ? extraStyle : styleLibrary().find(s => s.id === id),
  baseEnv: () => installations.sanitizeAgentEnv(installations.loginEnvironment()),
  maxTurns: 6,
  busyRetryDelayMs: 3000,
  agentReview: false,
  renderFilm: renderHyperframes,
};
export function setGeneralRuntime(patch: Partial<GeneralRuntime>) { runtime = { ...runtime, ...patch }; }

let styles: StyleInfo[] | undefined;
export function styleLibrary(): StyleInfo[] {
  if (!styles) {
    const file = new URL('../../src/workspace/style-library/style-library.json', import.meta.url);
    styles = (JSON.parse(fs.readFileSync(file, 'utf8')) as { styles: StyleInfo[] }).styles.filter(s => includeStyle(s.id));
  }
  return styles;
}

// ——— internal session state ———
export type Session = {
  threadId?: string;
  agent?: AgentConnectionId;
  autoName: boolean;
  /** Explicit provider changes, retained alongside past turns for the local run record. */
  handoffs?: {from: AgentConnectionId; to: AgentConnectionId; previousRunId: string; at: string}[];
  /** what the run does next when it (re)starts */
  pending?: Phase | 'review' | 'deliver';
  /** the pending turn was interrupted and is being continued */
  resumed?: boolean;
  reviewRounds: number;
  polished: boolean;
  extraTurns: number;
  review?: string;
  networkAllowed: boolean;
  networkAnswer?: { allowed: boolean; hosts: string[] };
  queue: (QueuedNote & { id: string })[];
  revision?: { version: number; text: string; reference?: QueuedNote['reference'] };
  lastAgentMessage?: string;
  /** the agent's last words after making or changing the film: they go on the version card */
  filmMessage?: string;
  pageFailure?: PageExecutionDiagnostic;
  /** One automatic code repair per run; an explicit repair/retry starts one further authored turn. */
  pageRepairAttempted?: boolean;
  turns: { runId: string; phase: string; startedAt: string; endedAt?: string; code?: number | null; threadId?: string; usage?: Usage; error?: string }[];
};
const sessionFile = (dir: string) => path.join(dir, 'agent', 'session.json');
export function readSession(dir: string): Session {
  try { return { reviewRounds: 0, polished: false, extraTurns: 0, networkAllowed: false, queue: [], turns: [], autoName: true, ...JSON.parse(fs.readFileSync(sessionFile(dir), 'utf8')) }; }
  catch { return { autoName: true, reviewRounds: 0, polished: false, extraTurns: 0, networkAllowed: false, queue: [], turns: [] }; }
}
export function writeSession(dir: string, session: Session) {
  atomicJsonSync(sessionFile(dir), session);
}
function editSession(dir: string, change: (s: Session) => void) { const s = readSession(dir); change(s); writeSession(dir, s); return s; }

// ——— live runs in this process ———
type Live = { proc?: CodexProcess; driving: boolean; again?: boolean; stopRun?: string };
const live = new Map<string, Live>();
export const activeGeneralRuns = () => live.size;
export const isLive = (id: string) => live.has(id);

const ACTIVE: GeneralRun['state'][] = ['running', 'stopping'];
/** After a restart nothing runs any more: a run saved as running is shown as stopped (it can be continued). */
export function reconcile(location: GeneralLocation): GeneralProject {
  const run = location.project.run;
  if (!run || !ACTIVE.includes(run.state) || live.has(location.project.id)) return location.project;
  const result = updateGeneral(location.project.id, p => {
    if (!p.run) return;
    p.run.state = 'stopped'; p.run.endedAt = now(); p.run.error = 'OpenTake 重新启动过，这次运行已停止，可以接着做';
    p.run.steps = p.run.steps.map(s => s.state === 'running' ? { ...s, state: 'waiting', detail: '已停止' } : s);
  });
  recordRunOutcome(location.project.id, run.id);
  return result;
}

function patchRun(id: string, change: (run: GeneralRun, project: GeneralProject, dir: string) => void) {
  return updateGeneral(id, (project, dir) => { if (project.run) change(project.run, project, dir); });
}
function message(role: GeneralMessage['role'], text: string, extra: Partial<GeneralMessage> = {}): GeneralMessage {
  return { id: crypto.randomUUID(), role, text, at: now(), ...extra };
}

const checkedTools = new Map<string, CreationTools>();
// ——— starting runs ———
function newRun(purpose: GeneralRun['purpose'], project: GeneralProject, steps?: GeneralStep[]): GeneralRun {
  return { id: crypto.randomUUID(), state: 'running', agent: filmAgentId(project.agent ?? readAgentSettings().modules.generalEditing), purpose, steps: steps ?? initialSteps(project.inputs.kind, purpose), startedAt: now(), queued: 0 };
}
function assertIdle(project: GeneralProject) {
  if (project.run && [...ACTIVE, 'needs-network'].includes(project.run.state)) throw Object.assign(new Error('正在出片，请先停止或等它做完'), { status: 409 });
}
export function assertReady(project: GeneralProject) {
  if (!runtime.style(project.styleId)) throw Object.assign(new Error(`风格 ${project.styleId} 不在风格库里`), { status: 400 });
  if (project.inputs.kind === 'footage' && !project.inputs.media.length) throw Object.assign(new Error('还没有放视频'), { status: 400 });
  if (project.inputs.kind === 'topic' && !project.inputs.text.trim()) throw Object.assign(new Error('还没有文案'), { status: 400 });
}

/** What the person asked for, in their words, as the first message of a cut. */
export function requestText(project: GeneralProject): string {
  const style = runtime.style(project.styleId)?.name_zh || project.styleId;
  const length = project.settings.length === 'auto' ? '时长自动' : `约 ${project.settings.length} 秒`;
  const what = project.inputs.kind === 'footage' ? `用这 ${project.inputs.media.length} 段视频` : '用这段文案';
  return `${what}做一条「${style}」，${project.settings.aspect}，${length}。`;
}

/** POST generate: a fresh first cut (a new Codex session). An earlier work folder is kept under agent/. */
export function startFirst(id: string, options: { request?: boolean; tools?: CreationTools } = {}): GeneralProject {
  const { dir, project } = findGeneral(id);
  assertIdle(project);
  assertReady(project);
  if(options.tools) checkedTools.set(id,options.tools); else checkedTools.delete(id);
  const work = path.join(dir, 'work');
  if (fs.existsSync(work) && fs.readdirSync(work).some(f => !f.startsWith('.') || f === '.opentake')) {
    renameWithRetrySync(work, path.join(dir, 'agent', `work-${Date.now()}`));
  }
  fs.mkdirSync(work, { recursive: true });
  editSession(dir, s => Object.assign(s, { threadId: undefined, pending: 'make', resumed: false, reviewRounds: 0, polished: false, extraTurns: 0, review: undefined, pageFailure: undefined, pageRepairAttempted: false, networkAllowed: false, networkAnswer: undefined, revision: undefined }));
  const out = updateGeneral(id, p => {
    if (options.request) p.messages.push(message('person', requestText(p)));
    p.run = newRun('first', p); p.run.queued = readSession(dir).queue.length;
  });
  void drive(id);
  return out;
}

/** POST stop: end Codex (and what it started); keep every file. */
export function stopRun(id: string): GeneralProject {
  const { project } = findGeneral(id);
  const run = project.run;
  if (!run || !['running', 'stopping', 'needs-network'].includes(run.state)) return project;
  const entry = live.get(id);
  if (entry) entry.stopRun = run.id;
  if (entry?.proc) {
    entry.proc.stop();
    return patchRun(id, r => { if (r.id === run.id) r.state = 'stopping'; });
  }
  return finishStopped(id, run.id);
}
function finishStopped(id: string, runId: string) {
  const result = patchRun(id, r => {
    if (r.id !== runId || !['running', 'stopping', 'needs-network'].includes(r.state)) return;
    r.state = 'stopped'; r.endedAt = now(); r.networkRequest = undefined;
    r.steps = r.steps.map(s => s.state === 'running' ? { ...s, state: 'waiting', detail: '已停止，可以接着做' } : s);
  });
  recordRunOutcome(id, runId);
  return result;
}

/** A local account change ends only this provider's OpenTake sessions; its files/checkpoints stay. */
export async function closeGeneralAgentSessions(agent: AgentConnectionId): Promise<void> {
  const sessions = scanGeneral().filter(({dir, project}) => project.run?.agent === agent || (!isLive(project.id) && readSession(dir).agent === agent));
  for (const {project} of sessions) if (project.run?.agent === agent) stopRun(project.id);
  const deadline = Date.now() + 15_000;
  while (sessions.some(({project}) => {
    const latest = findGeneral(project.id).project.run;
    return latest?.id === project.run?.id && latest?.agent === agent && isLive(project.id);
  })) {
    if (Date.now() >= deadline) throw Error('这家智能体的会话还没关闭，请等当前出片停止后重试');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  for (const {dir, project} of sessions) {
    const latest = findGeneral(project.id).project;
    // A different provider may have started while the old process was closing. Never touch its session.
    if (latest.run?.id !== project.run?.id || isLive(project.id)) continue;
    const current = readSession(dir);
    if ((current.agent || latest.run?.agent) !== agent) continue;
    editSession(dir, session => { session.threadId = undefined; session.resumed = !!session.pending; });
  }
}

function recordRunOutcome(id: string, expectedRunId?: string) {
  try {
    const run = findGeneral(id).project.run;
    if (run && run.id === expectedRunId && (run.state === 'done' || run.state === 'failed' || run.state === 'stopped')) {
      recordFilmOutcome(id, run.id, run.agent, run.state, run.endedAt || now());
    }
  } catch { /* Usage recording must not interrupt the person's film. */ }
}

/** POST resume: continue a stopped (or failed) run in the same Codex session. */
export function resumeRun(id: string, options: {handoff?:boolean} = {}): GeneralProject {
  const { dir, project } = findGeneral(id);
  const run = project.run;
  if (!run || !['stopped', 'failed'].includes(run.state)) throw Object.assign(new Error('没有可以接着做的运行'), { status: 409 });
  const session = readSession(dir);
  if (!session.pending) throw Object.assign(new Error('这次运行已经做完了'), { status: 409 });
  editSession(dir, s => {
    // Also recover old projects saved before structured page diagnostics existed.
    if (s.pending === 'review' && isHyperframesWork(path.join(dir, 'work')) &&
        (run.failure?.kind === 'generated-page' || /Maximum call stack size exceeded|too much recursion|生成页面执行失败/i.test(run.error || ''))) {
      s.pending = 'polish'; s.pageRepairAttempted = true;
      s.review = pageRepairPrompt(s.pageFailure, run.error);
    }
    s.resumed = (options.handoff || !!s.threadId || !!s.resumed) && ['plan', 'make', 'polish', 'revise'].includes(s.pending!);
  });
  const steps = run.steps.map(s => s.state === 'done' || s.state === 'skipped' ? s : { ...s, state: 'waiting' as const, detail: undefined, progress: undefined });
  const out = updateGeneral(id, p => { p.run = { ...newRun('resume', p, steps), queued: session.queue.length }; });
  void drive(id);
  return out;
}

/** 第二部分的后端入口：只有明确请求才能换家，保留素材、源码、检查点和旧调用记录。 */
const handoffs=new Set<string>();
export async function switchRunAgent(id:string,input:unknown):Promise<GeneralProject>{
 if(handoffs.has(id))throw Object.assign(Error('正在检查新的智能体，请稍候'),{status:409});
 const choice=parseAgent(input);if(!choice?.agent)throw Object.assign(Error('请选择要接着做的智能体'),{status:400});
 assertAgentExecutionAllowed(choice.agent);const target=filmAgentId(choice);
 const {dir,project}=findGeneral(id),run=project.run;
 if(!run||!['failed','stopped'].includes(run.state)||isLive(id))throw Object.assign(Error('请等出片停止后再切换智能体'),{status:409});
 if(!readSession(dir).pending)throw Object.assign(Error('没有尚未完成的出片步骤'),{status:409});
 if(target===run.agent)throw Object.assign(Error('请选择另一个已接通的智能体，原智能体可直接继续'),{status:400});
 handoffs.add(id);
 try{
  await runtime.resolveCodex(choice);
  const tools=await runtime.creationTools(choice);
  const latest=findGeneral(id).project;
  if(latest.run?.id!==run.id||latest.run.state!==run.state||isLive(id)||JSON.stringify(latest.agent)!==JSON.stringify(project.agent))throw Object.assign(Error('工程运行状态已改变，请重新检查'),{status:409});
  assertAgentExecutionAllowed(target);
  editSession(dir,s=>{s.threadId=undefined;s.agent=target;s.resumed=true;(s.handoffs??=[]).push({from:run.agent,to:target,previousRunId:run.id,at:now()});s.queue.push({id:crypto.randomUUID(),text:`已从 ${connectionDefinition(run.agent).name} 切换到 ${connectionDefinition(target).name}。请检查现有工程文件，从未完成步骤继续，保留已有内容。`});});
  updateGeneral(id,p=>{p.agent=choice;p.messages.push(message('system',`中途换了智能体：${connectionDefinition(run.agent).name} → ${connectionDefinition(target).name}，从当前进度接着做，已完成的计划、代码和画面保留。`));});
  if(tools)checkedTools.set(id,tools);else checkedTools.delete(id);
  return resumeRun(id,{handoff:true});
 }finally{handoffs.delete(id);}
}

/** A copied project may have saved versions without this machine's Codex session.
 * Recover only a missing/empty work directory. A nonempty incomplete work may
 * contain unsaved edits: never merge an old snapshot into it or start over.
 */
function ensureRevisionWork(dir: string, version: number) {
  const error = (detail: string) => Object.assign(new Error(`无法继续修改第 ${version} 版：${detail}。已保留工程和现有文件，没有重新生成。`), { status: 409 });
  if (!Number.isSafeInteger(version) || version < 1) throw error('版本号无效');
  const work = path.join(dir, 'work');
  const entry = (folder: string) => ['index.html', 'film.json', 'out.mp4'].some(name => {
    try { return fs.lstatSync(path.join(folder, name)).isFile(); } catch { return false; }
  });
  if (entry(work)) return;
  if (fs.existsSync(work) && (!fs.lstatSync(work).isDirectory() || fs.readdirSync(work).length))
    throw error('工作目录缺少片子入口，需先恢复工作文件');
  const snapshot = path.join(dir, 'versions', `v${version}`, 'work');
  if (!fs.existsSync(snapshot) || !entry(snapshot)) throw error('工作目录和该版本的源码快照均不可用');
  if (!fs.realpathSync(snapshot).startsWith(fs.realpathSync(dir) + path.sep)) throw error('版本快照不在工程内');
  const validate = (folder: string) => {
    for (const item of fs.readdirSync(folder, {withFileTypes: true})) {
      if (item.isDirectory()) validate(path.join(folder, item.name));
      else if (!item.isFile()) throw error('版本快照包含非普通文件，无法安全恢复');
    }
  };
  validate(snapshot);
  const staging = path.join(dir, `.revision-work-${crypto.randomUUID()}`);
  try {
    fs.cpSync(snapshot, staging, {recursive: true, errorOnExist: true, force: false});
    // Windows cannot rename onto an existing directory, even an empty one.
    // rmdir is deliberately non-recursive: concurrent/unsaved files must survive.
    let removedEmpty=false;
    if(standardEdition && fs.existsSync(work)){fs.rmdirSync(work);removedEmpty=true;}
    try{renameWithRetrySync(staging,work);}catch(error){if(removedEmpty&&!fs.existsSync(work))fs.mkdirSync(work);throw error;}
  } finally {
    if (fs.existsSync(staging)) removeWithRetrySync(staging, {recursive: true, force: true});
  }
}

/** POST messages: queued while a run works; otherwise the next version (or the first, if none exists yet). */
export function postMessage(id: string, body: { text?: unknown; reference?: unknown }): GeneralProject {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw Object.assign(new Error('消息不能为空'), { status: 400 });
  if (text.length > 4000) throw Object.assign(new Error('消息不能超过 4000 个字'), { status: 400 });
  const { dir, project } = findGeneral(id);
  const reference = parseReference(body.reference);
  const msg = message('person', text, reference ? { reference: { time: reference.time, rect: reference.rect } } : {});
  const image = reference?.imageDataUrl ? saveReferenceImage(dir, msg.id, reference.imageDataUrl) : undefined;
  const note = { id: msg.id, text, ...(reference ? { reference: { time: reference.time, rect: reference.rect, ...(image ? { image } : {}) } } : {}) };
  if (project.run && [...ACTIVE, 'needs-network'].includes(project.run.state)) {
    const s = editSession(dir, s => { s.queue.push(note); });
    return updateGeneral(id, p => { p.messages.push(msg); if (p.run) p.run.queued = s.queue.length; });
  }
  assertReady(project);
  const session = readSession(dir);
  const current = project.current ?? project.versions.at(-1)?.n;
  if (standardEdition ? current !== undefined : !!current) {
    ensureRevisionWork(dir, current!);
    editSession(dir, s => Object.assign(s, { pending: 'revise', resumed: false, reviewRounds: 0, polished: false, extraTurns: 0, review: undefined, pageFailure: undefined, pageRepairAttempted: false, networkAnswer: undefined, revision: { version: current, text, reference: note.reference } }));
    const out = updateGeneral(id, p => { p.messages.push(msg); p.run = { ...newRun('revision', p), queued: readSession(dir).queue.length }; });
    void drive(id);
    return out;
  }
  // nothing made yet: the words go with the stopped run when it continues, or with a new first cut
  editSession(dir, s => { s.queue.push(note); });
  updateGeneral(id, p => { p.messages.push(msg); });
  if (session.threadId && session.pending && project.run && ['stopped', 'failed'].includes(project.run.state)) return resumeRun(id);
  return startFirst(id);
}

/** POST network {allow}: answer the agent's request; the run continues either way. */
export function answerNetwork(id: string, allow: boolean): GeneralProject {
  const { dir, project } = findGeneral(id);
  const run = project.run;
  if (!run || run.state !== 'needs-network' || !run.networkRequest) throw Object.assign(new Error('现在没有联网请求'), { status: 409 });
  const hosts = run.networkRequest.hosts;
  editSession(dir, s => { s.networkAnswer = { allowed: allow, hosts }; s.resumed = true; if (allow) s.networkAllowed = true; });
  const out = updateGeneral(id, p => {
    // allowing the request turns the project's 联网 switch on (it shows there, and can be turned off again)
    if (allow) p.network = true;
    if (!p.run) return;
    p.run.state = 'running'; p.run.networkRequest = undefined;
    p.messages.push(message('system', allow ? `已允许联网：${hosts.join('、')}` : '没有允许联网，Agent 会改用离线办法'));
  });
  void drive(id);
  return out;
}

function parseReference(value: unknown): GeneralReference | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>, rect = (r.rect || {}) as Record<string, unknown>;
  const n = (x: unknown) => typeof x === 'number' && Number.isFinite(x) ? x : NaN;
  const out = { time: n(r.time), rect: { x: n(rect.x), y: n(rect.y), w: n(rect.w), h: n(rect.h) } };
  if ([out.time, out.rect.x, out.rect.y, out.rect.w, out.rect.h].some(Number.isNaN)) throw Object.assign(new Error('框选引用格式不对'), { status: 400 });
  return { ...out, ...(typeof r.imageDataUrl === 'string' ? { imageDataUrl: r.imageDataUrl } : {}) };
}
function saveReferenceImage(dir: string, id: string, dataUrl: string) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw Object.assign(new Error('框选截图格式不对'), { status: 400 });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw Object.assign(new Error('框选截图太大'), { status: 413 });
  const file = path.join(dir, 'agent', 'refs', `${id}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

// ——— the loop ———
type TurnOutcome = 'ok' | 'stopped' | 'network';
async function drive(id: string) {
  let entry = live.get(id);
  if (!entry) { entry = { driving: false }; live.set(id, entry); }
  if (entry.driving) { entry.again = true; return; }
  entry.driving = true;
  let runId: string | undefined;
  try {
    for (;;) {
      const { dir, project } = findGeneral(id);
      if (!project.run || project.run.state !== 'running') return;
      runId = project.run.id;
      if (entry.stopRun === runId) { finishStopped(id, runId); return; }
      const session = readSession(dir);
      const step = session.pending;
      if (!step) { patchRun(id, r => { r.state = 'done'; r.endedAt = now(); }); return; }
      if (step === 'review') {
        if (session.queue.length && session.extraTurns < 2) { editSession(dir, s => { s.pending = 'polish'; s.extraTurns++; s.review = undefined; }); continue; }
        let verdict: Verdict | undefined;
        try { verdict = await review(id, dir, runId); }
        catch (error) {
          if (!(error instanceof PageExecutionError) || entry.stopRun === runId || session.pageRepairAttempted) throw error;
          preservePageFailure(dir, runId, error);
          editSession(dir, s => { s.pending = 'polish'; s.pageFailure = error.diagnostic; s.pageRepairAttempted = true; s.review = pageRepairPrompt(error.diagnostic); });
          updateGeneral(id, p => { p.messages.push(message('system', `${error.message}。正在让 Agent 修复已有页面后重试，工程内容已保留。`)); });
          continue;
        }
        if (entry.stopRun === runId) { finishStopped(id, runId); return; }
        const s = readSession(dir);
        // one more round only when the cut failed; no forced polish, to avoid unnecessary time and model usage
        if (verdict && !verdict.pass && !s.polished) editSession(dir, x => Object.assign(x, { pending: 'polish', polished: true, review: verdictText(verdict) }));
        else editSession(dir, x => { x.pending = 'deliver'; });
        continue;
      }
      if (step === 'deliver') {
        await deliver(id, dir);
        recordRunOutcome(id, runId);
        const left = readSession(dir).queue;
        if (left.length) {
          // words that arrived after the last turn: they become the next version
          const text = left.map(n => n.text).join('\n');
          const current = findGeneral(id).project.current!;
          editSession(dir, s => Object.assign(s, { queue: [], filmMessage: undefined, pending: 'revise', resumed: false, reviewRounds: 0, polished: false, extraTurns: 0, review: undefined, pageFailure: undefined, pageRepairAttempted: false, revision: { version: current, text, reference: left.find(n => n.reference)?.reference } }));
          updateGeneral(id, p => { p.run = newRun('revision', p); });
          continue;
        }
        editSession(dir, s => { s.pending = undefined; s.filmMessage = undefined; });
        return;
      }
      if (session.turns.filter(t => t.runId === runId).length >= runtime.maxTurns) throw new Error('这次运行的轮数太多，已停下，请检查后再接着做');
      const outcome = await turn(id, dir, step, runId);
      if (outcome === 'stopped') { finishStopped(id, runId); return; }
      if (outcome !== 'ok') return;
      afterTurn(id, dir, step);
    }
  } catch (error) {
    error = macVideoEncodingError(error);
    const text = error instanceof Error ? error.message : String(error);
    const failure=classifyAgentFailure(error);
    try {
      if (error instanceof PageExecutionError) { preservePageFailure(findGeneral(id).dir, runId!, error); editSession(findGeneral(id).dir, s => { s.pageFailure = error.diagnostic; s.pending = 'review'; }); }
      patchRun(id, r => {
        if (r.id !== runId || !['running', 'stopping'].includes(r.state)) return;
        r.state = 'failed'; r.endedAt = now(); r.error = text; r.errorKind = failure.kind;
        if (error instanceof PageExecutionError) {
          const {kind, operation, file, line, column, frame} = error.diagnostic;
          r.failure = {kind, operation, file, line, column, frame, ...(error.diagnosticFile ? {diagnosticFile: path.relative(findGeneral(id).dir, error.diagnosticFile).split(path.sep).join('/')} : {})};
        }
        r.steps = r.steps.map(s => s.state === 'running' ? { ...s, state: 'failed', detail: text.slice(0, 200) } : s);
      });
    } catch { /* the project itself is gone */ }
  } finally {
    recordRunOutcome(id, runId);
    entry.driving = false;
    if (entry.again) { entry.again = false; void drive(id); }
    else if (live.get(id) === entry && !entry.proc) { live.delete(id); checkedTools.delete(id); }
  }
}

function preservePageFailure(dir: string, runId: string, error: PageExecutionError) {
  if (error.diagnosticFile) return;
  try {
    const file = path.join(dir, 'agent', 'diagnostics', `page-execution-${runId}-${crypto.randomUUID()}.json`);
    atomicJsonSync(file, {version: 1, at: now(), ...error.diagnostic}); error.diagnosticFile = file;
  } catch { /* State transition must still report the original failure if diagnostic I/O fails. */ }
}

function pageRepairPrompt(failure?: PageExecutionDiagnostic, legacyError?: string) {
  return ['生成页面执行失败；这是已有网页代码的问题，先修复源码，不要直接重渲染同一份文件，也不要重建工程。',
    failure ? `${failure.file}，${failure.operation}：${failure.message}\n${failure.stack}\n堆栈中的 HTML 行号包含注入的运行时，请按函数名核对原始源码，不要直接套用行号。` : legacyError || '',
    /Maximum call stack|too much recursion|\bseek\b/i.test(failure?.stack || legacyError || '') ? '普通 script 的全局 function seek 与 window.seek 是同一绑定；包装 window.seek 时不得再通过同名全局 seek 调用自身。内部函数用 renderFilmAt 等独立名称或放入闭包。' : '只修复报告的代码错误，不改无关页面。',
    '保留对外接口、现有素材、文案与 data-hf-id。',
    '修改后先 hfx check、hfx look，检查开头、中间、结尾时间跳转及样张；通过后再结束这一轮，由 OpenTake 重新渲染。'].join('\n\n');
}

function afterTurn(id: string, dir: string, phase: Phase) {
  const work = path.join(dir, 'work');
  // software the agent fetched (installers, programs, packages, code libraries) goes aside, 联网 or not
  const blocked = quarantineSoftware(work, path.join(dir, 'agent', 'blocked', now().replace(/[:.]/g, '-')));
  if (blocked.length) updateGeneral(id, p => { p.messages.push(message('system', `出片时不能下载软件、插件、代码：已把 ${blocked.slice(0, 5).join('、')}${blocked.length > 5 ? ` 等 ${blocked.length} 项` : ''} 移到工程的 agent/blocked 文件夹（没有删除）。`)); });
  // the agent hands over a HyperFrames project (index.html); OpenTake renders it. Older films still bring out.mp4.
  if (phase !== 'plan' && !isHyperframesWork(work) && !fs.existsSync(path.join(work, 'out.mp4'))) {
    editSession(dir, s => { s.resumed = true; });
    throw new Error('Agent 这一轮结束了，但没有交出片子（index.html）。可以接着做，让它补完。');
  }
  const plan = readPlan(id, work);
  const session = readSession(dir);
  updateGeneral(id, p => {
    if (plan) { p.plan = plan; if (session.autoName && plan.title) p.name = plan.title.slice(0, 80); }
    if (phase === 'plan' && session.lastAgentMessage) p.messages.push(message('agent', session.lastAgentMessage));
    if (p.run) {
      if (phase === 'plan') p.run.steps = p.run.steps.map(s => ['read-style', 'read-input', 'plan'].includes(s.id) && s.state !== 'skipped' ? { ...s, state: 'done', startedAt: s.startedAt ?? now(), endedAt: s.endedAt ?? now() } : s);
      else p.run.steps = verifySelfCheck(finishAgentSteps(p.run.steps, now()), hasSelfCheckSheet(dir), now());
    }
  });
  editSession(dir, s => {
    if (phase !== 'plan' && s.lastAgentMessage) s.filmMessage = s.lastAgentMessage;
    s.lastAgentMessage = undefined; s.resumed = false; s.networkAnswer = undefined; s.pending = phase === 'plan' ? 'make' : 'review'; if (phase !== 'plan') s.review = undefined;
  });
}

function readPlan(id: string, work: string): GeneralProject['plan'] | undefined {
  try {
    // plan.json is optional: film.json carries the title, logline and segments too
    const file = ['plan.json', 'film.json'].map(f => path.join(work, f)).find(f => fs.existsSync(f));
    if (!file) return undefined;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const segments = Array.isArray(raw.segments) ? (raw.segments as Record<string, unknown>[]).map(s => ({ name: String(s.name || ''), start: Number(s.start), end: Number(s.end) })).filter(s => s.name && s.end > s.start) : [];
    const treatment = path.join(work, 'TREATMENT.md');
    return {
      title: String(raw.title || '').trim(), logline: String(raw.logline || '').trim(),
      duration: Number(raw.duration) || (segments.at(-1)?.end ?? 0), segments,
      ...(fs.existsSync(treatment) ? { markdownUrl: fileUrl(id, 'work/TREATMENT.md', Math.round(fs.statSync(treatment).mtimeMs)) } : {}),
    };
  } catch { return undefined; }
}

/** One Codex turn: prompt, live steps from events and progress.json, the final message. */
async function turn(id: string, dir: string, phase: Phase, runId: string, recoveredMissingThread = false, busyRetry?: ResolvedFilmAgent): Promise<TurnOutcome> {
  const entry = live.get(id)!;
  const stopped = () => entry.stopRun === runId;
  const { project } = findGeneral(id);
  const codex = busyRetry ? { ...busyRetry } : await runtime.resolveCodex(project.agent);
  const agentId=filmAgentId(codex);
  assertAgentExecutionAllowed(agentId);
  if (stopped()) return 'stopped';
  const style = runtime.style(project.styleId)!;
  const work = path.join(dir, 'work');
  const session = readSession(dir);
  if(session.threadId && (session.agent || 'codex')!==agentId) { session.threadId=undefined; editSession(dir,s=>{s.threadId=undefined;s.resumed=false;}); }
  editSession(dir,s=>{s.agent=agentId;});
  const queued = session.queue;
  // the steps this turn will move through start again (a polish round re-does code → render)
  updateGeneral(id, p => {
    if (!p.run) return;
    p.run.agent=agentId; p.run.method=codex.method||'cli'; p.run.transport=codex.transport; p.run.model = codex.model; p.run.effort = codex.effort; p.run.queued = 0;
    if(codex.requested) {
      const text=`原模型 ${codex.requested.model} 不可用，已改用 ${connectionDefinition(agentId).name} 默认模型 ${codex.model}。`;
      if(!p.messages.some(m=>m.role==='system'&&m.text===text))p.messages.push(message('system',text));
    }
    if (phase === 'polish' && session.review) beginRepair(p.run, session.review, now());
    else if (phase === 'polish' || phase === 'revise') p.run.steps = p.run.steps.map(s => ['code', 'self-check', 'render', 'review', 'deliver'].includes(s.id) && s.state !== 'skipped' ? { ...s, state: 'waiting', progress: undefined, startedAt: undefined, endedAt: undefined } : s);
  });
  // 联网: the project's switch; projects from before it follow the agent's request answered in this session
  const network = project.network ?? session.networkAllowed;
  const tools = checkedTools.get(id) ?? await runtime.creationTools(project.agent);
  if (stopped()) return 'stopped';
  if(tools) { checkedTools.set(id,tools); if(agentId==='codex' && tools.codex) codex.executable=tools.codex; }
  const env = prepareWork(dir, {...runtime.baseEnv(),...codex.env}, network, tools);
  const promptKit=codex.transport==='acp'?prepareAcpGuide(dir,style.id):KIT_DIR;
  if(codex.transport==='acp')env.CW_KIT=promptKit;
  editSession(dir, s => { s.queue = []; });
  let brief: string | undefined;
  if (!session.threadId || codex.transport==='acp') {
    const media = project.inputs.media.map(m => ({ ...m, file: mediaFile(dir, m.id) })).filter(m => m.file) as (GeneralProject['inputs']['media'][number] & { file: string })[];
    brief = buildBrief(project, style, promptKit, await Promise.all(media.map(async m => ({ ...m, fps: await measuredFps(m.file) }))));
    fs.writeFileSync(path.join(work, 'BRIEF.md'), brief);
  }
  let prompt = turnPrompt({
    phase, kit: promptKit, styleId: style.id, brief, resumed: session.resumed || (codex.transport==='acp' && session.turns.length>0), review: phase === 'polish' ? session.review : undefined,
    revision: phase === 'revise' ? session.revision : undefined, queued, network: session.networkAnswer, networkOn: network,
    personEdits: phase === 'revise' ? personEditsOf(dir, session.revision?.version) : undefined,
  });
  if(codex.transport==='acp')prompt+='\n\n工具命令请使用当前目录的相对路径或工程内绝对路径；不要用 shell 变量展开或内联求值。需要代码时先写入工程文件再执行。只能读写本工程，不要访问外部目录。';
  const images = [...queued.map(n => n.reference?.image), phase === 'revise' ? session.revision?.reference?.image : undefined].filter((f): f is string => !!f && fs.existsSync(f));
  const lastFile = path.join(dir, 'agent', `last-${runId}-${session.turns.length + 1}.txt`);
  // Keep the original requested model (including default), never reinterpret an ACP-reported
  // default as an explicit set_model request that may alter the provider's own configuration.
  const retryAgent = { ...codex };
  const args = filmAgentArgs(codex,{ ...codex, work, lastMessage: lastFile, network, resumeThread: session.threadId, images });
  const startedAt = now();
  const record = editSession(dir, s => { s.turns.push({ runId, phase, startedAt, threadId: s.threadId }); }).turns.length - 1;
  const agentRecord = agentRunRecord(codex, startedAt, id);
  removeWithRetrySync(path.join(work, 'network-request.json'), { force: true });

  let steps = findGeneral(id).project.run!.steps;
  let usage: Usage | undefined, failure: string | undefined, dirty = false;
  const flush = () => { if (!dirty) return; dirty = false; patchRun(id, r => { r.steps = steps; }); };
  const proc = startFilmAgent(codex, args, {
    cwd: work, projectRoot:dir, env, prompt, lastMessage:lastFile,images, eventLog: path.join(dir, 'agent', `events-${runId}.jsonl`),
    onEvent: event => {
      if(event.type==='acp.model'&&typeof event.model==='string'){
        codex.model=event.model;agentRecord.model=event.model;agentRecord.modelSelection=event.modelSelection==='selected'?'selected':'default';
        patchRun(id,r=>{r.model=String(event.model);r.modelSelection=event.modelSelection==='selected'?'selected':'default';});
        persistAgentRun(agentRecord);
      }
      if(event.type==='acp.error'){agentRecord.errorKind=String(event.kind||'other');agentRecord.errorExcerpt=String(event.excerpt||'').slice(0,240);}
      const out = applyFilmAgentEvent(agentId,steps,event,now());
      if (out.threadId) editSession(dir, s => { s.threadId = out.threadId; s.turns[record].threadId = out.threadId; });
      if (out.usage) usage = out.usage;
      if (out.error) failure = out.error;
      if (out.steps !== steps) { steps = out.steps; dirty = true; flush(); }
    },
  });
  entry.proc = proc;
  // progress.json (the agent's `film progress`, and `film render` itself)
  // what the previous turn left in progress.json is not news for this one
  let seen = (() => { try { return fs.readFileSync(path.join(work, 'progress.json'), 'utf8'); } catch { return ''; } })();
  const toUrl = (rel: string) => { const file = path.resolve(work, rel); if (!file.startsWith(work + path.sep) || !fs.existsSync(file)) return undefined; return fileUrl(id, path.relative(dir, file), Math.round(fs.statSync(file).mtimeMs)); };
  const poll = () => {
    try {
      const text = fs.readFileSync(path.join(work, 'progress.json'), 'utf8');
      if (text === seen) return;
      seen = text;
      const next = applyProgress(steps, JSON.parse(text) as Progress, now(), toUrl);
      if (next !== steps) { steps = next; dirty = true; flush(); }
    } catch { /* not written yet, or half written */ }
  };
  const timer = setInterval(poll, 1500);
  const result = await proc.done;
  clearInterval(timer);
  poll();
  entry.proc = undefined;
  const last = fs.existsSync(lastFile) ? fs.readFileSync(lastFile, 'utf8').trim() : '';
  editSession(dir, s => { Object.assign(s.turns[record], { endedAt: now(), code: result.code, usage, ...(failure ? { error: failure } : {}) }); s.lastAgentMessage = last || undefined; });
  const rawAgentError=`${failure||''} ${result.stderr}`;
  if(usage)agentRecord.usage=usage;
  if((result.code!==0||failure)&&!stopped()){
    const detail=classifyAgentFailure(failure||result.stderr);
    agentRecord.errorKind??=detail.kind;agentRecord.errorExcerpt??=detail.excerpt;
    failure=detail.kind!=='other'?detail.message:redactAcpText(failure||stderrTail(result.stderr)||detail.message).slice(0,240);
  }
  finishAgentRecord(agentRecord, stopped() ? 'failed' : result.code === 0 && !failure ? 'completed' : 'failed', stopped() ? '已停止' : failure || (result.code !== 0 ? stderrTail(result.stderr) : undefined));

  if(agentId==='codex') recordCodexUsage();
  if (stopped()) { if (queued.length) editSession(dir, s => { s.queue = [...queued, ...s.queue]; }); return 'stopped'; }
  if (agentId==='codex' && (result.code !== 0 || failure) && session.threadId && !recoveredMissingThread
      && missingCodexRollout(rawAgentError)) {
    // A portable project keeps its media and work, but a Codex rollout is local
    // to its original computer. Retry once with a fresh brief, not a fresh project.
    editSession(dir, s => { s.threadId = undefined; s.resumed = true; s.queue = [...queued, ...s.queue]; });
    updateGeneral(id, p => { p.messages.push(message('system', '原来的 Codex 会话在本机不存在，已保留工程内容并用新会话继续。')); });
    return turn(id, dir, phase, runId, true, busyRetry);
  }
  if ((result.code !== 0 || failure) && agentRecord.errorKind === 'busy' && !busyRetry) {
    // The failed attempt remains recorded. Keep files, queued instructions and provider/model;
    // cancel/disable while waiting must never start another process.
    editSession(dir, s => { s.resumed = true; s.queue = [...queued, ...s.queue]; });
    updateGeneral(id, p => { p.messages.push(message('system', '这个模型现在繁忙，稍等几秒后自动重试一次。')); });
    const until = Date.now() + Math.max(0, runtime.busyRetryDelayMs);
    while (Date.now() < until) {
      if (stopped()) return 'stopped';
      assertAgentExecutionAllowed(agentId);
      await new Promise(resolve => setTimeout(resolve, Math.min(100, until - Date.now())));
    }
    if (stopped()) return 'stopped';
    assertAgentExecutionAllowed(agentId);
    return turn(id, dir, phase, runId, recoveredMissingThread, retryAgent);
  }
  if (result.code !== 0 || failure) {
    const error=agentRecord.errorKind==='no-response'?failure:`${connectionDefinition(agentId).name} 这一轮没有完成：${failure || stderrTail(result.stderr) || `退出码 ${result.code}`}`;
    throw Object.assign(new Error(error),{kind:agentRecord.errorKind});
  }
  const request = readNetworkRequest(work, dir);
  if (request) {
    editSession(dir, s => { s.resumed = true; s.lastAgentMessage = undefined; });
    updateGeneral(id, p => {
      if (last) p.messages.push(message('agent', last));
      if (p.run) { p.run.state = 'needs-network'; p.run.networkRequest = request; p.run.queued = readSession(dir).queue.length; }
    });
    return 'network';
  }
  return 'ok';
}
function hasSelfCheckSheet(dir: string) {
  try { const stat = fs.statSync(path.join(dir,'work','look','sheet.jpg')); return stat.isFile() && stat.size > 0; } catch { return false; }
}
export function missingCodexRollout(error: string) {
  return /thread\/resume[\s\S]*no rollout found for thread id/i.test(error);
}
const stderrTail = (stderr: string) => stderr.trim().split('\n').filter(l => !/^\s*$/.test(l)).slice(-3).join(' ').slice(0, 400);

function readNetworkRequest(work: string, dir: string): GeneralRun['networkRequest'] | undefined {
  const file = path.join(work, 'network-request.json');
  if (!fs.existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const hosts = (Array.isArray(raw.hosts) ? raw.hosts : []).map(String).filter(h => /^[a-z0-9.-]+(:\d+)?$/i.test(h)).slice(0, 12);
    const reason = String(raw.reason || '').trim().slice(0, 500);
    renameWithRetrySync(file, path.join(dir, 'agent', `network-request-${Date.now()}.json`));
    return reason && hosts.length ? { reason, hosts } : undefined;
  } catch { return undefined; }
}

async function review(id: string, dir: string, runId: string): Promise<Verdict | undefined> {
  const entry = live.get(id)!;
  const stopped = () => entry.stopRun === runId;
  const session = editSession(dir, s => { s.reviewRounds++; });
  const round = session.reviewRounds;
  const { project } = findGeneral(id);
  const style = runtime.style(project.styleId)!;
  const n = (project.versions.at(-1)?.n ?? 0) + 1;
  const reviewDir = path.join(dir, 'review', `v${n}-r${round}`);
  patchRun(id, r => { r.steps = verifySelfCheck(r.steps, hasSelfCheckSheet(dir), now()); });

  const video = path.join(dir, 'work', 'out.mp4');
  if (isHyperframesWork(path.join(dir, 'work'))) {
    // export B: OpenTake's own frame renderer draws the HyperFrames page, then mixes the sound
    patchRun(id, r => { r.steps = setStep(r.steps, 'render', { state: 'running', startedAt: now(), endedAt: undefined, detail: '逐帧渲染', progress: undefined }); });
    removeWithRetrySync(video, { force: true });
    let last = 0;
    await runtime.render(path.join(dir, 'work'), video, { browserExecutable:checkedTools.get(id)?.chromium, diagnosticFile: path.join(dir, 'agent', 'diagnostics', `page-execution-${runId}-${round}.json`), onActivity: detail => { patchRun(id, r => { r.steps = setStep(r.steps, 'render', { detail }); }); }, onProgress: p => { const pct = Math.round(p * 100); if (pct - last >= 5) { last = pct; patchRun(id, r => { r.steps = setStep(r.steps, 'render', { progress: { done: pct, total: 100 } }); }); } } });
    patchRun(id, r => { r.steps = setStep(r.steps, 'render', { state: 'done', endedAt: now(), detail: '渲染成片', progress: { done: 100, total: 100 } }); });
  }
  patchRun(id, r => { r.steps = setStep(r.steps, 'review', { state: 'running', startedAt: now(), endedAt: undefined, detail: round > 1 ? '复审改过的版本' : '抽帧、机检' }); });
  const frames = await extractFrames(ffmpegPath(), ffprobePath(), video, reviewDir, runtime.agentReview ? 20 : 12); // denser than one a second for short films, so rhythm and repetition show
  patchRun(id, r => { r.steps = setStep(r.steps, 'review', { detail: '正在检查时长、画幅和声音' }); });
  const checks = await machineChecks(ffmpegPath(), ffprobePath(), video, project.settings);
  fs.writeFileSync(path.join(reviewDir, 'checks.json'), JSON.stringify(checks, null, 2));
  if (fs.existsSync(`${video}.audio.json`)) fs.copyFileSync(`${video}.audio.json`, path.join(reviewDir, 'audio.json'));
  const thumbs = frames.frames.map(f => fileUrl(id, path.relative(dir, f.file)));
  patchRun(id, r => { r.steps = setStep(r.steps, 'review', { thumbs, detail: `看图审片（${checks.filter(c => !c.ok).length ? `机检有 ${checks.filter(c => !c.ok).length} 项不合格` : '机检通过'}）` }); });
  let verdict: Verdict | undefined, problem: string | undefined;
  if (!runtime.agentReview || filmAgentId(project.agent ?? readAgentSettings().modules.generalEditing)!=='codex') {
    const failed = checks.filter(c => !c.ok);
    verdict = { pass: !failed.length, summary: failed.length ? '成片没过机检' : '机检通过', issues: failed.map(c => ({ time: null, problem: c.text, fix: '' })) };
    patchRun(id, r => { r.steps = setStep(r.steps, 'review', { state: 'done', endedAt: now(), detail: verdict!.pass ? '机检通过' : `机检要改：${failed.map(c => c.text).join('；')}`.slice(0, 600) }); });
    return verdict;
  }
  try {
    const codex = await runtime.resolveCodex(project.agent);
    if (stopped()) throw new Error('已停止');
    const schema = path.join(dir, 'agent', 'review-schema.json');
    fs.writeFileSync(schema, JSON.stringify(REVIEW_SCHEMA));
    const lastFile = path.join(reviewDir, 'verdict.txt');
    const pick = frames.frames.filter((_, i) => i % 3 === 1).map(f => f.file); // seven large frames beside the sheet
    const reviewArgv = reviewArgs({ ...codex, dir: reviewDir, lastMessage: lastFile, schema, images: [frames.sheet, ...pick] });
    if(codex.method==='api'&&codex.model==='default'){const at=reviewArgv.indexOf('-m');if(at>=0)reviewArgv.splice(at,2);}
    const args=codex.args?.length?[reviewArgv[0],...codex.args,...reviewArgv.slice(1)]:reviewArgv;
    const prompt = reviewPrompt({ styleId: style.id, styleName: style.name_zh, kit: KIT_DIR, project, frames, checks, round });
    const record = agentRunRecord(codex, now());
    let usage: Usage | undefined;
    const proc = startFilmAgent(codex, args, { cwd: reviewDir, env: {...runtime.baseEnv(),...codex.env}, redact:filmAgentRedactor(codex.env||{}), prompt, eventLog: path.join(reviewDir, 'events.jsonl'), onEvent: e => { const o = applyCodexEvent([], e, now()); if (o.usage) usage = o.usage; } });
    entry.proc = proc;
    const result = await proc.done;
    entry.proc = undefined;
    finishAgentRecord(record, result.code === 0 ? 'completed' : 'failed', result.code === 0 ? undefined : stderrTail(result.stderr));

    recordCodexUsage();
    editSession(dir, s => { s.turns.push({ runId: project.run!.id, phase: `review-${round}`, startedAt: record.startedAt, endedAt: now(), code: result.code, usage }); });
    if (stopped()) throw new Error('已停止');
    if (result.code !== 0) throw new Error(stderrTail(result.stderr) || `退出码 ${result.code}`);
    verdict = parseVerdict(fs.readFileSync(lastFile, 'utf8'));
    fs.writeFileSync(path.join(reviewDir, 'verdict.json'), JSON.stringify({ verdict, checks }, null, 2));
  } catch (error) { problem = error instanceof Error ? error.message : String(error); }
  if (stopped()) { editSession(dir, s => { s.reviewRounds = Math.max(0, s.reviewRounds - 1); }); return undefined; }
  const failedChecks = checks.filter(c => !c.ok).map(c => c.text);
  patchRun(id, r => {
    r.steps = setStep(r.steps, 'review', verdict
      ? { state: 'done', endedAt: now(), detail: `${round > 1 ? '复审' : '审片'}${verdict.pass ? '通过' : '要改'}：${verdictText(verdict)}`.slice(0, 1200) }
      : { state: 'failed', endedAt: now(), detail: `看图审片没有完成（${problem}）。${failedChecks.length ? `机检：${failedChecks.join('；')}` : '机检通过'}，先交付这一版`.slice(0, 600) });
  });
  return verdict;
}

/** The person's edits of the version being revised, as lines for the agent (they stay; it should know the film as shown). */
function personEditsOf(dir: string, version: number | undefined) {
  if (!version) return undefined;
  try {
    const folder = path.join(dir, 'versions', `v${version}`);
    const layers = JSON.parse(fs.readFileSync(path.join(folder, 'edited.json'), 'utf8')) as GeneralLayers;
    if (layers.engine !== 'hyperframes') return undefined;
    // words and moves, then the timeline: where clips sit, how long, how loud (S先生 10-31: 时间线解锁)
    const original = JSON.parse(fs.readFileSync(path.join(folder, 'layers.json'), 'utf8')) as GeneralLayers;
    return [...describeEdits(path.join(folder, 'work'), layers), ...describeTimeline(layers, original)];
  } catch { return undefined; }
}

/**
 * The person's edits of the revised version, carried onto version n (versions/vN/edited.json). Returns a line for the
 * conversation when there were any.
 */
function carryPersonEdits(dir: string, from: number | undefined, n: number) {
  if (!from) return undefined;
  const read = (v: number, file: string) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'versions', `v${v}`, file), 'utf8')) as GeneralLayers; } catch { return undefined; } };
  const before = read(from, 'edited.json'), after = read(n, 'layers.json');
  if (before?.engine !== 'hyperframes' || after?.engine !== 'hyperframes') return undefined;
  const words = carryEdits({ work: path.join(dir, 'versions', `v${from}`, 'work'), layers: before }, { work: path.join(dir, 'versions', `v${n}`, 'work'), layers: after });
  // the timeline edits go along too: clips the agent did not retime keep the person's timing and sound
  const next = words.layers ?? structuredClone(after), original = read(from, 'layers.json');
  const timing = original ? carryTimeline(before, original, next) : { kept: 0, dropped: [] as string[] };
  const result = { kept: words.kept + timing.kept, dropped: [...words.dropped, ...timing.dropped] };
  if (!result.kept && !result.dropped.length) return undefined;
  if (result.kept) fs.writeFileSync(path.join(dir, 'versions', `v${n}`, 'edited.json'), JSON.stringify(next, null, 1));
  const kept = result.kept ? `你在第 ${from} 版里手动改的 ${result.kept} 处已经带到第 ${n} 版。` : '';
  const dropped = result.dropped.length ? `这次 Codex 改掉了：${result.dropped.slice(0, 6).join('、')}${result.dropped.length > 6 ? ` 等 ${result.dropped.length} 处` : ''}。` : '';
  return kept + dropped;
}

async function deliver(id: string, dir: string) {
  patchRun(id, r => { r.steps = setStep(r.steps, 'deliver', { state: 'running', startedAt: now(), detail: '存成新版本' }); });
  const work = path.join(dir, 'work');
  const { project } = findGeneral(id);
  const n = (project.versions.reduce((m, v) => Math.max(m, v.n), 0)) + 1;
  const video = path.join(dir, 'versions', `v${n}.mp4`), poster = path.join(dir, 'versions', `v${n}.jpg`);
  fs.mkdirSync(path.dirname(video), { recursive: true });
  await deliverVideo(path.join(work, 'out.mp4'), video);
  const duration = await durationOf(video);
  if (fs.existsSync(path.join(work, 'poster.jpg'))) fs.copyFileSync(path.join(work, 'poster.jpg'), poster);
  else await exec(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(duration / 3), '-i', video, '-frames:v', '1', '-q:v', '2', poster]);
  const hfSegments = isHyperframesWork(work) ? (await hyperframesToLayers(work, '', project.inputs.media)).segments.map(s => ({ id: s.id, name: s.name, start: s.start, end: Math.min(duration, s.end) })) : undefined;
  const segments = filmSegments(work, duration) ?? hfSegments ?? project.plan?.segments ?? [{ name: project.plan?.title || '全片', start: 0, end: duration }];
  const note = readSession(dir).filmMessage;
  // a HyperFrames film: every element gets its id (kept in work/ for the next turns), so edits can find it
  if (isHyperframesWork(work)) stampHfWork(work);
  // a layered film keeps its tracks: a snapshot of work/ and layers.json, which the page edits
  const layers = await snapshotLayers(dir, n, project.inputs.media, video);
  const carried = layers ? carryPersonEdits(dir, readSession(dir).revision?.version, n) : undefined;
  updateGeneral(id, (p, d) => {
    const stamp = Math.round(fs.statSync(video).mtimeMs);
    p.versions.push({ n, createdAt: now(), duration, videoUrl: fileUrl(id, path.relative(d, video), stamp), posterUrl: fileUrl(id, path.relative(d, poster), stamp), segments, ...(note ? { note: note.slice(0, 600) } : {}), ...(layers ? { layersUrl: fileUrl(id, layers, stamp) } : {})});
    p.current = n;
    p.messages.push(message('agent', note || `第 ${n} 版做好了。`, { version: n }));
    if (carried) p.messages.push(message('system', carried, { version: n }));
    if (p.run) { p.run.state = 'done'; p.run.endedAt = now(); p.run.steps = setStep(p.run.steps.map(s => s.state === 'waiting' ? { ...s, state: 'skipped', detail: '未单独执行' } : s.state === 'running' && s.id !== 'deliver' ? { ...s, state: 'done', endedAt: now() } : s), 'deliver', { state: 'done', endedAt: now(), detail: `第 ${n} 版` }); }
  });
}

/**
 * The agent's sandbox has no VideoToolbox, so the kit may hand over VP9 in MP4. Versions are H.264 for every player
 * and editor: re-encode here, outside the sandbox, with the shared hardware encoder; H.264 is copied as it is.
 */
export async function deliverVideo(src: string, dest: string) {
  const { stdout } = await exec(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,r_frame_rate', '-of', 'json', src]);
  const stream = (JSON.parse(stdout) as { streams?: { codec_name?: string; r_frame_rate?: string }[] }).streams?.[0];
  if (!stream || stream.codec_name === 'h264') { fs.copyFileSync(src, dest); return; }
  const [num, den] = String(stream.r_frame_rate || '30/1').split('/').map(Number);
  const tmp = `${dest}.${process.pid}.tmp.mp4`;
  await exec(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a?', ...h264Encode({ fps: num / (den || 1), quality: 70 }), '-c:a', 'copy', '-movflags', '+faststart', tmp]);
  renameWithRetrySync(tmp, dest);
}

/** Segments from film.json: each shot's name and time, transitions overlapping the previous shot. */
export function filmSegments(work: string, duration: number): GeneralSegment[] | undefined {
  try {
    const film = JSON.parse(fs.readFileSync(path.join(work, 'film.json'), 'utf8')) as { shots?: { name?: string; dur?: number; transition?: { dur?: number } }[]; segments?: GeneralSegment[] };
    if (Array.isArray(film.segments) && film.segments.length) return film.segments.map(s => ({ name: String(s.name), start: Number(s.start), end: Math.min(duration, Number(s.end)), ...(s.id ? { id: String(s.id) } : {}), ...(s.transition ? { transition: s.transition } : {}) }));
    let end = 0;
    const out = (film.shots || []).map((shot, i) => {
      const start = i === 0 ? 0 : Math.max(0, end - Number(shot.transition?.dur || 0));
      end = start + Number(shot.dur || 0);
      return { name: String(shot.name || `第 ${i + 1} 段`), start: Math.round(start * 1000) / 1000, end: Math.round(Math.min(end, duration) * 1000) / 1000 };
    }).filter(s => s.end > s.start);
    return out.length ? out : undefined;
  } catch { return undefined; }
}

async function durationOf(file: string) {
  const { stdout } = await exec(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Math.round(Number(stdout.trim()) * 1000) / 1000;
}
async function measuredFps(file: string) {
  try {
    const { stdout } = await exec(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+20', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file], { maxBuffer: 8 << 20 });
    const ts = stdout.split('\n').map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    return ts.length > 2 ? ((ts.length - 1) / (ts.at(-1)! - ts[0])).toFixed(2) : undefined;
  } catch { return undefined; }
}
export function mediaFile(dir: string, mediaId: string): string | undefined {
  const folder = path.join(dir, 'media');
  try { const name = fs.readdirSync(folder).find(f => f.startsWith(`${mediaId}.`) && !f.endsWith('.poster.jpg')); return name ? path.join(folder, name) : undefined; }
  catch { return undefined; }
}

// ——— the agent-runs log the settings page lists ———
function agentRunRecord(codex: ResolvedCodex, startedAt: string, projectId?:string): AgentRun {
  const record: AgentRun = { id: crypto.randomUUID(), module: 'generalEditing', ...(projectId?{projectId,filmRunId:findGeneral(projectId).project.run?.id}:{}), ...(codex.transport?{transport:codex.transport}:{}), ...(codex.agent?{agent:codex.agent}:{}), ...(codex.method?{method:codex.method}:{}), executable: codex.executable, model: codex.model, effort: codex.effort, ...(codex.requested ? {requested: codex.requested} : {}), startedAt, status: 'running' };
  persistAgentRun(record);
  return record;
}
function finishAgentRecord(record: AgentRun, status: AgentRun['status'], error?: string) {
  record.status = status; record.durationMs = Date.now() - Date.parse(record.startedAt);
  if (error) record.error = error;
  persistAgentRun(record);
}
function persistAgentRun(record: AgentRun) {
  try { atomicAgentJson(path.join(path.dirname(agentSettingsFile()), 'agent-runs', `${record.startedAt.replace(/[:.]/g, '-')}-${record.id}.json`), record); }
  catch { /* the log is informational */ }
}

/** Stop a run whose project is being deleted, and wait for Codex to go. */
export async function stopForDelete(id: string) {
  const entry = live.get(id);
  if (!entry) return;
  const { project } = findGeneral(id);
  if (project.run) entry.stopRun = project.run.id;
  const proc = entry.proc;
  proc?.stop();
  if (proc) await proc.done.catch(() => undefined);
}
