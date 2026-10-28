/**
 * The stage while Codex makes a version (S先生 2026-10-26, mock docs/通用剪辑出片等待-效果图.html): the newest picture of
 * the run, blurred, behind the OpenTake mark turning on the left; on the right the run's steps as a wall that slides up
 * and down, each card showing what that step has made so far. The step being worked on sits in the middle until the
 * person picks another (a click, the wheel or ↑ ↓).
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { GeneralProject } from './general-contract'
import { elapsedLabel, latestRenderFrame, runActive, stepRows, type StepRow } from './general-logic'
import { generalEditorApi } from './general-api'
import './general-runwall.css'

type Picture = { image?: string; grid?: string[]; text?: string }

/** What a step shows on its card: its own picture, or the words it worked from. */
function pictureOf(row: StepRow, project: GeneralProject, poster?: string): Picture {
  const run = project.run, step = run?.steps.find(s => s.id === row.id)
  const started = row.tone !== 'todo'
  const stamp = encodeURIComponent(step?.endedAt ?? step?.startedAt ?? '')
  switch (row.id) {
    case 'read-style': return poster ? { image: poster } : { text: '不用风格\n画面、字体、配色、节奏都按你的要求来' }
    case 'read-input': {
      const posters = project.inputs.media.map(m => m.poster).filter((p): p is string => !!p)
      if (project.inputs.kind === 'footage' && posters.length) return posters.length === 1 ? { image: posters[0] } : { grid: posters.slice(0, 4) }
      const words = (project.inputs.text || project.inputs.note).trim()
      return { text: words ? `「${[...words].slice(0, 90).join('')}${[...words].length > 90 ? '…' : ''}」` : '' }
    }
    case 'plan': {
      const segments = project.plan?.segments ?? []
      return { text: segments.length ? segments.slice(0, 5).map((s, i) => `${'①②③④⑤'[i]} ${s.name}`).join('\n') : '' }
    }
    // the contact sheet the agent made of its own pages (hfx look)
    case 'code': case 'self-check': return started ? { image: `${generalEditorApi.fileUrl(project.id, 'work/look/sheet.jpg')}?v=${stamp}` } : {}
    case 'render': return { image: latestRenderFrame(run) }
    case 'review': return row.thumbs.length ? { grid: [0, 1, 2, 3].map(i => row.thumbs[Math.floor(i * row.thumbs.length / 4)]).filter(Boolean) } : {}
    case 'deliver': return row.tone === 'done' ? { image: project.versions.at(-1)?.posterUrl } : {}
    default: return {}
  }
}

const STATE: Record<StepRow['tone'], string> = { done: '完成', now: '进行中', wait: '等你决定', todo: '等待', paused: '已停', failed: '没完成', skipped: '跳过' }

function Picture({ picture, now }: { picture: Picture; now: boolean }) {
  const [broken, setBroken] = useState<string>()
  const image = picture.image && picture.image !== broken ? picture.image : undefined
  return <div className="ge-rw-pic" data-text={!image && !picture.grid ? '' : undefined}>
    {image ? <img src={image} alt="" draggable={false} onError={() => setBroken(picture.image)} />
      : picture.grid ? <div className="ge-rw-grid">{picture.grid.map(src => <img key={src} src={src} alt="" draggable={false} />)}</div>
      : <p>{picture.text}</p>}
    {now && <span className="ge-rw-ring" aria-hidden="true"><i /></span>}
  </div>
}

