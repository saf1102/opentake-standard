import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { prepareSavedScreenExport } from '../shared/openscreen-export-request.ts';

test('P08：只读、未修改与撤销回原样只读保存版本，不请求保存或接管', async () => {
  for (const flags of [{ writable: false, dirty: true, unchanged: false }, { writable: true, dirty: false, unchanged: false }, { writable: true, dirty: true, unchanged: true }]) {
    const calls: string[] = [];
    const result = await prepareSavedScreenExport({ ...flags, persist: async () => { calls.push('save'); return 1; }, readSaved: async () => { calls.push('read'); return 42; } });
    assert.deepEqual(calls, ['read']);
    assert.equal(result.saved, 42);
    assert.equal(result.readOnly, !flags.writable);
  }
});

test('P08：脏文档先保存，423 转只读；其他保存错误不冒充成功', async () => {
  const flags = { writable: true, dirty: true, unchanged: false };
  const calls: string[] = [];
  const readSaved = async () => { calls.push('read'); return 8; };
  assert.deepEqual(await prepareSavedScreenExport({ ...flags, persist: async () => 9, readSaved }), { saved: 9, readOnly: false });
  assert.deepEqual(calls, []);
  assert.deepEqual(await prepareSavedScreenExport({ ...flags, persist: async () => { throw Object.assign(Error('锁被另一窗口持有'), { status: 423 }); }, readSaved }), { saved: 8, readOnly: true });
  for (const status of [409, 500]) await assert.rejects(prepareSavedScreenExport({ ...flags, persist: async () => { throw Object.assign(Error('保存失败'), { status }); }, readSaved }), /保存失败/);
  assert.deepEqual(calls, ['read']);
});

