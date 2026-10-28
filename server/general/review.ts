/**
 * 统一看图审片：出片的 Agent 不一定能看图，所以由 OpenTake 来做。
 * 1. ffmpeg 从成片均匀抽帧、拼接触表，再跑机检（时长、画幅、音轨、黑场、响度）；
 * 2. 起一个只读、临时的 Codex，把图附上，按风格和模板的检查清单给结构化结论；
 * 3. 结论：通过，或者要改的条目（交给出片会话做第二轮）。
 */
import fs from 'node:fs';
import { normalizeAudio } from './audio.ts';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GeneralProject } from '../../src/general/general-contract.ts';
import { frameSize } from './brief.ts';

const run = promisify(execFile);
export type Verdict = { pass: boolean; summary: string; issues: { time: number | null; problem: string; fix: string }[] };
export type MachineCheck = { ok: boolean; text: string };
export type Frames = { frames: { file: string; time: number }[]; sheet: string; duration: number };

export const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pass', 'summary', 'issues'],
  properties: {
    pass: { type: 'boolean', description: 'true = 可以交给用户；false = 有必须改的问题' },
    summary: { type: 'string', description: '一两句中文结论' },
    issues: {
      type: 'array', description: '要改的条目，最要紧的在前，最多 6 条；通过时可以为空',
      items: { type: 'object', additionalProperties: false, required: ['time', 'problem', 'fix'], properties: {
        time: { type: ['number', 'null'], description: '问题出现在第几秒，整体问题为 null' },
        problem: { type: 'string' }, fix: { type: 'string', description: '具体怎么改' },
      } },
    },
  },
} as const;

async function probe(ffprobe: string, file: string) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', file], { maxBuffer: 4 << 20 });
  const info = JSON.parse(stdout) as { format: { duration: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string }[] };
  return { duration: Number(info.format.duration) || 0, video: info.streams.find(s => s.codec_type === 'video'), audio: info.streams.find(s => s.codec_type === 'audio') };
}

/** Evenly spaced frames (centre of each slice) and a 4-column contact sheet. */
export async function extractFrames(ffmpeg: string, ffprobe: string, video: string, dir: string, count = 12): Promise<Frames> {
  fs.mkdirSync(dir, { recursive: true });
  const { duration } = await probe(ffprobe, video);
  if (!(duration > 0)) throw new Error('成片时长为 0，无法审片');
  const frames: Frames['frames'] = [];
  for (let i = 0; i < count; i++) {
    const time = Math.round(((i + 0.5) * duration / count) * 100) / 100;
    const file = path.join(dir, `f${String(i + 1).padStart(2, '0')}.jpg`);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(time), '-i', video, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', file]);
    frames.push({ file, time });
  }
  const sheet = path.join(dir, 'sheet.jpg');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', path.join(dir, 'f%02d.jpg'), '-vf', `scale=480:-2,tile=4x${Math.ceil(count / 4)}:padding=6:margin=6:color=0x1b1b1b`, '-frames:v', '1', '-q:v', '3', sheet]);
  return { frames, sheet, duration };
}

export async function machineChecks(ffmpeg: string, ffprobe: string, video: string, settings: GeneralProject['settings']): Promise<MachineCheck[]> {
  const checks: MachineCheck[] = [];
  const info = await probe(ffprobe, video);
  const { width, height } = frameSize(settings.aspect);
  checks.push({ ok: info.video?.width === width && info.video?.height === height, text: `画幅 ${info.video?.width}×${info.video?.height}（要求 ${width}×${height}）` });
  if (settings.length !== 'auto') {
    const ok = Math.abs(info.duration - settings.length) <= settings.length * 0.1 + 0.5;
    checks.push({ ok, text: `时长 ${info.duration.toFixed(1)} 秒（要求 ${settings.length} 秒）` });
  } else checks.push({ ok: info.duration >= 5 && info.duration <= 75, text: `时长 ${info.duration.toFixed(1)} 秒` });
  checks.push({ ok: !!info.audio, text: info.audio ? `有音轨（${info.audio.codec_name}）` : '没有音轨' });
  if (info.audio) {
    const audio = await normalizeAudio(ffmpeg, video);
    checks.push({ ok: !audio.silent, text: audio.silent ? '音轨是静音，请补充实际声音内容' : `声音已由程序处理：${audio.after.integrated} LUFS / ${audio.after.peak} dBTP（目标 −14 LUFS / ≤ −1 dBTP）` });
  }
  try {
    const { stderr } = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', video, '-vf', 'blackdetect=d=0.4:pix_th=0.08', '-f', 'null', '-'], { maxBuffer: 32 << 20 });
    const blacks = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => `${Number(m[1]).toFixed(1)}–${Number(m[2]).toFixed(1)} 秒`);
    checks.push({ ok: blacks.length === 0, text: blacks.length ? `黑场 ${blacks.join('、')}` : '没有黑场' });
  } catch { throw new Error('黑场检查未完成，请检查媒体工具后重试，无需智能体返工'); }
  return checks;
}

