/**
 * 新建通用剪辑 (S先生 2026-10-26, entrance mock v4): three entrances (不用风格 first, then 上传视频 and 给文案), the purposes
 * of the chosen one in one column with beams fanning out to them, then that purpose's styles as a poster flow — the
 * chosen cover always in the middle, the row wrapping around. Over the posters, the first two columns fold left like an
 * accordion and the posters take the room. The stage is drawn at 1600×900 and scaled to the page.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, Type, Video } from 'lucide-react'
import { LIBRARY_STYLES } from '@/workspace/style-library/library-styles'
import { styleById } from '@/workspace/style-library/style-library'
import {type GeneralInputKind} from './general-contract'
import {Composer, EntranceHandoff, EntranceUpgrade, entranceHasFreeStyle, entranceCountSuffix, categoryAllowed, type Handoff} from './entrance-edition'
import catalog from './entrance-catalog.json'
import './general-entrance.css'
import {FirstAgentChoice, useFirstAgentChoice} from './FirstAgentChoice'

export type EntryKey = 'free' | GeneralInputKind
type Cat = { name: string; styles: string[]; star: string[] }
const ENTRIES = catalog.entries as { key: GeneralInputKind; name: string; hint: string; cats: Cat[] }[]
const W = 1600, H = 900
const ENT = { x: 72, w: 380, h: 162, top: (i: number) => 205 + i * 190 }
const CAT_X = 600
const catY = (j: number, n: number) => 450 + (j - (n - 1) / 2) * Math.min(74, 640 / Math.max(1, n - 1))
const styleCount = (key: GeneralInputKind) => new Set(ENTRIES.find(e => e.key === key)!.cats.flatMap(c => c.styles)).size
export const ALL_STYLE_COUNT = LIBRARY_STYLES.length

/** A soft beam from (a) to (b), as the mock draws it. */
const beamPath = (ax: number, ay: number, bx: number, by: number) => `M${ax} ${ay} C${ax + (bx - ax) * 0.55} ${ay},${ax + (bx - ax) * 0.45} ${by},${bx} ${by}`

/** The light that runs a beam once when it opens (it stays quiet afterwards). */
function runSpark(svg: SVGSVGElement, path: SVGPathElement, delay: number, ms = 560) {
  return window.setTimeout(() => {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    dot.setAttribute('class', 'ge-en-spark'); svg.append(dot)
    const length = path.getTotalLength(), t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3), q = path.getPointAtLength(e * length)
      dot.setAttribute('cx', String(q.x)); dot.setAttribute('cy', String(q.y)); dot.setAttribute('r', String(3.2 * (1 - k * 0.4)))
      dot.style.opacity = String(k < 0.85 ? 1 : (1 - k) / 0.15)
      if (k < 1) requestAnimationFrame(step); else dot.remove()
    }
    requestAnimationFrame(step)
  }, delay)
}

/** Fits the 1600×900 stage into the page. */
function useStageScale() {
  const ref = useRef<HTMLElement>(null)
  const [scale, setScale] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => setScale(Math.min(el.clientWidth / W, el.clientHeight / H))
    fit()
    const observer = new ResizeObserver(fit); observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, scale }
}

const ICONS: Record<EntryKey, typeof Video> = { free: Sparkles, footage: Video, topic: Type }


