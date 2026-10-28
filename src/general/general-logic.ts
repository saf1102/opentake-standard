/**
 * 通用剪辑 pages: everything that is decided without React. Pure functions only (no DOM, no JSON import, no '@/' alias),
 * so server/general-page-logic.test.ts can load this file directly with node --experimental-strip-types.
 */
import {
  GENERAL_STEP_IDS,
  type GeneralAspect, type GeneralInputKind, type GeneralLength, type GeneralMedia, type GeneralMessage, type GeneralPlan,
  type GeneralProject, type GeneralProjectSummary, type GeneralRun, type GeneralRunState, type GeneralSegment, type GeneralSettings, type GeneralStep,
  type GeneralStepId, type GeneralVersion,
} from './general-contract.ts'
import { GENERAL_EDIT_PATH } from '../workspace/modules.ts'
import { isPickableStyle, type LibraryStyle } from '../workspace/style-library/style-library.ts'

// ---------- routes ----------

export const generalProjectHref = (id: string) => `${GENERAL_EDIT_PATH}/projects/${encodeURIComponent(id)}`

/** /general?style=<id> opens on ② with that style; /general?pick=<id> stays on ① with it chosen (back from ②). */
export function initialGeneralStep(params: { style?: string | null; pick?: string | null }, styles: readonly LibraryStyle[]): { step: 1 | 2; selectedId?: string } {
  const find = (id?: string | null) => (id ? styles.find(style => style.id === id && isPickableStyle(style)) : undefined)
  const chosen = find(params.style)
  if (chosen) return { step: 2, selectedId: chosen.id }
  const picked = find(params.pick)
  return picked ? { step: 1, selectedId: picked.id } : { step: 1 }
}

// ---------- settings ----------

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = { aspect: '16:9', length: 30 }
export const LENGTH_OPTIONS: readonly GeneralLength[] = [15, 30, 60, 'auto']
export const ASPECT_OPTIONS: readonly GeneralAspect[] = ['16:9', '9:16']
export const ASPECT_LABELS: Readonly<Record<GeneralAspect, string>> = { '16:9': '16:9 横屏', '9:16': '9:16 竖屏' }

export const lengthLabel = (length: GeneralLength) => (length === 'auto' ? '自动' : `${length} 秒`)
/** The left column of the work page: 约 30 秒, or 自动. */
export const lengthSummary = (length: GeneralLength) => (length === 'auto' ? '自动' : `约 ${length} 秒`)

export const inputKindForStyle = (style: Pick<LibraryStyle, 'input_type'>): GeneralInputKind => (style.input_type === 'footage' ? 'footage' : 'topic')

// ---------- numbers and times ----------

const pad2 = (value: number) => String(value).padStart(2, '0')

/** Player clock with tenths: 0:01.5, 1:02.0. */
export function clockTime(seconds: number) {
  const tenths = Math.round((Number.isFinite(seconds) ? Math.max(0, seconds) : 0) * 10)
  const minutes = Math.floor(tenths / 600)
  const rest = (tenths - minutes * 600) / 10
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
}

/** A clip length on a thumbnail: 0:06. */
export function clipDuration(seconds: number) {
  const whole = Math.round(Number.isFinite(seconds) ? Math.max(0, seconds) : 0)
  return `${Math.floor(whole / 60)}:${pad2(whole % 60)}`
}

/** A project length in the library, the same shape as the 口播 cards: 00:26. */
export function libraryDuration(seconds: number | undefined) {
  const whole = Math.round(seconds && Number.isFinite(seconds) ? Math.max(0, seconds) : 0)
  return `${pad2(Math.floor(whole / 60))}:${pad2(whole % 60)}`
}

/** 25.6 秒, 30 秒. */
export function secondsLabel(seconds: number) {
  const value = Math.round((Number.isFinite(seconds) ? Math.max(0, seconds) : 0) * 10) / 10
  return `${Number.isInteger(value) ? value : value.toFixed(1)} 秒`
}

