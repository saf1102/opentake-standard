import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { STUDIO_MEDIA_DRAG_TYPE } from '@/studio/media-drag'
import type { GeneralMedia } from './general-contract'
import { COMPOSER_SKILLS, REF_DRAG_TYPE, TOKEN_PATTERN, getGeneralPlayhead, mediaToken, skillToken, timeToken, tokenLabel } from './composer-tokens'
import { clockTime } from './general-logic'
import './ref-composer.css'

/** What the page drives on the composer: the same two calls a textarea answers. Offsets count a tag as its token. */
export type ComposerHandle = { focus: () => void; setSelectionRange: (start: number, end: number) => void }

type Section = '素材' | '片段时刻' | '技能'
type MenuItem = { key: string; section: Section; token: string; mark?: string; poster?: string; name: string; hint?: string }
type Menu = { node: Text; start: number; end: number; query: string; x: number; y: number; active: number }

const PILL = /^⟦([mts]):([^⟧]+)⟧$/

function pill(token: string, media: GeneralMedia[]) {
  const [, kind = 's', value = ''] = PILL.exec(token) ?? []
  const label = tokenLabel(kind, value, media)
  const element = document.createElement('span')
  element.className = 'ge-pill'
  element.contentEditable = 'false'
  element.draggable = true
  element.dataset.token = token
  element.dataset.kind = kind
  if (kind === 'm' && !label.mark) {
    const thumb = document.createElement('i')
    if (label.poster) thumb.style.backgroundImage = `url("${label.poster}")`
    element.append(thumb)
  } else {
    const mark = document.createElement('b')
    mark.textContent = label.mark ?? ''
    element.append(mark)
  }
  element.append(label.name)
  return element
}

function draw(root: HTMLElement, value: string, media: GeneralMedia[]) {
  root.replaceChildren()
  let last = 0
  for (const match of value.matchAll(TOKEN_PATTERN)) {
    if (match.index > last) root.append(document.createTextNode(value.slice(last, match.index)))
    root.append(pill(match[0], media))
    last = match.index + match[0].length
  }
  if (last < value.length) root.append(document.createTextNode(value.slice(last)))
}

const lengthOf = (node: Node): number => node.nodeType === Node.TEXT_NODE ? (node as Text).data.length
  : node instanceof HTMLElement ? node.dataset.skip !== undefined ? 0 : node.dataset.token ? node.dataset.token.length : node.tagName === 'BR' ? 1 : serialize(node).length : 0

function serialize(root: Node): string {
  let out = ''
  root.childNodes.forEach((node, index) => {
    if (node.nodeType === Node.TEXT_NODE) out += (node as Text).data
    else if (node instanceof HTMLElement && node.dataset.skip === undefined) {
      if (node.dataset.token) out += node.dataset.token
      else if (node.tagName === 'BR') out += '\n'
      else { if (node.tagName === 'DIV' && index > 0 && !out.endsWith('\n')) out += '\n'; out += serialize(node) }
    }
  })
  return out
}

/** The DOM spot for a draft offset; inside a tag it lands just after it. */
function locate(root: HTMLElement, offset: number): [Node, number] {
  let left = Math.max(0, offset)
  const children = Array.from(root.childNodes)
  for (let index = 0; index < children.length; index++) {
    const node = children[index], length = lengthOf(node)
    if (node.nodeType === Node.TEXT_NODE && left <= length) return [node, left]
    if (left < length) return [root, index + 1]
    left -= length
  }
  return [root, children.length]
}

const caretBox = (range: Range) => {
  const box = range.getClientRects()[0] ?? range.getBoundingClientRect()
  return { x: box.left, y: box.top, h: Math.max(14, box.height) }
}

/**
 * The agent composer with tags in the sentence (S先生 10-31): @ opens one menu — 素材, 片段时刻, 技能 — and the pick
 * becomes a tag where the @ was. Tags drag to any spot in the sentence (a purple line shows where); files and library
 * media dropped in land at the drop point too.
 */
