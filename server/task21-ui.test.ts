import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

const root = fileURLToPath(new URL('../', import.meta.url));
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
async function mount(source: string, mocks: Record<string, string> = {}, state: Record<string, unknown> = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task21-ui-'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
  const dom = new JSDOM('<div id="root"></div>', {url: 'http://localhost/', pretendToBeVisual: true});
  const prior = new Map<string, PropertyDescriptor | undefined>();
  const noop = () => {};
  dom.window.matchMedia = (() => ({matches: true, addEventListener: noop, removeEventListener: noop})) as any;
  dom.window.scrollTo = noop;
  dom.window.HTMLElement.prototype.scrollTo = noop;
  dom.window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  dom.window.HTMLMediaElement.prototype.pause = noop;
  dom.window.HTMLMediaElement.prototype.load = noop;
  Object.defineProperty(dom.window.document, 'hasFocus', {value: () => true, configurable: true});
  const setGlobal = (key: string, value: unknown) => {prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});};
  const observer = class { observe() {} unobserve() {} disconnect() {} };
  for (const [key, value] of Object.entries({window: dom.window, Event: dom.window.Event, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Image: dom.window.Image, ResizeObserver: observer, IntersectionObserver: observer, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), matchMedia: dom.window.matchMedia, IS_REACT_ACT_ENVIRONMENT: true, __task21: state})) setGlobal(key, value);
  let app: any, harness: any;
  try {
    const outfile = path.join(temp, 'harness.mjs');
    await build({stdin: {contents: `import React,{act} from 'react';import {createRoot} from 'react-dom/client';export {act,createRoot};${source};export const rerenderElement=()=>React.cloneElement(element);`, resolveDir: root, loader: 'tsx'}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', define: {'import.meta.env.DEV': 'false'}, loader: {'.css': 'empty'}, logLevel: 'silent', plugins: [{name: 'isolated-fixtures', setup(plugin) {
      plugin.onResolve({filter: /.*/}, args => mocks[args.path] === undefined ? undefined : ({path: args.path, namespace: 'task21'}));
      plugin.onLoad({filter: /.*/, namespace: 'task21'}, args => ({contents: mocks[args.path], loader: 'tsx', resolveDir: root}));
    }}]});
    harness = await import(pathToFileURL(outfile).href);
    app = harness.createRoot(document.getElementById('root'));
    await harness.act(async () => {app.render(harness.element); await tick();});
    await harness.act(tick);
  } catch (error) {
    if (app && harness) await harness.act(async () => app.unmount());
    dom.window.close();
    for (const [key, value] of prior) {if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as any)[key];}
    fs.rmSync(temp, {recursive: true, force: true}); throw error;
  }
  return {dom, state, harness, async rerender() {await harness.act(async()=>{app.render(harness.rerenderElement());await tick();});}, async act(fn: () => unknown) {await harness.act(async () => {await fn(); await tick();});}, async close() {
    await harness.act(async () => app.unmount()); dom.window.close();
    for (const [key, value] of prior) {if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as any)[key];}
    fs.rmSync(temp, {recursive: true, force: true});
  }};
}

test('P14：真实入口封面支持 Enter/空格，悬停播放、离开恢复静帧，减少动态时不播放', async () => {
  const state = {picks: [] as unknown[][]};
  const h = await mount(`import {GeneralEntrance} from './src/general/GeneralEntrance';export const element=<GeneralEntrance entry="topic" cat={0} onEntry={()=>{}} onCat={()=>{}} onPick={(...args)=>globalThis.__task21.picks.push(args)} onAll={()=>{}}/>;`, {}, state);
  try {
    const card = document.querySelector<HTMLElement>('.ge-en-pc[tabindex="0"]'); assert.ok(card);
    for (const key of ['Enter', ' ']) await h.act(() => card.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})));
    assert.equal(state.picks.length, 2); assert.equal(state.picks[0][0], state.picks[1][0]);
    await h.act(() => card.dispatchEvent(new h.dom.window.MouseEvent('mouseover', {bubbles: true})));
    assert.equal(card.querySelector('video'), null, '减少动态时只显示封面');
    h.dom.window.matchMedia = (() => ({matches: false, addEventListener() {}, removeEventListener() {}})) as any;
    await h.act(() => card.dispatchEvent(new h.dom.window.MouseEvent('mouseout', {bubbles: true})));
    await h.act(() => card.dispatchEvent(new h.dom.window.MouseEvent('mouseover', {bubbles: true})));
    assert.ok(card.querySelector('video[autoplay][loop]')); assert.ok(card.querySelector('img'));
    await h.act(() => card.dispatchEvent(new h.dom.window.MouseEvent('mouseout', {bubbles: true})));
    assert.equal(card.querySelector('video'), null); assert.ok(card.querySelector('img'));
  } finally {await h.close();}
});

