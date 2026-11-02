import {killProcessGroup} from './edition.ts';
import {removeWithRetrySync,cleanupPathSync} from '../file-ops.ts';
import platform from '../platform.ts';
/** General export jobs own a new directory and an immutable snapshot. No agent run or UI files are changed. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { GeneralExport, GeneralLayers } from '../../src/general/general-contract.ts';
import { findGeneral, updateGeneral } from './store.ts';
import { layersToFilm } from './layers.ts';
import { prepareWork } from './kit-env.ts';
import {ExportSettingsSchema} from '../../src/types/editor.ts';
import {exportSettingsForPreset} from '../../src/studio/export-settings.ts';
import {writeExportPreferences} from '../export-preferences.ts';
import {probeExportMedia} from './export-media.ts';
import {HF_ENTRY,isHyperframesWork,readHyperframes} from './hf-project.ts';
import {editedCaptionPage,editedCaptionPages,editedHyperframes} from './hf-timeline.ts';
import {editedSpeedPages,withSpeedScripts} from './hf-speed.ts';
import {validateDirectory} from '../system-settings.ts';
import {assertVideoExportSupported} from '../../shared/export-video.ts';

export function readGeneralExport(dir:string,id:string):GeneralExport {
 if(!/^[0-9a-f-]{36}$/.test(id))throw Error('导出记录编号无效');
 return JSON.parse(fs.readFileSync(path.join(dir,'exports','.jobs',id+'.json'),'utf8'));
}
export function generalExportHistory(dir:string) {
 const folder=path.join(dir,'exports','.jobs');
 return fs.existsSync(folder)?fs.readdirSync(folder).filter(f=>/^[0-9a-f-]{36}\.json$/.test(f)).map(f=>readGeneralExport(dir,f.slice(0,-5))).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)):[];
}
export async function generalExportSource(id:string,version:number) {
 const {dir,project}=findGeneral(id),v=project.versions.find(v=>v.n===version);
 if(!v)throw Object.assign(Error('这一版不存在'),{status:400});
 const folder=path.join(dir,'versions',`v${version}`),work=path.join(folder,'work');
 const source=path.join(folder,fs.existsSync(path.join(folder,'edited.json'))?'edited.json':'layers.json');
 const layers:GeneralLayers|undefined=fs.existsSync(source)?JSON.parse(fs.readFileSync(source,'utf8')):undefined;
 const filmFile=path.join(work,'film.json');
 const kind=layers?.engine==='hyperframes'||isHyperframesWork(work)?'hyperframes':layers||fs.existsSync(filmFile)?'film':'video';
 const media=layers?{width:layers.width,height:layers.height,fps:layers.fps,duration:layers.duration}:kind==='hyperframes'?{...await readHyperframes(work),fps:30}:kind==='film'?JSON.parse(fs.readFileSync(filmFile,'utf8')):await probeExportMedia(path.join(dir,'versions',`v${version}.mp4`));
 return {dir,project,folder,work,layers,kind,media};
}


type ActiveExport = { task: GeneralExport; cancel: () => Promise<GeneralExport> };
const active = new Map<string, ActiveExport>();
export const activeGeneralExports = () => active.size;
const running = (task?: GeneralExport) => task?.state === 'running' || task?.state === 'cancelling';
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lockPath = (dir: string) => path.join(dir, 'exports', '.active');
export function exportRunning(id: string): boolean { reconcileExports(id); return running(findGeneral(id).project.exportTask); }
export function reconcileExports(id: string) {
  const { dir, project } = findGeneral(id);
  if (!running(project.exportTask) || active.has(id)) return;
  let owner: { pid?: number; worker?: number } = {};
  try { owner = JSON.parse(fs.readFileSync(path.join(lockPath(dir), 'owner.json'), 'utf8')); } catch { /* interrupted before worker start */ }
  if (owner.pid && alive(owner.pid)) return;
  if (owner.worker) { try { platform.killTree(owner.worker, 'SIGKILL'); } catch { /* exited */ } }
  const job = project.exportTask!;
  if (/^[0-9a-f-]{36}$/.test(job.id)) removeWithRetrySync(path.join(dir, 'exports', job.id), { recursive: true, force: true });
  removeWithRetrySync(lockPath(dir), { recursive: true, force: true });
  updateGeneral(id, p => { p.exportTask = { ...job, state: 'failed', endedAt: new Date().toISOString(), error: '导出因服务中断而停止，请重新导出' }; });
}

/** Bind cancellation to the displayed task, so a delayed click can never stop a newer retry. */
export async function cancelExport(id: string, taskId: string): Promise<GeneralExport> {
  reconcileExports(id);
  const task = findGeneral(id).project.exportTask;
  if (!task || task.id !== taskId) throw Object.assign(new Error('导出任务已变化，请刷新后重试'), { status: 409 });
  if (!running(task)) return task;
  const job = active.get(id);
  if (!job || job.task.id !== taskId) throw Object.assign(new Error('导出由另一服务处理，请在原窗口取消'), { status: 409 });
  return job.cancel();
}

