import {IS_MAC} from '../../general/platform'
import {connectionRequest,type ConnectionView} from '../connections'
import {AgentPicker,VoiceSettings,modelsDescription,testAllCatalogModels} from './agent-settings-edition';
import { useEffect, useState, useRef } from 'react'
import { Bot, CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { getAgentSettings, refreshAgentCatalog, saveAgentSettings, testAgentConnection, type AgentConnectionResult } from '../api'
import { AGENT_ROWS, AGENT_MODULES, EFFORT_LABELS, FOLLOW_DEFAULT, effectiveChoice, type AgentModule, type AgentSettings, type AgentSettingsView } from '../agent-settings'
import './agent-settings.css'

export function AgentSettingsDialog({embedded=false,onDirtyChange,onBusyChange}:{embedded?:boolean;onDirtyChange?:(value:boolean)=>void;onBusyChange?:(value:boolean)=>void}={}) {
  const baseline=useRef('');
  const [open, setOpen] = useState(embedded)
  const [view, setView] = useState<AgentSettingsView | null>(null)
  const [draft, setDraft] = useState<AgentSettings | null>(null)
  const [busy, setBusy] = useState('')
  const [tests, setTests] = useState<AgentConnectionResult[]>([])
  const [testingLabel, setTestingLabel] = useState('')
  const [testedConfig, setTestedConfig] = useState('')
  const [error, setError] = useState('')
  const [connections,setConnections]=useState<ConnectionView[]>([])
  useEffect(()=>{if(open&&IS_MAC)void connectionRequest<{connections:ConnectionView[]}>().then(r=>setConnections(r.connections)).catch(()=>{})},[open])
  useEffect(() => {
    if (!open) return
    let active = true
    setBusy('load'); setError(''); setDraft(null); setView(null)
    void getAgentSettings().then(result => {
      if (!active) return
      setView(result); const initial={ ...result.settings, cliPath: result.settings.cliPath }; baseline.current=JSON.stringify(initial); setDraft(initial)
      setError(result.catalogError || '')
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setBusy('') })
    return () => { active = false }
  }, [open])
  const act = async (name: string, work: () => Promise<void>) => {
    setBusy(name); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  useEffect(()=>{onDirtyChange?.(!!draft&&JSON.stringify(draft)!==baseline.current)},[draft,onDirtyChange]);
  useEffect(()=>{onBusyChange?.(!!busy);return ()=>onBusyChange?.(false)},[busy,onBusyChange]);
  useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
  const catalog = view?.catalog
  const catalogMatchesPath = !!catalog && (!draft?.cliPath || draft.cliPath === catalog.executable)
  const invalid = draft && catalog ? AGENT_MODULES.filter(({ id }) => { if(IS_MAC&&draft.modules[id].agent&&draft.modules[id].agent!=='codex')return false; const m = catalog.models.find(x => x.id === draft.modules[id].model); return !!m && !m.efforts.includes(draft.modules[id].effort) }) : []
  const defaultModel = catalog?.models.find(m => m.isDefault) || catalog?.models[0]
  // 合成一行的几项（智能粗剪 + 章节、半卡 + 全卡）一起改
  const update = (id: AgentModule, model: string, effort: string, also: AgentModule[] = []) => setDraft(d => d && ({ ...d, modules: { ...d.modules, ...Object.fromEntries([id, ...also].map(m => [m, { ...d.modules[m], model, effort }])) } }))
  const content = <>
      <div className="agent-settings-heading"><span className="agent-settings-icon"><Bot size={25} /></span><div>{embedded?<><h3>工作模块的模型</h3><p>{modelsDescription}</p></>:<><DialogTitle>工作模块的模型</DialogTitle><DialogDescription>每项工作选一个 Agent 和模型；配音用 MiniMax 语音。Agent 的检测与安装在 系统设置 › 已接入的 Agent。</DialogDescription></>}</div></div>
      <div className="agent-settings-body" aria-busy={!!busy}>
        {busy === 'load' && <p className="agent-settings-loading"><LoaderCircle size={18} className="animate-spin" /> 正在读取 Codex 配置与可用模型…</p>}
        {draft && <div className="agent-models">

          <section className="agent-cli-section">
            <div className="agent-cli-controls">
              <button disabled={!!busy} onClick={() => void act('catalog', async () => { const next = await refreshAgentCatalog(draft.cliPath); setView(v => v && ({ ...v, catalog: next })); setDraft(d => d && ({ ...d })) })}>{busy === 'catalog' ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />} 刷新模型列表</button>
            <button className="agent-test-button" title={testAllCatalogModels?"测试全部模型及模块所选推理强度":"测试当前工作模块所选模型与推理强度"} disabled={!!busy || !catalogMatchesPath || invalid.length > 0} onClick={() => void act('test', async () => {
              if (!catalog) return
              setTests([]); setTestedConfig(JSON.stringify(draft))
              const choices = [...(testAllCatalogModels?catalog.models.map(m => ({model:m.id,effort:m.efforts.includes('medium') ? 'medium' : m.defaultEffort})):[]), ...Object.values(draft.modules).filter(c=>!IS_MAC||!c.agent||c.agent==='codex').map(c => { const e = effectiveChoice(c, catalog.models); return { model: e.model, effort: e.effort } })]
              const unique = [...new Map(choices.map(c => [`${c.model}/${c.effort}`,c])).values()]
              try {
                for (const [index, choice] of unique.entries()) {
                  setTestingLabel(`${index+1}/${unique.length} · ${choice.model} / ${choice.effort}`)
                  try { const result = await testAgentConnection({cliPath:draft.cliPath,...choice}); setTests(t => [...t,result]) }
                  catch(e) { setTests(t => [...t,{...choice,ok:false,durationMs:0,checkedAt:new Date().toISOString(),error:e instanceof Error ? e.message : String(e)}]) }
                }
              } finally {setTestingLabel('')}
            })}>{busy === 'test' && <LoaderCircle size={15} className="animate-spin" />} 连通测试</button>
            </div>
            <div className="agent-cli-status">{catalogMatchesPath ? <><CheckCircle2 size={14} /><span>{catalog.cliVersion} · 已读取 {catalog.models.length} 个可用模型 · {new Date(catalog.checkedAt).toLocaleTimeString('zh-CN')}</span></> : <span>Codex 的程序有变化（在「已接入的 Agent」里检测或手动指定），请点「刷新模型列表」读取它提供的模型。</span>}</div>
          <div className="agent-connectivity">


            <div role="status" aria-live="polite">{testingLabel ? `正在测试 ${testingLabel}` : tests.length > 0 ? `测试完成：${tests.filter(t=>t.ok).length} 成功，${tests.filter(t=>!t.ok).length} 失败` : ''}</div>
            {tests.length > 0 && testedConfig !== JSON.stringify(draft) && <p>配置已修改，以下是修改前的测试结果，请重新测试。</p>}
            {tests.length > 0 && <details><summary>查看测试明细 · {tests.length} 项</summary>{tests.map(t=><div className="agent-connection-result" key={`${t.model}/${t.effort}`}><b>{t.ok ? '✓ 连通' : '✕ 失败'}</b><code>{t.model} / {t.effort}</code><span>{(t.durationMs/1000).toFixed(1)} 秒 · {new Date(t.checkedAt).toLocaleTimeString('zh-CN')}</span>{t.error && <small>{t.error}</small>}</div>)}</details>}
            {tests.length > 0 && <p className="agent-settings-note">结果仅代表本次模型请求可用，不代表所有推理档位、业务任务或后续网络状态都已验证。</p>}
          </div></section>
          <div className="agent-model-section-heading"><b>工作模块</b><span>推理强度独立于运行速度；仅显示所选模型支持的档位。</span></div>
          <div className="agent-module-table"><div className="agent-module-head"><span>工作</span><span>Agent</span><span>模型</span><span>推理强度</span></div>
            {/* 按模块分组（S先生 10-27）；选题研究和选题库「研究设置」是同一个设置，两边都能改 */}
            {AGENT_ROWS.map(({ group, id, also = [], name, description }, index) => {
              const choice = draft.modules[id], connection=connections.find(c=>c.id===(choice.agent||'codex')), isCodex=!IS_MAC||!choice.agent||choice.agent==='codex', effective = isCodex&&catalog ? effectiveChoice(choice, catalog.models) : undefined, model = catalog?.models.find(m => m.id === effective?.model)
              const missing = isCodex && !!catalog && choice.model !== FOLLOW_DEFAULT && !catalog.models.some(m => m.id === choice.model)
              const mixed = also.some(a => draft.modules[a].model !== choice.model || draft.modules[a].effort !== choice.effort)
              const head = index === 0 || AGENT_ROWS[index - 1].group !== group ? <div className="agent-module-group" key={`g-${group}`}>{group}</div> : null
              const testedPath = testedConfig ? (JSON.parse(testedConfig) as AgentSettings).cliPath : null
              const result = testedPath === draft.cliPath ? tests.find(t => t.model === effective?.model && t.effort === effective?.effort) : undefined
              return [head, <div className="agent-module-row" key={id}><div className="agent-module-description"><div><b>{name}</b><small>{description}</small></div><span className={`agent-module-check ${result?.ok ? 'is-passed' : result ? 'is-failed' : ''}`} title={result ? `${result.ok ? '连通测试通过' : result.error} · ${(result.durationMs/1000).toFixed(1)} 秒 · ${new Date(result.checkedAt).toLocaleString('zh-CN')}` : '当前配置尚未测试'} aria-label={`${name}：${result?.ok ? '连通测试通过' : result ? '连通测试失败' : '尚未测试'}`}>{result?.ok ? <CheckCircle2 size={21} /> : result ? '✕' : '—'}</span></div>
                <AgentPicker work={name} module={id} value={choice.agent||'codex'} onChange={agent=>setDraft(d=>d&&({...d,modules:{...d.modules,...Object.fromEntries([id,...also].map(m=>[m,{...d.modules[m],agent,model:'default'}]))}}))}/>
                {!isCodex?<select aria-label={`${name}模型`} value={choice.model} disabled={!!busy||!connection?.connected} onChange={e=>update(id,e.target.value,'none',also)}><option value="default">跟随 {connection?.name||choice.agent} 默认</option>{connection?.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>:<select aria-label={`${name}模型`} value={mixed ? '' : choice.model} disabled={!!busy || !catalogMatchesPath} onChange={e => { if (e.target.value === FOLLOW_DEFAULT) { update(id, FOLLOW_DEFAULT, defaultModel && !defaultModel.efforts.includes(choice.effort) ? defaultModel.defaultEffort : choice.effort, also); return } const next = catalog?.models.find(m => m.id === e.target.value); if (next) update(id, next.id, next.efforts.includes(choice.effort) ? choice.effort : next.defaultEffort, also) }}>
                  {mixed && <option value="" disabled>各项不同 · 选一次就统一</option>}<option value={FOLLOW_DEFAULT}>跟随 Codex 默认{defaultModel ? `（${defaultModel.name}）` : ''}</option>{missing && <option value={choice.model}>{choice.model} · 你的 Codex 没有</option>}{catalog?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>}
                <select aria-label={`${name}推理强度`} value={effective?.effort ?? choice.effort} disabled={!!busy || !isCodex || !catalogMatchesPath || !model} onChange={e => update(id, choice.model, e.target.value, also)}>
                  {!model?.efforts.includes(choice.effort) && <option value={choice.effort}>{choice.effort} · 不支持</option>}{model?.efforts.map(e => <option key={e} value={e}>{EFFORT_LABELS[e] || e} · {e}</option>)}
                </select>
                {missing && effective && <p className="agent-module-fallback" role="note">你的 Codex 没有 {choice.model}，会改用默认的 {model?.name ?? effective.model}</p>}
              </div>]
            })}
          </div>
          <p className="agent-settings-note">正在执行的任务保持启动时的设置。手动修改文字、播放、模板渲染与导出不调用 Codex；已确认的卡位与已生成的卡片不会因修改设置被替换。</p>
          <VoiceSettings/>
          {!!view?.runs.length && <details className="agent-recent-runs"><summary>最近实际调用 · {view.runs.length} 条</summary><div>{view.runs.slice(0, 10).map(run => <div key={run.id}><span>{run.purpose === 'connectivity' ? '连通测试' : AGENT_MODULES.find(m => m.id === run.module)?.name}</span><code>{run.model} / {run.effort}</code><span>{run.status === 'completed' ? 'CLI 已完成' : run.status === 'running' ? '执行中' : '失败'}{run.durationMs !== undefined && ` · ${(run.durationMs / 1000).toFixed(1)} 秒`}</span><small>{new Date(run.startedAt).toLocaleString('zh-CN')}{run.error && ` · ${run.error}`}</small></div>)}</div></details>}
        </div>}
        {(error || invalid.length > 0) && <p className="agent-settings-error" role="alert">{error || `${invalid.map(m => m.name).join('、')} 的模型或强度不可用，请重新选择。`}</p>}
        {!draft && !busy && error && <button onClick={() => void act('load', async () => { const result = await getAgentSettings(); setView(result); setDraft({ ...result.settings, cliPath: result.settings.cliPath }); setError(result.catalogError || '') })}>重新读取</button>}
      </div>
      <footer className="agent-settings-footer"><span>每次调用明确传入模型与强度，并记录执行信息。</span><button disabled={!!busy} onClick={() => {if(embedded&&baseline.current)setDraft(JSON.parse(baseline.current));else setOpen(false)}}>取消</button><button className="agent-settings-save" disabled={!!busy || !draft || invalid.length > 0} onClick={() => void act('save', async () => { if (!draft) return; const next = await saveAgentSettings(draft); setView(next); baseline.current=JSON.stringify(next.settings); setDraft(next.settings); toast.success('Agent 设置已保存，将用于后续任务'); if(!embedded)setOpen(false) })}>{busy === 'save' && <LoaderCircle size={15} className="animate-spin" />} 保存设置</button></footer>
</>;
  if(embedded)return <section className="agent-settings-dialog agent-settings-embedded">{content}</section>;
  return <Dialog open={open} onOpenChange={next=>{if(!busy||next)setOpen(next)}}><DialogTrigger asChild><button className="agent-settings-entry"><Bot size={17}/> Agent 设置</button></DialogTrigger><DialogContent className="agent-settings-dialog" onInteractOutside={e=>e.preventDefault()}>{content}</DialogContent></Dialog>;
}
