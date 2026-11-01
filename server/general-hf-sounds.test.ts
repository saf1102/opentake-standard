import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { applyTimelineEdits, describeTimeline } from './general/hf-timeline.ts';
import { anchorSounds, followersOf, freezeAnchors, reanchor } from '../src/general/hf-anchor.ts';
import { splitBySound, splitMixedStrips } from '../src/general/hf-split.ts';
// @ts-expect-error JavaScript tool shared with the agent CLI.
import { bursts, BURST_RATE } from './general/kit/lib/sound-bursts.mjs';
import type { GeneralLayers } from '../src/general/general-contract.ts';

const HTML = `<!doctype html><html><body><div data-composition-id="root" data-width="1080" data-height="1920" data-duration="15">
<div class="clip" id="host-1" data-hf-id="s1" data-composition-src="compositions/scene-1.html" data-start="0" data-duration="5"></div>
<div class="clip" id="host-2" data-hf-id="s2" data-composition-src="compositions/scene-2.html" data-start="5" data-duration="5"></div>
<audio data-hf-id="x" id="sfx" src="assets/sfx.wav" data-start="0" data-duration="15" data-ot-role="sfx"></audio>
</div></body></html>`;

const clip = (id: string, trackId: string, start: number, duration: number, params: Record<string, unknown> = {}) =>
  ({ id, trackId, name: id, start, duration, sourceStart: 0, volume: 1, fadeIn: 0, fadeOut: 0, params: { hf: true, hfId: id, ...params } });
const layers = (sounds = [clip('x', 'g-sfx', 0, 15, { tag: 'audio', src: 'assets/sfx.wav' })]): GeneralLayers => ({
  format: 'opentake.general.layers', version: 1, engine: 'hyperframes', entry: 'index.html', width: 1080, height: 1920, fps: 30, duration: 15,
  segments: [], ending: 'cut', finish: 'none', base: 'versions/v1/work',
  timeline: { duration: 15, fps: 30, playhead: 0, tracks: [
    { id: 'g-page', name: '动效卡', kind: 'page', order: 0, clips: [clip('s1', 'g-page', 0, 5, { element: 'host-1', sub: 'compositions/scene-1.html' }), clip('s2', 'g-page', 5, 5, { element: 'host-2', sub: 'compositions/scene-2.html' })] },
    { id: 'g-voice', name: '配音', kind: 'voice', order: 1, clips: [] },
    { id: 'g-sfx', name: '音效', kind: 'sfx', order: 2, clips: sounds },
  ] },
} as unknown as GeneralLayers);
const track = (l: GeneralLayers, id: string) => l.timeline.tracks.find(t => t.id === id)!;

test('the separate sounds in a strip: quiet splits it, a short dip inside one sound does not', () => {
  const samples = new Int16Array(BURST_RATE * 3);
  const tone = (from: number, to: number) => { for (let i = Math.round(from * BURST_RATE); i < to * BURST_RATE; i++) samples[i] = Math.round(8000 * Math.sin(i / 3)); };
  tone(0.2, 0.5); tone(0.6, 0.8); // 0.1 s apart: one sound
  tone(1.5, 1.7); tone(2.4, 2.6);
  const found = bursts(samples, BURST_RATE);
  assert.equal(found.length, 3);
  assert.ok(Math.abs(found[0].start - 0.18) < 0.03 && found[0].end > 0.8);
  assert.ok(Math.abs(found[1].start - 1.48) < 0.03);
  assert.ok(found[2].end <= 3);
});

test('sounds belong to the scene they start in, or the one their page names', () => {
  const l = layers([clip('a', 'g-sfx', 1, 0.5), clip('b', 'g-sfx', 6, 0.5), clip('c', 'g-sfx', 4.8, 0.5)]);
  anchorSounds(l.timeline, new Map([['c', 'host-2']]));
  assert.deepEqual(track(l, 'g-sfx').clips.map(c => c.params.anchor), ['s1', 's2', 's2']);
  assert.deepEqual(followersOf(l.timeline, 's2').map(c => c.id), ['b', 'c']);
  // moved on its own into the first scene, it belongs there now
  track(l, 'g-sfx').clips[1].start = 2; reanchor(l.timeline, ['b']);
  assert.deepEqual(followersOf(l.timeline, 's1').map(c => c.id), ['a', 'b']);
  // a version read before anchors existed: the sounds starting in the scene, fixed before anything moves
  const old = layers([clip('d', 'g-sfx', 7, 0.5)]);
  assert.deepEqual(followersOf(old.timeline, 's2').map(c => c.id), ['d']);
  freezeAnchors(old.timeline); track(old, 'g-page').clips[1].start = 9;
  assert.deepEqual(followersOf(old.timeline, 's2').map(c => c.id), ['d']);
});