/** How long a run has taken: 45 秒, 6 分 18 秒, 4 分 05 秒, 1 小时 02 分. */
export function elapsedLabel(milliseconds: number) {
  const total = Math.floor((Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0) / 1000)
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} 分 ${pad2(total % 60)} 秒`
  return `${Math.floor(minutes / 60)} 小时 ${pad2(minutes % 60)} 分`
}

const time = (iso: string | undefined) => {
  const value = iso ? Date.parse(iso) : NaN
  return Number.isFinite(value) ? value : undefined
}
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const hhmm = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`

/** The version chip: 08:48 today, 10月23日 otherwise (local time). */
export function versionChipTime(iso: string, now = Date.now()) {
  const at = time(iso)
  if (at === undefined) return ''
  const date = new Date(at)
  return sameDay(date, new Date(now)) ? hhmm(date) : `${date.getMonth() + 1}月${date.getDate()}日`
}

/** The version card: 今天 08:48, 昨天 08:48, 10月20日 08:48. */
export function versionCardTime(iso: string, now = Date.now()) {
  const at = time(iso)
  if (at === undefined) return ''
  const date = new Date(at), today = new Date(now)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const day = sameDay(date, today) ? '今天' : sameDay(date, yesterday) ? '昨天' : `${date.getMonth() + 1}月${date.getDate()}日`
  return `${day} ${hhmm(date)}`
}

// ---------- versions ----------

/** The contract stores a number; people read 第 1 版. Manual edits are not versions. */
export const versionName = (n: number) => `第 ${n} 版`

export function sortedVersions(versions: readonly GeneralVersion[]) {
  return [...versions].sort((a, b) => a.n - b.n)
}

export function nextVersionNumber(versions: readonly GeneralVersion[]) {
  return versions.reduce((max, version) => Math.max(max, version.n), 0) + 1
}

/** What the player shows: the version picked on the page, else the project's current one, else the newest. */
export function shownVersion(project: Pick<GeneralProject, 'versions' | 'current'>, picked?: number) {
  const list = sortedVersions(project.versions)
  return list.find(version => version.n === picked) ?? list.find(version => version.n === project.current) ?? list.at(-1)
}

/** Under the composer once a version exists: 改完会生成 第 2 版，随时可以回到 第 1 版 (the version on screen). */
export function revisionNote(versions: readonly GeneralVersion[], shown?: GeneralVersion) {
  if (!versions.length) return undefined
  const back = shown ?? sortedVersions(versions).at(-1)!
  return { next: versionName(nextVersionNumber(versions)), back: versionName(back.n) }
}

// ---------- runs ----------

const ACTIVE_RUN_STATES: readonly GeneralRunState[] = ['running', 'stopping', 'needs-network']
/** While a run is active the page locks manual edits and shows 停止. */
export const runActive = (run: Pick<GeneralRun, 'state'> | undefined) => !!run && ACTIVE_RUN_STATES.includes(run.state)
export const runStateActive = (state: GeneralRunState | undefined) => !!state && ACTIVE_RUN_STATES.includes(state)

export type RunTone = 'running' | 'wait' | 'done' | 'idle' | 'failed'

/** The line beside 「Codex」 at the top of the agent panel. */
export function runStatus(project: Pick<GeneralProject, 'run' | 'versions'>, now = Date.now()): { tone: RunTone; text: string } {
  const { run, versions } = project
  const newest = sortedVersions(versions).at(-1)
  if (!run) return newest ? { tone: 'done', text: `${versionName(newest.n)} · ${secondsLabel(newest.duration)}` } : { tone: 'idle', text: '还没开始' }
  const started = time(run.startedAt) ?? now
  const spent = elapsedLabel((time(run.endedAt) ?? now) - started)
  switch (run.state) {
    case 'running': return { tone: 'running', text: `${run.repairReason ? `第 ${run.round ?? 2} 轮：修正 ${run.repairReason}` : run.purpose === 'revision' ? `正在做${versionName(nextVersionNumber(versions))}` : '正在做片'} · 已用 ${spent}` }
    case 'needs-network': return { tone: 'wait', text: `等你决定 · 已用 ${spent}` }
    case 'stopping': return { tone: 'wait', text: '正在停止…' }
    case 'stopped': return { tone: 'idle', text: '已停止 · 方案和样张都留着' }
    case 'done': return { tone: 'done', text: newest ? `${versionName(newest.n)}已完成 · 用时 ${spent}` : `做完了 · 用时 ${spent}` }
    case 'failed': return { tone: 'failed', text: '没做完' }
    default: return newest ? { tone: 'done', text: `${versionName(newest.n)} · ${secondsLabel(newest.duration)}` } : { tone: 'idle', text: '还没开始' }
  }
}

