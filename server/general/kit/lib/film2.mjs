// film.json version 2: a layered film (docs/通用剪辑-分轨出片格式.md). Segments tile the film; picture pages, footage,
// text, voice, music and sfx are separate tracks with stable ids. OpenTake mixes the sound, renders the text, the
// transitions and the whole-film finish, so the agent only describes them.
import fs from 'node:fs';
import path from 'node:path';

export const TRANSITIONS = { cut: 0, dissolve: 0.5, fade: 0.5, 'dip-black': 0.3, 'dip-white': 0.3 };
export const LAYERS = ['overlay', 'full', 'composite'];
// the nine cells of the frame (left / right are the middle row's sides)
export const PLACES = ['bottom', 'top', 'center', 'lower-left', 'lower-right', 'upper-left', 'upper-right', 'left', 'right'];
/** A text's size, a step around its preset's own (the person's 小 / 中 / 大). */
export const SIZES = ['small', 'mid', 'large'];
export const REVEALS = ['none', 'fade', 'line', 'word'];
export const ROLES = ['title', 'caption', 'label'];
export const VOLUMES = { low: -8, mid: 0, high: 4 };
/** A clip's gain in dB: one of the three steps, or (from the editor's track faders) a number of dB, -60 to +20. */
export const volumeDb = v => (typeof v === 'number' ? v : VOLUMES[v] ?? 0);
const ID = /^[A-Za-z0-9-]{1,48}$/;
const EPS = 1e-6;

export const isLayered = film => film && Number(film.version) === 2;

