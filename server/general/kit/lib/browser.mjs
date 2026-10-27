// Headless Chrome inside the agent's sandbox. Two workarounds verified in the Codex trial:
//  1. the macOS sandbox refuses Chrome's mach-port registration, so Chrome runs as one process (--single-process --no-zygote);
//  2. no process may listen on a port, so pages are served from disk through page.route on a made-up origin.
// One browser holds one page in single-process mode; parallel work opens several browsers.
import fs from 'node:fs';
import path from 'node:path';
import { chromePath, fontDirs, iconsDir, KIT, LIBRARIES, MEDIA, nodeModules, playwright, WORK } from './env.mjs';

export const ORIGIN = 'http://film.localhost';
// Inside the Codex sandbox Metal is refused (Chrome stops with SIGTRAP when asked for it), so WebGL runs on SwiftShader (CPU).
// CW_CHROME_GL=metal asks for the GPU when the kit runs outside the sandbox.
export const CHROME_ARGS = ['--single-process', '--no-zygote', '--ignore-gpu-blocklist', '--font-render-hinting=none', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio',
  ...(process.env.CW_CHROME_GL === 'metal' ? ['--use-gl=angle', '--use-angle=metal'] : ['--enable-unsafe-swiftshader'])];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.ktx2': 'application/octet-stream', '.wasm': 'application/wasm', '.csv': 'text/csv; charset=utf-8',
};

/** Resolve a film.localhost URL path to a file on disk, or undefined. Never leaves its root. */
export function resolveRequest(pathname, roots = { work: WORK, media: MEDIA }) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return undefined; }
  const inside = (root, sub) => { const file = path.resolve(root, '.' + path.posix.normalize('/' + sub)); return file === root || file.startsWith(root + path.sep) ? file : undefined; };
  if (rel === '/_kit/lib.js') return path.join(KIT, 'web', 'lib.js');
  if (rel.startsWith('/_kit/web/')) return inside(path.join(KIT, 'web'), rel.slice('/_kit/web/'.length));
  if (rel.startsWith('/_kit/')) {
    const sub = rel.slice('/_kit/'.length), name = sub.split('/')[0];
    return Object.hasOwn(LIBRARIES, name) ? inside(path.join(nodeModules(), name), sub.slice(name.length + 1)) : undefined;
  }
  // /_icons/simple-icons/<name>.svg (brand logos) and /_icons/lucide/<name>.svg (symbols); shapes only, painted by the page
  if (rel.startsWith('/_icons/')) { const dir = iconsDir(), sub = rel.slice('/_icons/'.length); return dir && /^(simple-icons|lucide)\/[a-z0-9-]+\.svg$/.test(sub) ? inside(dir, sub) : undefined; }
  if (rel.startsWith('/_fonts/')) {
    const name = path.posix.basename(rel);
    for (const dir of fontDirs()) { const file = findFont(dir, name); if (file) return file; }
    return undefined;
  }
  if (rel.startsWith('/_media/')) return inside(roots.media, rel.slice('/_media/'.length));
  return inside(roots.work, rel.slice(1));
}
const fontIndex = new Map();
function findFont(dir, name) {
  if (!fontIndex.has(dir)) {
    const map = new Map(), walk = (d, depth) => { if (depth > 6) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (/\.(ttf|otf|woff2?)$/i.test(e.name) && !map.has(e.name)) map.set(e.name, p);
    } };
    try { walk(dir, 0); } catch { /* unreadable font folder: skip */ }
    fontIndex.set(dir, map);
  }
  return fontIndex.get(dir).get(name);
}
export function listFonts() {
  const seen = new Map();
  for (const dir of fontDirs()) { findFont(dir, ''); for (const [name, file] of fontIndex.get(dir)) if (!seen.has(name)) seen.set(name, file); }
  return [...seen].map(([name, file]) => ({ name, url: `/_fonts/${name}`, bytes: fs.statSync(file).size })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function launch() {
  const { chromium } = await playwright();
  return chromium.launch({ executablePath: chromePath(), args: CHROME_ARGS });
}

/**
 * Open one page of the film at w×h and wait until it can draw. Returns { browser, page, draw(t), errors }.
 * A page sets window.shot = { frame(t), ready? } (t = seconds from the start of the shot);
 * the template demos' window.render(t) + window.READY are accepted too.
 */
export async function openPage(rel, { w = 1920, h = 1080, query = '', timeout = 120_000 } = {}) {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(`页面报错：${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      if (url.protocol === 'data:' || url.protocol === 'blob:' || process.env.CW_NETWORK === '1') return route.continue();
      errors.push(`离线渲染，不能访问 ${url.href}：库用 /_kit/…，字体用 /_fonts/…，素材放进工作目录`);
      return route.abort('blockedbyclient');
    }
    const file = resolveRequest(url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (url.pathname !== '/favicon.ico') errors.push(`找不到文件：${url.pathname}`);
      return route.fulfill({ status: 404, body: 'not found' });
    }
    return route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' } });
  });
  const pageUrl = `${ORIGIN}/${rel.split('/').map(encodeURIComponent).join('/')}${query ? `?${query}` : ''}`;
  try {
    await page.goto(pageUrl, { waitUntil: 'load', timeout });
    await page.waitForFunction(() => (window.shot && typeof window.shot.frame === 'function') || (typeof window.render === 'function' && window.READY === true), null, { timeout });
    await page.evaluate(async () => { await document.fonts.ready; if (window.shot) await window.shot.ready; });
  } catch (error) {
    await browser.close().catch(() => {});
    throw new Error(`${rel} 没有准备好：${String(error.message || error).split('\n')[0]}${errors.length ? `\n  ${errors.slice(-6).join('\n  ')}` : ''}\n  页面要设置 window.shot = { frame(t), ready }`);
  }
  const draw = async t => {
    await page.evaluate(async time => { if (window.shot) await window.shot.frame(time); else await window.render(time); }, t);
    if (errors.some(e => e.startsWith('页面报错'))) throw new Error(`${rel} 在 t=${t.toFixed(3)} 报错：${errors.filter(e => e.startsWith('页面报错')).slice(-3).join('；')}`);
  };
  return { browser, page, draw, errors };
}

/** WebGL renderer string seen by a page in this browser (shows whether the GPU is used). */
export async function webglInfo() {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
    await page.goto(`${ORIGIN}/probe.html`);
    return await page.evaluate(() => {
      const out = {};
      for (const kind of ['webgl2', 'webgl']) {
        const gl = document.createElement('canvas').getContext(kind);
        if (!gl) { out[kind] = null; continue; }
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        out[kind] = { renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), vendor: String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)) };
      }
      return out;
    });
  } finally { await browser.close(); }
}
