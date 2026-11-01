/**
 * A layered film (film.json version 2) becomes a version's tracks: a snapshot of the agent's work folder in
 * versions/vN/work (the next turn rewrites work/) and versions/vN/layers.json, the 口播 editor's timeline shape that
 * the general page edits. Plain films (version 1) keep only their video.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { TimelineSchema, type Timeline, type TimelineClip, type TrackKind } from '../../src/types/editor.ts';
import type { GeneralLayers, GeneralMedia, GeneralTransition } from '../../src/general/general-contract.ts';
import { KIT_DIR, ffmpegPath, ffprobePath, fontDirs } from './kit-env.ts';
import { findGeneral } from './store.ts';
import { decodeAudioPeaks } from '../editor/audio-peaks.ts';
import { splitMixedStrips } from '../../src/general/hf-split.ts';
import { speedableScenes } from './hf-speed.ts';
import { expandCaptionLines, hyperframesToLayers, isHyperframesWork } from './hf-project.ts';

const exec = promisify(execFile);
/** Gain of the three volume steps (film.json `volume`), the same dB the kit mixes with. */
export const VOLUME_DB = { low: -8, mid: 0, high: 4 } as const;
export type VolumeStep = keyof typeof VOLUME_DB;
/** film.json `volume`: a step, or a number of dB once the person moved a track fader. */
export type Volume = VolumeStep | number;
export const volumeDb = (v: unknown) => (typeof v === 'number' ? v : VOLUME_DB[v as VolumeStep] ?? 0);
const gain = (v: unknown) => Math.round(10 ** (volumeDb(v) / 20) * 1000) / 1000;

/** Seconds of fade at each end of a clip's sound, set by the person on the timeline. */
type Fades = { fadeIn?: number; fadeOut?: number };
type Clip2 = { id: string; start: number; end?: number } & Fades;
const fadesOf = (c: Fades) => ({ fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0 });
const fadesFrom = (c: TimelineClip): Fades => ({ ...(c.fadeIn > 0.001 ? { fadeIn: Math.round(c.fadeIn * 1000) / 1000 } : {}), ...(c.fadeOut > 0.001 ? { fadeOut: Math.round(c.fadeOut * 1000) / 1000 } : {}) });
export type Film2 = {
  title?: string; logline?: string; locked?: string[];
  width: number; height: number; fps: number; duration: number; ending: 'cut' | 'fade'; finish: string;
  segments: { id: string; name: string; start: number; end: number; transition: GeneralTransition }[];
  picture: (Clip2 & { end: number; page: string; layer: string; uses: string[]; edits?: Record<string, string>; overrides?: Record<string, unknown> })[];
  footage: (Clip2 & { end: number; media: string; in: number; speed: number; reverse: boolean; fit: string; focus: number[]; move?: unknown; sound: boolean; volume: Volume })[];
  text: (Clip2 & { end: number; text: string; role: string; preset: string; place: string; reveal: string; size?: string; rotate?: number })[];
  voice: (Clip2 & { src: string; in: number; volume: Volume; text: string })[];
  music: (Clip2 & { end: number; src: string; in: number; volume: Volume })[];
  sfx: (Clip2 & { src: string; in: number; volume: Volume; label: string })[];
};

/** Folders and files of work/ that are not part of the film. */
const NOT_FILM = new Set(['out', 'out.mp4', 'poster.jpg', 'look', '.tmp', '.tmp-look', '.opentake', 'render', 'node_modules', 'progress.json', 'network-request.json']);

async function normalize(work: string, mediaDir: string): Promise<Film2 | undefined> {
  let raw: { version?: unknown };
  try { raw = JSON.parse(fs.readFileSync(path.join(work, 'film.json'), 'utf8')); } catch { return undefined; }
  if (Number(raw.version) !== 2) return undefined;
  const lib = await import(pathToFileURL(path.join(KIT_DIR, 'lib', 'film2.mjs')).href) as { normalizeFilm2: (film: unknown, dir: string, media: string) => Film2 };
  return lib.normalizeFilm2(raw, work, mediaDir);
}

async function seconds(file: string) {
  try { const { stdout } = await exec(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]); return Number(stdout) || 0; } catch { return 0; }
}

