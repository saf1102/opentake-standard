import {exportDiagnostic} from './export-diagnostics.ts';
import fs from 'node:fs';
import path from 'node:path';

/** Shared reference/composite file contract; cache keys and reader leases stay with their owners. */
export function usableRenderCache(file: string) {
  try { return fs.statSync(file).size > 1_024; } catch { return false; }
}
export function materializeRenderCache(cacheFile: string, output: string) {
  fs.rmSync(output, {force:true});
  try {fs.linkSync(cacheFile, output);} catch {fs.copyFileSync(cacheFile, output);}
}
/** Publish only after the renderer resolves. Never expose a partially copied cache entry. */
export function publishRenderCache(output: string, cacheFile: string) {
  const temporary = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    try {fs.linkSync(output, temporary);} catch {fs.copyFileSync(output, temporary);}
    fs.renameSync(temporary, cacheFile);
  } finally {fs.rmSync(temporary, {force:true});}
}
export function trimRenderCache(cacheDir: string, cacheFile: string) {
  const files = fs.readdirSync(cacheDir).map(name=>path.join(cacheDir,name))
    .filter(file=>file!==cacheFile && usableRenderCache(file))
    .sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
  for(const stale of files.slice(2)) fs.rmSync(stale,{force:true});
}

/** Explain the lookup without guessing whether a miss came from changed inputs or cleanup. */
export function renderCacheHit(file:string,kind:'reference'|'composite') {
  const hit=usableRenderCache(file);
  exportDiagnostic('cache-lookup',{kind,key:path.basename(file),hit,reason:hit?'complete-entry':'missing-or-incomplete'});
  return hit;
}
