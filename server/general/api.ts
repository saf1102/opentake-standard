import {requireCreationTools} from '../standard/creation-tools.ts';
import platform from '../platform.ts';
/** /api/general：通用剪辑的接口，照 src/general/general-contract.ts 实现。回应沿用工作台的 {ok, result} / {ok:false, error}。 */
import { startExport, exportRunning, reconcileExports } from './export.ts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GeneralMedia, GeneralProject } from '../../src/general/general-contract.ts';
import { bodyJson, sendJson } from '../http.ts';
import { assertFreeSpace } from '../system-settings.ts';
import { serveProjectFile } from './files.ts';
import { pageHostPort } from './page-host.ts';
import { saveEdited, stylePresets } from './layers.ts';
import { ffmpegPath, ffprobePath } from './kit-env.ts';
import { answerNetwork, isLive, mediaFile, postMessage, reconcile, resumeRun, startFirst, stopForDelete, stopRun, styleLibrary, readSession, writeSession } from './runner.ts';
import { createGeneral, fileUrl, findGeneral, generalChanges, patchGeneral, scanGeneral, summarize, trashGeneral, updateGeneral } from './store.ts';

const exec = promisify(execFile);
const MEDIA_TYPES = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.jpg', '.jpeg', '.png', '.webp']);
const ok = (res: ServerResponse, result: unknown, status = 200) => sendJson(res, status, { ok: true, result });
const load = (id: string) => { reconcileExports(id); return reconcile(findGeneral(id)); };

export async function handleGeneralApi(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://local');
  const parts = url.pathname.split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  const method = req.method || 'GET';
  try {
    if (parts[0] === 'page-host' && method === 'GET') return ok(res, { port: await pageHostPort() });
    if (parts[0] !== 'projects') return sendJson(res, 404, { ok: false, error: '接口不存在' });
    if (parts.length === 1) {
      if (method === 'GET') return ok(res, scanGeneral().map(l => summarize(reconcile(l))));
      if (method === 'POST') {
        const body = await bodyJson(req);
        const styleId = String(body.styleId || '');
        // 不用风格 (free) is a choice too: the film follows the person's own words
        const style = styleLibrary().find(s => s.id === styleId);
        if (!style) return sendJson(res, 400, { ok: false, error: '请选择 Standard 的 10 种风格之一' });
        const { project } = createGeneral({ styleId, settings: body.settings, inputs: body.inputs as never, agent: body.agent, network: body.network }, style.name_zh);
        return ok(res, project, 201);
      }
      return sendJson(res, 405, { ok: false, error: '不支持的方法' });
    }
    const id = parts[1];
    const action = parts[2];
    if (!action) {
      if (method === 'GET') return ok(res, load(id));
      if (method === 'PATCH') {
        const { dir } = findGeneral(id);
        return ok(res, patchGeneral(id, await bodyJson(req), () => { const s = readSession(dir); s.autoName = false; writeSession(dir, s); }));
      }
      if (method === 'DELETE') {
        if (exportRunning(id)) throw Object.assign(new Error('正在导出，请等导出结束后再删除工程'), { status: 409 });
        await stopForDelete(id);
        trashGeneral(id);
        return ok(res, null);
      }
      return sendJson(res, 405, { ok: false, error: '不支持的方法' });
    }
    if (action === 'events' && method === 'GET') return events(req, res, id);
    if (action === 'files' && (method === 'GET' || method === 'HEAD')) {
      const { dir, project } = findGeneral(id);
      const rel = url.pathname.split('/').filter(Boolean).slice(3).join('/');
      const version = /^versions\/v(\d+)\.mp4$/.exec(rel)?.[1];
      return serveProjectFile(req, res, dir, rel, version ? `${project.name} 第${version}版.mp4` : undefined);
    }
    if (action === 'versions' && parts[4] === 'export' && parts.length === 5 && method === 'POST') return ok(res, startExport(id, Number(parts[3]), (await bodyJson(req)).format));
    // the last 剪映 export's folder, selected in Finder (only a folder inside this project's exports/)
    if (action === 'exports' && parts[3] === 'reveal' && parts.length === 4 && method === 'POST') {
      const { dir, project } = findGeneral(id);
      const folder = project.exportTask?.state === 'done' ? project.exportTask.folder : undefined;
      const inside = folder && path.resolve(folder).startsWith(path.join(dir, 'exports') + path.sep) && fs.existsSync(folder);
      if (!inside) return sendJson(res, 404, { ok: false, error: '找不到上次导出的剪映工程，请重新导出' });
      const reveal=platform.revealCommand(folder);await exec(reveal.command,reveal.args);
      return ok(res, { revealed: true });
    }
    if (action === 'text-presets' && method === 'GET') return ok(res, await stylePresets(findGeneral(id).project.styleId));
    // the person's edits of version n: versions/vN/edited.json, the same shape as layers.json
    if (action === 'versions' && parts[4] === 'edited' && parts.length === 5 && method === 'PUT') return ok(res, saveEdited(id, Number(parts[3]), await bodyJson(req, 32 * 1024 * 1024)));
    if (action === 'media' && method === 'POST' && parts.length === 3) return ok(res, await addMedia(req, id), 201);
    if (action === 'media' && method === 'DELETE' && parts.length === 4) return ok(res, removeMedia(id, parts[3]));
    if (method !== 'POST' || parts.length !== 3) return sendJson(res, 404, { ok: false, error: '接口不存在' });
    if (action === 'generate') return ok(res, startFirst(id, { request: true, ...(process.platform==='darwin'?{tools:await requireCreationTools()}:{} ) }));
    if (action === 'stop') return ok(res, stopRun(id));
    if (action === 'resume') return ok(res, resumeRun(id));
    if (action === 'messages') return ok(res, postMessage(id, await bodyJson(req, 16 * 1024 * 1024)));
    if (action === 'network') {
      const body = await bodyJson(req);
      if (typeof body.allow !== 'boolean') return sendJson(res, 400, { ok: false, error: 'allow 必须是 true 或 false' });
      return ok(res, answerNetwork(id, body.allow));
    }
    return sendJson(res, 404, { ok: false, error: '接口不存在' });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    if (!res.headersSent) sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : String(error), ...(status===412?{environment:(error as {environment?:unknown}).environment}:{}) });
    else res.destroy();
  }
}

