import {ExportMenu} from '@/general/project-edition';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ChevronDown, Download, Lock, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { LIBRARY_STYLES } from '@/workspace/style-library/library-styles'
import { STYLE_INPUT_COPY, styleById, type LibraryStyle } from '@/workspace/style-library/style-library'
import { GENERAL_EDIT_PATH } from '@/workspace/modules'
import { GeneralApiError, announceGeneralChange, errorText, generalApi } from '@/general/general-api'
import type { GeneralProject as Project, GeneralSegment } from '@/general/general-contract'
import {
  AGENT_PANEL, ASPECT_LABELS, applyPrefill, briefLine, clampAgentWidth, clipDuration, fittedAgentWidth, latestRenderFrame, lengthSummary,
  readAgentWidth, redoPrefill, runActive, saveAgentWidth, shownVersion, styleNameOf, textCount, versionName,
} from '@/general/general-logic'
import { NavSlot, Spinner } from '@/general/GeneralBits'
import { GeneralStage, type StageHandle, type StageReference } from '@/general/GeneralStage'
import { GeneralAgentPanel, type AgentActions } from '@/general/GeneralAgentPanel'
import { GeneralEditor } from '@/general/GeneralEditor'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import '@/general/general.css'

const storage = () => { try { return window.localStorage } catch { return undefined } }

/** The project, kept live: one read, then the event stream (each event is the whole project); a reconnect reads it again. */
function useGeneralProject(id: string) {
  const [project, setProject] = useState<Project>()
  const [error, setError] = useState<unknown>()
  const [connection, setConnection] = useState<'open' | 'retrying'>('open')
  const load = useCallback(() => generalApi.get(id).then(next => { setProject(next); setError(undefined) }, failure => setError(failure)), [id])
  useEffect(() => {
    // A different id is a different route element (App keys routes by path), so there is no old project to clear here.
    let alive = true, dropped = false
    void load()
    const stop = generalApi.subscribe(id, next => { if (alive) { setProject(next); setError(undefined) } }, state => {
      if (!alive) return
      setConnection(state)
      if (state === 'retrying') dropped = true
      else if (dropped) { dropped = false; void load() }
    })
    return () => { alive = false; stop() }
  }, [id, load])
  return { project, setProject, error, connection, reload: load }
}

function ProjectTitle({ project, onRename }: { project: Project; onRename: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(project.name)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!editing) setValue(project.name) }, [project.name, editing])
  const save = async () => {
    const name = value.trim()
    if (!name || name === project.name) { setEditing(false); return }
    setSaving(true)
    try { await onRename(name); setEditing(false) } catch (failure) { toast.error(`改名没成功：${errorText(failure)}`) } finally { setSaving(false) }
  }
  if (editing) return <form className="ge-navtitle" onSubmit={event => { event.preventDefault(); void save() }}>
    <i aria-hidden="true" />
    <input aria-label="工程名" value={value} autoFocus disabled={saving} maxLength={80} onFocus={event => event.currentTarget.select()}
      onChange={event => setValue(event.target.value)} onBlur={() => void save()}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setValue(project.name); setEditing(false) } }} />
  </form>
  // Not a <button>: the top bar's theme skins every button there, and this should read as the title.
  return <span className="ge-navtitle" role="button" tabIndex={0} title="点一下改名" aria-label={`工程名：${project.name}，点一下改名`} onClick={() => setEditing(true)}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditing(true) } }}><span>{project.name}</span><em className="ge-kind"><i aria-hidden="true" />通用剪辑</em></span>
}

