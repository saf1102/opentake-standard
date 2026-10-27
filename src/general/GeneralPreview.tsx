/**
 * Preview of a layered general version, in the 口播 editor's preview frame (same classes): footage, the agent's page
 * (on its own origin, seeked by message), text drawn by the kit's own text.js, sound, segment transitions, the finish.
 * Everything follows `time`; while playing, a clock advances it.
 * Double-click on the picture edits what is under the pointer: a text (the text track's, or a page's data-edit text)
 * opens an editor right over it; footage is picked, so its properties open beside the preview.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { timecode } from '@/studio/timecode'
import type { TimelineClip } from '@/types/editor'
import { hfPageEdits, type GeneralLayers } from './general-contract'
import { renderTextLayer, type TextItem } from '../../server/general/kit/web/text.js'
import { StylePicker } from './StylePicker'
import { IS_MAC, QUOTE_KEY } from './platform'
import { boxFromPoints } from './general-logic'
import { usePlacementDrag, type PlacementSlot } from '@/studio/components/placement-drag'
import { PlacementSlots } from '@/studio/components/PlacementHandle'

type PresetFont = { family: string; url: string; style: string; weight: string }
type Props = {
  layers: GeneralLayers; mediaUrl: (file: string) => string; pageOrigin?: string; presets: Record<string, unknown>
  /** the faces the presets name (served by the page host), loaded here so text looks as it will in the export */
  fonts?: PresetFont[]
  time: number; playing: boolean; onTime: (t: number) => void; onPlaying: (playing: boolean) => void
  selectedClipId?: string
  /** a text-track clip's new text */
  onEditText?: (clipId: string, text: string) => void
  /** a page's data-edit text, by its name */
  onEditPageText?: (clipId: string, name: string, text: string) => void
  /** footage (or anything without text) was double-clicked */
  onPickClip?: (clipId: string) => void
  /** a text-track clip takes another preset (the style picker) */
  onSetPreset?: (clipId: string, preset: string, all?: boolean) => void
  /** a text-track clip's place (one of the nine cells), size step or turn */
  onSetText?: (clipId: string, patch: { place?: string; size?: string; rotate?: number }) => void
  /** an element inside a page clip moved, resized or turned (kept per selector in the clip's overrides) */
  onSetPageElement?: (clipId: string, selector: string, patch: PageMove) => void
  /** ⌘-drag (Ctrl elsewhere) on the picture: the area (film pixels) and the moment, quoted into the conversation */
  onQuote?: (area: { x: number; y: number; w: number; h: number }, time: number) => void
  /** the area quoted now (film pixels), outlined on the picture */
  quoted?: { x: number; y: number; w: number; h: number }
}
export type PageMove = { dx?: number; dy?: number; size?: string; rotate?: number }
type ScreenBox = { left: number; top: number; width: number; height: number }

// the nine cells, as text.js anchors them (x, y: 0 start, .5 middle, 1 end), named the way the 口播 grid names them
const noopFn = () => {}
const CELLS: [string, string, number, number][] = [
  ['upper-left', '左上', 0, 0], ['top', '上方', 0.5, 0], ['upper-right', '右上', 1, 0],
  ['left', '左侧', 0, 0.5], ['center', '正中', 0.5, 0.5], ['right', '右侧', 1, 0.5],
  ['lower-left', '左下', 0, 1], ['bottom', '下方', 0.5, 1], ['lower-right', '右下', 1, 1],
]

type TextStyle = { fontFamily: string; fontSize: string; fontWeight: string; fontStyle: string; color: string; textAlign: string; lineHeight: string; letterSpacing: string }
type Box = { x: number; y: number; w: number; h: number }
type Editing = { clipId: string; name?: string; text: string; rect: Box; style: TextStyle }

const clipsOf = (layers: GeneralLayers, id: string) => layers.timeline.tracks.find(t => t.id === id)?.clips ?? []
/** A track switched off in the timeline (muted, or hidden for a picture track) plays nothing. */
const trackMuted = (layers: GeneralLayers, id: string) => { const track = layers.timeline.tracks.find(t => t.id === id); return Boolean(track?.muted || track?.hidden) }
const activeAt = (clip: TimelineClip, t: number) => t >= clip.start && t < clip.start + clip.duration
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))

/** Black or white over the picture at t: the opening / ending fades and the dips and fades between segments. */
function transitionCover(layers: GeneralLayers, t: number): { color: string; opacity: number } | undefined {
  const [first] = layers.segments
  if (first?.transition === 'fade' && t < 0.5) return { color: '#000', opacity: 1 - t / 0.5 }
  if (layers.ending === 'fade' && t > layers.duration - 0.5) return { color: '#000', opacity: (t - (layers.duration - 0.5)) / 0.5 }
  for (const s of layers.segments.slice(1)) {
    const d = s.transition === 'fade' ? 0.5 : s.transition === 'dip-black' || s.transition === 'dip-white' ? 0.15 : 0
    if (!d || Math.abs(t - s.start) > d) continue
    return { color: s.transition === 'dip-white' ? '#fff' : '#000', opacity: 1 - Math.abs(t - s.start) / d }
  }
  return undefined
}

function useFitSize(width: number, height: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect(), s = Math.min((r.width - 24) / width, (r.height - 24) / height)
      setSize(s > 0 ? { width: Math.round(width * s), height: Math.round(height * s) } : { width: 0, height: 0 })
    }
    fit()
    const observer = new ResizeObserver(fit); observer.observe(el)
    return () => observer.disconnect()
  }, [width, height])
  return { ref, size }
}

