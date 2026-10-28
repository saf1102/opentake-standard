import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowUp, ChevronDown, ChevronRight, CircleCheck, CirclePause, CircleX, Film, FolderLock, Globe, GlobeLock, History, X } from 'lucide-react'
import type { GeneralAgentChoice, GeneralPlan, GeneralProject, GeneralRun, GeneralVersion } from './general-contract'
import { AgentControls } from './AgentPicker'
import {
  clockTime, elapsedLabel, feedItems, networkCopy, revisionNote, runActive, runStatus, secondsLabel, stepRows, stepsSummary, versionCardTime, versionName,
  type FeedItem, type StepRow,
} from './general-logic'
import { AgentText, CodexMark, Spinner, StopGlyph, TodoDot } from './GeneralBits'
import { QUOTE_KEY } from './platform'
import type { StageReference } from './GeneralStage'

export type AgentActions = {
  stop: () => void; resume: () => void; generate: () => void; network: (allow: boolean) => void; send: () => void
  /** the project's model and effort (undefined: 系统默认) and its 联网 switch, used from the next turn on */
  setAgent: (choice: GeneralAgentChoice | undefined) => void; setNetwork: (on: boolean) => void
}

/** Re-render every second while a run is working, for 已用 6 分 18 秒. */
function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live])
  return now
}

function StepIcon({ row }: { row: StepRow }) {
  switch (row.icon) {
    case 'done': return <CircleCheck size={16} aria-label="完成" />
    case 'spin': return <Spinner />
    case 'network': return <Globe size={16} aria-label="等你决定" />
    case 'failed': return <CircleX size={16} aria-label="出错" />
    case 'paused': return <CirclePause size={16} aria-label="停在这一步" />
    default: return <TodoDot />
  }
}

function PlanCard({ plan }: { plan: GeneralPlan }) {
  const [open, setOpen] = useState(false)
  return <div className="ge-plan">
    <b>《{plan.title}》· {secondsLabel(plan.duration)} · {plan.segments.length} 段</b>
    {plan.logline && <p>{plan.logline}</p>}
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起方案' : '展开看方案'}<ChevronRight size={14} aria-hidden="true" /></button>
    {open && <>
      <ol>{plan.segments.map((segment, index) => <li key={index}>{segment.name || `第 ${index + 1} 段`}<span>{clockTime(segment.start)}–{clockTime(segment.end)}</span></li>)}</ol>
      {plan.markdownUrl && <a href={plan.markdownUrl} target="_blank" rel="noreferrer">看完整方案</a>}
    </>}
  </div>
}

function StepList({ run, project }: { run: GeneralRun; project: GeneralProject }) {
  const now = useNow(runActive(run))
  const elapsed = (id: string) => {
    const step = run.steps.find(s => s.id === id)
    return step?.startedAt ? ` · 已用 ${elapsedLabel(now - Date.parse(step.startedAt))}` : ''
  }
  const rows = stepRows(run, { kind: project.inputs.kind, hasPlan: !!project.plan })
  return <ol className="ge-steplist" aria-label="做片步骤">
    {rows.map(row => <li key={row.id} className="ge-step" data-tone={row.tone} aria-current={row.tone === 'now' || row.tone === 'wait' ? 'step' : undefined}>
      <span className="ic"><StepIcon row={row} /></span>
      <div>
        <div className="t"><b>{row.title}</b>{row.aside && <small>{row.aside}</small>}</div>
        {row.progress !== undefined && <div className="ge-prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progress * 100)}>
          <i style={{ '--f': row.progress } as CSSProperties} /></div>}
        {(row.detail || row.tone === 'now') && <p>{row.detail || row.title}{row.tone === 'now' ? elapsed(row.id) : ''}</p>}
        {row.plan && project.plan && <PlanCard plan={project.plan} />}
        {row.thumbs.length > 0 && row.id !== 'render' && <div className="ge-thumbs">{row.thumbs.slice(-4).map(src => <img key={src} src={src} alt="" loading="lazy" draggable={false} />)}</div>}
      </div>
    </li>)}
  </ol>
}

