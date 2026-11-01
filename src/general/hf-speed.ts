/**
 * 动效卡变速 (S先生 11-01): a scene of a HyperFrames film made shorter plays its whole animation faster (longer:
 * slower), as a 口播 card does. Kept as the clip's params.speed; the clip lasts its stretch of animation
 * (sourceDuration) divided by it. The page side is server/general/hf-speed.ts.
 */
import type { TimelineClip } from '../types/editor.ts'

/** Faster than 4× or slower than ¼ an animation can no longer be followed. */
export const SCENE_SPEED_MIN = 0.25, SCENE_SPEED_MAX = 4
export const SCENE_SPEED_MARKS = [0.25, 0.5, 1, 2, 4]

/** A scene of the film: a HyperFrames clip that loads a page of its own (not a caption line, not media). */
export const isScene = (clip: TimelineClip) => clip.params.hf === true && typeof clip.params.sub === 'string' && clip.params.line !== true
  && !['audio', 'video'].includes(String(clip.params.tag))

export const clipSpeed = (clip: TimelineClip) => Number(clip.params.speed ?? 1) || 1
/** The stretch of the scene's own animation the clip plays, in the page's seconds. */
export const sceneSpan = (clip: TimelineClip) => clip.sourceDuration ?? clip.duration * clipSpeed(clip)

/** Play the clip's stretch of animation at `rate`: its length follows. */
export function setSceneSpeed(clip: TimelineClip, rate: number) {
  const span = sceneSpan(clip), speed = Math.min(SCENE_SPEED_MAX, Math.max(SCENE_SPEED_MIN, rate))
  clip.sourceDuration = span
  clip.duration = Math.round(span / speed * 1000) / 1000
  if (Math.abs(speed - 1) < 1e-3) { const { speed: _speed, ...rest } = clip.params; clip.params = rest }
  else clip.params = { ...clip.params, speed: Math.round(speed * 1000) / 1000 }
}

/**
 * ⌥ dragging a scene's end (S先生 11-01): the stretch of animation stays and is played in `duration`, the speed
 * following, within its limits; returns the length it gets.
 */
export function speedToLength(clip: TimelineClip, duration: number) {
  const span = sceneSpan(clip)
  return Math.min(span / SCENE_SPEED_MIN, Math.max(span / SCENE_SPEED_MAX, duration))
}
