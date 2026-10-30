import {editionClient} from './client-edition'
import type {ExportSettings,ExportCapabilities} from '../types/editor';
import type {EnvironmentCheck} from '../../shared/creation-tools'
/**
 * 通用剪辑: the pages' side of src/general/general-contract.ts. Every call goes to /api/general as the contract lists.
 * In the development server only, a demo switch (localStorage 'opentake-general-demo' = '1', or ?demo=1 once) swaps
 * in in-memory sample projects so the pages can be looked at before the server exists; it is not part of a build.
 */
import { GENERAL_API, type GeneralAgentChoice, type GeneralMedia, type GeneralProject, type GeneralProjectSummary, type GeneralReference, type GeneralSettings, type GeneralInputKind, type GeneralLayers, type GeneralExport } from './general-contract'

export type GeneralCreateInput = { styleId: string; settings: GeneralSettings; inputs: { kind: GeneralInputKind; text: string; note: string }; agent?: GeneralAgentChoice; network?: boolean }
/** agent: null goes back to 系统默认 */
export type GeneralPatch = { name?: string; settings?: GeneralSettings; inputs?: { text?: string; note?: string }; agent?: GeneralAgentChoice | null; network?: boolean }

export type GeneralClient = {
  list(): Promise<GeneralProjectSummary[]>
  get(id: string): Promise<GeneralProject>
  create(input: GeneralCreateInput): Promise<GeneralProject>
  patch(id: string, patch: GeneralPatch): Promise<GeneralProject>
  remove(id: string): Promise<void>
  upload(id: string, file: File, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<GeneralMedia>
  removeMedia(id: string, mediaId: string): Promise<GeneralProject>
  generate(id: string): Promise<GeneralProject>
  stop(id: string): Promise<GeneralProject>
  resume(id: string): Promise<GeneralProject>
  send(id: string, text: string, reference?: GeneralReference): Promise<GeneralProject>
  network(id: string, allow: boolean): Promise<GeneralProject>
  /** Live project updates. `onState` reports the connection: 'open', or 'retrying' while it reconnects. */
  subscribe(id: string, onProject: (project: GeneralProject) => void, onState: (state: 'open' | 'retrying') => void): () => void
}

/** A failed call, with the HTTP status when there was one (404 = no such project, 0 = no answer). */
export class GeneralApiError extends Error {
  readonly status: number
  readonly environment?: EnvironmentCheck
  constructor(message: string, status: number, environment?:EnvironmentCheck) { super(message); this.name = 'GeneralApiError'; this.status = status; this.environment=environment }
}

/** The other API routes answer {ok, result, error}; the contract names the payload. Accept both. */
function unwrap<T>(data: unknown, status: number, ok: boolean): T {
  if (data && typeof data === 'object' && 'ok' in data) {
    const envelope = data as { ok: boolean; result?: T; error?: string; environment?: EnvironmentCheck }
    if (!ok || !envelope.ok) throw new GeneralApiError(envelope.error || `请求失败（${status}）`, status, envelope.environment)
    return envelope.result as T
  }
  if (!ok) {
    const error = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : ''
    throw new GeneralApiError(error || `请求失败（${status}）`, status)
  }
  return data as T
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(`${GENERAL_API}${path}`, { cache: 'no-store', ...init }) }
  catch { throw new GeneralApiError('连不上本机服务', 0) }
  const type = response.headers.get('content-type') || ''
  if (!type.includes('json')) {
    // The development server answers unknown routes with the app page; that means the API is not there yet.
    if (response.ok && type.includes('html')) throw new GeneralApiError('通用剪辑的服务还没就绪', 404)
    if (!response.ok) throw new GeneralApiError(response.status === 404 ? '找不到' : `请求失败（${response.status}）`, response.status)
    return undefined as T
  }
  return unwrap<T>(await response.json(), response.status, response.ok)
}