/** The tag on a library card while the project is not simply finished. */
export function libraryRunLabel(state: GeneralRunState | undefined): { text: string; tone: 'running' | 'wait' | 'idle' | 'failed' } | undefined {
  switch (state) {
    case 'running': return { text: '正在做片', tone: 'running' }
    case 'needs-network': return { text: '等你决定', tone: 'wait' }
    case 'stopping': return { text: '正在停止', tone: 'wait' }
    case 'stopped': return { text: '已停止', tone: 'idle' }
    case 'failed': return { text: '没做完', tone: 'failed' }
    default: return undefined
  }
}

export type RunNotice = { id: string; kind: 'done' | 'needs-network' | 'failed'; title: string; body: string }

/**
 * What changed since the last look at the library, worth a 系统通知: a run finished, failed, or asks to reach the network.
 * A project seen for the first time says nothing (opening the app must not replay old news).
 */
export function runNotices(before: ReadonlyMap<string, GeneralRunState | undefined>, after: readonly GeneralProjectSummary[]): RunNotice[] {
  const notices: RunNotice[] = []
  for (const project of after) {
    if (!before.has(project.id)) continue
    const previous = before.get(project.id), state = project.runState
    if (previous === state) continue
    const name = `《${project.name}》`
    if (state === 'needs-network') notices.push({ id: project.id, kind: 'needs-network', title: 'Codex 想联网', body: `${name}要你决定一下，答应了才会联网` })
    else if (state === 'done' && runStateActive(previous)) notices.push({ id: project.id, kind: 'done', title: `${name}做好了`, body: project.versions > 0 ? `${versionName(project.versions)}已经出片，点开看看` : '已经出片，点开看看' })
    else if (state === 'failed' && runStateActive(previous)) notices.push({ id: project.id, kind: 'failed', title: `${name}没做完`, body: '点开看看是哪一步出了问题' })
  }
  return notices
}

// ---------- steps ----------

type StepWords = { readonly waiting: string; readonly running: string; readonly done: string }
/** Fallback names when the server sends no label; the server's own label always wins. */
export const STEP_WORDS: Readonly<Record<GeneralStepId, StepWords>> = {
  'read-style': { waiting: '读风格', running: '正在读风格', done: '读风格' },
  'read-input': { waiting: '看素材', running: '正在看素材', done: '看素材' },
  plan: { waiting: '写方案', running: '正在写方案', done: '写好方案' },
  code: { waiting: '写画面代码', running: '正在写画面代码', done: '写画面代码' },
  'self-check': { waiting: '自检', running: '正在自检', done: '自检' },
  render: { waiting: '渲染', running: '渲染中', done: '渲染' },
  review: { waiting: '自检全片', running: '正在自检全片', done: '自检全片' },
  deliver: { waiting: '交付', running: '正在交付', done: '交付' },
}
const TOPIC_INPUT_WORDS: StepWords = { waiting: '读文案', running: '正在读文案', done: '读文案' }
/** What a step that has not started will do, shown faintly. */
const WAITING_HINTS: Partial<Record<GeneralStepId, string>> = {
  'self-check': '看几张样张，对照风格检查',
  review: '看关键帧，查黑屏、音量、节拍',
}

