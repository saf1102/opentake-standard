import type { TimelineClip } from '../types/editor.ts';

/** Gain at the top of a clip's volume line (+20 dB, the loudest the editor allows). */
const TOP = 10;
/** Below this height the line means silence. */
const FLOOR = 0.1;

/** Longest fade at either end: half the clip, as the export caps it. */
export const maxClipFade = (clip: Pick<TimelineClip, 'duration'>) => clip.duration / 2;

/** The fade multiplier at timeline time `t` (straight ramps, like the export's afade). */
export function clipFadeGain(clip: Pick<TimelineClip, 'start' | 'duration' | 'fadeIn' | 'fadeOut'>, t: number) {
  const local = t - clip.start, max = maxClipFade(clip);
  const fadeIn = Math.min(clip.fadeIn ?? 0, max), fadeOut = Math.min(clip.fadeOut ?? 0, max);
  let gain = 1;
  if (fadeIn > 0 && local < fadeIn) gain = Math.min(gain, Math.max(0, local / fadeIn));
  if (fadeOut > 0 && local > clip.duration - fadeOut) gain = Math.min(gain, Math.max(0, (clip.duration - local) / fadeOut));
  return gain;
}

/** Where the volume line sits, 0 (bottom, silent) to 1 (top, +20 dB): a fader curve, so 0 dB is a little above the middle. */
export const gainToLevel = (gain: number) => gain <= 0 ? 0 : Math.min(1, FLOOR + (1 - FLOOR) * Math.max(0, (gain ** 0.25 - 0.001 ** 0.25) / (TOP ** 0.25 - 0.001 ** 0.25)));
export function levelToGain(level: number) {
  if (level <= FLOOR) return 0;
  const root = 0.001 ** 0.25 + (Math.min(1, level) - FLOOR) / (1 - FLOOR) * (TOP ** 0.25 - 0.001 ** 0.25);
  const db = 20 * Math.log10(root ** 4);
  // half-dB steps, and 0 dB holds the line within ±0.75 dB
  const snapped = Math.abs(db) < 0.75 ? 0 : Math.round(db * 2) / 2;
  return 10 ** (Math.min(20, snapped) / 20);
}
