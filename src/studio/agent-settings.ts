import type {AgentConnectionId,ConnectionMode} from '../../shared/agent-connections.ts';
/** Shared settings contract. The server validates against the selected CLI's model/list. */
export const AGENT_MODULES = [{id:'generalEditing',name:'通用剪辑出片',description:'生成和检查视频'},{id:'screenEditing',name:'录屏编辑',description:'编辑录屏文档'},{id:'captionTranslation',name:'录屏字幕翻译',description:'翻译录屏字幕'}] as const;
export const VISIBLE_AGENT_MODULES=AGENT_MODULES;
export type AgentModule = typeof AGENT_MODULES[number]['id'];
export const EFFORT_LABELS: Record<string, string> = { none:'无推理', minimal:'最低', low:'轻度', medium:'中度', high:'高度', xhigh:'极高', max:'最高', ultra:'极限' };
export type AgentChoice = { model: string; effort: string; agent?: AgentConnectionId };
export type AgentSettings = { version: 1; allowRemoteAi?: boolean; cliPath: string; modules: Record<AgentModule, AgentChoice> };
export type AgentModel = { id: string; name: string; efforts: string[]; defaultEffort: string; isDefault?: boolean };
/** 'default' follows whatever model the user's own Codex calls its default (accounts differ in which models they get). */
export const FOLLOW_DEFAULT = 'default';
export type EffectiveChoice = AgentChoice & { requested?: AgentChoice };
/** The model and effort a run really uses. A model this Codex does not offer falls back to its default model (and an
 * unsupported effort to that model's default effort); `requested` records what was asked for so the change is shown. */
export function effectiveChoice(choice: AgentChoice, models: AgentModel[]): EffectiveChoice {
  const fallback = models.find(m => m.isDefault) || models[0];
  const model = choice.model === FOLLOW_DEFAULT ? fallback : models.find(m => m.id === choice.model) || fallback;
  if (!model) return { ...choice };
  const effort = model.efforts.includes(choice.effort) ? choice.effort : model.defaultEffort;
  const moved = (choice.model !== FOLLOW_DEFAULT && choice.model !== model.id) || effort !== choice.effort;
  return { ...(choice.agent?{agent:choice.agent}:{}), model: model.id, effort, ...(moved ? { requested: { ...choice } } : {}) };
}
export type AgentCatalog = { executable: string; cliVersion: string; models: AgentModel[]; checkedAt: string };
export type AgentRun = { agent?:AgentConnectionId;method?:ConnectionMode; purpose?: 'connectivity'; id: string; module: AgentModule; executable: string; model: string; effort: string; requested?: AgentChoice; startedAt: string; durationMs?: number; status: 'running'|'completed'|'failed'; reportedModel?: string; reportedEffort?: string; error?: string };
export type AgentSettingsView = { settings: AgentSettings; catalog: AgentCatalog | null; catalogError?: string; runs: AgentRun[] };
export function defaultAgentSettings(): AgentSettings {
  return { version: 1, allowRemoteAi: false, cliPath: '', modules: Object.fromEntries(AGENT_MODULES.map(m => [m.id, { model: FOLLOW_DEFAULT, effort: 'medium' }])) as AgentSettings['modules'] };
}

export const AGENT_ROWS: {group:string;id:AgentModule;also?:AgentModule[];name:string;description:string}[]=AGENT_MODULES.map(m=>({...m,group:'创作'}));