function RunBlock({ run, project, busy, actions }: { run: GeneralRun; project: GeneralProject; busy: string; actions: AgentActions }) {
  const finished = run.state === 'done'
  const [open, setOpen] = useState(!finished)
  // A run that starts again unfolds its steps (reset while rendering, not in an effect).
  const [wasFinished, setWasFinished] = useState(finished)
  if (wasFinished !== finished) { setWasFinished(finished); if (!finished) setOpen(true) }
  return <div className="ge-runbox">
    {finished
      ? <>
        <button type="button" className="ge-fold" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <CircleCheck size={15} aria-hidden="true" />{stepsSummary(run)}<ChevronDown size={14} aria-hidden="true" />
        </button>
        {open && <StepList run={run} project={project} />}
      </>
      : <StepList run={run} project={project} />}
    {run.state === 'stopped' && <div className="ge-runnote">
      <p>已停止。方案和样张都留着，可以接着做。</p>
      <button type="button" className="ge-soft" data-solid disabled={!!busy} onClick={actions.resume}>{busy === 'resume' ? '正在接着做…' : '接着做'}</button>
    </div>}
    {run.state === 'failed' && <div className="ge-runnote" data-tone="failed" role="alert">
      <p>没做完{run.error ? `：${run.error}` : '。'}</p>
      <button type="button" className="ge-soft" disabled={!!busy} onClick={actions.resume}>{busy === 'resume' ? '正在接着做…' : '接着做'}</button>
    </div>}
  </div>
}

function VersionCard({ version, shown, onPick }: { version: GeneralVersion; shown: boolean; onPick: (n: number) => void }) {
  return <button type="button" className="ge-vcard" aria-pressed={shown} onClick={() => onPick(version.n)}>
    <img src={version.posterUrl} alt="" draggable={false} />
    <div><b>{versionName(version.n)}</b><span>{secondsLabel(version.duration)} · {versionCardTime(version.createdAt)}</span></div>
    {shown && <em>正在看</em>}
  </button>
}

function FeedRow({ item, project, shown, busy, actions, onPick }: {
  item: FeedItem; project: GeneralProject; shown?: number; busy: string; actions: AgentActions; onPick: (n: number) => void
}) {
  switch (item.type) {
    case 'brief': return <div className="ge-you">{item.text}</div>
    case 'run': return <RunBlock run={item.run} project={project} busy={busy} actions={actions} />
    case 'version': return <VersionCard version={item.version} shown={item.version.n === shown} onPick={onPick} />
    case 'message': {
      const { message } = item
      if (message.role === 'person') return <div className="ge-you">
        {message.reference?.imageDataUrl && <img src={message.reference.imageDataUrl} alt={`引用的画面 ${clockTime(message.reference.time)}`} />}
        {message.text}
        {item.queued && <small>它做完这一步就会看到</small>}
      </div>
      if (message.role === 'agent') return <p className="ge-say"><AgentText text={message.text} /></p>
      return <p className="ge-sys">{message.text}</p>
    }
  }
}

/** The 联网 question: floats in the panel above the composer, never over the preview. */
function NetworkAsk({ request, busy, onAnswer }: { request: { reason: string; hosts: string[] }; busy: string; onAnswer: (allow: boolean) => void }) {
  const copy = networkCopy(request)
  // The question takes focus (the conversation behind it is inert) without pre-selecting an answer.
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => { card.current?.focus({ preventScroll: true }) }, [])
  return <div ref={card} className="ge-ask" role="alertdialog" aria-modal="false" aria-labelledby="ge-ask-title" aria-describedby="ge-ask-reason" tabIndex={-1}>
    <h5 id="ge-ask-title"><Globe size={16} aria-hidden="true" />Codex 想联网</h5>
    <p id="ge-ask-reason">{request.reason}</p>
    {copy.hosts && <div className="host"><GlobeLock size={13} aria-hidden="true" /><span>只访问 <b>{copy.hosts}</b> · {copy.keep}</span></div>}
    <div className="row">
      <button type="button" className="ge-btn" disabled={!!busy} onClick={() => onAnswer(false)}>{busy === 'network-no' ? '好的…' : copy.decline}</button>
      <button type="button" className="ge-btn solid" disabled={!!busy} onClick={() => onAnswer(true)}>{busy === 'network-yes' ? '正在放行…' : copy.allow}</button>
    </div>
    <small>不允许也能接着做，片子照样出</small>
  </div>
}

