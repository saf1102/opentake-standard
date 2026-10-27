/** GET /projects/:id/files/* — versions, posters, review frames, the plan and the agent's look frames. Range requests for media. */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
};
/** Folders the page may read. agent/ (session ids, logs) and the project file itself are not served. */
const SERVED = ['media', 'versions', 'review', 'work', 'exports'];
const WORK_TYPES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.md', '.mp4', '.json', '.srt']);

export function resolveProjectFile(dir: string, rel: string): string | undefined {
  let decoded: string;
  try { decoded = rel.split('/').map(decodeURIComponent).join('/'); } catch { return undefined; }
  if (decoded.includes('\0')) return undefined;
  const parts = path.posix.normalize(`/${decoded}`).split('/').filter(Boolean);
  if (!parts.length || !SERVED.includes(parts[0]) || parts.some(p => p === '..' || p.startsWith('._'))) return undefined;
  if (parts[0] === 'exports' && (parts.length !== 3 || !/^[0-9a-f-]{36}$/.test(parts[1]) || !['成片.mp4'].includes(parts[2]))) return undefined;
  // agent pages and scripts run only on the page host's own origin (page-host.ts), never on the editor's
  if (parts[0] === 'versions' && /\.(html?|m?js|svg|xhtml)$/i.test(parts.at(-1)!)) return undefined;
  if (parts[0] === 'work' && (!WORK_TYPES.has(path.extname(parts.at(-1)!).toLowerCase()) || parts.includes('.opentake') || parts.includes('.tmp'))) return undefined;
  const file = path.resolve(dir, ...parts);
  if (!file.startsWith(path.resolve(dir) + path.sep)) return undefined;
  try {
    const real = fs.realpathSync(file);
    if (!real.startsWith(fs.realpathSync(dir) + path.sep) || !fs.statSync(real).isFile()) return undefined;
    return real;
  } catch { return undefined; }
}

/** Parse a single "bytes=a-b" range against a size; undefined = whole file; null = unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | undefined | null {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return undefined;
  let start: number, end: number;
  if (m[1] === '') { const n = Number(m[2]); if (n === 0) return null; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) return null;
  return { start, end };
}

/** attachment with the person's file name (UTF-8) and an ASCII fallback; a <video> still plays it. */
export function contentDisposition(name: string) {
  const clean = name.replace(/[\0-\x1f\x7f/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'video.mp4';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

export function serveProjectFile(req: IncomingMessage, res: ServerResponse, dir: string, rel: string, downloadName?: string) {
  const file = resolveProjectFile(dir, rel);
  if (!file) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ ok: false, error: '文件不存在' })); return; }
  return serveResolvedFile(req,res,file,downloadName);
}

/** Caller must validate the file against its own module's positive allowlist. */
export function serveResolvedFile(req:IncomingMessage,res:ServerResponse,file:string,downloadName?:string){
  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  if (downloadName) res.setHeader('Content-Disposition', contentDisposition(downloadName));
  const range = parseRange(typeof req.headers.range === 'string' ? req.headers.range : undefined, stat.size);
  if (range === null) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${stat.size}`); res.end(); return; }
  const { start, end } = range ?? { start: 0, end: stat.size - 1 };
  if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`); }
  else res.statusCode = 200;
  res.setHeader('Content-Length', String(stat.size ? end - start + 1 : 0));
  if (req.method === 'HEAD' || stat.size === 0) { res.end(); return; }
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