function SidePanel({ project, style, locked, onProject }: { project: Project; style?: LibraryStyle; locked: boolean; onProject: (project: Project) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<{ index: number; total: number; ratio: number } | null>(null)
  const footage = project.inputs.kind === 'footage'
  const add = async (files: File[]) => {
    const list = files.filter(file => file.type.startsWith('video/') || file.type.startsWith('image/'))
    if (!list.length) return
    try {
      for (const [index, file] of list.entries()) {
        setUpload({ index, total: list.length, ratio: 0 })
        await generalApi.upload(project.id, file, ratio => setUpload({ index, total: list.length, ratio }))
      }
      onProject(await generalApi.get(project.id))
    } catch (failure) { toast.error(`素材没传上去：${errorText(failure)}`) } finally { setUpload(null) }
  }
  const remove = async (mediaId: string) => {
    try { onProject(await generalApi.removeMedia(project.id, mediaId)) } catch (failure) { toast.error(`没能移除：${errorText(failure)}`) }
  }
  return <aside className="ge-side" aria-label="风格、素材和设定">
    <section className="ge-sec ge-style">
      <h4>风格</h4>
      <div className="th">{style && <img src={style.poster} alt="" draggable={false} />}</div>
      <b>{styleNameOf(project.styleId, style)}</b>
      {style && <span>{STYLE_INPUT_COPY[style.input_type].label}</span>}
    </section>
    {footage
      ? <section className="ge-sec">
        <h4>素材 <span>{project.inputs.media.length}</span></h4>
        <ul className="ge-mats">{project.inputs.media.map(media => <li key={media.id} className="ge-mat">
          <span className="th">{media.poster && <img src={media.poster} alt="" draggable={false} />}</span>
          <div><b title={media.name}>{media.name}</b><span>{media.duration > 0 ? clipDuration(media.duration) : '照片'}</span></div>
          {!locked && <button type="button" className="x" aria-label={`移除 ${media.name}`} onClick={() => void remove(media.id)}><X size={13} aria-hidden="true" /></button>}
        </li>)}</ul>
        <button type="button" className="ge-addbtn" disabled={locked || !!upload} title={locked ? '停止后可以接着改' : undefined} onClick={() => picker.current?.click()}>
          {locked ? <Lock size={13} aria-hidden="true" /> : upload ? <Spinner size={13} /> : <Plus size={14} aria-hidden="true" />}
          {upload ? `正在上传 ${upload.index + 1}/${upload.total} · ${Math.round(upload.ratio * 100)}%` : '添加素材'}
        </button>
        <input ref={picker} type="file" accept="video/*,image/*" multiple hidden onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void add(files) }} />
      </section>
      : <section className="ge-sec">
        <h4>文案 <span>{textCount(project.inputs.text)} 字</span></h4>
        <p className="ge-copy">{project.inputs.text || '（没有文案）'}</p>
      </section>}
    <section className="ge-sec">
      <h4>设定</h4>
      <div className="ge-kv"><span>比例</span><b>{ASPECT_LABELS[project.settings.aspect]}</b></div>
      <div className="ge-kv"><span>片长</span><b>{lengthSummary(project.settings.length)}</b></div>
      {project.inputs.note && <div className="ge-kv"><span>想说的</span><b title={project.inputs.note}>{project.inputs.note}</b></div>}
    </section>
  </aside>
}

/** The divider on the panel's left edge: drag or use the arrow keys; double-click returns to 380. The width is remembered. */
function Resizer({ width, onChange, onCommit, onDragging }: { width: number; onChange: (width: number) => void; onCommit: (width: number) => void; onDragging: (on: boolean) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const set = (next: number) => { const value = clampAgentWidth(next); onChange(value); return value }
  return <button type="button" className="ge-resizer" role="separator" aria-orientation="vertical" aria-label="调整对话框宽度"
    aria-valuemin={AGENT_PANEL.min} aria-valuemax={AGENT_PANEL.max} aria-valuenow={width} data-dragging={dragging || undefined}
    title="拖动调宽，双击恢复"
    onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      drag.current = { x: event.clientX, width }
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true); onDragging(true)
    }}
    onPointerMove={event => { if (drag.current) set(drag.current.width + drag.current.x - event.clientX) }}
    onPointerUp={event => {
      if (!drag.current) return
      const value = set(drag.current.width + drag.current.x - event.clientX)
      drag.current = null; setDragging(false); onDragging(false); onCommit(value)
    }}
    onPointerCancel={() => { drag.current = null; setDragging(false); onDragging(false) }}
    onDoubleClick={() => onCommit(set(AGENT_PANEL.initial))}
    onKeyDown={(event: ReactKeyboardEvent) => {
      const step = event.shiftKey ? 40 : 16
      const next = event.key === 'ArrowLeft' ? width + step : event.key === 'ArrowRight' ? width - step : event.key === 'Home' ? AGENT_PANEL.min : event.key === 'End' ? AGENT_PANEL.max : undefined
      if (next === undefined) return
      event.preventDefault(); onCommit(set(next))
    }} />
}

