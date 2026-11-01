import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { captionLines, expandCaptionLines } from './general/hf-project.ts';
import { applyCaptionEdits, applyTimelineEdits, describeTimeline } from './general/hf-timeline.ts';
import { hfPageEdits, type GeneralLayers } from '../src/general/general-contract.ts';
import type { TimelineClip } from '../src/types/editor.ts';

const ROOT = `<!doctype html><html><body><div data-composition-id="root" data-width="1080" data-height="1920" data-duration="15">
<div class="clip" data-hf-id="cap" id="captions-host" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="15" data-track-kind="captions"></div>
</div></body></html>`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><template><style>.line{position:absolute}</style><div data-hf-id="c-root" id="captions" data-composition-id="captions" data-width="1080" data-height="1920" data-duration="15" data-no-timeline><div data-hf-id="l0" id="caption-0" class="clip line" data-start="0" data-duration="5">刘备 · 关羽 · 张飞</div><div data-hf-id="l1" id="caption-1" class="clip line" data-start="5" data-duration="5">结为兄弟<br>生死相扶</div><div data-hf-id="l2" id="caption-2" class="clip line" data-start="10" data-duration="5">同心协力</div></div></template></body></html>`;

const work = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-captions-'));
  fs.mkdirSync(path.join(dir, 'compositions'));
  fs.writeFileSync(path.join(dir, 'compositions', 'captions.html'), PAGE);
  return dir;
};
const host = (): TimelineClip => ({ id: 'cap', trackId: 'g-text', name: 'captions-host', start: 0, duration: 15, sourceStart: 0, volume: 1, fadeIn: 0, fadeOut: 0,
  params: { hf: true, hfId: 'cap', element: 'captions-host', tag: 'div', sub: 'compositions/captions.html' } } as TimelineClip);
const layers = (clips: TimelineClip[]): GeneralLayers => ({
  format: 'opentake.general.layers', version: 1, engine: 'hyperframes', entry: 'index.html', width: 1080, height: 1920, fps: 30, duration: 15,
  segments: [], ending: 'cut', finish: 'none', base: 'versions/v1/work',
  timeline: { duration: 15, fps: 30, playhead: 0, tracks: [{ id: 'g-text', name: '字幕', kind: 'subtitle', order: 0, clips }] },
} as unknown as GeneralLayers);
const read = (dir: string) => { const l = layers([host()]); expandCaptionLines(l.timeline, dir); return l; };
const lines = (l: GeneralLayers) => l.timeline.tracks[0].clips;

test('a caption page is read as its lines, each with its own words and time', () => {
  const dir = work();
  assert.deepEqual(captionLines(dir, 'compositions/captions.html').map(l => [l.hfId, l.start, l.duration, l.text]),
    [['l0', 0, 5, '刘备 · 关羽 · 张飞'], ['l1', 5, 5, '结为兄弟\n生死相扶'], ['l2', 10, 5, '同心协力']]);
  const l = read(dir);
  assert.deepEqual(lines(l).map(c => [c.id, c.start, c.text, c.params.host, c.params.line]),
    [['l0', 0, '刘备 · 关羽 · 张飞', 'cap', true], ['l1', 5, '结为兄弟\n生死相扶', 'cap', true], ['l2', 10, '同心协力', 'cap', true]]);
  // edits made before lines existed: the lines follow where the person put the page, words edited on it stay
  const before = host(), edited = layers([{ ...host(), start: 1, duration: 12, params: { ...host().params, textEdits: { l0: '桃园' } } }]);
  expandCaptionLines(edited.timeline, dir, new Map([['cap', before]]));
  assert.deepEqual(lines(edited).map(c => [c.id, c.start, c.text]), [['l0', 1, '桃园'], ['l1', 6, '结为兄弟\n生死相扶'], ['l2', 11, '同心协力']]);
  // a page that draws its words some other way stays one clip
  fs.writeFileSync(path.join(dir, 'compositions', 'captions.html'), PAGE.replace(/<div data-hf-id="l\d"[^]*?<\/div>/g, ''));
  assert.equal(expandCaptionLines(layers([host()]).timeline, dir), false);
});

test('moving, deleting and copying lines lands in the caption page; a line past the page widens it', () => {
  const dir = work(), original = read(dir), edited = read(dir);
  const [l0, l1] = lines(edited);
  lines(edited).splice(2, 1); // delete 同心协力
  l1.start = 6.5;
  lines(edited).push({ ...structuredClone(l0), id: 'copy-a', start: 14, duration: 3 });
  const page = applyCaptionEdits(PAGE, 'compositions/captions.html', edited, original);
  assert.ok(page.startsWith('<!doctype html><html><head><meta charset="utf-8"></head><body><template>'));
  const doc = parseHTML(`<body>${/<template>([^]*)<\/template>/.exec(page)![1]}</body>`).document;
  const at = (id: string) => doc.querySelector(`[data-hf-id="${id}"]`);
  assert.equal(at('l1')!.getAttribute('data-start'), '6.5');
  assert.equal(at('l2'), null);
  assert.equal(at('copy-a')!.textContent, '刘备 · 关羽 · 张飞');
  assert.equal(at('copy-a')!.getAttribute('data-start'), '14');
  assert.equal(doc.querySelector('[data-composition-id]')!.getAttribute('data-duration'), '17');
  // the root page's caption clip covers the copied line too
  const root = parseHTML(applyTimelineEdits(ROOT, edited, original)).document.querySelector('[data-hf-id="cap"]')!;
  assert.deepEqual([root.getAttribute('data-start'), root.getAttribute('data-duration')], ['0', '17']);
  // nothing changed: the page comes back as it was
  assert.equal(applyCaptionEdits(PAGE, 'compositions/captions.html', read(dir), original), PAGE);
});

test('a line\'s words are edited live in its page, and the agent hears them', () => {
  const dir = work(), original = read(dir), edited = read(dir);
  Object.assign(lines(edited)[1], { text: '义结金兰', name: '义结金兰' });
  assert.deepEqual(hfPageEdits(edited).text, { cap: { l1: '义结金兰' } });
  assert.deepEqual(hfPageEdits(original).text, {});
  const said = describeTimeline(edited, original).join('\n');
  assert.match(said, /字幕「义结金兰」（compositions\/captions\.html 里 data-hf-id="l1"）：字改成「义结金兰」/);
  // deleting every line leaves the page with nothing to show
  const empty = layers([]);
  assert.equal(parseHTML(applyTimelineEdits(ROOT, empty, original)).document.querySelector('[data-hf-id="cap"]'), null);
});
