import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { startExport, cancelExport, exportRunning } from './general/export.ts';
import { createGeneral, findGeneral, saveGeneral } from './general/store.ts';
import platform from './platform.ts';

async function until(predicate: () => boolean) {
  const end = Date.now() + 10_000;
  while (!predicate()) { assert.ok(Date.now() < end, 'worker state timed out'); await delay(20); }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('cancel stops the owned worker tree, ignores late output and permits a fresh retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'standard-export-'));
  const names = ['LINK_READER_PROJECTS_DIR', 'LINKREADER_SYSTEM_SETTINGS_FILE', 'LINKREADER_BIN_DIR', 'LINKREADER_PYTHON', 'CW_CHROME'];
  const before = names.map(name => process.env[name]);
  const children: ReturnType<typeof childProcess.spawn>[] = [];
  const spawn = childProcess.spawn;
  try {
    process.env.LINK_READER_PROJECTS_DIR = root;
    process.env.LINKREADER_SYSTEM_SETTINGS_FILE = path.join(root, 'settings.json');
    process.env.LINKREADER_BIN_DIR = root;
    process.env.LINKREADER_PYTHON = process.execPath;
    process.env.CW_CHROME = process.execPath;
    for (const name of ['ffmpeg', 'ffprobe']) fs.writeFileSync(path.join(root, name + (process.platform === 'win32' ? '.exe' : '')), '', { mode: 0o755 });
    // Substitute only the renderer, keeping the production job ownership, store, lock and OS tree termination.
    mock.method(childProcess, 'spawn', (exe: string, args: string[], options: childProcess.SpawnOptions) => {
      if (!args[1]?.endsWith('export-worker.ts')) return spawn(exe, args, options);
      const script = `const fs=require('node:fs'),p=require('node:path'),out=process.argv[1];
        if(fs.existsSync(p.join(out,'work','finish'))) {fs.writeFileSync(p.join(out,'成片.mp4'),'renderer fixture');}
        else {const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
          fs.writeFileSync(p.join(out,'pids.json'),JSON.stringify([process.pid,c.pid]));
          setInterval(()=>console.log('EXPORT:'+JSON.stringify({step:'rendering',progress:0.2,state:'done'})),25);}`;
      const child = spawn(process.execPath, ['-e', script, args[2]], options);
      children.push(child);
      return child;
    });
    syncBuiltinESMExports();
    const { project, dir } = createGeneral({ styleId: 'free', settings: { aspect: '16:9', length: 15 }, inputs: { kind: 'topic', text: '测试', note: '' } }, '测试');
    const version = path.join(dir, 'versions', 'v1');
    fs.mkdirSync(path.join(version, 'work'), { recursive: true });
    fs.writeFileSync(path.join(version, 'layers.json'), JSON.stringify({ engine: 'hyperframes' }));
    project.versions = [{ n: 1, layersUrl: 'layers.json' }] as any;
    saveGeneral(dir, project);
    if(process.platform==='win32'){
      await assert.rejects(startExport(project.id,1,'mp4',{video:{codec:'h265'}}),/Windows HEVC/);
      assert.equal(children.length,0);assert.equal(exportRunning(project.id),false);
      assert.equal(fs.existsSync(path.join(dir,'exports','.active')),false);
      assert.equal(fs.existsSync(path.join(dir,'exports','.preferences.json')),false);
    }
    const task = await startExport(project.id, 1, 'mp4');
    const output = path.join(dir, 'exports', task.id);
    await until(() => fs.existsSync(path.join(output, 'pids.json')) && findGeneral(project.id).project.exportTask?.progress === 0.2);
    const pids: number[] = JSON.parse(fs.readFileSync(path.join(output, 'pids.json'), 'utf8'));
    assert.equal(findGeneral(project.id).project.exportTask?.state, 'running', 'worker cannot overwrite task state');
    if(process.platform==='win32'){
      // A separate scanner can retain a handle beyond the renderer's lifetime.
      // Exercise real Windows sharing violations longer than the old 545 ms retry.
      const held=path.join(output,'transient-scan.tmp'),ready=path.join(root,'scanner-ready');
      fs.writeFileSync(held,'synthetic scanner fixture');
      const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
      const command=`$qaStream=[IO.File]::Open(${quote(held)},'Open','Read','None');try{[IO.File]::WriteAllText(${quote(ready)},'ready');Start-Sleep -Milliseconds 1800}finally{$qaStream.Dispose()}`;
      const holder=spawn(path.join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,stdio:'ignore'});
      children.push(holder);
      await until(()=>fs.existsSync(ready));
    }
    const firstCancel = cancelExport(project.id, task.id);
    const secondCancel = cancelExport(project.id, task.id);
    assert.equal((await startExport(project.id, 1, 'mp4')).id, task.id, 'cleanup retains the project lock');
    children[0].stdout?.emit('data', Buffer.from('EXPORT:{"step":"late","progress":1}\n'));
    for (const cancelled of await Promise.all([firstCancel, secondCancel])) assert.equal(cancelled.state, 'cancelled');
    await until(() => pids.every(pid => !alive(pid)));
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.existsSync(path.join(dir, 'exports', '.active')), false);
    assert.equal(exportRunning(project.id), false);
    assert.equal((await cancelExport(project.id, task.id)).state, 'cancelled');
    fs.writeFileSync(path.join(version, 'work', 'finish'), 'retry');
    const retry = await startExport(project.id, 1, 'mp4');
    assert.notEqual(retry.id, task.id);
    await assert.rejects(cancelExport(project.id, task.id), /任务已变化/);
    children[0].stdout?.emit('data', Buffer.from('EXPORT:{"step":"old task","progress":1}\n'));
    await until(() => findGeneral(project.id).project.exportTask?.state === 'done');
    const done = findGeneral(project.id).project.exportTask!;
    assert.equal(done.id, retry.id);
    assert.match(done.downloadUrl!, new RegExp(retry.id));
    assert.equal((await cancelExport(project.id, retry.id)).state, 'done');
    assert.equal(fs.readFileSync(path.join(version, 'work', 'finish'), 'utf8'), 'retry');
  } finally {
    for (const child of children) if (child.pid && alive(child.pid)) platform.killTree(child.pid, 'SIGKILL');
    mock.restoreAll(); syncBuiltinESMExports();
    names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; });
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
