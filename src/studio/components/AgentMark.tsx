import {AGENT_MARKS,type AgentId} from '../agent-marks';
import {Bot} from 'lucide-react';
/** An agent's maker's mark on a dark tile (settings rows: 40 px; the work-module picker: 22 px). */
export function AgentMark({id,size=40}:{id:AgentId|string;size?:number}){
 const mark=AGENT_MARKS[id as AgentId];
 return <span className="agent-mark" style={{width:size,height:size,borderRadius:size/4}} aria-hidden="true">
  {/* 内置智能体没有厂商标志，用通用的机器人图标，不再显示 id 前两个字母「BU」。 */}
  {id==='builtin'?<Bot size={size*.55} color="#ffb020" strokeWidth={1.8}/>:mark?<svg viewBox={mark.viewBox} width={size*.55} height={size*.55}><path fill={mark.color} d={mark.d}/></svg>:<span style={{fontSize:size*.35,fontWeight:600}}>{({copilot:'GH',cursor:'C',opencode:'OC',qwen:'Q'} as Record<string,string>)[id]||id.slice(0,2).toUpperCase()}</span>}
 </span>;
}
