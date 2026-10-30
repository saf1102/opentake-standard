import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { Lock, Maximize, Pause, Play } from 'lucide-react'
import type { GeneralProject, GeneralReference, GeneralSegment, GeneralVersion } from './general-contract'
import {
  boxFromPoints, clockTime, containBox, latestRenderFrame, nextVersionNumber, planSketchLine, renderProgress, runActive, segmentFill, segmentSlots,
  selectionInMedia, sortedVersions, stepRows, stripPosition, versionChipTime, versionName, type Box,
} from './general-logic'
import { Spinner } from './GeneralBits'
import { GeneralRunWall } from './GeneralRunWall'
import { cropFrame } from './frame-grab'
import { IS_MAC } from './platform'

/** A ⌘ selection: what goes to the server, plus where to draw it on the picture of that version. */
export type StageReference = { reference: GeneralReference; fraction: Box; version: number }
export type StageHandle = { seek: (seconds: number) => void }

/** ⌘ on a Mac; Ctrl elsewhere (there is no ⌘ key). */
const selectKey = (event: { metaKey: boolean; ctrlKey: boolean }) => (IS_MAC ? event.metaKey : event.ctrlKey)
const typingTarget = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, button, [contenteditable=true], [role=slider]')

/** Small frames for the segment strip, taken from the version's own video in the page (cached per video). */
const thumbCache = new Map<string, (string | undefined)[]>()
function useSegmentThumbs(url: string | undefined, segments: readonly GeneralSegment[]) {
  const times = segments.map(segment => Math.max(0, Math.min(segment.end - 0.05, segment.start + Math.min(0.6, (segment.end - segment.start) / 2))))
  const key = url && times.length ? `${url}#${times.map(time => time.toFixed(2)).join(',')}` : ''
  const [made, setMade] = useState<{ key: string; thumbs: (string | undefined)[] }>({ key: '', thumbs: [] })
  useEffect(() => {
    if (!key || !url || thumbCache.has(key)) return
    let cancelled = false
    const video = document.createElement('video')
    video.muted = true; video.preload = 'auto'; video.playsInline = true
    const wait = (event: 'loadeddata' | 'seeked', ms: number) => new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), ms)
      video.addEventListener(event, () => { window.clearTimeout(timer); resolve() }, { once: true })
      video.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('error')) }, { once: true })
    })
    const at = key.split('#')[1].split(',').map(Number)
    const out: (string | undefined)[] = []
    void (async () => {
      video.src = url
      await wait('loadeddata', 15000)
      const canvas = document.createElement('canvas')
      canvas.width = 192; canvas.height = 108
      const context = canvas.getContext('2d')
      for (const [index, time] of at.entries()) {
        if (cancelled) return
        video.currentTime = time
        await wait('seeked', 6000)
        if (!context) break
        const w = video.videoWidth || 192, h = video.videoHeight || 108
        const scale = Math.max(canvas.width / w, canvas.height / h)
        context.drawImage(video, (canvas.width - w * scale) / 2, (canvas.height - h * scale) / 2, w * scale, h * scale)
        out[index] = canvas.toDataURL('image/jpeg', 0.72)
        if (!cancelled) setMade({ key, thumbs: [...out] })
      }
      thumbCache.set(key, out)
    })().catch(() => { /* the strip keeps its plain segments */ }).finally(() => { video.removeAttribute('src'); video.load() })
    return () => { cancelled = true }
  }, [key, url])
  return thumbCache.get(key) ?? (made.key === key ? made.thumbs : [])
}

const percent = (value: number) => `${(value * 100).toFixed(3)}%`

