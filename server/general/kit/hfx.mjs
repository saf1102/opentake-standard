// hfx — OpenTake's tools for a HyperFrames film, usable inside the agent's sandbox (offline, nothing to install, no port).
//   hfx check        HyperFrames' own lint, plus OpenTake's rules: every visual change is its own clip, sound has a role
//   hfx look [n]     n frames (default 12), drawn exactly as OpenTake's export draws them, tiled into look/sheet.jpg
import {sampleBrowser, sampleResponse, sampleFontStatus} from './hfx-support.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { createRequire } from 'node:module'; import { execFileSync } from 'node:child_process';
const NM = process.env.CW_NODE_MODULES, BIN = process.env.LINKREADER_BIN_DIR, CHROME = process.env.CW_CHROME;
const root = process.env.CW_WORK || process.cwd(), [cmd, arg] = process.argv.slice(2);
const imp = p => import(pathToFileURL(path.join(NM, p)).href);
const say = (...l) => console.log(l.join('\n'));
const tool = name => path.join(BIN, name);
if (!fs.existsSync(path.join(root, 'index.html'))) { say('还没有 index.html（片子的根页面）'); process.exit(1); }
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

async function clips() {
  const { parseHTML } = await imp('linkedom/esm/index.js');
  const { topLevelElements, trackKindOf, isTimedElement } = await imp('@hyperframes/parsers/dist/index.js');
  const { document } = parseHTML(html);
  const node = el => ({ tag: el.tagName.toLowerCase(), attrs: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])), children: [...el.children].map(node) });
  const rootEl = document.querySelector('[data-composition-id]');
  if (!rootEl) { say('index.html 里没有根节点（data-composition-id）'); process.exit(1); }
  return { rootEl, list: topLevelElements(node(rootEl)).filter(isTimedElement).map(n => ({ id: n.attrs.id || n.attrs['data-hf-id'] || n.tag, kind: trackKindOf(n).kind, role: n.attrs['data-ot-role'] || '', start: +n.attrs['data-start'] || 0, dur: +n.attrs['data-duration'] || 0, sub: !!n.attrs['data-composition-src'] })) };
}

