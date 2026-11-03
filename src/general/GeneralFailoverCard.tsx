import { useEffect } from 'react'
import { connectionDefinition, connectionReadyForFilm, type ConnectionView } from '@/studio/connections'
import { refreshConnections, useConnections } from '@/studio/connection-store'
import type { GeneralAgentChoice, GeneralRun } from './general-contract'

/** Keep the failed provider visible even after runtime authentication revokes its connection. */
export function failoverCandidates(run: GeneralRun, connections: ConnectionView[]) {
  return connections.filter(connection => connection.id !== run.agent && connectionReadyForFilm(connection))
}

export function GeneralFailoverCard({ run, busy, onSwitch, onResume }: {
  run: GeneralRun; busy: string; onSwitch: (choice: GeneralAgentChoice) => void; onResume: () => void
}) {
  const state = useConnections()
  useEffect(() => { void refreshConnections() }, [run.id])
  const name = connectionDefinition(run.agent).name
  const pageFailed=run.failure?.kind==='generated-page'
  const noResponse = run.errorKind === 'no-response'
  const officialPage = run.agent === 'kimi' ? 'https://www.kimi.com/code/#pricing' : connectionDefinition(run.agent).page
  const choices = state.error ? [] : failoverCandidates(run, state.connections)
  const switchTo = (connection: ConnectionView) => onSwitch({ agent: connection.id as GeneralAgentChoice['agent'], model: 'default', effort: 'medium' })
  return <div className="ge-runnote ge-failover" data-tone="failed" role="alert">
    <b>{noResponse ? `${name}没有回应` : run.error || `${name} 这次没做完`}</b>
    {noResponse && <p className="ge-failover-reason">常见原因是套餐不含这项服务或额度用完，请到<a href={officialPage} target="_blank" rel="noreferrer">{name}官网确认</a>。</p>}
    {pageFailed && <p>页面代码执行失败，工程已保留。重试会先修复已有页面。</p>}
    <p>已完成的计划、代码和画面都保留着，可以换一个已接通的智能体，从当前进度接着做。</p>
    <div className="ge-failover-actions">
      {choices.map((connection, index) => <button key={connection.id} type="button" className={`ge-failover-button${index === 0 ? ' primary' : ''}`} disabled={!!busy || state.loading} onClick={() => switchTo(connection)}>
        {busy === `switch-agent-${connection.id}` ? '正在接着做…' : index === 0 ? `换 ${connection.name} 接着做` : `换 ${connection.name}`}
      </button>)}
      {!noResponse && <button type="button" className="ge-failover-button later" disabled={!!busy} onClick={onResume}>{busy === 'resume' ? '正在接着做…' : pageFailed ? '修复后重试' : `稍后用 ${name} 接着做`}</button>}
    </div>
    {state.loading && <small role="status">正在检查可接着做的智能体…</small>}
    {state.error ? <small className="ge-failover-notice">{state.error} <button type="button" disabled={!!busy || state.loading} onClick={() => void refreshConnections()}>重新检查</button></small>
      : !state.loading && !choices.length && <small>还没有其他已接通且能出片的智能体，可以到设置接入后回来继续。</small>}
  </div>
}
