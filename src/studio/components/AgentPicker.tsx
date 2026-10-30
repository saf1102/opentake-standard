import {IS_MAC} from '../../general/platform';
import {useEffect,useState} from 'react';
import {connectionRequest,type ConnectionView} from '../connections';
import {LIGHT_AGENT_MODULES,type AgentConnectionId} from '../../../shared/agent-connections';
import type {AgentModule} from '../agent-settings';
/** 仅列已接通且当前工作能实际使用的智能体。 */
export function AgentPicker({work,value='codex',module,onChange}:{work:string;value?:AgentConnectionId;module?:AgentModule;onChange?:(id:AgentConnectionId)=>void}){
 const [connections,setConnections]=useState<ConnectionView[]>([]);
 useEffect(()=>{if(!IS_MAC)return;let active=true;const load=()=>void connectionRequest<{connections:ConnectionView[]}>().then(result=>{if(active)setConnections(result.connections)}).catch(()=>{if(active)setConnections([])});load();window.addEventListener('opentake-connections-changed',load);return()=>{active=false;window.removeEventListener('opentake-connections-changed',load)}},[]);
 const choices=connections.filter(c=>c.kind==='agent'&&c.connected&&c.enabled&&(c.id==='codex'&&(c.cliInstalled||!!module&&(LIGHT_AGENT_MODULES as readonly string[]).includes(module))||module==='generalEditing'&&c.heavySupported&&c.cliInstalled||!!module&&(LIGHT_AGENT_MODULES as readonly string[]).includes(module)&&c.mode==='api'));
 if(!IS_MAC)return <LegacyAgentPicker work={work}/>;
 return <select className="agent-picker" aria-label={`${work}使用的 Agent`} value={value} onChange={e=>onChange?.(e.target.value as AgentConnectionId)}>{!choices.some(c=>c.id===value)&&<option value={value} disabled>所选智能体未接通</option>}{choices.map(c=><option key={c.id} value={c.id}>{c.name} · {c.mode==='api'?'API 密钥':'命令行 · 账号登录'}{!c.cliInstalled?' · 仅轻活':''}</option>)}</select>;
}

import {ChevronDown} from 'lucide-react';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {AgentMark} from './AgentMark';
import type {AgentId} from '../agent-marks';
/** The agents a work module may run on, in roster order: Codex for now. the workbench never runs Claude Code (no account
 *  risk); the others wait until each is adapted to the modules' calls. */
const CHOICES:{id:AgentId;name:string;note?:string}[]=[{id:'codex',name:'Codex'},{id:'claude',name:'Claude Code',note:'工作台不调用'},
 {id:'kimi',name:'Kimi',note:'待适配'},{id:'deepseek',name:'DeepSeek',note:'待适配'},{id:'minimax',name:'MiniMax Code',note:'待适配'},{id:'codebuddy',name:'CodeBuddy',note:'待适配'}];
function LegacyAgentPicker({work}:{work:string}){
 return <DropdownMenu>
  <DropdownMenuTrigger asChild><button type="button" className="agent-picker" aria-label={`${work}使用的 Agent：Codex`}><AgentMark id="codex" size={22}/>Codex<ChevronDown size={14} aria-hidden="true"/></button></DropdownMenuTrigger>
  <DropdownMenuContent align="start" className="agent-picker-menu">
   {CHOICES.map(choice=><DropdownMenuItem key={choice.id} disabled={!!choice.note} aria-current={choice.id==='codex'?'true':undefined}>
    <AgentMark id={choice.id} size={22}/>{choice.name}<span className={`agent-picker-note${choice.note?'':' is-current'}`}>{choice.note||'使用中'}</span>
   </DropdownMenuItem>)}
  </DropdownMenuContent>
 </DropdownMenu>;
}
