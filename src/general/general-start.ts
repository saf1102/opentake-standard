import type {EnvironmentCheck} from '../../shared/creation-tools'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { generalApi, announceGeneralChange, errorText, GeneralApiError } from './general-api'
import type { GeneralAgentChoice, GeneralInputKind, GeneralProject, GeneralSettings } from './general-contract'
import { generalProjectHref } from './general-logic'

export type StartBusy = { phase: 'check' | 'create' | 'upload' | 'start'; index?: number; total?: number; ratio?: number }
export type StartSpec = {
  styleId: string; kind: GeneralInputKind; text: string; note: string; settings: GeneralSettings; files: readonly { key: string; file: File }[]
  /** the model and effort (absent: 系统默认) and 联网 */
  agent?: GeneralAgentChoice; network?: boolean
}

/**
 * 开始生成: creates the project, uploads the files, starts it and opens the work page. A failed attempt keeps the
 * project, so 再试一次 reuses it and skips files already uploaded.
 */
export function useGeneralStart() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<StartBusy | null>(null)
  const [error, setError] = useState('')
  const [environment,setEnvironment] = useState<EnvironmentCheck | null>(null)
  const starting = useRef(false)
  const created = useRef<{ project: GeneralProject; uploaded: Map<string, string> } | null>(null)
  const start = async (spec: StartSpec) => {
    if (starting.current) return
    starting.current=true
    // Asked inside the click, so the desktop app can show its permission prompt; the answer only affects 系统通知.
    try { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission() } catch { /* not available */ }
    setError('')
    try {
      setBusy({ phase: 'check' })
      const response=await fetch('/api/environment')
      if(!response.ok)throw Error('环境检查失败，请重新检查')
      const check=await response.json() as EnvironmentCheck & {ffmpeg?:{ok:boolean;message?:string}}
      if(check.items){
        setEnvironment(check)
        if(!check.ok){setBusy(null);return}
      }
      setBusy({ phase: 'create' })
      const inputs = { kind: spec.kind, text: spec.text, note: spec.note }
      const choice = { ...(spec.agent ? { agent: spec.agent } : {}), network: !!spec.network }
      if (!created.current) {
        created.current = { project: await generalApi.create({ styleId: spec.styleId, settings: spec.settings, inputs, ...choice }), uploaded: new Map() }
      }
      else created.current.project = await generalApi.patch(created.current.project.id, { settings: spec.settings, inputs: { text: inputs.text, note: inputs.note }, agent: spec.agent ?? null, network: !!spec.network })
      const { project, uploaded } = created.current
      if (spec.kind === 'footage') {
        for (const [key, mediaId] of [...uploaded]) if (!spec.files.some(file => file.key === key)) { await generalApi.removeMedia(project.id, mediaId); uploaded.delete(key) }
        const pending = spec.files.filter(file => !uploaded.has(file.key))
        for (const [index, file] of pending.entries()) {
          setBusy({ phase: 'upload', index, total: pending.length, ratio: 0 })
          const media = await generalApi.upload(project.id, file.file, ratio => setBusy({ phase: 'upload', index, total: pending.length, ratio }))
          uploaded.set(file.key, media.id)
        }
      }
      setBusy({ phase: 'start' })
      await generalApi.generate(project.id)
      announceGeneralChange()
      navigate(generalProjectHref(project.id))
    } catch (failure) {
      if(failure instanceof GeneralApiError && failure.environment)setEnvironment(failure.environment)
      setError(`没能开始：${errorText(failure)}`)
      setBusy(null)
    } finally { starting.current=false }
  }
  const busyLabel = !busy ? '' : busy.phase === 'check' ? '正在检查出片工具…' : busy.phase === 'create' ? '正在建工程…'
    : busy.phase === 'upload' ? `正在上传 ${(busy.index ?? 0) + 1}/${busy.total} · ${Math.round((busy.ratio ?? 0) * 100)}%` : '正在开始…'
  return { busy, busyLabel, error, environment, start }
}
