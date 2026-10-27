/**
 * The agent's pages run on their own origin, never the editor's: http://v<N>-<projectId>.localhost:<port>/<page>.
 * Each version gets its own host, so a page can reach only its snapshot (versions/vN/work), the project's media
 * (/_media/), the kit's offline libraries (/_kit/) and fonts (/_fonts/) — the same map the kit uses — and nothing on
 * the network. HTML pages get page-bridge.js, which lets the editor seek them frame by frame.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findGeneral } from './store.ts';
import { KIT_DIR, fontDirs, iconsDir, nodeModulesPath } from './kit-env.ts';
import { HF_ENTRY, isHyperframesWork } from './hf-project.ts';

const BRIDGE = fs.readFileSync(new URL('./page-bridge.js', import.meta.url), 'utf8');
const HF_EDITS = fs.readFileSync(new URL('./hf-edit-bridge.js', import.meta.url), 'utf8');
// A HyperFrames film plays in the editor with HyperFrames' own runtime (Apache-2.0), driven by OpenTake's controls.
let hfRuntime: string | undefined;
const runtimeSource = () => (hfRuntime ??= fs.readFileSync(path.join(nodeModulesPath(), '@hyperframes', 'producer', 'dist', 'hyperframe.runtime.iife.js'), 'utf8'));
const HOST = /^v(\d{1,4})-([0-9a-f-]{36})\.localhost(?::\d+)?$/i;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};
// Pages may use inline scripts and their own files, but no other origin.
const CSP = "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' data: blob:; frame-ancestors *";

type Resolve = (pathname: string, roots: { work: string; media: string }) => string | undefined;
let resolver: Promise<Resolve> | undefined;
function kitResolver() {
  // the kit's env module reads these when it loads; point it at the app's runtime
  process.env.CW_NODE_MODULES ||= nodeModulesPath();
  process.env.CW_FONT_DIRS ||= fontDirs().join(path.delimiter);
  process.env.CW_ICONS_DIR ||= iconsDir() ?? '';
  resolver ??= import(pathToFileURL(path.join(KIT_DIR, 'lib', 'browser.mjs')).href).then(m => m.resolveRequest as Resolve);
  return resolver;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const fail = (status: number, text: string) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); };
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'method');
  const m = HOST.exec(String(req.headers.host || ''));
  if (!m) return fail(404, 'host');
  let dir: string;
  try { dir = findGeneral(m[2]).dir; } catch { return fail(404, 'project'); }
  const work = path.join(dir, 'versions', `v${Number(m[1])}`, 'work');
  if (!fs.existsSync(work)) return fail(404, 'version');
  const url = new URL(req.url || '/', 'http://page.localhost');
  if (url.pathname === '/_ot/bridge.js') { res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' }); return res.end(BRIDGE); }
  if (url.pathname === '/_ot/hf-edit.js') { res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' }); return res.end(HF_EDITS); }
  if (url.pathname === '/_hf/runtime.js') { res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' }); return res.end(runtimeSource()); }
  const file = (await kitResolver())(url.pathname, { work, media: path.join(dir, 'media') });
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(404, 'file');
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers: Record<string, string> = { 'content-type': type, 'content-security-policy': CSP, 'cache-control': 'no-cache', 'access-control-allow-origin': '*' };
  if (type.startsWith('text/html')) {
    let html = fs.readFileSync(file, 'utf8');
    if (isHyperframesWork(work)) {
      // the film's root page gets the runtime before its own scripts (sub-compositions are loaded by the runtime itself)
      // and, after them, the person's text edits
      if (path.resolve(file) === path.resolve(work, HF_ENTRY)) {
        const tag = '<script src="/_hf/runtime.js"></script>', edits = '<script src="/_ot/hf-edit.js"></script>';
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => `${m}${tag}`) : `${tag}${html}`;
        html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${edits}</body>`) : `${html}${edits}`;
      }
    } else {
      const tag = '<script src="/_ot/bridge.js"></script>';
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : `${html}${tag}`;
    }
    res.writeHead(200, headers);
    return res.end(req.method === 'HEAD' ? undefined : html);
  }
  const size = fs.statSync(file).size, range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2])), end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    res.writeHead(206, { ...headers, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'accept-ranges': 'bytes', 'content-length': String(size) });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

let started: Promise<number> | undefined;
/** Start once, on loopback only; returns the port. */
export function pageHostPort(): Promise<number> {
  started ??= new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    server.unref();
  });
  return started;
}

/** Where version n's page lives, for the editor. */
export const pageOrigin = (id: string, n: number, port: number) => `http://v${n}-${id}.localhost:${port}`;
