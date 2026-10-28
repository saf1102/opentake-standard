import { createId } from "../lib/id.ts";
import type {
  MediaAsset,
  TimelineClip,
  TimelineTrack,
  TrackKind,
} from "../types/editor.ts";

export const STUDIO_MEDIA_DRAG_TYPE = "application/x-linkreader-media-id";

const VIDEO_TRACKS = new Set<TrackKind>(["video", "visual", "camera"]);
const VISUAL_TRACKS = new Set<TrackKind>(["visual"]);
const AUDIO_TRACKS = new Set<TrackKind>([
  "voice",
  "music",
  "sfx",
]);

export function isMediaTrackCompatible(
  asset: Pick<MediaAsset, "type" | "origin">,
  track: Pick<TimelineTrack, "kind" | "brollMediaType">,
) {
  if (track.kind === 'visual' && track.brollMediaType && track.brollMediaType !== asset.type) return false;
  if (asset.type === "video") {
    if (asset.origin === "screen-recording" || asset.origin === "openscreen-published") {
      return track.kind === "camera";
    }
    if (asset.origin === "b-roll" || asset.origin === "general") {
      return track.kind === "visual";
    }
    return track.kind === "video";
  }
  if (asset.type === "image") return VISUAL_TRACKS.has(track.kind);
  if (asset.type === "audio") return AUDIO_TRACKS.has(track.kind);
  return false;
}

export function preferredMediaTrackKind(
  asset: Pick<MediaAsset, "type" | "origin">,
): TrackKind | undefined {
  if (asset.type === "image") return "visual";
  if (asset.type === "video") {
    if (asset.origin === "screen-recording" || asset.origin === "openscreen-published") return "camera";
    if (asset.origin === "b-roll" || asset.origin === "general") return "visual";
    return "video";
  }
  return undefined;
}

export function createMediaTimelineClip(
  asset: MediaAsset,
  track: Pick<TimelineTrack, "id" | "kind">,
  start: number,
): TimelineClip {
  const duration = asset.type === "image" ? 5 : Math.max(0.04, asset.duration);
  return {
    id: createId(),
    trackId: track.id,
    assetId: asset.id,
    name: asset.name,
    start: Math.max(0, start),
    duration,
    sourceStart: 0,
    sourceDuration: asset.type === "image" ? undefined : duration,
    volume: track.kind === 'camera' ? 0 : track.kind === 'music' ? .2 : 1,
    fadeIn: 0,
    fadeOut: 0,
    color: asset.type === "image" ? "#0ea5e9" : VIDEO_TRACKS.has(track.kind) ? "#087c80" : "#57a773",
    params: asset.type === "image" ? { kind: "visual-image", fit: "contain" } : track.kind === 'camera' ? {playbackRate:1,useSourceAudio:false} : track.kind === 'visual' ? {useSourceAudio:asset.hasAudio !== false} : {},
  };
}
