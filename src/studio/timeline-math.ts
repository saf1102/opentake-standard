import type { SubtitleSegment, Timeline } from "../types/editor.ts";

export type TimelineRange = { start: number; end: number };

/**
 * Normalise edit ranges once in the coordinate space that existed before the
 * edit. Applying them one-by-one mutates that coordinate space and was the
 * reason later cuts landed at the wrong time.
 */
export function normalizeTimelineRanges(
  ranges: TimelineRange[],
  duration = Number.POSITIVE_INFINITY,
) {
  const ordered = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(duration, range.start)),
      end: Math.max(0, Math.min(duration, range.end)),
    }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
    .filter((range) => range.end - range.start >= 0.001)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: TimelineRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end + 0.001) merged.push({ ...range });
    else previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

export function deletedDurationBefore(time: number, ranges: TimelineRange[]) {
  let deleted = 0;
  for (const range of ranges) {
    if (time >= range.end) deleted += range.end - range.start;
    else if (time > range.start) deleted += time - range.start;
    else break;
  }
  return deleted;
}

export function mapTimeAfterRippleDelete(time: number, ranges: TimelineRange[]) {
  return Math.max(0, time - deletedDurationBefore(time, ranges));
}

export function rippleDeleteTranscript(
  transcript: SubtitleSegment[],
  ranges: TimelineRange[],
  duration: number,
) {
  const normalized = normalizeTimelineRanges(ranges, duration);
  if (!normalized.length) return structuredClone(transcript);
  const isDeleted = (start: number, end: number) => {
    const midpoint = start + (end - start) / 2;
    return normalized.some((range) => midpoint >= range.start && midpoint < range.end);
  };
  return transcript.flatMap((segment) => {
    const tokens = segment.tokens
      .filter((token) => !isDeleted(token.start, token.end))
      .map((token) => ({
        ...token,
        start: mapTimeAfterRippleDelete(token.start, normalized),
        end: mapTimeAfterRippleDelete(token.end, normalized),
      }))
      .filter((token) => token.end - token.start >= 0.001);
    if (!tokens.length) {
      if (segment.tokens.length || isDeleted(segment.start, segment.end)) return [];
      const start = mapTimeAfterRippleDelete(segment.start, normalized);
      const end = mapTimeAfterRippleDelete(segment.end, normalized);
      return end > start ? [{ ...segment, start, end }] : [];
    }
    return [{
      ...segment,
      start: tokens[0].start,
      end: tokens.at(-1)!.end,
      text: tokens.map((token) => token.text).join(""),
      tokens,
    }];
  });
}

export function snappedTimelineStart(
  originStart: number,
  pointerDelta: number,
  pixelsPerSecond: number,
  fps: number,
) {
  const rawStart = originStart + pointerDelta / pixelsPerSecond;
  return Math.max(0, Math.round(rawStart * fps) / fps);
}

/**
 * 调整卡片尾部时只改变 duration，start 始终不动。结果按工程帧率量化，
 * 这样预览、时间线和最终逐帧导出使用完全相同的边界。
 */
export function resizedTimelineDuration(
  originDuration: number,
  pointerDelta: number,
  pixelsPerSecond: number,
  fps: number,
  minimumDuration = 0.5,
) {
  const rawDuration = originDuration + pointerDelta / pixelsPerSecond;
  const frameDuration = Math.round(rawDuration * fps) / fps;
  return Math.max(minimumDuration, frameDuration);
}

export const TIMELINE_BASE_PIXELS_PER_SECOND = 42;
export const MIN_TIMELINE_ZOOM = 0.05;
export const MAX_TIMELINE_ZOOM = 8;

export function clampTimelineZoom(zoom: number) {
  return Math.min(MAX_TIMELINE_ZOOM, Math.max(MIN_TIMELINE_ZOOM, zoom));
}

export function stepTimelineZoom(zoom: number, direction: 1 | -1) {
  const factor = direction > 0 ? 1.25 : 0.8;
  return clampTimelineZoom(Math.round(zoom * factor * 100) / 100);
}

export function fitTimelineZoom(
  contentEnd: number,
  viewportWidth: number,
  padding = 24,
) {
  if (contentEnd <= 0 || viewportWidth <= padding) return 1;
  return clampTimelineZoom(
    Math.floor(
      ((viewportWidth - padding) /
        (contentEnd * TIMELINE_BASE_PIXELS_PER_SECOND)) *
        1000,
    ) / 1000,
  );
}

export function timelineRulerStep(pixelsPerSecond: number) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((step) => step * pixelsPerSecond >= 58) || 600;
}

export type TimelineSnapResult = {
  start: number;
  guide?: number;
};

export type TimelineDurationSnapResult = {
  duration: number;
  guide?: number;
};

/**
 * 将正在拖动素材的首尾边缘，与所有其他轨道素材的首尾边缘对齐。
 * 阈值使用屏幕像素表示，保证不同缩放级别下吸附手感一致。
 */