test('P13：失败且没有方案显示工程保留，已有方案仍显示段数', async () => {
  for (const hasPlan of [false, true]) {
    const h = await mount(`import {GeneralStage} from './src/general/GeneralStage';export const element=<GeneralStage project={{id:'p',name:'保留工程',settings:{aspect:'16:9'},inputs:{media:[]},versions:[],run:{state:'failed',steps:[]},plan:${hasPlan ? "{segments:[{id:'s',start:0,end:5,name:'方案'}]}" : 'undefined'}}} onPickVersion={()=>{}} onReference={()=>{}} onSegment={()=>{}}/>;`);
    try {
      const label = document.querySelector('.ge-bar')?.textContent || '';
      assert.match(label, hasPlan ? /方案 · 1 段/ : /本次生成未完成，工程已保留/);
    } finally {await h.close();}
  }
});

test('S03：离开工程后完成、失败、联网提醒持续工作，短暂读取失败不丢监听', async () => {
  const state = {run: 'running', fail: false, path: '/general/projects/p', notices: [] as string[]};
  const h = await mount(`import {GeneralRunWatcher} from './src/general/GeneralRunWatcher';export const element=<GeneralRunWatcher/>;`, {
    'react-router': "export const useNavigate=()=>()=>{};export const useLocation=()=>({pathname:globalThis.__task21.path});",
    './general-api': "export const generalApi={list:async()=>{if(globalThis.__task21.fail)throw Error('临时断开');return [{id:'p',name:'通知测试',versions:1,runState:globalThis.__task21.run}]}};",
    sonner: "export const toast=(title)=>globalThis.__task21.notices.push(title);",
  }, state);
  try {
    // 模拟路由离开，但 watcher 不卸载。
    state.path = '/'; await h.rerender();
    let retry = false;
    const timeout = h.dom.window.setTimeout.bind(h.dom.window);
    h.dom.window.setTimeout = ((fn: any, delay: any, ...args: any[]) => {if (delay === 6000) retry = true; return timeout(fn, delay, ...args);}) as any;
    state.fail = true; await h.act(() => window.dispatchEvent(new h.dom.window.Event('general-runs-changed'))); assert.equal(retry, true);
    state.fail = false;
    for (const next of ['done', 'failed', 'needs-network']) {
      state.run = 'running'; await h.act(() => window.dispatchEvent(new h.dom.window.Event('general-runs-changed')));
      state.run = next; await h.act(() => window.dispatchEvent(new h.dom.window.Event('general-runs-changed')));
    }
    assert.equal(state.notices.length, 3); assert.match(state.notices[0], /做好了/); assert.match(state.notices[1], /没做完/); assert.equal(state.notices[2], 'Codex 想联网');
  } finally {await h.close();}
});

test('S04：路由渲染出错保留导航与当前工程重载入口', async () => {
  const previous = console.error; console.error = () => {};
  let h: Awaited<ReturnType<typeof mount>> | undefined;
  try {
    h = await mount(`import {RouteLoadBoundary} from './src/workspace/RouteLoadBoundary';function Broken(){throw Error('Loading chunk failed')}export const element=<><nav>导航仍在</nav><RouteLoadBoundary><Broken/></RouteLoadBoundary></>;`);
    assert.equal(document.querySelector('nav')?.textContent, '导航仍在');
    assert.match(document.querySelector('[role=alert]')?.textContent || '', /重新载入当前工程/);
    assert.equal(document.querySelector('button')?.textContent, '重新载入当前工程');
  } finally {if (h) await h.close(); console.error = previous;}
});

test('P12：主页与剪辑台读取失败都显示错误，不伪装空工程', async () => {
  for (const component of ['WorkspaceHome', 'StudioProjects']) {
    const h = await mount(`import View from './src/pages/${component}';export const element=<View/>;`, {
      'react-router': "export const useLocation=()=>({pathname:'/studio'});export const useNavigate=()=>()=>{};export const useSearchParams=()=>[new URLSearchParams(),()=>{}];export const Link=({children,...props})=><a {...props}>{children}</a>;",
      '@/studio/api': "export const listProjects=async()=>[];export const mediaUrl=()=>'';export const createProject=async()=>{};export const deleteProject=async()=>{};export const duplicateProject=async()=>{};export const patchProject=async()=>{};export const restoreProject=async()=>{};",
      '@/general/general-api': "export const generalApi={list:async()=>{throw Error('工程库读取失败')}};",
      '@/general/GeneralLibraryCards': "export const GeneralStudioCard=()=>null;export const GeneralHomeCard=()=>null;",
      '@/studio/components/ProjectStorage': "export const ProjectStorage=()=>null;",
      '@/studio/components/PurgeProjectButton': "export const PurgeProjectButton=()=>null;",
      '@/workspace/QuickEdit': "export const QuickEdit=()=>null;",
      '@/workspace/QuickEditLive': "export const QuickEditLive=()=>null;",
      '@/desktop/LoginBackdrop': "export const LoginBackdrop=()=>null;",
      '@/onboarding/DeployWizard': "export const DeployStrip=()=>null;",
    });
    try {assert.match(document.querySelector('[role=alert]')?.textContent || '', /工程暂时无法读取：工程库读取失败/);}
    finally {await h.close();}
  }
});

