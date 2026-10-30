import {listAgentConnections} from './agent-connections.ts';
import {connectionReadyForFilm,type ConnectionView} from '../shared/agent-connections.ts';
import type {CheckResult,AgentTile} from './onboarding-common.ts';
/** Deployment only reads connection/installation status; it never tests a model or starts an agent. */
export async function unifiedAgentCheck():Promise<CheckResult>{
 return agentCheckResult((await listAgentConnections(false)).connections);
}
export function agentCheckResult(connections:ConnectionView[]):CheckResult{
 const agents:AgentTile[]=connections.filter(item=>item.kind==='agent').map(item=>({
  id:item.id,name:item.name,line:item.cliInstalled?'已找到命令行':'没有检测到命令行',
  state:connectionReadyForFilm(item)?'on':item.cliInstalled||item.connected?'found':'off',
  status:!item.enabled?'已关闭 · 默认不调用':connectionReadyForFilm(item)?`已接通 · ${item.mode==='api'?'API 密钥':'命令行 · 账号登录'} · 可以出片`:item.connected&&!item.cliInstalled?'已接通 · 仅限轻活':!item.heavySupported?'出片待适配':item.cliInstalled?'已安装 · 还没接通':'未安装',
 }));
 const ready=connections.filter(connectionReadyForFilm);
 return {id:'agent',state:ready.length?'ok':'act',text:ready.length?`${ready.map(item=>item.name).join('、')} 已接通，可以出片`:'还没有可出片的智能体，请在设置里接通 Codex 或 Claude Code',agents,action:{kind:'settings',label:ready.length?'管理智能体':'接入智能体',target:'agents'}};
}