export function snapTimelineClipStart({
  timeline,
  movingClipId,
  rawStart,
  duration,
  pixelsPerSecond,
  thresholdPixels = 9,
}: {
  timeline: Timeline;
  movingClipId: string;
  rawStart: number;
  duration: number;
  pixelsPerSecond: number;
  thresholdPixels?: number;
}): TimelineSnapResult {
  const threshold = thresholdPixels / Math.max(1, pixelsPerSecond);
  const targetEdges = [0];
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.id === movingClipId) continue;
      targetEdges.push(clip.start, clip.start + clip.duration);
    }
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestStart = rawStart;
  let guide: number | undefined;
  const movingEdges = [
    { time: rawStart, offset: 0 },
    { time: rawStart + duration, offset: duration },
  ];
  for (const movingEdge of movingEdges) {
    for (const targetEdge of targetEdges) {
      const distance = Math.abs(movingEdge.time - targetEdge);
      const candidateStart = targetEdge - movingEdge.offset;
      if (
        distance <= threshold &&
        distance < bestDistance &&
        candidateStart >= 0
      ) {
        bestDistance = distance;
        bestStart = candidateStart;
        guide = targetEdge;
      }
    }
  }
  return { start: Math.max(0, Math.round(bestStart * timeline.fps) / timeline.fps),
    guide: guide === undefined ? undefined : Math.round(guide * timeline.fps) / timeline.fps };
}

/** 将正在调整的卡片尾部吸附到任意轨道素材的首尾边缘。 */
export function snapTimelineClipEnd({
  timeline,
  movingClipId,
  start,
  rawDuration,
  pixelsPerSecond,
  thresholdPixels = 9,
  minimumDuration = 0.5,
}: {
  timeline: Timeline;
  movingClipId: string;
  start: number;
  rawDuration: number;
  pixelsPerSecond: number;
  thresholdPixels?: number;
  minimumDuration?: number;
}): TimelineDurationSnapResult {
  const threshold = thresholdPixels / Math.max(1, pixelsPerSecond);
  const rawEnd = start + rawDuration;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDuration = rawDuration;
  let guide: number | undefined;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.id === movingClipId) continue;
      for (const targetEdge of [clip.start, clip.start + clip.duration]) {
        const candidateDuration = targetEdge - start;
        const distance = Math.abs(rawEnd - targetEdge);
        if (
          candidateDuration >= minimumDuration &&
          distance <= threshold &&
          distance < bestDistance
        ) {
          bestDistance = distance;
          bestDuration = candidateDuration;
          guide = targetEdge;
        }
      }
    }
  }
  return { duration: Math.max(Math.ceil(minimumDuration * timeline.fps), Math.round(bestDuration * timeline.fps)) / timeline.fps,
    guide: guide === undefined ? undefined : Math.round(guide * timeline.fps) / timeline.fps };
}

/** 时间线内容的实际结束时间：所有轨道片段的最大 end。 */
export function timelineContentEnd(timeline: Timeline): number {
  let end = 0;
  for (const track of timeline.tracks)
    for (const clip of track.clips)
      end = Math.max(end, clip.start + clip.duration);
  return end;
}

export function rippleDeleteRanges(
  timeline: Timeline,
  ranges: TimelineRange[],
) {
  const next = structuredClone(timeline);
  const normalized = normalizeTimelineRanges(ranges, timeline.duration);
  if (!normalized.length) return next;

  for (const track of next.tracks) {
    track.automation = (track.automation || []).flatMap((segment) => {
      const start = mapTimeAfterRippleDelete(segment.start, normalized);
      const end = mapTimeAfterRippleDelete(segment.end, normalized);
      return end - start > 0.0001 ? [{ ...segment, start, end }] : [];
    });
    if (track.kind === "music") {
      track.clips = track.clips.flatMap((clip) => {
        const start = mapTimeAfterRippleDelete(clip.start, normalized);
        const end = mapTimeAfterRippleDelete(clip.start + clip.duration, normalized);
        return end - start > 0.0001 ? [{ ...clip, start, duration: end - start }] : [];
      });
      continue;
    }
    track.clips = track.clips.flatMap((clip) => {
      const clipEnd = clip.start + clip.duration;
      let retained = [{ start: clip.start, end: clipEnd }];
      for (const range of normalized) {
        if (range.end <= clip.start) continue;
        if (range.start >= clipEnd) break;
        retained = retained.flatMap((piece) => {
          if (range.end <= piece.start || range.start >= piece.end) return [piece];
          const pieces: TimelineRange[] = [];
          if (range.start > piece.start + 0.001)
            pieces.push({ start: piece.start, end: Math.min(range.start, piece.end) });
          if (range.end < piece.end - 0.001)
            pieces.push({ start: Math.max(range.end, piece.start), end: piece.end });
          return pieces;
        });
      }

      return retained
        .filter((piece) => piece.end - piece.start >= 0.001)
        .map((piece, index, pieces) => {
          const duration = piece.end - piece.start;
          const sourceOffset = piece.start - clip.start;
          const isOriginalHead = Math.abs(piece.start - clip.start) < 0.001;
          return {
            ...clip,
            id: isOriginalHead
              ? clip.id
              : `${clip.id}__cut_${Math.round(piece.start * 1_000)}`,
            start: mapTimeAfterRippleDelete(piece.start, normalized),
            duration,
            sourceStart: clip.sourceStart + sourceOffset,
            sourceDuration: clip.sourceDuration === undefined ? undefined : duration,
            fadeIn: index === 0 && isOriginalHead ? clip.fadeIn : 0,
            fadeOut: index === pieces.length - 1 && Math.abs(piece.end - clipEnd) < 0.001
              ? clip.fadeOut
              : 0,
          };
        });
    }).sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
  }
  const removedDuration = normalized.reduce(
    (total, range) => total + range.end - range.start,
    0,
  );
  next.duration = Math.max(0, timeline.duration - removedDuration);
  next.playhead = Math.min(
    next.duration,
    mapTimeAfterRippleDelete(timeline.playhead, normalized),
  );
  return next;
}