/** One <video> per footage clip; the active one is seeked (paused) or played at its speed. */
function FootageLayer({ layers, time, playing, mediaUrl }: Pick<Props, 'layers' | 'time' | 'playing' | 'mediaUrl'>) {
  const refs = useRef(new Map<string, HTMLVideoElement>())
  const clips = clipsOf(layers, 'g-footage'), muted = trackMuted(layers, 'g-footage')
  useEffect(() => {
    for (const clip of clips) {
      const video = refs.current.get(clip.id)
      if (!video) continue
      const on = activeAt(clip, time), speed = Number(clip.params.speed ?? 1), reverse = Boolean(clip.params.reverse)
      const local = (time - clip.start) * speed
      const target = reverse ? clip.sourceStart + (clip.sourceDuration ?? clip.duration * speed) - local : clip.sourceStart + local
      video.muted = muted || !clip.params.sound || clip.volume <= 0
      video.volume = Math.min(1, Math.max(0, clip.volume))
      if (!on) { if (!video.paused) video.pause(); continue }
      if (playing && !reverse) {
        video.playbackRate = speed
        if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = target
        if (video.paused) void video.play().catch(() => {})
      } else {
        if (!video.paused) video.pause()
        if (Math.abs(video.currentTime - target) > 1 / 60) video.currentTime = Math.max(0, target)
      }
    }
  }, [clips, time, playing, muted])
  return <>{clips.map(clip => {
    const on = activeAt(clip, time)
    const u = smooth((time - clip.start) / clip.duration)
    const move = clip.params.move as { from: { zoom: number; focus: number[] }; to: { zoom: number; focus: number[] } } | undefined
    const focus = move ? [0, 1].map(i => move.from.focus[i] + (move.to.focus[i] - move.from.focus[i]) * u) : (clip.params.focus as number[] | undefined) ?? [0.5, 0.5]
    const zoom = move ? move.from.zoom + (move.to.zoom - move.from.zoom) * u : 1
    const file = String(clip.params.media ?? '')
    return <video key={clip.id} ref={el => { if (el) refs.current.set(clip.id, el); else refs.current.delete(clip.id) }} src={mediaUrl(file)} preload="auto" playsInline
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: clip.params.fit === 'contain' ? 'contain' : 'cover',
        objectPosition: `${focus[0] * 100}% ${focus[1] * 100}%`, transform: `scale(${zoom})`, transformOrigin: `${focus[0] * 100}% ${focus[1] * 100}%`, display: on ? 'block' : 'none' }} />
  })}</>
}

/** The agent's pages, each in an iframe on the page host; the active one is seeked and answers when drawn. */
function PageLayer({ layers, time, pageOrigin, frames }: Pick<Props, 'layers' | 'time' | 'pageOrigin'> & { frames: RefObject<Map<string, HTMLIFrameElement>> }) {
  const busy = useRef(new Map<string, number>())
  const pending = useRef(new Map<string, number>())
  const clips = clipsOf(layers, 'g-page'), muted = trackMuted(layers, 'g-page')
  const send = (clip: TimelineClip, t: number) => {
    const el = frames.current.get(clip.id)
    if (!el?.contentWindow || !pageOrigin) return
    if (busy.current.get(clip.id)) { pending.current.set(clip.id, t); return }
    const token = Math.random()
    busy.current.set(clip.id, token)
    el.contentWindow.postMessage({ type: 'ot-seek', t, token, edits: clip.params.textEdits ?? {}, overrides: clip.params.overrides ?? {} }, pageOrigin)
  }
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== pageOrigin) return
      const id = [...frames.current].find(([, el]) => el.contentWindow === event.source)?.[0]
      if (!id) return
      if (event.data?.type === 'ot-ready') { busy.current.delete(id); const clip = clips.find(c => c.id === id); if (clip) send(clip, Math.max(0, time - clip.start)) }
      if (event.data?.type === 'ot-frame' || event.data?.type === 'ot-error') {
        busy.current.delete(id)
        const next = pending.current.get(id); pending.current.delete(id)
        const clip = clips.find(c => c.id === id)
        if (clip && next !== undefined) send(clip, next)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  })
  useEffect(() => { for (const clip of clips) if (activeAt(clip, time)) send(clip, time - clip.start) })
  if (!pageOrigin || muted) return null
  return <>{clips.map(clip => <iframe key={clip.id} title={`画面页 ${clip.name}`} src={`${pageOrigin}/${String(clip.params.page).split('/').map(encodeURIComponent).join('/')}`}
    ref={el => { if (el) frames.current.set(clip.id, el); else frames.current.delete(clip.id) }} sandbox="allow-scripts allow-same-origin"
    // colorScheme: the app is dark and the agent's pages are not; a scheme mismatch makes the browser paint the frame an
    // opaque white, which hid the footage under every overlay page
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: 'transparent', colorScheme: 'normal', pointerEvents: 'none', visibility: activeAt(clip, time) ? 'visible' : 'hidden' }} />)}</>
}

// Sound goes through Web Audio gain, not element.volume (capped at 1), so a track fader above 0 dB is heard too.
let audioContext: AudioContext | undefined
const gains = new WeakMap<HTMLAudioElement, GainNode>()
function gainFor(audio: HTMLAudioElement) {
  let node = gains.get(audio)
  if (!node) {
    audioContext ??= new AudioContext()
    node = audioContext.createGain()
    audioContext.createMediaElementSource(audio).connect(node).connect(audioContext.destination)
    gains.set(audio, node)
  }
  return node
}

