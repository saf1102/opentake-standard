// Node side of the layered film (version 2): prepares the compositor page's inputs, captures frames through it,
// applies segment transitions and the opening / ending fades on the encoded picture, and mixes the sound tracks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { KIT, MEDIA, WORK } from './env.mjs';
import { listFonts } from './browser.mjs';
import { ffmpeg, probe, round } from './film.mjs';
import { TRANSITIONS, volumeDb } from './film2.mjs';

export const COMPOSE_PAGE = '_kit/web/compose.html';
export const FINISHES = ['none', 'grain', 'vignette', 'scanlines', 'paper', 'halftone'];
const CACHE = () => path.join(WORK, '.tmp', 'compose');

/**
 * Text presets and finishes: the style's own set (what a new film may use and the editor offers); the general set when
 * the style has no file. `all` also holds the general presets, so a film made before its style had presets still draws
 * as it was delivered.
 */
export function textPresets(style = process.env.CW_STYLE) {
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; } };
  const base = read(path.join(KIT, 'web', 'text-presets.json')) || { presets: {}, finishes: ['none'] };
  const own = style && /^[a-z0-9-]+$/.test(style) ? read(path.join(KIT, 'styles', style, 'text-presets.json')) : undefined;
  return { presets: own?.presets || base.presets, all: { ...base.presets, ...own?.presets }, finishes: own?.finishes?.length ? [...new Set(['none', ...own.finishes])] : base.finishes, style: own ? style : undefined };
}

/** Problems a version-2 film has against things normalizeFilm2 can't see: media lengths and preset / finish names. */
export async function checkLayered(film) {
  const problems = [];
  // the agent must use its style's own presets and finishes; an export (CW_EXPORT) only needs what the film names to exist,
  // so a version delivered before its style had them still exports as it was delivered
  const exporting = Boolean(process.env.CW_EXPORT);
  const { presets, all, finishes } = textPresets();
  const known = exporting ? all : presets;
  for (const item of film.text) if (!known[item.preset]) problems.push(`text「${item.id}」的 preset「${item.preset}」不存在，可用：${Object.keys(presets).join('、')}`);
  if (!FINISHES.includes(film.finish) || (!exporting && !finishes.includes(film.finish))) problems.push(`finish「${film.finish}」不可用，本风格可选：${finishes.join('、')}`);
  const lengths = new Map();
  for (const clip of film.footage) {
    const file = path.join(MEDIA, clip.media);
    if (!lengths.has(file)) lengths.set(file, Number((await probe(file)).format.duration));
    const need = clip.in + (clip.end - clip.start) * clip.speed;
    if (need > lengths.get(file) + 0.05) problems.push(`footage「${clip.id}」要用到素材 ${clip.media} 的第 ${round(need)} 秒，但素材只有 ${round(lengths.get(file))} 秒`);
  }
  return problems;
}

/** Footage frames for every clip, already speed-changed, reversed and scaled; cached by everything that affects them. */
async function footageFrames(film) {
  const out = {};
  for (const clip of film.footage) {
    const n = Math.max(1, Math.round((clip.end - clip.start) * film.fps));
    const zoom = clip.move ? Math.max(clip.move.from.zoom, clip.move.to.zoom) : 1;
    const size = clip.fit === 'contain' ? `scale=${film.width}:${film.height}:force_original_aspect_ratio=decrease` : `scale=${Math.ceil(film.width * zoom / 2) * 2}:${Math.ceil(film.height * zoom / 2) * 2}:force_original_aspect_ratio=increase`;
    const file = path.join(MEDIA, clip.media), stat = fs.statSync(file);
    const key = crypto.createHash('sha1').update(JSON.stringify([clip.media, stat.size, stat.mtimeMs, clip.in, clip.speed, clip.reverse, n, film.fps, size])).digest('hex').slice(0, 16);
    const dir = path.join(CACHE(), 'footage', `${clip.id}-${key}`);
    if (!fs.existsSync(path.join(dir, 'done'))) {
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const span = (clip.end - clip.start) * clip.speed + 2 / film.fps;
      const vf = [clip.reverse ? 'reverse' : '', `setpts=(PTS-STARTPTS)/${clip.speed}`, `fps=${film.fps}`, size, 'setsar=1'].filter(Boolean).join(',');
      await ffmpeg(['-ss', String(clip.in), '-t', String(span), '-i', file, '-an', '-vf', vf, '-frames:v', String(n), '-q:v', '3', path.join(dir, '%05d.jpg')]);
      fs.writeFileSync(path.join(dir, 'done'), '');
    }
    const count = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).length;
    if (!count) throw new Error(`素材 ${clip.media} 没有解出画面（footage「${clip.id}」）`);
    out[clip.id] = { dir: path.relative(WORK, dir).split(path.sep).join('/'), count };
  }
  return out;
}

