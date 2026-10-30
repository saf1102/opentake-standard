import {killProcessGroup} from './edition.ts';
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
import {isHyperframesWork,readHyperframes} from './hf-project.ts';
import {validateDirectory} from '../system-settings.ts';

const cancellers=new Map<string,()=>void>();
export function readGeneralExport(dir:string,id:string):GeneralExport {
 if(!/^[0-9a-f-]{36}$/.test(id))throw Error('导出记录编号无效');
 return JSON.parse(fs.readFileSync(path.join(dir,'exports','.jobs',id+'.json'),'utf8'));
}
export function generalExportHistory(dir:string) {
 const folder=path.join(dir,'exports','.jobs');
 return fs.existsSync(folder)?fs.readdirSync(folder).filter(f=>/^[0-9a-f-]{36}\.json$/.test(f)).map(f=>readGeneralExport(dir,f.slice(0,-5))).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)):[];
}
export function cancelGeneralExport(id:string) {cancellers.get(id)?.();return findGeneral(id).project.exportTask;}
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


const active = new Map<string, GeneralExport>();
export const activeGeneralExports = () => active.size;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lockPath = (dir: string) => path.join(dir, 'exports', '.active');
export function exportRunning(id: string): boolean { reconcileExports(id); return Boolean(findGeneral(id).project.exportTask?.state === 'running'); }
export function reconcileExports(id: string) {
  const { dir, project } = findGeneral(id);
  if (project.exportTask?.state !== 'running' || active.has(id)) return;
  let owner: { pid?: number; worker?: number } = {};
  try { owner = JSON.parse(fs.readFileSync(path.join(lockPath(dir), 'owner.json'), 'utf8')); } catch { /* interrupted before worker start */ }
  if (owner.pid && alive(owner.pid)) return;
  if (owner.worker) { try { killProcessGroup(owner.worker, 'SIGKILL'); } catch { /* exited */ } }
  const job = project.exportTask;
  if (/^[0-9a-f-]{36}$/.test(job.id)) {
    const output=job.outputDir||path.join(dir,'exports',job.id);
    if(path.basename(output)===job.id)fs.rmSync(output,{recursive:true,force:true});
  }
  fs.rmSync(lockPath(dir), { recursive: true, force: true });
  const failed:GeneralExport={...job,state:'failed',endedAt:new Date().toISOString(),error:'导出因服务中断而停止，请重新导出'};
  const jobs=path.join(dir,'exports','.jobs');fs.mkdirSync(jobs,{recursive:true});
  fs.writeFileSync(path.join(jobs,job.id+'.json'),JSON.stringify(failed));
  updateGeneral(id,p=>{p.exportTask=failed;});
}

export async function startExport(id: string, version: number, format: unknown, value?:unknown): Promise<GeneralExport> {
  reconcileExports(id);
  const { dir, project } = findGeneral(id);
  if (active.has(id) || project.exportTask?.state === 'running') return active.get(id) ?? project.exportTask!;
  if (format !== 'mp4' && format !== 'jianying') throw Object.assign(new Error('导出格式只能是 mp4 或 jianying'), { status: 400 });
  if(!Number.isSafeInteger(version))throw Object.assign(Error('版本编号无效'),{status:400});
  const {work,layers,kind,media}=await generalExportSource(id,version);
  if(active.has(id))return active.get(id)!;
  const parsed=ExportSettingsSchema.safeParse(value ?? exportSettingsForPreset(format==='jianying'?'jianying':'quick'));
  if(!parsed.success)throw Object.assign(Error('导出参数无效'),{status:400});
  const settings=parsed.data;
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
  active.set(id, task);
  const patch = (value: Partial<GeneralExport>) => { Object.assign(task, value); fs.writeFileSync(path.join(jobs,task.id+'.json'),JSON.stringify(task,null,2)); updateGeneral(id, p => { p.exportTask = { ...task }; }); };
  let child: ReturnType<typeof spawn> | undefined;
  const cleanup = () => { active.delete(id); cancellers.delete(id); fs.rmSync(lockPath(dir), { recursive: true, force: true }); };
  const fail = (error: unknown) => { fs.rmSync(output, { recursive: true, force: true }); patch({ state: 'failed', endedAt: new Date().toISOString(), error: `导出失败：${error instanceof Error ? error.message : error}` }); cleanup(); };
  try {
    fs.writeFileSync(path.join(lockPath(dir), 'owner.json'), JSON.stringify({ pid: process.pid }));
    patch({});
    fs.mkdirSync(output,{recursive:true});
    // Copy, never hard-link: later edits and render caches cannot mutate this export. A copy-on-write clone where the
    // volume can (APFS: instant and no extra space, like the 口播 export), a real copy elsewhere.
    const clone = { recursive: true, dereference: true, mode: fs.constants.COPYFILE_FICLONE };
    if(fs.existsSync(work))fs.cpSync(work, path.join(output, 'work'), clone);
    else fs.mkdirSync(path.join(output,'work'));
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
    let tail = '', pending = '', settled = false;
    const stop = () => { if (child?.pid) try { killProcessGroup(child.pid, 'SIGKILL'); } catch { /* already stopped */ } };
    process.once('exit', stop);
    cancellers.set(id,()=>{patch({state:'cancelled',step:'已停止',endedAt:new Date().toISOString()});stop();});
    child.stdout?.on('data', data => {
      pending += data.toString();
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (line.startsWith('EXPORT:')) { try { patch(JSON.parse(line.slice(7))); } catch { /* log line, not progress */ } }
        if (!line.startsWith('EXPORT:')) tail = (tail + line + '\n').slice(-8000);
      }
    });
    child.stderr?.on('data', d => { tail = (tail + d).slice(-8000); });
    const done = (error?: unknown) => {
      if (settled) return; settled = true; process.off('exit', stop); stop();
      if(task.state==='cancelled'){fs.rmSync(output,{recursive:true,force:true});cleanup();return;}
      if (error) return fail(error);
      // the film is downloaded; a 剪映 project is a folder (as from the 口播 export): shown in Finder, imported by its own
      // 导入剪映-Mac.command / 导入剪映-Windows.cmd
      const result = format === 'mp4' ? `成片.${settings.video.codec==='prores422'?'mov':settings.video.container}` : '剪映工程';
      if (!fs.existsSync(path.join(output, result))) return fail('没有生成导出文件');
      // the working snapshot served the render only; like the 口播 export, only the result (and the edit snapshot) stays
      for (const part of ['work', 'media']) fs.rmSync(path.join(output, part), { recursive: true, force: true });
      patch({ state: 'done', step: '导出完成', progress: 1, endedAt: new Date().toISOString(), ...(format === 'mp4' ? { downloadUrl: `/api/general/projects/${encodeURIComponent(id)}/exports/${task.id}/file` } : { folder: path.join(output, result) }) });
      cleanup();
    };
    child.once('error', done);
    child.once('close', code => done(code === 0 ? undefined : tail.trim() || `出片工具退出（${code}）`));
  } catch (error) { fail(error); }
  return { ...task };
}
