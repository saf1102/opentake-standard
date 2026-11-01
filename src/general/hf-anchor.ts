/**
 * Narration and sound effects belong to a scene (S先生 10-31, 时间线解锁第二期): moving a picture moves what is heard
 * with it, as a 口播 card carries its own things. A sound belongs to the scene it starts in, or the one its
 * data-ot-scene names; it is kept as params.anchor (the scene clip's id) so it stays with that scene after edits.
 */
import type { Timeline, TimelineClip } from '../types/editor.ts'

/** The tracks whose clips follow a scene, and the tracks a scene comes from (cards first, then footage). */
export const FOLLOWING_TRACKS = ['g-voice', 'g-sfx'] as const
const SCENE_TRACKS = ['g-page', 'g-footage'] as const

/** The scene clip playing at second `t`: the card that starts last at or before it, else the footage. */
export function sceneAt(timeline: Timeline, t: number): TimelineClip | undefined {
  for (const id of SCENE_TRACKS) {
    const hit = timeline.tracks.find(track => track.id === id)?.clips
      .filter(c => c.start <= t + 1e-3 && t < c.start + c.duration - 1e-3)
      .sort((a, b) => b.start - a.start)[0]
    if (hit) return hit
  }
  return undefined
}

/**
 * Each voice and effect clip's scene, written to params.anchor. `named` maps a clip id to the scene its page names
 * (data-ot-scene: the scene's element id or data-hf-id).
 */
export function anchorSounds(timeline: Timeline, named: Map<string, string> = new Map()) {
  const scenes = timeline.tracks.filter(t => (SCENE_TRACKS as readonly string[]).includes(t.id)).flatMap(t => t.clips)
  for (const track of timeline.tracks.filter(t => (FOLLOWING_TRACKS as readonly string[]).includes(t.id))) {
    for (const clip of track.clips) {
      const wanted = named.get(clip.id)
      const scene = (wanted && scenes.find(s => s.id === wanted || s.params.element === wanted)) || sceneAt(timeline, clip.start)
      if (scene) clip.params = { ...clip.params, anchor: scene.id }
    }
  }
  return timeline
}

/** The clips that move with scene `sceneId` (a version read before anchors existed: the sounds starting in it). */
export function followersOf(timeline: Timeline, sceneId: string): TimelineClip[] {
  return timeline.tracks.filter(t => (FOLLOWING_TRACKS as readonly string[]).includes(t.id) && !t.locked)
    .flatMap(t => t.clips).filter(c => c.params.anchor === undefined ? sceneAt(timeline, c.start)?.id === sceneId : c.params.anchor === sceneId)
}

/** Sounds of a version read before anchors existed get the scene they start in now, before anything moves. */
export function freezeAnchors(timeline: Timeline) {
  const loose = timeline.tracks.filter(t => (FOLLOWING_TRACKS as readonly string[]).includes(t.id)).flatMap(t => t.clips).filter(c => c.params.anchor === undefined)
  for (const clip of loose) { const scene = sceneAt(timeline, clip.start); if (scene) clip.params = { ...clip.params, anchor: scene.id } }
}

/** A sound the person put somewhere else belongs to the scene it now starts in. */
export function reanchor(timeline: Timeline, ids: string[]) {
  for (const track of timeline.tracks.filter(t => (FOLLOWING_TRACKS as readonly string[]).includes(t.id))) {
    for (const clip of track.clips.filter(c => ids.includes(c.id))) {
      const scene = sceneAt(timeline, clip.start)
      const { anchor: _anchor, ...rest } = clip.params
      clip.params = scene ? { ...rest, anchor: scene.id } : rest
    }
  }
}