export type StepTone = 'done' | 'now' | 'wait' | 'todo' | 'failed' | 'skipped' | 'paused'
export type StepIcon = 'done' | 'spin' | 'network' | 'todo' | 'failed' | 'skipped' | 'paused'
export type StepRow = {
  id: GeneralStepId; title: string; detail?: string; tone: StepTone; icon: StepIcon
  /** right side of the title, e.g. 11.2 / 25.6 秒 */
  aside?: string; progress?: number; thumbs: string[]
  /** the plan card goes under this row */
  plan: boolean
}

const stepOrder = (id: string) => {
  const index = (GENERAL_STEP_IDS as readonly string[]).indexOf(id)
  return index < 0 ? GENERAL_STEP_IDS.length : index
}

/** Real progress of the render step, or nothing. */
export function renderProgress(run: Pick<GeneralRun, 'steps'> | undefined) {
  const progress = run?.steps.find(step => step.id === 'render')?.progress
  if (!progress || !(progress.total > 0)) return undefined
  const done = Math.min(progress.total, Math.max(0, progress.done))
  return { done, total: progress.total, ratio: done / progress.total }
}

/** The step timeline of a run, in the contract's order, with the words and icon each row shows. */
export function stepRows(run: GeneralRun | undefined, options: { kind?: GeneralInputKind; hasPlan?: boolean } = {}): StepRow[] {
  if (!run) return []
  const active = runActive(run)
  return [...run.steps].sort((a, b) => stepOrder(a.id) - stepOrder(b.id)).map((step: GeneralStep): StepRow => {
    const words = step.id === 'read-input' && options.kind === 'topic' ? TOPIC_INPUT_WORDS : STEP_WORDS[step.id] ?? { waiting: step.id, running: step.id, done: step.id }
    let tone: StepTone, icon: StepIcon
    if (step.state === 'done') { tone = 'done'; icon = 'done' }
    else if (step.state === 'failed') { tone = 'failed'; icon = 'failed' }
    else if (step.state === 'skipped') { tone = 'skipped'; icon = 'skipped' }
    else if (step.state === 'running') {
      if (!active) { tone = 'paused'; icon = 'paused' }
      else if (run.state === 'needs-network') { tone = 'wait'; icon = 'network' }
      else { tone = 'now'; icon = 'spin' }
    } else { tone = 'todo'; icon = 'todo' }
    const label = step.label?.trim()
    const progress = step.id === 'render' ? renderProgress(run) : undefined
    let title = label || (step.state === 'done' ? words.done : step.state === 'running' && active ? words.running : words.waiting)
    let aside: string | undefined
    if (progress && step.state === 'running') {
      title = words.running
      aside = `${progress.done.toFixed(1)} / ${progress.total.toFixed(1)} 秒`
    }
    const detail = step.detail?.trim()
      || (tone === 'todo' ? WAITING_HINTS[step.id] : undefined)
      || (tone === 'skipped' ? '这一步跳过了' : undefined)
      || (tone === 'wait' ? '要联网，等你决定' : undefined)
    return {
      id: step.id, title, detail, tone, icon, aside,
      progress: progress && step.state === 'running' ? progress.ratio : undefined,
      thumbs: step.thumbs ?? [],
      plan: step.id === 'plan' && !!options.hasPlan && step.state === 'done',
    }
  })
}

/** The folded line of a finished run: 做片过程 · 8 步. */
export function stepsSummary(run: Pick<GeneralRun, 'steps'>) {
  return `做片过程 · ${run.steps.filter(step => step.state !== 'skipped').length} 步`
}

/** The newest frame the render step produced; nothing before rendering starts. */
export function latestRenderFrame(run: Pick<GeneralRun, 'steps'> | undefined) {
  return run?.steps.find(step => step.id === 'render')?.thumbs?.at(-1)
}