export function reviewPrompt(input: { styleId: string; styleName: string; kit: string; project: GeneralProject; frames: Frames; checks: MachineCheck[]; round: number }): string {
  const { project, frames, checks } = input;
  const footage = project.inputs.kind === 'footage';
  return [
    '你是 OpenTake 的审片员。只看附上的画面给结论，不修改任何文件，不运行渲染。',
    `第一张图是全片接触表（4 列，从左到右、从上到下，依次是 ${frames.frames.map(f => `${f.time}s`).join('、')}），后面是其中几帧的大图。`,
    '',
    input.styleId === 'free'
      ? `这条不用风格库，按用户的要求判断。常见失败在 \`${path.join(input.kit, 'docs', 'DIRECTOR.md')}\` 第 10 节：可以读，但结论以画面为准。`
      : `风格：${input.styleId}（${input.styleName}）。风格规则在 \`${path.join(input.kit, 'styles', input.styleId, 'STYLE.md')}\`，是起点；和用户的补充要求冲突时以用户为准。常见失败在 \`${path.join(input.kit, 'docs', 'DIRECTOR.md')}\` 第 10 节：可以读，但结论以画面为准。`,
    `要求：${frameSize(project.settings.aspect).width}×${frameSize(project.settings.aspect).height}，${project.settings.length === 'auto' ? '时长按内容' : `${project.settings.length} 秒`}，不配旁白，屏幕文字中文。`,
    footage ? '输入是用户自己的视频：画面应当来自这些素材。' : `输入是文案，下面每个意思都要在画面上传达到：\n> ${project.inputs.text.trim().split('\n').join('\n> ')}`,
    project.inputs.note.trim() ? `用户补充：${project.inputs.note.trim()}` : '',
    '',
    '机检结果：', ...checks.map(c => `- ${c.ok ? '✓' : '✗'} ${c.text}`),
    '',
    '逐项检查：',
    '1. 文字：完整、没有错字、没有出画或被遮挡、字号够大、颜色和底色分得开；',
    input.styleId === 'free' ? '2. 要求：用户补充要求里的每一条，逐条对照画面有没有做到；' : '2. 风格和要求：用户补充要求里的每一条有没有做到；配色、材质、字体、构图是不是这个风格，而不是普通的幻灯片；',
    '3. 画面：主体够大不贴边，没有空白帧、穿帮、错位、半截元素；',
    '4. 节奏和运镜：镜头之间有变化，不是每屏静止停好几秒；',
    '5. 内容：' + (footage ? '用了用户的素材，没有编造数字或文字；' : '文案的意思都讲到了，没有编造数字；'),
    '6. 版式：各段是不是同一套构图只换了字？叠加的字和色块够不够大、有没有冲击力（像海报，而不是贴在边上的小条）？',
    '7. 机检里打 ✗ 的项。',
    '',
    '不管通过与否，issues 里都要写出全片最弱的两三处，具体到第几秒、换成什么样的构图或做法，好让下一轮能真正改好，而不是小修小补。',
    '',
    `只有会让用户觉得「这条不能用」的问题才判不通过。${input.round > 1 ? '这是改过一轮之后的复审，小问题写进 issues 但可以判通过。' : ''}每条 issue 写清楚第几秒、什么问题、具体怎么改。只输出 JSON。`,
  ].filter(line => line !== undefined).join('\n');
}

/** The reviewer's last message → verdict. Tolerates extra text around the JSON. */
export function parseVerdict(text: string): Verdict {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('审片结论不是 JSON');
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  if (typeof raw.pass !== 'boolean') throw new Error('审片结论缺少 pass');
  const issues = Array.isArray(raw.issues) ? raw.issues.slice(0, 8).map(i => {
    const item = (i || {}) as Record<string, unknown>;
    const time = typeof item.time === 'number' && Number.isFinite(item.time) ? item.time : null;
    return { time, problem: String(item.problem || '').trim(), fix: String(item.fix || '').trim() };
  }).filter(i => i.problem) : [];
  return { pass: raw.pass, summary: String(raw.summary || '').trim() || (raw.pass ? '通过' : '需要修改'), issues };
}

/** One line per issue, for the step detail and for the next round. */
export function verdictText(verdict: Verdict): string {
  if (!verdict.issues.length) return verdict.summary;
  return [verdict.summary, ...verdict.issues.map((i, n) => `${n + 1}. ${i.time !== null ? `${i.time} 秒：` : ''}${i.problem}${i.fix ? `（改法：${i.fix}）` : ''}`)].join('\n');
}
