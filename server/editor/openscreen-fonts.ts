import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { findOpenScreenExecutable } from './openscreen.ts';
import { serveResolvedFile } from '../general/files.ts';
import { sendJson } from '../http.ts';

const FAMILIES = ['Inter', 'Caveat', 'IBMPlexMono', 'Lora', 'Oswald'] as const;
const FILES = FAMILIES.flatMap(family => ['Regular', 'Bold'].map(weight => `${family}-${weight}.ttf`));

/** Only the known fonts shipped by the separately installed dependency are exposed.
 * No directory browsing or arbitrary native file paths are accepted. */
function installedFonts(): Map<string, string> {
  const executable = findOpenScreenExecutable();
  const result = new Map<string, string>();
  if (!executable) return result;
  const parent = path.dirname(fs.realpathSync(executable));
  const candidates = [path.join(parent, 'resources', 'fonts'), path.resolve(parent, '..', 'Resources', 'fonts')];
  for (const candidate of candidates) {
    let root: string;
    try { root = fs.realpathSync(candidate); if (!fs.statSync(root).isDirectory()) continue; }
    catch { continue; }
    for (const name of FILES) {
      try {
        const file = fs.realpathSync(path.join(root, name));
        if (file.startsWith(root + path.sep) && fs.statSync(file).isFile()) result.set(name, file);
      } catch { /* Optional installed font: retain the browser's system fallback. */ }
    }
    if (result.size) break;
  }
  return result;
}

export function serveOpenScreenFonts(req: IncomingMessage, res: ServerResponse, name?: string) {
  const fonts = installedFonts();
  if (name !== undefined) {
    const file = fonts.get(name);
    if (!file) return sendJson(res, 404, { ok: false, error: '字体不存在' });
    return serveResolvedFile(req, res, file);
  }
  const rules = [...fonts.keys()].map(file => {
    const family = file.slice(0, file.lastIndexOf('-')) === 'IBMPlexMono' ? 'IBM Plex Mono' : file.slice(0, file.lastIndexOf('-'));
    return `@font-face{font-family:"${family}";font-style:normal;font-weight:${file.includes('-Bold') ? 700 : 400};font-display:swap;src:url("/api/editor/openscreen/fonts/${file}") format("truetype")}`;
  }).join('\n');
  res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : rules);
}