/** What a sketched plan says under its title: 8 段 · 25.6 秒 · 只用你的 2 段素材. */
export function planSketchLine(plan: Pick<GeneralPlan, 'segments' | 'duration'>, inputs: { kind: GeneralInputKind; media: readonly unknown[] }) {
  const parts = [`${plan.segments.length} 段`, secondsLabel(plan.duration)]
  if (inputs.kind === 'footage' && inputs.media.length) parts.push(`只用你的 ${inputs.media.length} 段素材`)
  return parts.join(' · ')
}

// ---------- network question ----------

/** The words of the 联网 card. A font request says what declining means; anything else gets the plain 「不用了」. */
export function networkCopy(request: { reason: string; hosts: readonly string[] }) {
  const font = /字体|字型|font/i.test(request.reason) || request.hosts.some(host => /font/i.test(host))
  return {
    decline: font ? '不用了，用现有字体' : '不用了',
    allow: '允许这一次',
    hosts: request.hosts.filter(Boolean).join('、'),
    keep: font ? '字体只存进本工程' : '下载的东西只存进本工程',
  }
}

// ---------- segments ----------

export type SegmentSlot = GeneralSegment & { index: number; weight: number; label: string }

/** The strip: one slot per segment, sized by its length (never zero, so a short beat stays clickable). */
export function segmentSlots(segments: readonly GeneralSegment[]): SegmentSlot[] {
  return [...segments].sort((a, b) => a.start - b.start).map((segment, index) => ({
    ...segment, index, weight: Math.max(0.05, segment.end - segment.start), label: segment.name.trim(),
  }))
}

/** How much of one segment the render has reached, 0–1. */
export function segmentFill(segment: Pick<GeneralSegment, 'start' | 'end'>, rendered: number) {
  const length = segment.end - segment.start
  if (!(length > 0)) return rendered >= segment.end ? 1 : 0
  return Math.min(1, Math.max(0, (rendered - segment.start) / length))
}

/** Where a time sits on the strip, 0–1. The strip is laid out by segment weight, so this walks the slots. */
export function stripPosition(slots: readonly SegmentSlot[], seconds: number) {
  const total = slots.reduce((sum, slot) => sum + slot.weight, 0)
  if (!(total > 0)) return 0
  let before = 0
  for (const slot of slots) {
    if (seconds < slot.end || slot === slots.at(-1)) {
      const inside = slot.end > slot.start ? Math.min(1, Math.max(0, (seconds - slot.start) / (slot.end - slot.start))) : 0
      return Math.min(1, (before + inside * slot.weight) / total)
    }
    before += slot.weight
  }
  return 1
}

export const REDO_PREFIX = '重做这一段：'

/** The text a segment click puts in the composer. An unnamed beat is called by its number. */
export function redoPrefill(segment: Pick<GeneralSegment, 'name'>, index: number) {
  return `${REDO_PREFIX}${segment.name.trim() || `第 ${index + 1} 段`}`
}

/** Put the prefill on the first line: it replaces an earlier 重做这一段 line and keeps whatever else was typed. */
export function applyPrefill(draft: string, prefill: string) {
  const lines = draft.split('\n')
  const rest = (lines[0]?.startsWith(REDO_PREFIX) ? lines.slice(1) : lines).join('\n').replace(/^\s*\n/, '')
  return rest.trim() ? `${prefill}\n${rest}` : prefill
}

// ---------- ⌘ selection on the player ----------

export type Box = { x: number; y: number; w: number; h: number }
/** A drag smaller than this (screen pixels) is a click, not a selection. */
export const MIN_SELECTION = 8

/** Where a picture of mediaW×mediaH sits inside a frame with object-fit: contain. */
export function containBox(frameW: number, frameH: number, mediaW: number, mediaH: number): Box {
  if (!(frameW > 0 && frameH > 0)) return { x: 0, y: 0, w: 0, h: 0 }
  if (!(mediaW > 0 && mediaH > 0)) return { x: 0, y: 0, w: frameW, h: frameH }
  const scale = Math.min(frameW / mediaW, frameH / mediaH)
  const w = mediaW * scale, h = mediaH * scale
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h }
}

/** The box between two pointer positions, dragged in any direction. */
export function boxFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

