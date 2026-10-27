// Compositor for a layered film (film.json version 2): footage → picture page → text → whole-film finish, one frame at a
// time. `film look`, `film still` and `film render` drive it through window.shot.frame(t) with t in film seconds.
// Transitions between segments and the opening / ending fades are applied after capture (see film.mjs), not here.
import { applyPageEdits, applyPageOverrides } from '/_kit/web/page-edits.js';
import { renderTextLayer } from '/_kit/web/text.js';

const spec = await (await fetch('/' + new URLSearchParams(location.search).get('spec'))).json();
const { film, frames, presets, fonts = [] } = spec;
const fontLoads = fonts.map(f => { const face = new FontFace(f.family, `url('${f.url}')`, { weight: f.weight || '100 900', style: f.style || 'normal' }); document.fonts.add(face); return face.load().catch(() => {}); });
const W = film.width, H = film.height;
const $ = id => document.getElementById(id);
for (const id of ['stage', 'pages', 'text', 'finish']) Object.assign($(id).style, { width: `${W}px`, height: `${H}px` });
const canvas = $('footage'); canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');
const grain = $('grain'); grain.width = Math.ceil(W / 3); grain.height = Math.ceil(H / 3);
Object.assign(grain.style, { width: `${W}px`, height: `${H}px`, mixBlendMode: 'overlay', opacity: '0.18', display: film.finish === 'grain' ? 'block' : 'none', imageRendering: 'pixelated' });
if (film.finish === 'vignette') $('finish').style.background = 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)';

// Static compositor textures: generated once, independent of frame order; no blur passes.
if (film.finish === 'scanlines') $('finish').style.background = 'repeating-linear-gradient(0deg,rgba(0,0,0,.17) 0px,rgba(0,0,0,.17) 1px,transparent 1px,transparent 4px)';
if (film.finish === 'halftone') {
  $('finish').style.background = 'radial-gradient(circle,rgba(20,17,12,.22) .65px,transparent .9px)';
  $('finish').style.backgroundSize = '4px 4px';
}
if (film.finish === 'paper') {
  const tile = document.createElement('canvas'); tile.width = tile.height = 256;
  const g = tile.getContext('2d'), data = g.createImageData(256,256);
  let seed = 73129;
  for (let i=0;i<data.data.length;i+=4) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const v = 160 + (seed >>> 0) % 96;
    data.data[i]=data.data[i+1]=data.data[i+2]=0; data.data[i+3]=Math.round(26*(1-v/255));
  }
  g.putImageData(data,0,0);
  $('finish').style.backgroundImage = `url(${tile.toDataURL()})`;
}

const images = new Map();
function image(url) {
  if (!images.has(url)) {
    if (images.size > 48) images.delete(images.keys().next().value);
    const img = new Image(); img.src = url;
    images.set(url, img.decode().then(() => img));
  }
  return images.get(url);
}
const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const mix = (a, b, u) => a + (b - a) * u;

async function drawFootage(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const clip = film.footage.find(c => t >= c.start && t < c.end);
  if (!clip) return;
  const info = frames[clip.id];
  const k = Math.min(info.count, Math.max(1, Math.floor((t - clip.start) * film.fps + 1e-6) + 1));
  const img = await image(`/${info.dir}/${String(k).padStart(5, '0')}.jpg`);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (clip.fit === 'contain') { const s = Math.min(W / iw, H / ih); ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); return; }
  const u = smooth((t - clip.start) / (clip.end - clip.start));
  const zoom = clip.move ? mix(clip.move.from.zoom, clip.move.to.zoom, u) : 1;
  const [fx, fy] = clip.move ? [mix(clip.move.from.focus[0], clip.move.to.focus[0], u), mix(clip.move.from.focus[1], clip.move.to.focus[1], u)] : clip.focus;
  const s = Math.max(W / iw, H / ih) * zoom, vw = W / s, vh = H / s;
  const sx = Math.min(iw - vw, Math.max(0, fx * iw - vw / 2)), sy = Math.min(ih - vh, Math.max(0, fy * ih - vh / 2));
  ctx.drawImage(img, sx, sy, vw, vh, 0, 0, W, H);
}

const frameEls = new Map();
const missingEdits = [];
function pageFrame(clip) {
  if (!frameEls.has(clip.id)) {
    const el = document.createElement('iframe');
    Object.assign(el.style, { width: `${W}px`, height: `${H}px` });
    el.setAttribute('allowtransparency', 'true');
    const loaded = new Promise((resolve, reject) => { el.onload = resolve; el.onerror = () => reject(new Error(`页面 ${clip.page} 打不开`)); });
    el.src = '/' + clip.page.split('/').map(encodeURIComponent).join('/');
    $('pages').append(el);
    frameEls.set(clip.id, loaded.then(async () => {
      const win = el.contentWindow;
      for (let i = 0; i < 400 && !(win.shot && typeof win.shot.frame === 'function'); i++) await new Promise(r => setTimeout(r, 25));
      if (!win.shot || typeof win.shot.frame !== 'function') throw new Error(`页面 ${clip.page} 没有设置 window.shot = { frame(t) }`);
      await win.document.fonts.ready; await win.shot.ready;
      for (const name of applyPageEdits(win.document, clip.edits)) missingEdits.push({ id: clip.id, page: clip.page, name });
      return { el, win };
    }));
  }
  return frameEls.get(clip.id);
}

async function drawPage(t) {
  const clip = film.picture.find(c => t >= c.start && t < c.end);
  for (const [id, p] of frameEls) if (!clip || id !== clip.id) (await p).el.style.display = 'none';
  if (!clip) return;
  const { el, win } = await pageFrame(clip);
  el.style.display = 'block';
  await win.shot.frame(t - clip.start);
  // the person's moves of elements in the page, after the page drew (its own animation may set transforms each frame)
  if (clip.overrides) applyPageOverrides(win.document, clip.overrides);
}

function drawFinish(t) {
  if (film.finish !== 'grain') return;
  const g = grain.getContext('2d'), data = g.createImageData(grain.width, grain.height);
  let seed = (Math.round(t * film.fps) * 2654435761) >>> 0;
  for (let i = 0; i < data.data.length; i += 4) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const v = (seed >>> 0) % 256; data.data[i] = data.data[i + 1] = data.data[i + 2] = v; data.data[i + 3] = 255; }
  g.putImageData(data, 0, 0);
}

const ready = (async () => {
  await Promise.all(fontLoads);
  await document.fonts.load(`600 40px "Noto Sans SC"`).catch(() => {});
  await document.fonts.ready;
  for (const clip of film.picture) await pageFrame(clip);
})();

window.shot = {
  ready, missingEdits,
  async frame(t) {
    await drawFootage(t);
    await drawPage(t);
    renderTextLayer($('text'), film.text, t, { width: W, height: H, presets });
    drawFinish(t);
    await new Promise(r => requestAnimationFrame(() => r()));
  },
};