/** text/event-stream: the full project now, then after every change. */
function events(req: IncomingMessage, res: ServerResponse, id: string) {
  const first = load(id);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (project: GeneralProject) => { res.write(`data: ${JSON.stringify(project)}\n\n`); };
  send(first);
  const listener = (project: GeneralProject) => { if (project.id === id) send(project); };
  generalChanges.on('change', listener);
  const ping = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
  const close = () => { clearInterval(ping); generalChanges.off('change', listener); };
  req.on('close', close);
  res.on('close', close);
}

/** POST media: the request body is the file; x-file-name carries its (URI-encoded) name. */
async function addMedia(req: IncomingMessage, id: string): Promise<GeneralMedia> {
  const { dir, project } = findGeneral(id);
  if (project.run && ['running', 'stopping', 'needs-network'].includes(project.run.state) && isLive(id)) throw Object.assign(new Error('出片时不能改素材，请先停止'), { status: 409 });
  let name = 'media';
  try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'media')); } catch { /* keep default */ }
  name = path.basename(name).replace(/[\0/\\:]/g, ' ').trim().slice(0, 160) || 'media';
  const ext = path.extname(name).toLowerCase();
  if (!MEDIA_TYPES.has(ext)) throw Object.assign(new Error(`不支持的文件类型：${ext || '无扩展名'}`), { status: 415 });
  const folder = path.join(dir, 'media');
  fs.mkdirSync(folder, { recursive: true });
  assertFreeSpace(folder);
  const mediaId = crypto.randomUUID();
  const file = path.join(folder, `${mediaId}${ext}`);
  const tmp = `${file}.uploading`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    req.on('error', reject); out.on('error', reject); out.on('finish', () => resolve());
    req.pipe(out);
  }).catch(error => { fs.rmSync(tmp, { force: true }); throw error; });
  if (!fs.statSync(tmp).size) { fs.rmSync(tmp, { force: true }); throw Object.assign(new Error('上传的文件是空的'), { status: 400 }); }
  fs.renameSync(tmp, file);
  let info: { duration: number; width: number; height: number };
  try { info = await probe(file); }
  catch (error) { fs.rmSync(file, { force: true }); throw Object.assign(new Error(`读不出这个文件：${error instanceof Error ? error.message : error}`), { status: 415 }); }
  const posterFile = path.join(folder, `${mediaId}.poster.jpg`);
  let poster: string | undefined;
  if (info.width > 0) {
    try {
      await exec(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...(info.duration > 0 ? ['-ss', String(Math.min(1, info.duration / 3))] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', posterFile]);
      poster = fileUrl(id, path.relative(dir, posterFile));
    } catch { /* audio-only or undecodable first frame: no poster */ }
  }
  const media: GeneralMedia = { id: mediaId, name, duration: info.duration, width: info.width, height: info.height, file: `${mediaId}${ext}`, ...(poster ? { poster } : {}) };
  updateGeneral(id, p => { p.inputs.media.push(media); });
  return media;
}
async function probe(file: string) {
  const { stdout } = await exec(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { maxBuffer: 4 << 20 });
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number }[] };
  const video = info.streams?.find(s => s.codec_type === 'video');
  if (!info.streams?.length) throw new Error('没有音视频流');
  return { duration: Math.round((Number(info.format?.duration) || 0) * 1000) / 1000, width: video?.width || 0, height: video?.height || 0 };
}
function removeMedia(id: string, mediaId: string): GeneralProject {
  const { dir, project } = findGeneral(id);
  if (project.run && ['running', 'stopping', 'needs-network'].includes(project.run.state) && isLive(id)) throw Object.assign(new Error('出片时不能改素材，请先停止'), { status: 409 });
  if (!project.inputs.media.some(m => m.id === mediaId)) throw Object.assign(new Error('素材不存在'), { status: 404 });
  const file = mediaFile(dir, mediaId);
  if (file) fs.rmSync(file, { force: true });
  fs.rmSync(path.join(dir, 'media', `${mediaId}.poster.jpg`), { force: true });
  return updateGeneral(id, p => { p.inputs.media = p.inputs.media.filter(m => m.id !== mediaId); });
}
