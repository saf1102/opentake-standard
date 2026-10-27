import catalog from '@/general/entrance-catalog.json'
import {ProStyleDialog} from '@/standard/ProStyleDialog'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { Check, ChevronLeft, ChevronRight, Pause, Play, Search, X } from 'lucide-react'
import { LIBRARY_STYLES } from './library-styles'
import {
  SOON_LABEL, STYLE_CREDIT_LINE, STYLE_INPUT_COPY, STYLE_INPUT_TYPES, countStyles, filterStyles, generalEditHref, groupStyles, isPickableStyle, neighbourStyle, rowEndIndex, styleCredit,
  type LibraryStyle, type StyleFilter, type StyleInputType,
} from './style-library'
import './style-library.css'

/**
 * 风格库 in two modes. 'browse' (the /styles page): the action opens a new general project with the style.
 * 'pick' (通用剪辑「① 选风格」): clicking a card chooses it (`onSelect`, a teal ring) and unfolds its detail; the detail's
 * action and the bar at the bottom hand the chosen style to `onPick`. 要准备数据 styles show 即将支持 and cannot be chosen.
 * A card plays its silent preview only while hovered; opening it unfolds the detail under its row.
 * Motion uses transform and opacity only.
 */
export type StyleLibraryProps = {
  /** Shown left of the search box (the page title, or the step name when picking). */
  readonly title?: ReactNode
} & (
  | { readonly mode: 'browse' }
  | { readonly mode: 'pick'; readonly onPick: (style: LibraryStyle) => void; readonly onSelect: (style: LibraryStyle) => void; readonly selectedId?: string; readonly pickLabel?: string }
)

type Direction = 'previous' | 'next'
const FILTERS: readonly { value: StyleFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  ...STYLE_INPUT_TYPES.map(type => ({ value: type, label: STYLE_INPUT_COPY[type].label })),
]
const HOVER_DELAY = 140

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The element that scrolls the page: a scrolling ancestor, or the document. */
function scrollParent(element: Element): Element {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node
  }
  return document.scrollingElement ?? document.documentElement
}

const cardElement = (root: Element, id: string) => root.querySelector<HTMLElement>(`[data-style-id="${CSS.escape(id)}"]`)

function clock(seconds: number) {
  const whole = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Columns the grid actually has, so the detail can open after the last card of a row. */
function useColumns(ref: RefObject<HTMLElement | null>) {
  const [columns, setColumns] = useState(6)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setColumns(Math.max(1, getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return columns
}

/** Start a clip muted. The source is set again in case a previous release cleared it (React runs effects twice in development). */
function startClip(video: HTMLVideoElement, src: string, play: boolean) {
  video.muted = true
  if (video.getAttribute('src') !== src) video.setAttribute('src', src)
  return play ? video.play() : Promise.resolve()
}
/** Stop the download when a clip leaves the page, not just its playback. */
function release(video: HTMLVideoElement) {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

/** The hover clip: mounted only while the card is hovered, faded in once frames arrive. */
function HoverClip({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false)
  const attach = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return
    void startClip(video, src, true).catch(() => {})
    return () => release(video)
  }, [src])
  return <video ref={attach} className="sl-thumb__clip" data-playing={playing || undefined} src={src} muted loop playsInline preload="auto"
    disablePictureInPicture tabIndex={-1} aria-hidden="true" onPlaying={() => setPlaying(true)} />
}

function StyleCard({ style, open, picked, soon, detailId, onToggle }: {
  style: LibraryStyle; open: boolean; picked: boolean; soon: boolean; detailId: string; onToggle: (style: LibraryStyle, card: HTMLElement) => void
}) {
  const [live, setLive] = useState(false)
  const timer = useRef(0)
  const start = () => {
    if (open || reducedMotion()) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLive(true), HOVER_DELAY)
  }
  const stop = () => { window.clearTimeout(timer.current); setLive(false) }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return <li className="sl-card" data-style-id={style.id} data-open={open || undefined} data-picked={picked || undefined} data-soon={soon || undefined}>
    <button type="button" className="sl-card__button" aria-expanded={open} aria-controls={open ? detailId : undefined}
      aria-label={soon ? `${style.name_zh}，${SOON_LABEL}` : undefined} aria-pressed={picked || undefined}
      onClick={event => { stop(); onToggle(style, event.currentTarget) }}
      onPointerEnter={start} onPointerLeave={stop}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) start() }} onBlur={stop}>
      <span className="sl-thumb">{soon && <span className="home-only standard-pro-badge">Pro</span>}
        <img src={style.poster} alt="" loading="lazy" decoding="async" draggable={false} />
        {live && !open && <HoverClip src={style.preview} />}
        {picked && <span className="sl-picked" title="已选"><Check size={13} strokeWidth={2.6} aria-label="已选" /></span>}
      </span>
      <span className="sl-card__name">{style.name_zh}</span>
      <span className="sl-card__line">{style.description_zh}</span>
    </button>
  </li>
}

