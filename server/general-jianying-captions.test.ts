import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generalJianyingCaptions, splitJianyingText } from './general/jianying-captions.ts';
import type { Film2 } from './general/layers.ts';
import { fontDirs } from './general/runtime-tools.ts';

/** Standard ships no style fonts, so a missing family falls back with a warning; Pro must keep the exact one. */
function hasFont(family: string) {
  const key = family.replace(/\s+/g, '').toLowerCase();
  const seek = (dir: string, depth: number): boolean => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).some(entry => entry.isDirectory() ? depth < 3 && seek(path.join(dir, entry.name), depth + 1) : entry.name.replace(/[\s_-]+/g, '').toLowerCase().startsWith(key)); } catch { return false; }
  };
  return fontDirs().some(dir => seek(dir, 0));
}
function assertFamily(style: { fontFamily: string; requestedFontFamily?: string }, family: string, warnings: readonly string[]) {
  assert.equal(style.requestedFontFamily, family);
  if (hasFont(family)) assert.equal(style.fontFamily, family);
  else assert.ok(warnings.some(line => line.includes(family) || line.includes('回退')), `missing ${family} must be reported, not silent`);
}

const film = (preset: string, extra: Partial<Film2['text'][number]> = {}): Film2 => ({
  width: 1920, height: 1080, fps: 30, duration: 4, ending: 'cut', finish: 'none',
  segments: [{ id: 'a', name: '整段', start: 0, end: 4, transition: 'cut' }],
  picture: [], footage: [], voice: [], music: [], sfx: [],
  text: [{ id: 'caption', start: .123456, end: 3.5, text: '字幕 {Hello😀}\n保留换行', role: 'caption', preset, place: 'bottom', reveal: 'none', ...extra }],
});
async function convert(value: Film2, style: string) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jianying-caption-'));
  try { return await generalJianyingCaptions(value, folder, style); }
  finally { fs.rmSync(folder, { recursive: true, force: true }); }
}

test('caption roles split without mutating, cropping overlaps or reordering visual text', () => {
  const value = film('手写字幕');
  value.text.unshift({ ...value.text[0], id: 'title', role: 'title' });
  value.text.push({ ...value.text[1], id: 'overlap', start: 2 }, { ...value.text[0], id: 'label', role: 'label' });
  const snapshot = structuredClone(value);
  const result = splitJianyingText(value);
  assert.deepEqual(result.captions.map(c => [c.item.id, c.renderOrder]), [['caption', 1], ['overlap', 2]]);
  assert.deepEqual(result.textVideos.map(c => [c.item.id, c.renderOrder]), [['title', 0], ['label', 3]]);
  assert.equal(result.captions[0].item.end, 3.5);
  assert.deepEqual(value, snapshot);
});

test('whiteboard actual caption preset retains size, ink, paper background, brace content and codepoint ranges', async () => {
  const { subtitles: [cue], mappings, warnings } = await convert(film('手写字幕'), 'whiteboard');
  assert.equal(cue.start, 123456); assert.equal(cue.duration, 3376544);
  assert.equal(cue.text, '字幕 Hello😀\n保留换行');
  assert.deepEqual(cue.runs, [{ start: 3, end: 9, color: '#2A5CB3', underline: true }]);
  assertFamily(cue.generalStyle, 'Architects Daughter', warnings);
  assert.equal(cue.generalStyle.fontSizePx, 45.36);
  assert.equal(cue.generalStyle.color, '#23262C');
  assert.equal(cue.generalStyle.backgroundColor, 'rgba(250,249,241,.94)');
  assert.equal(cue.generalStyle.fontWeight, 400);
  assert.deepEqual(mappings[0].unsupported, []);
});

test('Swiss and ink actual presets keep their distinct alignment, family and italic treatment', async () => {
  const swissResult = await convert(film('网格字幕', { place: 'upper-right', size: 'large', rotate: 12 }), 'swiss-motion'), swiss = swissResult.subtitles[0].generalStyle;
  assertFamily(swiss, 'Inter', swissResult.warnings); assert.equal(swiss.fontWeight, 500); assert.equal(swiss.align, 'left');
  assert.equal(swiss.fontSizePx, 56.7); assert.equal(swiss.rotate, 12);
  assert.deepEqual(swiss.layout, { anchorX: 1, anchorY: 0, x: 1844.4, y: 75.60000000000001, maxWidth: 1152, bar: false, paddingX: 0, paddingY: 0 });
  const inkResult = await convert(film('宣纸旁白'), 'ink-wash'), ink = inkResult.subtitles[0].generalStyle;
  assertFamily(ink, 'Cormorant Garamond', inkResult.warnings); assert.equal(ink.fallbackFamily, 'Songti SC');
  assert.equal(ink.italic, true); assert.equal(ink.color, '#373A36'); assert.equal(ink.backgroundColor, 'transparent');
});

