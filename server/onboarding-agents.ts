import {listAgentConnections} from './agent-connections.ts';
import {connectionReadyForFilm,type ConnectionView} from '../shared/agent-connections.ts';
import type {CheckResult,AgentTile} from './onboarding-common.ts';
/** Deployment shares cached login-only checks; no prompt or generation is sent. */
export async function unifiedAgentCheck():Promise<CheckResult>{
 return agentCheckResult((await listAgentConnections(false)).connections);
}
export function agentCheckResult(connections:ConnectionView[]):CheckResult{
 const agents:AgentTile[]=connections.filter(item=>item.kind==='agent').map(item=>({
  id:item.id,name:item.name,line:item.cliInstalled?'已找到命令行':'没有检测到命令行',
  state:item.connected?'on':item.cliInstalled?'found':'off',
  status:!item.enabled?(item.cliInstalled?'已安装 · 默认不调用':'默认不调用'):item.connected?(item.cliInstalled?'已接通':'已接通 · 仅限轻活'):item.cliAuthMessage|| (item.cliInstalled?'已安装 · 还没接通':'未安装'),
 }));
 const ready=connections.filter(connectionReadyForFilm);
 return {id:'agent',state:ready.length?'ok':'act',text:ready.length?`${ready.map(item=>item.name).join('、')} 已接通，可以出片`:'还没有可出片的智能体，请在设置里接通 Codex 或 Claude Code',agents,action:{kind:'settings',label:ready.length?'管理智能体':'接入智能体',target:'agents'}};
}
