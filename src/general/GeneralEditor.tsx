/**
 * A layered version in the 口播 editor's frame (same layout, classes and timeline): media and style library on the
 * left, the preview, 对话 / 属性 on the right, the tracks below. The middle tier of editing: switch tracks off, change
 * a text and its preset, keep or drop a clip's sound, volume in three steps, delete a clip. Each change is saved as
 * versions/vN/edited.json; the agent's layers.json stays as it delivered it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, Palette, RotateCcw, Scissors, SlidersHorizontal, Volume2, VolumeX, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { MediaLibrary, type LeftLibraryTab } from '@/studio/components/MediaLibrary'
import { TimelineEditor } from '@/studio/components/TimelineEditor'
import { registerMediaUrls, type MediaUrlKind } from '@/studio/api'
import { resizedTimelineDuration, snapTimelineClipEnd, snapTimelineClipStart, snappedTimelineStart } from '@/studio/timeline-math'
import { timecode } from '@/studio/timecode'
import type { Timeline, TimelineClip, TimelineTrack } from '@/types/editor'
import type { LibraryStyle } from '@/workspace/style-library/style-library'
import { errorText, generalApi, generalEditorApi, type TextPresets } from './general-api'
import type { GeneralLayers, GeneralMedia, GeneralProject, GeneralSegment, GeneralVersion } from './general-contract'
import { editProjectFor, mediaFileName, soundAssetId } from './general-editor-model'
import { mediaKindOf, styleNameOf } from './general-logic'
import { GeneralPreview } from './GeneralPreview'
import { type StageReference } from './GeneralStage'
import { grabArea } from './frame-grab'
import { Spinner } from './GeneralBits'
// the left column's 素材 / 风格库 tabs are styled with the motion library's sheet (the 口播 editor loads it through that panel)
import '@/studio/components/motion-library-panel.css'
import { NO_FIXED_TRACKS, copyTimelineClips, pasteTimelineClips } from '@/studio/timeline-clipboard'
import { ClipSpeedControl } from '@/studio/components/ClipSpeedControl'
import { RadialFades, RadialText, RadialVolume, type RadialItem } from '@/studio/components/ClipRadial'
import { maxClipFade } from '@/studio/clip-audio'
import { timingKey } from './hf-timing'
import { setGeneralPlayhead } from './composer-tokens'
import { followersOf, freezeAnchors, reanchor } from './hf-anchor'
import { splitBySound } from './hf-split'
import { SCENE_SPEED_MARKS, SCENE_SPEED_MAX, SCENE_SPEED_MIN, clipSpeed, isScene, sceneSpan, setSceneSpeed, speedToLength } from './hf-speed'

const VOLUME_DB = { low: -8, mid: 0, high: 4 } as const
type VolumeStep = keyof typeof VOLUME_DB
const gain = (step: VolumeStep) => Math.round(10 ** (VOLUME_DB[step] / 20) * 1000) / 1000
const TRACK_ROW: Record<string, number> = { page: 26, subtitle: 26, video: 34, voice: 38, music: 38, sfx: 38 }
const noop = () => {}

type Props = {
  project: GeneralProject; version: GeneralVersion; style?: LibraryStyle
  /** the Codex conversation, shown in the 对话 tab */
  chat: ReactNode
  /** put a line in the composer (and the 对话 tab comes to the front) */
  onAsk: (line: string) => void
  onRedoSegment: (segment: GeneralSegment, index: number) => void
  onProject: (project: GeneralProject) => void
  /** ⌘-drag on the preview: the area quoted into the conversation, and the one quoted now */
  onQuote?: (value: StageReference) => void
  reference?: StageReference
}

function findClip(timeline: Timeline, id?: string) {
  for (const track of timeline.tracks) for (const clip of track.clips) if (clip.id === id) return { track, clip }
  return undefined
}

/** The layers and the person's edits of them, with undo; every change is saved a moment later. */
function useEditedLayers(projectId: string, version: GeneralVersion) {
  const [state, setState] = useState<{ layers?: GeneralLayers; edited: boolean; error?: string }>({ edited: false })
  const history = useRef<{ past: GeneralLayers[]; future: GeneralLayers[] }>({ past: [], future: [] })
  const timer = useRef<number>(undefined)
  const [saving, setSaving] = useState(false)
  // a HyperFrames film's page is served with the saved edits: after a save that changed its timing or sound the
  // preview loads it again (words and moves apply live and need no reload)
  const [pageRevision, setPageRevision] = useState(0)
  const savedTiming = useRef<string>(undefined)
  useEffect(() => {
    let alive = true
    // the page keys this editor by version, so a new version is a new editor
    generalEditorApi.layers(projectId, version.n, version.layersUrl!).then(
      value => { if (alive) { if (value.layers?.engine === 'hyperframes') savedTiming.current = timingKey(value.layers); setState(value) } },
      failure => { if (alive) setState({ edited: false, error: errorText(failure) }) },
    )
    return () => { alive = false }
  }, [projectId, version.n, version.layersUrl])
  const save = useCallback((layers: GeneralLayers) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setSaving(true)
      generalEditorApi.saveEdited(projectId, version.n, layers).then(() => {
        if (layers.engine !== 'hyperframes') return
        const key = timingKey(layers)
        if (key !== savedTiming.current) { savedTiming.current = key; setPageRevision(n => n + 1) }
      }, failure => toast.error(`改动没存上：${errorText(failure)}`)).finally(() => setSaving(false))
    }, 500)
  }, [projectId, version.n])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const commit = useCallback((change: (timeline: Timeline) => void) => {
    setState(current => {
      if (!current.layers) return current
      const timeline = structuredClone(current.layers.timeline)
      change(timeline)
      const next = { ...current.layers, timeline }
      history.current = { past: [...history.current.past.slice(-80), current.layers], future: [] }
      save(next)
      return { ...current, layers: next, edited: true }
    })
  }, [save])
  const step = useCallback((back: boolean) => {
    setState(current => {
      const h = history.current, from = back ? h.past : h.future
      const target = from[from.length - 1]
      if (!current.layers || !target) return current
      history.current = back ? { past: h.past.slice(0, -1), future: [...h.future, current.layers] } : { past: [...h.past, current.layers], future: h.future.slice(0, -1) }
      save(target)
      return { ...current, layers: target, edited: true }
    })
  }, [save])
  return { ...state, saving, pageRevision, commit, undo: () => step(true), redo: () => step(false) }
}

