import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGeneral, findGeneral, patchGeneral, purgeGeneral, restoreGeneral, scanGeneral, summarize, trashGeneral, updateGeneral, GENERAL_FILE } from './general/store.ts';
import { contentDisposition, parseRange, resolveProjectFile, serveProjectFile } from './general/files.ts';


function withRoot(run: (root: string) => Promise<void> | void) {
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'general-store-'));
    const previous = process.env.LINK_READER_PROJECTS_DIR;
    process.env.LINK_READER_PROJECTS_DIR = root;
    try { await run(root); }
    finally { if (previous === undefined) delete process.env.LINK_READER_PROJECTS_DIR; else process.env.LINK_READER_PROJECTS_DIR = previous; fs.rmSync(root, { recursive: true, force: true }); }
  };
}

test('general projects live in their own folders and spoken-project code never sees or rewrites them', withRoot(root => {
  const spoken = {name:'untouched-project',id:'fixture'};
  const spokenDir = path.join(root, spoken.name);
  fs.mkdirSync(spokenDir);
  fs.writeFileSync(path.join(spokenDir,'project.json'),JSON.stringify(spoken));
  const { dir, project } = createGeneral({ styleId: 'dark-keynote', settings: { aspect: '9:16', length: 15 }, inputs: { kind: 'topic', text: '一段文案' } }, '暗色科技发布');
  assert.equal(path.dirname(dir), root);
  for (const sub of ['media', 'versions', 'review', 'work', 'agent']) assert.ok(fs.statSync(path.join(dir, sub)).isDirectory());
  assert.equal(fs.existsSync(path.join(dir, 'project.json')), false);
  assert.deepEqual(project.settings, { aspect: '9:16', length: 15 });
  assert.equal(project.kind, 'general');
  const bytes = fs.readFileSync(path.join(dir, GENERAL_FILE), 'utf8');
  // the 0.2.40 release reads only project.json: its scan lists the spoken project and leaves this folder alone
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(spokenDir,'project.json'),'utf8')),spoken);
  assert.equal(fs.readFileSync(path.join(dir, GENERAL_FILE), 'utf8'), bytes);
  assert.equal(fs.existsSync(path.join(dir, 'project.json')), false);
  assert.deepEqual(scanGeneral().map(x => x.project.id), [project.id]);
  assert.equal(findGeneral(project.id).dir, dir);
}));

test('patch, summary, trash, restore and purge follow the spoken-project rules', withRoot(async root => {
  const { dir, project } = createGeneral({ styleId: 'city-symphony', inputs: { kind: 'footage' } }, '延时交响');
  assert.deepEqual(project.settings, { aspect: '16:9', length: 'auto' });
  let renamed = false;
  const patched = patchGeneral(project.id, { name: '  新名字  ', settings: { length: 30 }, inputs: { note: '要快' } }, () => { renamed = true; });
  assert.equal(patched.name, '新名字');
  assert.ok(renamed);
  assert.deepEqual(patched.settings, { aspect: '16:9', length: 30 });
  assert.equal(patched.inputs.note, '要快');
  assert.ok(patched.updatedAt >= project.updatedAt);
  assert.throws(() => patchGeneral(project.id, { settings: { aspect: '4:3' } }), /画幅/);
  assert.throws(() => patchGeneral(project.id, { name: '' }), /1–80/);
  // the project's own model and effort (null: back to 系统默认) and its 联网 switch
  assert.equal(project.agent, undefined); assert.equal(project.network, undefined);
  const chosen = patchGeneral(project.id, { agent: { model: 'gpt-6-sol', effort: 'medium' }, network: true });
  assert.deepEqual(chosen.agent, { model: 'gpt-6-sol', effort: 'medium' }); assert.equal(chosen.network, true);
  const standard = patchGeneral(project.id, { agent: null, network: false });
  assert.equal(standard.agent, undefined); assert.equal(standard.network, false);
  assert.throws(() => patchGeneral(project.id, { agent: { model: 'gpt-6-sol', effort: 'huge' } }), /推理强度/);
  assert.throws(() => patchGeneral(project.id, { network: 'yes' }), /联网/);
  updateGeneral(project.id, p => { p.versions.push({ n: 1, createdAt: p.createdAt, duration: 12.5, videoUrl: '/v1.mp4', posterUrl: '/v1.jpg', segments: [] }); p.current = 1; });
  const summary = summarize(findGeneral(project.id).project);
  assert.deepEqual({ duration: summary.duration, posterUrl: summary.posterUrl, versions: summary.versions, kind: summary.kind }, { duration: 12.5, posterUrl: '/v1.jpg', versions: 1, kind: 'general' });

  const trashed = trashGeneral(project.id);
  assert.equal(path.dirname(trashed), path.join(root, '.Trash'));
  assert.equal(fs.existsSync(dir), false);
  assert.ok(JSON.parse(fs.readFileSync(path.join(trashed, GENERAL_FILE), 'utf8')).deletedAt);
  assert.deepEqual(scanGeneral(), []);
  assert.equal(scanGeneral(true).length, 1);
  assert.throws(() => findGeneral(project.id), /不存在/);
  const restored = restoreGeneral(project.id);
  assert.equal(restored.name, '新名字');
  assert.equal(findGeneral(project.id).dir, dir);
  assert.equal('deletedAt' in findGeneral(project.id).project, false);
  await assert.rejects(purgeGeneral(project.id), /只能彻底删除回收站中的工程/);
  trashGeneral(project.id);
  await purgeGeneral(project.id);
  assert.equal(scanGeneral(true).length, 0);
}));

