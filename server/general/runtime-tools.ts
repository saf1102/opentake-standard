import fs from 'node:fs';
import path from 'node:path';
import media from '../media-tools.ts';
import {resolvePython} from './python-runtime.ts';
import {chromium} from 'playwright-core';
const executable = (file: string) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };
export const supportBin=media.supportBin;
export const ffmpegPath=media.ffmpegPath;
export const ffprobePath=media.ffprobePath;
export function chromePath(){
 const file=process.env.CW_CHROME || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
 if(file && executable(file))return file;
 const resolved=chromium.executablePath(); if(executable(resolved))return resolved;
 throw new Error('请准备 Playwright Chromium，或设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE。');
}
export const pythonPath=resolvePython;
/** Font folders from the template library on this machine (core/fonts and each style's demo/fonts). */
export function fontDirs(): string[] {
  const extra = (process.env.LINKREADER_GENERAL_FONT_DIRS || '').split(path.delimiter).filter(Boolean);
  const dirs = extra;
  return dirs.filter(dir => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
}

