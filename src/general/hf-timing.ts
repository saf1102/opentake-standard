import type { GeneralLayers } from './general-contract.ts';

const n3 = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * What of a HyperFrames version the film's timing and sound read (start, length, trim, volume, fades, speed, the
 * track a clip is on, hidden and muted tracks), as one string. Words and moves are not in it: they apply live.
 * Both the editor (to reload the preview after a save) and the page host (to skip unchanged films) compare it.
 */
export function timingKey(layers: GeneralLayers) {
  return JSON.stringify(layers.timeline.tracks.flatMap(track => track.clips
    // the root page's clips, scenes included, and a caption page's lines (timed in that page; their words apply live)
    .filter(clip => clip.params.hf === true && typeof clip.params.hfId === 'string')
    .map(clip => [clip.id, clip.params.hfId, n3(clip.start), n3(clip.duration), n3(clip.sourceStart ?? 0), n3(clip.volume ?? 1), n3(clip.fadeIn ?? 0),
      n3(clip.fadeOut ?? 0), n3(Number(clip.params.speed ?? 1)), track.id, Boolean(track.hidden), Boolean(track.muted)])));
}
