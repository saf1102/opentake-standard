/** Runs outside the agent sandbox, in one disposable export directory. */
import fs from 'node:fs';
import {renderAppFilm} from './app-render.ts';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KIT_DIR, ffmpegPath, ffprobePath } from './kit-env.ts';
import { deliverVideo } from './runner.ts';
import { volumeDb, type Film2 } from './layers.ts';
import { renderHyperframes } from './hf-render.ts';
import { hfPageEdits, type GeneralLayers } from '../../src/general/general-contract.ts';
const exec = promisify(execFile);
const [output, format, name] = process.argv.slice(2);
const work = path.join(output, 'work');
const progress = (step: string, n: number) => console.log(`EXPORT:${JSON.stringify({ step, progress: n })}`);
const run = async (bin: string, args: string[]) => {
  try { return await exec(bin, args, { cwd: work, env: process.env, timeout: 3_600_000, maxBuffer: 8 << 20 }); }
  catch (e) { const x = e as { stderr?: string; message?: string }; throw new Error((x.stderr || x.message || '工具运行失败').slice(-5000)); }
};
const filmCommand = (...args: string[]) => run(process.execPath, [path.join(KIT_DIR, 'film.mjs'), ...args]);
const ff = (args: string[]) => run(ffmpegPath(), ['-v','error','-y',...args]);
try {
  const layers = JSON.parse(fs.readFileSync(path.join(output, 'layers.json'), 'utf8')) as GeneralLayers;
  if (layers.engine === 'hyperframes') {
    // the page is the film: OpenTake's renderer draws it with the person's edits, then mixes its sound
    progress('渲染画面', .05);
    const film = path.join(work, 'out.mp4');
    await renderHyperframes(work, film, { fps: layers.fps, edits: hfPageEdits(layers), onProgress: p => progress('渲染画面', .05 + .85 * p) });
    progress('检查 H.264 成片', .95); await deliverVideo(film, path.join(output, '成片.mp4'));
  } else {
    progress('检查分轨和页面', .05);
    await filmCommand('check');
    if (format === 'mp4') {
      progress('渲染画面和转场', .15);
      const film = JSON.parse(fs.readFileSync(path.join(work, 'film.json'),'utf8')) as Film2;
      await renderAppFilm(film,work,{onProgress:p=>progress('渲染画面和转场',.15+.6*p)});
      progress('混合声音', .8); await filmCommand('mux');
      progress('检查 H.264 成片', .95); await deliverVideo(path.join(work, 'out.mp4'), path.join(output, '成片.mp4'));
    } else {
      throw new Error('Standard 导出格式为 MP4');
    }
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
