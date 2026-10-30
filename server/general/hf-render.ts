/**
 * Export B for a HyperFrames film: OpenTake's own frame renderer (the one 口播 exports with) draws every frame of the
 * page under HyperFrames' runtime, then OpenTake mixes the sound. HyperFrames only serves the page (its file server
 * injects the runtime); frames, video decoding and encoding are ours, with the bundled Chrome and LGPL FFmpeg.
 *
 * Accuracy rules found against the browser preview (S先生 2026-10-25, docs/通用剪辑接入HyperFrames方案.md):
 * every page seeks frame 0 first, clip starts snap to the frame grid, a video shows the last frame whose own timestamp
 * is at or before the moment, and the stand-in picture copies the video's whole box. The page never loads the media
 * files themselves (a sounding <video> would keep the frame waiting on its stream).
 */
import fs from 'node:fs';
import { muxNormalizedAudio } from './audio.ts';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderVideo } from '../frame-render/index.ts';
import { HF_ENTRY, readHyperframes } from './hf-project.ts';
import type { HfPageEdits } from '../../src/general/general-contract.ts';
import { ffmpegPath, ffprobePath } from './kit-env.ts';

const exec = promisify(execFile);
const SHIM = fs.readFileSync(new URL('./hf-render-shim.js', import.meta.url), 'utf8');
const EDITS = fs.readFileSync(new URL('./hf-edit-bridge.js', import.meta.url), 'utf8');
const MEDIA = /\.(mp4|mov|m4v|webm|mkv|avi|wav|mp3|m4a|aac|ogg|flac)$/i;
const TYPES: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

export type HfRenderOptions = { browserExecutable?: string; fps?: number; concurrency?: number; cancelSignal?: AbortSignal; onProgress?: (progress: number) => void; onActivity?: (detail: string) => void; cacheDir?: string; edits?: HfPageEdits };

/** Every video the film uses, once, on its own frame grid: JPEG frames on disk and their timestamps. */
async function extractVideos(work: string, srcs: string[], cacheDir: string) {
  const out: Record<string, { key: string; count: number; pts: number[] }> = {};
  await Promise.all([...new Set(srcs)].map(async (src, i) => {
    const file = path.join(work, decodeURIComponent(src)), key = `v${i}`, dir = path.join(cacheDir, key);
    if (!fs.existsSync(file)) return;
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    await exec(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-fps_mode', 'passthrough', '-q:v', '2', '-start_number', '0', path.join(dir, '%d.jpg')], { maxBuffer: 8 << 20 });
    const { stdout } = await exec(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file], { maxBuffer: 64 << 20 });
    const times = stdout.trim().split('\n').map(line => parseFloat(line)).filter(Number.isFinite);
    const pageUrl = new URL(src, 'http://film.localhost/').pathname;
    out[decodeURIComponent(pageUrl)] = { key, count: fs.readdirSync(dir).length, pts: times.map(t => Math.round((t - (times[0] ?? 0)) * 1e6) / 1e6) };
  }));
  return out;
}

