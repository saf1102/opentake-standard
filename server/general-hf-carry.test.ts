import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { carryEdits, describeEdits, filmPages, stampHfWork } from './general/hf-carry.ts';
import { hyperframesToLayers } from './general/hf-project.ts';
import { turnPrompt } from './general/brief.ts';
import type { GeneralLayers } from '../src/general/general-contract.ts';

// a film as the agent writes it: no ids yet; a card and a caption track, each a sub-composition
const INDEX = `<!doctype html><html><head></head><body><div id="main" data-composition-id="main" data-width="1920" data-height="1080" data-duration="4">
<div id="card" class="clip" data-composition-id="card" data-composition-src="compositions/card.html" data-start="0" data-duration="4" data-track-index="1" data-track-kind="graphics"></div>
<div id="caps" class="clip" data-composition-id="caps" data-composition-src="compositions/caps.html" data-start="0" data-duration="4" data-track-index="2" data-track-kind="captions"></div>
</div></body></html>`;
const CARD = (title: string) => `<template><div id="card" data-composition-id="card" data-duration="4"><h1 class="title">${title}</h1><p class="sub">副标题</p><span class="badge">01</span></div></template>`;
const CAPS = (second: string) => `<template><div id="caps" data-composition-id="caps" data-duration="4"><div class="line">第一句</div><div class="line">${second}</div></div></template>`;

function film(dir: string, title: string, second: string) {
  fs.mkdirSync(path.join(dir, 'compositions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), INDEX);
  fs.writeFileSync(path.join(dir, 'compositions', 'card.html'), CARD(title));
  fs.writeFileSync(path.join(dir, 'compositions', 'caps.html'), CAPS(second));
  fs.writeFileSync(path.join(dir, 'assets', 'note.html'), '<p>not a page of the film</p>');
}
const idOf = (html: string, marker: string) => new RegExp(`<[^>]*data-hf-id="([^"]+)"[^>]*>${marker}`).exec(html)?.[1];
const clip = (layers: GeneralLayers, sub: string) => layers.timeline.tracks.flatMap(t => t.clips).find(c => c.params.sub === sub)!;

test('hf carry: ids are stamped once and only added; the person\'s edits go to the next version unless the agent rewrote them', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-carry-'));
  try {
    const v1 = path.join(root, 'v1'), v2 = path.join(root, 'v2');
    film(v1, '标题', '第二句');
    assert.deepEqual(filmPages(v1).sort(), ['compositions/caps.html', 'compositions/card.html', 'index.html']);
    assert.equal(stampHfWork(v1), 3);
    assert.equal(stampHfWork(v1), 0, 'stamping again changes nothing');
    const card1 = fs.readFileSync(path.join(v1, 'compositions', 'card.html'), 'utf8');
    assert.equal(card1.replace(/ data-hf-id="[^"]*"/g, ''), CARD('标题'), 'only ids were added');

    // the person changed the title and the second caption, and moved the badge
    const layers1 = await hyperframesToLayers(v1, 'v1', []);
    const titleId = idOf(card1, '标题')!, badgeId = idOf(card1, '01')!;
    const caps1 = fs.readFileSync(path.join(v1, 'compositions', 'caps.html'), 'utf8'), secondId = idOf(caps1, '第二句')!;
    const edited = structuredClone(layers1);
    const card = clip(edited, 'compositions/card.html'), caps = clip(edited, 'compositions/caps.html');
    card.params = { ...card.params, textEdits: { [titleId]: '新标题' }, overrides: { [`[data-hf-id="${badgeId}"]`]: { dx: 40 } } };
    caps.params = { ...caps.params, textEdits: { [secondId]: '改过的第二句' } };

    const lines = describeEdits(v1, edited);
    assert.equal(lines.length, 3);
    assert.match(lines.join('\n'), /「标题」改成了「新标题」/);
    assert.match(lines.join('\n'), /data-hf-id="[^"]+" 的元素（01）：位置、大小或角度手动调过/);
    const prompt = turnPrompt({ phase: 'revise', kit: '/kit', styleId: 'free', revision: { version: 1, text: '第二句再短一点' }, personEdits: lines });
    assert.match(prompt, /用户在编辑页手动改过的地方/);
    assert.match(prompt, /不要删它们的 data-hf-id/);

    // the next turn: the agent works on the stamped files and rewrites the second caption (the person asked it to)
    fs.cpSync(v1, v2, { recursive: true });
    fs.writeFileSync(path.join(v2, 'compositions', 'caps.html'), caps1.replace('第二句', '短句'));
    assert.equal(stampHfWork(v2), 0, 'the agent kept the ids');
    const layers2 = await hyperframesToLayers(v2, 'v2', []);
    const result = carryEdits({ work: v1, layers: edited }, { work: v2, layers: layers2 });
    assert.equal(result.kept, 2);
    assert.deepEqual(result.dropped, ['「改过的第二句」']);
    const card2 = clip(result.layers!, 'compositions/card.html'), caps2 = clip(result.layers!, 'compositions/caps.html');
    assert.deepEqual(card2.params.textEdits, { [titleId]: '新标题' });
    assert.deepEqual(card2.params.overrides, { [`[data-hf-id="${badgeId}"]`]: { dx: 40 } });
    assert.equal(caps2.params.textEdits, undefined);

    // a card the agent wrote again from scratch: ids come from each element's own content, so the new title is a new
    // element (the old words do not go onto it) while the same badge is still the same element (its move stays)
    fs.writeFileSync(path.join(v2, 'compositions', 'card.html'), CARD('全新的卡'));
    stampHfWork(v2);
    const fresh = carryEdits({ work: v1, layers: edited }, { work: v2, layers: await hyperframesToLayers(v2, 'v2', []) });
    assert.equal(fresh.kept, 1);
    assert.deepEqual(fresh.dropped, ['「新标题」', '「改过的第二句」']);
    assert.equal(clip(fresh.layers!, 'compositions/card.html').params.textEdits, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
