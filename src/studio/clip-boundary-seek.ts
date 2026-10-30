import type { TimelineClip } from '../types/editor.ts';

export type ClipBoundarySeek = {
  clipId: string;
  start: number;
  duration: number;
  edge: 'start' | 'end';
  time: number;
};

/** Ordinary clicks alternate between the first and last visible frame.
 * Keep this separate from selection: pointer-down already selects before click. */
export function nextClipBoundarySeek(
  previous: ClipBoundarySeek | undefined,
  clip: Pick<TimelineClip, 'id' | 'start' | 'duration'>,
  fps: number,
  playhead: number,
): ClipBoundarySeek {
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const repeat = previous?.clipId === clip.id && previous.start === clip.start
    && previous.duration === clip.duration && Math.abs(playhead - previous.time) < 0.5 / rate;
  const edge = repeat && previous.edge === 'start' ? 'end' : 'start';
  // Clip ends are exclusive. Seeking to start + duration would show the next clip.
  const lastFrame = Math.max(clip.start, (Math.ceil((clip.start + clip.duration) * rate - 1e-7) - 1) / rate);
  return { clipId: clip.id, start: clip.start, duration: clip.duration, edge, time: edge === 'start' ? clip.start : lastFrame };
}
