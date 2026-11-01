import {removeWithRetrySync,cleanupPathSync} from '../file-ops.ts';
import platform from '../platform.ts';
/** General export jobs own a new directory and an immutable snapshot. No agent run or UI files are changed. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { GeneralExport, GeneralLayers } from '../../src/general/general-contract.ts';
import { findGeneral, updateGeneral, fileUrl } from './store.ts';
import { layersToFilm } from './layers.ts';
import { prepareWork } from './kit-env.ts';

type ActiveExport = { task: GeneralExport; cancel: () => Promise<GeneralExport> };
const active = new Map<string, ActiveExport>();
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

export function startExport(id: string, version: number, format: unknown): GeneralExport {
  reconcileExports(id);
  const { dir, project } = findGeneral(id);
  if (active.has(id) || running(project.exportTask)) return { ...(active.get(id)?.task ?? project.exportTask!) };
  if (format !== 'mp4') throw Object.assign(new Error('Standard 导出格式为 mp4'), { status: 400 });
  if (!Number.isSafeInteger(version) || !project.versions.some(v => v.n === version && v.layersUrl)) throw Object.assign(new Error('这一版不存在或没有分轨，不能导出'), { status: 400 });
  const folder = path.join(dir, 'versions', `v${version}`);
  const source = path.join(folder, fs.existsSync(path.join(folder, 'edited.json')) ? 'edited.json' : 'layers.json');
  let layers: GeneralLayers;
  try { layers = JSON.parse(fs.readFileSync(source, 'utf8')); if (layers.engine !== 'hyperframes') layersToFilm(layers); }
  catch (e) { throw Object.assign(new Error(`分轨数据不能导出：${e instanceof Error ? e.message : e}`), { status: 400 }); }
  // 剪映 for a HyperFrames film (one transparent render per clip) is not built yet
  fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
  try { fs.mkdirSync(lockPath(dir)); }
  catch { throw Object.assign(new Error('工程还有导出正在启动，请稍后重试'), { status: 409 }); }
  const task: GeneralExport = { id: crypto.randomUUID(), version, format, state: 'running', step: '准备导出', progress: 0, startedAt: new Date().toISOString() };
  const output = path.join(dir, 'exports', task.id);
  const patch = (value: Partial<GeneralExport>) => { Object.assign(task, value); updateGeneral(id, p => { if (!p.exportTask || p.exportTask.id === task.id || !running(p.exportTask)) p.exportTask = { ...task }; }); };
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
        const result = '成片.mp4';
        if (!fs.existsSync(path.join(output, result))) throw new Error('没有生成导出文件');
        for (const part of ['work', 'media']) remove(path.join(output, part));
        patch({ state: 'done', step: '导出完成', progress: 1, endedAt: new Date().toISOString(), downloadUrl: fileUrl(id, `exports/${task.id}/${result}`) });
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
    fs.mkdirSync(output);
    // Copy, never hard-link: later edits and render caches cannot mutate this export. A copy-on-write clone where the
    // volume can (APFS: instant and no extra space, like the 口播 export), a real copy elsewhere.
    const clone = { recursive: true, dereference: true, mode: fs.constants.COPYFILE_FICLONE };
    fs.cpSync(path.join(folder, 'work'), path.join(output, 'work'), clone);
    if (fs.existsSync(path.join(dir, 'media'))) fs.cpSync(path.join(dir, 'media'), path.join(output, 'media'), clone);
    fs.writeFileSync(path.join(output, 'layers.json'), JSON.stringify(layers, null, 2));
    // a HyperFrames film is its page: the worker renders it with the person's edits (layers.json), no film.json
    if (layers.engine !== 'hyperframes') {
      const film = layersToFilm(layers);
      fs.writeFileSync(path.join(output, 'work', 'film.json'), JSON.stringify(film, null, 2));
      // The agent's plan describes the old order. Export's private plan follows the edited snapshot.
      const plan = path.join(output, 'work', 'plan.json');
      if (fs.existsSync(plan)) { const p = JSON.parse(fs.readFileSync(plan, 'utf8')); fs.writeFileSync(plan, JSON.stringify({ ...p, duration: film.duration, segments: film.segments })); }
    }
    const env = prepareWork(output, { ...process.env, CW_NETWORK: '0', CW_STYLE: project.styleId, CW_EXPORT: '1' });
    const script = fileURLToPath(new URL('./export-worker.ts', import.meta.url));
    child = spawn(process.execPath, ['--experimental-strip-types', script, output, format, project.name], { cwd: output, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
