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

const active = new Map<string, GeneralExport>();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lockPath = (dir: string) => path.join(dir, 'exports', '.active');
export function exportRunning(id: string): boolean { reconcileExports(id); return Boolean(findGeneral(id).project.exportTask?.state === 'running'); }
export function reconcileExports(id: string) {
  const { dir, project } = findGeneral(id);
  if (project.exportTask?.state !== 'running' || active.has(id)) return;
  let owner: { pid?: number; worker?: number } = {};
  try { owner = JSON.parse(fs.readFileSync(path.join(lockPath(dir), 'owner.json'), 'utf8')); } catch { /* interrupted before worker start */ }
  if (owner.pid && alive(owner.pid)) return;
  if (owner.worker) { try { platform.killTree(owner.worker, 'SIGKILL'); } catch { /* exited */ } }
  const job = project.exportTask;
  if (/^[0-9a-f-]{36}$/.test(job.id)) fs.rmSync(path.join(dir, 'exports', job.id), { recursive: true, force: true });
  fs.rmSync(lockPath(dir), { recursive: true, force: true });
  updateGeneral(id, p => { p.exportTask = { ...job, state: 'failed', endedAt: new Date().toISOString(), error: '导出因服务中断而停止，请重新导出' }; });
}

export function startExport(id: string, version: number, format: unknown): GeneralExport {
  reconcileExports(id);
  const { dir, project } = findGeneral(id);
  if (active.has(id) || project.exportTask?.state === 'running') return active.get(id) ?? project.exportTask!;
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
  active.set(id, task);
  const patch = (value: Partial<GeneralExport>) => { Object.assign(task, value); updateGeneral(id, p => { p.exportTask = { ...task }; }); };
  let child: ReturnType<typeof spawn> | undefined;
  const cleanup = () => { active.delete(id); fs.rmSync(lockPath(dir), { recursive: true, force: true }); };
  const fail = (error: unknown) => { fs.rmSync(output, { recursive: true, force: true }); patch({ state: 'failed', endedAt: new Date().toISOString(), error: `导出失败：${error instanceof Error ? error.message : error}` }); cleanup(); };
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
    fs.writeFileSync(path.join(lockPath(dir), 'owner.json'), JSON.stringify({ pid: process.pid, worker: child.pid }));
    let tail = '', pending = '', settled = false;
    const stop = () => { if (child?.pid) try { platform.killTree(child.pid, 'SIGKILL'); } catch { /* already stopped */ } };
    process.once('exit', stop);
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
      if (error) return fail(error);
      // the film is downloaded; a 剪映 project is a folder (as from the 口播 export): shown in Finder, imported by its own
      // 导入剪映-Mac.command / 导入剪映-Windows.cmd
      const result = format === 'mp4' ? '成片.mp4' : '剪映工程';
      if (!fs.existsSync(path.join(output, result))) return fail('没有生成导出文件');
      // the working snapshot served the render only; like the 口播 export, only the result (and the edit snapshot) stays
      for (const part of ['work', 'media']) fs.rmSync(path.join(output, part), { recursive: true, force: true });
      patch({ state: 'done', step: '导出完成', progress: 1, endedAt: new Date().toISOString(), ...(format === 'mp4' ? { downloadUrl: fileUrl(id, `exports/${task.id}/${result}`) } : { folder: path.join(output, result) }) });
      cleanup();
    };
    child.once('error', done);
    child.once('close', code => done(code === 0 ? undefined : tail.trim() || `出片工具退出（${code}）`));
  } catch (error) { fail(error); }
  return { ...task };
}
