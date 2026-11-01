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

/** The timeline's media id of a HyperFrames sound file (src as the page names it): it draws that file's waveform. */
export const soundAssetId = (src: string) => `hf-sound:${src}`

/**
 * A HyperFrames film's sound files as media the timeline draws waveforms from (S先生 10-31: 配音像口播的声音轨一样有
 * 波纹): `sounds` is each file's length. They stay out of the library; each sound clip names its file.
 */
function withSounds(timeline: Timeline, sounds: Record<string, number>, now: number): { timeline: Timeline; media: MediaAsset[] } {
  const media: MediaAsset[] = Object.entries(sounds).map(([src, duration]) => ({
    id: soundAssetId(src), name: src.split('/').pop() || src, type: 'audio', mimeType: 'audio/wav', originalFile: src, waveformFile: src,
    duration, size: 0, createdAt: now, status: 'ready', origin: 'general', removedFromLibrary: true,
  } as MediaAsset))
  return { media, timeline: { ...timeline, tracks: timeline.tracks.map(track => ({ ...track, clips: track.clips.map(clip =>
    clip.params.hf === true && typeof clip.params.src === 'string' && clip.params.tag === 'audio' && sounds[clip.params.src] ? { ...clip, assetId: soundAssetId(clip.params.src) } : clip) })) } }
}

export function editProjectFor(project: GeneralProject, layers: GeneralLayers, version: number, sounds: Record<string, number> = {}): EditProject {
  const now = Date.parse(project.updatedAt) || Date.now()
  const media: MediaAsset[] = project.inputs.media.map(m => ({
    id: m.id, name: m.name, type: m.duration > 0 ? 'video' : 'image', mimeType: m.duration > 0 ? 'video/mp4' : 'image/jpeg',
    originalFile: mediaFileName(m, layers), duration: m.duration, width: m.width || undefined, height: m.height || undefined, fps: layers.fps,
    size: 0, createdAt: now, status: 'ready', origin: 'imported', ...(m.poster ? { thumbnailFile: m.poster } : {}),
  } as MediaAsset))
  // the shots the agent made are in the library too: the film's own stretch of each, with a still
  const shots: MediaAsset[] = (layers.timeline.tracks.find(t => t.id === 'g-page')?.clips ?? []).map(clip => ({
    id: `shot-${clip.id}`, name: `${clip.name || '画面'} · Codex`, type: 'video', mimeType: 'video/mp4', originalFile: `${clip.id}.mp4`, duration: clip.duration,
    width: layers.width, height: layers.height, fps: layers.fps, size: 0, createdAt: now, status: 'ready', origin: 'general',
    ...(clip.params.thumb ? { thumbnailFile: String(clip.params.thumb) } : {}),
  } as MediaAsset))
  media.push(...shots)
  // a HyperFrames film edits like a 口播 timeline (S先生 10-31): its edits go to edited.json and the page host and
  // the export read the page through them (server/general/hf-timeline.ts)
  const heard = withSounds(namedTracks(visibleTimeline(layers.timeline), layers.engine), sounds, now)
  media.push(...heard.media)
  const timeline = heard.timeline
  return EditProjectSchema.parse({
    schemaVersion: 5, id: project.id, name: project.name, createdAt: Date.parse(project.createdAt) || now, updatedAt: now, revision: version,
    settings: { width: layers.width, height: layers.height, fps: layers.fps, canvasMode: 'custom' },
    media, timeline, timelineVersions: [{ id: `v${version}`, kind: 'a-roll', name: `第 ${version} 版`, timeline, createdAt: now, updatedAt: now }], activeTimelineVersionId: `v${version}`,
  })
}
