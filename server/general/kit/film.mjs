#!/usr/bin/env node
// OpenTake film kit: `film <command>` (the wrapper in .opentake/bin runs this file). Run it in the film folder.
// Commands are listed by `film help` and in MANUAL.md. Nothing here touches the network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { renderPage } from './lib/render-page.mjs';
import { MEDIA, WORK, iconsDir, libraryVersions, tool } from './lib/env.mjs';
import { listFonts, openPage, webglInfo } from './lib/browser.mjs';
import { ffmpeg, frames, probe, readFilm, round, run, shotAt, videoEncoder, writeProgress } from './lib/film.mjs';
import { checkLayered, composeSpec, finishPicture, mixTracks, textPresets } from './lib/compose.mjs';

const HELP = `film — OpenTake 出片工具（在工作目录里运行）
  film check                 检查 film.json、plan.json 和每个页面能否打开、能否画出 t=0
  film look [a-b] [--every s] 按 film.json 抽帧拼接触表 look/sheet.jpg（不渲染整片），并检查同一 t 是否画出同一画面
  film look <视频文件>        给一个视频文件（成片、素材）抽帧拼接触表
  film still <t> [t …]       整幅单帧 look/still_<t>.jpg
  film render [--workers 3]  按轨道合成、逐帧渲染（含转场、淡入淡出）→ out/video.mp4（无声），进度写进 progress.json
  film render-page <id>      单独渲染画面页 → out/pages/（叠加页带透明）
  film mux                   按轨道混音、混流 → out.mp4（H.264 + AAC，−14 LUFS）
  film poster [t]            从 out.mp4 取一帧 → poster.jpg
  film frames <素材> [--fps 30] [--out frames/名字]   素材拆成帧序列（按画幅裁切铺满）供页面使用
  film probe <素材>           素材的真实时长、分辨率、帧率
  film progress <步骤> [说明] [--thumb 图片 …]          更新 progress.json
  film need-network --reason "原因" --host 域名 [--host …]   请求联网，写完立刻结束这一轮
  film presets               本风格可用的文字样式（preset）和整片效果（finish）
  film libs | film fonts | film gl                  可用的离线库 / 字体 / WebGL 渲染器
  film icons 关键词…          按名字找品牌 logo 和图标（/_icons/…），中文品牌名也行`;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const opt = (name, fallback) => { const i = argv.indexOf(name); if (i < 0) return fallback; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const opts = name => { const out = []; for (let i = argv.indexOf(name); i >= 0; i = argv.indexOf(name)) { out.push(argv[i + 1]); argv.splice(i, 2); } return out; };
const rel = file => path.relative(WORK, file) || '.';
const say = (...lines) => console.log(lines.join('\n'));

// common Chinese names of brands and platforms → their names in the brand-logo library
const ICON_ALIASES = { '抖音': ['tiktok'], 'tiktok': ['tiktok'], '小红书': ['xiaohongshu'], '微信': ['wechat'], '哔哩哔哩': ['bilibili'], 'b站': ['bilibili'], 'b 站': ['bilibili'],
  '支付宝': ['alipay'], '淘宝': ['taobao'], '百度': ['baidu'], '知乎': ['zhihu'], '阿里巴巴': ['alibabadotcom', 'alibabacloud'], 'qq': ['qq'],
  '字节跳动': ['bytedance'], '华为': ['huawei'], '小米': ['xiaomi'], '苹果': ['apple'], '谷歌': ['google'], '微软': ['microsoft'], '特斯拉': ['tesla'], '网易云音乐': ['neteasecloudmusic'],
  '美团': ['meituan'], '油管': ['youtube'], '推特': ['x', 'twitter'] };
const commands = {
  help: async () => say(HELP),
  'render-page': async () => { const film = readFilm(); if (film.version !== 2 || !argv[0]) throw new Error('用法：film render-page <画面页 id>（分轨片）'); say(await renderPage(film, argv[0])); },

  check: async () => {
    const film = readFilm();
    if (film.version === 2) return checkV2(film);
    say(`film.json：${film.width}×${film.height}，${film.fps} fps，${film.duration} 秒，${film.shots.length} 个镜头`);
    for (const s of film.segments) say(`  ${s.start.toFixed(2)}–${s.end.toFixed(2)}  ${s.name}`);
    const plan = path.join(WORK, 'plan.json');
    if (fs.existsSync(plan)) { checkPlan(JSON.parse(fs.readFileSync(plan, 'utf8'))); say('plan.json：格式正确'); } else say('提醒：还没有 plan.json');
    for (const shot of film.shots.filter(s => s.page)) {
      const { browser, draw, errors } = await openPage(shot.page, { w: film.width, h: film.height });
      try { await draw(0); await draw(shot.dur / 2); say(`  ✓ ${shot.page}${errors.length ? `（${errors.length} 条提示：${errors.slice(-2).join('；')}）` : ''}`); }
      finally { await browser.close(); }
    }
    if (film.audio && !fs.existsSync(path.join(WORK, film.audio))) say(`提醒：film.json 的 audio「${film.audio}」还不存在`);
    say('检查通过');
  },

  look: async () => {
    const every = opt('--every');
    const target = argv[0];
    const dir = path.join(WORK, 'look');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/^(t_|sheet).*\.jpg$/.test(f)) fs.rmSync(path.join(dir, f));
    if (target && !/^[\d.]+(-[\d.]+)?$/.test(target)) return lookVideo(path.resolve(WORK, target), dir, every ? Number(every) : undefined);
    const film = readFilm();
    let [a, b] = target ? target.split('-').map(Number) : [0, film.duration];
    if (b === undefined) { b = a; }
    b = Math.min(b, film.duration - 1 / film.fps);
    const step = every ? Number(every) : Math.max(0.25, Math.round(((b - a) / 23) * 4) / 4);
    const times = [];
    for (let t = a; t <= b + 1e-9; t += step) times.push(round(t));
    const files = film.version === 2 ? await drawTimesV2(film, times, dir, 't_', { width: 960 }) : await drawTimes(film, times, dir, 't_', { width: 960 });
    const same = film.version === 2 ? await deterministicV2(film, times) : await deterministic(film, times);
    const sheet = await contactSheet(files, path.join(dir, 'sheet.jpg'), step, a);
    say(`接触表：${rel(sheet)}（${files.length} 帧，从左到右、从上到下，每 ${step} 秒一帧，从 ${a} 秒起）`, `单帧：${rel(dir)}/t_*.jpg`, same, '用 view_image 打开接触表看一遍，再逐条对照用户的要求。');
  },

  still: async () => {
    const film = readFilm();
    const times = argv.map(Number).filter(Number.isFinite);
    if (!times.length) throw new Error('用法：film still <秒> [秒 …]');
    const dir = path.join(WORK, 'look');
    const files = film.version === 2 ? await drawTimesV2(film, times, dir, 'still_', {}) : await drawTimes(film, times, dir, 'still_', {});
    say(...files.map(rel));
  },

  render: async () => {
    const film = readFilm();
    if (film.version === 2) return renderV2(film);
    const workers = Math.max(1, Math.min(6, Number(opt('--workers', String(Math.min(3, Math.max(1, Math.floor(os.cpus().length / 4))))))));
    const work = path.join(WORK, 'out', '.render');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const totalFrames = film.shots.reduce((n, s) => n + frames(s.dur, film.fps), 0);
    let done = 0, last = 0;
    const tick = n => { done += n; if (done - last >= 30 || done === totalFrames) { last = done; writeProgress({ step: 'render', detail: '逐帧渲染', progress: { done: round(done / film.fps), total: round(totalFrames / film.fps) } }); } };
    writeProgress({ step: 'render', detail: '逐帧渲染', progress: { done: 0, total: round(totalFrames / film.fps) } });
    const tasks = [];
    for (const shot of film.shots) {
      const n = frames(shot.dur, film.fps);
      if (shot.video) { tasks.push({ shot, a: 0, b: n, file: path.join(work, `s${shot.index}_0.mp4`) }); continue; }
      const chunk = Math.max(45, Math.ceil(totalFrames / workers));
      for (let a = 0, k = 0; a < n; a += chunk, k++) tasks.push({ shot, a, b: Math.min(n, a + chunk), file: path.join(work, `s${shot.index}_${k}.mp4`) });
    }
    const t0 = Date.now();
    let next = 0;
    await Promise.all([...Array(Math.min(workers, tasks.length))].map(async () => {
      while (next < tasks.length) { const task = tasks[next++]; await (task.shot.video ? renderFootage(film, task, tick) : renderChunk(film, task, tick)); }
    }));
    const shotFiles = [];
    for (const shot of film.shots) {
      const parts = tasks.filter(t => t.shot === shot).map(t => t.file);
      const file = path.join(work, `shot${shot.index}.mp4`);
      if (parts.length === 1) fs.renameSync(parts[0], file);
      else { fs.writeFileSync(path.join(work, `list${shot.index}.txt`), parts.map(p => `file '${path.basename(p)}'`).join('\n')); await ffmpeg(['-f', 'concat', '-safe', '0', '-i', `list${shot.index}.txt`, '-c', 'copy', path.basename(file)], { cwd: work }); }
      shotFiles.push(file);
    }
    const out = path.join(WORK, 'out', 'video.mp4');
    await joinShots(film, shotFiles, out);
    fs.rmSync(work, { recursive: true, force: true });
    writeProgress({ step: 'render', detail: '画面渲染完成', progress: { done: round(totalFrames / film.fps), total: round(totalFrames / film.fps) } });
    say(`完成：${rel(out)}，${totalFrames} 帧，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  },

  mux: async () => {
    const film = (() => { try { return readFilm(); } catch { return undefined; } })();
    const video = path.resolve(WORK, opt('--video', 'out/video.mp4'));
    let audioArg = opt('--audio', film?.audio);
    if (!audioArg && film?.version === 2) audioArg = await mixTracks(film, path.join(WORK, 'out', '.mix.wav')).then(f => f && path.relative(WORK, f));
    const out = path.resolve(WORK, opt('--out', 'out.mp4'));
    if (!fs.existsSync(video)) throw new Error(`没有 ${rel(video)}，先运行 film render`);
    const fps = film?.fps || 30;
    const info = await probe(video);
    const vdur = Number(info.format.duration);
    const audio = audioArg ? path.resolve(WORK, audioArg) : undefined;
    if (audio && !fs.existsSync(audio)) throw new Error(`找不到声音文件 ${audioArg}`);
    const tmp = `${out}.${process.pid}.tmp.mp4`;
    let chain = 'anullsrc=r=48000:cl=stereo', loud = '无声音轨';
    if (audio) {
      const measured = await measureLoudness(audio);
      chain = measured ? `[1:a]loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,aresample=48000,apad` : '[1:a]aresample=48000,apad';
      loud = measured ? `响度归一到 −14 LUFS（原 ${measured.input_i} LUFS）` : '声音几乎无声，没有做响度归一';
    }
    const args = ['-i', video, ...(audio ? ['-i', audio] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
      ...(audio ? ['-filter_complex', `${chain}[a]`, '-map', '0:v', '-map', '[a]'] : ['-map', '0:v', '-map', '1:a']),
      '-t', String(vdur), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', tmp];
    await ffmpeg(args);
    fs.renameSync(tmp, out);
    const after = audio ? await integrated(out) : undefined;
    say(`完成：${rel(out)}，${vdur.toFixed(2)} 秒，${loud}${after ? `，成片实测 ${after}` : ''}`);
  },

  poster: async () => {
    const src = path.join(WORK, 'out.mp4');
    if (!fs.existsSync(src)) throw new Error('没有 out.mp4，先运行 film mux');
    const dur = Number((await probe(src)).format.duration);
    const t = argv[0] !== undefined ? Number(argv[0]) : dur / 3;
    await ffmpeg(['-ss', String(Math.max(0, Math.min(dur - 0.05, t))), '-i', src, '-frames:v', '1', '-q:v', '2', path.join(WORK, 'poster.jpg')]);
    say(`完成：poster.jpg（${t.toFixed(2)} 秒）`);
  },

  frames: async () => {
    const src = argv[0] && resolveInput(argv[0]);
    if (!src) throw new Error('用法：film frames <素材> [--fps 30] [--out frames/名字] [--size 1920x1080]');
    const film = (() => { try { return readFilm(); } catch { return undefined; } })();
    const fps = Number(opt('--fps', String(film?.fps || 30)));
    const [w, h] = (opt('--size') || `${film?.width || 1920}x${film?.height || 1080}`).split('x').map(Number);
    const out = path.resolve(WORK, opt('--out', path.join('frames', path.parse(src).name)));
    fs.mkdirSync(out, { recursive: true });
    await ffmpeg(['-i', src, '-vf', `fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`, '-q:v', '3', path.join(out, '%05d.jpg')]);
    const n = fs.readdirSync(out).filter(f => f.endsWith('.jpg')).length;
    say(`完成：${rel(out)}/00001.jpg … ${String(n).padStart(5, '0')}.jpg（${n} 帧，${fps} fps，${w}×${h}）。页面里用 /${rel(out)}/00001.jpg 读取。`);
  },

  probe: async () => {
    const src = argv[0] && resolveInput(argv[0]);
    if (!src) throw new Error('用法：film probe <素材>');
    const info = await probe(src);
    const v = info.streams.find(s => s.codec_type === 'video'), a = info.streams.find(s => s.codec_type === 'audio');
    const measured = v ? await measuredFps(src) : undefined;
    say(`${rel(src)}：${Number(info.format.duration).toFixed(2)} 秒`, v ? `画面 ${v.width}×${v.height}，标称 ${v.r_frame_rate}，平均 ${v.avg_frame_rate}${measured ? `，按时间戳实测约 ${measured} fps` : ''}` : '没有画面', a ? `声音 ${a.codec_name} ${a.sample_rate} Hz ${a.channels} 声道` : '没有声音');
  },

  progress: async () => {
    const thumbs = opts('--thumb');
    const [step, ...detail] = argv;
    if (!step) throw new Error('用法：film progress <步骤> [说明] [--thumb 图片 …]');
    writeProgress({ step, detail: detail.join(' ') || undefined, ...(thumbs.length ? { thumbs } : {}) });
    say(`progress.json：${step}${detail.length ? ` · ${detail.join(' ')}` : ''}`);
  },

  'need-network': async () => {
    const reason = opt('--reason');
    const hosts = opts('--host');
    if (!reason || !hosts.length) throw new Error('用法：film need-network --reason "为什么要联网" --host 域名 [--host 域名 …]');
    fs.writeFileSync(path.join(WORK, 'network-request.json'), JSON.stringify({ reason, hosts, at: new Date().toISOString() }, null, 2));
    say('已写 network-request.json。现在结束这一轮回复，等用户答复；下一轮会告诉你能不能联网。');
  },

  libs: async () => {
    const libs = libraryVersions();
    say('离线库（页面里用这些地址 import，不要用 CDN）：', ...libs.map(l => `  ${l.name} ${l.version}  ${l.url}${l.note ? `\n      ${l.note}` : ''}`), '  lib.js（缓动、插值、带种子的随机数）  /_kit/lib.js',
      '', 'importmap（放进页面 <head>，让 "three" 和 d3 的相互引用能解析）：',
      JSON.stringify({ imports: Object.fromEntries([...libs.map(l => [l.name, l.url]), ['three/addons/', '/_kit/three/examples/jsm/']]) }));
  },

  fonts: async () => {
    const fonts = listFonts();
    say(fonts.length ? `可用字体（@font-face 里 src: url('/_fonts/文件名')）：\n${fonts.map(f => `  ${f.url}  ${(f.bytes / 1e6).toFixed(1)} MB`).join('\n')}` : '没有找到字体文件。中文用系统字体 "PingFang SC"。');
  },

  gl: async () => { say(JSON.stringify(await webglInfo(), null, 2)); },

  icons: async () => {
    const words = process.argv.slice(3).map(w => w.toLowerCase()).flatMap(w => ICON_ALIASES[w] ?? [w]);
    const dir = iconsDir();
    if (!dir) return say('这台机器上没有找到图标库。');
    if (!words.length) return say('用法：film icons 关键词…（例：film icons openai 小红书 arrow）', '  品牌 logo：/_icons/simple-icons/<名字>.svg　　通用图标：/_icons/lucide/<名字>.svg');
    const list = lib => fs.readdirSync(path.join(dir, lib)).filter(f => f.endsWith('.svg') && !/^license/i.test(f)).map(f => f.slice(0, -4));
    for (const [lib, label] of [['simple-icons', '品牌 logo'], ['lucide', '通用图标']]) {
      const names = list(lib), hits = names.filter(n => words.some(w => n === w)).concat(names.filter(n => words.some(w => n !== w && n.includes(w)))).slice(0, 24);
      say(`${label}（${hits.length ? hits.length : '没有'}）：`, ...hits.map(n => `  /_icons/${lib}/${n}.svg`));
    }
  },

  presets: async () => {
    const { presets, finishes, style } = textPresets();
    const ROLE = { title: '标题', caption: '字幕', label: '标签' };
    say(`文字样式（text 的 preset，${style ? `本风格 ${style} 自带的` : '通用的'}；按 text 的 role 选对应类别的）：`, ...Object.entries(presets).map(([name, p]) => `  ${name}${p.roles?.length ? `【${p.roles.map(r => ROLE[r] || r).join('、')}】` : ''}：${p.font || 'Noto Sans SC'} ${p.weight || 600}，字高约短边的 ${Math.round(p.size * 1000) / 10}%${p.box ? '，带底板' : ''}${p.stroke ? '，描边' : ''}`),
      `整片效果（finish）：${finishes.join('、')}`);
  },
};


// ── layered film (film.json version 2) ──
const ENCODE = fps => videoEncoder(fps);

async function checkV2(film) {
  const count = k => film[k].length;
  say(`film.json（分轨）：${film.width}×${film.height}，${film.fps} fps，${film.duration} 秒`,
    `  画面页 ${count('picture')} · 素材 ${count('footage')} · 文字 ${count('text')} · 旁白 ${count('voice')} · 配乐 ${count('music')} · 音效 ${count('sfx')}`);
  for (const s of film.segments) say(`  ${s.start.toFixed(2)}–${s.end.toFixed(2)}  ${s.name}${s.transition !== 'cut' ? `（转场 ${s.transition}）` : ''}`);
  const plan = path.join(WORK, 'plan.json');
  if (fs.existsSync(plan)) {
    const p = JSON.parse(fs.readFileSync(plan, 'utf8')); checkPlan(p);
    const same = p.segments.length === film.segments.length && p.segments.every((s, i) => s.name === film.segments[i].name && Math.abs(s.start - film.segments[i].start) < 1e-3 && Math.abs(s.end - film.segments[i].end) < 1e-3);
    if (!same) throw new Error('plan.json 的 segments 要和 film.json 的 segments 一致（名字和起止时间）');
    say('plan.json：格式正确，分段一致');
  }
  const problems = await checkLayered(film);
  if (problems.length) throw new Error(`film.json 有问题：\n- ${problems.join('\n- ')}`);
  for (const clip of film.picture.filter(c => c.layer === 'overlay')) {
    const { browser, page, draw } = await openPage(clip.page, { w: film.width, h: film.height });
    try {
      await draw((clip.end - clip.start) / 2);
      // an overlay must let the footage through: most of the frame clear (big blocks in corners and edges are fine,
      // a page painted edge to edge is not). Sampled on a 12 × 7 grid.
      const shot = pngAlpha(await page.screenshot({ type: 'png', omitBackground: true }));
      let clear = 0, total = 0;
      for (let i = 0; i < 12; i++) for (let j = 0; j < 7; j++) {
        const x = Math.round((i + 0.5) / 12 * (shot.width - 1)), y = Math.round((j + 0.5) / 7 * (shot.height - 1));
        total++; if (shot.alpha(x, y) <= 8) clear++;
      }
      if (clear / total < 0.4) throw new Error(`叠加页 ${clip.page}（${clip.id}）几乎铺满了：抽查 ${total} 个点只有 ${clear} 个透明。overlay 要让素材透出来（html、body 背景透明，色块可以大、可以贴边，但不要整页铺底）`);
    } finally { await browser.close(); }
  }
  const { page, query } = await composeSpec(film);
  const { browser, page: compositor, draw, errors } = await openPage(page, { w: film.width, h: film.height, query });
  try {
    const missing = await compositor.evaluate(() => window.shot.missingEdits || []);
    if (missing.length) throw new Error(`这处修改已失效：${missing.map(x => `${x.page}（${x.id}）找不到 data-edit「${x.name}」`).join('；')}`);
    for (const t of [0, film.duration / 2, film.duration - 1 / film.fps]) await draw(t);
    say(`  ✓ 合成（素材、画面页、文字）${errors.length ? `（${errors.length} 条提示：${errors.slice(-2).join('；')}）` : ''}`);
  } finally { await browser.close(); }
  say('检查通过');
}

/** Alpha of a 1×1 PNG (Chrome writes 8-bit RGBA; with no neighbours every PNG filter leaves the bytes as they are). */
/** One screenshot's alpha channel (8-bit RGBA PNG; anything else counts as opaque). */
function pngAlpha(png) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6) return { width, height, alpha: () => 255 };
  const idat = [];
  for (let o = 8; o + 8 <= png.length;) { const n = png.readUInt32BE(o), type = png.toString('ascii', o + 4, o + 8); if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + n)); o += n + 12; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * 4, rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? rows[dst + i - 4] : 0, b = y ? rows[dst - stride + i] : 0, c = i >= 4 && y ? rows[dst - stride + i - 4] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      rows[dst + i] = raw[src + i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
    }
  }
  return { width, height, alpha: (x, y) => rows[y * stride + x * 4 + 3] };
}

async function withCompose(film, fn) {
  const { page: rel, query } = await composeSpec(film);
  const { browser, page, draw } = await openPage(rel, { w: film.width, h: film.height, query });
  try { return await fn(page, draw); } finally { await browser.close(); }
}

async function drawTimesV2(film, times, dir, prefix, { width }) {
  fs.mkdirSync(dir, { recursive: true });
  return withCompose(film, async (page, draw) => {
    const files = [];
    for (const t of times) {
      await draw(Math.min(t, film.duration - 1 / film.fps));
      const f = path.join(dir, `${prefix}${t.toFixed(2)}.jpg`);
      const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
      if (width) await ffmpeg(['-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-', '-vf', `scale=${width}:-2`, '-q:v', '3', f], { input: buf });
      else fs.writeFileSync(f, buf);
      files.push(f);
    }
    return files;
  });
}

async function deterministicV2(film, times) {
  const picks = [...new Set([times[Math.floor(times.length / 3)], times[Math.floor((times.length * 2) / 3)]])].filter(t => t !== undefined);
  const bad = await withCompose(film, async (page, draw) => {
    const out = [];
    const hash = async x => { await draw(x); return crypto.createHash('sha1').update(await page.screenshot({ type: 'png' })).digest('hex'); };
    for (const t of picks) { const a = await hash(t); await hash(Math.max(0, film.duration - t - 0.37)); if (a !== await hash(t)) out.push(`${t.toFixed(2)} 秒`); }
    return out;
  });
  return bad.length ? `⚠ 画面不只取决于 t：${bad.join('、')} 先画别的时刻再画回来，结果不一样。去掉 Date.now()、无种子随机数和跨帧状态。` : '确定性：同一 t 两次画面一致。';
}

async function renderV2(film) {
  const workers = Math.max(1, Math.min(6, Number(opt('--workers', String(Math.min(3, Math.max(1, Math.floor(os.cpus().length / 4))))))));
  const work = path.join(WORK, 'out', '.render');
  fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const total = frames(film.duration, film.fps), t0 = Date.now();
  let done = 0, last = 0;
  const tick = () => { done++; if (done - last >= 30 || done === total) { last = done; writeProgress({ step: 'render', detail: '逐帧渲染', progress: { done: round(done / film.fps), total: round(total / film.fps) } }); } };
  writeProgress({ step: 'render', detail: '逐帧渲染', progress: { done: 0, total: round(total / film.fps) } });
  const { page: rel, query } = await composeSpec(film);
  const chunk = Math.max(45, Math.ceil(total / workers)), tasks = [];
  for (let a = 0, k = 0; a < total; a += chunk, k++) tasks.push({ a, b: Math.min(total, a + chunk), file: path.join(work, `c${k}.mp4`) });
  let next = 0;
  await Promise.all([...Array(Math.min(workers, tasks.length))].map(async () => {
    while (next < tasks.length) {
      const { a, b, file } = tasks[next++];
      const { browser, page, draw } = await openPage(rel, { w: film.width, h: film.height, query });
      const enc = spawn(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(film.fps), '-c:v', 'mjpeg', '-i', '-', ...(await ENCODE(film.fps)), path.basename(file)], { cwd: work, stdio: ['pipe', 'ignore', 'pipe'] });
      let err = ''; enc.stderr.on('data', d => { err += d; });
      const closed = new Promise(resolve => enc.on('close', resolve));
      try {
        for (let f = a; f < b; f++) {
          await draw(f / film.fps);
          if (!enc.stdin.write(await page.screenshot({ type: 'jpeg', quality: 95 }))) await new Promise(r => enc.stdin.once('drain', r));
          tick();
        }
      } finally { enc.stdin.end(); await browser.close(); }
      if (await closed !== 0) throw new Error(`编码失败：${err.trim().split('\n').slice(-3).join(' ')}`);
    }
  }));
  fs.writeFileSync(path.join(work, 'list.txt'), tasks.map(t => `file '${path.basename(t.file)}'`).join('\n'));
  const raw = path.join(work, 'raw.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'raw.mp4'], { cwd: work });
  const out = path.join(WORK, 'out', 'video.mp4'), tmp = `${out}.${process.pid}.tmp.mp4`;
  await finishPicture(film, raw, tmp, await ENCODE(film.fps));
  fs.renameSync(tmp, out);
  fs.rmSync(work, { recursive: true, force: true });
  writeProgress({ step: 'render', detail: '画面渲染完成', progress: { done: round(total / film.fps), total: round(total / film.fps) } });
  say(`完成：${rel === undefined ? '' : 'out/video.mp4'}，${total} 帧（分轨合成${film.segments.some(s => s.transition !== 'cut') || film.ending === 'fade' ? '，含转场和淡入淡出' : ''}），用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
}

function resolveInput(arg) {
  for (const file of [path.resolve(WORK, arg), path.resolve(MEDIA, arg)]) if (fs.existsSync(file)) return file;
  throw new Error(`找不到素材 ${arg}（工作目录和素材目录 ${MEDIA} 里都没有）`);
}

function checkPlan(plan) {
  const bad = [];
  if (!plan.title || typeof plan.title !== 'string') bad.push('title（片名）');
  if (!plan.logline || typeof plan.logline !== 'string') bad.push('logline（一句话）');
  if (!(Number(plan.duration) > 0)) bad.push('duration（秒）');
  if (!Array.isArray(plan.segments) || !plan.segments.length || plan.segments.some(s => !s.name || !(Number(s.end) > Number(s.start)))) bad.push('segments（[{name,start,end}]）');
  if (bad.length) throw new Error(`plan.json 缺少或写错：${bad.join('、')}`);
}

/** Draw film times with as few browser launches as possible (times grouped by shot). */
async function drawTimes(film, times, dir, prefix, { width }) {
  fs.mkdirSync(dir, { recursive: true });
  const files = new Array(times.length);
  const byShot = new Map();
  times.forEach((t, i) => { const { shot, local } = shotAt(film, t); if (!byShot.has(shot)) byShot.set(shot, []); byShot.get(shot).push({ i, t, local }); });
  for (const [shot, list] of byShot) {
    if (shot.video) {
      for (const { i, t, local } of list) { const f = path.join(dir, `${prefix}${t.toFixed(2)}.jpg`); await ffmpeg(['-ss', String(shot.in + local), '-i', resolveInput(shot.video), '-frames:v', '1', '-vf', `scale=${film.width}:${film.height}:force_original_aspect_ratio=increase,crop=${film.width}:${film.height}${width ? `,scale=${width}:-2` : ''}`, '-q:v', '3', f]); files[i] = f; }
      continue;
    }
    const { browser, page, draw } = await openPage(shot.page, { w: film.width, h: film.height });
    try {
      for (const { i, t, local } of list) {
        await draw(Math.min(local, shot.dur - 1 / film.fps));
        const f = path.join(dir, `${prefix}${t.toFixed(2)}.jpg`);
        const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
        if (width) await ffmpeg(['-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-', '-vf', `scale=${width}:-2`, '-q:v', '3', f], { input: buf });
        else fs.writeFileSync(f, buf);
        files[i] = f;
      }
    } finally { await browser.close(); }
  }
  return files;
}

/** Same t, drawn again after another t, must give the same picture. */
async function deterministic(film, times) {
  const picks = [...new Set([times[Math.floor(times.length / 3)], times[Math.floor((times.length * 2) / 3)]])].filter(t => t !== undefined);
  const bad = [];
  for (const t of picks) {
    const { shot, local } = shotAt(film, t);
    if (!shot.page) continue;
    const { browser, page, draw } = await openPage(shot.page, { w: film.width, h: film.height });
    try {
      const shotOnce = async x => { await draw(x); return crypto.createHash('sha1').update(await page.screenshot({ type: 'png' })).digest('hex'); };
      const a = await shotOnce(local), _ = await shotOnce(Math.max(0, shot.dur - local - 0.37)), b = await shotOnce(local);
      void _;
      if (a !== b) bad.push(`${t.toFixed(2)} 秒（${shot.page}）`);
    } finally { await browser.close(); }
  }
  return bad.length ? `⚠ 画面不只取决于 t：${bad.join('、')} 先画别的时刻再画回来，结果不一样。去掉 Date.now()、无种子随机数和跨帧状态。` : '确定性：同一 t 两次画面一致。';
}

async function contactSheet(files, out, step, start) {
  if (!files.length) throw new Error('没有可拼的帧');
  const cols = files.length <= 8 ? 4 : files.length <= 15 ? 5 : 6;
  const rows = Math.ceil(files.length / cols);
  const list = path.join(path.dirname(out), 'sheet.txt');
  fs.writeFileSync(list, files.map(f => `file '${f.replace(/'/g, "'\\''")}'\nduration ${step}`).join('\n') + `\nfile '${files.at(-1).replace(/'/g, "'\\''")}'`);
  // The bundled ffmpeg has no drawtext, so frames carry no time label: they run left to right, top to bottom, `step` seconds apart.
  try { await ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.basename(list), '-vf', `scale=480:-2,tile=${cols}x${rows}:padding=6:margin=6:color=0x1b1b1b`, '-frames:v', '1', '-q:v', '3', path.basename(out)], { cwd: path.dirname(out) }); }
  finally { fs.rmSync(list, { force: true }); }
  void start;
  return out;
}