/** A footage clip's source: another of the project's media, and which stretch of it plays (in-point slider). */
function FootageSource({ clip, media, layers, onPatch }: { clip: TimelineClip; media: GeneralMedia[]; layers: GeneralLayers; onPatch: (fn: (c: TimelineClip) => void) => void }) {
  const current = media.find(m => m.id === clip.assetId) ?? media.find(m => mediaFileName(m, layers) === clip.params.media)
  const need = clip.sourceDuration ?? clip.duration * Number(clip.params.speed ?? 1)
  const room = current && current.duration > 0 ? Math.max(0, current.duration - need) : 0
  const [inPoint, setInPoint] = useState(clip.sourceStart)
  const keep = () => { if (Math.abs(inPoint - clip.sourceStart) > 1e-3) onPatch(c => { c.sourceStart = Math.round(inPoint * 100) / 100 }) }
  return <>
    {room > 0.05 && <label className="ge-field"><span>用哪一截</span>
      <input type="range" className="ge-slide" min={0} max={room} step={0.05} value={Math.min(inPoint, room)} aria-valuetext={`从 ${timecode(inPoint)} 开始`}
        onChange={event => setInPoint(Number(event.currentTarget.value))} onPointerUp={keep} onKeyUp={keep} onBlur={keep} />
      <small>从素材的 {timecode(inPoint)} 开始，用 {need.toFixed(1)} 秒（共 {timecode(current!.duration)}）</small>
    </label>}
    {media.length > 0 && <div className="ge-field"><span>换素材</span>
      <div className="ge-swap">{media.map(m => <button key={m.id} type="button" className={m.id === current?.id ? 'active' : ''} title={m.name} aria-pressed={m.id === current?.id}
        onClick={() => {
          if (m.id === current?.id) return
          if (m.duration > 0 && m.duration < need) toast(`「${m.name}」只有 ${m.duration.toFixed(1)} 秒，比这一段短，结尾会停在最后一帧`)
          onPatch(c => {
            c.params = { ...c.params, media: mediaFileName(m, layers) }
            c.assetId = m.id
            c.name = m.name
            c.sourceStart = m.duration > 0 ? Math.max(0, Math.min(c.sourceStart, m.duration - need)) : 0
          })
        }}>
        <span className="th">{m.poster && <img src={m.poster} alt="" draggable={false} />}</span><b>{m.name}</b>
      </button>)}</div>
      <small>也可以先在左边素材库导入新素材</small>
    </div>}
  </>
}

/**
 * 动效卡变速 (S先生 11-01): the scene's whole animation played faster or slower, its length following; a scene that
 * moves some other way (hf-speed.ts on the server says which) only trims.
 */
function SceneSpeed({ clip, track, speedable, onPatch, hint }: { clip: TimelineClip; track: TimelineTrack; speedable: boolean; onPatch: (change: (c: TimelineClip) => void) => void; hint?: boolean }) {
  if (!speedable) return <p className="ge-insp-note">这段动画的写法不能变速：拖右边缘只会截取。要整段加快，让 Codex 用 CSS 动画或逐帧脚本重做这一段。</p>
  const span = sceneSpan(clip)
  const next = track.clips.filter(c => c.id !== clip.id && c.start >= clip.start + 1e-6).sort((a, b) => a.start - b.start)[0]
  return <>
    <ClipSpeedControl rate={clipSpeed(clip)} sourceSeconds={span} minRate={next ? span / Math.max(0.05, next.start - clip.start) : undefined}
      range={[SCENE_SPEED_MIN, SCENE_SPEED_MAX]} marks={SCENE_SPEED_MARKS} animation onChange={rate => onPatch(c => setSceneSpeed(c, rate))} />
    {hint && <div className="clip-radial-field"><p>按住 ⌥ 拖右边缘也能变速 · 双击滑条恢复 1×</p></div>}
  </>
}

/**
 * While a scene's end is ⌥ dragged: its speed above the end, and where its animation ran before, pressed into the
 * clip (or the clip running past it, slower).
 */
function SpeedDragHint({ clipId, rate, from, to, pps }: { clipId: string; rate: number; from: number; to: number; pps: number }) {
  const [box, setBox] = useState<DOMRect>()
  useLayoutEffect(() => { setBox(document.querySelector(`[data-timeline-clip-id="${CSS.escape(clipId)}"]`)?.getBoundingClientRect()) }, [clipId, to, pps])
  if (!box) return null
  const pressed = (from - to) * pps
  return createPortal(<>
    {pressed > 2 && <div className="clip-speed-drag-ghost" style={{ left: box.right, top: box.top, width: pressed, height: box.height }} aria-hidden="true">{pressed > 64 && <span>‹‹ 压进来</span>}</div>}
    <div className="clip-speed-drag-stem" style={{ left: box.right, top: box.top - 14 }} aria-hidden="true" />
    <div className="clip-speed-drag-hint" style={{ left: box.right, top: box.top - 14 }} role="status">
      <div><kbd>⌥</kbd><span>变速</span><b>{rate < 1 ? rate.toFixed(2).replace(/0$/, '') : rate.toFixed(1).replace(/\.0$/, '')}×</b></div>
      <small>{from.toFixed(1)} 秒 → {to.toFixed(1)} 秒 · 动画完整播完</small>
    </div>
  </>, document.body)
}