/**
 * A drag on the frame (pixels relative to the frame's top-left) → the region of the picture.
 * `pixels` is in the video's own resolution (videoWidth × videoHeight), which is what GeneralReference.rect carries;
 * `fraction` (0–1 of the picture) positions the highlight. Letterbox bars are cut off; too small a region is null.
 */
export function selectionInMedia(drag: Box, frame: { w: number; h: number }, media: { w: number; h: number }): { pixels: Box; fraction: Box } | null {
  const content = containBox(frame.w, frame.h, media.w, media.h)
  const left = Math.max(drag.x, content.x), top = Math.max(drag.y, content.y)
  const right = Math.min(drag.x + drag.w, content.x + content.w), bottom = Math.min(drag.y + drag.h, content.y + content.h)
  if (right - left < MIN_SELECTION || bottom - top < MIN_SELECTION || !(content.w > 0 && content.h > 0)) return null
  const fraction = { x: (left - content.x) / content.w, y: (top - content.y) / content.h, w: (right - left) / content.w, h: (bottom - top) / content.h }
  const mw = media.w > 0 ? media.w : frame.w, mh = media.h > 0 ? media.h : frame.h
  const x = Math.min(mw - 1, Math.max(0, Math.round(fraction.x * mw))), y = Math.min(mh - 1, Math.max(0, Math.round(fraction.y * mh)))
  const pixels = { x, y, w: Math.max(1, Math.min(mw - x, Math.round(fraction.w * mw))), h: Math.max(1, Math.min(mh - y, Math.round(fraction.h * mh))) }
  return { pixels, fraction }
}

/** A stored reference back to 0–1 of the picture, for drawing its highlight. */
export function referenceFraction(rect: Box, media: { w: number; h: number }): Box | null {
  if (!(media.w > 0 && media.h > 0)) return null
  return { x: rect.x / media.w, y: rect.y / media.h, w: rect.w / media.w, h: rect.h / media.h }
}

// ---------- the agent panel width ----------

export const AGENT_PANEL = { storageKey: 'opentake-general-agent-width', initial: 380, min: 320, max: 560 } as const
/** The left column and the least room the preview keeps, so a narrow window never squeezes the player out. */
const SIDE_WIDTH = 248, STAGE_MIN = 420

/** The width a person chose, kept within 320–560; anything unreadable is the default 380. */
export function clampAgentWidth(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(number)) return AGENT_PANEL.initial
  return Math.round(Math.min(AGENT_PANEL.max, Math.max(AGENT_PANEL.min, number)))
}

/** What the panel can actually take in this window, without changing the remembered width. */
export function fittedAgentWidth(width: number, viewport: number) {
  const room = Number.isFinite(viewport) && viewport > 0 ? viewport - SIDE_WIDTH - STAGE_MIN : AGENT_PANEL.max
  return Math.max(AGENT_PANEL.min, Math.min(clampAgentWidth(width), room))
}

type ReadStore = { getItem(key: string): string | null }
type WriteStore = { setItem(key: string, value: string): void }
export function readAgentWidth(storage: ReadStore | undefined) {
  try { return clampAgentWidth(storage?.getItem(AGENT_PANEL.storageKey)) } catch { return AGENT_PANEL.initial }
}
export function saveAgentWidth(storage: WriteStore | undefined, value: number) {
  const width = clampAgentWidth(value)
  try { storage?.setItem(AGENT_PANEL.storageKey, String(width)) } catch { /* storage may be unavailable */ }
  return width
}

// ---------- the new-project intake ----------

export const intakeTitle = (kind: GeneralInputKind) => (kind === 'footage' ? '放进你的视频' : '粘贴你的文案')