/** Music, sound effects and voice: one <audio> each, played from its in-point while its clip is under the playhead, at the clip's gain times its track's fader. */
function SoundLayer({ layers, time, playing, pageOrigin }: Pick<Props, 'layers' | 'time' | 'playing' | 'pageOrigin'>) {
  const refs = useRef(new Map<string, HTMLAudioElement>())
  const tracks = ['g-voice', 'g-music', 'g-sfx'].map(id => ({ id, muted: trackMuted(layers, id), clips: clipsOf(layers, id), fader: layers.timeline.tracks.find(t => t.id === id)?.volume ?? 1 }))
  useEffect(() => {
    if (playing && audioContext?.state === 'suspended') void audioContext.resume()
    for (const track of tracks) for (const clip of track.clips) {
      const audio = refs.current.get(clip.id)
      if (!audio) continue
      const on = playing && !track.muted && activeAt(clip, time), target = clip.sourceStart + (time - clip.start)
      gainFor(audio).gain.value = Math.max(0, clip.volume * track.fader)
      if (!on) { if (!audio.paused) audio.pause(); continue }
      if (Math.abs(audio.currentTime - target) > 0.2) audio.currentTime = target
      if (audio.paused) void audio.play().catch(() => {})
    }
  })
  if (!pageOrigin) return null
  return <>{tracks.flatMap(track => track.clips.map(clip => <audio key={clip.id} preload="auto" crossOrigin="anonymous" src={`${pageOrigin}/${String(clip.params.src).split('/').map(encodeURIComponent).join('/')}`}
    ref={el => { if (el) refs.current.set(clip.id, el); else refs.current.delete(clip.id) }} />))}</>
}

/** Load the presets' faces once per page host; text draws again when they are in. */
function useFonts(fonts: PresetFont[] | undefined, origin: string | undefined) {
  const [loaded, setLoaded] = useState(0)
  useEffect(() => {
    if (!origin || !fonts?.length) return
    let alive = true
    const faces = fonts.map(f => new FontFace(f.family, `url('${origin}${f.url.split('/').map(encodeURIComponent).join('/')}')`, { weight: f.weight, style: f.style }))
    for (const face of faces) { document.fonts.add(face); void face.load().then(() => { if (alive) setLoaded(n => n + 1) }, () => {}) }
    return () => { alive = false; for (const face of faces) document.fonts.delete(face) }
  }, [fonts, origin])
  return loaded
}

const textItems = (layers: GeneralLayers): TextItem[] => trackMuted(layers, 'g-text') ? [] : clipsOf(layers, 'g-text').map(c => ({
  id: c.id, start: c.start, end: c.start + c.duration, text: c.text ?? '', role: String(c.params.role ?? 'caption'), preset: String(c.params.preset ?? ''),
  place: String(c.params.place ?? 'bottom'), reveal: String(c.params.reveal ?? 'fade'),
  size: String(c.params.size ?? 'mid'), rotate: Number(c.params.rotate ?? 0),
}))

/**
 * The text track drawn by text.js. `look` tries a preset on one text (the style picker's hover); `only` draws that one
 * text alone (the picker's spotlight, above the veil); `hiddenId` leaves one out (under its editor or spotlight).
 */
function TextLayer({ layers, time, presets, fontsLoaded, root, hiddenId, look, only, layer = 'ge-text-layer' }: Pick<Props, 'layers' | 'time' | 'presets'> & {
  fontsLoaded: number; root: RefObject<HTMLDivElement | null>; hiddenId?: string; look?: { id: string; preset: string; role?: string }; only?: string; layer?: string
}) {
  const items = useMemo<TextItem[]>(() => textItems(layers)
    .filter(item => !only || item.id === only)
    .map(item => (look && (item.id === look.id || (look.role && item.role === look.role)) ? { ...item, preset: look.preset } : item)), [layers, look, only])
  useLayoutEffect(() => {
    if (!root.current) return
    renderTextLayer(root.current, items, time, { width: layers.width, height: layers.height, presets })
  }, [items, time, layers.width, layers.height, presets, fontsLoaded, root])
  // text.js owns the layer's children (it replaces them every frame), so the rule that hides the text being edited
  // under its editor sits beside the layer, not in it
  return <>
    <div ref={root} className={layer} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    {hiddenId && <style>{`.${layer} > [data-text-id="${CSS.escape(hiddenId)}"]{visibility:hidden}`}</style>}
  </>
}

const styleOf = (cs: CSSStyleDeclaration): TextStyle => ({ fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, color: cs.color, textAlign: cs.textAlign, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing })

/** One request to a page over the bridge, answered by token; nothing after a moment means nothing. */
function askPage<T>(frame: HTMLIFrameElement, origin: string, type: string, payload: Record<string, unknown>) {
  return new Promise<Partial<T>>(resolve => {
    const token = Math.random()
    const done = (value: Partial<T>) => { window.removeEventListener('message', onMessage); window.clearTimeout(timer); resolve(value) }
    const onMessage = (event: MessageEvent) => { if (event.origin === origin && event.source === frame.contentWindow && event.data?.type === type && event.data.token === token) done(event.data) }
    const timer = window.setTimeout(() => done({}), 600)
    window.addEventListener('message', onMessage)
    frame.contentWindow?.postMessage({ type, token, ...payload }, origin)
  })
}

/** `clip`: on a HyperFrames page, the clip the text belongs to (the page itself is one frame). */
type PageHit = { clip?: string; name?: string; text?: string; rect?: Box; style?: TextStyle }
/** Ask a page what editable text is under (x, y) (page px); nothing after a moment means nothing. */
function pageHit(frame: HTMLIFrameElement, origin: string, x: number, y: number) {
  return new Promise<PageHit>(resolve => {
    const token = Math.random()
    const done = (value: PageHit) => { window.removeEventListener('message', onMessage); window.clearTimeout(timer); resolve(value) }
    const onMessage = (event: MessageEvent) => { if (event.origin === origin && event.source === frame.contentWindow && event.data?.type === 'ot-hit' && event.data.token === token) done(event.data) }
    const timer = window.setTimeout(() => done({}), 600)
    window.addEventListener('message', onMessage)
    frame.contentWindow?.postMessage({ type: 'ot-hit', x, y, token }, origin)
  })
}