/** Build the tracks. `base` is the snapshot folder (relative to the project); clip paths are relative to it. */
export async function filmToLayers(film: Film2, base: string, baseDir: string, media: GeneralMedia[]): Promise<GeneralLayers> {
  const byFile = new Map(media.map(m => [m.id, m]));
  const segmentName = (start: number) => film.segments.find(s => start >= s.start - 1e-6 && start < s.end)?.name ?? '';
  const clip = (trackId: string, c: { id: string; start: number }, duration: number, extra: Partial<TimelineClip>): TimelineClip => ({
    id: c.id, trackId, name: '', start: c.start, duration: Math.max(0.000001, duration), sourceStart: 0, volume: 1, fadeIn: 0, fadeOut: 0, params: {}, ...extra,
  });
  const audioClip = async (trackId: string, c: Film2['voice'][number] | Film2['sfx'][number] | Film2['music'][number], name: string, params: Record<string, unknown>) => {
    const length = 'end' in c && c.end !== undefined ? c.end - c.start : Math.min(film.duration - c.start, (await seconds(path.join(baseDir, c.src))) - c.in);
    return clip(trackId, c, length, { name, sourceStart: c.in, volume: gain(c.volume), ...fadesOf(c), params: { src: c.src, ...(typeof c.volume === 'string' ? { volumeStep: c.volume } : {}), ...params } });
  };
  const track = (id: string, name: string, kind: TrackKind, order: number, clips: TimelineClip[]) => ({ id, name, kind, order, locked: false, hidden: false, muted: false, hiddenInEditor: false, automation: [], clips });
  const tracks = [
    track('g-page', '画面', 'page', 0, film.picture.map(p => clip('g-page', p, p.end - p.start, { name: segmentName(p.start) || path.basename(p.page, '.html'), params: { page: p.page, layer: p.layer, uses: p.uses, ...(p.edits ? { textEdits: p.edits } : {}), ...(p.overrides ? { overrides: p.overrides } : {}) } }))),
    track('g-text', '文字', 'subtitle', 1, film.text.map(t => clip('g-text', t, t.end - t.start, { name: t.text.replace(/[{}]/g, '').split('\n')[0], text: t.text, params: { role: t.role, preset: t.preset, place: t.place, reveal: t.reveal, ...(t.size ? { size: t.size } : {}), ...(t.rotate ? { rotate: t.rotate } : {}) } }))),
    track('g-footage', '素材', 'video', 2, film.footage.map(f => {
      const id = path.parse(f.media).name;
      return clip('g-footage', f, f.end - f.start, {
        name: byFile.get(id)?.name ?? f.media, assetId: byFile.has(id) ? id : undefined, sourceStart: f.in, sourceDuration: (f.end - f.start) * f.speed, volume: f.sound ? gain(f.volume) : 0, ...fadesOf(f),
        params: { media: f.media, speed: f.speed, reverse: f.reverse, fit: f.fit, focus: f.focus, ...(f.move ? { move: f.move } : {}), sound: f.sound, ...(typeof f.volume === 'string' ? { volumeStep: f.volume } : {}) },
      });
    })),
    track('g-voice', '旁白', 'voice', 3, await Promise.all(film.voice.map(v => audioClip('g-voice', v, v.text.slice(0, 24), { text: v.text })))),
    track('g-music', '配乐', 'music', 4, await Promise.all(film.music.map(m => audioClip('g-music', m, path.basename(m.src, path.extname(m.src)), {})))),
    track('g-sfx', '音效', 'sfx', 5, await Promise.all(film.sfx.map(x => audioClip('g-sfx', x, x.label, { label: x.label })))),
  ];
  const timeline: Timeline = TimelineSchema.parse({ duration: film.duration, fps: film.fps, playhead: 0, tracks });
  return {
    filmMetadata: { ...(film.title ? { title: film.title } : {}), ...(film.logline ? { logline: film.logline } : {}), ...(film.locked ? { locked: film.locked } : {}) },
    format: 'opentake.general.layers', version: 1, width: film.width, height: film.height, fps: film.fps, duration: film.duration,
    segments: film.segments.map(s => ({ id: s.id, name: s.name, start: s.start, end: s.end, transition: s.transition })), ending: film.ending, finish: film.finish, base, timeline,
  };
}

