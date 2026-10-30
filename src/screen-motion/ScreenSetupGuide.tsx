import {useEffect, useState} from 'react'
import {Download, MonitorPlay, RefreshCw, Settings} from 'lucide-react'
import './screen-setup-guide.css'

type ScreenCheck = {text: string; screenGuide?: {state: 'missing' | 'outdated' | 'permission-unknown'; version?: string; minimum: string}; action?: {kind: string; target?: string}}
/** Uses the same non-mutating OpenScreen check as 一键部署. No recording is started. */
export function ScreenSetupGuide() {
  const enabled = typeof window !== 'undefined' && /Mac/i.test(window.navigator.platform)
  const [check, setCheck] = useState<ScreenCheck>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    setBusy(true)
    setError('')
    void fetch('/api/editor/onboarding/openscreen', {cache: 'no-store'}).then(async response => {
      const body = await response.json()
      if (!response.ok || !body.ok || !body.result) throw Error(body.error || 'OpenScreen 暂时没查成，请重试')
      if (body.result.state === 'warn') throw Error(body.result.text || 'OpenScreen 暂时没查成，请重试')
      if (alive) setCheck(body.result)
    }).catch(failure => {if (alive) setError(failure instanceof Error ? failure.message : 'OpenScreen 暂时没查成，请重试')}).finally(() => {if (alive) setBusy(false)})
    return () => {alive = false}
  }, [refresh, enabled])
  const guide = check?.screenGuide
  const openPermission = async () => {
    setError('')
    try {
      const response = await fetch('/api/editor/onboarding/system/screen-recording', {method: 'POST'})
      const body = await response.json()
      if (!response.ok || !body.ok) throw Error(body.error || '屏幕录制设置没打开，请从系统设置进入')
    } catch (failure) {setError(failure instanceof Error ? failure.message : '屏幕录制设置没打开')}
  }
  if (!enabled || !guide && !error) return null
  const missing = guide?.state === 'missing', outdated = guide?.state === 'outdated'
  return <section className="screen-setup-guide" aria-labelledby="screen-setup-title" aria-busy={busy}>
    <span className="screen-setup-symbol"><MonitorPlay size={29} aria-hidden /></span>
    <div className="screen-setup-copy"><h2 id="screen-setup-title">{missing ? '先装好 OpenScreen' : outdated ? '更新 OpenScreen' : guide ? '打开屏幕录制权限' : '重新检查 OpenScreen'}</h2>
      <p className="screen-setup-notice">{missing ? '录屏运镜的录制和导出都要用 OpenScreen' : outdated ? `当前 ${guide?.version}，需要 ${guide?.minimum} 以上` : guide ? '到系统设置 → 隐私与安全性 → 屏幕录制，给 OpenScreen 打开权限' : '检查暂时没完成，已有工程仍可打开。'}</p>
      {guide?.state === 'permission-unknown' && <p className="screen-setup-detail">OpenTake 无法读取 OpenScreen 自己的权限状态；如果你已打开，可以直接开始录屏。</p>}
      <div className="screen-setup-actions">
        {(missing || outdated) ? <a className="screen-setup-primary" href="https://github.com/getopenscreen/openscreen/releases/latest" target="_blank" rel="noreferrer"><Download size={15} aria-hidden />{outdated ? '去下载新版' : '去下载'}</a> : guide && <button type="button" className="screen-setup-primary" onClick={() => void openPermission()}><Settings size={15} aria-hidden />打开屏幕录制设置</button>}
        <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} aria-hidden />{busy ? '正在检测…' : '我已装好，重新检测'}</button>
      </div>
      {error && <p className="screen-setup-notice" role="alert">{error}</p>}
    </div>
  </section>
}
