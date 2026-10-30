import {useEffect, useMemo, useState} from 'react'
import {ChevronRight, RefreshCw} from 'lucide-react'
import {connectionReadyForFilm, type ConnectionId, type ConnectionView} from '../../shared/agent-connections'
import {ConnectionEditor} from '@/studio/components/ConnectionSettings'
import {connectionRequest} from '@/studio/connections'
import {getAgentSettings} from '@/studio/api'
import './first-agent-choice.css'

const isMacOnboarding = () => typeof window !== 'undefined' && /Mac/i.test(window.navigator.platform)

async function seenRequest(method = 'GET') {
  const response = await fetch('/api/editor/onboarding/general-choice', {method, cache: 'no-store'})
  const body = await response.json()
  if (!response.ok || !body.ok) throw Error(body.error || '首次选择记录暂时没保存，请重试')
  return body.result as {seenAt?: string}
}
export function useFirstAgentChoice() {
  const enabled = isMacOnboarding()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('选择出片智能体')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const refreshLabel = () => {
      void Promise.all([getAgentSettings(), connectionRequest<{connections: ConnectionView[]}>()]).then(([view, list]) => {
        const choice = list.connections.find(item => item.id === (view.settings.modules.generalEditing.agent || 'codex'))
        if (alive) setLabel(choice && connectionReadyForFilm(choice) ? `${choice.name} · ${choice.mode === 'api' ? 'API 密钥' : '命令行 · 账号登录'}` : '选择出片智能体')
      }).catch(() => {})
    }
    window.addEventListener('opentake:general-agent-changed', refreshLabel)
    window.addEventListener('opentake-connections-changed', refreshLabel)
    void seenRequest().then(value => {if (alive) {setOpen(!value.seenAt);if (value.seenAt) refreshLabel()}}).catch(() => {if (alive) setError('首次选择记录暂时读不到，可以点“选择出片智能体”重试。')})
    return () => {alive = false;window.removeEventListener('opentake:general-agent-changed', refreshLabel);window.removeEventListener('opentake-connections-changed', refreshLabel)}
  }, [enabled])
  return {enabled, open, error, label, show: () => {if (enabled) {setError('');setOpen(true)}}, close: () => {setError('');setOpen(false)}}
}
/** Same connection editor as Settings: a relay is advisory, never a second readiness gate. */
export function FirstAgentChoice({onDone}: {onDone: () => void}) {
  const enabled = isMacOnboarding()
  const [connections, setConnections] = useState<ConnectionView[]>([])
  const [selected, setSelected] = useState<ConnectionId>('codex')
  const [section, setSection] = useState<'cli' | 'api' | 'claude'>('cli')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editorBusy, setEditorBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    setLoading(true)
    void connectionRequest<{connections: ConnectionView[]}>().then(body => {
      if (!alive) return
      const agents = body.connections.filter(connection => connection.kind === 'agent')
      setConnections(agents)
      setSelected(current => agents.some(connection => connection.id === current) ? current : agents[0]?.id || 'codex')
      setError('')
    }).catch(failure => {if (alive) setError(failure instanceof Error ? failure.message : '智能体列表暂时读不到')}).finally(() => {if (alive) setLoading(false)})
    return () => {alive = false}
  }, [refresh, enabled])
  const chosen = connections.find(connection => connection.id === selected)
  const cli = connections.filter(connection => connection.id !== 'claude' && connection.cliInstalled)
  const ready = chosen && (section === 'claude' || chosen.mode === section) && connectionReadyForFilm(chosen) && !dirty && !editorBusy && !loading
  const changeSection = (next: typeof section, id: ConnectionId = next === 'claude' ? 'claude' : selected === 'claude' ? 'codex' : selected) => {
    setSection(next);setSelected(id);setDirty(false);setError('')
  }
  const changed = (connection: ConnectionView) => {
    setConnections(current => current.map(item => item.id === connection.id ? connection : item))
    setDirty(false)
  }
  const finish = async (skip: boolean) => {
    if (!enabled || saving || (!skip && !ready)) return
    setSaving(true);setError('')
    try {
      if (!skip && chosen) {
        // Read immediately before saving, so another settings page's edits are preserved.
        const view = await getAgentSettings()
        const response = await fetch('/api/editor/agent-settings/module/generalEditing', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...view.settings.modules.generalEditing, agent: chosen.id, model: chosen.model || 'default'})})
        const result = await response.json()
        if (!response.ok || !result.ok) throw Error(result.error || '出片智能体没保存，请重试')
        window.dispatchEvent(new Event('opentake:general-agent-changed'))
      }
      await seenRequest('POST')
      onDone()
    } catch (failure) {setError(failure instanceof Error ? failure.message : '选择没保存，请重试')}
    finally {setSaving(false)}
  }
  const editorConnection = useMemo(() => chosen && section !== 'claude' ? {...chosen, mode: section} : chosen, [chosen, section])
  const editor = editorConnection && <ConnectionEditor key={`${selected}-${section}`} connection={editorConnection} onChanged={changed} onBusyChange={setEditorBusy} onDirtyChange={setDirty}/>
  if (!enabled) return null
  return <section className="first-agent-choice" aria-labelledby="first-agent-title" aria-busy={loading || saving}>
    <h2 id="first-agent-title">选一个出片的智能体</h2>
    <p className="first-agent-subtitle">出片要用它写画面代码，之后可以在设置里换。</p>
    <div className="first-agent-options">
      <div className="first-agent-option" data-active={section === 'cli' || undefined}>
        <button type="button" className="first-agent-option-head" disabled={editorBusy || saving || dirty} aria-expanded={section === 'cli'} onClick={() => changeSection('cli')}><span className="first-agent-radio" data-checked={section === 'cli' || undefined}/>已装好的命令行</button>
        {section === 'cli' && <>
          {loading ? <p className="first-agent-note">正在检测已安装的智能体…</p> : cli.length ? <div className="first-agent-detected">{cli.map(connection => <button key={connection.id} type="button" disabled={editorBusy || saving || dirty} aria-pressed={selected === connection.id} className="first-agent-chip" onClick={() => {setSelected(connection.id);setDirty(false)}}><b>{connection.name}</b><small data-connected={connection.connected || undefined}>{connection.connected ? '已接通' : '已安装'}{!connection.heavySupported ? ' · 出片待适配' : ''}</small>{selected === connection.id && <span aria-hidden>✓</span>}</button>)}</div> : <p className="first-agent-note first-agent-notice">没找到，去装一个　<a href="https://developers.openai.com/codex/cli/" target="_blank" rel="noreferrer">Codex 官网 ↗</a></p>}
          {chosen && (!chosen.connected || chosen.mode !== 'cli') && editor}
        </>}
      </div>
      <div className="first-agent-option" data-active={section === 'api' || undefined}>
        <button type="button" className="first-agent-option-head" disabled={editorBusy || saving || dirty} aria-expanded={section === 'api'} onClick={() => changeSection('api')}><span className="first-agent-radio" data-checked={section === 'api' || undefined}/>API 密钥</button>
        {section === 'api' && <div className="first-agent-editor"><label className="first-agent-provider">智能体<select aria-label="API 接入的智能体" disabled={editorBusy || saving || dirty} value={selected} onChange={event => {setSelected(event.target.value as ConnectionId);setDirty(true)}}>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}{connection.cliInstalled ? ' · 已安装命令行' : ''}</option>)}</select></label>{editor}</div>}
        <p className="first-agent-note">只有 API 密钥、没装命令行的，只能做标题、翻译这类轻活，出片需要命令行</p>
      </div>
      <div className="first-agent-option" data-active={section === 'claude' || undefined}>
        <button type="button" className="first-agent-option-head" disabled={editorBusy || saving || dirty} aria-expanded={section === 'claude'} onClick={() => changeSection('claude')}><span aria-hidden>✳</span>Claude Code<span className="first-agent-aside">{connections.find(item => item.id === 'claude')?.enabled ? '已打开' : '默认关闭'}</span></button>
        {section === 'claude' && editor}
      </div>
    </div>
    {chosen && chosen.connected && !chosen.cliInstalled && <p className="first-agent-notice">连接已通过；还需要安装 {chosen.name} 命令行才能出片。</p>}
    {chosen && !chosen.heavySupported && <p className="first-agent-notice">{chosen.name} 出片待适配，请选择 Codex 或 Claude Code。</p>}
    {error && <p role="alert" className="first-agent-notice">{error} <button type="button" className="first-agent-retry" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13} aria-hidden/>重新检测</button></p>}
    <div className="first-agent-foot"><button type="button" className="first-agent-later" disabled={saving || editorBusy} onClick={() => void finish(true)}>以后再说</button><button type="button" className="first-agent-primary" disabled={!ready || saving} onClick={() => void finish(false)}>{saving ? '正在保存…' : '用这个开始'}<ChevronRight size={16} aria-hidden/></button></div>
  </section>
}
