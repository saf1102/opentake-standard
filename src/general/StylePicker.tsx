/**
 * Tools for a text on the preview (S先生 2026-10-25, from the approved mock): a frame round the chosen text and a bar
 * above it with 样式 · 移动 · 大小 · 旋转. 样式 the tag opens a column of thumbnails beside the text, each the very same words in one look, joined
 * by branches that grow out of a hollow port on the frame's edge. Four show at a time; the wheel brings the rest up
 * like a waterfall (this role's own looks first, then the others, sized to the role). Hovering previews, a click keeps it.
 * Drawn in a portal with fixed positions, from the text's screen rectangle, so it is never clipped by the preview.
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Move, RotateCw, Scaling, Undo2 } from 'lucide-react'
import { renderTextLayer, type TextItem } from '../../server/general/kit/web/text.js'

const TW = 208, TH = 117, GAP = 14, ROW = TH + GAP, SHOW = 4, DIVIDER = 34

type Box = { left: number; top: number; width: number; height: number }
type Props = {
  /** the text-track item; absent for an element of a page (no looks to pick: 移动 · 大小 · 旋转 only) */
  rect: Box; item?: TextItem; presets: Record<string, unknown>; width: number; height: number
  open: boolean; onOpen: () => void; onClose: () => void
  onPreview: (preset?: string, all?: boolean) => void; onApply: (preset: string, all: boolean) => void
  /** how many texts share this one's role (title, caption, label): 同类全部 changes them all */
  sameCount: number
  /** 大小 in three steps, 旋转 in 15° steps, 移动 by the 口播 nine-cell drag (its press starts the drag) */
  size: string; onSize: (size: string) => void; rotate: number; onRotate: (deg: number) => void
  onMoveStart: (event: ReactPointerEvent<HTMLElement>) => void; moving: boolean
}

const SIZES = ['small', 'mid', 'large'] as const
const SIZE_LABEL: Record<string, string> = { small: '小', mid: '中', large: '大' }

const NO_TEXT: TextItem = { id: '', start: 0, end: 0, text: '', preset: '' }
const rolesOf = (preset: unknown) => (preset as { roles?: string[] })?.roles ?? []
/** A light ground under dark type, a dark one under light type. */
function groundFor(preset: unknown) {
  const color = String((preset as { color?: string })?.color ?? '#fff')
  const hex = /^#([0-9a-f]{6})/i.exec(color)?.[1]
  const [r, g, b] = hex ? [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) : (color.match(/[\d.]+/g) ?? ['255', '255', '255']).map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? '#ECEAE5' : '#24262B'
}

/** The words in one look, framed to fill the tile. */
function Thumb({ item, name, presets, width, height }: { item: TextItem; name: string; presets: Record<string, unknown>; width: number; height: number }) {
  const mini = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = mini.current
    if (!el) return
    el.style.transform = 'none'
    renderTextLayer(el, [{ ...item, preset: name, place: 'center', reveal: 'none', start: 0, end: 1 }], 0.5, { width, height, presets })
    const text = el.firstElementChild as HTMLElement | null
    if (!text) return
    const s = Math.min(TW * 0.84 / text.offsetWidth, TH * 0.72 / text.offsetHeight, 0.5)
    el.style.transform = `translate(${TW / 2 - width / 2 * s}px,${TH / 2 - height / 2 * s}px) scale(${s})`
  }, [item, name, presets, width, height])
  return <div ref={mini} className="ge-pick-mini" style={{ width, height }} />
}

