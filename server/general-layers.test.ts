import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotLayers } from './general/layers.ts';
import type { GeneralLayers } from '../src/general/general-contract.ts';

test('layers: a layered film snapshots its work folder and becomes editor-shaped tracks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-layers-'));
  try {
    const work = path.join(dir, 'work');
    for (const d of ['shots', 'audio', 'out', 'look', '.tmp', 'media']) fs.mkdirSync(path.join(d === 'media' ? dir : work, d), { recursive: true });
    fs.writeFileSync(path.join(work, 'shots', 'a.html'), '<p>a</p>');
    fs.writeFileSync(path.join(work, 'audio', 'm.wav'), ''); fs.writeFileSync(path.join(work, 'audio', 'x.wav'), '');
    fs.writeFileSync(path.join(work, 'out', 'video.mp4'), ''); fs.writeFileSync(path.join(work, 'out.mp4'), ''); fs.writeFileSync(path.join(work, 'look', 'sheet.jpg'), '');
    fs.writeFileSync(path.join(dir, 'media', 'abc123.mp4'), '');
    fs.writeFileSync(path.join(work, 'film.json'), JSON.stringify({ version: 2, width: 1080, height: 1920, fps: 30, duration: 4, ending: 'fade', finish: 'grain',
      segments: [{ id: 's1', name: '开场', start: 0, end: 2, transition: 'fade' }, { id: 's2', name: '收尾', start: 2, end: 4, transition: 'dissolve' }],
      picture: [{ id: 'p1', page: 'shots/a.html', start: 0, end: 2, layer: 'overlay' }],
      footage: [{ id: 'f1', media: 'abc123.mp4', start: 0, end: 2, in: 1, speed: 0.5, sound: true, volume: 'high' }],
      text: [{ id: 't1', start: 0.2, end: 1.8, text: '你好{世界}\n副标题', preset: '大标题', place: 'lower-left', reveal: 'line' }],
      music: [{ id: 'm1', src: 'audio/m.wav', start: 0, end: 4, volume: 'low' }],
      sfx: [{ id: 'x1', src: 'audio/x.wav', start: 1.9, label: '转场' }] }));
    const rel = await snapshotLayers(dir, 3, [{ id: 'abc123', name: '我的素材.mp4', duration: 10, width: 1920, height: 1080 }]);
    assert.equal(rel, 'versions/v3/layers.json');
    const layers = JSON.parse(fs.readFileSync(path.join(dir, rel!), 'utf8')) as GeneralLayers;
    assert.equal(layers.base, 'versions/v3/work');
    assert.ok(fs.existsSync(path.join(dir, 'versions/v3/work/shots/a.html')) && fs.existsSync(path.join(dir, 'versions/v3/work/film.json')));
    for (const gone of ['out', 'out.mp4', 'look', '.tmp']) assert.ok(!fs.existsSync(path.join(dir, 'versions/v3/work', gone)), gone);
    assert.deepEqual(layers.segments.map(s => [s.id, s.transition]), [['s1', 'fade'], ['s2', 'dissolve']]);
    assert.equal(layers.ending, 'fade'); assert.equal(layers.finish, 'grain');
    const kinds = Object.fromEntries(layers.timeline.tracks.map(t => [t.id, [t.kind, t.clips.length]]));
    assert.deepEqual(kinds, { 'g-page': ['page', 1], 'g-text': ['subtitle', 1], 'g-footage': ['video', 1], 'g-voice': ['voice', 0], 'g-music': ['music', 1], 'g-sfx': ['sfx', 1] });
    const tracks = Object.fromEntries(layers.timeline.tracks.map(t => [t.id, t.clips]));
    assert.equal(tracks['g-page'][0].name, '开场');
    assert.equal(tracks['g-text'][0].text, '你好{世界}\n副标题');
    const f = tracks['g-footage'][0];
    assert.equal(f.assetId, 'abc123'); assert.equal(f.name, '我的素材.mp4'); assert.equal(f.sourceStart, 1); assert.equal(f.sourceDuration, 1);
    assert.ok(f.volume > 1.5, 'high volume step');
    assert.ok(tracks['g-music'][0].volume < 0.5, 'low volume step');
    assert.equal(tracks['g-sfx'][0].name, '转场');
    fs.writeFileSync(path.join(work, 'film.json'), JSON.stringify({ width: 320, height: 180, shots: [] }));
    assert.equal(await snapshotLayers(dir, 4, []), undefined, 'a plain film keeps only its video');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
