import type { CursorRecordingData } from '@/native/contracts';
import type { ZoomFocus } from '@/components/video-editor/types';
import type { SmoothedCursorPath } from './cursorPathSmoothing';
import { advanceFollowFocus, interpolateCursorAt } from '@/lib/zoomMath/cursorFollowUtils';
import { AUTO_FOLLOW_PARAMS } from '@/lib/zoomMath/constants';

type Point = ZoomFocus & { timeMs: number };
export interface BrowserCameraTrack {
  focusAt(startMs: number, timeMs: number, endMs: number, scale: number): ZoomFocus | null;
}

/** Mirrors CursorTrack::follow_in_view from the MIT-licensed OpenScreen v2.1.2
 * crates/compositor/src/cursor.rs: replay the view from a fixed region boundary,
 * with a central dead zone. Seeking and normal playback must produce the same camera. */
export function createBrowserCameraTrack(
  recording: CursorRecordingData | null, path: SmoothedCursorPath | null, smoothing: number,
): BrowserCameraTrack | null {
  const raw = recording?.samples;
  if (!raw?.length) return null;
  const first = raw[0], last = raw[raw.length - 1];
  const points: Point[] = [];
  if (smoothing > 0 && raw.length > 1 && path) {
    const count = Math.max(1, Math.round((last.timeMs - first.timeMs) / (1000 / 240)));
    for (let i = 0; i <= count; i++) {
      const timeMs = i === count ? last.timeMs : first.timeMs + i * (1000 / 240);
      const point = path.sampleAt(timeMs) ?? interpolateCursorAt(raw, timeMs)!;
      points.push({ timeMs, ...point });
    }
  } else for (const point of raw) points.push({ timeMs: point.timeMs, cx: point.cx, cy: point.cy });
  const followed: Point[] = [];
  for (const point of points) {
    const prev = followed.at(-1);
    followed.push({ timeMs: point.timeMs, ...(prev
      ? advanceFollowFocus(prev, point, point.timeMs - prev.timeMs, AUTO_FOLLOW_PARAMS) : point) });
  }
  const cache = new Map<string, Point[]>();
  return { focusAt(startMs, timeMs, endMs, scale) {
    endMs = Math.max(startMs, endMs);
    timeMs = Math.max(startMs, Math.min(endMs, timeMs));
    const half = 0.5 / Math.max(1, scale), dead = half * 0.5;
    const reach = (value: number) => Math.max(half, Math.min(1 - half, value));
    const pull = (cursor: number, view: number) => cursor - Math.max(-dead, Math.min(dead, cursor - view));
    const key = `${startMs}:${endMs}:${scale}`;
    let states = cache.get(key);
    const step = (from: Point, to: Point) => {
      const next = advanceFollowFocus(from, { cx: pull(to.cx, from.cx), cy: pull(to.cy, from.cy) },
        to.timeMs - from.timeMs, AUTO_FOLLOW_PARAMS);
      return { timeMs: to.timeMs, cx: reach(next.cx), cy: reach(next.cy) };
    };
    if (!states) {
      const initial = interpolateCursorAt(followed, startMs)!;
      states = [{ timeMs: startMs, cx: reach(initial.cx), cy: reach(initial.cy) }];
      for (const point of points) {
        if (point.timeMs <= startMs) continue;
        const previous = states.at(-1)!;
        const next = step(previous, point);
        if (point.timeMs <= endMs) states.push(next);
        else {
          const focus = interpolateCursorAt([previous, next], endMs)!;
          states.push({ timeMs: endMs, ...focus });
          break;
        }
      }
      if (cache.size >= 32) cache.delete(cache.keys().next().value!);
      cache.set(key, states);
    }
    const tail = states.at(-1)!;
    if (timeMs > tail.timeMs) {
      const next = step(tail, { ...points.at(-1)!, timeMs });
      return { cx: next.cx, cy: next.cy };
    }
    return interpolateCursorAt(states, timeMs);
  } };
}
