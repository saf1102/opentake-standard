import {useEffect,useRef,useState} from 'react';
import {connectionRequest,type ConnectionView} from '../connections';
import {getAgentSettings} from '../api';
import {AGENT_ROWS,EFFORT_LABELS,type AgentChoice,type AgentModule,type AgentSettingsView} from '../agent-settings';
import {LIGHT_AGENT_MODULES,type AgentConnectionId} from '../../../shared/agent-connections';
import './scoped-agent-choice.css';
/** A choice supplied by the owner (project, draft or one operation), never a write to global defaults. */
export function ScopedAgentChoice({work,value,onChange,disabled=false,label='智能体',requiresImages=false}:{work:AgentModule;value?:AgentChoice;onChange:(choice:AgentChoice|undefined)=>void;disabled?:boolean;label?:string;requiresImages?:boolean}){
 const [connections,setConnections]=useState<ConnectionView[]>([]),[settings,setSettings]=useState<AgentSettingsView>(),[error,setError]=useState(''),[manual,setManual]=useState('');
 useEffect(()=>{let alive=true;const load=()=>{void Promise.all([connectionRequest<{connections:ConnectionView[]}>(),getAgentSettings()]).then(([list,view])=>{if(alive){setConnections(list.connections);setSettings(view);setError('')}}).catch(()=>{if(alive)setError('智能体列表暂时读不到，请重试')})};load();window.addEventListener('opentake-connections-changed',load);return()=>{alive=false;window.removeEventListener('opentake-connections-changed',load)}},[]);
 const inherited=settings?.settings.modules[work];
 const effective=value??inherited;
 const agent=effective?.agent||'codex';
 const choice=connections.find(item=>item.id===agent);
 const available=connections.filter(item=>item.kind==='agent'&&item.connected&&item.enabled&&(item.id==='codex'?(item.cliInstalled||!requiresImages&&(LIGHT_AGENT_MODULES as readonly string[]).includes(work)&&item.mode==='api'):!requiresImages&&(LIGHT_AGENT_MODULES as readonly string[]).includes(work)&&item.mode==='api'));
 const unavailableDefault=!!settings&&!value&&!available.some(item=>item.id===agent);
 const codexModels=settings?.catalog?.models||[];
 const models=agent==='codex'&&choice?.mode==='cli'?codexModels:choice?.models||[];
 const codexModel=effective?.model==='default'?codexModels.find(item=>item.isDefault)||codexModels[0]:codexModels.find(item=>item.id===effective?.model);
 const missing=!!value&&value.model!=='default'&&models.length>0&&!models.some(item=>item.id===value.model);
 useEffect(()=>setManual(value?.model||'default'),[value?.model,agent]);
 const changeModel=(model:string)=>{const info=codexModels.find(item=>item.id===model);onChange({agent,model,effort:agent==='codex'?(info?.efforts.includes(effective?.effort||'')?effective!.effort:info?.defaultEffort||effective?.effort||'medium'):'none'})};
 return <div className="scoped-agent-choice">
  <label>{label}<select aria-label={`${label} Agent`} value={value?agent:''} disabled={disabled||!settings} onChange={event=>{const id=event.target.value as AgentConnectionId;if(!id)return onChange(undefined);onChange({agent:id,model:'default',effort:id==='codex'?'medium':'none'})}}>
   <option value="" disabled={!!settings&&!available.some(item=>item.id===(settings.settings.modules[work].agent||'codex'))}>跟随设置{inherited?` · ${connections.find(item=>item.id===(inherited.agent||'codex'))?.name||inherited.agent||'Codex'}`:''}</option>
   {value&&!available.some(item=>item.id===agent)&&<option value={agent} disabled>所选智能体当前不可用</option>}
   {available.map(item=><option key={item.id} value={item.id}>{item.name} · {item.mode==='api'?'API 密钥':'命令行 · 账号登录'}{!item.cliInstalled?' · 仅轻活':''}</option>)}
  </select></label>
  {value&&<label>模型{models.length?<select aria-label={`${label}模型`} value={value.model} disabled={disabled} onChange={event=>changeModel(event.target.value)}><option value="default">跟随 {choice?.name||agent} 默认</option>{missing&&<option value={value.model}>{value.model}（将回退默认）</option>}{models.map(model=><option key={model.id} value={model.id}>{model.name||model.id}</option>)}</select>:<input aria-label={`${label}模型`} disabled={disabled} value={manual} placeholder="default：跟随默认；也可以填模型名" onChange={event=>setManual(event.target.value)} onBlur={()=>{if(manual.trim()&&manual.trim()!==value.model)changeModel(manual.trim())}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/>}</label>}
  {value&&agent==='codex'&&codexModel&&<label>推理强度<select aria-label={`${label}推理强度`} disabled={disabled} value={value.effort} onChange={event=>onChange({...value,effort:event.target.value})}>{codexModel.efforts.map(effort=><option key={effort} value={effort}>{EFFORT_LABELS[effort]||effort}</option>)}</select></label>}
  {unavailableDefault&&<p role="status" className="scoped-agent-note">设置中的默认智能体还没接通，或不支持这项工作，请选择下方已接通的智能体。</p>}
  {missing&&<p role="status" className="scoped-agent-note">所选模型不在当前列表，执行时改用该智能体默认模型。</p>}
  {requiresImages&&<p className="scoped-agent-note">本次带参考图，需要已接通的 Codex 命令行；其他接入的图片能力待适配。</p>}
  {error&&<p role="alert" className="scoped-agent-note">{error}<button type="button" onClick={()=>window.dispatchEvent(new Event('opentake-connections-changed'))}>重新读取</button></p>}
 </div>;
}

type ProjectChoices={revision:number;choices:Partial<Record<AgentModule,AgentChoice>>};
/** Project-local persistence; requests are guarded by the editor's existing lock identity. */
export function ProjectAgentChoice({projectId,workspace,clientId,disabled=false}:{projectId:string;workspace:'spoken'|'screen';clientId:string;disabled?:boolean}){
 const rows=AGENT_ROWS.filter(row=>workspace==='screen'?row.id==='screenEditing'||row.id==='captionTranslation':row.group==='口播剪辑'&&String(row.id)!=='brollPrompt');
 const [work,setWork]=useState<AgentModule>(rows[0]?.id||'screenEditing'),[view,setView]=useState<ProjectChoices>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const url=`/api/editor/projects/${encodeURIComponent(projectId)}/agent-choices/${workspace}`;
 const currentUrl=useRef(url);currentUrl.current=url;
 useEffect(()=>{let alive=true;setView(undefined);setBusy(false);void fetch(url,{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'工程智能体设置暂时读不到');if(alive){setView(data.result);setError('')}}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[url,reload]);
 const save=async(choice:AgentChoice|undefined)=>{if(!view||busy||disabled)return;setBusy(true);setError('');try{const response=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({module:work,choice:choice??null,revision:view.revision,clientId})});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'选择没保存，请重试');if(currentUrl.current===url)setView(data.result)}catch(e){if(currentUrl.current===url)setError(e instanceof Error?e.message:'选择没保存')}finally{if(currentUrl.current===url)setBusy(false)}};
 return <details className="project-agent-choice"><summary>这个工程的智能体</summary><div className="project-agent-panel"><p>只记在这个工程里，不改变设置中的默认值。</p><label>工作<select aria-label="工程智能体工作" value={work} disabled={busy} onChange={event=>setWork(event.target.value as AgentModule)}>{rows.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><ScopedAgentChoice key={work} work={work} value={view?.choices[work]} onChange={choice=>void save(choice)} disabled={disabled||busy||!view} label="这个工程的"/>{busy&&<p role="status">正在保存…</p>}{error&&<p role="alert" className="scoped-agent-note">{error}<button type="button" disabled={busy} onClick={()=>setReload(value=>value+1)}>重新读取</button></p>}</div></details>;
}