/** The large preview: plays muted and looped (paused under reduced motion); the bar shows real playback time. */
function DetailPlayer({ style }: { style: LibraryStyle }) {
  const video = useRef<HTMLVideoElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  useEffect(() => {
    const element = video.current
    if (!element) return
    void startClip(element, style.preview, !reducedMotion()).catch(() => setPaused(true))
    return () => release(element)
  }, [style.preview])
  useEffect(() => {
    if (paused) return
    let frame = 0
    const paint = () => {
      const element = video.current, bar = fill.current
      if (element && bar && element.duration > 0) bar.style.transform = `scaleX(${Math.min(1, element.currentTime / element.duration)})`
      frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frame)
  }, [paused])
  const toggle = () => {
    const element = video.current
    if (!element) return
    if (element.paused) void element.play().catch(() => {})
    else element.pause()
  }
  return <div className="sl-player">
    <video ref={video} src={style.preview} poster={style.poster} muted loop playsInline preload="auto" disablePictureInPicture
      aria-label={`${style.name_zh}的预览，无声`} onClick={toggle}
      onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onLoadedMetadata={event => setDuration(event.currentTarget.duration)} />
    <div className="sl-player__bar">
      <button type="button" className="sl-player__toggle" onClick={toggle} aria-label={paused ? '播放预览' : '暂停预览'}>
        {paused ? <Play size={13} fill="currentColor" aria-hidden="true" /> : <Pause size={13} fill="currentColor" aria-hidden="true" />}
      </button>
      <span className="sl-player__track" aria-hidden="true"><span ref={fill} className="sl-player__fill" /></span>
      <span className="sl-player__time">{clock(time)} / {clock(duration)}</span>
    </div>
  </div>
}

function StyleDetail({ style, id, hasPrevious, hasNext, actionLabel, actionDisabled, onGo, onClose, onAction }: {
  style: LibraryStyle; id: string; hasPrevious: boolean; hasNext: boolean; actionLabel: string; actionDisabled: boolean
  onGo: (direction: Direction) => void; onClose: () => void; onAction: () => void
}) {
  return <section id={id} className="sl-detail" aria-label={`${style.name_zh}详情`} onKeyDown={event => {
    if (event.defaultPrevented) return
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault(); onGo(event.key === 'ArrowLeft' ? 'previous' : 'next')
    }
  }}>
    <DetailPlayer key={style.id} style={style} />
    <div key={`${style.id}-body`} className="sl-detail__body">
      <div className="sl-detail__top">
        <p className="sl-detail__eyebrow"><i className="sl-dot" aria-hidden="true" />{STYLE_INPUT_COPY[style.input_type].label}<span aria-hidden="true">·</span>{style.category_zh}</p>
        <div className="sl-detail__nav">
          <button type="button" data-nav="previous" disabled={!hasPrevious} onClick={() => onGo('previous')}><ChevronLeft size={15} aria-hidden="true" />上一个</button>
          <button type="button" data-nav="next" disabled={!hasNext} onClick={() => onGo('next')}>下一个<ChevronRight size={15} aria-hidden="true" /></button>
          <button type="button" data-nav="close" className="sl-detail__close" aria-label="收起详情" title="收起" onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <h3>{style.name_zh}</h3>
      <p className="sl-detail__line">{style.description_zh}</p>
      <dl className="sl-detail__facts">
        <div><dt>你要给</dt><dd>{style.user_provides.summary_zh}</dd></div>
        {style.uses.length > 0 && <div><dt>适合做</dt><dd>{style.uses.join(' · ')}</dd></div>}
      </dl>
      <div className="sl-detail__actions">
        {actionDisabled
          ? <button type="button" className="sl-primary" disabled>{SOON_LABEL}</button>
          : <button type="button" className="sl-primary" onClick={onAction}>{actionLabel}<ChevronRight size={16} aria-hidden="true" /></button>}
      </div>
      <div className="sl-detail__credit">
        <p><b>署名</b>{styleCredit(style.attribution)}</p>
        {style.third_party_in_preview.length > 0 && <p><b>第三方素材</b>{style.third_party_in_preview.join('；')}</p>}
      </div>
    </div>
  </section>
}

