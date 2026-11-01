import {ProjectAgentChoice} from '@/studio/components/ScopedAgentChoice'
import { ScreenExportDialog, type ScreenExportRequest } from '@/screen-motion/ScreenExportDialog'
import { prepareScreenWorkspace, ScreenWorkspaceExtraActions } from '@/screen-motion/workspace-edition'
import { useWorkspaceLeaveGuard, WorkspaceLink as Link } from '@/workspace/navigation-guard'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CircleStop, FileVideo2, MonitorUp, RefreshCw, ShieldCheck } from 'lucide-react'
import { useParams } from 'react-router'
import type { EditProject, OpenScreenBridgeMessage, OpenScreenHostSession } from '@/types'
import { cancelOpenScreenHostSession, confirmOpenScreenHostCandidate, getOpenScreenHostSession, getOpenScreenHostSessions, getProject, launchOpenScreenHost, getRecordingControlStatus, stopNativeRecording } from '@/studio/api'
import RecordingSetup from './RecordingSetup'
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

function getScreenClientId() {
  // 录屏窗口使用独立身份；口播继续使用自己的旧身份和锁规则。
  const key = 'opentake-screen-editor-client'
  const existing = window.sessionStorage.getItem(key)
  if (existing) return existing
  const value = createClientId()
  window.sessionStorage.setItem(key, value)
  return value
}

async function acquireScreenWorkspaceLock(id: string, clientId: string, takeover: boolean) {
  const response = await fetch(`/api/editor/projects/${encodeURIComponent(id)}/openscreen/lock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientName: '录屏窗口', takeover }),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) throw Error(data.error || '无法取得录屏编辑锁')
  return data.result as { acquired: boolean; lock: { clientName: string } }
}

export default function OpenScreenWorkspace() {
  const { id = '' } = useParams()
  const clientId = useMemo(getScreenClientId, [])
  const [project, setProject] = useState<EditProject | null>(null)
  const [writable, setWritable] = useState(false)
  const [status, setStatus] = useState('正在连接 OpenScreen 编辑器…')
  const [hostSession, setHostSession] = useState<OpenScreenHostSession | null>(null)
  const [importingCandidate, setImportingCandidate] = useState('')
  const [error, setError] = useState('')
  const [exportRequest, setExportRequest] = useState<ScreenExportRequest>()
  const [recordingSetup,setRecordingSetup]=useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  useEffect(()=>{setHostSession(null);setRecordingSetup(false);setProject(null)},[id])
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
      const lock = await acquireScreenWorkspaceLock(id, clientId, takeover)
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
    void Promise.all([getProject(id), refreshLock(), prepareScreenWorkspace(id)])
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
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data.type === 'export-dialog') { setError(''); setExportRequest(event.data.payload as ScreenExportRequest) }
      if (event.data.type === 'ready') setStatus(writable ? 'OpenScreen 全功能模式' : 'OpenScreen 只读模式')
      if (event.data.type === 'save-state') {
        setStatus(writable ? String(event.data.payload.label || '已保存') : 'OpenScreen 只读模式')
      }
      if (event.data.type === 'error') setError(String(event.data.payload.message || 'OpenScreen 编辑器发生错误'))
      if (event.data.type === 'recording-state' && event.data.payload.request) setRecordingSetup(true)
      if (event.data.type === 'recording-state' && event.data.payload.session) setHostSession(event.data.payload.session as OpenScreenHostSession)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [id, writable])

  useEffect(()=>{
    let disposed=false
    getRecordingControlStatus().then(async control=>{
      const pending=control.active?.projectId===id?control.active:(await getOpenScreenHostSessions(id)).find(s=>!['completed','cancelled','failed'].includes(s.status))
      if(pending){const session=await getOpenScreenHostSession(id,pending.id);if(!disposed)setHostSession(session)}
    }).catch(()=>undefined)
    return()=>{disposed=true}
  },[id])

  useEffect(() => {
    if (!hostSession || ['completed', 'cancelled', 'failed'].includes(hostSession.status)) return
    const timer = window.setInterval(() => {
      void getOpenScreenHostSession(id, hostSession.id).then(setHostSession).catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [hostSession?.id, hostSession?.status, id])

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
      const control=await getRecordingControlStatus()
      if(control.supported){setRecordingSetup(true);return}
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

  const stopRecording = async()=>{
    if(!hostSession)return
    try{setError('');setHostSession(await stopNativeRecording(id,hostSession.id,clientId))}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason))}
  }
  const recordingBusy=Boolean(hostSession?.mode==='cli'&&['launching','recording','stopping','processing'].includes(hostSession.status))
  const hostStatusLabel = hostSession ? {
    launching: '正在启动 OpenScreen…',
    waiting: '等待 OpenScreen 开始录制',
    recording: '本机 OpenScreen 正在录制',
    stopping: '正在停止并保存录制，请稍候…',
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
          <ShieldCheck size={14} />{hostSession?.mode==='cli'&&!['completed','cancelled'].includes(hostSession.status)?hostStatusLabel:status}
        </span>
      </div>
      <div className="openscreen-hostbar__actions">
        {project&&<ProjectAgentChoice projectId={id} workspace="screen" clientId={clientId} disabled={!writable}/>}
        {!writable && <button type="button" onClick={() => void refreshLock(true)}>接管编辑</button>}
        <button type="button" onClick={() => iframeRef.current?.contentWindow?.location.reload()}><RefreshCw size={15} />重新载入</button>
        <button type="button" onClick={() => void launchHud()} disabled={!writable||recordingBusy}><MonitorUp size={15} />开始录屏</button>
        <ScreenWorkspaceExtraActions id={id} />
      </div>
    </header>
    {error && <div className="openscreen-host-error" role="alert" style={{ color: '#9869dc', background: 'color-mix(in srgb,#9869dc 12%,transparent)' }}>{error}<button onClick={() => setError('')}>关闭</button></div>}
    {hostSession && !['completed', 'cancelled'].includes(hostSession.status) && <div className={`openscreen-host-session openscreen-host-session--${hostSession.status}`}>
      <span className="openscreen-host-session__pulse" />
      <div>
        <strong>{hostStatusLabel}</strong>
            <small>{hostSession.mode==='cli'?`${hostSession.sourceName||'本机录制'} · 可从 OpenTake 录制控制栏和托盘停止并保存`:'录制对象是当前运行 OpenScreen 的主机；OpenTake Standard 只接收本次会话新增的 OpenScreen 工程。'}</small>
      </div>
      {recordingBusy?<button type="button" onClick={()=>void stopRecording()} disabled={!writable||hostSession.status==='stopping'}><CircleStop size={15}/>{hostSession.status==='stopping'?'正在保存…':'停止并保存'}</button>:hostSession.status !== 'failed' && <button type="button" onClick={() => void cancelHudReceive()} disabled={!writable}>
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
    {exportRequest && project && <ScreenExportDialog id={id} name={project.name} clientId={clientId} input={{ ...exportRequest, canvas: { ...exportRequest.canvas, fps: Number(project.settings.fps) || 30 } }} onClose={() => setExportRequest(undefined)} />}
    {recordingSetup&&<RecordingSetup projectId={id} clientId={clientId} onClose={()=>setRecordingSetup(false)} onStarted={session=>{setHostSession(session);setRecordingSetup(false);setStatus('正在准备录制，停止时将保存工程')}}/>}
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
