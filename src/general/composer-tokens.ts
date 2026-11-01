import type { GeneralMedia } from './general-contract.ts'
import { clockTime } from './general-logic.ts'

/**
 * References in the agent composer (S先生 10-31): @ puts a 素材, a 片段时刻 or a 技能 into the sentence as a tag.
 * In the draft each tag is a token — ⟦m:素材 id⟧, ⟦t:秒⟧, ⟦s:技能 id⟧ — and on send it becomes words the agent reads
 * where it stands in the sentence.
 */
export const TOKEN_PATTERN = /⟦([mts]):([^⟧]+)⟧/g
export const REF_DRAG_TYPE = 'application/x-opentake-ref'

export type ComposerSkill = { id: string; label: string; hint: string; instruction: string }
export const COMPOSER_SKILLS: ComposerSkill[] = [
  { id: 'intro3', label: '片头三段式', hint: '开头 3 秒抓人', instruction: '开头 3 秒分三拍：一个抓眼的画面或问题、一句点题、一个转折引到正片，节奏要快' },
  { id: 'beat', label: '卡点剪辑', hint: '跟着鼓点切', instruction: '先找出配乐的鼓点和重拍，画面切换和主要动作都落在拍子上' },
  { id: 'tighten', label: '收紧节奏', hint: '去掉拖沓', instruction: '去掉停顿和重复，单个镜头一般不超过 3 秒，内容顺序不变' },
  { id: 'captions', label: '统一字幕', hint: '字号位置一致', instruction: '全片字幕的字号、位置和样式统一，长句拆短，不挡住画面主体' },
  { id: 'voice-first', label: '人声优先', hint: '配乐让路', instruction: '有人声的地方配乐压低、人声清楚，段落之间配乐再起来' },
  { id: 'outro', label: '片尾收束', hint: '总结加下一步', instruction: '结尾一句话总结要点，再给一个明确的下一步，画面收干净' },
]

export const mediaToken = (id: string) => `⟦m:${id}⟧`
export const timeToken = (seconds: number) => `⟦t:${Math.max(0, Math.round(seconds * 10) / 10)}⟧`
export const skillToken = (id: string) => `⟦s:${id}⟧`

const isAudio = (media: GeneralMedia) => !media.width && !media.height

/** What a tag shows: a mark and a short name. */
export function tokenLabel(kind: string, value: string, media: GeneralMedia[]) {
  if (kind === 'm') { const item = media.find(m => m.id === value); return { mark: item && isAudio(item) ? '♪' : '', name: item?.name ?? '素材', poster: item?.poster } }
  if (kind === 't') return { mark: '⏱', name: clockTime(Number(value)) }
  const skill = COMPOSER_SKILLS.find(s => s.id === value)
  return { mark: '✦', name: skill?.label ?? value }
}

/** The draft as the agent reads it: every tag written out in place. */
export function expandTokens(text: string, media: GeneralMedia[]) {
  return text.replace(TOKEN_PATTERN, (whole, kind: string, value: string) => {
    if (kind === 'm') {
      const item = media.find(m => m.id === value)
      return item ? `素材「${item.name}」（media/${item.file ?? item.id}）` : whole
    }
    if (kind === 't') return `片中 ${clockTime(Number(value))}（第 ${Number(value).toFixed(1)} 秒）`
    const skill = COMPOSER_SKILLS.find(s => s.id === value)
    return skill ? `「${skill.label}」的做法（${skill.instruction}）` : whole
  })
}

/** The playhead of whichever player is on screen, for 「当前播放头」 in the @ menu. */
let playhead: number | undefined
export const setGeneralPlayhead = (seconds: number) => { playhead = seconds }
export const getGeneralPlayhead = () => playhead