if (cmd === 'check') {
  const { lintProject } = await imp('@hyperframes/lint/dist/index.js');
  const r = await lintProject(root);
  const findings = (r.results || []).flatMap(x => (x.result?.findings || []).map(f => ({ ...f, file: x.file }))).filter(f => f.severity !== 'info');
  const { rootEl, list } = await clips();
  const total = +rootEl.getAttribute('data-duration') || Math.max(0, ...list.map(c => c.start + c.dur));
  const by = k => list.filter(c => c.kind === k);
  say(`时长 ${total} 秒；片段：视频 ${by('video').length}、画面 ${by('graphics').length}、字幕 ${by('captions').length}、声音 ${by('audio').length}`);
  for (const c of list) say(`  ${c.kind.padEnd(8)} ${c.start.toFixed(2).padStart(6)}–${(c.start + c.dur).toFixed(2).padStart(6)}  ${c.id}${c.role ? ` [${c.role}]` : ''}${c.sub ? ' (子页面)' : ''}`);
  const problems = findings.filter(f => f.severity === 'error').map(f => `${f.code}: ${f.message}${f.elementId ? ` (#${f.elementId})` : ''}${f.file ? ` [${f.file}]` : ''}`);
  // the person edits the film clip by clip in OpenTake: every visual change has to be its own graphics clip
  const graphics = by('graphics');
  if (graphics.length < Math.max(2, Math.floor(total / 5))) problems.push(`画面片段太少（${graphics.length} 个）：每一次画面变化（一组字、一张卡、一个色块编排、一个演示步骤）都要是根节点下单独的片段（data-start/data-duration，做成子页面），不要把整片动效写在一个元素或一条时间线里`);
  const long = graphics.filter(g => g.dur > Math.max(8, total * 0.5));
  if (long.length) problems.push(`这些画面片段太长，要按画面变化拆开：${long.map(g => `${g.id}（${g.dur.toFixed(1)} 秒）`).join('、')}`);
  for (const a of by('audio')) if (!/^(voice|music|sfx)$/.test(a.role)) problems.push(`声音片段 ${a.id} 要标 data-ot-role="voice|music|sfx"`);
  for (const f of findings.filter(f => f.severity === 'warning').slice(0, 12)) say(`提醒 ${f.code}: ${f.message}`);
  if (problems.length) { say('', '要改：', ...problems.map(p => `- ${p}`)); process.exit(1); }
  say('', '检查通过');
} else if (cmd === 'look') {
  const n = Math.max(1, Math.min(48, Number(arg) || 12));
  // no port inside the sandbox: HyperFrames' file server runs in-process (its handler is called directly)
  const { register } = await import('node:module'); register('./hf/hono-loader.mjs', import.meta.url);
  const { createFileServer } = await imp('@hyperframes/producer/dist/index.js');
  const { chromium } = createRequire(path.join(NM, 'x.js'))('playwright-core');
  await createFileServer({ projectDir: root, fps: 30, preHeadScripts: ['globalThis.__HF_RENDER_CAPTURE_MODE = true;'] });
  const shim = fs.readFileSync(new URL('../hf-render-shim.js', import.meta.url), 'utf8');
  const tmp = path.join(root, '.tmp', 'look'); fs.mkdirSync(tmp, { recursive: true });
  const videos = {};
  for (const m of html.matchAll(/<video\b[^>]*\bsrc="([^"]+)"/g)) {
    const page = decodeURIComponent(new URL(m[1], 'http://hf.localhost/').pathname), file = path.join(root, page);
    if (videos[page] || !fs.existsSync(file)) continue;
    const key = `v${Object.keys(videos).length}`, dir = path.join(tmp, key); fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, '0.jpg'))) execFileSync(tool('ffmpeg'), ['-v', 'error', '-i', file, '-an', '-fps_mode', 'passthrough', '-q:v', '4', '-vf', 'scale=960:-2', '-start_number', '0', path.join(dir, '%d.jpg')]);
    const pts = execFileSync(tool('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file], { maxBuffer: 64 << 20 }).toString().trim().split('\n').map(l => parseFloat(l)).filter(Number.isFinite);
    videos[page] = { key, count: fs.readdirSync(dir).length, pts: pts.map(x => Math.round((x - pts[0]) * 1e6) / 1e6) };
  }
  // Full Chrome needs macOS application services unavailable inside the offline
  // agent sandbox. Without an override Playwright selects its headless shell.
  const sampleChrome = sampleBrowser(process.env);
  const browser = await chromium.launch({ executablePath: sampleChrome, args: ['--single-process', '--no-zygote', '--font-render-hinting=none', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    let resourceFailure;
    const compressedAssets = new Map();
    await page.route('**/*', async route => {
      try {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/__ot_frames/')) return route.fulfill({ body: fs.readFileSync(path.join(tmp, url.pathname.slice(13))), contentType: 'image/jpeg' });
      if (url.origin !== 'http://hf.localhost') return route.abort();
      if (/\.(mp4|mov|m4v|webm|wav|mp3|m4a|aac|ogg)$/i.test(url.pathname)) return route.fulfill({ body: '', contentType: 'application/octet-stream' });
      const r = await globalThis.__hfFetch(new Request(url.href, { headers: route.request().headers() }));
      let body = Buffer.from(await r.arrayBuffer());
      if (url.pathname === '/' || url.pathname === '/index.html') body = Buffer.from(String(body).replace(/<\/body>/i, `<script>window.__otFps=30;window.__otVideos=${JSON.stringify(videos)}</script><script>${shim}</script></body>`));
      if (r.status >= 400) throw Error(`样张资源读取失败（${r.status}）：${url.pathname}`);
      const response = sampleResponse(body, Object.fromEntries(r.headers), url.href, compressedAssets);
      return await route.fulfill({ status: r.status, ...response });
      } catch(error) { resourceFailure = error; await route.abort().catch(() => {}); }

    });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://hf.localhost/index.html');
    if (resourceFailure) throw resourceFailure;
    await page.waitForFunction(() => window.__otRender, null, { timeout: 30000 });
    const comp = await page.evaluate(() => window.__otRender.select('main'));
    const fontAudit = [{frame: 0, fonts: await page.evaluate(sampleFontStatus)}];
    for (let i = 0; i < n; i++) {
      const frame = Math.min(comp.durationInFrames - 1, Math.round((i + 0.5) / n * comp.durationInFrames));
      await page.evaluate(f => window.__otRender.seek(f), frame);
      fontAudit.push({frame, fonts: await page.evaluate(sampleFontStatus)});
      await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 80 });
    }
    if (resourceFailure) throw resourceFailure;
    if (errors.length) throw Error('样张页面报错：'+errors.slice(0,5).join('；'));
    fs.mkdirSync(path.join(root, 'look'), { recursive: true });
    fs.writeFileSync(path.join(root, 'look', 'font-audit.json'), JSON.stringify(fontAudit, null, 2) + '\n');
    const cols = 4, rows = Math.ceil(n / cols);
    execFileSync(tool('ffmpeg'), ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, 'f%02d.jpg'), '-vf', `scale=480:-2,tile=${cols}x${rows}`, '-frames:v', '1', path.join(root, 'look', 'sheet.jpg')]);
    say(`接触表：look/sheet.jpg（${n} 帧，从左到右、从上到下，每 ${(comp.durationInFrames / 30 / n).toFixed(2)} 秒一帧）`, '用 view_image 打开看一遍。');
  } finally { await browser.close(); }
} else say('用法：hfx check | hfx look [帧数]');
