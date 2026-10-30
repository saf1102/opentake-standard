import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { ExportDialog } from '../studio/components/ExportDialog'
import type { ExportSettings, ExportCapabilities, ExportJob, OpenScreenExportJob } from '../types/editor'

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) throw Error(data.error || '导出请求失败')
  return data.result
}

export type ScreenExportRequest = {
  documentId: string
  canvas: { width: number; height: number; fps: number }
  revision: number
  useSavedDocument: true
  savedEditor?: unknown
  notice?: string
}

const statusLabel = {
  queued: '等待导出', running: '正在渲染录屏运镜', completed: '导出完成',
  failed: '导出失败', cancelled: '已取消导出', interrupted: '导出已中断',
} as const

export function ScreenExportDialog({ id, name, clientId, input, onClose }: {
  id: string; name: string; clientId: string; input: ScreenExportRequest; onClose: () => void
}) {
  const base = `/api/editor/projects/${encodeURIComponent(id)}/exports`
  const doc = `/api/editor/projects/${encodeURIComponent(id)}/openscreen/documents/${encodeURIComponent(input.documentId)}`
  const [capabilities, setCapabilities] = useState<ExportCapabilities>()
  const [task, setTask] = useState<OpenScreenExportJob>()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [entries, setEntries] = useState<OpenScreenExportJob[]>([])
  useEffect(() => {
    let cancelled = false
    void request<OpenScreenExportJob[]>(`${base}/history?kind=screen`).then(rows => {
      if (cancelled) return
      const active = rows.find(row => row.documentId === input.documentId && ['queued', 'running'].includes(row.status))
      if (active) setTask(active)
    }, reason => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [base, input.documentId])
  useEffect(() => {
    let cancelled = false
    void request<ExportCapabilities>(`${base}/capabilities`).then(value => { if (!cancelled) setCapabilities(value) }, reason => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [base])
  useEffect(() => {
    if (!historyOpen) return
    let cancelled = false
    void request<OpenScreenExportJob[]>(`${base}/history?kind=screen`).then(rows => { if (!cancelled) setEntries(rows) }, reason => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [base, historyOpen, task?.status])
  useEffect(() => {
    if (!task || !['queued', 'running'].includes(task.status)) return
    let cancelled = false
    const timer = setInterval(() => void request<OpenScreenExportJob>(`${doc}/exports/${encodeURIComponent(task.id)}`).then(value => { if (!cancelled) setTask(value) }, reason => { if (!cancelled) setError(String(reason)) }), 800)
    return () => { cancelled = true; clearInterval(timer) }
  }, [doc, task?.id, task?.status])
  const start = async (settings: ExportSettings) => {
    setError('')
    setStarting(true)
    try {
      setTask(await request<OpenScreenExportJob>(`${doc}/exports`, { settings, clientId, useSavedDocument: true, documentRevision: input.revision, savedEditor: input.savedEditor }))
    } finally { setStarting(false) }
  }
  const reveal = async (entry: OpenScreenExportJob) => {
    try { await request(`${doc}/reveal`, { path: entry.outputFile }) }
    catch (reason) { setError(String(reason)) }
  }
  const job: ExportJob | undefined = task ? {
    id: task.id, projectId: id, status: task.status === 'interrupted' ? 'failed' : task.status,
    progress: task.progress, error: task.error, createdAt: task.createdAt, updatedAt: task.updatedAt,
    outputDir: task.outputDir || task.outputFile, settings: task.exportSettings as ExportSettings | undefined,
    message: statusLabel[task.status],
  } : undefined
  return <ExportDialog projectId={id} projectName={`${name} · 录屏运镜`} notice={input.notice} mode="screen" canvas={input.canvas}
    capabilities={capabilities} job={job} starting={starting} onClose={onClose}
    onChooseDestination={() => request<{ path: string }>(`${base}/destination`, {}).then(value => value.path)} onStart={start}
    onRetry={async () => { if (task?.exportSettings) await start(task.exportSettings as ExportSettings) }}
    onRestart={async () => setTask(undefined)}
    onStop={async () => { if (task) setTask(await request<OpenScreenExportJob>(`${doc}/exports/${encodeURIComponent(task.id)}/cancel`, { clientId })) }}
    onReveal={() => { if (task) void reveal(task) }}
    history={<section className="export-history">
      <button className="export-history__toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}><ChevronRight />导出记录</button>
      {error && <p role="alert" style={{ color: '#9869dc' }}>{error}</p>}
      {historyOpen && <div className="export-history__body">{entries.length ? entries.map(entry => <div className="export-history__actions" key={entry.id}>
        <span>{new Date(entry.createdAt).toLocaleString('zh-CN')} · {statusLabel[entry.status]} · {entry.outputFile.split('/').at(-1)}</span>
        {entry.status === 'completed' && <button onClick={() => void reveal(entry)}>所在文件夹</button>}
      </div>) : <p>本工程还没有导出记录。</p>}</div>}
    </section>} />
}
