/**
 * 按声音切开 (S先生 10-31, 时间线解锁第二期): a sound-effect strip the agent delivered as one file — 锣、鼓、风 on one
 * track over the whole film — becomes one clip per sound, each playing its own stretch of the same file. The first
 * keeps the clip (and its place in the page); the others are copies of it (hf-timeline.ts clones the element), so
 * the agent's page is never changed and the sound is the same until the person moves one.
 */
import type { Timeline, TimelineClip } from '../types/editor.ts'
import { reanchor } from './hf-anchor.ts'

export type Sound = { start: number; end: number }

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`)
const r3 = (value: number) => Math.round(value * 1000) / 1000

/**
 * Split clip `clipId` at the quiet between its sounds. `sounds` are in seconds of source from the clip's own source
 * start (as `/sounds` returns them). Returns the pieces' ids, first the clip's own; none when there is nothing to split.
 */
export function splitBySound(timeline: Timeline, clipId: string, sounds: Sound[], makeId: () => string = newId): string[] {
  const track = timeline.tracks.find(t => t.clips.some(c => c.id === clipId))
  const clip = track?.clips.find(c => c.id === clipId)
  if (!track || !clip) return []
  const rate = Number(clip.params.speed ?? 1) || 1, span = clip.duration * rate
  const inside = sounds.map(s => ({ start: Math.max(0, s.start), end: Math.min(span, s.end) })).filter(s => s.end - s.start > 0.02)
  if (inside.length < 2) return []
  const base = clip.name || '音效'
  const pieces = inside.map((sound, index) => ({
    ...structuredClone(clip), id: index ? makeId() : clip.id, name: `${base} ${index + 1}`,
    start: r3(clip.start + sound.start / rate), duration: r3((sound.end - sound.start) / rate),
    sourceStart: r3((clip.sourceStart ?? 0) + sound.start), sourceDuration: r3(sound.end - sound.start),
    // a fade belonged to the whole strip, not to each sound
    fadeIn: 0, fadeOut: 0,
    params: { ...clip.params, splitOf: clip.id },
  }))
  track.clips = track.clips.flatMap(c => c.id === clipId ? pieces : [c])
  const ids = pieces.map(p => p.id)
  reanchor(timeline, ids)
  return ids
}

/**
 * 音效一声一段 for a film made before that rule (S先生 10-31: 打开就自动切开): every effect strip longer than `seconds`
 * in which `listen` hears at least `sounds` sounds is split as above. A piece of an earlier split is left alone.
 * Returns how many strips were split.
 */
export async function splitMixedStrips(timeline: Timeline, listen: (clip: TimelineClip) => Promise<Sound[]>, { seconds, sounds }: { seconds: number; sounds: number }) {
  let split = 0
  for (const clip of [...(timeline.tracks.find(t => t.id === 'g-sfx')?.clips ?? [])]) {
    if (clip.params.hf !== true || typeof clip.params.src !== 'string' || clip.params.splitOf || clip.duration <= seconds) continue
    const heard = await listen(clip).catch(() => [] as Sound[])
    if (heard.length >= sounds && splitBySound(timeline, clip.id, heard).length) split++
  }
  return split
}