function SegmentStrip({ segments, mode, rendered, time, thumbs, onSegment }: {
  segments: readonly GeneralSegment[]; mode: 'plan' | 'version'; rendered?: number; time?: number
  thumbs: readonly (string | undefined)[]; onSegment?: (segment: GeneralSegment, index: number) => void
}) {
  const slots = segmentSlots(segments)
  if (!slots.length) return null
  const head = mode === 'version' ? time : rendered
  return <div className="ge-segs" role={mode === 'version' ? 'group' : undefined} aria-label={mode === 'version' ? '片段（点一段可以重做它）' : '方案的片段'}>
    {slots.map(slot => {
      const style = { '--w': slot.weight } as CSSProperties
      if (mode === 'plan') {
        const fill = rendered === undefined ? 0 : segmentFill(slot, rendered)
        return <div key={slot.index} className="ge-seg" data-plan data-full={fill >= 1 || undefined} style={style}>
          <i className="ge-seg__fill" style={{ '--f': fill } as CSSProperties} aria-hidden="true" />
          {slot.label && <span>{slot.label}</span>}
        </div>
      }
      const thumb = thumbs[slot.index]
      return <button key={slot.index} type="button" className="ge-seg" style={style}
        title={`${slot.label || `第 ${slot.index + 1} 段`} · ${clockTime(slot.start)}–${clockTime(slot.end)}（点一下：重做这一段）`}
        aria-label={`${slot.label || `第 ${slot.index + 1} 段`}，${clockTime(slot.start)} 到 ${clockTime(slot.end)}，重做这一段`}
        onClick={() => onSegment?.(slot, slot.index)}>
        {thumb && <img src={thumb} alt="" draggable={false} />}
        {slot.label && <span>{slot.label}</span>}
      </button>
    })}
    {head !== undefined && <i className="ge-head" style={{ '--p': stripPosition(slots, head) } as CSSProperties} aria-hidden="true" />}
  </div>
}

function VersionsBar({ versions, shown, pending, onPick }: {
  versions: readonly GeneralVersion[]; shown?: number; pending?: { n: number; running: boolean }; onPick: (n: number) => void
}) {
  return <div className="ge-vers" role="group" aria-label="版本">
    <label>版本</label>
    {sortedVersions(versions).map(version => <button key={version.n} type="button" className="ge-ver" aria-pressed={version.n === shown} onClick={() => onPick(version.n)}
      title={`${versionName(version.n)}${version.note ? ` · ${version.note}` : ''}`}>
      <img src={version.posterUrl} alt="" draggable={false} /><b>{versionName(version.n)}</b>{versionChipTime(version.createdAt)}
    </button>)}
    {pending && <span className="ge-ver" data-ghost>
      {pending.running && <Spinner size={13} />}<b>{versionName(pending.n)}</b>{pending.running ? '生成中' : '发送后生成'}
    </span>}
  </div>
}

/**
 * The centre of the work page. While a run works: the newest rendered frame, or the plan's sketch, over the plan's
 * segments filled as far as the render has really got. Once a version exists: its video, the segment strip (click a
 * segment to ask for it again), ⌘-drag on the picture to quote a region, and the versions.
 */
