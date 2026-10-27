/** Shared settings contract. The server validates against the selected CLI's model/list. */
export const AGENT_MODULES = [{id:'generalEditing',name:'通用剪辑出片',description:'生成和检查视频'},{id:'screenEditing',name:'录屏编辑',description:'编辑录屏文档'},{id:'captionTranslation',name:'录屏字幕翻译',description:'翻译录屏字幕'}] as const;
export const VISIBLE_AGENT_MODULES=AGENT_MODULES;
export type AgentModule = typeof AGENT_MODULES[number]['id'];
export const EFFORT_LABELS: Record<string, string> = { none:'无推理', minimal:'最低', low:'轻度', medium:'中度', high:'高度', xhigh:'极高', max:'最高', ultra:'极限' };
export type AgentChoice = { model: string; effort: string };
export type AgentSettings = { version: 1; allowRemoteAi?: boolean; cliPath: string; modules: Record<AgentModule, AgentChoice> };
export type AgentModel = { id: string; name: string; efforts: string[]; defaultEffort: string };
export type AgentCatalog = { executable: string; cliVersion: string; models: AgentModel[]; checkedAt: string };
export type AgentRun = { purpose?: 'connectivity'; id: string; module: AgentModule; executable: string; model: string; effort: string; startedAt: string; durationMs?: number; status: 'running'|'completed'|'failed'; reportedModel?: string; reportedEffort?: string; error?: string };
export type AgentSettingsView = { settings: AgentSettings; catalog: AgentCatalog | null; catalogError?: string; runs: AgentRun[] };
export function defaultAgentSettings(): AgentSettings {
  return { version: 1, allowRemoteAi: false, cliPath: '', modules: Object.fromEntries(AGENT_MODULES.map(m => [m.id, { model: 'gpt-6-astra', effort: 'medium' }])) as AgentSettings['modules'] };
}
