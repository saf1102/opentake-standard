import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const executable = file => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };
const first = (...files) => files.find(file => file && executable(file));
const media=createRequire(import.meta.url)('../../../../desktop/media-tools.cjs');
export function tool(name){const pinned=process.env[name==='ffmpeg'?'CW_FFMPEG':name==='ffprobe'?'CW_FFPROBE':''];if(pinned){if(!executable(pinned))throw Error('已确认的工具不可用：'+name);return pinned;}if(name==='ffmpeg')return media.ffmpegPath();if(name==='ffprobe')return media.ffprobePath();throw Error('未知媒体工具 '+name)}

export function chromePath() {
  const found = first(process.env.CW_CHROME, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, createRequire(import.meta.url)('playwright-core').chromium.executablePath());
  if (!found) throw new Error('找不到 OpenTake 自带的无头 Chrome，请报告这个问题。');
  return found;
}

