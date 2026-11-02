import {assertStorageIdle} from '../editor/api/storage.ts';
import {chooseExportDestination} from '../editor/settings-host.ts';
import {videoExportCapabilities} from '../../shared/export-video.ts';
import {readExportPreferences,writeExportPreferences} from '../export-preferences.ts';
import {requireCreationTools} from '../creation-tools.ts';
import {extraStyle,styleError,revealPath} from './edition.ts';
/** /api/general：通用剪辑的接口，照 src/general/general-contract.ts 实现。回应沿用工作台的 {ok, result} / {ok:false, error}。 */
import { startExport, exportRunning, reconcileExports, generalExportSource, generalExportHistory, readGeneralExport, cancelGeneralExport, cancelExport } from './export.ts';
import {renameWithRetrySync,removeWithRetrySync,cleanupPathSync} from '../file-ops.ts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GeneralMedia, GeneralProject } from '../../src/general/general-contract.ts';
import { bodyJson, sendJson } from '../http.ts';
import { assertFreeSpace } from '../system-settings.ts';
import { serveProjectFile, serveResolvedFile } from './files.ts';
import { pageHostPort } from './page-host.ts';
import { readGeneralLayers, saveEdited, sceneSpeedsOf, soundFilesOf, soundsOf, soundWaveform, stylePresets, upgradeVersion } from './layers.ts';
import { ffmpegPath, ffprobePath } from './kit-env.ts';
import { switchRunAgent, answerNetwork, isLive, mediaFile, postMessage, reconcile, resumeRun, assertReady, startFirst, stopForDelete, stopRun, styleLibrary, readSession, writeSession } from './runner.ts';
import { createGeneral, fileUrl, findGeneral, generalChanges, patchGeneral, scanGeneral, summarize, trashGeneral, restoreGeneral, purgeGeneral, updateGeneral } from './store.ts';

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
      if (method === 'GET') return ok(res, scanGeneral(url.searchParams.get('includeDeleted')==='1').map(l => summarize(l.deletedAt ? l.project : reconcile(l), l.deletedAt)));
      if (method === 'POST') {
        const body = await bodyJson(req);
        const styleId = String(body.styleId || '');
        // 不用风格 (free) is a choice too: the film follows the person's own words
        const style = extraStyle?.id === styleId ? extraStyle : styleLibrary().find(s => s.id === styleId);
        if (!style) return sendJson(res, 400, { ok: false, error: styleError });
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
    if(action==='restore'&&method==='POST'&&parts.length===3){assertStorageIdle();return ok(res,restoreGeneral(id));}
    if(action==='purge'&&method==='POST'&&parts.length===3){const body=await bodyJson(req);if(body.confirmProjectId!==id)throw Object.assign(Error('请确认彻底删除的工程'),{status:400});assertStorageIdle();await purgeGeneral(id);return ok(res,null);}
    if(action==='agent-comparison'&&method==='GET'&&parts.length===3){const {compareProjectAgentRuns}=await import('../agent-comparison.ts');return ok(res,compareProjectAgentRuns(findGeneral(id).project.id));}
    if (action === 'events' && method === 'GET') return events(req, res, id);
    // 打开工程目录 in the editor's media column (S先生 10-31: it did nothing)
    if (action === 'reveal' && method === 'POST' && parts.length === 3) {
      const { dir } = findGeneral(id);
      await revealPath(dir);
      return ok(res, { revealed: true });
    }
    if (action === 'files' && (method === 'GET' || method === 'HEAD')) {
      const { dir, project } = findGeneral(id);
      const rel = url.pathname.split('/').filter(Boolean).slice(3).join('/');
      const version = /^versions\/v(\d+)\.mp4$/.exec(rel)?.[1];
      return serveProjectFile(req, res, dir, rel, version ? `${project.name} 第${version}版.mp4` : undefined);
    }
    if(action==='versions'&&parts[4]==='layers'&&parts.length===5&&method==='GET')return ok(res,readGeneralLayers(id,Number(parts[3])));
    if(action==='exports'&&parts[4]==='cancel'&&parts.length===5&&method==='POST')return ok(res,await cancelExport(id,parts[3]));
    if(action==='exports') {
      const {dir,project}=findGeneral(id);
      if(parts[3]==='preferences'&&parts.length===4) {
        if(method==='GET')return ok(res,readExportPreferences(dir));
        if(method==='PUT')return ok(res,writeExportPreferences(dir,await bodyJson(req)));
      }
      if(parts[3]==='capabilities'&&method==='GET') {
        const source=await generalExportSource(id,Number(url.searchParams.get('version')));
        const destination=path.join(dir,'exports');fs.mkdirSync(destination,{recursive:true});
        const stats=fs.statfsSync(destination);
        return ok(res,{video:videoExportCapabilities(process.platform),defaultDestination:destination,freeBytes:stats.bavail*stats.bsize,jianying:{available:false,warning:'完成后可从导出文件夹导入剪映'},canvas:{width:source.media.width,height:source.media.height,fps:source.media.fps}});
      }
      if(parts[3]==='destination'&&method==='POST') {
        return ok(res,{path:await chooseExportDestination('选择导出位置')});
      }
      if(parts[3]==='history'&&method==='GET')return ok(res,generalExportHistory(dir));
      if(parts[3]==='cancel'&&method==='POST')return ok(res,await cancelGeneralExport(id));
      if(parts[4]==='file'&&(method==='GET'||method==='HEAD')) {
        const job=readGeneralExport(dir,parts[3]);
        if(job.state!=='done'||!job.outputDir||job.format!=='mp4')throw Error('成片尚未生成');
        const file=path.join(job.outputDir,`成片.${job.settings?.video.codec==='prores422'?'mov':job.settings?.video.container||'mp4'}`);
        return serveResolvedFile(req,res,file,path.basename(file));
      }
      if(parts[3]==='reveal'&&method==='POST') {
        const body=await bodyJson(req);const task=body.id?readGeneralExport(dir,String(body.id)):project.exportTask;
        const target=task?.state==='done'?(task.folder||task.outputDir):undefined;
        if(!target||!fs.existsSync(target))throw Error('找不到导出文件夹');
        await revealPath(target);
        return ok(res,{revealed:true});
      }
    }
    if(action==='versions'&&parts[4]==='export'&&parts.length===5&&method==='POST') {
      const body=await bodyJson(req);return ok(res,await startExport(id,Number(parts[3]),body.format,body.settings));
    }
    if (action === 'text-presets' && method === 'GET') return ok(res, await stylePresets(findGeneral(id).project.styleId));
    // the person's edits of version n: versions/vN/edited.json, the same shape as layers.json
    // a version read before 字幕一句一条 / 音效一声一段: its caption page as lines, its mixed effect strips cut (once)
    if (action === 'versions' && parts[4] === 'upgrade' && parts.length === 5 && method === 'POST') return ok(res, await upgradeVersion(id, Number(parts[3])));
    // the version's sound files: how long each is, and its waveform (peaks for 配音, a picture for 配乐 / 音效)
    if (action === 'versions' && parts[4] === 'sound-files' && parts.length === 5 && method === 'GET') return ok(res, await soundFilesOf(id, Number(parts[3])));
    // 动效卡变速: which scenes can play their whole animation faster or slower
    if (action === 'versions' && parts[4] === 'scene-speeds' && parts.length === 5 && method === 'GET') return ok(res, sceneSpeedsOf(id, Number(parts[3])));
    if (action === 'versions' && parts[4] === 'waveform' && parts.length === 5 && method === 'GET') {
      const kind = url.searchParams.get('kind') === 'peaks' ? 'peaks' : 'picture';
      const body = await soundWaveform(id, Number(parts[3]), url.searchParams.get('src') ?? '', kind);
      res.writeHead(200, { 'content-type': kind === 'peaks' ? 'application/octet-stream' : 'image/png', 'content-length': body.length, 'cache-control': 'private, max-age=3600' });
      return res.end(body);
    }
    // 按声音切开: the separate sounds in a stretch of one of the version's sound files
    if (action === 'versions' && parts[4] === 'sounds' && parts.length === 5 && method === 'GET') {
      const q = url.searchParams;
      return ok(res, await soundsOf(id, Number(parts[3]), q.get('src') ?? '', Number(q.get('from')) || 0, Number(q.get('duration')) || 0));
    }
    if (action === 'versions' && parts[4] === 'edited' && parts.length === 5 && method === 'PUT') return ok(res, saveEdited(id, Number(parts[3]), await bodyJson(req, 32 * 1024 * 1024)));
    if (action === 'media' && method === 'POST' && parts.length === 3) return ok(res, await addMedia(req, id), 201);
    if (action === 'media' && method === 'DELETE' && parts.length === 4) return ok(res, removeMedia(id, parts[3]));
    if (method !== 'POST' || parts.length !== 3) return sendJson(res, 404, { ok: false, error: '接口不存在' });
    if (action === 'generate') { assertReady(findGeneral(id).project); return ok(res, startFirst(id, { request: true, tools:await requireCreationTools(findGeneral(id).project.agent) })); }
    if (action === 'stop') return ok(res, stopRun(id));
    if(action==='switch-agent'){
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||''))return sendJson(res,403,{ok:false,error:'只允许在本机切换智能体'});
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return sendJson(res,403,{ok:false,error:'不允许跨站切换智能体'});
      const body=await bodyJson(req);return ok(res,await switchRunAgent(id,body.agent));
    }
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
  }).catch(error => { cleanupPathSync(tmp); throw error; });
  if (!fs.statSync(tmp).size) { removeWithRetrySync(tmp, { force: true }); throw Object.assign(new Error('上传的文件是空的'), { status: 400 }); }
  renameWithRetrySync(tmp, file);
  let info: { duration: number; width: number; height: number };
  try { info = await probe(file); }
  catch (error) { cleanupPathSync(file); throw Object.assign(new Error(`读不出这个文件：${error instanceof Error ? error.message : error}`), { status: 415 }); }
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
  if (file) removeWithRetrySync(file, { force: true });
  removeWithRetrySync(path.join(dir, 'media', `${mediaId}.poster.jpg`), { force: true });
  return updateGeneral(id, p => { p.inputs.media = p.inputs.media.filter(m => m.id !== mediaId); });
}
