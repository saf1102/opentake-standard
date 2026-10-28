/**
 * A layered general version, shaped as a 口播 editor project so the shared components (timeline, media library)
 * can show it. Nothing here is saved as a 口播 project: edits go back as versions/vN/edited.json.
 */
import { EditProjectSchema, type EditProject, type MediaAsset, type Timeline } from '@/types/editor'
import type { GeneralLayers, GeneralMedia, GeneralProject } from './general-contract'

/** The general tracks in the order the timeline shows them, and which kinds they are. */
export const GENERAL_TRACKS = ['g-page', 'g-text', 'g-footage', 'g-voice', 'g-music', 'g-sfx'] as const

/**
 * Track names follow the film's make-up, as in the 口播 editor (S先生 2026-10-25): pages laid over footage are the
 * 动效卡 and the footage is the 主视频; a film drawn entirely by the agent has its pages as the 主视频.
 */
export function namedTracks(timeline: Timeline, engine?: string): Timeline {
  // a HyperFrames film already has its six lanes by kind: 主视频, 动效卡, 字幕, 配音, 配乐, 音效
  if (engine === 'hyperframes') return timeline
  const pages = timeline.tracks.find(t => t.id === 'g-page'), footage = timeline.tracks.find(t => t.id === 'g-footage')
  const overlays = Boolean(footage?.clips.length) && Boolean(pages?.clips.some(c => c.params.layer === 'overlay'))
  const name = (id: string) => id === 'g-page' ? (overlays ? '动效卡' : '主视频') : id === 'g-footage' ? (overlays || !pages?.clips.length ? '主视频' : '素材') : undefined
  return { ...timeline, tracks: timeline.tracks.map(t => (name(t.id) ? { ...t, name: name(t.id)! } : t)) }
}

/** Only the tracks this film uses (an empty track is not shown). */
export function visibleTimeline(timeline: Timeline): Timeline {
  return { ...timeline, tracks: timeline.tracks.filter(track => track.clips.length) }
}

/** The media file of a general media item: its recorded file, else the file a footage clip names, else id.mp4. */
export function mediaFileName(media: GeneralMedia, layers?: GeneralLayers) {
  if (media.file) return media.file
  const clip = layers?.timeline.tracks.find(t => t.id === 'g-footage')?.clips.find(c => c.assetId === media.id)
  return typeof clip?.params.media === 'string' ? clip.params.media : `${media.id}.mp4`
}

export function editProjectFor(project: GeneralProject, layers: GeneralLayers, version: number): EditProject {
  const now = Date.parse(project.updatedAt) || Date.now()
  const media: MediaAsset[] = project.inputs.media.map(m => ({
    id: m.id, name: m.name, type: m.duration > 0 ? 'video' : 'image', mimeType: m.duration > 0 ? 'video/mp4' : 'image/jpeg',
    originalFile: mediaFileName(m, layers), duration: m.duration, width: m.width || undefined, height: m.height || undefined, fps: layers.fps,
    size: 0, createdAt: now, status: 'ready', origin: 'imported', ...(m.poster ? { thumbnailFile: m.poster } : {}),
  } as MediaAsset))
  // the shots the agent made are in the library too (as OpenFilm lists them): the film's own stretch of each, with a still
  const shots: MediaAsset[] = (layers.timeline.tracks.find(t => t.id === 'g-page')?.clips ?? []).map(clip => ({
    id: `shot-${clip.id}`, name: `${clip.name || '画面'} · Codex`, type: 'video', mimeType: 'video/mp4', originalFile: `${clip.id}.mp4`, duration: clip.duration,
    width: layers.width, height: layers.height, fps: layers.fps, size: 0, createdAt: now, status: 'ready', origin: 'general',
    ...(clip.params.thumb ? { thumbnailFile: String(clip.params.thumb) } : {}),
  } as MediaAsset))
  media.push(...shots)
  const shown = namedTracks(visibleTimeline(layers.timeline), layers.engine)
  // a HyperFrames film is shown, not yet edited, on the timeline: its edits write the page itself (the next step)
  const timeline = layers.engine === 'hyperframes' ? { ...shown, tracks: shown.tracks.map(t => ({ ...t, locked: true })) } : shown
  return EditProjectSchema.parse({
    schemaVersion: 5, id: project.id, name: project.name, createdAt: Date.parse(project.createdAt) || now, updatedAt: now, revision: version,
    settings: { width: layers.width, height: layers.height, fps: layers.fps, canvasMode: 'custom' },
    media, timeline, timelineVersions: [{ id: `v${version}`, kind: 'a-roll', name: `第 ${version} 版`, timeline, createdAt: now, updatedAt: now }], activeTimelineVersionId: `v${version}`,
  })
}