/** Inverse of the immutable version snapshot. UI coordinates already include segment reordering. */
export function layersToFilm(layers: GeneralLayers): Film2 & { version: 2 } {
  if (layers?.format !== 'opentake.general.layers' || layers.version !== 1) throw new Error('分轨数据格式不对');
  const timeline = TimelineSchema.parse(layers.timeline);
  const clips = (id: string) => timeline.tracks.filter(t => t.id === id && !t.muted).flatMap(t => t.clips);
  const span = (c: TimelineClip) => ({ id: c.id, start: c.start, end: c.start + c.duration });
  // the clip's own step, plus its track's fader (the timeline's dB slider); a fader at 0 dB keeps the plain step
  const trackDb = new Map(timeline.tracks.map(t => [t.id, 20 * Math.log10(Math.max(1e-3, t.volume ?? 1))]));
  const owner = new Map(timeline.tracks.flatMap(t => t.clips.map(c => [c.id, t.id] as const)));
  const volume = (c: TimelineClip): Volume => {
    const raw = c.params.volumeStep;
    const fader = trackDb.get(owner.get(c.id) ?? '') ?? 0;
    // no step: the person dragged the clip's volume line to a dB of its own (a step when it lands on one)
    const own = 20 * Math.log10(Math.max(1e-3, c.volume));
    const step: VolumeStep | undefined = raw === 'low' || raw === 'mid' || raw === 'high' ? raw
      : (Object.keys(VOLUME_DB) as VolumeStep[]).find(name => Math.abs(VOLUME_DB[name] - own) < 0.05);
    if (step && Math.abs(fader) < 0.05) return step;
    return Math.max(-60, Math.min(20, Math.round(((step ? VOLUME_DB[step] : own) + fader) * 10) / 10));
  };
  const audio = (id: string) => clips(id).map(c => ({ ...span(c), src: String(c.params.src ?? ''), in: c.sourceStart, volume: volume(c), ...fadesFrom(c) }));
  return {
    version: 2, ...layers.filmMetadata, width: layers.width, height: layers.height, fps: layers.fps, duration: timeline.duration,
    segments: structuredClone(layers.segments), ending: layers.ending, finish: layers.finish,
    picture: clips('g-page').map(c => ({ ...span(c), page: String(c.params.page ?? ''), layer: String(c.params.layer ?? 'overlay'), uses: c.params.uses as string[] ?? [], ...(c.params.textEdits !== undefined ? { edits: structuredClone(c.params.textEdits) as Record<string, string> } : {}),
      ...(c.params.overrides && Object.keys(c.params.overrides as object).length ? { overrides: structuredClone(c.params.overrides) as Record<string, unknown> } : {}) })),
    footage: clips('g-footage').map(c => ({ ...span(c), media: String(c.params.media ?? ''), in: c.sourceStart,
      speed: Number(c.params.speed ?? 1), reverse: Boolean(c.params.reverse), fit: String(c.params.fit ?? 'cover'), focus: c.params.focus as number[] ?? [.5, .5],
      ...(c.params.move !== undefined ? { move: structuredClone(c.params.move) } : {}), sound: Boolean(c.params.sound) && c.volume > 0, volume: volume(c), ...fadesFrom(c) })),
    text: clips('g-text').map(c => ({ ...span(c), text: c.text ?? '', role: String(c.params.role ?? 'caption'), preset: String(c.params.preset ?? ''), place: String(c.params.place ?? 'bottom'), reveal: String(c.params.reveal ?? 'fade'),
      ...(c.params.size && c.params.size !== 'mid' ? { size: String(c.params.size) } : {}), ...(Number(c.params.rotate) ? { rotate: Number(c.params.rotate) } : {}) })),
    voice: audio('g-voice').map((c, i) => ({ ...c, text: String(clips('g-voice')[i].params.text ?? '') })),
    music: audio('g-music'), sfx: audio('g-sfx').map((c, i) => ({ ...c, label: String(clips('g-sfx')[i].params.label ?? '') })),
  };
}