export function StylePicker({ rect, item: given, presets, width, height, open, onOpen, onClose, onPreview, onApply, sameCount, size, onSize, rotate, onRotate, onMoveStart, moving }: Props) {
  // a page element has no item: the bar shows 移动 · 大小 · 旋转 only, and the look column never opens
  const item: TextItem = given ?? NO_TEXT
  const [tool, setTool] = useState<'size' | 'rotate'>()
  const [all, setAll] = useState(false)
  // a new text starts with the bar folded
  const [toolFor, setToolFor] = useState(item.id)
  if (toolFor !== item.id) { setToolFor(item.id); setTool(undefined) }
  const own = Object.keys(presets).filter(n => rolesOf(presets[n]).includes(item.role ?? ''))
  const others = Object.keys(presets).filter(n => !rolesOf(presets[n]).includes(item.role ?? ''))
  const rows: { name?: string; y: number }[] = []
  let y = 0
  for (const name of own) { rows.push({ name, y }); y += ROW }
  if (own.length && others.length) { rows.push({ y }); y += DIVIDER }
  for (const name of others) { rows.push({ name, y }); y += ROW }
  const contentH = y - GAP, viewH = SHOW * TH + (SHOW - 1) * GAP
  const [scroll, setScroll] = useState(0)
  const target = useRef(0)
  const [grown, setGrown] = useState(0) // branches drawn so far, for the reveal

  // the frame is padded by 6 px; the port sits on its edge, at the middle of the text's side
  // the frame follows the text as it is now; the bar, the port and the column hold still while the picker is open, so
  // trying looks (the text grows, shrinks, moves) never shakes them (S先生: 标签不能跟着悬停预览抖)
  const frame = { left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }
  const [held, setHeld] = useState<Box>()
  const [heldFor, setHeldFor] = useState(false)
  if (heldFor !== open) { setHeldFor(open); setHeld(open ? frame : undefined) }
  const anchor = open && held ? held : frame
  const below = anchor.top < 70
  const barX = anchor.left + anchor.width / 2, barY = below ? anchor.top + anchor.height + 10 : anchor.top - 10
  // the branches leave from a hollow port at the bar's right end
  const bar = useRef<HTMLDivElement>(null)
  const [barBox, setBarBox] = useState<{ left: number; right: number; mid: number }>()
  useLayoutEffect(() => {
    const r = bar.current?.getBoundingClientRect()
    if (!r) return
    setBarBox(current => current && Math.abs(current.left - r.left) + Math.abs(current.right - r.right) + Math.abs(current.mid - (r.top + r.height / 2)) < 0.5 ? current : { left: r.left, right: r.right, mid: r.top + r.height / 2 })
  }, [barX, barY, open, tool])
  // the column goes right of the bar when there is room, else left of it, and the port sits on that end
  const right = (barBox?.right ?? barX) + 10 + 84 + TW < window.innerWidth - 12
  const portX = right ? (barBox?.right ?? barX) + 10 : (barBox?.left ?? barX) - 10, portY = barBox?.mid ?? barY
  const colX = right ? portX + 84 : portX - 84 - TW
  const colTop = Math.max(16, Math.min(window.innerHeight - viewH - 40, anchor.top + anchor.height / 2 - viewH / 2))

  useEffect(() => {
    if (!open) return
    setScroll(0); target.current = 0; setGrown(0)
    let n = 0
    const timer = window.setInterval(() => { n += 1; setGrown(n); if (n > SHOW) window.clearInterval(timer) }, 60)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', onKey, true) }
  }, [open, item.id]) // eslint-disable-line react-hooks/exhaustive-deps -- reset per opening

  const wheel = (event: React.WheelEvent) => {
    target.current = Math.max(0, Math.min(Math.max(0, contentH - viewH), target.current + event.deltaY))
    const step = () => setScroll(current => {
      const next = Math.abs(target.current - current) < 0.3 ? target.current : current + (target.current - current) * 0.22
      if (next !== target.current) requestAnimationFrame(step)
      return next
    })
    requestAnimationFrame(step)
  }

  let hiddenAbove = 0, hiddenBelow = 0, visibleIndex = 0
  const placed = rows.map(row => {
    const mid = row.y - scroll + TH / 2
    if (row.name) { if (mid < 0) hiddenAbove++; else if (mid > viewH) hiddenBelow++ }
    const edge = Math.min(mid + TH / 2, viewH - (mid - TH / 2))
    const k = Math.max(0, Math.min(1, edge / (TH * 0.9)))
    const order = row.name && row.y + TH <= viewH ? visibleIndex++ : -1
    return { ...row, mid, k, order }
  })

  return createPortal(<>
    <div className="ge-pick-frame" style={frame} />
    {/* four tools; 大小 and 旋转 open a slider in the bar itself and push the others aside */}
    {!moving && <div ref={bar} className="ge-pick-bar" data-below={below || undefined} style={{ left: barX, top: barY }}
      onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      {given && <button type="button" className="ge-pick-tool" data-open={open || undefined} onClick={() => { setTool(undefined); if (open) onClose(); else onOpen() }}><i>Aa</i>样式</button>}
      <button type="button" className="ge-pick-tool" title="按住拖到九宫格的位置" onPointerDown={event => { setTool(undefined); onClose(); onMoveStart(event) }}><Move aria-hidden />移动</button>
      <div className="ge-pick-group" data-open={tool === 'size' || undefined}>
        <button type="button" className="ge-pick-tool" data-open={tool === 'size' || undefined} onClick={() => { onClose(); setTool(tool === 'size' ? undefined : 'size') }}><Scaling aria-hidden />大小</button>
        {tool === 'size' && <span className="ge-pick-slider">
          <input type="range" min={0} max={2} step={1} value={Math.max(0, SIZES.indexOf(size as typeof SIZES[number]))} aria-label="文字大小" aria-valuetext={SIZE_LABEL[size] ?? '中'}
            onChange={event => onSize(SIZES[Number(event.currentTarget.value)])} />
          <output>{SIZE_LABEL[size] ?? '中'}</output>
        </span>}
      </div>
      <div className="ge-pick-group" data-open={tool === 'rotate' || undefined}>
        <button type="button" className="ge-pick-tool" data-open={tool === 'rotate' || undefined} onClick={() => { onClose(); setTool(tool === 'rotate' ? undefined : 'rotate') }}><RotateCw aria-hidden />旋转</button>
        {tool === 'rotate' && <span className="ge-pick-slider wide">
          <input type="range" min={-180} max={180} step={15} value={rotate} aria-label="旋转角度" aria-valuetext={`${rotate}°`}
            onChange={event => onRotate(Number(event.currentTarget.value))} onDoubleClick={() => onRotate(0)} />
          <output>{rotate}°</output>
          <button type="button" className="ge-pick-reset" title="回正" disabled={!rotate} onClick={() => onRotate(0)}><Undo2 aria-hidden /></button>
        </span>}
      </div>
    </div>}
    {open && given && <>
      <svg className="ge-pick-wires" aria-hidden="true">
        {placed.map((row, i) => {
          if (!row.name || row.k <= 0.05) return null
          if (row.order >= 0 && row.order >= grown && scroll === 0) return null
          const x1 = right ? colX - 6 : colX + TW + 6, y1 = colTop + row.mid, mx = (portX + x1) / 2
          return <path key={i} className={row.order >= 0 && scroll === 0 ? 'grow' : undefined} style={{ opacity: Math.min(1, row.k) }}
            d={`M${portX} ${portY} C${mx} ${portY} ${mx} ${y1} ${x1} ${y1}`} />
        })}
      </svg>
      <span className="ge-pick-port" style={{ left: portX, top: portY }} />
      <div className="ge-pick-col" style={{ left: colX, top: colTop, height: viewH }} onWheel={wheel}>
        {placed.map((row, i) => row.name
          ? <button key={row.name} type="button" className={`ge-pick-node${row.name === item.preset ? ' current' : ''}${row.order < 0 || row.order < grown || scroll > 0 ? ' on' : ''}`}
            style={{ top: row.mid, opacity: row.k, background: groundFor(presets[row.name]), transform: `translate(0,-50%) scale(${0.9 + 0.1 * row.k})` }}
            title={row.name} aria-label={`样式：${row.name}`}
            onMouseEnter={() => onPreview(row.name, all)} onMouseLeave={() => onPreview(undefined)}
            onClick={event => { event.stopPropagation(); onApply(row.name!, all) }}>
            <Thumb item={item} name={row.name} presets={presets} width={width} height={height} />
          </button>
          : <div key={`d${i}`} className="ge-pick-divider" style={{ top: row.y - scroll }}>其他类别 · 字号自动缩放</div>)}
      </div>
      {sameCount > 1 && <div className="ge-pick-scope" role="radiogroup" aria-label="改哪些" style={{ left: colX + TW / 2, top: colTop - (hiddenAbove > 0 ? 44 : 14) }}
        onClick={event => event.stopPropagation()}>
        <button type="button" role="radio" aria-checked={!all} className={!all ? 'on' : ''} onClick={() => setAll(false)}>只改这一句</button>
        <button type="button" role="radio" aria-checked={all} className={all ? 'on' : ''} onClick={() => setAll(true)}>同类全部 {sameCount} 句</button>
      </div>}
      {hiddenAbove > 0 && <span className="ge-pick-count up" style={{ left: colX + TW / 2, top: colTop - 10 }}>↑ {hiddenAbove}</span>}
      {hiddenBelow > 0 && <span className="ge-pick-count" style={{ left: colX + TW / 2, top: colTop + viewH + 10 }}>+{hiddenBelow}</span>}
    </>}
  </>, document.body)
}