function ClipInspector({ timeline, clipId, presets, segments, media, layers, speedable, onCommit, onAsk, onRedoSegment, onSplitSounds }: {
  timeline: Timeline; clipId?: string; presets: Record<string, unknown>; segments: GeneralSegment[]; media: GeneralMedia[]; layers: GeneralLayers
  /** which scene pages can play at another speed, by path */
  speedable: Record<string, boolean>
  onCommit: (change: (timeline: Timeline) => void) => void; onAsk: (line: string) => void; onRedoSegment: (segment: GeneralSegment, index: number) => void
  onSplitSounds: (clip: TimelineClip) => void
}) {
  const found = findClip(timeline, clipId)
  // keyed by clip, so another clip starts from its own text
  const [text, setText] = useState(found?.clip.text ?? '')
  if (!found) return <div className="inspector-empty-state ge-insp-empty"><SlidersHorizontal aria-hidden /><p>点时间线上的片段，在这里改它</p><small>改字、换样式、开关原声、调音量</small></div>
  const { track, clip } = found
  const patch = (fn: (c: TimelineClip) => void) => onCommit(t => { const hit = findClip(t, clip.id); if (hit && !hit.track.locked) fn(hit.clip) })
  const segmentIndex = segments.findIndex(s => clip.start >= s.start - 1e-6 && clip.start < s.end)
  const segment = segments[segmentIndex]
  // every preset of the style can be chosen (S先生 10-25: 方向 A); those made for this text's role come first, and
  // text.js sizes the others to the role (presetForRole)
  const role = String(clip.params.role ?? 'caption')
  const fits = (p: unknown) => { const roles = (p as { roles?: string[] }).roles; return !roles?.length || roles.includes(role) }
  const choices = [...Object.entries(presets).filter(([, p]) => fits(p)), ...Object.entries(presets).filter(([, p]) => !fits(p))].map(([name]) => name)
  const range = `${timecode(clip.start)} – ${timecode(clip.start + clip.duration)}`
  return <div className="ge-insp">
    <header><small>{track.name}</small><b title={clip.name}>{clip.name || '（未命名）'}</b><span>{range}</span></header>
    {track.kind === 'subtitle' && (clip.params.hf !== true || clip.params.line === true) && <>
      <label className="ge-field"><span>文字</span>
        <textarea value={text} rows={3} onChange={event => setText(event.target.value)}
          onBlur={() => { if (text !== clip.text) patch(c => { c.text = text; c.name = text.replace(/[{}]/g, '').split('\n')[0] }) }} />
        {clip.params.line !== true && <small>用 {'{'}花括号{'}'} 包住的字会用强调色</small>}
      </label>
      {clip.params.line !== true && choices.length > 0 && <div className="ge-field"><span>样式</span>
        <div className="ge-chips">{choices.map(name => <button key={name} type="button" className={clip.params.preset === name ? 'active' : ''}
          onClick={() => patch(c => { c.params = { ...c.params, preset: name } })}>{name}</button>)}</div>
      </div>}
    </>}
    {track.kind === 'video' && <div className="ge-field"><span>原声</span>
      <div className="ge-row">
        <button type="button" className={`ge-toggle ${clip.params.sound ? 'active' : ''}`} aria-pressed={Boolean(clip.params.sound)}
          onClick={() => patch(c => { const on = !c.params.sound; c.params = { ...c.params, sound: on }; c.volume = on ? gain(((c.params.volumeStep as VolumeStep) || 'mid')) : 0 })}>
          {clip.params.sound ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />}{clip.params.sound ? '保留原声' : '静音'}
        </button>
      </div>
    </div>}
    {track.kind === 'video' && <FootageSource key={`${clip.params.media}:${clip.sourceStart}`} clip={clip} media={media} layers={layers} onPatch={patch} />}
    {track.kind === 'video' && (() => {
      const speed = Number(clip.params.speed ?? 1) || 1, source = clip.sourceDuration ?? clip.duration * speed
      const next = track.clips.filter(c => c.id !== clip.id && c.start >= clip.start + 1e-6).sort((a, b) => a.start - b.start)[0]
      return <ClipSpeedControl rate={speed} sourceSeconds={source} minRate={next ? source / Math.max(0.05, next.start - clip.start) : undefined}
        onChange={rate => patch(c => { const span = c.sourceDuration ?? c.duration * (Number(c.params.speed ?? 1) || 1); c.sourceDuration = span; c.params = { ...c.params, speed: rate }; c.duration = span / rate })} />
    })()}
    {track.kind === 'page' && isScene(clip) && <div className="ge-field"><span>变速</span>
      <SceneSpeed clip={clip} track={track} speedable={speedable[String(clip.params.sub)] !== false} onPatch={patch} /></div>}
    {(track.kind === 'page' || clip.params.hf === true) && Object.keys((clip.params.textEdits as Record<string, string> | undefined) ?? {}).length > 0 && <div className="ge-field"><span>{track.kind === 'subtitle' ? '改过的字幕' : '页面里改过的字'}</span>
      <ul className="ge-edits">{Object.entries(clip.params.textEdits as Record<string, string>).map(([name, value]) => <li key={name}><b>{value}</b>
        <button type="button" onClick={() => patch(c => { const next = { ...(c.params.textEdits as Record<string, string>) }; delete next[name]; c.params = { ...c.params, textEdits: next } })}>还原</button></li>)}</ul>
    </div>}
    {['voice', 'music', 'sfx'].includes(track.kind) && <p className="ge-insp-note">{clip.params.hf === true
      ? `音量和淡入淡出在时间线的片段上直接拖；整条${track.name}的音量在左边轨道头调。${track.kind !== 'music' ? '挪动画面时，它跟着所属的那段画面走。' : ''}`
      : `音量在时间线左边的轨道头调，按分贝调整整条${track.name}。`}</p>}
    {canSplitSounds(clip, track) && <div className="ge-insp-actions"><button type="button" className="ge-insp-btn" onClick={() => onSplitSounds(clip)}><Scissors size={14} aria-hidden />按声音切开</button></div>}
    {track.kind === 'page' && clip.params.hf !== true && <p className="ge-insp-note">这是 Codex 做的{track.name}。里面的字和图形，在预览上单击可以移动、调大小、旋转，双击可以改字；要换整段画面，让 Codex 重做这一段。</p>}
    {clip.params.hf === true && clip.params.line !== true && (track.kind === 'page' || track.kind === 'subtitle') && <p className="ge-insp-note">这是 Codex 做的{track.name}。里面的字在预览上双击可以直接改；要换整段画面，让 Codex 重做这一段。</p>}
    {clip.params.line === true && <p className="ge-insp-note">字幕一句一条：可以挪、裁两头、删、复制；字在这里改，或在预览上双击改。样子跟着这条片子的字幕页走。</p>}
    <div className="ge-insp-actions">
      {segment && <button type="button" className="ge-insp-btn" onClick={() => onRedoSegment(segment, segmentIndex)}><Wand2 size={14} aria-hidden />让 Codex 重做这一段</button>}
      <button type="button" className="ge-insp-btn" onClick={() => onAsk(`改「${track.name}」里的「${clip.name}」（${range}）：`)}><MessageSquare size={14} aria-hidden />跟 Codex 说说这个片段</button>
    </div>
  </div>
}