/** The short line at the right of the drop zone: what the style wants, cut at its first aside (延时、航拍、慢动作…). */
export function styleHint(summary: string, max = 24) {
  const first = summary.split(/[（(；;。]/)[0]?.trim() ?? ''
  return [...first].length > max ? `${[...first].slice(0, max - 1).join('')}…` : first
}

/** Characters of a script, without spaces and line breaks. */
export const textCount = (text: string) => [...text.replace(/\s/g, '')].length

/** Why 开始生成 is not available yet, or nothing. */
export function startBlocker(kind: GeneralInputKind, draft: { files: number; text: string }) {
  if (kind === 'footage' && draft.files < 1) return '先放进至少一段视频或一张照片'
  if (kind === 'topic' && !draft.text.trim()) return '先粘贴文案或写一个题目'
  return undefined
}

/** The style's name as the person sees it; 不用风格 (free) is not in the library. */
export const styleNameOf = (styleId: string, style?: Pick<LibraryStyle, 'name_zh'>) => style?.name_zh ?? (styleId === 'free' ? '不用风格' : styleId)

/** The person's first line in the conversation, made from what they gave. */
export function briefLine(kind: GeneralInputKind, styleName: string, media: readonly Pick<GeneralMedia, 'duration'>[], settings: GeneralSettings) {
  const length = settings.length === 'auto' ? '片长自动' : `约 ${settings.length} 秒`
  if (kind === 'topic') return `用这段文案做一条「${styleName}」，${settings.aspect}，${length}。`
  const videos = media.filter(item => item.duration > 0).length
  const noun = videos === media.length ? '段视频' : videos === 0 ? '张照片' : '个素材'
  return `用这 ${media.length} ${noun}做一条「${styleName}」，${settings.aspect}，${length}。`
}

// ---------- the conversation feed ----------

export type FeedItem =
  | { type: 'brief'; key: string; text: string }
  | { type: 'message'; key: string; message: GeneralMessage; queued: boolean }
  | { type: 'run'; key: string; run: GeneralRun }
  | { type: 'version'; key: string; version: GeneralVersion }

/**
 * The agent panel, top to bottom: the brief (only when the server did not record the person's first message),
 * the messages in time order, the current run's steps where that run started, and a card for each version
 * right after the message announcing it (or where it was made). Messages the person sent during the run are
 * marked queued: the agent reads them when its current step ends.
 */
export function feedItems(project: Pick<GeneralProject, 'messages' | 'run' | 'versions'>, brief: string): FeedItem[] {
  const messages = [...project.messages].sort((a, b) => (time(a.at) ?? 0) - (time(b.at) ?? 0))
  const items: FeedItem[] = []
  if (brief && messages[0]?.role !== 'person') items.push({ type: 'brief', key: 'brief', text: brief })
  const run = project.run
  const runStart = time(run?.startedAt)
  const queued = new Set<string>()
  if (run && runActive(run) && run.queued > 0) {
    messages.filter(message => message.role === 'person' && (time(message.at) ?? 0) > (runStart ?? Infinity)).slice(-run.queued).forEach(message => queued.add(message.id))
  }
  const announced = new Set(messages.flatMap(message => (message.version ? [message.version] : [])))
  const loose = sortedVersions(project.versions).filter(version => !announced.has(version.n))
  let runPlaced = !run
  const placeRun = () => { if (!runPlaced && run) { items.push({ type: 'run', key: `run-${run.id}`, run }); runPlaced = true } }
  const placeLoose = (until: number) => {
    while (loose.length && (time(loose[0].createdAt) ?? 0) <= until) { const version = loose.shift()!; items.push({ type: 'version', key: `version-${version.n}`, version }) }
  }
  for (const message of messages) {
    const at = time(message.at) ?? 0
    if (!runPlaced && runStart !== undefined && at > runStart) { placeLoose(runStart); placeRun() }
    placeLoose(at)
    items.push({ type: 'message', key: message.id, message, queued: queued.has(message.id) })
    const version = message.version ? project.versions.find(item => item.n === message.version) : undefined
    if (version) items.push({ type: 'version', key: `version-${version.n}-${message.id}`, version })
  }
  if (!runPlaced) { placeLoose(runStart ?? Infinity); placeRun() }
  placeLoose(Infinity)
  return items
}
