

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Check, Copy, Film, FolderOpen, MonitorPlay, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { createProject, deleteProject, duplicateProject, listProjects, patchProject, restoreProject, mediaUrl } from '@/studio/api'
import type { EditProject } from '@/types'
const screenDuration = (project: EditProject) => {
 const seconds = Math.round(Math.max(0, ...(project.openScreenDocuments || []).filter(doc => !doc.archivedAt).map(doc => doc.duration)));
 const pair = (n: number) => String(n).padStart(2, '0');
 return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${pair(Math.floor(seconds / 60) % 60)}:${pair(seconds % 60)}` : `${pair(Math.floor(seconds / 60))}:${pair(seconds % 60)}`;
}
import { generalApi } from '@/general/general-api'
import { GeneralStudioCard } from '@/general/GeneralLibraryCards'
import { generalLibraryProject, type GeneralLibraryProject } from '@/workspace/project-kind'

function ProjectCover({project, screenMode, editing = false, draftName = '', saving = false, onDraftChange, onSave, onCancel}: {project: EditProject; screenMode: boolean; editing?: boolean; draftName?: string; saving?: boolean; onDraftChange?: (value: string) => void; onSave?: () => void; onCancel?: () => void}) {
  const [failed, setFailed] = useState(false);
  const [titleColor, setTitleColor] = useState('#ffffff');
  const asset = project.media.find(item => item.thumbnailFile && item.status === 'ready');
  const url = asset ? mediaUrl(project.id, asset.id, 'thumbnail') : undefined;
  useEffect(() => {
    if (!url) return;
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 12;
        const context = canvas.getContext('2d', {willReadFrequently: true}); if (!context) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 6, 24, 6).data;
        let luminance = 0;
        for (let index = 0; index < pixels.length; index += 4) luminance += .2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2];
        setTitleColor(luminance / (pixels.length / 4) > 150 ? '#211f1c' : '#ffffff');
      } catch { setTitleColor('#ffffff'); }
    };
    image.src = url;
  }, [url]);
  const style = {'--project-title-color': titleColor, '--project-title-shadow': titleColor === '#211f1c' ? '0 1px 2px #ffffffa8, 0 0 10px #ffffff70' : '0 1px 2px #000000a8, 0 0 10px #00000070'} as CSSProperties;
  return <div className="project-cover" style={style}>{url && !failed ? <><img className="project-cover__glow" src={url} alt="" aria-hidden loading="lazy"/><img className="project-cover__image" src={url} alt="" loading="lazy" onError={()=>setFailed(true)}/></> : <div className="project-cover__fallback">{screenMode ? <MonitorPlay/> : <Film/>}</div>}{editing ? <form className="project-cover__rename" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); event.stopPropagation(); onSave?.(); }}><input aria-label="工程名称" value={draftName} autoFocus disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => onDraftChange?.(event.currentTarget.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !saving) onCancel?.(); }}/><button type="submit" title="保存名称" aria-label="保存名称" disabled={saving || !draftName.trim()}><Check /></button><button type="button" title="取消重命名" aria-label="取消重命名" disabled={saving} onClick={onCancel}><X /></button></form> : <div className="project-cover__title"><b>{project.name}</b></div>}</div>;
}

export default function StudioProjects() {
  const [projects, setProjects] = useState<EditProject[]>([]); const [deleted, setDeleted] = useState<EditProject[]>([]); const [creating, setCreating] = useState(false); const [archiveView, setArchiveView] = useState<'recent' | 'archived' | 'trash'>('recent'); const navigate = useNavigate(); const location = useLocation(); const screenMode = location.pathname.startsWith('/screen-motion')
  const [editingProjectId, setEditingProjectId] = useState('');
  const [draftName, setDraftName] = useState('');
  const [savingProjectId, setSavingProjectId] = useState('');
  const [duplicatingProjectId, setDuplicatingProjectId] = useState('');
  const projectPath = (id: string) => `/screen-motion/projects/${id}`
  // 剪辑台 holds both kinds (录屏运镜 shares this page and lists its own projects only). The general list may not answer yet.
  const [general, setGeneral] = useState<GeneralLibraryProject[]>([])
  const refresh = async () => {
    const [all, generalList] = await Promise.all([listProjects(true), screenMode ? Promise.resolve([]) : generalApi.list()])
    setProjects(all.filter((p) => !p.deletedAt)); setDeleted(all.filter((p) => p.deletedAt)); setGeneral(generalList.map(generalLibraryProject))
  }
  type Entry = { kind: 'screen'; project: EditProject } | { kind: 'general'; project: GeneralLibraryProject }
  const recent: Entry[] = [...projects.filter(p => !p.archivedAt).map((project): Entry => ({ kind: 'screen', project })),
    ...general.map((project): Entry => ({ kind: 'general', project }))].sort((a, b) => b.project.updatedAt - a.project.updatedAt)
  const listed: Entry[] = archiveView === 'archived' ? projects.filter(p => Boolean(p.archivedAt)).map((project): Entry => ({ kind: 'screen', project })) : recent
  useEffect(() => {const reload=()=>{void refresh().catch((e)=>toast.error(e.message))};reload();window.addEventListener('workspace-projects-changed',reload);return()=>window.removeEventListener('workspace-projects-changed',reload)}, [])
  const create = async () => {
    if (creating) return;
    setCreating(true);
    const stamp = new Date().toLocaleString('zh-CN', {hour12: false}).replace(/[/:]/g, '-');
    try { const project = await createProject(`空白工程 ${stamp}`); navigate(projectPath(project.id)) }
    catch (e) { toast.error(e instanceof Error ? e.message : '创建失败') }
    finally { setCreating(false) }
  }
  const beginRename = (project: EditProject) => { setDraftName(project.name); setEditingProjectId(project.id) }
  const saveRename = async (project: EditProject) => {
    const value = draftName.trim();
    if (!value || savingProjectId) return;
    if (value === project.name) { setEditingProjectId(''); return; }
    setSavingProjectId(project.id);
    try {
      const updated = await patchProject(project.id, {name: value});
      setProjects(items => items.map(item => item.id === updated.id ? updated : item));
      setEditingProjectId('');
      toast.success('工程已重命名');
    } catch (renameError) {
      toast.error(renameError instanceof Error ? renameError.message : '重命名失败，请重试');
    } finally { setSavingProjectId(''); }
  }
  const duplicate = async (project: EditProject) => {
    if (duplicatingProjectId) return;
    setDuplicatingProjectId(project.id);
    try {
      const copied = await duplicateProject(project.id);
      setProjects(items => [copied, ...items]);
      toast.success(`已复制为“${copied.name}”`);
    } catch (copyError) {
      toast.error(copyError instanceof Error ? copyError.message : '复制失败，请重试');
    } finally { setDuplicatingProjectId(''); }
  }
  return <div className="studio-projects min-h-screen">
    <main className="studio-projects__main">
      <section className="project-archive"><div className="project-archive-tabs" role="tablist" aria-label="工程档案"><button type="button" role="tab" aria-selected={archiveView === 'recent'} aria-controls="recent-projects" id="recent-projects-tab" onClick={() => setArchiveView('recent')}>最近工程 <span>{recent.length}</span></button><button type="button" role="tab" id="archived-projects-tab" aria-controls="archived-projects" aria-selected={archiveView === 'archived'} onClick={()=>setArchiveView('archived')}>已归档 <span>{projects.filter(p=>p.archivedAt).length}</span></button><button type="button" role="tab" aria-selected={archiveView === 'trash'} aria-controls="trash-projects" id="trash-projects-tab" onClick={() => setArchiveView('trash')}>回收站 <span>{deleted.length}</span><small>保留 30 天</small></button></div>
        {archiveView !== 'trash' ? <div id={archiveView==='archived'?'archived-projects':'recent-projects'} role="tabpanel" aria-labelledby={archiveView==='archived'?'archived-projects-tab':'recent-projects-tab'}><div className="project-list project-waterfall">{archiveView==='recent'&&<button type="button" className="project-card project-card--blank" aria-label="创建空白工程" disabled={creating} onClick={() => void create()}><span className="project-card--blank__icon"><Plus /></span><b>空白工程</b><small>{creating ? '正在创建…' : '创建一个新的空白工程'}</small></button>}{listed.map((entry) => entry.kind==='general' ? <GeneralStudioCard key={`general:${entry.project.id}`} project={entry.project} onChanged={()=>void refresh().catch((e)=>toast.error(e.message))}/> : ((project: EditProject) => <article key={project.id} className="project-row project-card" role="link" tabIndex={0} aria-label={`打开工程 ${project.name}`} onKeyDown={(event)=>{if(event.target !== event.currentTarget) return;if(event.key==='Enter'||event.key===' '){event.preventDefault();if(project.storageOffline){toast.info('工程所在硬盘未连接，请重新连接');return;}navigate(projectPath(project.id));}}} onClick={() => {if(project.storageOffline){toast.info('工程所在硬盘未连接，请重新连接');return;}navigate(projectPath(project.id))}}><ProjectCover project={project} screenMode={screenMode} editing={editingProjectId === project.id} draftName={draftName} saving={savingProjectId === project.id} onDraftChange={setDraftName} onSave={() => void saveRename(project)} onCancel={() => setEditingProjectId('')}/><div className="project-card__archive"><div className="project-info">{project.storageOffline&&<span role="status">硬盘未连接</span>}<span>时长 {screenDuration(project)}</span><span>{project.settings.width}×{project.settings.height} · {project.settings.fps} fps</span><span>{project.media.length} 个素材</span></div><div className="project-card__quick-actions"><button type="button" title="复制工程" aria-label={`复制工程 ${project.name}`} disabled={!!project.archivedAt||duplicatingProjectId === project.id} onClick={event => { event.stopPropagation(); void duplicate(project); }}><Copy /></button><button type="button" disabled={!!project.archivedAt} title="重命名工程" aria-label={`重命名工程：${project.name}`} onClick={event => { event.stopPropagation(); beginRename(project); }}><Pencil /></button><button type="button" className="is-delete" title="删除工程" aria-label={`删除工程 ${project.name}`} onClick={(event) => { event.stopPropagation(); if (confirm(`将“${project.name}”移入回收站？`)) void deleteProject(project.id).then(refresh) }}><Trash2 /></button></div><footer><time>{new Date(project.updatedAt).toLocaleString('zh-CN')}</time></footer></div></article>)(entry.project))}</div></div> : <div id="trash-projects" role="tabpanel" aria-labelledby="trash-projects-tab">{deleted.length ? <div className="project-list project-waterfall project-waterfall--trash">{deleted.map((project) => <article className="project-row project-card project-card--trash" key={project.id}><ProjectCover project={project} screenMode={screenMode}/><div className="project-card__archive"><div className="project-info">{project.storageOffline&&<span role="status">硬盘未连接</span>}<span>时长 {screenDuration(project)}</span><span>{project.settings.width}×{project.settings.height} · {project.settings.fps} fps</span><span>{project.media.length} 个素材</span></div><footer><time>{new Date(project.deletedAt || project.updatedAt).toLocaleString('zh-CN')}</time><button title="恢复工程" aria-label={`恢复工程 ${project.name}`} onClick={() => void restoreProject(project.id).then(refresh)}><RotateCcw size={17} /></button></footer></div></article>)}</div> : <div className="project-empty"><FolderOpen size={36} /><b>回收站是空的</b><span>删除的工程会在这里保留 30 天。</span></div>}</div>}
      </section>
    </main></div>
}