test('按声音切开: one clip per sound, each playing its own stretch of the same file, with its scene', () => {
  const edited = layers();
  let n = 0;
  const ids = splitBySound(edited.timeline, 'x', [{ start: 0, end: 1.2 }, { start: 1.6, end: 2.1 }, { start: 6.6, end: 7.2 }], () => `p${++n}`);
  assert.deepEqual(ids, ['x', 'p1', 'p2']);
  const pieces = track(edited, 'g-sfx').clips;
  assert.deepEqual(pieces.map(c => [c.start, c.duration, c.sourceStart]), [[0, 1.2, 0], [1.6, 0.5, 1.6], [6.6, 0.6, 6.6]]);
  assert.deepEqual(pieces.map(c => c.params.anchor), ['s1', 's1', 's2']);
  assert.equal(splitBySound(layers().timeline, 'x', [{ start: 0, end: 15 }]).length, 0);
  // the page plays the same sound from three elements
  const out = parseHTML(applyTimelineEdits(HTML, edited, layers())).document;
  const audio = [...out.querySelectorAll('audio')].map(a => [a.getAttribute('data-hf-id'), a.getAttribute('src'), a.getAttribute('data-start'), a.getAttribute('data-duration'), a.getAttribute('data-media-start')]);
  assert.deepEqual(audio.sort((a, b) => Number(a[2]) - Number(b[2])), [
    ['x', 'assets/sfx.wav', '0', '1.2', null], ['p1', 'assets/sfx.wav', '1.6', '0.5', '1.6'], ['p2', 'assets/sfx.wav', '6.6', '0.6', '6.6']]);
  // the agent hears it as one split, not as three copies
  const lines = describeTimeline(edited, layers());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /按声音切成了 3 段.*0\.00、1\.60、6\.60/);
});

test('a scene is an element of the page: moving it, hiding its track or deleting it reaches the film', () => {
  const at = (html: string, id: string) => parseHTML(html).document.querySelector(`[data-hf-id="${id}"]`);
  const moved = layers(); track(moved, 'g-page').clips[1].start = 7;
  assert.equal(at(applyTimelineEdits(HTML, moved, layers()), 's2')!.getAttribute('data-start'), '7');
  const hidden = layers(); track(hidden, 'g-page').hidden = true;
  const out = applyTimelineEdits(HTML, hidden, layers());
  assert.deepEqual([at(out, 's1'), at(out, 's2'), Boolean(at(out, 'x'))], [null, null, true]);
  const gone = layers(); track(gone, 'g-page').clips.splice(0, 1);
  assert.equal(at(applyTimelineEdits(HTML, gone, layers()), 's1'), null);
});

test('opening a film made before 音效一声一段: a strip of several sounds is split, a long single sound is not', async () => {
  const l = layers([clip('x', 'g-sfx', 0, 15, { tag: 'audio', src: 'assets/sfx.wav' }), clip('wind', 'g-sfx', 0, 15, { tag: 'audio', src: 'assets/wind.wav' }),
    clip('hit', 'g-sfx', 3, 1, { tag: 'audio', src: 'assets/hit.wav' })]);
  const heard: Record<string, { start: number; end: number }[]> = {
    'assets/sfx.wav': [{ start: 0, end: 1 }, { start: 5.5, end: 6 }, { start: 11, end: 12 }], 'assets/wind.wav': [{ start: 0, end: 15 }], 'assets/hit.wav': [{ start: 0, end: 0.2 }, { start: 0.5, end: 0.7 }, { start: 0.8, end: 0.9 }] };
  const listened: string[] = [];
  const split = await splitMixedStrips(l.timeline, async c => { listened.push(c.id); return heard[String(c.params.src)]; }, { seconds: 3, sounds: 3 });
  assert.equal(split, 1);
  assert.deepEqual(listened, ['x', 'wind']); // a short clip is one sound already
  // the pieces play the same file and belong to the scene they start in (none after the last scene)
  assert.deepEqual(track(l, 'g-sfx').clips.map(c => [c.params.hfId, c.start, c.params.anchor]), [['x', 0, 's1'], ['x', 5.5, 's2'], ['x', 11, undefined], ['wind', 0, undefined], ['hit', 3, undefined]]);
  // its pieces are not split again
  assert.equal(await splitMixedStrips(l.timeline, async c => heard[String(c.params.src)], { seconds: 0, sounds: 1 }), 1);
});
