import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { applyTimelineEdits, describeTimeline } from './general/hf-timeline.ts';
import { speedPages, speedable, withSpeedScripts } from './general/hf-speed.ts';
import { clipSpeed, isScene, sceneSpan, setSceneSpeed, speedToLength } from '../src/general/hf-speed.ts';
import { timingKey } from '../src/general/hf-timing.ts';
import type { GeneralLayers } from '../src/general/general-contract.ts';
import type { TimelineClip } from '../src/types/editor.ts';

const HTML = `<!doctype html><html><body><div data-composition-id="root" data-width="1080" data-height="1920" data-duration="15">
<div class="clip" id="host-1" data-hf-id="s1" data-composition-id="scene-1" data-composition-src="compositions/scene-1.html" data-start="0" data-duration="5"></div>
<div class="clip" id="host-2" data-hf-id="s2" data-composition-id="scene-2" data-composition-src="compositions/scene-2.html" data-start="5" data-duration="5"></div>
<audio data-hf-id="x" id="sfx" src="assets/sfx.wav" data-start="0" data-duration="15" data-ot-role="sfx"></audio>
</div></body></html>`;
// a scene as HF.md has the agent write it: a frame script and a CSS animation, in a <template>
const SCENE = `<!doctype html><html><head><meta charset="utf-8"></head><body><template><style>.box{animation:move 2s linear both}</style><div data-hf-id="r" id="scene-2" data-composition-id="scene-2" data-duration="5" data-no-timeline><div class="box"></div><div class="clip" data-start="2" data-duration="1"></div></div>
<script>(()=>{const el=document.getElementById('scene-2');const onFrame=(el,draw)=>(window.__hfAnime??=[]).push({seek(ms){const host=el.closest('[data-composition-id][data-start]');draw(ms/1000-(host?+host.dataset.start:0));},pause(){},play(){}});onFrame(el,t=>{});})();</script></template></body></html>`;

const clip = (id: string, trackId: string, start: number, duration: number, params: Record<string, unknown> = {}): TimelineClip =>
  ({ id, trackId, name: id, start, duration, sourceStart: 0, volume: 1, fadeIn: 0, fadeOut: 0, params: { hf: true, hfId: id, ...params } }) as TimelineClip;
const layers = (): GeneralLayers => ({
  format: 'opentake.general.layers', version: 1, engine: 'hyperframes', entry: 'index.html', width: 1080, height: 1920, fps: 30, duration: 15,
  segments: [], ending: 'cut', finish: 'none', base: 'versions/v1/work',
  timeline: { duration: 15, fps: 30, playhead: 0, tracks: [
    { id: 'g-page', name: '动效卡', kind: 'page', order: 0, clips: [clip('s1', 'g-page', 0, 5, { element: 'host-1', tag: 'div', sub: 'compositions/scene-1.html' }), clip('s2', 'g-page', 5, 5, { element: 'host-2', tag: 'div', sub: 'compositions/scene-2.html' })] },
    { id: 'g-sfx', name: '音效', kind: 'sfx', order: 1, clips: [clip('x', 'g-sfx', 0, 15, { tag: 'audio', src: 'assets/sfx.wav' })] },
  ] },
} as unknown as GeneralLayers);
const scene = (l: GeneralLayers, id = 's2') => l.timeline.tracks[0].clips.find(c => c.id === id)!;

test('a scene played faster keeps its whole animation: the length follows the speed, a trim plays less of it', () => {
  const l = layers(), s2 = scene(l);
  assert.ok(isScene(s2));
  assert.equal(isScene(l.timeline.tracks[1].clips[0]), false);
  setSceneSpeed(s2, 2);
  assert.deepEqual([s2.duration, s2.sourceDuration, clipSpeed(s2)], [2.5, 5, 2]);
  // the limits: ¼ to 4×
  setSceneSpeed(s2, 9);
  assert.deepEqual([s2.duration, clipSpeed(s2)], [1.25, 4]);
  assert.equal(speedToLength(s2, 0.5), 1.25);
  assert.equal(speedToLength(s2, 40), 20);
  // back to 1×: no speed left on the clip
  setSceneSpeed(s2, 1);
  assert.deepEqual([s2.duration, 'speed' in s2.params], [5, false]);
  // trimmed at 2×: 4 s of animation in 2 s
  setSceneSpeed(s2, 2); s2.duration = 2; s2.sourceDuration = 2 * clipSpeed(s2);
  assert.equal(sceneSpan(s2), 4);
});

test('the root page says how fast a scene plays, and the editor and the agent hear it', () => {
  const edited = layers();
  setSceneSpeed(scene(edited), 2);
  assert.notEqual(timingKey(edited), timingKey(layers()));
  const page = parseHTML(applyTimelineEdits(HTML, edited, layers())).document;
  const host = page.querySelector('[data-hf-id="s2"]')!;
  assert.deepEqual([host.getAttribute('data-duration'), host.getAttribute('data-ot-speed'), host.getAttribute('data-playback-rate')], ['2.5', '2', null]);
  assert.equal(page.querySelector('[data-hf-id="s1"]')!.getAttribute('data-ot-speed'), null);
  assert.deepEqual(speedPages(edited), ['compositions/scene-2.html']);
  assert.deepEqual(speedPages(layers()), []);
  assert.match(describeTimeline(edited, layers()).join('\n'), /动效卡「s2」.*时长 5 秒 → 2\.5 秒，变速 2×（整段动画按这个速度完整播完/);
  // back to 1× and moved: no speed on the page
  const back = structuredClone(edited); setSceneSpeed(scene(back), 1); scene(back).start = 6;
  assert.equal(parseHTML(applyTimelineEdits(HTML, back, layers())).document.querySelector('[data-hf-id="s2"]')!.getAttribute('data-ot-speed'), null);
  assert.deepEqual(speedPages(back), []);
});

test('a scene page gets the scripts that play its frame scripts and timed elements at its host\'s speed', () => {
  const out = withSpeedScripts(SCENE);
  assert.ok(out.startsWith('<!doctype html><html><head><meta charset="utf-8"></head><body><template><script>window.__otSpeedFrom='));
  assert.ok(out.endsWith('</script></template></body></html>'));
  assert.match(out, /document\.getElementById\("scene-2"\)/);
  // its own scripts sit between the two, unchanged
  assert.ok(out.includes(SCENE.slice(SCENE.indexOf('<style>'), SCENE.indexOf('</template>'))));
  assert.equal(withSpeedScripts(out), out);
  assert.equal(withSpeedScripts('<div>no template</div>'), '<div>no template</div>');
});

test('only a scene that moves by CSS animations and frame scripts can play at another speed', () => {
  assert.equal(speedable(SCENE), true);
  assert.equal(speedable(SCENE.replace('<script>', '<script>gsap.timeline();')), false);
  assert.equal(speedable(SCENE.replace('<div class="box"></div>', '<video src="a.mp4"></video>')), false);
  assert.equal(speedable(SCENE.replace('onFrame(el,t=>{})', "el.animate([{opacity:0},{opacity:1}],500)")), false);
  assert.equal(speedable('<div>no template</div>'), false);
});