export async function cancelGeneralExport(id:string){const task=findGeneral(id).project.exportTask;return task?cancelExport(id,task.id):undefined;}
export async function startExport(id: string, version: number, format: unknown, value?:unknown): Promise<GeneralExport> {
  reconcileExports(id);
  const { dir, project } = findGeneral(id);
  if (active.has(id) || running(project.exportTask)) return active.get(id)?.task ?? project.exportTask!;
  if (format !== 'mp4' && format !== 'jianying') throw Object.assign(new Error('导出格式只能是 mp4 或 jianying'), { status: 400 });
  if(!Number.isSafeInteger(version))throw Object.assign(Error('版本编号无效'),{status:400});
  const parsed=ExportSettingsSchema.safeParse(value ?? exportSettingsForPreset(format==='jianying'?'jianying':'quick'));
  if(!parsed.success)throw Object.assign(Error('导出参数无效'),{status:400});
  const settings=parsed.data;
  if(format==='mp4')assertVideoExportSupported(settings.video,process.platform);
  const {work,layers,kind,media}=await generalExportSource(id,version);
  if(active.has(id))return active.get(id)!.task;
  if(kind==='video'&&typeof settings.fps==='number'&&settings.fps>media.fps&&format!=='jianying')
    throw Object.assign(Error('这一版只保留了成片，没有动效源码，无法按更高帧率重新渲染；请选跟工程或重新生成版本'),{status:400});
  const destination=settings.destinationDir.trim()?validateDirectory(settings.destinationDir):path.join(dir,'exports');
  fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
  try { fs.mkdirSync(lockPath(dir)); }
  catch { throw Object.assign(new Error('工程还有导出正在启动，请稍后重试'), { status: 409 }); }
  const task: GeneralExport = { settings, media:{width:media.width,height:media.height,fps:media.fps}, id: crypto.randomUUID(), version, format, state: 'running', step: '准备导出', progress: 0, startedAt: new Date().toISOString() };
  const output = path.join(destination, task.id);
  task.outputDir=output;
  const jobs=path.join(dir,'exports','.jobs');fs.mkdirSync(jobs,{recursive:true});
  writeExportPreferences(dir,settings);
  const patch = (value: Partial<GeneralExport>) => { Object.assign(task, value); fs.writeFileSync(path.join(jobs,task.id+'.json'),JSON.stringify(task,null,2)); updateGeneral(id, p => { if (!p.exportTask || p.exportTask.id === task.id || !running(p.exportTask)) p.exportTask = { ...task }; }); };
  let child: ReturnType<typeof spawn> | undefined;
  let settled = false, cancelRequested = false;
  let resolveFinished!: () => void;
  const finished = new Promise<void>(resolve => { resolveFinished = resolve; });
  const remove = (target: string) => removeWithRetrySync(target, { recursive: true, force: true });
  const stop = () => { if (child?.pid) try { platform.killTree(child.pid, 'SIGKILL'); } catch { /* already stopped */ } };
  const done = (error?: unknown) => {
    if (settled) return;
    settled = true;
    process.off('exit', stop);
    stop();
    try {
      if (cancelRequested) {
        remove(output);
        patch({ state: 'cancelled', step: '导出已取消', endedAt: new Date().toISOString() });
      } else if (error) {
        remove(output);
        patch({ state: 'failed', endedAt: new Date().toISOString(), error: `导出失败：${error instanceof Error ? error.message : error}` });
      } else {
        const result = format === 'mp4' ? `成片.${settings.video.codec==='prores422'?'mov':settings.video.container}` : '剪映工程';
        if (!fs.existsSync(path.join(output, result))) throw new Error('没有生成导出文件');
        for (const part of ['work', 'media']) remove(path.join(output, part));
        patch({ state: 'done', step: '导出完成', progress: 1, endedAt: new Date().toISOString(), ...(format === 'mp4' ? {downloadUrl:`/api/general/projects/${encodeURIComponent(id)}/exports/${task.id}/file`} : {folder:path.join(output,result)}) });
      }
    } catch (failure) {
      const result:Partial<GeneralExport>={ state:'failed',endedAt:new Date().toISOString(),error:`导出收尾失败：${failure instanceof Error?failure.message:failure}` };
      try{patch(result)}catch(error){Object.assign(task,result);task.error+=`；状态保存失败：${error instanceof Error?error.message:String(error)}`;console.warn(task.error)}
    } finally {
      try { cleanupPathSync(lockPath(dir),{recursive:true}); }
      finally { if (active.get(id)?.task === task) active.delete(id); resolveFinished(); }
    }
  };
  active.set(id, { task, cancel: async () => {
    if (!cancelRequested && !settled) {
      cancelRequested = true;
      patch({ state: 'cancelling', step: '正在终止导出并清理文件' });
    }
    if (!settled) { stop(); if (!child?.pid) done(); }
    // Keep the lock and the busy state until close confirms the owned worker has stopped.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([finished, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('正在等待导出进程退出，请稍后重试取消'), { status: 409 })), 10_000); })]);
    } finally { clearTimeout(timer); }
    return { ...task };
  } });
  try {
    fs.writeFileSync(path.join(lockPath(dir), 'owner.json'), JSON.stringify({ pid: process.pid }));
    patch({});
    fs.mkdirSync(output,{recursive:true});
    // Copy, never hard-link: later edits and render caches cannot mutate this export. A copy-on-write clone where the
    // volume can (APFS: instant and no extra space, like the 口播 export), a real copy elsewhere.
    const clone = { recursive: true, dereference: true, mode: fs.constants.COPYFILE_FICLONE };
    if(fs.existsSync(work))fs.cpSync(work, path.join(output, 'work'), clone);
    else fs.mkdirSync(path.join(output,'work'));
    // the person's timeline edits of a HyperFrames film go into the export's own copy of the page
    if(kind==='hyperframes'){
      const entry=path.join(output,'work',HF_ENTRY);if(fs.existsSync(entry))fs.writeFileSync(entry,editedHyperframes(path.dirname(work),fs.readFileSync(entry,'utf8')));
      // and its caption pages shown line by line
      for(const sub of editedCaptionPages(path.dirname(work))){const page=path.resolve(output,'work',decodeURIComponent(sub));if(page.startsWith(path.resolve(output,'work')+path.sep)&&fs.existsSync(page))fs.writeFileSync(page,editedCaptionPage(path.dirname(work),sub,fs.readFileSync(page,'utf8')));}
      // and its scenes played faster or slower
      for(const sub of editedSpeedPages(path.dirname(work))){const page=path.resolve(output,'work',decodeURIComponent(sub));if(page.startsWith(path.resolve(output,'work')+path.sep)&&fs.existsSync(page))fs.writeFileSync(page,withSpeedScripts(fs.readFileSync(page,'utf8')));}
    }
    if(kind==='video')fs.copyFileSync(path.join(dir,'versions',`v${version}.mp4`),path.join(output,'work','source.mp4'),fs.constants.COPYFILE_FICLONE);
    fs.writeFileSync(path.join(output,'request.json'),JSON.stringify({settings,kind,media}));
    if (fs.existsSync(path.join(dir, 'media'))) fs.cpSync(path.join(dir, 'media'), path.join(output, 'media'), clone);
    if(layers)fs.writeFileSync(path.join(output, 'layers.json'), JSON.stringify(layers, null, 2));
    // a HyperFrames film is its page: the worker renders it with the person's edits (layers.json), no film.json
    if (kind === 'film') {
      const film = layers ? layersToFilm(layers) : JSON.parse(fs.readFileSync(path.join(output,'work','film.json'),'utf8'));
      if(format==='mp4'&&typeof settings.fps==='number')film.fps=settings.fps;
      fs.writeFileSync(path.join(output, 'work', 'film.json'), JSON.stringify(film, null, 2));
      // The agent's plan describes the old order. Export's private plan follows the edited snapshot.
      const plan = path.join(output, 'work', 'plan.json');
      if (fs.existsSync(plan)) { const p = JSON.parse(fs.readFileSync(plan, 'utf8')); fs.writeFileSync(plan, JSON.stringify({ ...p, duration: film.duration, segments: film.segments })); }
    }
    const env = prepareWork(output, { ...process.env, CW_NETWORK: '0', CW_STYLE: project.styleId, CW_EXPORT: '1' });
    const script = fileURLToPath(new URL('./export-worker.ts', import.meta.url));
    child = spawn(process.execPath, ['--experimental-strip-types', script, output, format, project.name], { cwd: output, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    fs.writeFileSync(path.join(lockPath(dir), 'owner.json'), JSON.stringify({ pid: process.pid, worker: child.pid }));
    let tail = '', pending = '';
    process.once('exit', stop);
    child.stdout?.on('data', data => {
      pending += data.toString();
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (line.startsWith('EXPORT:') && !settled && !cancelRequested) { try {
          const value = JSON.parse(line.slice(7));
          // Workers report progress only; late stdout must not resurrect a cancelled task.
          if (typeof value.step === 'string' && Number.isFinite(value.progress)) patch({ step: value.step, progress: Math.max(0, Math.min(1, value.progress)) });
        } catch { /* log line, not progress */ } }
        if (!line.startsWith('EXPORT:')) tail = (tail + line + '\n').slice(-8000);
      }
    });
    child.stderr?.on('data', d => { tail = (tail + d).slice(-8000); });
    child.once('error', done);
    child.once('close', code => done(code === 0 ? undefined : tail.trim() || `出片工具退出（${code}）`));
    fs.writeFileSync(path.join(lockPath(dir), 'owner.json'), JSON.stringify({ pid: process.pid, worker: child.pid }));
  } catch (error) { done(error); }
  return { ...task };
}