/** At delivery: snapshot work/ into versions/vN/work and write versions/vN/layers.json. Returns that path, or undefined for a plain film. */
export async function snapshotLayers(dir: string, n: number, media: GeneralMedia[], video?: string): Promise<string | undefined> {
  const work = path.join(dir, 'work');
  const hf = isHyperframesWork(work);
  const film = hf ? undefined : await normalize(work, path.join(dir, 'media'));
  if (!film && !hf) return undefined;
  const folder = path.join(dir, 'versions', `v${n}`), snap = path.join(folder, 'work');
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(snap, { recursive: true });
  for (const name of fs.readdirSync(work)) if (!NOT_FILM.has(name)) fs.cpSync(path.join(work, name), path.join(snap, name), { recursive: true });
  const base = path.relative(dir, snap).split(path.sep).join('/');
  const layers = film ? await filmToLayers(film, base, snap, media) : await hyperframesToLayers(snap, base, media);
  // each shot the agent made also goes to the media library: a still from the film at its middle
  if (video && fs.existsSync(video)) {
    const thumbs = path.join(folder, 'thumbs');
    fs.mkdirSync(thumbs, { recursive: true });
    for (const clip of layers.timeline.tracks.find(t => t.id === 'g-page')?.clips ?? []) {
      const file = path.join(thumbs, `${clip.id}.jpg`);
      try {
        await exec(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(clip.start + clip.duration / 2), '-i', video, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '3', file]);
        clip.params = { ...clip.params, thumb: path.relative(dir, file).split(path.sep).join('/') };
      } catch { /* a missing still only leaves the shot without a picture */ }
    }
  }
  const file = path.join(folder, 'layers.json');
  fs.writeFileSync(file, JSON.stringify(layers, null, 1));
  return path.relative(dir, file).split(path.sep).join('/');
}

/** A font a preset names, as the compositor loads it: family, the page host's /_fonts/ path, style and weight range. */
export type PresetFont = { family: string; url: string; style: string; weight: string };

/**
 * The style's text presets and finishes (the kit's general ones when the style has none), and the fonts they name that
 * this machine has, for the editor's preview. The fonts are picked the way the kit's composeSpec picks them, so the
 * preview draws text with the same faces the export does.
 */
export async function stylePresets(style: string): Promise<{ presets: Record<string, unknown>; all: Record<string, unknown>; finishes: string[]; fonts: PresetFont[] }> {
  process.env.CW_FONT_DIRS ||= fontDirs().join(path.delimiter);
  const lib = await import(pathToFileURL(path.join(KIT_DIR, 'lib', 'compose.mjs')).href) as { textPresets: (style?: string) => { presets: Record<string, { font?: string; fontFile?: string }>; all: Record<string, { font?: string; fontFile?: string }>; finishes: string[] } };
  const { listFonts } = await import(pathToFileURL(path.join(KIT_DIR, 'lib', 'browser.mjs')).href) as { listFonts: () => { name: string; url: string }[] };
  const { presets, all, finishes } = lib.textPresets(style);
  const available = new Map(listFonts().map(f => [f.name, f.url]));
  const defaults: Record<string, string> = { 'Noto Sans SC': 'NotoSansSCwght.ttf', 'Noto Serif SC': 'NotoSerifSC[wght].ttf' };
  const fonts: PresetFont[] = [];
  for (const preset of Object.values(all)) {
    const name = preset.fontFile || defaults[preset.font ?? ''];
    const fontStyle = /Italic/i.test(name || '') ? 'italic' : 'normal';
    if (!name || !preset.font || !available.has(name) || fonts.some(f => f.family === preset.font && f.style === fontStyle)) continue;
    const weight = /(?:VF|var|wght|Inter\.ttf|Jost\.ttf|Fraunces\.ttf|Bricolage\.ttf|LeagueSpartan\.ttf)/i.test(name) ? '100 900' : /Black/i.test(name) ? '900' : /SemiBold/i.test(name) ? '600' : /Bold/i.test(name) ? '700' : /Medium/i.test(name) ? '500' : '400';
    fonts.push({ family: preset.font, url: available.get(name)!, style: fontStyle, weight });
  }
  return { presets, all, finishes, fonts };
}