/** The editor over a text: same place, same type; Enter keeps it (Shift+Enter is a new line), Esc drops it. */
function TextEditor({ editing, onDone }: { editing: Editing; onDone: (text?: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const closed = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = editing.text
    el.focus()
    const range = document.createRange(); range.selectNodeContents(el)
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
  }, [editing])
  const finish = (keep: boolean) => {
    if (closed.current) return
    closed.current = true
    onDone(keep ? (ref.current?.innerText ?? '').replace(/\n$/, '') : undefined)
  }
  const { rect, style } = editing
  // a light backing under dark type, a dark one under light type
  const [r = 255, g = 255, b = 255] = (style.color.match(/[\d.]+/g) ?? []).map(Number)
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
  return <div ref={ref} className="ge-text-editor" data-on-light={dark || undefined} contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-label="改文字" aria-multiline
    style={{ left: rect.x - 8, top: rect.y - 6, minWidth: rect.w + 16, minHeight: rect.h + 12, ...style, whiteSpace: 'pre-wrap' } as CSSProperties}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); finish(false) }
      else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); finish(true) }
    }}
    onBlur={() => finish(true)} onDoubleClick={event => event.stopPropagation()} />
}

const GRAIN = (() => {
  if (typeof document === 'undefined') return ''
  const c = document.createElement('canvas'); c.width = c.height = 160
  const g = c.getContext('2d'); if (!g) return ''
  const d = g.createImageData(160, 160)
  let seed = 2463534242
  for (let i = 0; i < d.data.length; i += 4) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const v = (seed >>> 0) % 256; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255 }
  g.putImageData(d, 0, 0)
  return c.toDataURL()
})()

/** The kit's paper tile (compose.js): fixed seed, black at low alpha, laid straight over the picture. */
const PAPER = (() => {
  if (typeof document === 'undefined') return ''
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d'); if (!g) return ''
  const d = g.createImageData(256, 256)
  let seed = 73129
  for (let i = 0; i < d.data.length; i += 4) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const v = 160 + (seed >>> 0) % 96; d.data[i + 3] = Math.round(26 * (1 - v / 255)) }
  g.putImageData(d, 0, 0)
  return c.toDataURL()
})()

/** The whole-film finish as the kit's compositor draws it (grain moves; the others are static). */
const FINISH: Record<string, CSSProperties> = {
  grain: { backgroundImage: `url(${GRAIN})`, mixBlendMode: 'overlay', opacity: 0.18 },
  vignette: { background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)' },
  scanlines: { background: 'repeating-linear-gradient(0deg,rgba(0,0,0,.17) 0px,rgba(0,0,0,.17) 1px,transparent 1px,transparent 4px)' },
  halftone: { background: 'radial-gradient(circle,rgba(20,17,12,.22) .65px,transparent .9px)', backgroundSize: '4px 4px' },
  paper: { backgroundImage: `url(${PAPER})` },
}

/**
 * A HyperFrames film plays as one page under HyperFrames' own runtime (served by the page host, never shown as
 * HyperFrames: the person only sees OpenTake). OpenTake's transport drives it through the runtime's control messages
 * (play, pause, seek); while it plays, the runtime's clock is the editor's clock.
 */
function HyperframesLayer({ layers, time, playing, pageOrigin, onTime, onPlaying, frame }: Pick<Props, 'layers' | 'time' | 'playing' | 'pageOrigin' | 'onTime' | 'onPlaying'> & { frame: RefObject<HTMLIFrameElement | null> }) {
  const [ready, setReady] = useState(false)
  const reported = useRef(-1)
  const post = (action: string, extra: Record<string, unknown> = {}) => {
    if (pageOrigin) frame.current?.contentWindow?.postMessage({ source: 'hf-parent', type: 'control', protocolVersion: 1, fps: { numerator: layers.fps, denominator: 1 }, capabilities: [], action, ...extra }, pageOrigin)
  }
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== pageOrigin || event.source !== frame.current?.contentWindow || event.data?.source !== 'hf-preview') return
      if (event.data.type === 'ready') setReady(true)
      if (event.data.type === 'state' && playing) {
        const t = Number(event.data.currentTime) || 0
        reported.current = t; onTime(t)
        if (event.data.ended) onPlaying(false)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  })
  // the person's edits, words and moves (hf-edit-bridge.js on the page puts them in, and takes them out again on undo)
  const edits = JSON.stringify(hfPageEdits(layers))
  useEffect(() => { if (ready && pageOrigin) frame.current?.contentWindow?.postMessage({ type: 'ot-page-edits', edits: JSON.parse(edits) }, pageOrigin) }, [edits, ready, pageOrigin, frame])
  useEffect(() => { if (ready) post(playing ? 'play' : 'pause') }, [playing, ready]) // eslint-disable-line react-hooks/exhaustive-deps -- post reads the frame
  // a seek from OpenTake (scrubbing, the timeline, the buttons): every change while paused, a jump while playing
  useEffect(() => {
    if (!ready) return
    if (playing && Math.abs(time - reported.current) < 0.3) return
    post('seek', { timeSeconds: time })
  }, [time, ready]) // eslint-disable-line react-hooks/exhaustive-deps -- playing is read, not followed
  if (!pageOrigin) return null
  return <iframe ref={frame} title="成片画面" src={`${pageOrigin}/${encodeURIComponent(layers.entry ?? 'index.html')}`} sandbox="allow-scripts allow-same-origin" allow="autoplay"
    style={{ position: 'absolute', left: 0, top: 0, width: layers.width, height: layers.height, border: 0, background: '#000', colorScheme: 'normal' }} />
}