/**
 * `followers`: the narration and effects that move with a scene (hf-anchor.ts), at their new starts. `speed`: a scene's
 * end ⌥ dragged plays its whole animation in the new length (动效卡变速), `from` the length it had.
 */
type Drag = { clipId: string; start: number; duration: number; sourceStart: number; followers?: { id: string; start: number }[]; speed?: number; from?: number }
/** Kinds whose clips must not overlap on their track (one picture at a time). */
const SOLID = new Set(['page', 'video'])
/** 按声音切开 is for a HyperFrames sound long enough to hold several (S先生 10-31). */
const canSplitSounds = (clip: TimelineClip, track: TimelineTrack) => clip.params.hf === true && clip.params.tag === 'audio' && typeof clip.params.src === 'string' && (track.kind === 'sfx' || track.kind === 'voice') && clip.duration >= 1
const withDrag = (layers: GeneralLayers, drag?: Drag): GeneralLayers => {
  if (!drag) return layers
  const timeline = structuredClone(layers.timeline)
  const hit = findClip(timeline, drag.clipId)
  if (hit) Object.assign(hit.clip, { start: drag.start, duration: drag.duration, sourceStart: drag.sourceStart })
  if (hit && drag.speed !== undefined) hit.clip.params = { ...hit.clip.params, speed: drag.speed }
  for (const follower of drag.followers ?? []) { const one = findClip(timeline, follower.id); if (one) one.clip.start = follower.start }
  return { ...layers, timeline }
}