/** Validate a version-2 film and return it with numbers filled in. Throws one readable error listing every problem. */
export function normalizeFilm2(film, dir, mediaDir) {
  const problems = [];
  const bad = msg => problems.push(msg);
  const w = Number(film.width), h = Number(film.height), fps = Number(film.fps || 30), duration = Number(film.duration);
  if (!(w >= 16 && h >= 16 && w % 2 === 0 && h % 2 === 0)) bad('width / height 要是偶数像素（例如 1920 × 1080）');
  if (!(fps > 0 && fps <= 60)) bad('fps 要在 1–60 之间');
  if (!(duration > 0)) bad('duration（成片秒数）要大于 0');
  const ids = new Set();
  const takeId = (raw, label) => {
    const id = String(raw?.id ?? '');
    if (!ID.test(id)) bad(`${label} 的 id 只能用字母、数字和短横线`);
    else if (ids.has(id)) bad(`${label} 的 id「${id}」重复了，全片要唯一`);
    ids.add(id);
    return id;
  };
  const span = (raw, label, { needEnd = true } = {}) => {
    const start = Number(raw?.start), end = raw?.end === undefined && !needEnd ? undefined : Number(raw?.end);
    if (!(start >= 0)) bad(`${label} 的 start 要 ≥ 0`);
    if (end !== undefined && !(end > start)) bad(`${label} 的 end 要大于 start`);
    if (end !== undefined && end > duration + EPS) bad(`${label} 的 end（${end}）超过了片长 ${duration}`);
    return { start, end };
  };
  const list = (key) => { const v = film[key]; if (v === undefined) return []; if (!Array.isArray(v)) { bad(`${key} 要是数组`); return []; } return v; };
  const exists = (rel) => rel && fs.existsSync(path.isAbsolute(rel) ? rel : path.join(dir, rel));
  const volume = (raw, label) => {
    const v = raw?.volume ?? 'mid';
    if (typeof v === 'number' ? !(Number.isFinite(v) && v >= -60 && v <= 20) : !(v in VOLUMES)) bad(`${label} 的 volume 只能是 low / mid / high（或 -60 到 20 的分贝数）`);
    return v;
  };

  // segments: contiguous, covering [0, duration]
  const segments = list('segments').map((raw, i) => {
    const label = `segments[${i}]${raw?.name ? `「${raw.name}」` : ''}`;
    const id = takeId(raw, label), { start, end } = span(raw, label);
    const transition = raw?.transition ?? 'cut';
    if (!(transition in TRANSITIONS)) bad(`${label} 的 transition 只能是：${Object.keys(TRANSITIONS).join(' / ')}`);
    if (i === 0 && !['cut', 'fade'].includes(transition)) bad(`${label} 是第一段，transition 只能是 cut 或 fade（片头淡入）`);
    if (!raw?.name) bad(`${label} 缺少 name（段名）`);
    return { id, name: String(raw?.name || `第 ${i + 1} 段`), start, end, transition };
  });
  if (!segments.length) bad('segments 至少要有一段');
  segments.forEach((s, i) => {
    const expect = i === 0 ? 0 : segments[i - 1].end;
    if (Math.abs(s.start - expect) > EPS) bad(`segments[${i}]「${s.name}」要从 ${expect} 秒开始（分段首尾相接，不能有空隙或重叠）`);
    const d = TRANSITIONS[s.transition] ?? 0, prev = segments[i - 1];
    if (i > 0 && d && (s.end - s.start < d || prev.end - prev.start < d)) bad(`segments[${i}]「${s.name}」比它的转场还短`);
  });
  if (segments.length && Math.abs(segments.at(-1).end - duration) > EPS) bad(`最后一段要在片长 ${duration} 秒结束`);
  const ending = film.ending ?? 'cut';
  if (!['cut', 'fade'].includes(ending)) bad('ending 只能是 cut 或 fade（片尾淡出）');
  const finish = film.finish ?? 'none';
  const segmentOf = (start, end) => segments.find(s => start >= s.start - EPS && end <= s.end + EPS);
  const inSegment = (clip, label) => { if (segments.length && Number.isFinite(clip.start) && Number.isFinite(clip.end) && !segmentOf(clip.start, clip.end)) bad(`${label}（${clip.start}–${clip.end}）跨了段，每个片段要完整落在一段里`); };

  const picture = list('picture').map((raw, i) => {
    const label = `picture[${i}]${raw?.page ? `（${raw.page}）` : ''}`;
    const clip = { id: takeId(raw, label), ...span(raw, label), page: String(raw?.page ?? ''), layer: raw?.layer ?? 'overlay', uses: Array.isArray(raw?.uses) ? raw.uses.map(String) : [] };
    if (raw?.edits !== undefined) {
      if (!raw.edits || typeof raw.edits !== 'object' || Array.isArray(raw.edits) || Object.entries(raw.edits).some(([key, value]) => !key || typeof value !== 'string')) bad(`${label} 的 edits 要是 {名字: 文字}，名字不能为空`);
      else clip.edits = { ...raw.edits };
    }
    if (raw?.overrides !== undefined) {
      const ok = raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides) && Object.entries(raw.overrides).every(([key, o]) => key && o && typeof o === 'object'
        && ['dx', 'dy'].every(k => o[k] === undefined || Number.isFinite(o[k])) && (o.size === undefined || SIZES.includes(o.size)) && (o.rotate === undefined || (Number.isFinite(o.rotate) && o.rotate % 15 === 0 && Math.abs(o.rotate) <= 180)));
      if (!ok) bad(`${label} 的 overrides 要是 {选择器: {dx, dy, size, rotate}}`);
      else clip.overrides = structuredClone(raw.overrides);
    }
    if (!clip.page || !exists(clip.page)) bad(`${label} 的页面 ${clip.page || '（没写）'} 不存在`);
    if (!LAYERS.includes(clip.layer)) bad(`${label} 的 layer 只能是 overlay / full / composite`);
    if (clip.layer === 'composite' && !clip.uses.length) bad(`${label} 是合成页，要在 uses 里写明用到的素材`);
    inSegment(clip, label);
    return clip;
  });

  const footage = list('footage').map((raw, i) => {
    const label = `footage[${i}]${raw?.media ? `（${raw.media}）` : ''}`;
    const clip = {
      id: takeId(raw, label), ...span(raw, label), media: String(raw?.media ?? ''), in: Number(raw?.in ?? 0), speed: Number(raw?.speed ?? 1),
      reverse: Boolean(raw?.reverse), fit: raw?.fit ?? 'cover', focus: Array.isArray(raw?.focus) ? raw.focus.map(Number) : [0.5, 0.5],
      move: raw?.move, sound: Boolean(raw?.sound), volume: volume(raw, label),
    };
    if (!clip.media || path.basename(clip.media) !== clip.media) bad(`${label} 的 media 只写素材文件名`);
    else if (mediaDir && !fs.existsSync(path.join(mediaDir, clip.media))) bad(`${label} 的素材 ${clip.media} 不在用户素材里`);
    if (!(clip.in >= 0)) bad(`${label} 的 in 要 ≥ 0`);
    if (!(clip.speed >= 0.25 && clip.speed <= 4)) bad(`${label} 的 speed 要在 0.25–4 之间`);
    if (!['cover', 'contain'].includes(clip.fit)) bad(`${label} 的 fit 只能是 cover 或 contain`);
    if (clip.focus.length !== 2 || clip.focus.some(v => !(v >= 0 && v <= 1))) bad(`${label} 的 focus 要是 [x, y]，都在 0–1 之间`);
    if (clip.move !== undefined) {
      const ok = p => p && Number(p.zoom) >= 1 && Number(p.zoom) <= 1.5 && Array.isArray(p.focus) && p.focus.length === 2 && p.focus.every(v => Number(v) >= 0 && Number(v) <= 1);
      if (!ok(clip.move.from) || !ok(clip.move.to)) bad(`${label} 的 move 要写 from / to，各有 zoom（1–1.5）和 focus [x, y]`);
      else clip.move = { from: { zoom: Number(clip.move.from.zoom), focus: clip.move.from.focus.map(Number) }, to: { zoom: Number(clip.move.to.zoom), focus: clip.move.to.focus.map(Number) } };
    }
    inSegment(clip, label);
    return clip;
  });

  const text = list('text').map((raw, i) => {
    const label = `text[${i}]${raw?.text ? `「${String(raw.text).slice(0, 12)}」` : ''}`;
    const clip = { id: takeId(raw, label), ...span(raw, label), role: raw?.role ?? 'caption', text: String(raw?.text ?? ''), preset: String(raw?.preset ?? ''), place: raw?.place ?? 'bottom', reveal: raw?.reveal ?? 'fade' };
    if (!clip.text.trim()) bad(`${label} 的 text 是空的`);
    if (!ROLES.includes(clip.role)) bad(`${label} 的 role 只能是 title / caption / label`);
    if (!PLACES.includes(clip.place)) bad(`${label} 的 place 只能是：${PLACES.join(' / ')}`);
    if (!REVEALS.includes(clip.reveal)) bad(`${label} 的 reveal 只能是：${REVEALS.join(' / ')}`);
    if (!clip.preset) bad(`${label} 缺少 preset（文字样式预设名）`);
    // optional, set by the person in OpenTake: a size step and a turn in 15° steps
    if (raw?.size !== undefined) { if (!SIZES.includes(raw.size)) bad(`${label} 的 size 只能是：${SIZES.join(' / ')}`); clip.size = raw.size; }
    if (raw?.rotate !== undefined) { const r = Number(raw.rotate); if (!Number.isFinite(r) || r % 15 !== 0 || Math.abs(r) > 180) bad(`${label} 的 rotate 只能是 -180 到 180 之间 15 的倍数`); clip.rotate = r; }
    inSegment(clip, label);
    return clip;
  });

  const sound = (key, { span: needEnd, label: needLabel, text: needText }) => list(key).map((raw, i) => {
    const label = `${key}[${i}]${raw?.src ? `（${raw.src}）` : ''}`;
    const clip = { id: takeId(raw, label), ...span(raw, label, { needEnd }), src: String(raw?.src ?? ''), in: Number(raw?.in ?? 0), volume: volume(raw, label) };
    if (!clip.src || !exists(clip.src)) bad(`${label} 的声音文件 ${clip.src || '（没写）'} 不存在`);
    if (!(clip.in >= 0)) bad(`${label} 的 in 要 ≥ 0`);
    if (needLabel) { clip.label = String(raw?.label ?? ''); if (!clip.label) bad(`${label} 要写 label（两三个字，显示在轨道上）`); }
    if (needText) { clip.text = String(raw?.text ?? ''); if (!clip.text) bad(`${label} 要写旁白原文 text`); }
    if (key !== 'music' && clip.end !== undefined) inSegment(clip, label);
    else if (key !== 'music') { const seg = segmentOf(clip.start, clip.start); if (segments.length && !seg) bad(`${label} 的 start 不在任何一段里`); }
    return clip;
  });
  const voice = sound('voice', { span: false, text: true });
  const music = sound('music', { span: true });
  const sfx = sound('sfx', { span: false, label: true });

  const overlaps = (clips, label) => {
    const sorted = [...clips].filter(c => Number.isFinite(c.start) && Number.isFinite(c.end)).sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end - EPS) bad(`${label} 轨的「${sorted[i - 1].id}」和「${sorted[i].id}」重叠了，同一轨的片段不能重叠`);
  };
  // Text items are ordered visual layers; simultaneous captions keep array painter order.
  overlaps(picture, 'picture'); overlaps(footage, 'footage'); overlaps(music, 'music');
  overlaps(voice.filter(v => v.end !== undefined), 'voice');
  // footage stays empty under full and composite pages
  for (const p of picture.filter(p => p.layer !== 'overlay')) for (const f of footage) if (f.start < p.end - EPS && f.end > p.start + EPS) bad(`footage「${f.id}」和${p.layer === 'full' ? '整屏' : '合成'}页「${p.id}」时间重叠：这段时间素材轨要留空`);
  const locked = Array.isArray(film.locked) ? film.locked.map(String) : [];

  if (problems.length) throw new Error(`film.json 有问题：\n- ${[...new Set(problems)].join('\n- ')}`);
  return {
    version: 2, title: film.title ? String(film.title) : undefined, logline: film.logline ? String(film.logline) : undefined,
    width: w, height: h, fps, duration, segments, ending, finish, picture, footage, text, voice, music, sfx, locked,
    // v1 commands that only need a list of named spans read these
    shots: [], audio: undefined,
  };
}

/** Footage-frame index (1-based) a clip shows at film time t, after its speed and reverse. */
export function footageFrameAt(clip, t, fps) {
  const n = Math.max(1, Math.round((clip.end - clip.start) * fps));
  const k = Math.min(n - 1, Math.max(0, Math.floor((t - clip.start) * fps + 1e-6)));
  return k + 1;
}