export function GeneralAgentPanel({ project, brief, shown, canQuote, onPickVersion, draft, setDraft, reference, clearReference, busy, actions, connection, resizer, composer }: {
  project: GeneralProject; brief: string; shown?: GeneralVersion; onPickVersion: (n: number) => void
  /** the player is on screen, so ⌘-drag can quote a region */
  canQuote: boolean
  draft: string; setDraft: (value: string) => void; reference?: StageReference; clearReference: () => void
  /** which action is in flight ('' when none) */
  busy: string; actions: AgentActions; connection: 'open' | 'retrying'; resizer: ReactNode; composer?: (element: HTMLTextAreaElement | null) => void
}) {
  const run = project.run
  const active = runActive(run)
  const now = useNow(active)
  const status = runStatus(project, now)
  const asking = run?.state === 'needs-network' && run.networkRequest ? run.networkRequest : undefined
  const items = feedItems(project, brief)
  const body = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const area = useRef<HTMLTextAreaElement | null>(null)
  const [lost, setLost] = useState(false)

  // Say 「正在重连」 only when the stream stays down for a moment.
  useEffect(() => {
    if (connection === 'open') return
    const timer = window.setTimeout(() => setLost(true), 2500)
    return () => { window.clearTimeout(timer); setLost(false) }
  }, [connection])

  // Follow the newest step while the reader is at the bottom; leave them alone when they scrolled up.
  const signature = `${items.length}:${run?.steps.map(step => step.state).join(',')}:${run?.state}`
  useLayoutEffect(() => {
    const element = body.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [signature])

  // The composer grows with its text, up to its max height.
  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [draft])

  const canSend = !!draft.trim() && busy !== 'send'
  // the ⌘-drag hint lives in the box (the row under it holds the model capsule and send)
  const placeholder = active ? '有补充可以直接说，它做完这一步就会看到' : project.versions.length
    ? (canQuote ? `想怎么改，直接说；按住 ${QUOTE_KEY} 拖动画面可以框选` : '想怎么改，直接说') : '有什么要求，直接说'
  const note = !active ? revisionNote(project.versions, shown) : undefined

  return <aside className="ge-agent" data-asking={asking ? '' : undefined} aria-label="Codex 对话">
    {resizer}
    <header className="ge-ahead">
      <CodexMark />
      <span className="name">Codex</span>
      <span className="st" role="status"><i data-tone={status.tone} aria-hidden="true" /><span>{status.text}</span></span>
      {active && <button type="button" className="ge-stop" disabled={run?.state === 'stopping' || busy === 'stop'} onClick={actions.stop}>
        <StopGlyph />{run?.state === 'stopping' || busy === 'stop' ? '正在停止…' : '停止'}
      </button>}
    </header>
    <div className="ge-scope">
      <span><FolderLock size={12} aria-hidden="true" />只在本工程文件夹</span>
      <span><GlobeLock size={12} aria-hidden="true" />不联网</span>
      <span><Film size={12} aria-hidden="true" />只改这条片子</span>
      {lost && <span className="ge-retry" role="status"><Spinner size={11} />连接断了，正在重连</span>}
    </div>
    <div className="ge-mid">
      <div ref={body} className="ge-abody" inert={!!asking} onScroll={event => {
        const element = event.currentTarget
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}>
        {items.map(item => <FeedRow key={item.key} item={item} project={project} shown={shown?.n} busy={busy} actions={actions} onPick={onPickVersion} />)}
        {!run && <div className="ge-runnote">
          <p>还没开始做片。</p>
          <button type="button" className="ge-soft" data-solid disabled={!!busy} onClick={actions.generate}>{busy === 'generate' ? '正在开始…' : '开始生成'}</button>
        </div>}
      </div>
      {asking && <NetworkAsk request={asking} busy={busy} onAnswer={actions.network} />}
    </div>
    <div className="ge-comp" inert={!!asking}>
      <div className="ge-box" onClick={event => { if (event.target === event.currentTarget) area.current?.focus() }}>
        {reference && <span className="ge-ref">
          {reference.reference.imageDataUrl && <img src={reference.reference.imageDataUrl} alt="" />}
          画面 {clockTime(reference.reference.time)}<span>· 框选的区域</span>
          <button type="button" aria-label="去掉这个引用" onClick={clearReference}><X size={13} aria-hidden="true" /></button>
        </span>}
        <textarea ref={element => { area.current = element; composer?.(element) }} rows={2} value={draft} placeholder={placeholder} aria-label="给 Codex 的话"
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) actions.send() }
          }} />
        <div className="ge-crow">
          <span className="ge-crow-tools">
            <AgentControls compact up agent={project.agent} onAgent={actions.setAgent} network={!!project.network} onNetwork={actions.setNetwork} disabled={busy === 'agent'} />
          </span>
          <button type="button" className="ge-send" aria-label="发送" disabled={!canSend} onClick={actions.send}>
            {busy === 'send' ? <Spinner size={14} /> : <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {note && <div className="ge-note"><History size={13} aria-hidden="true" /><span>改完会生成 <b>{note.next}</b>，随时可以回到 {note.back}</span></div>}
    </div>
  </aside>
}