async function lookVideo(src, dir, every) {
  if (!fs.existsSync(src)) throw new Error(`找不到 ${src}`);
  const dur = Number((await probe(src)).format.duration);
  const step = every || Math.max(0.25, Math.round((dur / 23) * 4) / 4);
  await ffmpeg(['-i', src, '-vf', `fps=1/${step},scale=960:-2`, '-q:v', '3', path.join(dir, 't_%03d.jpg')]);
  const files = fs.readdirSync(dir).filter(f => /^t_\d+\.jpg$/.test(f)).sort().map(f => path.join(dir, f));
  const sheet = await contactSheet(files, path.join(dir, 'sheet.jpg'), step, 0);
  say(`接触表：${rel(sheet)}（${files.length} 帧，每 ${step} 秒一帧）`, '用 view_image 打开接触表看一遍。');
}

async function renderChunk(film, { shot, a, b, file }, tick) {
  const { browser, page, draw } = await openPage(shot.page, { w: film.width, h: film.height });
  const enc = spawn(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(film.fps), '-c:v', 'mjpeg', '-i', '-',
    ...(await videoEncoder(film.fps)), path.basename(file)], { cwd: path.dirname(file), stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  enc.stderr.on('data', d => { err += d; });
  const closed = new Promise(resolve => enc.on('close', resolve));
  try {
    for (let f = a; f < b; f++) {
      await draw(f / film.fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!enc.stdin.write(buf)) await new Promise(resolve => enc.stdin.once('drain', resolve));
      tick(1);
    }
  } finally { enc.stdin.end(); await browser.close(); }
  const code = await closed;
  if (code !== 0) throw new Error(`编码 ${shot.page} 失败：${err.trim().split('\n').slice(-3).join(' ')}`);
}

async function renderFootage(film, { shot, b, file }, tick) {
  await ffmpeg(['-ss', String(shot.in), '-i', resolveInput(shot.video), '-frames:v', String(b), '-an', '-vf', `scale=${film.width}:${film.height}:force_original_aspect_ratio=increase,crop=${film.width}:${film.height},fps=${film.fps},setsar=1,format=yuv420p`,
    ...(await videoEncoder(film.fps)), file]);
  tick(b);
}

async function joinShots(film, files, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp.mp4`;
  if (film.shots.every(s => !s.transition)) {
    const list = path.join(path.dirname(files[0]), 'shots.txt');
    fs.writeFileSync(list, files.map(f => `file '${path.basename(f)}'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'shots.txt', '-c', 'copy', '-movflags', '+faststart', tmp], { cwd: path.dirname(files[0]) });
  } else {
    const parts = files.map((_, i) => `[${i}:v]settb=AVTB,fps=${film.fps},format=yuv420p,setsar=1[s${i}]`);
    let acc = 's0';
    film.shots.slice(1).forEach((shot, k) => {
      const i = k + 1, next = `j${i}`;
      parts.push(shot.transition ? `[${acc}][s${i}]xfade=transition=${shot.transition.type}:duration=${shot.transition.dur}:offset=${round(shot.start)}[${next}]` : `[${acc}][s${i}]concat=n=2:v=1:a=0[${next}]`);
      acc = next;
    });
    await ffmpeg([...files.flatMap(f => ['-i', f]), '-filter_complex', parts.join(';'), '-map', `[${acc}]`, ...(await videoEncoder(film.fps)), '-movflags', '+faststart', tmp]);
  }
  fs.renameSync(tmp, out);
}