/** The film's sound: every audio clip and every sounding video, placed, trimmed, turned up or down, mixed. */
async function mixSound(work: string, clips: Awaited<ReturnType<typeof readHyperframes>>['clips'], duration: number, out: string) {
  const sounding = clips.filter(c => c.hasAudio && c.src && fs.existsSync(path.join(work, decodeURIComponent(c.src))));
  if (!sounding.length) return false;
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  const chains: string[] = [];
  sounding.forEach((c, i) => {
    args.push('-i', path.join(work, decodeURIComponent(c.src)));
    const tempo = c.rate && c.rate !== 1 ? `,atempo=${Math.min(4, Math.max(0.25, c.rate))}` : '';
    const delay = Math.max(0, Math.round(c.start * 1000));
    chains.push(`[${i}:a]atrim=start=${c.mediaStart}:duration=${c.duration * (c.rate || 1)},asetpts=PTS-STARTPTS${tempo},volume=${c.volume},adelay=${delay}|${delay},aresample=48000[a${i}]`);
  });
  const filter = `${chains.join(';')};${sounding.map((_, i) => `[a${i}]`).join('')}amix=inputs=${sounding.length}:normalize=0:duration=longest,apad,atrim=duration=${duration}[mix]`;
  await exec(ffmpegPath(), [...args, '-filter_complex', filter, '-map', '[mix]', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_f32le', out], { maxBuffer: 8 << 20 });
  return true;
}

/** work/index.html → an H.264 MP4 with sound at `output`. */
export async function renderHyperframes(work: string, output: string, options: HfRenderOptions = {}) {
  const fps = options.fps ?? 30;
  const film = await readHyperframes(work);
  const cacheDir = options.cacheDir ?? path.join(path.dirname(output), `.hf-frames-${process.pid}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const { createFileServer } = await import('@hyperframes/producer');
  const { toFps } = await import('@hyperframes/core');
  const server = await createFileServer({ projectDir: work, fps: toFps(fps), preHeadScripts: ['globalThis.__HF_RENDER_CAPTURE_MODE = true;'] });
  const silent = `${output}.${process.pid}.video.mp4`, sound = `${output}.${process.pid}.sound.wav`;
  try {
    options.onActivity?.('正在抽取素材并解码视频');
    const videos = await extractVideos(work, film.clips.filter(c => c.tag === 'video' && c.src).map(c => c.src), cacheDir);
    const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
    const inject = `<script>window.__otFps=${fps};window.__otVideos=${json(videos)};window.__otPageEdits=${json(options.edits ?? {})}</script><script>${EDITS}</script><script>${SHIM}</script>`;
    const assetResolver = async (pathname: string) => {
      if (pathname.startsWith('/__ot_frames/')) return { body: await fs.promises.readFile(path.join(cacheDir, pathname.slice('/__ot_frames/'.length))), contentType: 'image/jpeg' };
      if (MEDIA.test(pathname)) return { body: Buffer.alloc(0), contentType: 'application/octet-stream' };
      const file = path.join(work, decodeURIComponent(pathname));
      if (!/\.html?$/i.test(pathname) && pathname !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) return { body: await fs.promises.readFile(file), contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' };
      // pages come through HyperFrames' file server, which puts its runtime in them
      const res = await fetch(server.url + pathname);
      if (!res.ok) throw new Error(`${res.status} ${pathname}`);
      let body = Buffer.from(await res.arrayBuffer());
      if (pathname === '/' || pathname === `/${HF_ENTRY}`) body = Buffer.from(String(body).replace(/<\/body>/i, `${inject}</body>`));
      return { body, contentType: res.headers.get('content-type') || 'text/html' };
    };
    const total = Math.round(film.duration * fps);
    options.onActivity?.('素材解码完成，正在逐帧渲染');
    await renderVideo({
      browserExecutable: options.browserExecutable, serveUrl: work, entryPath: `/${HF_ENTRY}`, assetResolver, concurrency: options.concurrency ?? 4, imageFormat: 'jpeg', jpegQuality: 92, outputLocation: silent,
      composition: { id: 'main', width: film.width, height: film.height, fps, durationInFrames: total },
      ...(options.cancelSignal ? { cancelSignal: options.cancelSignal } : {}), onProgress: ({ progress }) => options.onProgress?.(progress),
    });
    options.onActivity?.('正在混音并统一响度');
    if (await mixSound(work, film.clips, film.duration, sound)) {
      await muxNormalizedAudio(ffmpegPath(), silent, sound, output);
    } else fs.renameSync(silent, output);
  } finally {
    server.close();
    for (const f of [silent, sound]) fs.rmSync(f, { force: true });
    if (!options.cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  return { duration: film.duration, width: film.width, height: film.height };
}