/** Write the compositor's input and return the page and query to open it with. */
export async function composeSpec(film) {
  fs.mkdirSync(CACHE(), { recursive: true });
  const { all: presets } = textPresets(); // draw whatever preset the film names, the general ones included
  const frames = await footageFrames(film);
  const file = path.join(CACHE(), 'spec.json');
  // fonts the presets name, when this machine has them; otherwise text.js falls back to PingFang SC
  const available = new Map(listFonts().map(f => [f.name, f.url]));
  const defaults = { 'Noto Sans SC': 'NotoSansSCwght.ttf', 'Noto Serif SC': 'NotoSerifSC[wght].ttf' };
  const fonts = [];
  for (const preset of Object.values(presets)) {
    const name = preset.fontFile || defaults[preset.font];
    const style = /Italic/i.test(name || '') ? 'italic' : 'normal';
    if (available.has(name) && !fonts.some(f => f.family === preset.font && f.style === style)) {
      const weight = /(?:VF|var|wght|Inter\.ttf|Jost\.ttf|Fraunces\.ttf|Bricolage\.ttf|LeagueSpartan\.ttf)/i.test(name) ? '100 900' : /Black/i.test(name) ? '900' : /SemiBold/i.test(name) ? '600' : /Bold/i.test(name) ? '700' : /Medium/i.test(name) ? '500' : '400';
      fonts.push({ family: preset.font, url: available.get(name), style, weight });
    }
  }
  fs.writeFileSync(file, JSON.stringify({ film, frames, presets, fonts }));
  return { page: COMPOSE_PAGE, query: `spec=${encodeURIComponent(path.relative(WORK, file).split(path.sep).join('/'))}` };
}

const fade = (start, d, dir) => `fade=t=${dir}:st=${round(start)}:d=${d}`;

/**
 * Apply segment transitions and the opening / ending fades to `raw` (the captured film, no transitions) → `out`.
 * Dissolves and dips get half their length as frozen handles on each side, so the film keeps its length.
 */
export async function finishPicture(film, raw, out, encode) {
  const segs = film.segments;
  const needsWork = film.ending === 'fade' || segs.some(s => s.transition !== 'cut');
  if (!needsWork) { fs.copyFileSync(raw, out); return; }
  const parts = [], labels = [];
  segs.forEach((s, i) => {
    const incoming = i > 0 ? s.transition : 'cut', outgoing = segs[i + 1]?.transition ?? 'cut';
    const pre = ['dissolve', 'dip-black', 'dip-white'].includes(incoming) ? TRANSITIONS[incoming] / 2 : 0;
    const post = ['dissolve', 'dip-black', 'dip-white'].includes(outgoing) ? TRANSITIONS[outgoing] / 2 : 0;
    const len = s.end - s.start, chain = [`trim=start=${round(s.start)}:end=${round(s.end)}`, 'setpts=PTS-STARTPTS'];
    if (pre || post) chain.push(`tpad=start_mode=clone:start_duration=${pre}:stop_mode=clone:stop_duration=${post}`);
    if (incoming === 'fade' || (i === 0 && s.transition === 'fade')) chain.push(fade(pre, 0.5, 'in'));
    if (outgoing === 'fade' || (i === segs.length - 1 && film.ending === 'fade')) chain.push(fade(pre + len - 0.5, 0.5, 'out'));
    parts.push(`[0:v]${chain.join(',')},settb=AVTB,fps=${film.fps},format=yuv420p[s${i}]`);
    labels.push({ label: `s${i}`, len: pre + len + post });
  });
  let acc = labels[0].label, accLen = labels[0].len;
  for (let i = 1; i < segs.length; i++) {
    const t = segs[i].transition, d = TRANSITIONS[t] || 0, next = `j${i}`;
    if (['dissolve', 'dip-black', 'dip-white'].includes(t)) {
      const type = { dissolve: 'dissolve', 'dip-black': 'fadeblack', 'dip-white': 'fadewhite' }[t];
      parts.push(`[${acc}][${labels[i].label}]xfade=transition=${type}:duration=${d}:offset=${round(accLen - d)}[${next}]`);
      accLen += labels[i].len - d;
    } else { parts.push(`[${acc}][${labels[i].label}]concat=n=2:v=1:a=0[${next}]`); accLen += labels[i].len; }
    acc = next;
  }
  await ffmpeg(['-i', raw, '-filter_complex', parts.join(';'), '-map', `[${acc}]`, ...encode, '-movflags', '+faststart', out]);
}