async function measureLoudness(file) {
  const { err } = await run(tool('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).catch(() => ({ err: '' }));
  const json = err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1);
  try { const m = JSON.parse(json); return [m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset].every(v => v !== undefined && !/inf|nan/i.test(String(v))) && Number(m.input_i) > -70 ? m : undefined; }
  catch { return undefined; }
}
async function integrated(file) {
  const { err } = await run(tool('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']).catch(() => ({ err: '' }));
  const i = err.match(/I:\s+(-?[\d.]+) LUFS/g)?.at(-1)?.match(/-?[\d.]+/)?.[0], p = err.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.at(-1)?.match(/-?[\d.]+/)?.[0];
  return i ? `${i} LUFS${p ? `，峰值 ${p} dBFS` : ''}` : undefined;
}
async function measuredFps(file) {
  const { out } = await run(tool('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+20', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file]);
  const ts = out.split('\n').map(Number).filter(Number.isFinite).sort((x, y) => x - y);
  if (ts.length < 3) return undefined;
  return ((ts.length - 1) / (ts.at(-1) - ts[0])).toFixed(2);
}

if (!cmd || !commands[cmd]) { say(HELP); process.exit(cmd ? 2 : 0); }
commands[cmd]().then(() => process.exit(0), error => { console.error(`film ${cmd}：${error.message || error}`); process.exit(1); });
