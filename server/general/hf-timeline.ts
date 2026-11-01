/**
 * The person's timeline edits of a HyperFrames film (S先生 10-31: 时间线解锁, the same way of editing as 口播).
 *
 * They live in versions/vN/edited.json like the words and moves (hf-carry.ts); the agent's index.html is never
 * changed. Whoever reads the film — the preview's page host and the export — reads it through applyTimelineEdits,
 * which writes each clip's timing and sound into HyperFrames' own attributes:
 *   start → data-start, length → data-duration, trim → data-media-start, 变速 → data-playback-rate,
 *   音量 → data-volume, 淡入淡出 → a volume lane in data-automation (clip seconds).
 * A scene played faster or slower says so with data-ot-speed, which OpenTake plays itself (hf-speed.ts).
 * A clip taken off the timeline leaves the page; a pasted copy is a clone of its source element.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import type { GeneralLayers } from '../../src/general/general-contract.ts';
import { timingKey } from '../../src/general/hf-timing.ts';
import { clipSpeed, isScene } from '../../src/general/hf-speed.ts';

export { timingKey };
import type { TimelineClip, TimelineTrack } from '../../src/types/editor.ts';

const MEDIA = new Set(['audio', 'video']);
/** HyperFrames caps a clip's static gain at +12 dB. */
const MAX_VOLUME = 3.98;
const n3 = (value: number) => String(Math.round(value * 1000) / 1000);
const same = (a: number, b: number) => Math.abs(a - b) < 1e-3;

type Point = { t: number; v: number };
type Automation = { version: 1; lanes: { target: string; points: Point[] }[] };

/** 淡入淡出 as HyperFrames' volume lane, each at most half the clip; undefined when there is none. */
export function fadeAutomation(duration: number, fadeIn: number, fadeOut: number): string | undefined {
  const half = duration / 2, fi = Math.min(Math.max(0, fadeIn), half), fo = Math.min(Math.max(0, fadeOut), half);
  if (fi <= 0 && fo <= 0) return undefined;
  const points: Point[] = fi > 0 ? [{ t: 0, v: 0 }, { t: +n3(fi), v: 1 }] : [{ t: 0, v: 1 }];
  points.push(...(fo > 0 ? [{ t: +n3(duration - fo), v: 1 }, { t: +n3(duration), v: 0 }] : [{ t: +n3(duration), v: 1 }]));
  return JSON.stringify({ version: 1, lanes: [{ target: 'volume', points }] } satisfies Automation);
}