const post = <T>(path: string, body?: unknown) => call<T>(path, {
  method: 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
})
const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`

const httpClient: GeneralClient = {
  list: () => call<GeneralProjectSummary[]>('/projects').then(list => (Array.isArray(list) ? list : [])),
  get: id => call<GeneralProject>(projectPath(id)),
  create: input => post<GeneralProject>('/projects', input),
  patch: (id, patch) => call<GeneralProject>(projectPath(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }),
  remove: id => call<unknown>(projectPath(id), { method: 'DELETE' }).then(() => undefined),
  upload: (id, file, onProgress, signal) => new Promise<GeneralMedia>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${GENERAL_API}${projectPath(id)}/media`)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
    const abort = () => xhr.abort()
    signal?.addEventListener('abort', abort, { once: true })
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total) }
    xhr.onabort = () => reject(new DOMException('已取消', 'AbortError'))
    xhr.onerror = () => reject(new GeneralApiError('上传失败，连不上本机服务', 0))
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort)
      try { resolve(unwrap<GeneralMedia>(JSON.parse(xhr.responseText || 'null'), xhr.status, xhr.status >= 200 && xhr.status < 300)) }
      catch (error) { reject(error instanceof GeneralApiError ? error : new GeneralApiError(`上传失败（${xhr.status}）`, xhr.status)) }
    }
    xhr.send(file)
  }),
  removeMedia: (id, mediaId) => call<GeneralProject>(`${projectPath(id)}/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' }),
  generate: id => post<GeneralProject>(`${projectPath(id)}/generate`),
  stop: id => post<GeneralProject>(`${projectPath(id)}/stop`),
  resume: id => post<GeneralProject>(`${projectPath(id)}/resume`),
  send: (id, text, reference) => post<GeneralProject>(`${projectPath(id)}/messages`, reference ? { text, reference } : { text }),
  network: (id, allow) => post<GeneralProject>(`${projectPath(id)}/network`, { allow }),
  subscribe: (id, onProject, onState) => {
    let source: EventSource | undefined
    let timer = 0, attempt = 0, closed = false
    const connect = () => {
      if (closed) return
      source = new EventSource(`${GENERAL_API}${projectPath(id)}/events`)
      source.onopen = () => { attempt = 0; onState('open') }
      source.onmessage = event => {
        try {
          const data = JSON.parse(event.data) as unknown
          const project = data && typeof data === 'object' && 'ok' in data ? (data as { result?: GeneralProject }).result : data as GeneralProject
          if (project && typeof project === 'object' && 'id' in project) onProject(project)
        } catch { /* a malformed event is skipped; the next one carries the full project again */ }
      }
      source.onerror = () => {
        onState('retrying')
        // The browser retries a dropped stream by itself; a refused one (closed) is retried here, backing off to 15 s.
        if (source?.readyState !== EventSource.CLOSED) return
        source.close()
        window.clearTimeout(timer)
        timer = window.setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++))
      }
    }
    const now = () => { if (source?.readyState === EventSource.CLOSED) { window.clearTimeout(timer); attempt = 0; connect() } }
    window.addEventListener('online', now)
    connect()
    return () => { closed = true; window.clearTimeout(timer); window.removeEventListener('online', now); source?.close() }
  },
}

function client(){return editionClient(httpClient)}

export const generalApi = {
  list: () => client().then(c => c.list()),
  get: (id: string) => client().then(c => c.get(id)),
  create: (input: GeneralCreateInput) => client().then(c => c.create(input)),
  patch: (id: string, patch: GeneralPatch) => client().then(c => c.patch(id, patch)),
  remove: (id: string) => client().then(c => c.remove(id)),
  upload: (id: string, file: File, onProgress?: (ratio: number) => void, signal?: AbortSignal) => client().then(c => c.upload(id, file, onProgress, signal)),
  removeMedia: (id: string, mediaId: string) => client().then(c => c.removeMedia(id, mediaId)),
  generate: (id: string) => client().then(c => c.generate(id)),
  stop: (id: string) => client().then(c => c.stop(id)),
  resume: (id: string) => client().then(c => c.resume(id)),
  send: (id: string, text: string, reference?: GeneralReference) => client().then(c => c.send(id, text, reference)),
  network: (id: string, allow: boolean) => client().then(c => c.network(id, allow)),
  subscribe(id: string, onProject: (project: GeneralProject) => void, onState: (state: 'open' | 'retrying') => void) {
    let stop: (() => void) | undefined, cancelled = false
    void client().then(c => { if (!cancelled) stop = c.subscribe(id, onProject, onState) })
    return () => { cancelled = true; stop?.() }
  },
}

/** Tell the library views (home, 剪辑台) and the run watcher that general projects changed. */
export function announceGeneralChange() {
  window.dispatchEvent(new Event('workspace-projects-changed'))
  window.dispatchEvent(new Event('general-runs-changed'))
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The layered editor (a version with tracks): page host, the style's text presets, the tracks and the person's edits. */
/** fonts: the faces the presets name that this machine has; url is a path on the version's page host (/_fonts/…). */
export type TextPresets = { presets: Record<string, Record<string, unknown>>; all?: Record<string, Record<string, unknown>>; finishes: string[]; fonts: { family: string; url: string; style: string; weight: string }[] }
let hostPort: Promise<number> | undefined
export const generalEditorApi = {
  pageHostPort: () => (hostPort ??= call<{ port: number }>('/page-host').then(r => r.port, error => { hostPort = undefined; throw error })),
  textPresets: (id: string) => call<TextPresets>(`${projectPath(id)}/text-presets`),
  /** The agent's tracks (layers.json), or the person's edits of them (edited.json) when there are any. */
  async layers(id: string, n: number, layersUrl: string): Promise<{ layers: GeneralLayers; edited: boolean }> {
    const edited = await fetch(`${GENERAL_API}${projectPath(id)}/files/versions/v${n}/edited.json`, { cache: 'no-store' })
    if (edited.ok) return { layers: await edited.json() as GeneralLayers, edited: true }
    const original = await fetch(layersUrl, { cache: 'no-store' })
    if (!original.ok) throw new GeneralApiError(`这一版的分轨读不到（${original.status}）`, original.status)
    return { layers: await original.json() as GeneralLayers, edited: false }
  },
  saveEdited: (id: string, n: number, layers: GeneralLayers) => call<{ saved: boolean; at: string }>(`${projectPath(id)}/versions/${n}/edited`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(layers) }),
  /** Export version n with the person's edits (edited.json, else the agent's layers): a finished film or a 剪映 draft. Progress arrives as project.exportTask. */
  export: (id: string, n: number, format: 'mp4' | 'jianying', settings?:ExportSettings) => call<GeneralExport>(`${projectPath(id)}/versions/${n}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, settings }) }),
  exportCapabilities: (id:string,n:number) => call<ExportCapabilities & {canvas:{width:number;height:number;fps:number}}>(`${projectPath(id)}/exports/capabilities?version=${n}`),
  exportHistory: (id:string) => call<GeneralExport[]>(`${projectPath(id)}/exports/history`),
  cancelExport: (id:string) => post<GeneralExport>(`${projectPath(id)}/exports/cancel`,{}),
  chooseExportDestination: (id:string) => post<{path:string}>(`${projectPath(id)}/exports/destination`,{}).then(r=>r.path),
  revealExport: (id: string, jobId?:string) => call<{ revealed: boolean }>(`${projectPath(id)}/exports/reveal`, { method: 'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:jobId}) }),
  fileUrl: (id: string, rel: string) => `${GENERAL_API}${projectPath(id)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`,
}