export function GeneralRunWall({ project, poster }: { project: GeneralProject; poster?: string }) {
  const run = project.run
  // a revision skips the first steps: the wall shows only the steps this run really goes through
  const rows = stepRows(run, { kind: project.inputs.kind, hasPlan: !!project.plan }).filter(row => row.tone !== 'skipped')
  const current = Math.max(0, rows.findIndex(r => r.tone === 'now' || r.tone === 'wait' || r.tone === 'paused')), working = rows.findIndex(r => r.tone === 'now' || r.tone === 'wait')
  const live = runActive(run)
  // the wall follows the work until the person picks a step
  const [picked, setPicked] = useState<number>()
  const focus = Math.min(rows.length - 1, picked ?? (working >= 0 ? working : current))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!live) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [live])
  const go = (d: number) => setPicked(Math.max(0, Math.min(rows.length - 1, focus + d)))
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('input,textarea,[contenteditable=true]')) return
      if (event.key === 'ArrowDown') { event.preventDefault(); go(1) }
      if (event.key === 'ArrowUp') { event.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const pictures = rows.map(row => pictureOf(row, project, poster))
  // the blurred backdrop: the newest picture the run has (render, then the agent's sheet, then the style)
  const upTo = working >= 0 ? working : rows.length - 1
  const backdrop = [...pictures.slice(0, upTo + 1)].reverse().map(p => p.image ?? p.grid?.[0]).find(Boolean) ?? poster
  const step = working >= 0 ? rows[working] : undefined
  const started = run ? Date.parse(run.startedAt) : now
  const repair = run?.repairReason ? `第 ${run.round ?? 2} 轮：修正 ${run.repairReason}` : undefined
  const title = run?.state === 'done' ? '片子已交付' : run?.state === 'needs-network' ? 'Codex 在等你决定要不要联网' : step ? `Codex 正在${step.title.replace(/^正在/, '')}` : 'Codex 正在做片'
  const elapsed = (row: StepRow) => {
    const s = run?.steps.find(x => x.id === row.id)
    if (!s?.startedAt) return ''
    const ms = (s.endedAt ? Date.parse(s.endedAt) : now) - Date.parse(s.startedAt)
    return row.tone === 'done' ? `用时 ${elapsedLabel(ms)}` : row.tone === 'now' ? `已用 ${elapsedLabel(ms)}` : ''
  }
  return <section className="ge-rw" aria-label="做片过程" onWheel={event => { if (Math.abs(event.deltaY) > 8) go(event.deltaY > 0 ? 1 : -1) }}>
    <div className="ge-rw-blur" style={backdrop ? { backgroundImage: `url("${backdrop}")` } as CSSProperties : undefined} />
    <div className="ge-rw-scrim" />
    <div className="ge-rw-turn">
      <span className="ge-rw-glow" aria-hidden="true" />
      <img className="ge-rw-mark" src="/opentake-icon-512.png" alt="" draggable={false} />
      <div className="ge-rw-status" role="status"><b data-repair={repair && live ? true : undefined} title={repair && live ? repair : title}>{repair && live ? repair : title}</b>
        {step && <small>{step.detail || title} · {elapsed(step)}</small>}
        <small>{working >= 0 ? `第 ${working + 1} / ${rows.length} 步 · ` : ''}已用 {elapsedLabel(now - started)}</small></div>
    </div>
    <div className="ge-rw-wall">
      {rows.map((row, i) => {
        const o = i - focus, a = Math.abs(o), s = Math.sign(o)
        const y = o === 0 ? 0 : s * (140 + (a - 1) * 78), z = o === 0 ? 40 : -70 - a * 45, rx = o === 0 ? 0 : -s * 16
        const shown = a <= 3
        return <article key={row.id} className="ge-rw-card" data-tone={row.tone} data-front={o === 0 || undefined} aria-current={o === 0 || undefined}
          style={{ transform: `translateY(${y}px) translateZ(${z}px) rotateX(${rx}deg)`, opacity: shown ? (o === 0 ? 1 : Math.max(0.22, 1 - a * 0.26)) : 0, zIndex: 50 - a, pointerEvents: shown ? 'auto' : 'none' }}
          onClick={() => setPicked(i)}>
          <Picture picture={row.tone === 'todo' ? {} : pictures[i]} now={row.tone === 'now'} />
          <div className="ge-rw-txt">
            <header><em>{String(i + 1).padStart(2, '0')} / {String(rows.length).padStart(2, '0')}</em><b>{row.title}</b><span className="ge-rw-chip" data-tone={row.tone}>{STATE[row.tone]}</span></header>
            <p>{row.tone === 'todo' ? '还没开始' : row.aside ? `${row.aside}${row.detail ? ` · ${row.detail}` : ''}` : row.detail}</p>
            <small>{elapsed(row)}</small>
          </div>
        </article>
      })}
    </div>
    <div className="ge-rw-rail" aria-hidden="true">{rows.map((row, i) => <i key={row.id} data-on={i === focus || undefined} data-done={row.tone === 'done' || undefined} />)}</div>
  </section>
}
