import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { AGENT_MARKS } from '@/studio/agent-marks'

/** The Codex mark on its dark tile (the same mark as Settings › 已接入的 Agent). */
export function CodexMark({ size = 12 }: { size?: number }) {
  const mark = AGENT_MARKS.codex
  return <span className="ge-mark" aria-hidden="true"><svg viewBox={mark.viewBox} width={size} height={size}><path fill={mark.color} d={mark.d} /></svg></span>
}

/** A quarter arc that turns (transform only). */
export function Spinner({ size = 16 }: { size?: number }) {
  return <svg className="ge-spin" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="2" />
    <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
}

/** A step that has not started. */
export function TodoDot({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5" strokeDasharray="2.2 2.2" />
  </svg>
}

export function StopGlyph() {
  return <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" /></svg>
}

/** ① 选风格 —— ② 放素材 —— ③ 生成 */
export function NewSteps({ current }: { current: 1 | 2 | 3 }) {
  return <ol className="ge-steps" aria-label="新建通用工程的步骤">
    {['选风格', '放素材', '生成'].map((label, index) => {
      const n = index + 1
      const state = n < current ? 'done' : n === current ? 'on' : 'todo'
      return <li key={label} data-s={state} aria-current={state === 'on' ? 'step' : undefined}>
        <b>{state === 'done' ? <Check size={11} strokeWidth={3} aria-label="已完成" /> : n}</b>{label}
      </li>
    })}
  </ol>
}

/** Render into one of the top bar's slots (#workspace-project-title-slot, #workspace-primary-action-slot). */
export function NavSlot({ id, children }: { id: string; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => { setSlot(document.getElementById(id)) }, [id])
  return slot ? createPortal(children, slot) : null
}

/** Agent text with 《片名》 set in bold, as the reply in the mock does. */
export function AgentText({ text }: { text: string }) {
  const parts = text.split(/(《[^》\n]{1,40}》)/)
  return <>{parts.map((part, index) => (index % 2 ? <b key={index}>{part}</b> : part))}</>
}