/** Write the person's edits of version n (versions/vN/edited.json). The agent's layers.json is never changed. */
export function saveEdited(id: string, n: number, body: unknown) {
  const { dir, project } = findGeneral(id);
  const version = project.versions.find(v => v.n === n);
  if (!version?.layersUrl) throw new Error('这一版没有分轨，不能编辑');
  const layers = body as GeneralLayers;
  if (layers?.format !== 'opentake.general.layers' || layers.version !== 1) throw new Error('编辑内容的格式不对');
  const timeline = TimelineSchema.parse(layers.timeline);
  const original = JSON.parse(fs.readFileSync(path.join(dir, 'versions', `v${n}`, 'layers.json'), 'utf8')) as GeneralLayers;
  const next: GeneralLayers = { ...original, segments: Array.isArray(layers.segments) ? layers.segments : original.segments, duration: timeline.duration, ending: layers.ending ?? original.ending, finish: layers.finish ?? original.finish, timeline };
  const file = path.join(dir, 'versions', `v${n}`, 'edited.json'), tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 1));
  fs.renameSync(tmp, file);
  return { saved: true, at: new Date().toISOString() };
}

type BurstTool = {
  soundBursts: (ffmpeg: string, file: string, from: number, duration: number) => Promise<{ start: number; end: number }[]>
  MIXED_SECONDS: number; MIXED_SOUNDS: number
};
const burstTool = () => import(pathToFileURL(path.join(KIT_DIR, 'lib', 'sound-bursts.mjs')).href) as Promise<BurstTool>;
/** Sound file `src` of a version (as its page names it), only inside the version's work folder. */
function soundFile(dir: string, n: number, original: GeneralLayers, src: string) {
  const work = path.resolve(dir, original.base ?? `versions/v${n}/work`), file = path.resolve(work, decodeURIComponent(src));
  if (!file.startsWith(work + path.sep) || !fs.existsSync(file)) throw Object.assign(new Error('找不到这段声音的文件'), { status: 404 });
  return file;
}
const readLayers = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as GeneralLayers;
const writeJson = (target: string, value: unknown) => { const tmp = `${target}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 1)); fs.renameSync(tmp, target); };

/**
 * 按声音切开 (S先生 10-31): where the separate sounds are in `duration` seconds of version n's sound file `src` from
 * second `from` of the file, in seconds from `from` (kit/lib/sound-bursts.mjs, the same rule `hfx check` uses).
 */
export async function soundsOf(id: string, n: number, src: string, from: number, duration: number) {
  const { dir } = findGeneral(id);
  const file = soundFile(dir, n, readLayers(path.join(dir, 'versions', `v${n}`, 'layers.json')), src);
  return (await burstTool()).soundBursts(ffmpegPath(), file, Math.max(0, from), Math.max(0, duration));
}

/** How long each sound file of version n is (seconds), for the timeline's waveforms. */
export async function soundFilesOf(id: string, n: number) {
  const { dir } = findGeneral(id);
  const original = readLayers(path.join(dir, 'versions', `v${n}`, 'layers.json'));
  const srcs = new Set(original.timeline.tracks.flatMap(t => t.clips).filter(c => c.params.hf === true && c.params.tag === 'audio' && typeof c.params.src === 'string').map(c => String(c.params.src)));
  const out: Record<string, number> = {};
  for (const src of srcs) {
    try {
      const { stdout } = await promisify(execFile)(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', soundFile(dir, n, original, src)]);
      if (Number(stdout) > 0) out[src] = Number(stdout);
    } catch { /* a file that is gone draws no waveform */ }
  }
  return out;
}

/** 动效卡变速: which of the version's scene pages can play at another speed (hf-speed.ts), by their paths. */
export function sceneSpeedsOf(id: string, n: number) {
  const { dir } = findGeneral(id);
  const folder = path.join(dir, 'versions', `v${n}`);
  return speedableScenes(path.join(folder, 'work'), readLayers(path.join(folder, 'layers.json')));
}

/** The waveform of a version's sound file: its peaks (as the 口播 timeline draws a voice) or its picture (music, effects). */
const waveforms = new Map<string, Promise<Buffer>>();
export function soundWaveform(id: string, n: number, src: string, kind: 'peaks' | 'picture') {
  const { dir } = findGeneral(id);
  const file = soundFile(dir, n, readLayers(path.join(dir, 'versions', `v${n}`, 'layers.json')), src), stat = fs.statSync(file);
  const key = `${kind}:${file}:${stat.size}:${stat.mtimeMs}`;
  let made = waveforms.get(key);
  if (!made) {
    made = kind === 'peaks'
      ? (async () => { const { stdout } = await promisify(execFile)(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]); const peaks = await decodeAudioPeaks(file, Number(stdout) || 1, ffmpegPath()); return Buffer.from(peaks.buffer, peaks.byteOffset, peaks.byteLength); })()
      : promisify(execFile)(ffmpegPath(), ['-v', 'error', '-i', file, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=2400x72:colors=0x9de3db', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
        { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }).then(r => r.stdout as Buffer);
    made.catch(() => waveforms.delete(key));
    if (waveforms.size > 64) waveforms.delete(waveforms.keys().next().value!);
    waveforms.set(key, made);
  }
  return made;
}

/**
 * 音效一声一段 for a version made before that rule (S先生 10-31: 打开就自动切开): each effect strip that holds several
 * sounds (the rule `hfx check` uses) is cut at the quiet between them, as 按声音切开 does, in the person's edits.
 * Done once per version (upgrades.json); a strip the person put back together later stays as it is.
 */
export async function splitMixedSounds(id: string, n: number) {
  const { dir } = findGeneral(id);
  const folder = path.join(dir, 'versions', `v${n}`), file = path.join(folder, 'layers.json'), marker = path.join(folder, 'upgrades.json');
  if (!fs.existsSync(file)) return { split: 0 };
  const done = (() => { try { return JSON.parse(fs.readFileSync(marker, 'utf8')) as Record<string, unknown>; } catch { return {}; } })();
  const original = readLayers(file);
  if (original.engine !== 'hyperframes' || done.sounds) return { split: 0 };
  const editedFile = path.join(folder, 'edited.json');
  const edited = fs.existsSync(editedFile) ? readLayers(editedFile) : structuredClone(original);
  const tool = await burstTool();
  const split = await splitMixedStrips(edited.timeline, async clip => tool.soundBursts(ffmpegPath(), soundFile(dir, n, original, String(clip.params.src)), clip.sourceStart ?? 0, clip.duration * (Number(clip.params.speed ?? 1) || 1)),
    { seconds: tool.MIXED_SECONDS, sounds: tool.MIXED_SOUNDS });
  if (split) writeJson(editedFile, edited);
  writeJson(marker, { ...done, sounds: true });
  return { split };
}

/** A version opened in the editor, brought up to the current rules once: captions line by line, effects one by one. */
export async function upgradeVersion(id: string, n: number) {
  const lines = upgradeCaptionLines(id, n), sounds = await splitMixedSounds(id, n);
  return { changed: lines.changed || sounds.split > 0, lines: lines.changed, sounds: sounds.split };
}

/**
 * A HyperFrames version read before 字幕一句一条 (S先生 10-31): its caption page's clip becomes its lines, in the
 * tracks as read (layers.json, derived from the page, which stays as the agent wrote it) and in the person's edits
 * (the lines follow where the person put the whole page). Done once; later calls change nothing.
 */
export function upgradeCaptionLines(id: string, n: number) {
  const { dir } = findGeneral(id);
  const folder = path.join(dir, 'versions', `v${n}`), file = path.join(folder, 'layers.json');
  if (!fs.existsSync(file)) return { changed: false };
  const original = JSON.parse(fs.readFileSync(file, 'utf8')) as GeneralLayers;
  if (original.engine !== 'hyperframes') return { changed: false };
  const hosts = new Map((original.timeline.tracks.find(t => t.id === 'g-text')?.clips ?? [])
    .filter(c => c.params.hf === true && typeof c.params.sub === 'string' && c.params.line !== true).map(c => [c.id, structuredClone(c)]));
  const work = path.resolve(dir, original.base ?? `versions/v${n}/work`);
  if (!hosts.size || !expandCaptionLines(original.timeline, work)) return { changed: false };
  const editedFile = path.join(folder, 'edited.json');
  if (fs.existsSync(editedFile)) {
    const edited = JSON.parse(fs.readFileSync(editedFile, 'utf8')) as GeneralLayers;
    expandCaptionLines(edited.timeline, work, hosts);
    writeJson(editedFile, edited);
  }
  writeJson(file, original);
  return { changed: true };
}
