/**
 * A HyperFrames film (work/index.html, its sub-compositions and assets) read as a version's tracks. The page is the
 * project: every timed element at the root is a clip, found and classified with HyperFrames' own parsers (the same
 * rules its timeline uses), then laid out by kind in the editor's six lanes (S先生 2026-10-25):
 * 主视频 (video, pictures) · 动效卡 (graphics, sub-compositions) · 字幕 (captions) · 配音 / 配乐 / 音效 (audio by role).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHTML } from 'linkedom';
import { isTimedElement, topLevelElements, trackKindOf, type StructureNode } from '@hyperframes/parsers';
import { TimelineSchema, type Timeline, type TimelineClip, type TrackKind } from '../../src/types/editor.ts';
import type { GeneralLayers, GeneralMedia } from '../../src/general/general-contract.ts';
import { ffprobePath } from './kit-env.ts';

const exec = promisify(execFile);
export const HF_ENTRY = 'index.html';

/** The HyperFrames root of a folder: index.html holding a composition. */
export function isHyperframesWork(work: string) {
  try { return /data-composition-id\s*=/.test(fs.readFileSync(path.join(work, HF_ENTRY), 'utf8')); } catch { return false; }
}

interface Node extends StructureNode<Node> { el: Element }
export type HfClip = {
  hfId: string; elementId: string; tag: string; kind: 'video' | 'audio' | 'captions' | 'graphics'; role: string;
  start: number; duration: number; mediaStart: number; src: string; sub: string; volume: number; label: string;
  /** a video whose own sound is heard (HyperFrames: data-has-audio, and not muted) */
  hasAudio: boolean; rate: number;
};

async function mediaSeconds(file: string) {
  try { const { stdout } = await exec(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]); return Number(stdout) || 0; } catch { return 0; }
}
const num = (v: string | null | undefined, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

/** The root composition's size and length, and its top-level clips in document order. */
export async function readHyperframes(work: string) {
  const { document } = parseHTML(fs.readFileSync(path.join(work, HF_ENTRY), 'utf8'));
  const root = document.querySelector('[data-composition-id]');
  if (!root) throw new Error('index.html 里没有 HyperFrames 的根节点（data-composition-id）');
  const node = (el: Element): Node => ({ tag: el.tagName.toLowerCase(), attrs: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])), children: [...el.children].map(node), el });
  const clips: HfClip[] = [];
  for (const n of topLevelElements(node(root)).filter(isTimedElement)) {
    const a = n.attrs, tag = n.tag, kind = trackKindOf(n).kind;
    const src = a.src ?? '', start = num(a['data-start']), mediaStart = num(a['data-media-start']);
    let duration = num(a['data-duration'], NaN);
    // media without an authored length plays to its end; a picture defaults to 3 s (HyperFrames' rule)
    if (!Number.isFinite(duration)) duration = tag === 'img' ? 3 : src ? Math.max(0, (await mediaSeconds(path.join(work, decodeURIComponent(src)))) - mediaStart) : 0;
    clips.push({
      hfId: a['data-hf-id'] || a.id || `${tag}-${clips.length}`, elementId: a.id ?? '', tag, kind, role: (a['data-ot-role'] ?? '').toLowerCase(),
      start, duration, mediaStart, src, sub: a['data-composition-src'] ?? '', volume: num(a['data-volume'], 1),
      hasAudio: tag === 'audio' || (tag === 'video' && a['data-has-audio'] === 'true' && a.muted === undefined), rate: num(a['data-playback-rate'], 1),
      label: a['data-label'] || a['aria-label'] || a.id || (src ? path.basename(src, path.extname(src)) : tag),
    });
  }
  const width = num(root.getAttribute('data-width'), 1920), height = num(root.getAttribute('data-height'), 1080);
  const duration = num(root.getAttribute('data-duration'), 0) || Math.max(0, ...clips.map(c => c.start + c.duration));
  return { width, height, duration, clips };
}

/** Which lane a clip lives in. Sound goes by its role; an unmarked sound under half the film is an effect. */
export function laneOf(clip: HfClip, filmDuration: number) {
  if (clip.kind === 'audio') {
    if (clip.role === 'voice' || clip.role === 'music' || clip.role === 'sfx') return `g-${clip.role}`;
    if (/(^|[-_/])(vo|voice|narration|旁白|配音)/i.test(clip.src || clip.label)) return 'g-voice';
    return clip.duration >= filmDuration * 0.5 ? 'g-music' : 'g-sfx';
  }
  if (clip.kind === 'video') return 'g-footage';
  if (clip.kind === 'captions') return 'g-text';
  return clip.tag === 'img' ? 'g-footage' : 'g-page';
}

const LANES: [string, string, TrackKind][] = [
  ['g-footage', '主视频', 'video'], ['g-page', '动效卡', 'page'], ['g-text', '字幕', 'subtitle'],
  ['g-voice', '配音', 'voice'], ['g-music', '配乐', 'music'], ['g-sfx', '音效', 'sfx'],
];

/** The version's tracks. `base` is the snapshot folder relative to the project (where index.html is served from). */
export async function hyperframesToLayers(work: string, base: string, media: GeneralMedia[], fps = 30): Promise<GeneralLayers> {
  const film = await readHyperframes(work);
  const byFile = new Map(media.map(m => [m.file ?? '', m]));
  const toClip = (c: HfClip, trackId: string): TimelineClip => {
    const asset = byFile.get(path.basename(c.src));
    return {
      id: c.hfId, trackId, name: c.label, start: c.start, duration: Math.max(1 / fps, c.duration), sourceStart: c.mediaStart, volume: c.volume, fadeIn: 0, fadeOut: 0,
      ...(asset ? { assetId: asset.id } : {}),
      params: { hf: true, hfId: c.hfId, element: c.elementId, tag: c.tag, ...(c.src ? { src: c.src } : {}), ...(c.sub ? { sub: c.sub } : {}), ...(c.role ? { role: c.role } : {}) },
    } as TimelineClip;
  };
  const lanes = new Map(LANES.map(([id]) => [id, [] as TimelineClip[]]));
  for (const c of film.clips) { const lane = laneOf(c, film.duration); lanes.get(lane)!.push(toClip(c, lane)); }
  const tracks = LANES.map(([id, name, kind], order) => ({ id, name, kind, order, locked: false, hidden: false, muted: false, hiddenInEditor: false, automation: [], clips: lanes.get(id)! }));
  const timeline: Timeline = TimelineSchema.parse({ duration: film.duration, fps, playhead: 0, tracks });
  // the strip of parts under the preview: the 动效卡 one after another (overlapping cards fold into the first)
  const segments: GeneralLayers['segments'] = [];
  for (const c of [...lanes.get('g-page')!].sort((a, b) => a.start - b.start)) {
    const last = segments.at(-1);
    if (last && c.start < last.end - 1e-3) continue;
    segments.push({ id: c.id, name: c.name, start: c.start, end: c.start + c.duration, transition: 'cut' });
  }
  return {
    format: 'opentake.general.layers', version: 1, engine: 'hyperframes', entry: HF_ENTRY,
    width: film.width, height: film.height, fps, duration: film.duration,
    segments: segments.length ? segments : [{ id: 'all', name: '全片', start: 0, end: film.duration, transition: 'cut' }],
    ending: 'cut', finish: 'none', base, timeline,
  };
}