function StyleSection({ type, styles, order, openId, pickedId, picking, detailId, headingId, onToggle, detail }: {
  type: StyleInputType; styles: readonly LibraryStyle[]; order: number; openId: string | null; pickedId?: string; picking: boolean
  detailId: string; headingId: string; onToggle: (style: LibraryStyle, card: HTMLElement) => void; detail: ReactNode
}) {
  const grid = useRef<HTMLUListElement>(null)
  const columns = useColumns(grid)
  const openIndex = openId ? styles.findIndex(style => style.id === openId) : -1
  const detailAfter = openIndex >= 0 ? rowEndIndex(openIndex, columns, styles.length) : -1
  const copy = STYLE_INPUT_COPY[type]
  return <section className="sl-section" aria-labelledby={headingId} style={{ '--sl-order': order } as CSSProperties}>
    <header className="sl-section__head">
      <h2 id={headingId}>{copy.label}</h2>
      <span className="sl-section__count">{styles.length} 种</span>
      
      <p>{copy.gives}</p>
    </header>
    <ul ref={grid} className="sl-grid">
      {styles.flatMap((style, index) => {
        const card = <StyleCard key={style.id} style={style} open={style.id === openId} picked={style.id === pickedId} soon={!isPickableStyle(style)}
          detailId={detailId} onToggle={onToggle} />
        return index === detailAfter ? [card, <li key="detail" className="sl-grid__detail">{detail}</li>] : [card]
      })}
    </ul>
  </section>
}