/** The volume lane of a data-automation value, if it has one. */
export function volumePoints(value: string | null | undefined): Point[] | undefined {
  if (!value) return undefined;
  try {
    const lane = (JSON.parse(value) as Automation).lanes?.find(l => l.target === 'volume');
    const points = lane?.points?.filter(p => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
    return points?.length ? points : undefined;
  } catch { return undefined; }
}

/** A volume lane read back as fades: a rise from silence at the start and a fall to silence at the end. */
export function fadesOf(value: string | null | undefined, duration: number) {
  const points = volumePoints(value);
  if (!points || points.length < 2) return { fadeIn: 0, fadeOut: 0 };
  const first = points[0], last = points[points.length - 1];
  const fadeIn = first.t <= 1e-3 && first.v <= 1e-3 ? points.find(p => p.v >= 0.999)?.t ?? 0 : 0;
  const lastFull = [...points].reverse().find(p => p.v >= 0.999);
  const fadeOut = Math.abs(last.t - duration) < 0.01 && last.v <= 1e-3 && lastFull ? duration - lastFull.t : 0;
  return { fadeIn: Math.max(0, fadeIn), fadeOut: Math.max(0, fadeOut) };
}

type Placed = { clip: TimelineClip; track: TimelineTrack };
const placed = (layers: GeneralLayers): Placed[] => layers.timeline.tracks.flatMap(track => track.clips.map(clip => ({ clip, track })));
/**
 * Clips the page holds at its root: the ones edits can reach. A scene's clip names the sub-composition it loads
 * (params.sub) and is still an element of the root page; only a caption page's lines live inside their page.
 */
const rootClip = ({ clip }: Placed) => clip.params.hf === true && typeof clip.params.hfId === 'string' && clip.params.line !== true;
/** A line of a caption page (hf-project.ts expandCaptionLines): an element of that page, timed from the film's start. */
const lineClip = ({ clip }: Placed) => clip.params.hf === true && clip.params.line === true && typeof clip.params.sub === 'string' && typeof clip.params.host === 'string';
const editable = (p: Placed) => rootClip(p) || lineClip(p);

/**
 * Where a caption page's clip has to be for its lines as the person placed them: where the agent put it, widened to
 * take in a line moved before or past it (its lines are timed from its start). `lines` are one page's.
 */
export function captionSpan(lines: TimelineClip[]) {
  const from = Number(lines[0].params.hostStart) || 0, to = from + (Number(lines[0].params.hostDuration) || 0);
  return { start: Math.max(0, Math.min(from, ...lines.map(c => c.start))), end: Math.max(to, ...lines.map(c => c.start + c.duration)) };
}
const byHost = (lines: Placed[]) => { const hosts = new Map<string, TimelineClip[]>(); for (const { clip } of lines) hosts.set(String(clip.params.host), [...hosts.get(String(clip.params.host)) ?? [], clip]); return hosts; };
const ROLE: Record<string, string> = { 'g-voice': 'voice', 'g-music': 'music', 'g-sfx': 'sfx' };


function write(el: Element, { clip, track }: Placed, before?: TimelineClip) {
  el.setAttribute('data-start', n3(clip.start));
  el.setAttribute('data-duration', n3(clip.duration));
  if (ROLE[track.id] && el.getAttribute('data-ot-role') && el.getAttribute('data-ot-role') !== ROLE[track.id]) el.setAttribute('data-ot-role', ROLE[track.id]);
  if (!MEDIA.has(el.tagName.toLowerCase())) {
    const rate = isScene(clip) ? clipSpeed(clip) : 1;
    if (!same(rate, 1)) el.setAttribute('data-ot-speed', n3(rate)); else el.removeAttribute('data-ot-speed');
    return;
  }
  if (!before || !same(clip.sourceStart ?? 0, before.sourceStart ?? 0) || el.hasAttribute('data-media-start')) el.setAttribute('data-media-start', n3(clip.sourceStart ?? 0));
  const rate = Number(clip.params.speed ?? 1) || 1;
  if (!same(rate, 1) || el.hasAttribute('data-playback-rate')) el.setAttribute('data-playback-rate', n3(rate));
  const volume = track.muted ? 0 : Math.min(MAX_VOLUME, Math.max(0, clip.volume ?? 1));
  if (!before || !same(volume, before.volume ?? 1) || track.muted || el.hasAttribute('data-volume')) el.setAttribute('data-volume', n3(volume));
  // the agent's own lane (ducking, a swell) stays unless the person changed the fades or the clip's length
  const fadesChanged = !before || !same(clip.fadeIn ?? 0, before.fadeIn ?? 0) || !same(clip.fadeOut ?? 0, before.fadeOut ?? 0) || !same(clip.duration, before.duration);
  if (fadesChanged) {
    const lane = fadeAutomation(clip.duration, clip.fadeIn ?? 0, clip.fadeOut ?? 0);
    if (lane) el.setAttribute('data-automation', lane); else el.removeAttribute('data-automation');
  }
}

/**
 * index.html as the person edited it. `original` is the version as the agent delivered it (layers.json), `edited`
 * the person's (edited.json). Without timeline changes the page comes back as it was.
 */
export function applyTimelineEdits(html: string, edited: GeneralLayers, original: GeneralLayers): string {
  if (edited.engine !== 'hyperframes' || timingKey(edited) === timingKey(original)) return html;
  const { document } = parseHTML(html);
  const root = document.querySelector('[data-composition-id]');
  if (!root) return html;
  const childById = new Map<string, Element>();
  for (const el of [...root.children]) { const id = el.getAttribute('data-hf-id'); if (id) childById.set(id, el); }
  const before = new Map(placed(original).filter(rootClip).map(p => [p.clip.id, p.clip]));
  const now = placed(edited).filter(rootClip);
  // copies first, cloned from the elements as the agent wrote them
  for (const p of now) {
    const source = String(p.clip.params.hfId);
    if (p.clip.id === source || childById.has(p.clip.id)) continue;
    const from = childById.get(source);
    if (!from) continue;
    const copy = from.cloneNode(true) as Element;
    copy.setAttribute('data-hf-id', p.clip.id);
    const id = from.getAttribute('id');
    if (id) copy.setAttribute('id', `${id}-${p.clip.id.replace(/[^\w-]/g, '').slice(0, 8)}`);
    from.after(copy);
    childById.set(p.clip.id, copy);
  }
  const kept = new Set<string>();
  for (const p of now) {
    const el = childById.get(p.clip.id);
    if (!el) continue;
    kept.add(p.clip.id);
    // a hidden track shows and plays nothing
    if (p.track.hidden) { el.remove(); continue; }
    write(el, p, before.get(p.clip.id));
  }
  // what the person took off the timeline leaves the film
  for (const id of before.keys()) if (!kept.has(id)) childById.get(id)?.remove();
  // a caption page shown line by line: its clip covers its lines; a hidden 字幕 track shows none
  const lines = placed(edited).filter(lineClip), was = byHost(placed(original).filter(lineClip));
  for (const [host, clips] of byHost(lines)) {
    const el = childById.get(host);
    if (!el) continue;
    if (lines.find(p => p.clip.params.host === host)!.track.hidden) { el.remove(); continue; }
    const span = captionSpan(clips), from = Number(clips[0].params.hostStart) || 0, length = Number(clips[0].params.hostDuration) || 0;
    if (!same(span.start, from) || !same(span.end - span.start, length)) { el.setAttribute('data-start', n3(span.start)); el.setAttribute('data-duration', n3(span.end - span.start)); }
  }
  // every line of a page deleted: the page shows nothing
  for (const host of was.keys()) if (!lines.some(p => p.clip.params.host === host)) childById.get(host)?.remove();
  const out = String(document);
  return /^\s*<!doctype/i.test(html) && !/^\s*<!doctype/i.test(out) ? `<!doctype html>\n${out}` : out;
}

/** The root page of version folder `folder` as the person edited it (its edited.json over its layers.json). */
export function editedHyperframes(folder: string, html: string) {
  const edited = path.join(folder, 'edited.json'), original = path.join(folder, 'layers.json');
  if (!fs.existsSync(edited) || !fs.existsSync(original)) return html;
  try { return applyTimelineEdits(html, JSON.parse(fs.readFileSync(edited, 'utf8')), JSON.parse(fs.readFileSync(original, 'utf8'))); }
  catch { return html; }
}

const samePath = (a: string, b: string) => path.posix.normalize(decodeURIComponent(a)) === path.posix.normalize(decodeURIComponent(b));
const lineKey = (lines: Placed[]) => JSON.stringify(lines.map(({ clip }) => [clip.id, n3(clip.start), n3(clip.duration)]));

/**
 * Caption page `sub` (its path as the root page names it) with its lines where the person put them: moved, trimmed,
 * deleted, copied. Their words are edited live like any text of the film (hfPageEdits), not here.
 */
export function applyCaptionEdits(html: string, sub: string, edited: GeneralLayers, original: GeneralLayers): string {
  const mine = (l: GeneralLayers) => placed(l).filter(p => lineClip(p) && samePath(String(p.clip.params.sub), sub));
  const now = mine(edited), before = mine(original);
  if (!before.length || lineKey(now) === lineKey(before)) return html;
  // a sub-composition keeps its composition in a <template>: edit that, leave the rest of the file as it was
  const template = /(<template\b[^>]*>)([\s\S]*)(<\/template>)/i.exec(html);
  const { document } = parseHTML(`<!doctype html><html><body>${template ? template[2] : html}</body></html>`);
  const root = document.querySelector('[data-composition-id]');
  if (!root) return html;
  const byId = new Map<string, Element>();
  for (const el of root.querySelectorAll('[data-hf-id]')) byId.set(el.getAttribute('data-hf-id')!, el);
  const span = now.length ? captionSpan(now.map(p => p.clip)) : undefined;
  for (const { clip } of now) {
    let el = byId.get(clip.id);
    if (!el) {
      const from = byId.get(String(clip.params.hfId));
      if (!from) continue;
      el = from.cloneNode(true) as Element;
      el.setAttribute('data-hf-id', clip.id);
      const id = from.getAttribute('id');
      if (id) el.setAttribute('id', `${id}-${clip.id.replace(/[^\w-]/g, '').slice(0, 8)}`);
      from.after(el);
      byId.set(clip.id, el);
    }
    el.setAttribute('data-start', n3(clip.start - span!.start));
    el.setAttribute('data-duration', n3(clip.duration));
  }
  const ids = new Set(now.map(p => p.clip.id));
  for (const { clip } of before) if (!ids.has(clip.id)) byId.get(clip.id)?.remove();
  if (span && Number(root.getAttribute('data-duration') || 0) < span.end - span.start - 1e-3) root.setAttribute('data-duration', n3(span.end - span.start));
  const body = document.body.innerHTML;
  return template ? html.slice(0, template.index) + template[1] + body + template[3] + html.slice(template.index + template[0].length) : body;
}

/** The caption pages the person's edits of version folder `folder` change (paths as the root page names them). */
export function editedCaptionPages(folder: string): string[] {
  try { return [...new Set(placed(JSON.parse(fs.readFileSync(path.join(folder, 'edited.json'), 'utf8'))).filter(lineClip).map(p => String(p.clip.params.sub)))]; }
  catch { return []; }
}

/** Caption page `sub` of version folder `folder` as the person edited it. */
export function editedCaptionPage(folder: string, sub: string, html: string) {
  const edited = path.join(folder, 'edited.json'), original = path.join(folder, 'layers.json');
  if (!fs.existsSync(edited) || !fs.existsSync(original)) return html;
  try { return applyCaptionEdits(html, sub, JSON.parse(fs.readFileSync(edited, 'utf8')), JSON.parse(fs.readFileSync(original, 'utf8'))); }
  catch { return html; }
}

const TIMING = ['start', 'duration', 'sourceStart', 'sourceDuration', 'volume', 'fadeIn', 'fadeOut'] as const;
const timingOf = (clip: TimelineClip) => [clip.start, clip.duration, clip.sourceStart ?? 0, clip.volume ?? 1, clip.fadeIn ?? 0, clip.fadeOut ?? 0, Number(clip.params.speed ?? 1)];
// a caption line is also its words
const sameTiming = (a: TimelineClip, b: TimelineClip) => timingOf(a).every((value, i) => same(value, timingOf(b)[i])) && (a.text ?? '') === (b.text ?? '');
const seconds = (value: number) => `${Math.round(value * 10) / 10} 秒`;
const db = (gain: number) => gain <= 0 ? '静音' : `${(20 * Math.log10(gain)).toFixed(1)} dB`;

/** The person's timeline edits of a version, as lines for the agent's next turn. */
export function describeTimeline(edited: GeneralLayers, original: GeneralLayers): string[] {
  const before = new Map(placed(original).filter(editable).map(p => [p.clip.id, p])), lines: string[] = [];
  const name = (p: Placed) => `${p.track.name}「${p.clip.name}」（${lineClip(p) ? `${p.clip.params.sub} 里 ` : ''}data-hf-id="${p.clip.params.hfId}"）`;
  const now = placed(edited).filter(editable);
  // 按声音切开 (hf-split.ts): one line for the strip, with where its pieces now start
  const pieces = new Map<string, Placed[]>();
  for (const p of now) if (typeof p.clip.params.splitOf === 'string') pieces.set(p.clip.params.splitOf, [...pieces.get(p.clip.params.splitOf) ?? [], p]);
  for (const [id, list] of pieces) {
    const was = before.get(id);
    if (was) lines.push(`- 把${name(was)}按声音切成了 ${list.length} 段（同一个文件的不同部分），现在的起点：${list.map(p => p.clip.start.toFixed(2)).sort((a, b) => +a - +b).join('、')} 秒`);
  }
  for (const p of now) {
    if (typeof p.clip.params.splitOf === 'string' && before.has(p.clip.params.splitOf)) continue;
    const was = before.get(p.clip.id);
    if (!was) { lines.push(`- 复制了${name(p)}，放在 ${seconds(p.clip.start)}`); continue; }
    if (sameTiming(was.clip, p.clip)) continue;
    const parts: string[] = [];
    if (!same(was.clip.start, p.clip.start)) parts.push(`起点 ${seconds(was.clip.start)} → ${seconds(p.clip.start)}`);
    if (!same(was.clip.duration, p.clip.duration)) parts.push(`时长 ${seconds(was.clip.duration)} → ${seconds(p.clip.duration)}`);
    if (!same(was.clip.sourceStart ?? 0, p.clip.sourceStart ?? 0)) parts.push(`素材入点改到 ${seconds(p.clip.sourceStart ?? 0)}`);
    if (!same(was.clip.volume ?? 1, p.clip.volume ?? 1)) parts.push(`音量 ${db(p.clip.volume ?? 1)}`);
    if (!same(was.clip.fadeIn ?? 0, p.clip.fadeIn ?? 0) || !same(was.clip.fadeOut ?? 0, p.clip.fadeOut ?? 0)) parts.push(`淡入 ${seconds(p.clip.fadeIn ?? 0)}、淡出 ${seconds(p.clip.fadeOut ?? 0)}`);
    if (!same(Number(was.clip.params.speed ?? 1), Number(p.clip.params.speed ?? 1))) parts.push(`变速 ${Number(p.clip.params.speed ?? 1)}×${isScene(p.clip) ? '（整段动画按这个速度完整播完，OpenTake 放映时换算，不用改页面）' : ''}`);
    if ((was.clip.text ?? '') !== (p.clip.text ?? '')) parts.push(`字改成「${p.clip.text ?? ''}」`);
    lines.push(`- ${name(p)}：${parts.join('，')}`);
  }
  const ids = new Set(now.map(p => p.clip.id));
  for (const [id, p] of before) if (!ids.has(id)) lines.push(`- 删掉了${name(p)}`);
  for (const track of edited.timeline.tracks) {
    const was = original.timeline.tracks.find(t => t.id === track.id);
    if (track.hidden && !was?.hidden) lines.push(`- ${track.name}整轨隐藏了`);
    if (track.muted && !was?.muted) lines.push(`- ${track.name}整轨静音了`);
  }
  return lines;
}

/**
 * The person's timeline edits of the revised version carried onto the new one (S先生 2026-10-26: 下一版保留改动):
 * a clip the agent left as it was keeps the person's timing and sound; one the agent retimed is the agent's.
 * `to` is changed in place; returns how many edits stayed and what the agent's turn replaced.
 */
export function carryTimeline(edited: GeneralLayers, original: GeneralLayers, to: GeneralLayers) {
  const was = new Map(placed(original).filter(editable).map(p => [p.clip.id, p.clip]));
  const next = new Map(placed(to).filter(editable).map(p => [p.clip.id, p]));
  let kept = 0;
  const dropped: string[] = [];
  const untouched = (id: string) => { const a = was.get(id), b = next.get(id)?.clip; return Boolean(a && b && sameTiming(a, b)); };
  const now = placed(edited).filter(editable);
  for (const p of now) {
    const before = was.get(p.clip.id);
    if (!before) {
      // a pasted copy goes along while what it copies is still in the film
      const source = next.get(String(p.clip.params.hfId)), track = to.timeline.tracks.find(t => t.id === p.track.id);
      if (source && track) { track.clips.push(structuredClone({ ...p.clip, trackId: track.id })); kept++; }
      continue;
    }
    if (sameTiming(before, p.clip)) continue;
    const target = next.get(p.clip.id);
    if (target && untouched(p.clip.id)) {
      for (const key of TIMING) (target.clip as Record<string, unknown>)[key] = p.clip[key];
      target.clip.params = { ...target.clip.params, speed: p.clip.params.speed };
      if (lineClip(p)) { target.clip.text = p.clip.text; target.clip.name = p.clip.name; }
      kept++;
    } else dropped.push(`「${p.clip.name}」的时间调整`);
  }
  const ids = new Set(now.map(p => p.clip.id));
  for (const id of was.keys()) {
    if (ids.has(id) || !next.has(id)) continue;
    if (untouched(id)) { const { track } = next.get(id)!; track.clips = track.clips.filter(c => c.id !== id); kept++; }
  }
  for (const track of edited.timeline.tracks) {
    const target = to.timeline.tracks.find(t => t.id === track.id), before = original.timeline.tracks.find(t => t.id === track.id);
    if (!target) continue;
    if (track.hidden && !before?.hidden) { target.hidden = true; kept++; }
    if (track.muted && !before?.muted) { target.muted = true; kept++; }
  }
  return { kept, dropped };
}
