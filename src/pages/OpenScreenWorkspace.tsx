import { useWorkspaceLeaveGuard, WorkspaceLink as Link } from '@/workspace/navigation-guard'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CircleStop, FileVideo2, MonitorUp, RefreshCw, ShieldCheck } from 'lucide-react'
import { useParams } from 'react-router'
import type { EditProject, OpenScreenBridgeMessage, OpenScreenHostSession } from '@/types'
import { acquireLock, cancelOpenScreenHostSession, confirmOpenScreenHostCandidate, getOpenScreenHostSession, getProject, launchOpenScreenHost } from '@/studio/api'
import '@/screen-motion/openscreen-workspace.css'
import embeddedGlass from '@/workspace/embedded-glass.css?inline'

function createClientId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function getClientId() {
  // The main editor and OpenScreen are two views of the same personal project,
  // so they must renew one shared browser identity instead of locking each
  // other out.
  const key = 'link-reader-editor-client'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const value = createClientId()
  localStorage.setItem(key, value)
  return value
}

export default function OpenScreenWorkspace() {
  const { id = '' } = useParams()
  const clientId = useMemo(getClientId, [])
  const [project, setProject] = useState<EditProject | null>(null)
  const [writable, setWritable] = useState(false)
  const [status, setStatus] = useState('正在连接 OpenScreen 编辑器…')
  const [hostSession, setHostSession] = useState<OpenScreenHostSession | null>(null)
  const [importingCandidate, setImportingCandidate] = useState('')
  const [error, setError] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const sync = () => { const doc = iframeRef.current?.contentDocument; if (doc) doc.documentElement.dataset.uiTheme = document.documentElement.dataset.uiTheme || 'original'; };
    window.addEventListener('linkreader-ui-theme', sync);
    window.addEventListener('storage', sync);
    return () => {window.removeEventListener('linkreader-ui-theme', sync);window.removeEventListener('storage', sync);};
  }, [])

  useWorkspaceLeaveGuard(async () => { if (writable && ['未保存', '正在保存…'].includes(status)) throw new Error('录屏工程正在保存，请保存完成后再切换模块'); })

  const refreshLock = useCallback(async (takeover = false) => {
    if (!id) return
    try {
      const lock = await acquireLock(id, clientId, takeover)
      setWritable(lock.acquired)
      if (!lock.acquired) setStatus(`只读：${lock.lock.clientName} 正在编辑`)
    } catch (reason) {
      setWritable(false)
      setStatus(reason instanceof Error ? reason.message : '无法取得工程编辑锁')
    }
  }, [clientId, id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void Promise.all([getProject(id), refreshLock()])
      .then(([nextProject]) => {
        if (cancelled) return
        setProject(nextProject)
      })
      .catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)))
    const heartbeat = window.setInterval(() => void refreshLock(false), 5_000)
    return () => {
      cancelled = true
      window.clearInterval(heartbeat)
    }
  }, [id, refreshLock])

  useEffect(() => {
    const onMessage = (event: MessageEvent<OpenScreenBridgeMessage>) => {
      if (event.origin !== window.location.origin || event.data?.projectId !== id) return
      if (event.data.type === 'ready') setStatus(writable ? 'OpenScreen 全功能模式' : 'OpenScreen 只读模式')
      if (event.data.type === 'save-state') {
        setStatus(writable ? String(event.data.payload.label || '已保存') : 'OpenScreen 只读模式')
      }
      if (event.data.type === 'error') setError(String(event.data.payload.message || 'OpenScreen 编辑器发生错误'))
      if (event.data.type === 'recording-state' && event.data.payload.session) setHostSession(event.data.payload.session as OpenScreenHostSession)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [id, writable])

  useEffect(() => {
    if (!hostSession || ['completed', 'cancelled', 'failed'].includes(hostSession.status)) return
    const timer = window.setInterval(() => {
      void getOpenScreenHostSession(id, hostSession.id).then(setHostSession).catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [hostSession, id])

  const editorUrl = useMemo(() => {
    const query = new URLSearchParams({
      windowType: 'editor', browser: '1', linkreaderProjectId: id,
      linkreaderClientId: clientId, linkreaderWritable: writable ? '1' : '0',
    })
    return `/openscreen/linkreader.html?${query}`
  }, [clientId, id, writable])

  const launchHud = async () => {
    try {
      setError('')
      const session = await launchOpenScreenHost(id, clientId)
      setHostSession(session)
      setStatus('已打开 OpenScreen，等待导入录制视频')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const importCandidate = async (file: string) => {
    if (!hostSession) return
    try {
      setError('')
      setImportingCandidate(file)
      const result = await confirmOpenScreenHostCandidate(id, hostSession.id, file, clientId)
      setHostSession(result.session)
      setStatus('录制工程已导入，正在载入编辑器…')
      iframeRef.current?.contentWindow?.location.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setImportingCandidate('')
    }
  }

  const cancelHudReceive = async () => {
    if (!hostSession) return
    try {
      setHostSession(await cancelOpenScreenHostSession(id, hostSession.id, clientId))
      setStatus('已停止接收原生录制结果')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const hostStatusLabel = hostSession ? {
    launching: '正在启动 OpenScreen…',
    waiting: '等待 OpenScreen 开始录制',
    recording: '宿主 Mac 正在录制',
    processing: '录制已停止，正在等待 OpenScreen 写入工程',
    selecting: `检测到 ${hostSession.candidates.length || hostSession.candidateFiles.length} 个本次录制结果`,
    completed: '录制结果已导入当前工程',
    cancelled: '已停止接收录制结果',
    failed: hostSession.error || '原生录制接收失败',
  }[hostSession.status] : ''

  return <div className="openscreen-workspace-shell">
    <header className="openscreen-hostbar">
      <div className="openscreen-hostbar__left">
        <Link to="/screen-motion" className="openscreen-icon-button" title="录屏工程列表"><ArrowLeft size={17} /></Link>
        <strong>{project?.name || '录屏运镜'}</strong>
        <span className={writable ? 'openscreen-save openscreen-save--active' : 'openscreen-save'}>
          <ShieldCheck size={14} />{status}
        </span>
      </div>
      <div className="openscreen-hostbar__actions">
        {!writable && <button type="button" onClick={() => void refreshLock(true)}>接管编辑</button>}
        <button type="button" onClick={() => iframeRef.current?.contentWindow?.location.reload()}><RefreshCw size={15} />重新载入</button>
        <button type="button" onClick={() => void launchHud()} disabled={!writable}><MonitorUp size={15} />导入录制视频</button>

      </div>
    </header>
    {error && <div className="openscreen-host-error">{error}<button onClick={() => setError('')}>关闭</button></div>}
    {hostSession && !['completed', 'cancelled'].includes(hostSession.status) && <div className={`openscreen-host-session openscreen-host-session--${hostSession.status}`}>
      <span className="openscreen-host-session__pulse" />
      <div>
        <strong>{hostStatusLabel}</strong>
        <small>录制对象是当前宿主 Mac；OpenTake Standard 只接收本次会话新增的 OpenScreen 工程。</small>
      </div>
      {hostSession.status !== 'failed' && <button type="button" onClick={() => void cancelHudReceive()} disabled={!writable}>
        <CircleStop size={15} />停止接收
      </button>}
    </div>}
    {hostSession?.status === 'selecting' && <div className="openscreen-candidate-panel">
      <div className="openscreen-candidate-panel__summary">
        <FileVideo2 size={16} />
        原生录制已结束，检测到 {hostSession.candidateFiles.length} 个候选工程。请选择正确结果后导入当前工程。
      </div>
      <div className="openscreen-candidate-panel__files">
        {(hostSession.candidates.length ? hostSession.candidates : hostSession.candidateFiles.map((file) => ({ file, title: file.split('/').pop() || file, duration: 0, sourceCount: 0, sizeBytes: 0, updatedAt: 0 }))).map((candidate) => <button
          type="button"
          key={candidate.file}
          title={candidate.file}
          disabled={!writable || Boolean(importingCandidate)}
          onClick={() => void importCandidate(candidate.file)}
        >
          <span>{candidate.title}</span>
          <small>{candidate.duration > 0 ? `${Math.floor(candidate.duration / 60)}:${String(Math.round(candidate.duration % 60)).padStart(2, '0')} · ` : ''}{candidate.sourceCount || 0} 个源 · {(candidate.sizeBytes / 1024).toFixed(0)} KB</small>
          <b>{importingCandidate === candidate.file ? '正在导入…' : '确认导入'}</b>
        </button>)}
      </div>
    </div>}
    <iframe
      key={editorUrl}
      ref={iframeRef}
      onLoad={event => {
        const doc = event.currentTarget.contentDocument
        if (doc) doc.documentElement.dataset.uiTheme = document.documentElement.dataset.uiTheme || 'original'
        if (!doc || doc.getElementById('linkreader-glass-theme')) return
        const style = doc.createElement('style')
        style.id = 'linkreader-glass-theme'
        style.textContent = embeddedGlass
        doc.head.appendChild(style)
      }}
      className="openscreen-microfrontend"
      src={editorUrl}
      title="OpenScreen 全功能编辑器"
      allow="camera; microphone; display-capture; clipboard-read; clipboard-write; fullscreen"
    />
  </div>
}