export function StyleLibrary(props: StyleLibraryProps) {
  const navigate = useNavigate()
  const uid = useId()
  const root = useRef<HTMLDivElement>(null)
  const [category,setCategory] = useState('全部')
  const [proStyle,setProStyle] = useState<string|null>(null)
  const categories = catalog.entries.find(e=>e.key==='footage')!.cats
  const [filter, setFilter] = useState<StyleFilter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  /** What has to stay put on screen across the next change: the clicked card, or the detail when stepping. */
  const anchor = useRef<{ target: 'card' | 'detail'; id: string; top: number } | null>(null)
  const pendingFocus = useRef<Direction | null>(null)
  const visible = useMemo(() => filterStyles(LIBRARY_STYLES, filter, query).filter(s=>category==='全部'||categories.find(c=>c.name===category)?.styles.includes(s.id)), [filter, query, category])
  const counts = useMemo(() => countStyles(LIBRARY_STYLES, query), [query])
  const groups = useMemo(() => groupStyles(visible), [visible])
  const open = openId ? visible.find(style => style.id === openId) : undefined
  const detailId = `${uid}-detail`

  /** A search that hides the open style closes it, so it does not reappear later by surprise. */
  const search = (value: string) => {
    setQuery(value)
    if (openId && !filterStyles(LIBRARY_STYLES, filter, value).some(style => style.id === openId)) setOpenId(null)
  }

  useLayoutEffect(() => {
    const element = root.current
    const pending = anchor.current
    anchor.current = null
    if (!element || !openId) return
    if (pending) {
      const target = pending.target === 'card' ? cardElement(element, pending.id) : element.querySelector('.sl-detail')
      const delta = target ? target.getBoundingClientRect().top - pending.top : 0
      if (Math.abs(delta) >= 1) scrollParent(element).scrollBy({ top: delta, behavior: 'instant' })
    }
    const detail = element.querySelector<HTMLElement>('.sl-detail')
    const focus = pendingFocus.current
    pendingFocus.current = null
    if (focus && detail) (detail.querySelector<HTMLButtonElement>(`[data-nav=${focus}]:not(:disabled)`) ?? detail.querySelector<HTMLButtonElement>('[data-nav=close]'))?.focus({ preventScroll: true })
    detail?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [openId])

  const select = props.mode === 'pick' ? props.onSelect : undefined
  const toggle = useCallback((style: LibraryStyle, card: HTMLElement) => {
    if(!isPickableStyle(style)){setProStyle(style.id);return}
    select?.(style)
    if (openId === style.id) { setOpenId(null); return }
    anchor.current = { target: 'card', id: style.id, top: card.getBoundingClientRect().top }
    setOpenId(style.id)
  }, [openId, select])

  const go = (direction: Direction) => {
    if (!open) return
    const next = neighbourStyle(visible, open.id, direction)
    if (!next) return
    const detail = root.current?.querySelector('.sl-detail')
    if (detail) anchor.current = { target: 'detail', id: next.id, top: detail.getBoundingClientRect().top }
    if (detail?.contains(document.activeElement)) pendingFocus.current = direction
    setOpenId(next.id)
  }

  const close = () => {
    if (!open) return
    const id = open.id
    const restore = !!root.current?.querySelector('.sl-detail')?.contains(document.activeElement)
    setOpenId(null)
    if (restore) requestAnimationFrame(() => { if (root.current) cardElement(root.current, id)?.querySelector('button')?.focus({ preventScroll: true }) })
  }

  const choose = (value: StyleFilter) => { setFilter(value); setOpenId(null) }
  const act = (style: LibraryStyle) => { if (props.mode === 'pick') props.onPick(style); else navigate(generalEditHref(style.id)) }
  const actionLabel = props.mode === 'pick' ? props.pickLabel ?? '选这个风格' : '用这个风格新建通用工程'
  const picked = props.mode === 'pick' ? LIBRARY_STYLES.find(style => style.id === props.selectedId && isPickableStyle(style)) : undefined
  const detail = open && <StyleDetail style={open} id={detailId} actionLabel={actionLabel} actionDisabled={!isPickableStyle(open)}
    hasPrevious={!!neighbourStyle(visible, open.id, 'previous')} hasNext={!!neighbourStyle(visible, open.id, 'next')}
    onGo={go} onClose={close} onAction={() => act(open)} />

  return <div ref={root} className="style-library" data-mode={props.mode} onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && open) { event.preventDefault(); close() }
  }}>
    <div className="sl-bar">
      {props.title && <div className="sl-bar__title">{props.title}</div>}
      <div className="sl-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={query} placeholder="搜风格：水墨、新闻、像素…" aria-label="搜索风格" spellCheck={false}
          onChange={event => search(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); search('') } }} />
        {query && <button type="button" className="sl-search__clear" aria-label="清除搜索" onClick={() => search('')}><X size={14} aria-hidden="true" /></button>}
      </div>
    </div>
    <div className="sl-filters" role="group" aria-label="按你要准备的东西筛选">
      {FILTERS.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => choose(item.value)}>
        {item.label}<span className="sl-filters__count">{counts[item.value]}</span>
      </button>)}
    </div>
    <div className="sl-filters" role="group" aria-label="按九类用途筛选">{['全部',...categories.map(c=>c.name)].map(name=><button key={name} aria-pressed={category===name} onClick={()=>{setCategory(name);setOpenId(null)}}>{name}</button>)}<span>56 个风格 · 10 个可用</span></div>
    <ProStyleDialog id={proStyle} onClose={()=>setProStyle(null)}/>
    {groups.map((group, index) => <StyleSection key={group.type} type={group.type} styles={group.styles} order={index}
      openId={open ? open.id : null} pickedId={picked?.id} picking={props.mode === 'pick'}
      detailId={detailId} headingId={`${uid}-${group.type}`} onToggle={toggle} detail={detail} />)}
    {!groups.length && <div className="sl-empty" role="status">
      {counts.all > 0
        ? <><p>这一类里没有和「{query.trim()}」有关的风格</p><button type="button" onClick={() => choose('all')}>在全部里看</button></>
        : <><p>没有和「{query.trim()}」有关的风格</p><button type="button" onClick={() => search('')}>清除搜索</button></>}
    </div>}
    <p className="sl-credit">{STYLE_CREDIT_LINE}</p>
    {props.mode === 'pick' && picked && !open && <div className="sl-pickbar" role="region" aria-label="已选风格">
      <img src={picked.poster} alt="" draggable={false} />
      <div className="sl-pickbar__text"><b>{picked.name_zh}</b><span>{STYLE_INPUT_COPY[picked.input_type].label} · {picked.category_zh}</span></div>
      <button type="button" className="sl-primary" onClick={() => props.onPick(picked)}>{actionLabel}<ChevronRight size={16} aria-hidden="true" /></button>
    </div>}
  </div>
}
