/**
 * Which model and reasoning effort the project's Codex uses, and whether it may go online (S先生 2026-10-26, mock
 * docs/通用剪辑模型选择-效果图.html). 系统默认 follows settings → 通用剪辑出片; a project's own choice shows a teal dot.
 * The same picker sits on ② 放素材, in the 不用风格 composer and in the work page's composer.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { getAgentSettings } from '@/studio/api'
import { EFFORT_LABELS, type AgentModel } from '@/studio/agent-settings'
import type { GeneralAgentChoice } from './general-contract'

type Catalog = { models: AgentModel[]; standard: GeneralAgentChoice }
let loading: Promise<Catalog> | undefined
/** The CLI's models and the settings' choice for 通用剪辑出片, read once per page load. */
function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog>()
  useEffect(() => {
    let alive = true
    loading ??= getAgentSettings().then(view => ({ models: view.catalog?.models ?? [], standard: view.settings.modules.generalEditing }))
    loading.then(value => { if (alive) setCatalog(value) }, () => { loading = undefined })
    return () => { alive = false }
  }, [])
  return catalog
}

const effortName = (effort: string) => EFFORT_LABELS[effort] ?? effort

export function AgentPicker({ value, onChange, compact, up, disabled }: {
  value?: GeneralAgentChoice; onChange: (next: GeneralAgentChoice | undefined) => void
  /** the composer's short label: model and effort only */
  compact?: boolean; up?: boolean; disabled?: boolean
}) {
  const catalog = useCatalog()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  // the panel lives on <body> (the composer's column would clip it), held against the label, inside the window
  const [place, setPlace] = useState<CSSProperties>()
  useLayoutEffect(() => {
    if (!open || !box.current) return
    const r = box.current.getBoundingClientRect(), width = 300, margin = 8, below = window.innerHeight - r.bottom
    // opens upward when asked, or when there is more room above than below and too little below for the whole list
    const upward = up || (below < 440 && r.top > below)
    const left = Math.max(margin, Math.min(upward ? r.right - width : r.left, window.innerWidth - width - margin))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measured after layout
    setPlace(upward ? { left, bottom: window.innerHeight - r.top + 6, maxHeight: r.top - 6 - margin } : { left, top: r.bottom + 6, maxHeight: below - 6 - margin })
  }, [open, up])
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { const t = event.target as Node; if (!box.current?.contains(t) && !pop.current?.contains(t)) setOpen(false) }
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc) }
  }, [open])
  const models = catalog?.models ?? [], standard = catalog?.standard
  const shown = value ?? standard
  const nameOf = (id?: string) => models.find(m => m.id === id)?.name ?? id ?? ''
  const model = models.find(m => m.id === shown?.model)
  const pickModel = (next: AgentModel) => onChange({ model: next.id, effort: next.efforts.includes(shown?.effort ?? '') ? shown!.effort : next.defaultEffort })
  const label = compact || value ? nameOf(shown?.model) : '系统默认'
  const sub = compact || value ? effortName(shown?.effort ?? '') : `${nameOf(standard?.model)} · ${effortName(standard?.effort ?? '')}`
  return <span ref={box} className="ge ge-model">
    <button type="button" className="ge-model-pick" data-custom={value ? '' : undefined} aria-expanded={open} aria-haspopup="dialog" disabled={disabled || !catalog}
      title={value ? '这个工程自己选的模型' : '系统默认：跟设置里的「通用剪辑出片」一致'} onClick={() => setOpen(o => !o)}>
      <span className="dot" aria-hidden="true" /><span>{catalog ? label : '模型'}</span>{catalog && <i>{sub}</i>}<ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && catalog && place && createPortal(<div className="ge"><div ref={pop} className="ge-model-pop" style={place} role="dialog" aria-label="选择模型和推理强度">
      <button type="button" className="ge-model-opt" data-on={!value || undefined} onClick={() => { onChange(undefined); setOpen(false) }}>
        <span><b>系统默认</b><small>跟设置一致 · {nameOf(standard?.model)} · {effortName(standard?.effort ?? '')}</small></span><Check size={15} aria-hidden="true" />
      </button>
      <div className="ge-model-sep" />
      <div className="ge-model-grp">模型</div>
      {models.map(m => <button key={m.id} type="button" className="ge-model-opt" data-on={(value && value.model === m.id) || undefined} onClick={() => pickModel(m)}>
        <span><b>{m.name}</b></span><Check size={15} aria-hidden="true" />
      </button>)}
      <div className="ge-model-grp">推理强度</div>
      <div className="ge-model-eff">{(model?.efforts ?? []).map(effort => <button key={effort} type="button" data-on={(value && value.effort === effort) || undefined}
        onClick={() => shown && onChange({ model: shown.model, effort })}>{effortName(effort)}</button>)}</div>
    </div></div>, document.body)}
  </span>
}

/** 联网: off by default; on, Codex may go online to find material (pictures, sound, music, data). */
export function NetworkToggle({ on, onChange, compact, disabled }: { on: boolean; onChange: (next: boolean) => void; compact?: boolean; disabled?: boolean }) {
  return <span className="ge ge-model">
    <button type="button" className="ge-model-pick ge-net" role="switch" aria-checked={on} data-on={on || undefined} disabled={disabled}
      title={on ? '已联网：Codex 可以上网找素材（只用可免费使用的，来源写在报告里）' : '没联网：只用你给的素材。打开后 Codex 可以上网找素材'}
      onClick={() => {
        // turning it on says once what it risks (S先生 2026-10-26: 只是做一个提示)
        if (!on) toast.warning('打开联网有风险', { description: 'Codex 会访问外部网站找素材，素材的来源和版权要留意（会写在报告里）。软件、插件、代码一律不下载。' })
        onChange(!on)
      }}>
      <Globe size={13} aria-hidden="true" />{!compact && <span>联网</span>}
    </button>
  </span>
}

/** The model and 联网 as one capsule, split by a hairline (S先生 2026-10-26: the two boxes fit together as one). */
export function AgentControls({ agent, onAgent, network, onNetwork, compact, up, disabled }: {
  agent?: GeneralAgentChoice; onAgent: (next: GeneralAgentChoice | undefined) => void
  network: boolean; onNetwork: (next: boolean) => void; compact?: boolean; up?: boolean; disabled?: boolean
}) {
  return <span className="ge ge-model-group">
    <AgentPicker value={agent} onChange={onAgent} compact={compact} up={up} disabled={disabled} />
    <NetworkToggle on={network} onChange={onNetwork} compact={compact} disabled={disabled} />
  </span>
}
