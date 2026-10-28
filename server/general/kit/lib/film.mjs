// film.json: the cut. Each shot is one page (window.shot.frame(t)) or a stretch of footage; shots follow each other,
// an optional transition overlaps a shot with the one before it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MEDIA, tool, WORK } from './env.mjs';
import { isLayered, normalizeFilm2 } from './film2.mjs';

export const XFADES = ['fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown',
  'smoothleft', 'smoothright', 'smoothup', 'smoothdown', 'circleopen', 'circleclose', 'radial', 'pixelize', 'zoomin', 'distance', 'hblur'];

export function readFilm(dir = WORK) {
  const file = path.join(dir, 'film.json');
  if (!fs.existsSync(file)) throw new Error('当前目录没有 film.json（见说明书「film.json」一节）');
  let film;
  try { film = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`film.json 不是合法 JSON：${e.message}`); }
  return isLayered(film) ? normalizeFilm2(film, dir, MEDIA) : normalizeFilm(film, dir);
}

/** Validate and compute each shot's start (seconds in the film) and the total length. Throws readable errors. */
export function normalizeFilm(film, dir = WORK) {
  const problems = [];
  const w = Number(film.width), h = Number(film.height), fps = Number(film.fps || 30);
  if (!(w >= 16 && h >= 16 && w % 2 === 0 && h % 2 === 0)) problems.push('width / height 要是偶数像素（例如 1920 × 1080）');
  if (!(fps > 0 && fps <= 60)) problems.push('fps 要在 1–60 之间');
  if (!Array.isArray(film.shots) || !film.shots.length) problems.push('shots 至少要有一个镜头');
  const shots = [];
  let end = 0;
  (film.shots || []).forEach((raw, i) => {
    const label = `shots[${i}]${raw?.name ? `「${raw.name}」` : ''}`;
    const dur = Number(raw?.dur);
    if (!(dur > 0)) problems.push(`${label} 缺少 dur（秒）`);
    if (!raw?.page === !raw?.video) problems.push(`${label} 要有 page（页面）或 video（素材）其中一个`);
    if (raw?.page && !fs.existsSync(path.join(dir, raw.page))) problems.push(`${label} 的页面 ${raw.page} 不存在`);
    if (raw?.video && !fs.existsSync(path.isAbsolute(raw.video) ? raw.video : path.join(dir, raw.video))) problems.push(`${label} 的素材 ${raw.video} 不存在`);
    const tr = raw?.transition;
    let tdur = 0;
    if (tr) {
      if (i === 0) problems.push(`${label} 是第一个镜头，不能有 transition`);
      if (!XFADES.includes(tr.type)) problems.push(`${label} 的 transition.type 只能是：${XFADES.join(' ')}`);
      tdur = Number(tr.dur);
      if (!(tdur > 0)) problems.push(`${label} 的 transition.dur 要大于 0`);
      const prev = shots[i - 1];
      if (prev && (tdur >= dur || tdur >= prev.dur)) problems.push(`${label} 的转场比前后镜头还长`);
    }
    const start = i === 0 ? 0 : end - tdur;
    const shot = { index: i, name: String(raw?.name || `镜头 ${i + 1}`), dur, start, end: start + dur, page: raw?.page, video: raw?.video, in: Number(raw?.in || 0), transition: tr ? { type: tr.type, dur: tdur } : undefined };
    shots.push(shot);
    end = shot.end;
  });
  if (problems.length) throw new Error(`film.json 有问题：\n- ${problems.join('\n- ')}`);
  const segments = Array.isArray(film.segments) && film.segments.length
    ? film.segments.map(s => ({ name: String(s.name), start: Number(s.start), end: Number(s.end) }))
    : shots.map(s => ({ name: s.name, start: round(s.start), end: round(s.end) }));
  return { title: film.title ? String(film.title) : undefined, logline: film.logline ? String(film.logline) : undefined, width: w, height: h, fps, shots, duration: round(end), segments, audio: film.audio ? String(film.audio) : undefined };
}
export const round = x => Math.round(x * 1000) / 1000;
export const frames = (seconds, fps) => Math.max(1, Math.round(seconds * fps));

/** The shot that shows film time t (during a transition: the incoming shot). */
export function shotAt(film, t) {
  for (let i = film.shots.length - 1; i >= 0; i--) if (t >= film.shots[i].start - 1e-9) return { shot: film.shots[i], local: Math.min(film.shots[i].dur, Math.max(0, t - film.shots[i].start)) };
  return { shot: film.shots[0], local: 0 };
}

export function run(cmd, args, { cwd = WORK, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ out, err }) : reject(new Error(`${path.basename(cmd)} 失败（退出码 ${code}）：${err.trim().split('\n').slice(-6).join('\n')}`)));
    if (input) { child.stdin.end(input); }
  });
}
export const ffmpeg = (args, opts) => run(tool('ffmpeg'), ['-hide_banner', '-y', '-loglevel', 'error', ...args], opts);
export async function probe(file) {
  const { out } = await run(tool('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,sample_rate,channels', '-of', 'json', file]);
  return JSON.parse(out);
}

/** Merge fields into progress.json (what OpenTake shows while the agent works). */
export function writeProgress(fields, dir = WORK) {
  const file = path.join(dir, 'progress.json');
  let current = {};
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first write */ }
  const next = { ...current, ...fields, at: new Date().toISOString() };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return next;
}

/**
 * Video encoder for the kit's intermediate files. VideoToolbox first; inside the agent's sandbox it is refused
 * (-12908), so fall back to the LGPL build's software VP9 in the same MP4. OpenTake re-encodes a non-H.264 delivery
 * to H.264 outside the sandbox. Never reach for another ffmpeg (e.g. the one inside /Applications/OpenTake.app).
 */
let encoderChoice;
export async function videoEncoder(fps) {
  // CW_ENCODER=vp9 forces the sandbox path (tests)
  if (process.env.CW_ENCODER === 'vp9') encoderChoice ??= Promise.resolve('vp9');
  if(process.platform==='win32')encoderChoice ??= ffmpeg(['-f','lavfi','-i','color=c=gray:s=64x64:d=0.1','-frames:v','2','-c:v','h264_mf','-b:v','1M','-f','null','-']).then(()=>'mf',()=> 'vp9');
  encoderChoice ??= ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=0.1', '-frames:v', '2', '-c:v', 'h264_videotoolbox', '-q:v', '70', '-f', 'null', '-'])
    .then(() => 'videotoolbox', () => 'vp9');
  const g = String(Math.round(fps * 2));
  if((await encoderChoice)==='mf')return ['-c:v','h264_mf','-b:v','12M','-g',g,'-pix_fmt','nv12','-r',String(fps)];
  return (await encoderChoice) === 'videotoolbox'
    ? ['-c:v', 'h264_videotoolbox', '-q:v', '70', '-g', g, '-pix_fmt', 'yuv420p', '-r', String(fps)]
    : ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '30', '-b:v', '0', '-g', g, '-pix_fmt', 'yuv420p', '-r', String(fps)];
}