test('P07/P08：录屏实际挂载共用弹窗，选择编码帧率目录，显示保存版说明与导出记录', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-export-ui-'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  dom.window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as any;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const previousFetch = globalThis.fetch;
  let submitted: any;
  const requests: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input), method = init?.method || 'GET';
    requests.push({ url, method });
    if (url.endsWith('/capabilities')) return Response.json({ ok: true, result: { defaultDestination: '/tmp/exports', jianying: { available: false } } });
    if (url.endsWith('/preferences')) return Response.json({ ok: true, result: null });
    if (url.endsWith('/history?kind=screen')) return Response.json({ ok: true, result: [{ id: 'history-1', documentId: 'doc', status: 'completed', createdAt: 1, outputFile: '/tmp/exports/已有成片.mp4' }] });
    if (url.endsWith('/destination')) return Response.json({ ok: true, result: { path: '/tmp/选择的目录' } });
    if (url.endsWith('/documents/doc/exports') && method === 'POST') {
      submitted = JSON.parse(init.body);
      return Response.json({ ok: true, result: { id: 'new', documentId: 'doc', status: 'completed', progress: 100, outputFile: '/tmp/选择的目录/test.mov', createdAt: 1, updatedAt: 2, exportSettings: submitted.settings } });
    }
    throw Error('意外请求：' + url);
  }) as typeof fetch;
  let app: any, harness: any;
  try {
    const outfile = path.join(tmp, 'harness.mjs');
    await build({ stdin: { contents: `import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {ScreenExportDialog} from './src/screen-motion/ScreenExportDialog';export {act,createRoot};export const element=<ScreenExportDialog id="project" name="隔离录屏" clientId="reader" input={{documentId:'doc',revision:7,useSavedDocument:true,canvas:{width:1280,height:720,fps:30},notice:'另一个窗口正在编辑，导出的是上次保存的版本'}} onClose={()=>{}}/>;`, resolveDir: root, loader: 'tsx' }, outfile, jsx: 'automatic', define: { 'import.meta.env.DEV': 'false' }, loader: { '.css': 'empty' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
    harness = await import(pathToFileURL(outfile).href);
    app = harness.createRoot(document.getElementById('root'));
    await harness.act(async () => { app.render(harness.element); await new Promise(resolve => setTimeout(resolve, 30)); });
    await harness.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const text = () => document.body.textContent || '';
    assert.match(text(), /另一个窗口正在编辑，导出的是上次保存的版本/);
    assert.match(text(), /画质/); assert.match(text(), /H.264/); assert.match(text(), /HEVC/); assert.match(text(), /ProRes/);
    const click = async (label: string) => {
      const button = [...document.querySelectorAll('button')].find(node => (node.querySelector('b')?.textContent || node.textContent)?.trim() === label);
      assert.ok(button, '缺按钮 ' + label);
      await harness.act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    };
    await click('ProRes 422');
    await click('24');
    await click('选择');
    await click('导出记录');
    assert.match(text(), /已有成片.mp4/);
    await click('导出成片');
    assert.equal(submitted.clientId, 'reader'); assert.equal(submitted.useSavedDocument, true); assert.equal(submitted.documentRevision, 7);
    assert.equal(submitted.settings.video.codec, 'prores422'); assert.equal(submitted.settings.fps, 24); assert.equal(submitted.settings.destinationDir, '/tmp/选择的目录');
    assert.equal(requests.some(item => /lock|takeover/.test(item.url)), false);
  } finally {
    if (app && harness) await harness.act(async () => app.unmount());
    globalThis.fetch = previousFetch;
    dom.window.close();
    for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as any)[key]; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('P08：Mac 录屏窗口独立身份与锁，接管必须点击；Windows 保留原锁路径', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-window-lock-'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
  const outfile = path.join(tmp, 'harness.mjs');
  await build({ stdin: { contents: `import React,{act} from 'react';import {createRoot} from 'react-dom/client';import Workspace from './src/pages/OpenScreenWorkspace';export {act,createRoot};export const element=<Workspace/>;`, resolveDir: root, loader: 'tsx' }, outfile, jsx: 'automatic', loader: { '.css': 'empty' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent', plugins: [{ name: 'isolate-host-services', setup(plugin) {
    plugin.onResolve({ filter: /^(react-router|@\/workspace\/navigation-guard|@\/studio\/api|.*\.css\?inline)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'react-router' ? "export const useParams=()=>({id:'screen-fixture'});" : args.path.includes('navigation-guard') ? "export const useWorkspaceLeaveGuard=()=>{};export const WorkspaceLink=({children})=>children;" : args.path.endsWith('?inline') ? 'export default "";' : `export const getProject=async()=>({id:'screen-fixture',name:'锁测试',settings:{fps:30}});export const acquireLock=async(...args)=>{globalThis.__task20OldLock.push(args);return {acquired:false,lock:{clientName:'旧编辑器'}}};export const archiveLegacyScreenMotion=async()=>{};export const cancelOpenScreenHostSession=async()=>{},confirmOpenScreenHostCandidate=async()=>{},getOpenScreenHostSession=async()=>{},launchOpenScreenHost=async()=>{};` }));
  } }] });
  const harness = await import(pathToFileURL(outfile).href);
  const ids: string[] = [];
  try {
    for (const platform of ['MacIntel', 'MacIntel', 'Win32']) {
      const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
      Object.defineProperty(dom.window.navigator, 'platform', { value: platform });
      dom.window.localStorage.setItem('link-reader-editor-client', 'shared-koubo-client');
      const previous = new Map<string, PropertyDescriptor | undefined>();
      const calls: Array<{ clientId: string; takeover: boolean }> = [];
      const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, __task20OldLock: [] as unknown[], fetch: async (input: unknown, init?: RequestInit) => {
        assert.equal(String(input), '/api/editor/projects/screen-fixture/openscreen/lock');
        assert.equal(init?.method, 'POST');
        const body = JSON.parse(String(init?.body)); calls.push(body);
        return Response.json({ ok: true, result: { acquired: body.takeover, lock: { clientName: '另一个录屏窗口' } } });
      } };
      for (const [key, value] of Object.entries(globals)) { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
      const app = harness.createRoot(document.getElementById('root'));
      try {
        await harness.act(async () => { app.render(harness.element); await new Promise(resolve => setTimeout(resolve, 20)); });
        await harness.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        assert.ok(document.querySelector('iframe')?.src.includes('linkreaderWritable=0'));
        if (platform === 'MacIntel') {
          assert.equal(globals.__task20OldLock.length, 0);
          assert.equal(calls.length, 1); assert.equal(calls[0].takeover, false);
          assert.notEqual(calls[0].clientId, 'shared-koubo-client'); ids.push(calls[0].clientId);
          assert.equal(dom.window.sessionStorage.getItem('opentake-screen-editor-client'), calls[0].clientId);
          const takeover = [...document.querySelectorAll('button')].find(button => button.textContent === '接管编辑'); assert.ok(takeover);
          await harness.act(async () => { takeover.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
          assert.equal(calls.length, 2); assert.equal(calls[1].takeover, true); assert.equal(calls[1].clientId, calls[0].clientId);
          assert.ok(document.querySelector('iframe')?.src.includes('linkreaderWritable=1'));
          assert.equal(dom.window.localStorage.getItem('link-reader-editor-client'), 'shared-koubo-client');
        } else {
          assert.equal(calls.length, 0);
          assert.deepEqual(globals.__task20OldLock, [['screen-fixture', 'shared-koubo-client', false]]);
          assert.equal(dom.window.sessionStorage.getItem('opentake-screen-editor-client'), null);
        }
      } finally {
        await harness.act(async () => app.unmount()); dom.window.close();
        for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as any)[key]; }
      }
    }
    assert.notEqual(ids[0], ids[1], '独立窗口不能共用口播或其他录屏窗口身份');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
