import type { EditProject, Timeline } from '../types/editor.ts';
import { timelineContentEnd } from './timeline-math.ts';

/** The badge describes the currently visible edit, not past placements. */
export function usedAssetIds(timeline: Timeline): Set<string> {
  return new Set(timeline.tracks.flatMap(track => track.clips.flatMap(clip => clip.assetId ? [clip.assetId] : [])));
}

/** Remove every placement, including saved timeline versions, without deleting source files. */
export function removeAssetPlacements(project: EditProject, assetId: string): EditProject {
  const next = structuredClone(project);
  const remove = (timeline: Timeline) => {
    for (const track of timeline.tracks) track.clips = track.clips.filter(clip => clip.assetId !== assetId);
    timeline.duration = timelineContentEnd(timeline);
    timeline.playhead = Math.min(timeline.playhead, timeline.duration);
  };
  remove(next.timeline);
  for (const version of next.timelineVersions) remove(version.timeline);
  next.media = next.media.map(asset => asset.id === assetId ? {...asset, removedFromLibrary: true} : asset);
  return next;
}