/** Mix voice, music, sfx and footage sound into one 48 kHz stereo WAV the length of the film. Music ducks under voice. */
export async function mixTracks(film, out) {
  const inputs = [], buses = { voice: [], music: [], other: [] };
  const add = (file, clip, bus, extra = []) => {
    const k = inputs.push(file) - 1;
    const len = (clip.end ?? film.duration) - clip.start;
    const chain = [`atrim=start=${clip.in}${clip.end !== undefined ? `:duration=${round(len * (clip.speed || 1))}` : ''}`, 'asetpts=PTS-STARTPTS', ...extra,
      `volume=${volumeDb(clip.volume)}dB`, 'aresample=48000', 'aformat=channel_layouts=stereo', `adelay=${Math.round(clip.start * 1000)}:all=1`];
    buses[bus].push(`[${k}:a]${chain.join(',')}`);
  };
  for (const c of film.voice) add(path.join(WORK, c.src), c, 'voice');
  for (const c of film.music) add(path.join(WORK, c.src), c, 'music');
  for (const c of film.sfx) add(path.join(WORK, c.src), c, 'other');
  for (const c of film.footage.filter(f => f.sound)) {
    const tempo = []; for (let s = c.speed; Math.abs(s - 1) > 1e-6;) { const step = Math.min(2, Math.max(0.5, s)); tempo.push(`atempo=${step}`); s /= step; }
    add(path.join(MEDIA, c.media), c, 'other', [...(c.reverse ? ['areverse'] : []), ...tempo]);
  }
  const filters = [], finals = [];
  const bus = (name, list) => {
    if (!list.length) return undefined;
    list.forEach((f, i) => filters.push(`${f}[${name}${i}]`));
    filters.push(`${list.map((_, i) => `[${name}${i}]`).join('')}amix=inputs=${list.length}:normalize=0:dropout_transition=0[${name}]`);
    return name;
  };
  const voice = bus('voice', buses.voice), music = bus('music', buses.music), other = bus('other', buses.other);
  if (voice && music) {
    filters.push(`[voice]asplit=2[voiceOut][voiceKey]`, `[music][voiceKey]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=350[musicDucked]`);
    finals.push('voiceOut', 'musicDucked');
  } else { if (voice) finals.push(voice); if (music) finals.push(music); }
  if (other) finals.push(other);
  const tail = [`apad`, `atrim=duration=${film.duration}`];
  if (film.ending === 'fade') tail.push(`afade=t=out:st=${round(film.duration - 0.5)}:d=0.5`);
  if (film.segments[0]?.transition === 'fade') tail.push('afade=t=in:st=0:d=0.5');
  if (!finals.length) return undefined;
  filters.push(`${finals.map(f => `[${f}]`).join('')}amix=inputs=${finals.length}:normalize=0:dropout_transition=0,${tail.join(',')}[mix]`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await ffmpeg([...inputs.flatMap(f => ['-i', f]), '-filter_complex', filters.join(';'), '-map', '[mix]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', out]);
  return out;
}
