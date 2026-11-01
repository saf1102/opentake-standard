/**
 * 动效卡变速 on the page side (S先生 11-01; the clip side is src/general/hf-speed.ts). HyperFrames plays only media at
 * a rate (data-playback-rate), so OpenTake warps a scene's time itself, the same in the preview and the export:
 *   - the root page's scene host says how fast: data-ot-speed (hf-timeline.ts);
 *   - its CSS animations: hf-speed-bridge.js, in the root page, scales the time HyperFrames seeks them to;
 *   - its frame scripts (window.__hfAnime, the onFrame line of HF.md) and its own timed elements: two scripts put
 *     around the scene page's own scripts here, which run in that page as HyperFrames mounts it.
 * A scene that moves some other way (GSAP, Lottie, three.js, its own video or sound, a page inside it) cannot be
 * warped: speedable says so, and its clip only trims.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { GeneralLayers } from '../../src/general/general-contract.ts';
import { clipSpeed, isScene } from '../../src/general/hf-speed.ts';

const OTHER_MOTION = /\bgsap\b|__timelines|\.animate\s*\(|hf-seek|lottie|\bTHREE\b|<video\b|<audio\b|data-composition-src/i;

/** Whether scene page `html` moves only by what OpenTake can play faster: CSS animations and frame scripts. */
export function speedable(html: string) {
  return /<template\b/i.test(html) && !OTHER_MOTION.test(html);
}

// Before the page's scripts: where its frame scripts will start in the list. After them: those scripts seek the
// scene's time scaled by its host's data-ot-speed (read at each seek), and its timed elements are scaled once.
const BEFORE = '<script>window.__otSpeedFrom=(window.__hfAnime??=[]).length;</script>';
const after = (rootId: string | undefined) => `<script>(()=>{const root=${rootId ? `document.getElementById(${JSON.stringify(rootId)})||` : ''}document.querySelector('[data-composition-id]');if(!root)return;`
  + `const host=()=>root.closest('[data-composition-id][data-start]'),rate=()=>{const h=host(),k=h?Number(h.getAttribute('data-ot-speed')):1;return k>0?k:1;};`
  + `for(const e of (window.__hfAnime||[]).slice(window.__otSpeedFrom||0)){if(!e||typeof e.seek!=='function'||e.__otSpeed)continue;const seek=e.seek;e.__otSpeed=1;`
  + `e.seek=function(ms){const k=rate();if(k===1)return seek.call(this,ms);const s=(Number(host().dataset.start)||0)*1000;return seek.call(this,s+(ms-s)*k);};}`
  + `const k=rate();if(k!==1)for(const el of [root,...root.querySelectorAll('[data-start],[data-duration]')])for(const a of ['start','duration']){`
  + `const v=el.getAttribute('data-'+a);if(v===null||!Number.isFinite(Number(v)))continue;if(!el.hasAttribute('data-ot-'+a))el.setAttribute('data-ot-'+a,v);`
  + `el.setAttribute('data-'+a,String(Number(el.getAttribute('data-ot-'+a))/k));}})();</script>`;

/** Scene page `html` with the two scripts around its own (the rest of the file as it was). */
export function withSpeedScripts(html: string) {
  const template = /(<template\b[^>]*>)([\s\S]*)(<\/template>)/i.exec(html);
  if (!template || html.includes('__otSpeedFrom')) return html;
  const rootId = /<[a-z][^>]*\bdata-composition-id\b[^>]*>/i.exec(template[2])?.[0].match(/\sid\s*=\s*["']([^"']+)["']/i)?.[1];
  return html.slice(0, template.index) + template[1] + BEFORE + template[2] + after(rootId) + template[3] + html.slice(template.index + template[0].length);
}

/** The scene pages (paths as the root page names them) a version's edits play at another speed. */
export function speedPages(edited: GeneralLayers): string[] {
  return [...new Set(edited.timeline.tracks.flatMap(t => t.clips).filter(c => isScene(c) && Math.abs(clipSpeed(c) - 1) > 1e-3).map(c => String(c.params.sub)))];
}

/** speedPages of version folder `folder`, from its edited.json. */
export function editedSpeedPages(folder: string): string[] {
  try { return speedPages(JSON.parse(fs.readFileSync(path.join(folder, 'edited.json'), 'utf8'))); }
  catch { return []; }
}

/** Which of a version's scene pages can play at another speed, by their paths as the root page names them. */
export function speedableScenes(work: string, layers: GeneralLayers): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const clip of layers.timeline.tracks.flatMap(t => t.clips).filter(isScene)) {
    const sub = String(clip.params.sub);
    if (sub in out) continue;
    const file = path.resolve(work, decodeURIComponent(sub));
    out[sub] = file.startsWith(path.resolve(work) + path.sep) && fs.existsSync(file) && speedable(fs.readFileSync(file, 'utf8'));
  }
  return out;
}
