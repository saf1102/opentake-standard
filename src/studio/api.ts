import type {EditProject, OpenScreenHostSession, OpenScreenDocumentRef} from '../types';
import type {AgentSettingsView} from './agent-settings';
async function json<T>(response: Response): Promise<T> {
  const data = await response.json() as { ok: boolean; result?: T; error?: string }
  if (!response.ok || !data.ok || data.result === undefined) throw new Error(data.error || `请求失败（${response.status}）`)
  return data.result
}
export type MediaUrlKind = 'proxy' | 'clear' | 'original' | 'thumbnail' | 'filmstrip' | 'waveform' | 'cursor'
/** Projects that are not 口播 projects (通用剪辑) say where their media lives; the editor components ask through mediaUrl. */
const mediaResolvers = new Map<string, (assetId: string, kind: MediaUrlKind | 'peaks', duration?: number) => string | undefined>()
export function registerMediaUrls(projectId: string, resolve: (assetId: string, kind: MediaUrlKind | 'peaks', duration?: number) => string | undefined) {
  mediaResolvers.set(projectId, resolve)
  return () => { if (mediaResolvers.get(projectId) === resolve) mediaResolvers.delete(projectId) }
}
export const mediaUrl = (projectId: string, assetId: string, kind: MediaUrlKind = 'proxy') => mediaResolvers.get(projectId)?.(assetId, kind) ?? `/api/editor/projects/${projectId}/media/${assetId}/file?kind=${kind}`
export const audioPeaksUrl = (projectId: string, assetId: string, duration: number) => mediaResolvers.get(projectId)?.(assetId, 'peaks', duration) ?? `/api/editor/projects/${projectId}/media/${assetId}/peaks?duration=${encodeURIComponent(String(duration))}`
export const getAgentSettings = () => fetch('/api/agent-settings').then(r=>json<AgentSettingsView>(r));

export const listProjects=(includeDeleted=false)=>fetch('/api/editor/projects?includeDeleted='+(includeDeleted?'1':'0')).then(r=>json<import('../types').EditProject[]>(r));
export const getProject = (id: string, request: typeof fetch = fetch) => request(`/api/editor/projects/${id}`).then((r) => json<EditProject>(r))
export const createProject = (name: string) => fetch('/api/editor/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then((r) => json<EditProject>(r))
export const duplicateProject = (id: string) => fetch(`/api/editor/projects/${id}/duplicate`, { method: 'POST' }).then((r) => json<EditProject>(r))
export const patchProject = (id: string, patch: Partial<Pick<EditProject, 'name' | 'settings'>>, clientId?: string) => fetch(`/api/editor/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...patch, clientId }) }).then((r) => json<EditProject>(r))
export const deleteProject = async (id: string) => { const r = await fetch(`/api/editor/projects/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error('删除失败') }
export const restoreProject = (id: string) => fetch(`/api/editor/projects/${id}/restore`, { method: 'POST' }).then((r) => json<EditProject>(r))
export const acquireLock = (id: string, clientId: string, takeover = false, request: typeof fetch = fetch) => request(`/api/editor/projects/${id}/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientName: navigator.userAgent.includes('Mac') ? 'Mac 浏览器' : '局域网浏览器', takeover }) }).then((r) => json<{ acquired: boolean; lock: { clientId: string; clientName: string } }>(r))
export const launchOpenScreenHost = (projectId: string, clientId: string) => fetch(`/api/editor/projects/${projectId}/openscreen/host-sessions`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }),
}).then((r) => json<OpenScreenHostSession>(r))
export const getOpenScreenHostSession = (projectId: string, sessionId: string) => fetch(`/api/editor/projects/${projectId}/openscreen/host-sessions/${sessionId}`, { cache: 'no-store' }).then((r) => json<OpenScreenHostSession>(r))
export const confirmOpenScreenHostCandidate = (projectId: string, sessionId: string, file: string, clientId: string) => fetch(`/api/editor/projects/${projectId}/openscreen/host-sessions/${sessionId}/confirm`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, clientId }),
}).then((r) => json<{ session: OpenScreenHostSession; document: OpenScreenDocumentResult }>(r))
export const cancelOpenScreenHostSession = (projectId: string, sessionId: string, clientId: string) => fetch(`/api/editor/projects/${projectId}/openscreen/host-sessions/${sessionId}/cancel`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }),
}).then((r) => json<OpenScreenHostSession>(r))

export type OpenScreenDocumentResult={ref:OpenScreenDocumentRef;document:Record<string,unknown>;revision:number};

export const saveAgentSettings = (settings: import('./agent-settings').AgentSettings) => fetch('/api/editor/agent-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }).then(r => json<import('./agent-settings').AgentSettingsView>(r))

export const refreshAgentCatalog = (cliPath: string) => fetch('/api/editor/agent-settings/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliPath }) }).then(r => json<import('./agent-settings').AgentCatalog>(r))

export const chooseAgentCli = () => fetch('/api/editor/agent-settings/choose-cli', { method: 'POST' }).then(r => json<{ path: string | null }>(r))

export type AgentConnectionResult = { model:string; effort:string; ok:boolean; durationMs:number; checkedAt:string; error?:string }

export const testAgentConnection = (input:{cliPath:string;model:string;effort:string}) => fetch('/api/editor/agent-settings/test', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}).then(r=>json<AgentConnectionResult>(r))

export const purgeProject = (id:string) => fetch(`/api/editor/projects/${id}/purge`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmProjectId:id})}).then(r=>json<void>(r));
