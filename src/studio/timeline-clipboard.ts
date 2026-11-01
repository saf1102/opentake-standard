import type { Timeline, TimelineClip } from '../types/editor.ts';

/** Tracks laid out for the spoken edit itself (口播画面、口播声音、字幕…): nothing is copied from or pasted onto them. */
export const FIXED_TRACK_KINDS: ReadonlySet<string> = new Set(['video', 'voice', 'subtitle', 'proxy', 'source-bed', 'composition', 'enhanced']);
/** 通用剪辑 has no laid-out tracks: every unlocked track takes copies. */
export const NO_FIXED_TRACKS: ReadonlySet<string> = new Set();

/** Clips copied with ⌘C or the clip menu, shared by every timeline in this window. */
let clipboard: TimelineClip[] = [];
export const hasCopiedClips = () => clipboard.length > 0;
export const copiedClips = () => structuredClone(clipboard);

/** Copy the given clips, leaving out any on a fixed or locked track. Returns how many were copied. */
export function copyTimelineClips(timeline: Timeline, ids: Iterable<string>, fixed: ReadonlySet<string> = FIXED_TRACK_KINDS) {
  const wanted = new Set(ids);
  const clips = timeline.tracks.filter(track => !track.locked && !fixed.has(track.kind))
    .flatMap(track => track.clips.filter(clip => wanted.has(clip.id)));
  if (clips.length) clipboard = structuredClone(clips);
  return clips.length;
}

const id = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

/**
 * Paste copied clips (⌘V). They keep their spacing; the first one starts at the playhead. When the pointer is over a
 * track of the same kind as the copied clips' track, they go there, otherwise back on their own track. If that spot
 * is taken, they go right after the clips already there instead of covering them. Returns the new clips' ids.
 */
export function pasteTimelineClips(timeline: Timeline, copied: TimelineClip[], pointerTrackId: string | undefined, at: number, fixed: ReadonlySet<string> = FIXED_TRACK_KINDS) {
  if (!copied.length) return [];
  const sourceTracks = new Set(copied.map(clip => clip.trackId));
  const pointer = timeline.tracks.find(track => track.id === pointerTrackId);
  const kindOf = (trackId: string) => timeline.tracks.find(track => track.id === trackId)?.kind;
  const single = sourceTracks.size === 1 ? [...sourceTracks][0] : undefined;
  const destination = (clip: TimelineClip) =>
    single && pointer && !pointer.locked && !fixed.has(pointer.kind) && kindOf(single) === pointer.kind ? pointer.id : clip.trackId;
  const open = (trackId: string) => { const track = timeline.tracks.find(row => row.id === trackId); return Boolean(track && !track.locked && !fixed.has(track.kind)); };
  copied = copied.filter(clip => open(destination(clip)));
  if (!copied.length) return [];
  const first = Math.min(...copied.map(clip => clip.start));
  let shift = Math.max(0, at) - first;
  // Move the whole paste later until none of its clips covers another one on its destination track.
  for (let guard = 0; guard < 50; guard++) {
    let pushed = false;
    for (const clip of copied) {
      const track = timeline.tracks.find(row => row.id === destination(clip));
      const start = clip.start + shift, end = start + clip.duration;
      const hit = track?.clips.find(other => other.start < end - 1e-6 && other.start + other.duration > start + 1e-6);
      if (hit) { shift += hit.start + hit.duration - start; pushed = true; }
    }
    if (!pushed) break;
  }
  const groups = new Map<string, string>();
  const ids: string[] = [];
  for (const source of copied) {
    const trackId = destination(source);
    const track = timeline.tracks.find(row => row.id === trackId);
    if (!track) continue;
    const clip: TimelineClip = { ...structuredClone(source), id: id(), trackId, start: source.start + shift };
    if (source.linkGroupId) clip.linkGroupId = groups.get(source.linkGroupId) ?? (groups.set(source.linkGroupId, id()), groups.get(source.linkGroupId)!);
    track.clips.push(clip);
    track.clips.sort((a, b) => a.start - b.start);
    ids.push(clip.id);
  }
  timeline.duration = Math.max(timeline.duration, ...timeline.tracks.flatMap(track => track.clips.map(clip => clip.start + clip.duration)));
  return ids;
}