export function GeneralEntrance({ entry: given, cat: givenCat, focusId, onEntry, onCat, onPick, onAll, handoff, onDropHandoff }: {
  entry?: EntryKey; cat?: number; focusId?: string
  /** 拿去剪: the 稿子 the words came from */
  handoff?: Handoff; onDropHandoff?: () => void
  onEntry: (entry: EntryKey) => void; onCat: (cat: number) => void
  /** a style chosen from the posters of this entrance */
  onPick: (styleId: string, entry: GeneralInputKind, cat: number) => void
  onAll: () => void
}) {
  const firstAgent = useFirstAgentChoice()
  const { ref, scale } = useStageScale()
  const [proStyle, setProStyle] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState('')
  const entry = given, data = entry && entry !== 'free' ? ENTRIES.find(e => e.key === entry) : undefined
  const cat = data && givenCat !== undefined && data.cats[givenCat] ? givenCat : undefined
  const cats = data?.cats ?? []
  const shown = cat !== undefined ? cats[cat] : undefined
  const ids = shown ? [...shown.star, ...shown.styles.filter(id => !shown.star.includes(id))] : []
  const [focus, setFocus] = useState(0)
  const [wide, setWide] = useState(false)
  // a new purpose starts on its first cover, or on the style the person came back from; another entrance unfolds the
  // columns, another purpose keeps them folded (the person is going down the folded column trying purposes)
  const shownKey = `${entry}|${cat}`
  const [seenKey, setSeenKey] = useState('')
  if (seenKey !== shownKey) {
    if (seenKey.split('|')[0] !== String(entry)) setWide(false)
    setSeenKey(shownKey); setFocus(Math.max(0, focusId ? ids.indexOf(focusId) : 0))
  }
  const go = (d: number) => { if (ids.length) setFocus(f => (f + d + ids.length) % ids.length) }
  useEffect(() => {
    if (!ids.length) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('textarea,input')) return
      if (event.key === 'ArrowRight') go(1)
      if (event.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  // the beams of the open entrance: drawn once as they appear, a light running each
  const svg = useRef<SVGSVGElement>(null)
  const entIndex = entry ? (entry === 'free' ? 0 : Number(entranceHasFreeStyle) + ENTRIES.findIndex(e => e.key === entry)) : -1
  const from = entIndex >= 0 ? { x: ENT.x + ENT.w, y: ENT.top(entIndex) + ENT.h / 2 } : undefined
  const beams = !from ? [] : entry === 'free' ? [{ d: beamPath(from.x, from.y, 560, 330), hot: true }]
    : cats.map((_, j) => ({ d: beamPath(from.x, from.y, CAT_X, catY(j, cats.length)), hot: j === cat }))
  useEffect(() => {
    const el = svg.current
    if (!el || !entry || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timers = [...el.querySelectorAll<SVGPathElement>('path.ge-en-beam')].map((path, j) => runSpark(el, path, j * 45 + (entry === 'free' ? 140 : 60)))
    return () => { for (const t of timers) window.clearTimeout(t); for (const dot of el.querySelectorAll('.ge-en-spark')) dot.remove() }
  }, [entry])

  const entries: { key: EntryKey; name: string; hint: string; count?: number }[] = [
    ...(entranceHasFreeStyle ? [{ key: 'free' as const, name: '不用风格，直接开始', hint: '把素材和想法交给它，完全按你的要求做' }] : []),
    ...ENTRIES.map(e => ({ key: e.key, name: e.name, hint: e.hint, count: styleCount(e.key) })),
  ]
  // folded, the columns stay folded while the pointer is on the posters or the purposes (and the gaps between them);
  // they open again when it reaches the entrances or leaves the page
  const unfoldAt = (event: ReactMouseEvent) => {
    if (!wide || !scale) return
    const box = ref.current!.getBoundingClientRect(), x = (event.clientX - box.left - (box.width - W * scale) / 2) / scale
    if (x < 130) setWide(false)
  }
  return <main ref={ref} className="ge-en" data-choosing-agent={firstAgent.open || undefined} data-wide={wide || undefined} aria-label="新建通用剪辑" onMouseMove={unfoldAt} onMouseLeave={() => setWide(false)}>
    <div className="ge-en-stage" style={{ transform: `translate(-50%,-50%) scale(${scale || 0.001})`, visibility: scale ? 'visible' : 'hidden' } as CSSProperties}>
      <h1>新建通用剪辑<small>先选你手上的东西，再选想做什么，最后挑一个风格</small></h1>
      {firstAgent.enabled && <button type="button" className="ge-en-choose-agent" onClick={firstAgent.show} aria-label="选择出片智能体">{firstAgent.label}</button>}
      {firstAgent.error && <p className="ge-en-agent-read-error" role="status">{firstAgent.error}</p>}
      <button type="button" disabled={firstAgent.open} className="ge-en-all" onClick={onAll}>看全部 {ALL_STYLE_COUNT} 个风格{entranceCountSuffix}</button>
      <svg ref={svg} className="ge-en-beams" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs>
          <linearGradient id="ge-en-g" x1="0" x2="1"><stop offset="0" stopColor="var(--en-accent)" stopOpacity="0" /><stop offset=".2" stopColor="var(--en-accent)" stopOpacity=".35" /><stop offset="1" stopColor="var(--en-beam-end)" stopOpacity=".08" /></linearGradient>
          <linearGradient id="ge-en-gh" x1="0" x2="1"><stop offset="0" stopColor="var(--en-accent)" stopOpacity=".1" /><stop offset=".4" stopColor="var(--en-accent)" stopOpacity=".9" /><stop offset="1" stopColor="var(--en-accent-soft)" stopOpacity=".5" /></linearGradient>
        </defs>
        {beams.map((b, j) => <path key={`${entry}-${j}`} className="ge-en-beam" data-hot={b.hot || undefined} d={b.d} pathLength={1} style={{ animationDelay: `${j * 45}ms` }} />)}
      </svg>
      {entries.map((e, i) => {
        const Icon = ICONS[e.key]
        return <button type="button" key={e.key} className="ge-en-ent" data-on={entry === e.key || undefined} data-away={(entry && entry !== e.key) || undefined}
          disabled={firstAgent.open} style={{ top: firstAgent.open ? 250 + i * 140 : ENT.top(i) }} onClick={() => onEntry(e.key)} aria-pressed={entry === e.key}>
          <span className="ic"><Icon size={22} aria-hidden /></span><b>{e.name}</b><span className="hint">{e.hint}</span>
          <i>{e.count === undefined ? <em className="free">自由</em> : <><em>{e.count}</em>个风格</>}</i>
        </button>
      })}
      {!firstAgent.open && handoff && !wide && <div className="ge-en-from"><EntranceHandoff handoff={handoff} onDrop={() => onDropHandoff?.()} /></div>}
      {!firstAgent.open && entranceHasFreeStyle && entry === 'free' && <Composer key={handoff ? 'from' : 'blank'} handoff={handoff} />}
      {!firstAgent.open && data && cats.map((c, j) => <button type="button" key={`${entry}-${c.name}`} className="ge-en-cat" data-pro={!c.styles.some(id => categoryAllowed(j, id)) || undefined} data-on={cat === j || undefined} data-away={(cat !== undefined && cat !== j) || undefined}
        style={{ left: CAT_X, top: catY(j, cats.length), animationDelay: `${j * 45 + 420}ms` }} onClick={() => { onCat(j); if (!c.styles.some(id => categoryAllowed(j, id))) setProStyle(c.styles[0] || null) }} aria-pressed={cat === j}>
        <span className="ge-en-chip"><b>{c.name}</b><i>{c.styles.length}</i>{!c.styles.some(id => categoryAllowed(j, id)) && <span className="standard-pro-badge">Pro</span>}</span>
      </button>)}
      {!firstAgent.open && shown && entry !== 'free' && <section key={shownKey} className="ge-en-flow" onMouseEnter={() => setWide(true)} aria-label={`${shown.name}的风格`}>
        <header>
          <div><b>{shown.name}</b><small>{ids.length} 个风格{shown.star.length ? ' · ★ 最适合你的素材' : ''}</small></div>
          <div className="nav"><button type="button" aria-label="上一个" onClick={() => go(-1)}><ChevronLeft size={18} aria-hidden /></button><button type="button" aria-label="下一个" onClick={() => go(1)}><ChevronRight size={18} aria-hidden /></button></div>
        </header>
        <div className="ge-en-posters">
          {ids.map((id, i) => {
            const style = styleById(LIBRARY_STYLES, id)
            if (!style) return null
            // the chosen cover always stands in the middle; the row wraps around, so both sides stay full
            const n = ids.length
            let o = i - focus
            if (n > 2) { if (o > n / 2) o -= n; if (o < -n / 2) o += n }
            const a = Math.abs(o), side = Math.sign(o), cap = wide ? 5 : 3, first = wide ? 205 : 150, step = wide ? 102 : 92
            const x = o === 0 ? 0 : side * (first + (a - 1) * step), z = o === 0 ? (wide ? 150 : 110) : -140 - a * 30, ry = o === 0 ? 0 : -side * 52, visible = a <= cap
            const star = shown.star.includes(id)
            return <article key={id} className="ge-en-pc" data-pro={!categoryAllowed(cat!, id) || undefined} role="button" tabIndex={visible ? 0 : -1} aria-label={style.name_zh}
              onMouseEnter={() => setHoverId(id)} onMouseLeave={() => setHoverId('')} onFocus={() => setHoverId(id)} onBlur={() => setHoverId('')}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); categoryAllowed(cat!, id) ? onPick(id, entry as GeneralInputKind, cat!) : setProStyle(id) } }} data-front={o === 0 || undefined} data-side={o < 0 ? 'l' : o > 0 ? 'r' : undefined} title={style.description_zh}
              style={{ transform: `translateX(${x}px) translateZ(${z}px) rotateY(${ry}deg)`, opacity: visible ? (o === 0 ? 1 : Math.max(0.25, 1 - a * 0.2)) : 0, zIndex: 50 - a, pointerEvents: visible ? 'auto' : 'none' }}
              onClick={() => !categoryAllowed(cat!, id) ? setProStyle(id) : (o === 0 ? onPick(id, entry as GeneralInputKind, cat!) : setFocus(i))}>
              <img src={style.poster} alt="" draggable={false} />
              {hoverId === id && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && <video style={{position: 'absolute', inset: 0, width: '100%', height: 250, objectFit: 'cover'}} src={style.preview} autoPlay muted loop playsInline aria-hidden="true" />}
              {!categoryAllowed(cat!, id) && <span className="standard-pro-badge">Pro</span>}
              {o === 0 && <span className="ge-en-use">{categoryAllowed(cat!, id) ? '用这个风格' : '了解 Pro'}<ChevronRight size={14} aria-hidden /></span>}
              <div className="txt"><b>{style.name_zh}{star && <em>★</em>}</b><p>{style.description_zh}</p>
                <div className="tags">{style.uses.slice(0, 3).map(u => <i key={u}>{u}</i>)}</div></div>
            </article>
          })}
        </div>
        <div className="ge-en-reflect" />
        <div className="ge-en-dots">{ids.map((id, i) => <i key={id} data-on={i === focus || undefined} />)}</div>
      </section>}
      {firstAgent.open && <FirstAgentChoice onDone={firstAgent.close}/>}
    </div>
    <EntranceUpgrade id={proStyle} onClose={() => setProStyle(null)}/>
  </main>
}
