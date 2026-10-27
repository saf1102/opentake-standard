import standardStyles from '../../standard/styles.json' with {type:'json'};
/** 风格库: the general-editing styles, their three kinds and the browsing logic. Pure functions only (no React, no JSON import),
 *  so the unit tests and the generator script can load this file directly. The list itself is style-library.json,
 *  written by scripts/build-style-library.ts from the template pack's catalog. */
import { GENERAL_EDIT_PATH } from '../modules.ts'

/** What the user has to bring: footage = their own video, topic = a script or a subject, material = real data or scans. */
export type StyleInputType = 'footage' | 'topic' | 'material'
export type StyleFilter = 'all' | StyleInputType

export type LibraryStyle = {
  readonly id: string
  readonly name_zh: string
  readonly description_zh: string
  readonly category_zh: string
  readonly input_type: StyleInputType
  readonly user_provides: { readonly summary_zh: string; readonly own_video: string; readonly script_or_topic: string; readonly voice_over: string }
  /** What the style suits, in Chinese (translated by the generator). */
  readonly uses: readonly string[]
  /** The style's own CC BY credit, as the catalog states it (English, legal wording kept). */
  readonly attribution: string
  readonly third_party_in_preview: readonly string[]
  /** Public paths of the 6-second silent preview and its poster, both under /styles/. */
  readonly preview: string
  readonly poster: string
}

/** Easiest first: upload a video, give a script, prepare data. */
export const STYLE_INPUT_TYPES: readonly StyleInputType[] = ['footage', 'topic', 'material']

/** The kinds a new general project can start from in the first release; 要准备数据 shows 即将支持 and cannot be picked. */
export const PICKABLE_INPUT_TYPES: readonly StyleInputType[] = ['footage', 'topic']
export const SOON_LABEL = 'Pro'
export function isPickableStyle(style: Pick<LibraryStyle, 'id'>) {
  return standardStyles.includes(style.id)
}

export const STYLE_INPUT_COPY: Readonly<Record<StyleInputType, { readonly label: string; readonly gives: string }>> = {
  footage: { label: '上传视频就能做', gives: '你给自己拍的视频或照片，Agent 照这个风格剪' },
  topic: { label: '给文案就能做', gives: '你给一段文案或一个题目，画面全由 Agent 画出来' },
  material: { label: '要准备数据', gives: '你给数据表、扫描件、卫星图或工程文件，不能凭空编' },
}

/** The page-wide credit; each style's own credit is in its detail. */
export const STYLE_CREDIT_LINE = '风格样片 © LemoLab，CC BY 4.0，已裁剪为预览'

const THIRD_PARTY_SENTENCE = /\s*Third-party material in this excerpt:[\s\S]*$/

/** The style's own credit without its trailing third-party sentence; the detail lists those items separately. */
export function styleCredit(attribution: string) {
  return attribution.replace(THIRD_PARTY_SENTENCE, '').trim()
}

/** Lower-case words of a search; every word has to match somewhere in the style. */
export function searchWords(query: string) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function searchText(style: LibraryStyle) {
  return [style.id, style.name_zh, style.description_zh, style.category_zh, style.user_provides.summary_zh, ...style.uses].join('\n').toLowerCase()
}

export function matchesSearch(style: LibraryStyle, query: string) {
  const words = searchWords(query)
  if (!words.length) return true
  const text = searchText(style)
  return words.every(word => text.includes(word))
}

/** The styles one filter tab shows, in list order. */
export function filterStyles(styles: readonly LibraryStyle[], filter: StyleFilter, query: string) {
  return styles.filter(style => (filter === 'all' || style.input_type === filter) && matchesSearch(style, query))
}

/** The count on each filter tab follows the search. */
export function countStyles(styles: readonly LibraryStyle[], query: string): Record<StyleFilter, number> {
  const counts: Record<StyleFilter, number> = { all: 0, footage: 0, topic: 0, material: 0 }
  for (const style of styles) {
    if (!matchesSearch(style, query)) continue
    counts.all++
    counts[style.input_type]++
  }
  return counts
}

/** Sections easiest first; each keeps the list order inside it, and empty sections are left out. */
export function groupStyles(styles: readonly LibraryStyle[]) {
  return STYLE_INPUT_TYPES
    .map(type => ({ type, styles: styles.filter(style => style.input_type === type) }))
    .filter(group => group.styles.length > 0)
}

/** Reading order across the sections, which 上一个 / 下一个 walk through. */
export function readingOrder(styles: readonly LibraryStyle[]) {
  return groupStyles(styles).flatMap(group => group.styles)
}

/** The neighbour in reading order; none past either end. */
export function neighbourStyle(styles: readonly LibraryStyle[], id: string, direction: 'previous' | 'next') {
  const order = readingOrder(styles)
  const index = order.findIndex(style => style.id === id)
  if (index < 0) return undefined
  return order[direction === 'previous' ? index - 1 : index + 1]
}

/** Index of the last card in the row that holds `index`; the detail opens right after it. */
export function rowEndIndex(index: number, columns: number, total: number) {
  if (total <= 0 || index < 0) return -1
  const perRow = Math.max(1, Math.floor(columns))
  return Math.min(total - 1, Math.floor(index / perRow) * perRow + perRow - 1)
}

/** Where 用这个风格新建通用工程 goes in browse mode. */
export function generalEditHref(id: string) {
  return `${GENERAL_EDIT_PATH}?style=${encodeURIComponent(id)}`
}

export function styleById(styles: readonly LibraryStyle[], id: string | null | undefined) {
  return id ? styles.find(style => style.id === id) : undefined
}