test('S02：共用完整时间线有首尾交替/Alt定位/轨道锁/框选区域/缩放快捷键与媒体条', async () => {
  const state = {seek: [] as number[], toggles: [] as unknown[][], zoom: [] as number[], selections: [] as string[][]};
  const h = await mount(`import {TimelineEditor} from './src/studio/components/TimelineEditor';
const clip={id:'clip',trackId:'video',name:'测试素材',start:1,duration:3,sourceStart:0,assetId:'asset',params:{}};
const track={id:'video',name:'视频轨',kind:'video',order:0,clips:[clip],volume:1};
const timeline={fps:30,duration:6,tracks:[track]};
function View(){const [time,setTime]=React.useState(0);const [selected,setSelected]=React.useState([]);return <TimelineEditor project={{id:'p',transcript:[],timeline,media:[{id:'asset',type:'video',duration:6,thumbnailFile:'poster.jpg',filmstripFile:'strip.jpg',status:'ready'}]}} timeline={timeline} zoom={1} onZoomChange={v=>globalThis.__task21.zoom.push(v)} playhead={time} selectedClipIds={selected} snappingEnabled onSnappingChange={()=>{}} mainTrackLinked={false} onMainTrackLinkedChange={()=>{}} onMarkCutEdge={()=>{}} onCutBoundaryChange={()=>{}} onRestoreCut={()=>{}} onCancelCut={()=>{}} onPreviewCut={()=>{}} cutBusy={false} onSmartMusic={()=>{}} onSmartRoughcut={()=>{}} onGlobalMotion={()=>{}} onGlobalSfx={()=>{}} onSmartBroll={()=>{}} onAutoPlace={()=>{}} suppressTimelineClickRef={{current:false}} timelinePlayheadRef={{current:null}} onUndo={()=>{}} onRedo={()=>{}} onSplit={()=>{}} onInsertDirectorGap={()=>{}} onEditDirectorSlot={()=>{}} onOpenDirectorSlot={()=>{}} onDelete={()=>{}} focusTimeline={false} onToggleFocus={()=>{}} onTrackVolume={()=>{}} onToggleTrack={(...args)=>globalThis.__task21.toggles.push(args)} onSeek={t=>{setTime(t);globalThis.__task21.seek.push(t)}} onSelectClip={id=>setSelected([id])} onSelectClips={ids=>{setSelected(ids);globalThis.__task21.selections.push(ids)}} onClearSelection={()=>setSelected([])} onBeginClipDrag={()=>{}} onBeginClipDurationResize={()=>{}} onOpenClipMenu={()=>{}} onEditOverlay={()=>{}} onOpenDirectorScene={()=>{}} onDropMedia={()=>{}} generalTools={<span>通用剪辑</span>}/>};export const element=<View/>;`, {}, state);
  try {
    const clip = document.querySelector<HTMLButtonElement>('[data-timeline-clip-id="clip"]'); assert.ok(clip);
    await h.act(() => clip.click()); await h.act(() => clip.click()); await h.act(() => clip.click());
    assert.deepEqual(state.seek.slice(0, 3), [1, 119 / 30, 1]);
    Object.defineProperty(clip, 'getBoundingClientRect', {value: () => ({left: 42, top: 40, right: 168, bottom: 70, width: 126, height: 30})});
    await h.act(() => clip.dispatchEvent(new h.dom.window.MouseEvent('click', {bubbles: true, altKey: true, clientX: 105})));
    assert.ok(Math.abs(state.seek.at(-1)! - 2.5) < 0.04);
    const lock = [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label')?.includes('锁定视频轨')); assert.ok(lock);
    await h.act(() => lock.click()); assert.deepEqual(state.toggles.at(-1), ['video', 'locked']);
    const slider = document.querySelector<HTMLInputElement>('input[aria-label="时间线缩放"]'); assert.ok(slider);
    await h.act(() => slider.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', {key: '+', ctrlKey: true, bubbles: true, cancelable: true})));
    assert.ok(state.zoom.at(-1)! > 1);
    assert.ok(document.querySelector('.timeline-video-frames')?.getAttribute('style')?.includes('filmstrip'));
    const content = document.querySelector<HTMLElement>('.timeline-content'); assert.ok(content);
    await h.act(() => content.dispatchEvent(new h.dom.window.MouseEvent('pointerdown', {bubbles: true, button: 0, clientX: 0, clientY: 30})));
    await h.act(() => window.dispatchEvent(new h.dom.window.MouseEvent('pointermove', {bubbles: true, clientX: 200, clientY: 90})));
    assert.ok(document.querySelector('.timeline-selection-marquee')); assert.deepEqual(state.selections.at(-1), ['clip']);
    await h.act(() => window.dispatchEvent(new h.dom.window.MouseEvent('pointerup', {bubbles: true, clientX: 200, clientY: 90})));
    assert.equal(document.querySelector('.timeline-selection-marquee'), null);
    assert.equal(document.querySelector('[aria-label="智能粗剪"]'), null);
  } finally {await h.close();}
});