export function RefComposer({ value, onChange, onEnter, placeholder, label, media, upload, handle }: {
  value: string; onChange: (value: string) => void; onEnter: () => void; placeholder: string; label: string
  media: GeneralMedia[]; upload: (file: File) => Promise<GeneralMedia>; handle?: (handle: ComposerHandle | null) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [uploaded, setUploaded] = useState<GeneralMedia[]>([])
  const all = useMemo(() => [...media, ...uploaded.filter(item => !media.some(m => m.id === item.id))], [media, uploaded])
  const [menu, setMenu] = useState<Menu | null>(null)
  const [drop, setDrop] = useState<{ x: number; y: number; h: number } | null>(null)
  const dragged = useRef<HTMLElement | null>(null)
  // the menu and drop line float in the page's .ge root, where the theme's colours are defined
  const [host, setHost] = useState<HTMLElement>()
  useLayoutEffect(() => setHost((root.current?.closest('.ge') as HTMLElement | null) ?? document.body), [])
  const emit = () => { if (root.current) onChange(serialize(root.current)) }

  // Draw again only when the draft changed from outside (a prefill, the box cleared after sending).
  useLayoutEffect(() => { const element = root.current; if (element && serialize(element) !== value) draw(element, value, all) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  // Media that arrived late gets its name and picture on the tags already there.
  useEffect(() => {
    root.current?.querySelectorAll<HTMLElement>('.ge-pill[data-kind="m"]').forEach(element => element.replaceWith(pill(element.dataset.token!, all)))
  }, [all])

  useEffect(() => {
    handle?.({
      focus: () => root.current?.focus(),
      setSelectionRange: (start, end) => {
        const element = root.current
        if (!element) return
        element.focus()
        const range = document.createRange()
        range.setStart(...locate(element, start))
        range.setEnd(...locate(element, end))
        const selection = getSelection()
        selection?.removeAllRanges(); selection?.addRange(range)
      },
    })
    return () => handle?.(null)
  }, [handle])

  const placeCaretAfter = (node: Node) => {
    const range = document.createRange()
    range.setStartAfter(node); range.collapse(true)
    const selection = getSelection()
    selection?.removeAllRanges(); selection?.addRange(range)
  }
  /** Put a tag at `range`, with a space after it unless one follows already; the caret goes after. */
  const insertTag = (range: Range, token: string, known = all) => {
    const tag = pill(token, known)
    const next = range.endContainer.nodeType === Node.TEXT_NODE ? (range.endContainer as Text).data.slice(range.endOffset, range.endOffset + 1) : ''
    const space = /\s/.test(next) ? undefined : document.createTextNode(' ')
    if (space) range.insertNode(space)
    range.insertNode(tag)
    placeCaretAfter(space ?? tag)
    return tag
  }

  // the @ menu: open while the text just before the caret is @ and a few letters
  const checkMenu = () => {
    const selection = getSelection(), node = selection?.anchorNode
    if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !root.current?.contains(node)) { setMenu(null); return }
    const before = (node as Text).data.slice(0, selection.anchorOffset)
    const match = /@([^\s@⟦⟧]{0,24})$/.exec(before)
    if (!match) { setMenu(null); return }
    const start = before.length - match[0].length
    const at = document.createRange()
    at.setStart(node, start); at.setEnd(node, start + 1)
    const box = at.getBoundingClientRect()
    setMenu(current => ({ node: node as Text, start, end: selection.anchorOffset, query: match[1], x: box.left, y: box.top, active: current?.query === match[1] ? current.active : 0 }))
  }
  const items = useMemo(() => {
    if (!menu) return []
    const query = menu.query.toLowerCase(), fits = (text: string) => !query || text.toLowerCase().includes(query)
    const list: MenuItem[] = []
    for (const item of all) if (fits(item.name)) {
      const audio = !item.width && !item.height
      list.push({ key: `m-${item.id}`, section: '素材', token: mediaToken(item.id), mark: audio ? '♪' : undefined, poster: audio ? undefined : item.poster ?? '', name: item.name, hint: item.duration > 0 ? clockTime(item.duration) : undefined })
    }
    const playhead = getGeneralPlayhead()
    if (playhead !== undefined && fits('当前播放头时刻')) list.push({ key: 't', section: '片段时刻', token: timeToken(playhead), mark: '⏱', name: `当前播放头 ${clockTime(playhead)}` })
    for (const skill of COMPOSER_SKILLS) if (fits(skill.label + skill.hint)) list.push({ key: `s-${skill.id}`, section: '技能', token: skillToken(skill.id), mark: '✦', name: skill.label, hint: skill.hint })
    return list
  }, [menu, all])
  const choose = (item: MenuItem) => {
    if (!menu) return
    const range = document.createRange()
    range.setStart(menu.node, Math.min(menu.start, menu.node.data.length))
    range.setEnd(menu.node, Math.min(menu.end, menu.node.data.length))
    range.deleteContents()
    insertTag(range, item.token)
    setMenu(null)
    emit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const composing = event.nativeEvent.isComposing
    if (menu && items.length && !composing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setMenu({ ...menu, active: (menu.active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length })
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); choose(items[Math.min(menu.active, items.length - 1)]); return }
    }
    if (menu && event.key === 'Escape') { event.preventDefault(); setMenu(null); return }
    if (event.key === 'Enter' && !composing) {
      event.preventDefault()
      if (event.shiftKey) { document.execCommand('insertLineBreak'); emit() } else onEnter()
    }
  }
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
  }

  const pointRange = (x: number, y: number) => {
    const range = document.caretRangeFromPoint?.(x, y)
    return range && root.current?.contains(range.startContainer) ? range : undefined
  }
  const endRange = () => { const range = document.createRange(); range.selectNodeContents(root.current!); range.collapse(false); return range }
  const accepts = (event: DragEvent) => ['Files', REF_DRAG_TYPE, STUDIO_MEDIA_DRAG_TYPE].some(type => event.dataTransfer.types.includes(type))
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!accepts(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = dragged.current ? 'move' : 'copy'
    const range = pointRange(event.clientX, event.clientY)
    setDrop(range ? caretBox(range) : null)
  }
  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!accepts(event)) return
    event.preventDefault(); event.stopPropagation()
    setDrop(null)
    root.current?.focus()
    const range = pointRange(event.clientX, event.clientY) ?? endRange()
    const token = event.dataTransfer.getData(REF_DRAG_TYPE) || (event.dataTransfer.getData(STUDIO_MEDIA_DRAG_TYPE) ? mediaToken(event.dataTransfer.getData(STUDIO_MEDIA_DRAG_TYPE)) : '')
    if (token) {
      const source = dragged.current
      insertTag(range, token)
      if (source && root.current?.contains(source)) source.remove()
      dragged.current = null
      emit()
      return
    }
    // files from the Finder: into the project's 素材 first, then a tag at the drop point
    for (const file of Array.from(event.dataTransfer.files)) {
      const waiting = document.createElement('span')
      waiting.className = 'ge-pill is-waiting'; waiting.contentEditable = 'false'; waiting.dataset.skip = ''
      waiting.textContent = `正在导入 ${file.name}`
      range.insertNode(waiting); range.setStartAfter(waiting); range.collapse(true)
      try {
        const item = await upload(file)
        setUploaded(list => [...list, item])
        const at = document.createRange(); at.setStartBefore(waiting); at.collapse(true)
        insertTag(at, mediaToken(item.id), [...all, item])
      } catch (failure) {
        toast.error(`「${file.name}」没导入成功：${failure instanceof Error ? failure.message : String(failure)}`)
      }
      waiting.remove()
      emit()
    }
  }

  const sections: Section[] = ['素材', '片段时刻', '技能']
  return <>
    <div ref={root} className="ge-rc" contentEditable="true" suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label}
      data-placeholder={placeholder} data-empty={value ? undefined : ''}
      onInput={() => { emit(); checkMenu() }} onKeyUp={event => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) checkMenu() }}
      onClick={checkMenu} onBlur={() => setMenu(null)} onKeyDown={onKeyDown} onPaste={onPaste}
      onDragStart={event => {
        const tag = (event.target as HTMLElement).closest?.('.ge-pill') as HTMLElement | null
        if (!tag?.dataset.token) return
        dragged.current = tag
        event.dataTransfer.setData(REF_DRAG_TYPE, tag.dataset.token)
        event.dataTransfer.effectAllowed = 'copyMove'
      }}
      onDragEnd={() => { dragged.current = null; setDrop(null) }}
      onDragOver={onDragOver} onDragLeave={event => { if (!root.current?.contains(event.relatedTarget as Node)) setDrop(null) }} onDrop={event => void onDrop(event)} />
    {drop && createPortal(<span className="ge-rc-drop" style={{ left: drop.x - 1, top: drop.y, height: drop.h }} aria-hidden="true" />, host ?? document.body)}
    {menu && items.length > 0 && createPortal(<div className="ge-at" role="listbox" aria-label="引用" style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 268)), bottom: window.innerHeight - menu.y + 6 }}>
      {sections.map(section => {
        const rows = items.filter(item => item.section === section)
        return rows.length ? <div key={section}>
          <h5>{section}</h5>
          {rows.map(item => {
            const index = items.indexOf(item)
            return <div key={item.key} role="option" aria-selected={index === menu.active} className={index === menu.active ? 'on' : undefined}
              ref={element => { if (element && index === menu.active) element.scrollIntoView({ block: 'nearest' }) }}
              onMouseDown={event => { event.preventDefault(); choose(item) }} onMouseEnter={() => setMenu({ ...menu, active: index })}>
              <span>{item.poster !== undefined ? <i style={item.poster ? { backgroundImage: `url("${item.poster}")` } : undefined} /> : <b>{item.mark}</b>}{item.name}</span>
              {item.hint && <small>{item.hint}</small>}
            </div>
          })}
        </div> : null
      })}
    </div>, host ?? document.body)}
  </>
}
