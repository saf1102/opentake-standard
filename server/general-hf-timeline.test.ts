import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { applyTimelineEdits, fadeAutomation, fadesOf, timingKey } from './general/hf-timeline.ts';
import type { GeneralLayers } from '../src/general/general-contract.ts';

const HTML = `<!doctype html><html><body><div data-composition-id="root" data-width="1080" data-height="1920" data-duration="15">
<div class="clip" data-hf-id="s1" data-composition-src="compositions/scene-1.html" data-start="0" data-duration="5"></div>
<div class="clip" data-hf-id="s2" data-composition-src="compositions/scene-2.html" data-start="5" data-duration="5"></div>
<audio data-hf-id="m" id="music" src="assets/music.wav" data-start="0" data-duration="15" data-ot-role="music"></audio>
<audio data-hf-id="x" id="gong" src="assets/gong.wav" data-start="10" data-duration="1" data-ot-role="sfx"></audio>
</div></body></html>`;

const clip = (id: string, trackId: string, start: number, duration: number, extra: Record<string, unknown> = {}) =>
  ({ id, trackId, name: id, start, duration, sourceStart: 0, volume: 1, fadeIn: 0, fadeOut: 0, params: { hf: true, hfId: id }, ...extra });
const layers = (): GeneralLayers => ({
  format: 'opentake.general.layers', version: 1, engine: 'hyperframes', entry: 'index.html', width: 1080, height: 1920, fps: 30, duration: 15,
  segments: [], ending: 'cut', finish: 'none', base: 'versions/v1/work',
  timeline: { duration: 15, fps: 30, playhead: 0, tracks: [
    { id: 'g-page', name: '动效卡', kind: 'page', order: 0, clips: [clip('s1', 'g-page', 0, 5), clip('s2', 'g-page', 5, 5)] },
    { id: 'g-music', name: '配乐', kind: 'music', order: 1, clips: [clip('m', 'g-music', 0, 15)] },
    { id: 'g-sfx', name: '音效', kind: 'sfx', order: 2, clips: [clip('x', 'g-sfx', 10, 1)] },
  ] },
} as unknown as GeneralLayers);
const el = (html: string, id: string) => parseHTML(html).document.querySelector(`[data-hf-id="${id}"]`);
const track = (l: GeneralLayers, id: string) => l.timeline.tracks.find(t => t.id === id)!;

test('no timeline change: the page comes back untouched', () => {
  assert.equal(applyTimelineEdits(HTML, layers(), layers()), HTML);
});

test('moves, trims, sound and fades land in HyperFrames attributes', () => {
  const edited = layers();
  Object.assign(track(edited, 'g-page').clips[1], { start: 5.8, duration: 4.2 });
  Object.assign(track(edited, 'g-music').clips[0], { volume: 0.5, fadeIn: 0.4 });
  Object.assign(track(edited, 'g-sfx').clips[0], { start: 10.8, sourceStart: 0.2, params: { hf: true, hfId: 'x', speed: 2 } });
  const out = applyTimelineEdits(HTML, edited, layers());
  assert.ok(/^<!doctype html>/i.test(out));
  assert.equal(el(out, 's2')!.getAttribute('data-start'), '5.8');
  assert.equal(el(out, 's2')!.getAttribute('data-duration'), '4.2');
  assert.equal(el(out, 'm')!.getAttribute('data-volume'), '0.5');
  assert.deepEqual(fadesOf(el(out, 'm')!.getAttribute('data-automation'), 15), { fadeIn: 0.4, fadeOut: 0 });
  assert.equal(el(out, 'x')!.getAttribute('data-media-start'), '0.2');
  assert.equal(el(out, 'x')!.getAttribute('data-playback-rate'), '2');
  assert.equal(el(out, 's1')!.getAttribute('data-start'), '0');
});

test('a deleted clip leaves the page; a pasted copy is a clone; a hidden track plays nothing; a muted one is silent', () => {
  const edited = layers();
  track(edited, 'g-page').clips.pop();
  track(edited, 'g-sfx').clips.push(clip('copy-1', 'g-sfx', 12, 1, { params: { hf: true, hfId: 'x' } }) as never);
  track(edited, 'g-music').muted = true;
  const out = applyTimelineEdits(HTML, edited, layers());
  assert.equal(el(out, 's2'), null);
  const copy = el(out, 'copy-1')!;
  assert.equal(copy.getAttribute('src'), 'assets/gong.wav');
  assert.equal(copy.getAttribute('data-start'), '12');
  assert.notEqual(copy.getAttribute('id'), 'gong');
  assert.equal(el(out, 'm')!.getAttribute('data-volume'), '0');
  const hidden = layers(); track(hidden, 'g-sfx').hidden = true;
  assert.equal(el(applyTimelineEdits(HTML, hidden, layers()), 'x'), null);
});

test('fades round-trip and only timing counts as a timeline change', () => {
  assert.deepEqual(fadesOf(fadeAutomation(6, 1, 2), 6), { fadeIn: 1, fadeOut: 2 });
  assert.equal(fadeAutomation(6, 0, 0), undefined);
  const words = layers(); track(words, 'g-page').clips[0].params.textEdits = { title: '新字' };
  assert.equal(timingKey(words), timingKey(layers()));
});

test('the agent hears the timeline edits, and the next version keeps those it did not redo', async () => {
  const { carryTimeline, describeTimeline } = await import('./general/hf-timeline.ts');
  const original = layers(), edited = layers();
  Object.assign(track(edited, 'g-page').clips[1], { start: 5.8 });
  Object.assign(track(edited, 'g-music').clips[0], { volume: 0.5 });
  track(edited, 'g-sfx').clips.push(clip('copy-1', 'g-sfx', 12, 1, { params: { hf: true, hfId: 'x' } }) as never);
  track(edited, 'g-page').clips.shift();
  const lines = describeTimeline(edited, original).join('\n');
  assert.match(lines, /起点 5 秒 → 5\.8 秒/); assert.match(lines, /音量 -6\.0 dB/); assert.match(lines, /复制了/); assert.match(lines, /删掉了.*s1/);
  // the agent's new version retimed the music, left the rest
  const next = layers(); Object.assign(track(next, 'g-music').clips[0], { start: 1 });
  const result = carryTimeline(edited, original, next);
  assert.equal(track(next, 'g-page').clips.find(c => c.id === 's2')!.start, 5.8);
  assert.equal(track(next, 'g-music').clips[0].volume, 1);
  assert.equal(track(next, 'g-music').clips[0].start, 1);
  assert.ok(track(next, 'g-sfx').clips.some(c => c.id === 'copy-1'));
  assert.ok(!track(next, 'g-page').clips.some(c => c.id === 's1'));
  assert.equal(result.dropped.length, 1);
});