export function GeneralStage({ project, posterFallback, picked, onPickVersion, reference, onReference, onSegment, composing, handle }: {
  project: GeneralProject; posterFallback?: string; picked?: GeneralVersion; onPickVersion: (n: number) => void
  reference?: StageReference; onReference: (value: StageReference) => void; onSegment: (segment: GeneralSegment, index: number) => void
  /** the composer holds a message, so the next version is about to be asked for */
  composing: boolean; handle?: Ref<StageHandle>
}) {
  const run = project.run
  const active = runActive(run)
  const frameImage = active ? latestRenderFrame(run) : undefined
  const mode: 'render' | 'player' | 'sketch' = frameImage ? 'render' : picked ? 'player' : 'sketch'
  const progress = renderProgress(run)
  const frame = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [media, setMedia] = useState({ w: 0, h: 0 })
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [armed, setArmed] = useState(false)
  const [drawing, setDrawing] = useState<Box | null>(null)
  const drag = useRef<{ x: number; y: number; id: number } | null>(null)
  const suppressClick = useRef(false)
  const thumbs = useSegmentThumbs(mode === 'player' ? picked?.videoUrl : undefined, picked?.segments ?? [])

  useImperativeHandle(handle, () => ({
    seek: (seconds: number) => { const element = video.current; if (element) { element.currentTime = Math.max(0, seconds); setTime(element.currentTime) } },
  }), [])

  // A new version starts from its beginning, paused (reset while rendering, not in an effect).
  const [shownUrl, setShownUrl] = useState(picked?.videoUrl)
  if (shownUrl !== picked?.videoUrl) { setShownUrl(picked?.videoUrl); setPlaying(false); setTime(0); setDuration(picked?.duration ?? 0) }

  useLayoutEffect(() => {
    const element = frame.current
    if (!element) return
    const measure = () => setBox({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [mode, active]) // the frame comes back when a run ends (the run wall stood in for it)

  // A smooth playhead while playing; timeupdate alone moves in quarter-second steps.
  useEffect(() => {
    if (!playing) return
    let frameId = 0
    const tick = () => { if (video.current) setTime(video.current.currentTime); frameId = requestAnimationFrame(tick) }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [playing])

  // ⌘ held: the picture turns into a selection surface (crosshair).
  useEffect(() => {
    if (mode !== 'player') return
    const key = (event: KeyboardEvent) => setArmed(selectKey(event))
    const off = () => setArmed(false)
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', off)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', off) }
  }, [mode])

  const toggle = useCallback(() => {
    const element = video.current
    if (!element) return
    if (element.paused) void element.play().catch(() => setPlaying(false))
    else element.pause()
  }, [])

  // Space plays and pauses unless the person is typing or on a control.
  useEffect(() => {
    if (mode !== 'player') return
    const key = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || event.metaKey || event.ctrlKey || event.altKey || typingTarget(event.target)) return
      event.preventDefault(); toggle()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [mode, toggle])

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = frame.current!.getBoundingClientRect()
    return { x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)), y: Math.min(rect.height, Math.max(0, event.clientY - rect.top)) }
  }
  const finishDrag = (event: { clientX: number; clientY: number }) => {
    const start = drag.current, element = video.current
    drag.current = null
    setDrawing(null)
    if (!start || !element || !picked) return
    const result = selectionInMedia(boxFromPoints(start, local(event)), box, { w: element.videoWidth, h: element.videoHeight })
    if (!result) return
    onReference({
      reference: { time: Math.round(element.currentTime * 100) / 100, rect: result.pixels, imageDataUrl: cropFrame(element, result.pixels) },
      fraction: result.fraction, version: picked.n,
    })
  }

  const content = containBox(box.w, box.h, media.w || (picked ? 16 : 0), media.h || (picked ? 9 : 0))
  const showRef = mode === 'player' && reference && picked && reference.version === picked.n ? reference.fraction : undefined
  const sketchPoster = project.inputs.media[0]?.poster ?? posterFallback
  const versions = project.versions
  const pending = active ? { n: nextVersionNumber(versions), running: true }
    : versions.length > 0 && composing ? { n: nextVersionNumber(versions), running: false } : undefined
  const planSegments = project.plan?.segments ?? []
  const currentStep = stepRows(run).find(row => row.tone === 'now' || row.tone === 'wait')

  // while Codex works, the stage shows the run itself: its steps, what each has made, the mark turning
  if (active) return <main className="ge-stage" data-running aria-label="预览"><GeneralRunWall project={project} poster={posterFallback} /></main>

  return <main className="ge-stage" data-aspect={project.settings.aspect} aria-label="预览">
    <div className="ge-group">
      {active && <div className="ge-lock" role="status"><Lock size={13} aria-hidden="true" />Codex 正在做片，手动编辑先锁住<span>· 停止后可以接着改</span></div>}
      <div ref={frame} className="ge-frame" data-sketch={mode === 'sketch' || undefined} data-armed={(armed && mode === 'player') || undefined}
        onPointerDown={event => {
          if (mode !== 'player' || event.button !== 0 || !selectKey(event)) return
          event.preventDefault()
          video.current?.pause()
          const point = local(event)
          drag.current = { ...point, id: event.pointerId }
          suppressClick.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          setDrawing({ ...point, w: 0, h: 0 })
        }}
        onPointerMove={event => { if (drag.current) setDrawing(boxFromPoints(drag.current, local(event))) }}
        onPointerUp={event => { if (drag.current) finishDrag(event) }}
        onPointerCancel={() => { drag.current = null; setDrawing(null) }}
        onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return }
          if (mode === 'player') toggle()
        }}>
        {mode === 'render' && <>
          <img src={frameImage} alt="最新渲染的画面" draggable={false} />
          <span className="ge-tag"><Spinner size={12} />最新渲染的画面</span>
        </>}
        {mode === 'player' && picked && <video ref={video} key={picked.videoUrl} src={picked.videoUrl} poster={picked.posterUrl} preload="metadata" playsInline
          aria-label={`${project.name}，${versionName(picked.n)}`}
          onLoadedMetadata={event => { setMedia({ w: event.currentTarget.videoWidth, h: event.currentTarget.videoHeight }); if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration) }}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onTimeUpdate={event => { if (!playing) setTime(event.currentTarget.currentTime) }} onSeeked={event => setTime(event.currentTarget.currentTime)} />}
        {mode === 'sketch' && <>
          {sketchPoster && <img src={sketchPoster} alt="" data-cover draggable={false} />}
          {project.plan
            ? <><span className="ge-tag">方案草图 · 还没渲染</span>
              <div className="ge-sketch"><b>《{project.plan.title}》</b><span>{planSketchLine(project.plan, project.inputs)}</span></div></>
            : <><span className="ge-tag">{active ? <><Spinner size={12} />还没有画面</> : '还没有画面'}</span>
              {active && currentStep && <div className="ge-sketch"><b>{currentStep.title}</b><span>方案写好后，这里先出草图</span></div>}</>}
        </>}
        {(showRef || drawing) && <div className="ge-pick" style={{ left: content.x, top: content.y, width: content.w, height: content.h }}>
          {showRef && !drawing && <div className="ge-sel" data-below={showRef.y < 0.12 || undefined}
            style={{ left: percent(showRef.x), top: percent(showRef.y), width: percent(showRef.w), height: percent(showRef.h) }}><em>已引用到对话</em></div>}
        </div>}
        {drawing && <div className="ge-sel" data-drawing style={{ left: drawing.x, top: drawing.y, width: drawing.w, height: drawing.h }} />}
      </div>

      {mode === 'player' && picked
        ? <div className="ge-bar">
          <button type="button" className="ge-play" aria-label={playing ? '暂停' : '播放'} onClick={toggle}>
            {playing ? <Pause size={14} fill="currentColor" aria-hidden="true" /> : <Play size={14} fill="currentColor" aria-hidden="true" />}
          </button>
          <span><b>{clockTime(time)}</b> / {clockTime(duration || picked.duration)}</span>
          <button type="button" className="ge-ico r" aria-label="全屏" title="全屏" onClick={() => void frame.current?.requestFullscreen?.().catch(() => {})}><Maximize size={15} aria-hidden="true" /></button>
        </div>
        : <div className="ge-bar">
          <span>{project.run?.state === 'failed' && !planSegments.length ? '本次生成未完成，工程已保留' : planSegments.length ? `方案 · ${planSegments.length} 段` : '方案准备中'}</span>
          <span className="r">{progress ? <><b>{active ? '渲染中' : '渲染到'}</b> {progress.done.toFixed(1)} / {progress.total.toFixed(1)} 秒</> : planSegments.length ? '还没开始渲染' : ''}</span>
        </div>}

      {mode === 'player' && picked
        ? <SegmentStrip segments={picked.segments} mode="version" time={time} thumbs={thumbs} onSegment={(segment, index) => {
          const element = video.current
          if (element) { element.pause(); element.currentTime = segment.start; setTime(segment.start) }
          onSegment(segment, index)
        }} />
        : <SegmentStrip segments={planSegments} mode="plan" rendered={progress?.done} thumbs={[]} />}
    </div>
    <VersionsBar versions={versions} shown={mode === 'player' ? picked?.n : undefined} pending={pending} onPick={onPickVersion} />
  </main>
}