test('each of the three real style caption presets maps and reports decoration/reveal approximation', async () => {
  for (const style of ['whiteboard', 'swiss-motion', 'ink-wash']) {
    const presets = JSON.parse(fs.readFileSync(new URL(`./general/kit/styles/${style}/text-presets.json`, import.meta.url), 'utf8')).presets;
    const value = film('');
    value.text = Object.entries(presets).filter(([, p]) => (p as { roles: string[] }).roles.includes('caption')).map(([preset], i) => ({ ...value.text[0], id: `c${i}`, preset, reveal: 'word' }));
    const result = await convert(value, style);
    assert.equal(result.subtitles.length, 4);
    assert.ok(result.subtitles.every(c => c.text === '字幕 Hello😀\n保留换行'));
    assert.ok(result.mappings.every(m => (m.unsupported as string[]).some(v => v.includes('word'))));
    if (style === 'swiss-motion') {
      assert.ok(result.warnings.some(v => v.includes('装饰线')));
      const red = result.subtitles.find(c => c.id === 'c2')!;
      assert.deepEqual(red.runs, [{ start: 3, end: 9, color: '#E30613', underline: true }]);
    }
  }
});

test('a title preset worn by caption takes actual role ratio and stroke mapping is in pixels', async () => {
  const title = (await convert(film('瑞士大字'), 'swiss-motion')).subtitles[0].generalStyle;
  assert.ok(Math.abs((title.fontSizePx as number) - 45.36) < 1e-10);
  const stroke = (await convert(film('描边'), 'whiteboard')).subtitles[0].generalStyle;
  assert.equal(stroke.strokeWidthPx, 7.5600000000000005); assert.equal(stroke.strokeColor, '#000000');
});

test('unknown presets fail explicitly instead of silently dropping text or style', async () => {
  await assert.rejects(convert(film('不存在的预设'), 'whiteboard'), /不存在/);
});

test('rgba title treatment on caption preserves opacity; unmatched braces are literal text', async () => {
  const cue = (await convert(film('淡墨远题', { text: '保留{未闭合\n以及} {{重点}}' }), 'ink-wash')).subtitles[0];
  assert.equal(cue.generalStyle.color, '#292a27'); assert.equal(cue.generalStyle.colorAlpha, .5);
  assert.equal(cue.text, '保留{未闭合\n以及} {重点}');
});

test('all shipped real presets can be worn as captions without losing content or leaving unsupported colour syntax', async t => {
  const root = new URL('./general/kit/styles/', import.meta.url);
  let styles = 0, mapped = 0;
  for (const style of fs.readdirSync(root).filter(name => !name.startsWith('.'))) {
    const file = new URL(`./general/kit/styles/${style}/text-presets.json`, import.meta.url);
    if (!fs.existsSync(file)) continue;
    const presets = JSON.parse(fs.readFileSync(file, 'utf8')).presets;
    const value = film('');
    value.text = Object.keys(presets).map((preset, i) => ({ ...value.text[0], id: `all${i}`, text: '保留{完整} abc', preset }));
    const result = await convert(value, style);
    assert.equal(result.subtitles.length, Object.keys(presets).length);
    for (const cue of result.subtitles) {
      assert.match(cue.generalStyle.color as string, /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i);
      assert.ok(Number(cue.generalStyle.colorAlpha) >= 0 && Number(cue.generalStyle.colorAlpha) <= 1);
      assert.match(cue.text, /^保留完整 (abc|ABC)$/);
      assert.ok(cue.generalStyle.fontFile);
    }
    styles++; mapped += result.subtitles.length;
  }
  assert.ok(styles >= 10); assert.ok(mapped >= styles * 3);
  t.diagnostic(`已遍历本版实际风格 ${styles} 种、预设 ${mapped} 个；未引入另一版专属风格`);
});