function PageState({ title, text, retry }: { title: string; text?: string; retry?: () => void }) {
  return <main className="ge ge-state">
    <h1>{title}</h1>
    {text && <p>{text}</p>}
    <div className="ge-state__actions">
      {retry && <button type="button" className="ge-soft" data-solid onClick={retry}>再试一次</button>}
      <Link className="ge-soft" to="/studio">回到剪辑台</Link>
      <Link className="ge-soft" to={GENERAL_EDIT_PATH}>新建通用工程</Link>
    </div>
  </main>
}

/** /general/projects/:id: left 风格·素材·设定, centre the preview, right the Codex conversation (resizable). */
export default function GeneralProject() {
  const { id = '' } = useParams()
  const { project, setProject, error, connection, reload } = useGeneralProject(id)
  const [picked, setPicked] = useState<number>()
  const [draft, setDraft] = useState('')
  const [reference, setReference] = useState<StageReference>()
  const [busy, setBusy] = useState('')
  const [width, setWidth] = useState(() => readAgentWidth(storage()))
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [resizing, setResizing] = useState(false)
  const stage = useRef<StageHandle>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const attachComposer = useCallback((element: HTMLTextAreaElement | null) => { composer.current = element }, [])

  useEffect(() => {
    const resize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  // A new version comes to the front by itself (reset while rendering, not in an effect).
  const versionCount = project?.versions.length ?? 0
  const [seenVersions, setSeenVersions] = useState(versionCount)
  if (seenVersions !== versionCount) { setSeenVersions(versionCount); setPicked(undefined) }

  const act = useCallback(async (name: string, call: () => Promise<Project>, after?: () => void) => {
    if (busy) return
    setBusy(name)
    try { setProject(await call()); after?.(); announceGeneralChange() }
    catch (failure) { toast.error(errorText(failure)) }
    finally { setBusy('') }
  }, [busy, setProject])

  if (!project) {
    if (!error) return <main className="ge ge-state" aria-busy="true"><Spinner /><p>正在打开工程…</p></main>
    if (error instanceof GeneralApiError && error.status === 404) return <PageState title="找不到这个工程" text="它可能已经移进回收站，或者通用剪辑的服务还没就绪。" />
    return <PageState title="这个工程暂时打不开" text={errorText(error)} retry={() => void reload()} />
  }

  const style = styleById(LIBRARY_STYLES, project.styleId)
  const active = runActive(project.run)
  const shown = shownVersion(project, picked)
  const canQuote = !!shown && !(active && latestRenderFrame(project.run))
  const brief = briefLine(project.inputs.kind, styleNameOf(project.styleId, style), project.inputs.media, project.settings)
  const pickVersion = (n: number) => { setPicked(n); if (reference && reference.version !== n) setReference(undefined) }

  const actions: AgentActions = {
    stop: () => void act('stop', () => generalApi.stop(project.id)),
    resume: () => void act('resume', () => generalApi.resume(project.id)),
    generate: () => void act('generate', () => generalApi.generate(project.id)),
    network: allow => void act(allow ? 'network-yes' : 'network-no', () => generalApi.network(project.id, allow)),
    setAgent: choice => void act('agent', () => generalApi.patch(project.id, { agent: choice ?? null })),
    setNetwork: on => void act('agent', () => generalApi.patch(project.id, { network: on })),
    send: () => {
      const text = draft.trim()
      if (!text) return
      void act('send', () => generalApi.send(project.id, text, reference?.reference), () => { setDraft(''); setReference(undefined) })
    },
  }
  const prefill = (segment: GeneralSegment, index: number) => {
    const next = applyPrefill(draft, redoPrefill(segment, index))
    setDraft(next)
    requestAnimationFrame(() => {
      const element = composer.current
      if (!element) return
      element.focus()
      const end = next.indexOf('\n') < 0 ? next.length : next.indexOf('\n')
      element.setSelectionRange(end, end)
    })
  }
  const quote = (value: StageReference) => {
    setReference(value)
    requestAnimationFrame(() => composer.current?.focus())
  }
  const ask = (line: string) => {
    const next = draft.trim() ? `${line}\n${draft}` : line
    setDraft(next)
    requestAnimationFrame(() => { const element = composer.current; if (element) { element.focus(); element.setSelectionRange(line.length, line.length) } })
  }
  const editing = !!shown?.layersUrl && !active
  const panelWidth = fittedAgentWidth(width, viewport)

  return <>
    <NavSlot id="workspace-project-title-slot"><ProjectTitle project={project} onRename={async name => { setProject(await generalApi.patch(project.id, { name })); announceGeneralChange() }} /></NavSlot>
    <NavSlot id="workspace-primary-action-slot">
      {shown && !active ? <ExportMenu project={project} version={shown.n} />
        : <span className="ge-export" role="link" aria-disabled="true" title={active ? '做完以后可以导出' : '还没有可以导出的版本'}><Download aria-hidden="true" />导出</span>}
    </NavSlot>
    {project.versions.length > 0 && <NavSlot id="workspace-preview-island-slot">
      <div className="workspace-preview-island preview-style-capsule" aria-label="版本">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="preview-style-capsule__part" aria-label={`版本：${shown ? versionName(shown.n) : '还没有'}`}>
              <em>版本</em>{shown ? versionName(shown.n) : '还没有'}<ChevronDown aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="preview-style-menu">
            <DropdownMenuLabel>Codex 交的版本</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={String(shown?.n ?? '')} onValueChange={value => pickVersion(Number(value))}>
              {[...project.versions].reverse().map(version => <DropdownMenuRadioItem key={version.n} value={String(version.n)}>{versionName(version.n)}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </NavSlot>}
    {editing && shown ? <GeneralEditor key={shown.n} project={project} version={shown} style={style} onProject={setProject} onAsk={ask} onRedoSegment={prefill}
      onQuote={quote} reference={reference}
      chat={<GeneralAgentPanel project={project} brief={brief} shown={shown} canQuote onPickVersion={pickVersion}
        draft={draft} setDraft={setDraft} reference={reference} clearReference={() => setReference(undefined)}
        busy={busy} actions={actions} connection={connection} composer={attachComposer} resizer={null} />} /> :
    <div className="ge ge-work" style={{ '--ge-agent-w': `${panelWidth}px` } as CSSProperties} data-resizing={resizing || undefined}>
      <SidePanel project={project} style={style} locked={active} onProject={setProject} />
      <GeneralStage project={project} posterFallback={style?.poster} picked={shown} onPickVersion={pickVersion}
        reference={reference} onReference={quote} onSegment={prefill} composing={!!draft.trim() || !!reference} handle={stage} />
      <GeneralAgentPanel project={project} brief={brief} shown={shown} canQuote={canQuote} onPickVersion={pickVersion}
        draft={draft} setDraft={setDraft} reference={reference} clearReference={() => setReference(undefined)}
        busy={busy} actions={actions} connection={connection} composer={attachComposer}
        resizer={<Resizer width={panelWidth} onChange={setWidth} onCommit={value => setWidth(saveAgentWidth(storage(), value))} onDragging={setResizing} />} />
    </div>}
  </>
}