export function GeneralPreview({ layers: given, mediaUrl, pageOrigin, presets, fonts, time, playing, onTime, onPlaying, onEditText, onEditPageText, onPickClip, onSetPreset, onSetText, onSetPageElement, onQuote, quoted }: Props) {
  const fontsLoaded = useFonts(fonts, pageOrigin)
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const hfFrame = useRef<HTMLIFrameElement>(null)
  const textRoot = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<Editing>()
  // an element picked inside a page clip (its selector), and its shift while it is being dragged (shown live)
  const [pagePick, setPagePick] = useState<{ clipId: string; selector: string; kind: string }>()
  const [pageDrag, setPageDrag] = useState<{ dx: number; dy: number }>()
  const layers = useMemo(() => {
    if (!pagePick || !pageDrag) return given
    const timeline = structuredClone(given.timeline)
    // a HyperFrames film's element may sit in any clip (a card, the captions); the older pages are all on 动效卡
    const clip = timeline.tracks.filter(t => given.engine === 'hyperframes' || t.id === 'g-page').flatMap(t => t.clips).find(c => c.id === pagePick.clipId)
    if (clip) { const all = (clip.params.overrides as Record<string, PageMove> | undefined) ?? {}; clip.params = { ...clip.params, overrides: { ...all, [pagePick.selector]: { ...all[pagePick.selector], ...pageDrag } } } }
    return { ...given, timeline }
  }, [given, pagePick, pageDrag])
  const { ref, size } = useFitSize(layers.width, layers.height)
  const scale = size.width / layers.width
  // the style picker: a text-track clip chosen by a click, its picker open or not, a preset tried by hovering
  const [picked, setPicked] = useState<string>()
  const [picking, setPicking] = useState(false)
  const [trying, setTrying] = useState<{ preset: string; all: boolean }>()
  const spotRoot = useRef<HTMLDivElement>(null)
  const canvasEl = useRef<HTMLDivElement>(null)
  const [pickedRect, setPickedRect] = useState<{ left: number; top: number; width: number; height: number; canvas: { left: number; top: number; width: number; height: number } }>()
  const pickedItem = picked ? textItems(layers).find(item => item.id === picked && time >= item.start && time < item.end) : undefined
  const closePicker = () => { setPicking(false); setTrying(undefined) }
  const unpick = () => { closePicker(); setPicked(undefined); setPagePick(undefined) }
  // where the picked page element is now: asked of its page (after it redraws), in screen pixels
  const pageClip = pagePick ? layers.timeline.tracks.filter(t => layers.engine === 'hyperframes' || t.id === 'g-page').flatMap(t => t.clips).find(c => c.id === pagePick.clipId && activeAt(c, time)) : undefined
  const pageMove = pagePick && pageClip ? ((pageClip.params.overrides as Record<string, PageMove> | undefined)?.[pagePick.selector] ?? {}) : undefined
  const [pageRect, setPageRect] = useState<ScreenBox & { canvas: ScreenBox }>()
  const pageKey = pagePick && pageClip ? `${pagePick.clipId}|${pagePick.selector}|${JSON.stringify(pageClip.params.overrides ?? {})}|${time}|${size.width}` : ''
  useEffect(() => {
    if (!pagePick || !pageClip || !pageOrigin) return
    const frame = layers.engine === 'hyperframes' ? hfFrame.current : frames.current.get(pagePick.clipId)
    if (!frame) return
    let alive = true
    const ask = () => void askPage<{ rect: { x: number; y: number; w: number; h: number } }>(frame, pageOrigin, 'ot-rect', { selector: pagePick.selector, clip: pagePick.clipId }).then(({ rect }) => {
      const c = canvasEl.current?.getBoundingClientRect()
      if (!alive || !rect || !c) return
      const k = c.width / layers.width
      setPageRect({ left: c.left + rect.x * k, top: c.top + rect.y * k, width: rect.w * k, height: rect.h * k, canvas: { left: c.left, top: c.top, width: c.width, height: c.height } })
    })
    // once now, once after the page has redrawn with the change
    ask(); const later = window.setTimeout(ask, 260)
    return () => { alive = false; window.clearTimeout(later) }
  }, [pageKey]) // eslint-disable-line react-hooks/exhaustive-deps -- pageKey holds what moves it
  // follow the chosen text on screen (it moves when the preview resizes or a look is tried)
  const pickedId = pickedItem?.id
  useLayoutEffect(() => {
    const host = picking ? spotRoot.current : textRoot.current
    const el = pickedId ? [...(host?.children ?? [])].find(e => (e as HTMLElement).dataset.textId === pickedId) : undefined
    const r = el?.getBoundingClientRect(), c = canvasEl.current?.getBoundingClientRect()
    // measured after layout, so this effect has to set state; it only does when the box really moved
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPickedRect(current => !r || !c ? undefined
      : current && Math.abs(r.left - current.left) + Math.abs(r.top - current.top) + Math.abs(r.width - current.width) + Math.abs(r.height - current.height) + Math.abs(c.left - current.canvas.left) + Math.abs(c.width - current.canvas.width) <= 0.5 ? current
      : { left: r.left, top: r.top, width: r.width, height: r.height, canvas: { left: c.left, top: c.top, width: c.width, height: c.height } })
  }, [pickedId, picking, trying, time, size.width, size.height, fontsLoaded, layers]) // layers: a new place, size or turn moves it
  // 移动: the 口播 nine-cell drag, with the cells where this text would sit (its box at each of text.js's anchors)
  const box = pickedRect && pickedRect.canvas.width ? pickedRect : undefined
  const pct = (x: number, y: number, w: number, h: number) => box ? { x: x / box.canvas.width * 100, y: y / box.canvas.height * 100, width: w / box.canvas.width * 100, height: h / box.canvas.height * 100 } : { x: 0, y: 0, width: 0, height: 0 }
  const textRect = box ? pct(box.left - box.canvas.left, box.top - box.canvas.top, box.width, box.height) : pct(0, 0, 0, 0)
  const cells: PlacementSlot[] = box && pickedItem ? CELLS.map(([id, label, ax, ay]) => {
    const { width: cw, height: ch } = box.canvas, w = box.width, h = box.height, m = 0.07 * Math.min(cw, ch)
    const x = ax === 0 ? m : ax === 1 ? cw - m - w : (cw - w) / 2
    const y = ay === 0 ? m : ay === 1 ? ch - m * (pickedItem.role === 'caption' ? 1.4 : 1) - h : (ch - h) / 2
    return { id, label, rect: pct(x, y, w, h), current: (pickedItem.place ?? 'bottom') === id }
  }) : []
  const placing = usePlacementDrag({ rect: textRect, slots: cells, bounds: () => canvasEl.current?.getBoundingClientRect(),
    onPlace: id => { if (pickedItem) onSetText?.(pickedItem.id, { place: id }) } })
  /** A click: the text-track text under the pointer is picked (and the film pauses); anywhere else lets it go. */
  const pickAt = async (event: ReactMouseEvent) => {
    for (const el of textRoot.current?.children ?? []) {
      const r = el.getBoundingClientRect(), id = (el as HTMLElement).dataset.textId
      if (!id || event.clientX < r.left - 6 || event.clientX > r.right + 6 || event.clientY < r.top - 6 || event.clientY > r.bottom + 6) continue
      onPlaying(false); closePicker(); setPagePick(undefined); setPicked(id); return
    }
    // not the text track: an element of the page under the pointer (a title, a picture, a drawing)
    const c = canvasEl.current?.getBoundingClientRect()
    if (hyperframes) {
      const hit = c && hfFrame.current && pageOrigin ? await askPage<{ clip: string; selector: string; kind: string }>(hfFrame.current, pageOrigin, 'ot-pick', { x: (event.clientX - c.left) * layers.width / c.width, y: (event.clientY - c.top) * layers.width / c.width }) : {}
      // A repeated pick keeps its measured box: pageKey is unchanged, so the measuring effect will not rerun.
      if (hit.clip && hit.selector) { onPlaying(false); if (pagePick?.clipId !== hit.clip || pagePick?.selector !== hit.selector) setPageRect(undefined); setPagePick({ clipId: hit.clip, selector: hit.selector, kind: hit.kind ?? 'text' }); return }
      unpick(); return
    }
    const page = trackMuted(layers, 'g-page') ? undefined : clipsOf(layers, 'g-page').find(clip => activeAt(clip, time))
    const frame = page && frames.current.get(page.id)
    if (c && page && frame && pageOrigin) {
      const k = layers.width / c.width
      const hit = await askPage<{ selector: string; kind: string }>(frame, pageOrigin, 'ot-pick', { x: (event.clientX - c.left) * k, y: (event.clientY - c.top) * k })
      if (hit.selector) { onPlaying(false); closePicker(); setPicked(undefined); if (pagePick?.clipId !== page.id || pagePick?.selector !== hit.selector) setPageRect(undefined); setPagePick({ clipId: page.id, selector: hit.selector, kind: hit.kind ?? 'text' }); return }
    }
    unpick()
  }
  /** 移动 for a page element: it follows the pointer freely (page pixels), kept on release. */
  const beginPageMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!pagePick || !pageClip) return
    event.preventDefault()
    const k = layers.width / (canvasEl.current?.getBoundingClientRect().width || layers.width)
    const base = { dx: Number(pageMove?.dx) || 0, dy: Number(pageMove?.dy) || 0 }
    const x0 = event.clientX, y0 = event.clientY
    let latest = base
    const move = (next: PointerEvent) => { latest = { dx: Math.round(base.dx + (next.clientX - x0) * k), dy: Math.round(base.dy + (next.clientY - y0) * k) }; setPageDrag(latest) }
    const up = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true)
      setPageDrag(undefined)
      if (latest.dx !== base.dx || latest.dy !== base.dy) onSetPageElement?.(pagePick.clipId, pagePick.selector, latest)
    }
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true)
  }
  // ⌘-drag quotes an area of the picture into the conversation (the 通用剪辑 way to point at what to change); the
  // click that ends the drag does not also pick
  const [drawing, setDrawing] = useState<Box>()
  const drag = useRef<{ x: number; y: number } | null>(null)
  const quoteClick = useRef(false)
  const inCanvas = (event: { clientX: number; clientY: number }) => {
    const c = canvasEl.current!.getBoundingClientRect()
    return { x: Math.min(c.width, Math.max(0, event.clientX - c.left)), y: Math.min(c.height, Math.max(0, event.clientY - c.top)) }
  }
  const quoteHandlers = onQuote ? {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !(IS_MAC ? event.metaKey : event.ctrlKey)) return
      event.preventDefault(); event.stopPropagation()
      onPlaying(false); unpick()
      drag.current = inCanvas(event); quoteClick.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrawing({ ...drag.current, w: 0, h: 0 })
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => { if (drag.current) setDrawing(boxFromPoints(drag.current, inCanvas(event))) },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const start = drag.current
      if (!start) return
      drag.current = null; setDrawing(undefined)
      const box = boxFromPoints(start, inCanvas(event)), k = layers.width / (canvasEl.current?.getBoundingClientRect().width || layers.width)
      const area = { x: Math.round(box.x * k), y: Math.round(box.y * k), w: Math.round(box.w * k), h: Math.round(box.h * k) }
      if (area.w >= 12 && area.h >= 12) onQuote(area, Math.round(time * 100) / 100)
    },
    onPointerCancel: () => { drag.current = null; setDrawing(undefined) },
  } : {}
  const skipQuoteClick = () => { if (!quoteClick.current) return false; quoteClick.current = false; return true }
  const clock = useRef<{ at: number; from: number } | null>(null)
  const hyperframes = layers.engine === 'hyperframes'
  useEffect(() => {
    if (!playing || hyperframes) { clock.current = null; return }
    let frame = 0
    clock.current = { at: performance.now(), from: time }
    const tick = () => {
      const c = clock.current; if (!c) return
      const t = c.from + (performance.now() - c.at) / 1000
      if (t >= layers.duration) { onTime(layers.duration); onPlaying(false); return }
      onTime(t); frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps -- the clock starts from the time at play
  const seek = (t: number) => { const v = Math.max(0, Math.min(layers.duration, t)); if (clock.current) clock.current = { at: performance.now(), from: v }; onTime(v) }
  /** Double-click: the text track's text, else a page's editable text, else the footage under the pointer. */
  const editAt = async (event: ReactMouseEvent) => {
    const box = stage.current?.getBoundingClientRect()
    if (!box || !scale) return
    onPlaying(false)
    const toStage = (r: DOMRect | Box): Box => 'left' in r ? { x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: r.width / scale, h: r.height / scale } : r
    for (const el of textRoot.current?.children ?? []) {
      const r = el.getBoundingClientRect(), id = (el as HTMLElement).dataset.textId
      if (!id || event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) continue
      const clip = clipsOf(layers, 'g-text').find(c => c.id === id)
      if (clip) { setEditing({ clipId: id, text: clip.text ?? '', rect: toStage(r), style: styleOf(getComputedStyle(el)) }); return }
    }
    const x = (event.clientX - box.left) / scale, y = (event.clientY - box.top) / scale
    // a HyperFrames film: any text leaf of its page (a caption, a card's title), edited in the clip it belongs to
    if (hyperframes) {
      const hit = hfFrame.current && pageOrigin ? await pageHit(hfFrame.current, pageOrigin, x, y) : {}
      if (hit.clip && hit.name && hit.rect && hit.style) setEditing({ clipId: hit.clip, name: hit.name, text: hit.text ?? '', rect: hit.rect, style: hit.style })
      return
    }
    const page = trackMuted(layers, 'g-page') ? undefined : clipsOf(layers, 'g-page').find(c => activeAt(c, time))
    const frame = page && frames.current.get(page.id)
    if (page && frame && pageOrigin) {
      const hit = await pageHit(frame, pageOrigin, x, y)
      if (hit.name && hit.rect && hit.style) { setEditing({ clipId: page.id, name: hit.name, text: hit.text ?? '', rect: hit.rect, style: hit.style }); return }
    }
    const footage = clipsOf(layers, 'g-footage').find(c => activeAt(c, time)) ?? page
    if (footage) onPickClip?.(footage.id)
  }
  const cover = transitionCover(layers, time)
  const lastFrame = Math.max(0, Math.ceil(layers.duration * layers.fps) - 1) / layers.fps
  return <main className="preview-panel general-preview">
    <div ref={ref} className="preview-stage-viewport" style={{ '--preview-frame-width': `${size.width}px`, '--preview-frame-height': `${size.height}px` } as CSSProperties}>
      <div className="preview-frame-outline" aria-hidden="true" />
      <div ref={canvasEl} className="preview-canvas" style={{ aspectRatio: `${layers.width}/${layers.height}`, width: `${size.width}px`, height: `${size.height}px`, visibility: size.width > 0 ? 'visible' : 'hidden', overflow: 'hidden', background: '#000' }}>
        <div ref={stage} style={{ position: 'absolute', left: 0, top: 0, width: layers.width, height: layers.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
          {hyperframes ? <HyperframesLayer layers={layers} time={time} playing={playing} pageOrigin={pageOrigin} onTime={onTime} onPlaying={onPlaying} frame={hfFrame} /> : <>
          <FootageLayer layers={layers} time={time} playing={playing} mediaUrl={mediaUrl} />
          <PageLayer layers={layers} time={time} pageOrigin={pageOrigin} frames={frames} />
          <TextLayer layers={layers} time={time} presets={presets} fontsLoaded={fontsLoaded} root={textRoot}
            hiddenId={editing && !editing.name ? editing.clipId : picking ? picked : undefined} look={picked && trying ? { id: picked, preset: trying.preset, role: trying.all ? pickedItem?.role : undefined } : undefined} />
          </>}
          {FINISH[layers.finish] && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...FINISH[layers.finish] }} />}
          {cover && <div style={{ position: 'absolute', inset: 0, background: cover.color, opacity: cover.opacity, pointerEvents: 'none' }} />}
          {!hyperframes && <div className="ge-edit-surface" title={`单击文字或画面里的元素，可换样式、移动、调大小、旋转；双击文字直接改${onQuote ? `；按住 ${QUOTE_KEY} 拖动可以框选画面` : ''}`} {...quoteHandlers}
            onClick={event => { if (!skipQuoteClick()) void pickAt(event) }} onDoubleClick={event => { unpick(); void editAt(event) }} />}
          {hyperframes && <div className="ge-edit-surface" title={`单击文字或画面里的元素，可移动、调大小、旋转；双击文字直接改${onQuote ? `；按住 ${QUOTE_KEY} 拖动可以框选画面` : ''}`} {...quoteHandlers}
            onClick={event => { if (!skipQuoteClick()) void pickAt(event) }} onDoubleClick={event => { unpick(); void editAt(event) }} />}
          {picking && pickedItem && <>
            {/* the picture sinks under a dark, blurred veil; the chosen text stays sharp above it */}
            <div className="ge-pick-veil" onClick={closePicker} />
            <div style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}>
              <TextLayer layers={layers} time={time} presets={presets} fontsLoaded={fontsLoaded} root={spotRoot} only={picked} layer="ge-text-spot"
                look={trying ? { id: picked!, preset: trying.preset } : undefined} />
            </div>
          </>}
          {editing && <TextEditor key={`${editing.clipId}:${editing.name ?? ''}`} editing={editing} onDone={text => {
            setEditing(undefined)
            if (text === undefined || text === editing.text) return
            if (editing.name) onEditPageText?.(editing.clipId, editing.name, text)
            else onEditText?.(editing.clipId, text)
          }} />}
        </div>
        {!hyperframes && <SoundLayer layers={layers} time={time} playing={playing} pageOrigin={pageOrigin} />}
        <PlacementSlots rect={textRect} slots={cells} carry={placing.carry} />
        {(drawing || quoted) && <div className="ge ge-pick" style={{ inset: 0 }}>
          {drawing ? <div className="ge-sel" data-drawing style={{ left: drawing.x, top: drawing.y, width: drawing.w, height: drawing.h }} />
            : quoted && <div className="ge-sel" data-below={quoted.y < layers.height * 0.12 || undefined}
              style={{ left: quoted.x * scale, top: quoted.y * scale, width: quoted.w * scale, height: quoted.h * scale }}><em>已引用到对话</em></div>}
        </div>}
      </div>
      {pickedItem && pickedRect && !editing && <StylePicker rect={pickedRect} item={pickedItem} presets={presets} width={layers.width} height={layers.height}
        open={picking} onOpen={() => setPicking(true)} onClose={closePicker} onPreview={(name, all) => setTrying(name ? { preset: name, all: Boolean(all) } : undefined)}
        sameCount={textItems(layers).filter(item => item.role === pickedItem.role).length}
        onApply={(name, all) => { closePicker(); if (all || name !== pickedItem.preset) onSetPreset?.(pickedItem.id, name, all) }}
        size={pickedItem.size ?? 'mid'} onSize={next => onSetText?.(pickedItem.id, { size: next })}
        rotate={pickedItem.rotate ?? 0} onRotate={deg => onSetText?.(pickedItem.id, { rotate: deg })}
        onMoveStart={placing.begin} moving={Boolean(placing.carry)} />}
      {pagePick && pageClip && pageRect && !editing && <StylePicker rect={pageDrag ? { ...pageRect, left: pageRect.left + (pageDrag.dx - (Number(pageMove?.dx) || 0)) * size.width / layers.width, top: pageRect.top + (pageDrag.dy - (Number(pageMove?.dy) || 0)) * size.width / layers.width } : pageRect}
        presets={presets} width={layers.width} height={layers.height} open={false} onOpen={noopFn} onClose={noopFn} onPreview={noopFn} onApply={noopFn} sameCount={0}
        size={String(pageMove?.size ?? 'mid')} onSize={next => onSetPageElement?.(pagePick.clipId, pagePick.selector, { size: next })}
        rotate={Number(pageMove?.rotate) || 0} onRotate={deg => onSetPageElement?.(pagePick.clipId, pagePick.selector, { rotate: deg })}
        onMoveStart={beginPageMove} moving={false} />}
    </div>
    <div className="preview-controls">
      <span><span>{timecode(time)}</span> / {timecode(layers.duration)}</span>
      <button aria-label="回到首帧" title="回到首帧" onClick={() => { onPlaying(false); seek(0) }}><SkipBack size={18} /></button>
      <button aria-label="后退五秒" title="后退五秒" onClick={() => seek(time - 5)}><ChevronLeft /></button>
      <button className="preview-play" onClick={() => { if (!playing && time >= lastFrame) seek(0); onPlaying(!playing) }} aria-label={playing ? '暂停' : '播放'} title="播放/暂停（空格）">{playing ? <Pause /> : <Play />}</button>
      <button aria-label="前进五秒" title="前进五秒" onClick={() => seek(time + 5)}><ChevronRight /></button>
      <button aria-label="回到尾帧" title="回到尾帧" onClick={() => { onPlaying(false); seek(lastFrame) }}><SkipForward size={18} /></button>
      <div className="preview-progress-wrap">
        <input className="preview-progress" type="range" min={0} max={Math.max(layers.duration, 1 / layers.fps)} step={1 / layers.fps} value={Math.min(time, layers.duration)}
          aria-label="视频进度" aria-valuetext={`${timecode(time)} / ${timecode(layers.duration)}`}
          style={{ '--preview-progress': `${layers.duration > 0 ? Math.max(0, Math.min(100, time / layers.duration * 100)) : 0}%` } as CSSProperties}
          onChange={event => seek(Number(event.currentTarget.value))} />
      </div>
      <span className="general-preview-size">{layers.width}×{layers.height} · {layers.fps}fps</span>
    </div>
  </main>
}
