import {useRef, useState, type ChangeEvent, type DragEvent} from 'react'
import {Music, Image as ImageIcon, Video, X} from 'lucide-react'
import allowed from '@/standard/styles.json'
import categoryStyles from '@/standard/category-styles.json'
import {DEFAULT_GENERAL_SETTINGS, MEDIA_ACCEPT, mediaKindOf} from './general-logic'
import {FREE_STYLE_ID, type GeneralAgentChoice, type GeneralInputKind} from './general-contract'
import {AgentControls} from './AgentPicker'
import {useGeneralStart} from './general-start'
export {ProStyleDialog as EntranceUpgrade} from '@/standard/ProStyleDialog'
export type Handoff = {text?: string; draft?: never}
export const entranceHasFreeStyle = true
export const entranceCountSuffix = ' · 10 个可用'
export const categoryAllowed = (index: number, id: string) => allowed.includes(id) && ((categoryStyles as Record<string, string[]>)[String(index)] || []).includes(id)
export function EntranceHandoff(_props: {handoff: Handoff; onDrop: () => void}) { return null }
type DraftFile = { key: string; file: File }
/** 不用风格: one box for what to make, the files it may use (picked or dropped in), and 开始. */
export function Composer({ handoff }: { handoff?: Handoff }) {
  const [text, setText] = useState(handoff?.text ?? '')
  const [files, setFiles] = useState<DraftFile[]>([])
  const [agent, setAgent] = useState<GeneralAgentChoice>()
  const [network, setNetwork] = useState(false)
  const [over, setOver] = useState(false)
  const [skipped, setSkipped] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const { busy, busyLabel, error, start } = useGeneralStart()
  const pick = (accept: string) => { if (picker.current) { picker.current.accept = accept; picker.current.click() } }
  const addFiles = (list: File[]) => {
    const usable = list.filter(file => mediaKindOf(file)), rest = list.filter(file => !mediaKindOf(file))
    setSkipped(rest.length ? `只能放视频、图片和音乐，${rest.map(file => `「${file.name}」`).join('')}没放进来` : '')
    if (usable.length) setFiles(current => [...current, ...usable.map(file => ({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file }))])
  }
  const add = (event: ChangeEvent<HTMLInputElement>) => { addFiles([...(event.target.files ?? [])]); event.target.value = '' }
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  const ready = text.trim().length > 0 || files.length > 0
  const go = () => {
    if (!ready || busy) return
    // with files the film is cut from them and the words are the brief; without, the words are the script
    // (a 定稿 brought from 文案发布 stays the words even with files: it is what the film follows)
    const kind: GeneralInputKind = files.length ? 'footage' : 'topic'
    const words = kind === 'topic' || !!handoff
    void start({ styleId: FREE_STYLE_ID, kind, text: words ? text : '', note: words ? '' : text.trim(), settings: DEFAULT_GENERAL_SETTINGS, files, agent, network, fromDraft: handoff?.draft })
  }
  return <div className="ge-en-compose" data-over={over || undefined}
    onDragOver={event => { if (busy || !hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setOver(true) }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false) }}
    onDrop={event => { if (!hasFiles(event)) return; event.preventDefault(); setOver(false); if (!busy) addFiles([...event.dataTransfer.files]) }}>
    <textarea value={text} disabled={!!busy} aria-label="想做一条什么样的片子" autoFocus
      placeholder="想做一条什么样的片子？素材可以直接拖进来。比如：用这几段旅行视频，剪一条 30 秒的 vlog，节奏跟着音乐走……" onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) go() }} />
    {files.length > 0 && <ul className="ge-en-files">{files.map(f => <li key={f.key} title={f.file.name}><span>{f.file.name}</span>
      <button type="button" aria-label={`移除 ${f.file.name}`} disabled={!!busy} onClick={() => setFiles(current => current.filter(x => x.key !== f.key))}><X size={11} aria-hidden /></button></li>)}</ul>}
    <div className="ge-en-row">
      <button type="button" disabled={!!busy} onClick={() => pick(MEDIA_ACCEPT.video)}><Video size={14} aria-hidden />视频</button>
      <button type="button" disabled={!!busy} onClick={() => pick(MEDIA_ACCEPT.image)}><ImageIcon size={14} aria-hidden />图片 / 资料</button>
      <button type="button" disabled={!!busy} onClick={() => pick(MEDIA_ACCEPT.audio)}><Music size={14} aria-hidden />音乐</button>
      <span className="ge-en-tools"><AgentControls compact agent={agent} onAgent={setAgent} network={network} onNetwork={setNetwork} disabled={!!busy} /></span>
      <button type="button" className="ge-en-go" disabled={!ready && !busy} aria-busy={!!busy} onClick={go}>{busy ? busyLabel : error ? '再试一次' : '开始'}</button>
    </div>
    <input ref={picker} type="file" multiple hidden onChange={add} />
    {error ? <p className="ge-en-error" role="alert">{error}</p> : skipped ? <p className="ge-en-error" role="status">{skipped}</p> : <small>不套风格库，画面、字体、配色、节奏都按你的话来定</small>}
  </div>
}
