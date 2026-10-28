import { useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router'
import { Check, Film, Pencil, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { LIBRARY_STYLES } from '@/workspace/style-library/library-styles'
import { styleById } from '@/workspace/style-library/style-library'
import { PROJECT_KIND_LABELS, formatProjectDate, type GeneralLibraryProject } from '@/workspace/project-kind'
import { announceGeneralChange, errorText, generalApi } from './general-api'
import { generalProjectHref, libraryDuration, libraryRunLabel, versionName } from './general-logic'
import { Spinner } from './GeneralBits'
import './general-library.css'

/** The picture of a general project: its newest poster, else the style's poster while nothing is rendered yet. */
const posterOf = (project: GeneralLibraryProject) => project.posterUrl || styleById(LIBRARY_STYLES, project.styleId)?.poster || ''

/** 正在做片 / 等你决定 / 已停止 / 没做完 on the card's picture, so the library shows a run's state without opening it. */
function RunPill({ project }: { project: GeneralLibraryProject }) {
  const label = libraryRunLabel(project.runState)
  if (!label) return null
  return <span className="ge-runpill" data-tone={label.tone} role="status">{label.tone === 'running' ? <Spinner size={11} /> : <i aria-hidden="true" />}{label.text}</span>
}

/** 首页 · 我的工程: the same card as a 口播 project, with the teal 通用 dot. */
export function GeneralHomeCard({ project }: { project: GeneralLibraryProject }) {
  const url = posterOf(project)
  const [failed, setFailed] = useState('')
  return <li className="home-project">
    <Link to={generalProjectHref(project.id)}>
      <div className="home-thumb">
        {url && failed !== url ? <img src={url} alt="" loading="lazy" onError={() => setFailed(url)} /> : <span>暂无画面</span>}
        <RunPill project={project} />
      </div>
      <h3 title={project.name}>{project.name}</h3>
      <p className="home-meta"><i className="home-dot" data-kind="general" aria-hidden="true" />{PROJECT_KIND_LABELS.general}
        {project.duration ? <><span aria-hidden="true">·</span>{libraryDuration(project.duration)}</> : null}
        <span aria-hidden="true">·</span>{formatProjectDate(project.updatedAt)}</p>
    </Link>
  </li>
}

/** 剪辑台 · 最近工程: built from the 口播 card's parts so all three themes already style it; rename and 移入回收站 only. */
export function GeneralStudioCard({ project, onChanged }: { project: GeneralLibraryProject; onChanged: () => void }) {
  const navigate = useNavigate()
  const url = posterOf(project)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)
  const [saving, setSaving] = useState(false)
  const open = () => navigate(generalProjectHref(project.id))
  const save = async () => {
    const value = name.trim()
    if (!value || saving) return
    if (value === project.name) { setEditing(false); return }
    setSaving(true)
    try { await generalApi.patch(project.id, { name: value }); setEditing(false); toast.success('工程已重命名'); announceGeneralChange(); onChanged() }
    catch (failure) { toast.error(`重命名失败：${errorText(failure)}`) }
    finally { setSaving(false) }
  }
  const remove = async () => {
    if (!confirm(`将“${project.name}”移入回收站？`)) return
    try { await generalApi.remove(project.id); announceGeneralChange(); onChanged() } catch (failure) { toast.error(`删除失败：${errorText(failure)}`) }
  }
  const style = { '--project-title-color': '#ffffff', '--project-title-shadow': '0 1px 2px #000000a8, 0 0 10px #00000070' } as CSSProperties
  return <article className="project-row project-card ge-studio-card" role="link" tabIndex={0} aria-label={`打开通用工程 ${project.name}`}
    onClick={open} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }}>
    <div className="project-cover" style={style}>
      {url && !failed
        ? <><img className="project-cover__glow" src={url} alt="" aria-hidden loading="lazy" /><img className="project-cover__image" src={url} alt="" loading="lazy" onError={() => setFailed(true)} /></>
        : <div className="project-cover__fallback"><Film /></div>}
      <RunPill project={project} />
      {editing
        ? <form className="project-cover__rename" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save() }}>
          <input aria-label="工程名称" value={name} autoFocus disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => setName(event.currentTarget.value)}
            onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !saving) { setName(project.name); setEditing(false) } }} />
          <button type="submit" title="保存名称" aria-label="保存名称" disabled={saving || !name.trim()}><Check /></button>
          <button type="button" title="取消重命名" aria-label="取消重命名" disabled={saving} onClick={() => { setName(project.name); setEditing(false) }}><X /></button>
        </form>
        : <div className="project-cover__title"><b>{project.name}</b></div>}
    </div>
    <div className="project-card__archive">
      <div className="project-info">
        <span className="ge-kindtag"><i aria-hidden="true" />{PROJECT_KIND_LABELS.general}剪辑</span>
        {project.duration ? <span>时长 {libraryDuration(project.duration)}</span> : null}
        <span>{project.versions > 0 ? `已出到${versionName(project.versions)}` : '还没出片'}</span>
      </div>
      <div className="project-card__quick-actions">
        <button type="button" title="重命名工程" aria-label={`重命名工程：${project.name}`} onClick={event => { event.stopPropagation(); setName(project.name); setEditing(true) }}><Pencil /></button>
        <button type="button" className="is-delete" title="删除工程" aria-label={`删除工程 ${project.name}`} onClick={event => { event.stopPropagation(); void remove() }}><Trash2 /></button>
      </div>
      <footer><time>{new Date(project.updatedAt).toLocaleString('zh-CN')}</time></footer>
    </div>
  </article>
}