test('files: only the served folders, no escaping, single byte ranges', withRoot(async () => {
  const { dir, project } = createGeneral({ styleId: 'dark-keynote', inputs: { kind: 'topic', text: 'x' } }, '暗色科技发布');
  const video = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
  fs.writeFileSync(path.join(dir, 'versions', 'v1.mp4'), video);
  fs.writeFileSync(path.join(dir, 'agent', 'session.json'), '{}');
  fs.mkdirSync(path.join(dir, 'work', '.opentake', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'work', '.opentake', 'bin', 'node.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'work', 'TREATMENT.md'), '# 方案');
  fs.writeFileSync(path.join(dir, 'work', 'mix.py'), 'print(1)');
  assert.ok(resolveProjectFile(dir, 'versions/v1.mp4'));
  assert.ok(resolveProjectFile(dir, 'work/TREATMENT.md'));
  for (const bad of ['agent/session.json', GENERAL_FILE, 'versions/../agent/session.json', '../x', 'work/mix.py', 'work/.opentake/bin/node.jpg', 'versions/%2e%2e/agent/session.json'])
    assert.equal(resolveProjectFile(dir, bad), undefined, bad);
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), null);
  assert.equal(parseRange(undefined, 1000), undefined);
  assert.match(contentDisposition('新名字 第1版.mp4'), /^attachment; filename="___ _1_\.mp4"; filename\*=UTF-8''%E6%96%B0/);

  const server = http.createServer((req, res) => serveProjectFile(req, res, dir, decodeURIComponent(req.url!.slice(1).split('?')[0]), `${project.name} 第1版.mp4`));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const part = await fetch(`${base}/versions/v1.mp4`, { headers: { Range: 'bytes=10-19' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
    assert.equal(part.headers.get('accept-ranges'), 'bytes');
    assert.match(part.headers.get('content-disposition')!, /filename\*=UTF-8''/);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), video.subarray(10, 20));
    const whole = await fetch(`${base}/versions/v1.mp4`);
    assert.equal(whole.status, 200);
    assert.equal((await whole.arrayBuffer()).byteLength, 1000);
    assert.equal((await fetch(`${base}/versions/v1.mp4`, { headers: { Range: 'bytes=5000-' } })).status, 416);
    assert.equal((await fetch(`${base}/agent/session.json`)).status, 404);
  } finally { server.close(); }
}));

test('a new project keeps the model, effort and 联网 chosen on ② 放素材', withRoot(() => {
  const { project } = createGeneral({ styleId: 'free', inputs: { kind: 'topic' }, agent: { model: 'gpt-6-luna', effort: 'low' }, network: true }, '不用风格');
  assert.deepEqual(project.agent, { model: 'gpt-6-luna', effort: 'low' });
  assert.equal(project.network, true);
  assert.equal(createGeneral({ styleId: 'free', inputs: { kind: 'topic' } }, '不用风格').project.agent, undefined);
}));