export function GeneralEditor({ project, version, style, chat, onAsk, onRedoSegment, onProject, onQuote, reference }: Props) {
  const { layers, edited, error, saving, pageRevision, commit, undo, redo } = useEditedLayers(project.id, version)
  const [time, setTime] = useState(0)
  // for 「当前播放头」 in the composer's @ menu
  useEffect(() => setGeneralPlayhead(time), [time])
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [zoom, setZoom] = useState(1)
  const [tab, setTab] = useState<'chat' | 'props'>('chat')
  const [libraryTab, setLibraryTab] = useState<LeftLibraryTab>('media')
  const [pageOrigin, setPageOrigin] = useState<string>()
  // presets: the style's own, offered in 样式; all: also the general ones, so an older film's text draws as delivered
  const [presets, setPresets] = useState<{ presets: Record<string, unknown>; all: Record<string, unknown>; fonts: TextPresets['fonts'] }>({ presets: {}, all: {}, fonts: [] })
  const [uploadProgress, setUploadProgress] = useState<number>()
  const [extra, setExtra] = useState(0)
  const suppressClick = useRef(false)
  const playheadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    generalEditorApi.pageHostPort().then(port => { if (alive) setPageOrigin(`http://v${version.n}-${project.id}.localhost:${port}`) }, failure => toast.error(`画面页打不开：${errorText(failure)}`))
    return () => { alive = false }
  }, [project.id, version.n])
  useEffect(() => {
    let alive = true
    generalEditorApi.textPresets(project.id).then(value => { if (alive) setPresets({ presets: value.presets, all: value.all ?? value.presets, fonts: value.fonts ?? [] }) }, noop)
    return () => { alive = false }
  }, [project.id])
  // a HyperFrames film's sound files and their lengths: their waveforms on the 配音 / 配乐 / 音效 tracks
  const [sounds, setSounds] = useState<Record<string, number>>({})
  const hyperframes = layers?.engine === 'hyperframes'
  useEffect(() => {
    if (!hyperframes) return
    let alive = true
    generalEditorApi.soundFiles(project.id, version.n).then(value => { if (alive) setSounds(value) }, noop)
    return () => { alive = false }
  }, [project.id, version.n, hyperframes])
  // 动效卡变速: which scene pages can play their whole animation faster or slower
  const [speedable, setSpeedable] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!hyperframes) return
    let alive = true
    generalEditorApi.sceneSpeeds(project.id, version.n).then(value => { if (alive) setSpeedable(value) }, noop)
    return () => { alive = false }
  }, [project.id, version.n, hyperframes])
  // where this project's media (and the agent's shots) are, registered before the library draws, so its first paint
  // already asks the right addresses; let go when the editor closes
  const resolveMedia = useMemo(() => (assetId: string, kind: MediaUrlKind | 'peaks'): string | undefined => {
    const sound = Object.keys(sounds).find(src => soundAssetId(src) === assetId)
    if (sound !== undefined) return kind === 'peaks' ? generalEditorApi.waveformUrl(project.id, version.n, sound, 'peaks') : kind === 'waveform' ? generalEditorApi.waveformUrl(project.id, version.n, sound, 'picture') : ''
    // a shot the agent made: its still, and its stretch of this version's film
    if (assetId.startsWith('shot-')) {
      const clip = layers?.timeline.tracks.find(t => t.id === 'g-page')?.clips.find(c => `shot-${c.id}` === assetId)
      if (!clip) return undefined
      if (kind === 'thumbnail' || kind === 'filmstrip') return clip.params.thumb ? generalEditorApi.fileUrl(project.id, String(clip.params.thumb)) : ''
      if (kind === 'peaks' || kind === 'waveform' || kind === 'cursor') return ''
      return `${version.videoUrl}#t=${clip.start.toFixed(2)},${(clip.start + clip.duration).toFixed(2)}`
    }
    const media = project.inputs.media.find(m => m.id === assetId)
    if (!media) return undefined
    if (kind === 'thumbnail' || kind === 'filmstrip') return media.poster
    if (kind === 'peaks' || kind === 'waveform' || kind === 'cursor') return ''
    return generalEditorApi.fileUrl(project.id, `media/${mediaFileName(media, layers)}`)
  }, [project.id, project.inputs.media, layers, version.videoUrl, version.n, sounds])
  registerMediaUrls(project.id, resolveMedia)
  const unregister = useRef<() => void>(undefined)
  useEffect(() => { unregister.current = registerMediaUrls(project.id, resolveMedia) }, [project.id, resolveMedia])
  useEffect(() => () => unregister.current?.(), [])
  // fit the whole film into the timeline's width the first time it opens (set while rendering, not in an effect)
  const [fitted, setFitted] = useState(false)
  if (layers && !fitted) { setFitted(true); setZoom(Math.max(0.25, Math.min(4, (window.innerWidth - 260) / (layers.duration * 42)))) }

  // space plays and pauses, ⌘Z / ⇧⌘Z undo and redo (not while typing)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable=true]')) return
      if (event.code === 'Space') { event.preventDefault(); setPlaying(p => !p) }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // dragging a clip on the timeline (moving it, or trimming either end): shown live, kept as one undo step on release
  const [drag, setDrag] = useState<Drag>()
  const [snapGuide, setSnapGuide] = useState<number>()
  const shown = useMemo(() => layers ? withDrag(layers, drag) : undefined, [layers, drag])
  const editProject = useMemo(() => shown ? editProjectFor(project, shown, version.n, sounds) : undefined, [project, shown, version.n, sounds])
  const beginClip = (event: React.PointerEvent<HTMLElement>, clip: TimelineClip, track: TimelineTrack, edge?: 'left' | 'right') => {
    if (!layers || track.locked || event.button !== 0) return
    // a HyperFrames page draws from its own second 0: it moves and its end trims, its head does not
    // (a caption line is a line of words: its entrance starts from its own start, so its head trims too)
    if (edge === 'left' && clip.params.hf === true && clip.params.line !== true && !['audio', 'video'].includes(String(clip.params.tag))) return
    event.stopPropagation()
    const fps = layers.fps, pps = 42 * zoom, originX = event.clientX
    const speed = Number(clip.params.speed ?? 1), sources = track.kind === 'video' || ['voice', 'music', 'sfx'].includes(track.kind)
    // the room on a picture track: from the clip before to the clip after (others may overlap)
    const siblings = layers.timeline.tracks.find(t => t.id === track.id)?.clips.filter(c => c.id !== clip.id) ?? []
    const lo = SOLID.has(track.kind) ? Math.max(0, ...siblings.filter(c => c.start < clip.start).map(c => c.start + c.duration)) : 0
    const hi = SOLID.has(track.kind) ? Math.min(layers.duration, ...siblings.filter(c => c.start > clip.start).map(c => c.start)) : layers.duration
    const end = clip.start + clip.duration
    // moving a scene of a HyperFrames film takes its narration and effects along; ⌥ moves the picture alone
    const following = !edge && clip.params.hf === true && SOLID.has(track.kind) ? followersOf(layers.timeline, clip.id) : []
    // ⌥ on a scene's end: the whole animation in the new length, faster or slower (动效卡变速)
    const speeds = edge === 'right' && track.kind === 'page' && isScene(clip) && speedable[String(clip.params.sub)] !== false
    const earliest = Math.min(clip.start, ...following.map(c => c.start))
    let moved = false, latest: Drag | undefined
    const move = (next: PointerEvent) => {
      const dx = next.clientX - originX
      if (!moved && Math.abs(dx) < 4) return
      moved = true; suppressClick.current = true; setPlaying(false)
      let start = clip.start, duration = clip.duration, sourceStart = clip.sourceStart, guide: number | undefined, rate: number | undefined
      if (!edge) {
        const snap = snapTimelineClipStart({ timeline: layers.timeline, movingClipId: clip.id, rawStart: snappedTimelineStart(clip.start, dx, pps, fps), duration, pixelsPerSecond: pps })
        start = Math.max(lo, Math.min(hi - duration, snap.start)); guide = snap.guide
        // a sound can't go before the film's start
        if (!next.altKey && following.length) start = Math.max(start, clip.start - earliest)
      } else if (edge === 'right') {
        const snap = snapTimelineClipEnd({ timeline: layers.timeline, movingClipId: clip.id, start, rawDuration: resizedTimelineDuration(clip.duration, dx, pps, fps, 0.2), pixelsPerSecond: pps, minimumDuration: 0.2 })
        duration = Math.min(hi - start, snap.duration); guide = snap.guide
        if (speeds && next.altKey) {
          duration = Math.min(hi - start, speedToLength(clip, duration))
          rate = Math.round(sceneSpan(clip) / duration * 100) / 100
          if (guide !== undefined && Math.abs(start + duration - guide) > 1e-3) guide = undefined
        }
      } else {
        const snap = snapTimelineClipStart({ timeline: layers.timeline, movingClipId: clip.id, rawStart: snappedTimelineStart(clip.start, dx, pps, fps), duration: 0, pixelsPerSecond: pps })
        start = Math.max(lo, Math.min(end - 0.2, snap.start)); duration = end - start; guide = snap.guide
        // trimming the head of footage or a sound starts its source later (or earlier) by the same amount
        if (sources) sourceStart = Math.max(0, clip.sourceStart + (start - clip.start) * speed)
      }
      const delta = start - clip.start
      latest = { clipId: clip.id, start, duration, sourceStart, ...(rate !== undefined ? { speed: rate, from: clip.duration } : {}), ...(!edge && following.length && !next.altKey ? { followers: following.map(c => ({ id: c.id, start: c.start + delta })) } : {}) }
      setDrag(latest); setSnapGuide(guide)
    }
    const up = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true)
      setDrag(undefined); setSnapGuide(undefined)
      window.setTimeout(() => { suppressClick.current = false }, 0)
      const done = latest
      if (!moved || !done) return
      commit(t => {
        const hit = findClip(t, done.clipId)
        if (!hit) return
        if (clip.params.hf === true) freezeAnchors(t)
        Object.assign(hit.clip, { start: done.start, duration: done.duration, sourceStart: done.sourceStart })
        if (done.speed !== undefined) { hit.clip.sourceDuration = sceneSpan(clip); setSceneSpeed(hit.clip, sceneSpan(clip) / done.duration) }
        // a trimmed scene at another speed plays less of its animation, at that speed
        else if (hit.track.kind === 'video' || (edge === 'right' && isScene(hit.clip) && Math.abs(speed - 1) > 1e-3)) hit.clip.sourceDuration = done.duration * speed
        for (const follower of done.followers ?? []) { const one = findClip(t, follower.id); if (one) one.clip.start = follower.start }
        // a sound moved on its own now belongs to the scene it starts in
        if (clip.params.hf === true && !edge) reanchor(t, [done.clipId])
      })
    }
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true)
  }
  if (error) return <main className="ge ge-state"><h1>这一版的分轨打不开</h1><p>{error}</p></main>
  if (!layers || !editProject) return <main className="ge ge-state" aria-busy="true"><Spinner /><p>正在打开分轨…</p></main>

  const timeline = editProject.timeline
  const minimum = 40 + 30 + timeline.tracks.reduce((sum, track) => sum + (TRACK_ROW[track.kind] ?? 26), 0) + 14 + extra
  const ask = (line: string) => { setTab('chat'); onAsk(line) }
  const redoSegment = (segment: GeneralSegment, index: number) => { setTab('chat'); onRedoSegment(segment, index) }
  const seek = (t: number) => setTime(Math.max(0, Math.min(layers.duration, t)))
  const selectedClip = selected.length === 1 ? selected[0] : undefined
  const segmentAt = layers.segments.findIndex(s => time >= s.start && time < s.end)
  // 按声音切开: one clip per sound of a strip that holds several (hf-split.ts)
  const splitSounds = async (clip: TimelineClip) => {
    try {
      const rate = Number(clip.params.speed ?? 1) || 1
      const sounds = await generalEditorApi.sounds(project.id, version.n, String(clip.params.src), clip.sourceStart ?? 0, clip.duration * rate)
      const count = splitBySound(structuredClone(layers.timeline), clip.id, sounds).length
      if (count < 2) { toast('这一段里只听出一声，不用切'); return }
      let ids: string[] = []
      commit(t => { ids = splitBySound(t, clip.id, sounds) })
      setTimeout(() => setSelected(ids))
      toast.success(`切成了 ${count} 段，每一声可以单独挪、删、调音量`)
    } catch (failure) { toast.error(`没能按声音切开：${errorText(failure)}`) }
  }

  const upload = async (files: FileList | null) => {
    const list = [...(files ?? [])].filter(file => mediaKindOf(file) === 'video' || mediaKindOf(file) === 'image')
    for (const [index, file] of list.entries()) {
      try { await generalApi.upload(project.id, file, ratio => setUploadProgress(Math.round((index + ratio) / list.length * 100))) }
      catch (failure) { toast.error(`素材没传上去：${errorText(failure)}`); break }
    }
    setUploadProgress(undefined)
    if (list.length) onProject(await generalApi.get(project.id))
    return []
  }

  const generalTools = <div className="ge-tl-tools">
    {segmentAt >= 0 && <button type="button" title="把这一段交给 Codex 重做" onClick={() => redoSegment(layers.segments[segmentAt], segmentAt)}>
      <Wand2 aria-hidden />让 Codex 重做 · {layers.segments[segmentAt].name || `第 ${segmentAt + 1} 段`}
    </button>}
    {edited && <span className="ge-tl-saved" role="status">{saving ? '正在保存…' : '改动已保存'}</span>}
    {edited && <button type="button" title="撤销（⌘Z）" onClick={undo}><RotateCcw aria-hidden />撤销</button>}
  </div>

  return <div className="studio-editor ge-editor" style={{ '--editor-top-height': '100vh', '--timeline-min-height': `${minimum}px` } as CSSProperties}>
    <section className="editor-top editor-top--library">
      <MediaLibrary project={editProject} timeline={timeline} uploadProgress={uploadProgress}
        tab={libraryTab} onTabChange={setLibraryTab} libraryTab={{ label: '风格库', icon: Palette }}
        motionLibrary={<div className="ge-lib-style">
          {style?.poster && <img src={style.poster} alt="" draggable={false} />}
          <b>{styleNameOf(project.styleId, style)}</b>
          <small>这一条片子的风格。换风格请跟 Codex 说。</small>
        </div>}
        onUpload={upload}
        onRemove={async asset => { try { onProject(await generalApi.removeMedia(project.id, asset.id)) } catch (failure) { toast.error(`没能移除：${errorText(failure)}`) } }}
        onClassify={async () => {}} onRevealProject={() => { generalEditorApi.revealProject(project.id).catch(failure => toast.error(`没能打开工程目录：${errorText(failure)}`)) }} onPreviewOpen={() => setPlaying(false)} onBeginPointerDrag={noop} />
      <GeneralPreview pageRevision={pageRevision} layers={shown ?? layers} mediaUrl={file => generalEditorApi.fileUrl(project.id, `media/${file}`)} pageOrigin={pageOrigin}
        onQuote={onQuote ? (area, time) => {
          const film = { w: layers.width, h: layers.height }
          void grabArea(version.videoUrl, time, area, film).then(imageDataUrl => {
            onQuote({ reference: { time, rect: area, ...(imageDataUrl ? { imageDataUrl } : {}) }, fraction: { x: area.x / film.w, y: area.y / film.h, w: area.w / film.w, h: area.h / film.h }, version: version.n })
            setTab('chat')
          })
        } : undefined}
        quoted={reference && reference.version === version.n ? { x: reference.fraction.x * layers.width, y: reference.fraction.y * layers.height, w: reference.fraction.w * layers.width, h: reference.fraction.h * layers.height } : undefined}
        presets={presets.all} fonts={presets.fonts} time={time} playing={playing} onTime={setTime} onPlaying={setPlaying} selectedClipId={selectedClip}
        onEditText={(clipId, text) => commit(t => { const hit = findClip(t, clipId); if (hit) { hit.clip.text = text; hit.clip.name = text.replace(/[{}]/g, '').split('\n')[0] } })}
        onEditPageText={(clipId, name, text) => commit(t => {
          // a caption line shown as its own clip keeps its words itself
          const line = t.tracks.flatMap(x => x.clips).find(c => c.params.line === true && c.params.host === clipId && c.id === name)
          if (line) { line.text = text; line.name = text.split('\n')[0]; return }
          const hit = findClip(t, clipId); if (hit) hit.clip.params = { ...hit.clip.params, textEdits: { ...(hit.clip.params.textEdits as Record<string, string> | undefined), [name]: text } }
        })}
        onPickClip={clipId => { setSelected([clipId]); setTab('props') }}
        onSetPageElement={(clipId, selector, patch) => commit(t => {
          const hit = findClip(t, clipId)
          if (!hit) return
          // an element of the agent's page moved, resized or turned: kept per selector, defaults left out
          const all = { ...((hit.clip.params.overrides as Record<string, Record<string, unknown>> | undefined) ?? {}) }
          const next: Record<string, unknown> = { ...all[selector], ...patch }
          for (const [key, value] of Object.entries(next)) if (value === 0 || value === 'mid' || value === undefined) delete next[key]
          if (Object.keys(next).length) all[selector] = next; else delete all[selector]
          hit.clip.params = { ...hit.clip.params, overrides: all }
        })}
        onSetPreset={(clipId, preset, all) => commit(t => {
          const hit = findClip(t, clipId)
          if (!hit) return
          // 同类全部: every text of the same role (title, caption or label) takes the look
          const role = hit.clip.params.role ?? 'caption'
          for (const clip of all ? hit.track.clips.filter(c => (c.params.role ?? 'caption') === role) : [hit.clip]) clip.params = { ...clip.params, preset }
        })}
        onSetText={(clipId, patch) => commit(t => {
          const hit = findClip(t, clipId)
          if (!hit) return
          const next: Record<string, unknown> = { ...hit.clip.params, ...patch }
          if (next.size === 'mid') delete next.size // 中 is the preset's own size
          if (next.rotate === 0) delete next.rotate
          hit.clip.params = next
        })} />
      <aside className="preset-panel inspector-panel ge-inspector">
        <nav className="inspector-tabs" aria-label="对话和属性">
          <button className={tab === 'chat' ? 'active' : ''} aria-pressed={tab === 'chat'} onClick={() => setTab('chat')}><MessageSquare /> 对话</button>
          <button className={tab === 'props' ? 'active' : ''} aria-pressed={tab === 'props'} onClick={() => setTab('props')}><SlidersHorizontal /> 属性</button>
        </nav>
        <div className="ge ge-insp-chat" hidden={tab !== 'chat'}>{chat}</div>
        {tab === 'props' && <ClipInspector key={selectedClip ?? ''} timeline={layers.timeline} clipId={selectedClip} presets={presets.presets} segments={layers.segments} media={project.inputs.media} layers={layers} speedable={speedable}
          onCommit={commit} onAsk={ask} onRedoSegment={redoSegment} onSplitSounds={splitSounds} />}
      </aside>
    </section>
    <div className="editor-resizer" title="拖动调整时间线高度" onPointerDown={event => {
      const from = event.clientY, base = extra
      const move = (e: PointerEvent) => setExtra(Math.max(0, Math.min(400, base + from - e.clientY)))
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    }} onDoubleClick={() => setExtra(0)}><i /></div>
    {drag?.speed !== undefined && drag.from !== undefined && <SpeedDragHint clipId={drag.clipId} rate={drag.speed} from={drag.from} to={drag.duration} pps={42 * zoom} />}
    <TimelineEditor project={editProject} timeline={timeline} zoom={zoom} onZoomChange={setZoom} playhead={time}
      selectedClipIds={selected} snappingEnabled onSnappingChange={noop}
      onPasteClips={(clips, trackId, at) => { let ids: string[] = []; commit(timeline => { ids = pasteTimelineClips(timeline, clips, trackId, at, NO_FIXED_TRACKS); if (layers.engine === 'hyperframes') reanchor(timeline, ids) }); setTimeout(() => setSelected(ids)) }}
      fixedTrackKinds={NO_FIXED_TRACKS}
      radialItems={(clip, track) => {
        // ⌘ 点击素材的圆盘 (S先生 10-31): the same edits as the 属性 panel, on the clip itself
        const edit = (change: (c: TimelineClip) => void) => commit(t => { const c = t.tracks.filter(x => !x.locked).flatMap(x => x.clips).find(x => x.id === clip.id); if (c) change(c) })
        const audio = (patch: Partial<Pick<TimelineClip, 'volume' | 'fadeIn' | 'fadeOut'>>) => edit(c => { Object.assign(c, patch); if (patch.volume !== undefined) { const { volumeStep: _step, ...rest } = c.params; c.params = rest } })
        const sounding = track.kind !== 'video' || clip.params.sound === true
        const volume: RadialItem = { id: 'volume', label: '音量', panel: <RadialVolume volume={sounding ? clip.volume : 0} onChange={gain => audio({ volume: gain })}
          extra={track.kind === 'video' ? <div className="clip-radial-switch"><span>原声</span><button type="button" aria-pressed={Boolean(clip.params.sound)}
            onClick={() => edit(c => { const on = !c.params.sound; c.params = { ...c.params, sound: on }; c.volume = on ? gain(((c.params.volumeStep as VolumeStep) || 'mid')) : 0 })}>{clip.params.sound ? '保留' : '静音'}</button></div> : undefined} /> }
        const fades: RadialItem = { id: 'fades', label: '淡入淡出', panel: <RadialFades fadeIn={clip.fadeIn} fadeOut={clip.fadeOut} max={maxClipFade(clip)} onChange={audio} /> }
        const copy: RadialItem = { id: 'copy', label: '复制', run: () => copyTimelineClips(layers.timeline, [clip.id], NO_FIXED_TRACKS) }
        const remove: RadialItem = { id: 'delete', label: '删除', danger: true, run: () => { commit(t => { for (const row of t.tracks) if (!row.locked) row.clips = row.clips.filter(c => c.id !== clip.id) }); setSelected([]) } }
        const props: RadialItem = { id: 'props', label: '在右侧打开', run: () => setTab('props') }
        if (track.kind === 'video') {
          const speed = Number(clip.params.speed ?? 1) || 1, source = clip.sourceDuration ?? clip.duration * speed
          const next = track.clips.filter(c => c.id !== clip.id && c.start >= clip.start + 1e-6).sort((a, b) => a.start - b.start)[0]
          return [{ id: 'speed', label: '变速', panel: <ClipSpeedControl rate={speed} sourceSeconds={source} minRate={next ? source / Math.max(0.05, next.start - clip.start) : undefined}
            onChange={rate => edit(c => { const span = c.sourceDuration ?? c.duration * (Number(c.params.speed ?? 1) || 1); c.sourceDuration = span; c.params = { ...c.params, speed: rate }; c.duration = span / rate })} /> },
            volume, fades, { ...props, label: '画面设置' }, copy, remove]
        }
        if (track.kind === 'voice' || track.kind === 'music' || track.kind === 'sfx') return [volume, fades, ...(canSplitSounds(clip, track) ? [{ id: 'split', label: '按声音切开', run: () => { void splitSounds(clip) } }] : []), copy, remove]
        // a HyperFrames caption page draws its words itself: no text to change on the clip
        if (track.kind === 'subtitle' && clip.params.hf === true && clip.params.line !== true) return [{ ...props, label: '文字设置' }, copy, remove]
        if (track.kind === 'page' && isScene(clip)) return [{ id: 'speed', label: '变速', panel: <SceneSpeed clip={clip} track={track} speedable={speedable[String(clip.params.sub)] !== false} onPatch={edit} hint /> },
          { ...props, label: '画面设置' }, copy, remove]
        if (track.kind === 'subtitle') return [{ id: 'text', label: '改字', panel: <RadialText text={clip.text ?? ''} onCommit={text => edit(c => { c.text = text; c.name = text.replace(/[{}]/g, '').split('\n')[0] })} /> },
          { ...props, label: '文字设置' }, copy, remove]
        return undefined
      }}
      onClipAudio={(clipId, audio) => commit(timeline => {
        const clip = timeline.tracks.filter(t => !t.locked).flatMap(t => t.clips).find(c => c.id === clipId)
        if (!clip) return
        Object.assign(clip, audio)
        // a dragged volume is its own number of dB, no longer one of the three steps
        if (audio.volume !== undefined) { const { volumeStep: _step, ...rest } = clip.params; clip.params = rest }
      })}
      mainTrackLinked={false} onMainTrackLinkedChange={noop} onMarkCutEdge={noop} onCutBoundaryChange={noop} onRestoreCut={noop} onCancelCut={noop} onPreviewCut={noop} cutBusy={false}
      onSmartMusic={noop} onSmartRoughcut={noop} onGlobalMotion={noop} onGlobalSfx={noop} onSmartBroll={noop} onAutoPlace={noop}
      suppressTimelineClickRef={suppressClick} timelinePlayheadRef={playheadRef}
      onUndo={undo} onRedo={redo} onSplit={noop} onInsertDirectorGap={noop} onEditDirectorSlot={noop} onOpenDirectorSlot={noop}
      onDelete={() => {
        const ids = selected.filter(id => { const hit = findClip(layers.timeline, id); return hit && !hit.track.locked && (hit.track.kind !== 'page' || hit.clip.params.hf === true) })
        if (!ids.length) { if (selected.length) toast('锁定轨道或画面页不能删除，请先解锁或让 Codex 重做这一段'); return }
        commit(t => { for (const track of t.tracks) track.clips = track.clips.filter(c => !ids.includes(c.id)) })
        setSelected([])
      }}
      focusTimeline={false} onToggleFocus={noop}
      onTrackVolume={(trackId, volume) => commit(t => { const track = t.tracks.find(x => x.id === trackId); if (track && !track.locked) track.volume = volume })}
      onToggleTrack={(trackId, field) => commit(t => { const track = t.tracks.find(x => x.id === trackId); if (track) track[field] = !track[field] })}
      onSeek={seek}
      onSelectClip={(clipId, additive) => { setSelected(current => !additive ? [clipId] : current.includes(clipId) ? current.filter(id => id !== clipId) : [...current, clipId]); if (!additive) setTab('props') }}
      onSelectClips={setSelected} onClearSelection={() => setSelected([])}
      onBeginClipDrag={(event, clip, track) => beginClip(event, clip, track)} onBeginClipDurationResize={(event, clip, track, edge) => beginClip(event, clip, track, edge ?? 'right')}
      draggingClip={drag?.clipId} snapGuide={snapGuide} onOpenClipMenu={noop} onEditOverlay={noop} onOpenDirectorScene={noop}
      onDropMedia={noop} generalTools={generalTools} />
  </div>
}
