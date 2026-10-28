import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmToLayers, layersToFilm, type Film2 } from './general/layers.ts';
import { JSDOM } from 'jsdom';
// @ts-ignore browser module has no TS declaration
import { applyPageEdits } from './general/kit/web/page-edits.js';
const film: Film2 = { title: '往返片名', logline: '保留元数据', locked: ['p'], width: 1920, height: 1080, fps: 30, duration: 4, ending: 'fade', finish: 'paper',
  segments: [{ id: 's', name: '片段', start: 0, end: 4, transition: 'fade' }],
  picture: [{ id: 'p', start: .0003, end: .015, page: 'a.html', layer: 'overlay', uses: [], edits: { title: '新字' } }],
  footage: [{ id: 'f', start: 0, end: 4, media: 'source.mp4', in: .123456, speed: .75, reverse: true, fit: 'cover', focus: [.2,.8], sound: true, volume: 'high' }],
  text: [{ id: 't', start: .2, end: 3.8, text: '{重点}', role: 'title', preset: '标题', place: 'top', reveal: 'word' }],
  voice: [{ id: 'v', start: 0, end: 4, src: 'v.wav', in: .2, volume: 'mid', text: '旁白' }],
  music: [{ id: 'm', start: 0, end: 4, src: 'm.wav', in: 2, volume: 'low' }],
  sfx: [{ id: 'x', start: 1, end: 2, src: 'x.wav', in: .5, volume: 'high', label: '提示' }] };
test('layers inverse preserves all six tracks and sub-frame precision', async () => {
  const layers = await filmToLayers(film, 'versions/v1/work', '.', []);
  assert.deepEqual(layersToFilm(layers), { version: 2, ...film });
});
test('edited layers: mute, nearest gain, explicit step, source swap, duration, page edits', async () => {
  const layers = await filmToLayers(film, 'versions/v1/work', '.', []);
  const track = (id: string) => layers.timeline.tracks.find(t => t.id === id)!;
  track('g-music').muted = true;
  const f = track('g-footage').clips[0]; f.params.media = 'other.mp4'; f.sourceStart = 2; f.volume = 0;
  const x = track('g-sfx').clips[0]; delete x.params.volumeStep; x.volume = .4; x.duration = .7;
  const v = track('g-voice').clips[0]; v.params.volumeStep = 'high'; v.volume = .4;
  const result = layersToFilm(layers);
  assert.equal(result.music.length, 0); assert.equal(result.footage[0].sound, false);
  assert.equal(result.footage[0].media, 'other.mp4'); assert.equal(result.footage[0].in, 2);
  assert.equal(result.sfx[0].volume, 'low'); assert.equal(result.sfx[0].end, 1.7);
  assert.equal(result.voice[0].volume, 'high');
});
test('page edits use literal names and text, replace all matches and report stale names', () => {
  const dom = new JSDOM('<p data-edit="title">旧</p><span data-edit="title">旧</span>');
  assert.deepEqual(applyPageEdits(dom.window.document, { title: '<b>新</b>', missing: '失效' }), ['missing']);
  assert.equal(dom.window.document.querySelector('p')!.textContent, '<b>新</b>');
  assert.equal(dom.window.document.querySelector('span')!.textContent, '<b>新</b>');
  assert.equal(dom.window.document.querySelector('b'), null);
  dom.window.close();
});
test('track faders: a fader off 0 dB adds to each clip step as dB, which the kit accepts and mixes', async () => {
  const layers = await filmToLayers(film, 'versions/v1/work', '.', []);
  const track = (id: string) => layers.timeline.tracks.find(t => t.id === id)!;
  track('g-sfx').volume = 10 ** (6 / 20); // +6 dB on the sfx track (its clip is 'high', +4 dB)
  track('g-voice').volume = 1; // untouched: stays a step
  const result = layersToFilm(layers);
  assert.equal(result.sfx[0].volume, 10);
  assert.equal(result.voice[0].volume, 'mid');
  const { normalizeFilm2, volumeDb } = await import('./general/kit/lib/film2.mjs');
  assert.equal(volumeDb(10), 10); assert.equal(volumeDb('low'), -8);
  assert.throws(() => normalizeFilm2({ ...result, sfx: [{ ...result.sfx[0], volume: 30 }] }, '/nonexistent', '/nonexistent'), /分贝/);
});
test('page element moves: applied as translate / scale / rotate, undone when taken away, carried to the export film', async () => {
  // @ts-ignore browser module has no TS declaration
  const { applyPageOverrides } = await import('./general/kit/web/page-edits.js');
  const dom = new JSDOM('<h1 data-edit="title">题</h1><img id="logo"><p>说明</p>');
  const doc = dom.window.document;
  assert.deepEqual(applyPageOverrides(doc, { '[data-edit="title"]': { dx: 40, dy: -10, size: 'large', rotate: 15 }, '#gone': { dx: 1 } }), ['#gone']);
  const h1 = doc.querySelector('h1')!;
  assert.equal(h1.style.translate, '40px -10px'); assert.equal(h1.style.scale, '1.25'); assert.equal(h1.style.rotate, '15deg');
  applyPageOverrides(doc, {});
  assert.equal(h1.style.translate, ''); assert.equal(h1.style.scale, ''); assert.equal(h1.hasAttribute('data-ot-moved'), false);
  dom.window.close();
  const layers = await filmToLayers(film, 'versions/v1/work', '.', []);
  const page = layers.timeline.tracks.find(t => t.id === 'g-page')!.clips[0];
  page.params.overrides = { '#logo': { dx: 12, rotate: -30 } };
  const result = layersToFilm(layers);
  assert.deepEqual(result.picture[0].overrides, { '#logo': { dx: 12, rotate: -30 } });
  const { normalizeFilm2 } = await import('./general/kit/lib/film2.mjs');
  assert.throws(() => normalizeFilm2({ ...result, picture: [{ ...result.picture[0], overrides: { '#logo': { rotate: 10 } } }] }, '/nonexistent', '/nonexistent'), /overrides/);
});
