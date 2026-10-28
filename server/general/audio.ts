/** 混音后统一响度。只处理声音，画面直接复制；失败留住原文件，不交给模型重做。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export type AudioMeasurement = { integrated: number; peak: number };
export type AudioReport = { corrected: boolean; before: AudioMeasurement; after: AudioMeasurement; silent: boolean; passes: number };
export async function measureAudio(ffmpeg: string, file: string): Promise<AudioMeasurement> {
  const { stderr } = await exec(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { maxBuffer: 8 << 20 });
  const raw = /\{\s*"input_i"[\s\S]*?\}/.exec(stderr)?.[0];
  if (!raw) throw new Error('未能测量成片响度，请检查声音处理工具');
  const data = JSON.parse(raw);
  const value = (v: string) => v === '-inf' ? -Infinity : Number(v);
  const result = { integrated: value(data.input_i), peak: value(data.input_tp) };
  if (Number.isNaN(result.integrated) || Number.isNaN(result.peak)) throw new Error('响度测量返回无效数据');
  if (result.integrated === Infinity || result.peak === Infinity) throw new Error('声音包含无效的无限幅度');
  return result;
}
const acceptable = (m: AudioMeasurement) => Math.abs(m.integrated + 14) <= 0.5 && m.peak <= -1;

const filter = (m: AudioMeasurement, target = -14, ceiling = -1.5) => {
  // 非零但低于响度门限的声音先抬到可测范围；真正全零音轨不能凭增益修复。
  const gain = !Number.isFinite(m.integrated) && Number.isFinite(m.peak) ? `volume=${Math.max(0, -20 - m.peak)}dB,` : '';
  return `aformat=channel_layouts=stereo,${gain}loudnorm=I=${target}:TP=${ceiling}:LRA=11:linear=false,aresample=48000`;
};
const fingerprint = (file: string) => { const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}`; };
const saveReport = (file: string, report: AudioReport) => fs.writeFileSync(`${file}.audio.json`, JSON.stringify({ ...report, fileStamp: fingerprint(file) }, null, 2));

export async function muxNormalizedAudio(ffmpeg: string, video: string, sound: string, output: string) {
  const before = await measureAudio(ffmpeg, sound);
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', sound,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', filter(before), '-ac', '2',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output], { maxBuffer: 8 << 20 });
  const report = await normalizeAudio(ffmpeg, output);
  report.before = before; report.corrected = Number.isFinite(before.peak); report.passes++;
  saveReport(output, report);
  return report;
}

/** AAC 编码后的实测才算通过。内部有限次校正不消耗模型 token，也不改变源音轨。 */
export async function normalizeAudio(ffmpeg: string, file: string): Promise<AudioReport> {
  const before = await measureAudio(ffmpeg, file);
  const report: AudioReport = { corrected: false, before, after: before, silent: !Number.isFinite(before.peak), passes: 0 };
  const save = () => saveReport(file, report);
  if (report.silent || acceptable(before)) {
    let recorded = false;
    try { recorded = JSON.parse(fs.readFileSync(`${file}.audio.json`, 'utf8')).fileStamp === fingerprint(file); } catch { /* no matching report */ }
    if (!recorded) save();
    return report;
  }
  const temp = path.join(path.dirname(file), `.audio-${process.pid}-${crypto.randomUUID()}.mp4`);
  let target = -14, ceiling = -1.5;
  try {
    for (let pass = 1; pass <= 3; pass++) {
      await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0:v?', '-map', '0:a:0',
        '-c:v', 'copy', '-af', filter(before, target, ceiling), '-ac', '2',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temp], { maxBuffer: 8 << 20 });
      report.after = await measureAudio(ffmpeg, temp); report.passes = pass;
      if (acceptable(report.after)) {
        fs.renameSync(temp, file); report.corrected = true; save(); return report;
      }
      target = Math.max(-16, Math.min(-12, target + (-14 - report.after.integrated)));
      if (report.after.peak > -1) ceiling = Math.max(-9, ceiling - (report.after.peak + 1) - 0.5);
    }
    throw new Error(`声音自动处理未达标（${report.after.integrated} LUFS / ${report.after.peak} dBTP），已保留原文件；请检查声音处理工具，无需智能体返工`);
  } finally { fs.rmSync(temp, { force: true }); }
}
