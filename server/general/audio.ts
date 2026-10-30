/** 混音后统一响度。只处理声音，画面直接复制；失败留住原文件，不交给模型重做。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export type AudioMeasurement = { integrated: number; peak: number };
type AudioPass = AudioMeasurement & { gainDb: number; ceilingDb: number };
export type AudioReport = { corrected: boolean; before: AudioMeasurement; after: AudioMeasurement; silent: boolean; passes: number; attempts?: AudioPass[] };
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

// loudnorm 的 TP 只约束无损信号，不约束 AAC 解码后的真峰值。
// 先保留无损中间音轨，再独立限幅；AAC 每次都从同一无损文件编码，避免代际损失。
const fingerprint = (file: string) => { const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}`; };
const saveReport = (file: string, report: AudioReport) => fs.writeFileSync(`${file}.audio.json`, JSON.stringify({ ...report, fileStamp: fingerprint(file) }, null, 2));

async function renderNormalizedAudio(ffmpeg: string, video: string, sound: string, output: string, before: AudioMeasurement, shortest: boolean): Promise<AudioReport> {
  const report: AudioReport = { corrected: false, before, after: before, silent: !Number.isFinite(before.peak), passes: 0, attempts: [] };
  const dir = fs.mkdtempSync(path.join(path.dirname(output), '.audio-'));
  const pcm = path.join(dir, 'normalized.wav'), candidate = path.join(dir, 'candidate.mp4');
  try {
    // 非零但低于响度门限的声音先抬到可测范围；全零音轨仍须明确报告静音。
    const gain = !Number.isFinite(before.integrated) && !report.silent ? `volume=${Math.max(0, -20 - before.peak)}dB,` : '';
    await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', sound, '-vn', '-af',
      `aformat=channel_layouts=stereo,${gain}loudnorm=I=-14:TP=-3:LRA=11:linear=false,aresample=192000`,
      '-ac', '2', '-c:a', 'pcm_f32le', pcm], { maxBuffer: 8 << 20 });
    const normalized = await measureAudio(ffmpeg, pcm);
    let gainDb = report.silent ? 0 : -14 - normalized.integrated;
    if (!Number.isFinite(gainDb)) throw new Error('非静音音轨无法测量响度，已保留原文件');
    // 先给有损编码留 2 dB 余量。限幅器在 192 kHz (4 倍采样) 工作，
    // 关闭自动增益，补偿 lookahead 延迟，防止限幅被重新抬高或音画错位。
    let ceilingDb = -3;
    for (let pass = 1; pass <= 6; pass++) {
      const limit = 10 ** (ceilingDb / 20);
      await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', pcm,
        '-map', '0:v?', '-map', '1:a:0', '-c:v', 'copy', '-af',
        `volume=${gainDb}dB,alimiter=limit=${limit}:level=false:latency=true,aresample=48000`,
        '-ac', '2', '-c:a', 'aac', '-b:a', '192k', ...(shortest ? ['-shortest'] : []),
        '-movflags', '+faststart', candidate], { maxBuffer: 8 << 20 });
      report.after = await measureAudio(ffmpeg, candidate); report.passes = pass;
      report.attempts!.push({ gainDb, ceilingDb, ...report.after });
      if ((report.silent && !Number.isFinite(report.after.peak)) || acceptable(report.after)) {
        fs.renameSync(candidate, output); report.corrected = !report.silent;
        saveReport(output, report); return report;
      }
      // 增益在限幅之前补偿响度损失；峰值超标则扩大 AAC 余量。
      // 只依据最终解码实测修正，不把 loudnorm 的预估输出当作验收结果。
      if (!Number.isFinite(report.after.integrated) || !Number.isFinite(report.after.peak)) break;
      gainDb += -14 - report.after.integrated;
      if (report.after.peak > -1) ceilingDb = Math.max(-9, ceilingDb - (report.after.peak + 1) - 1);
    }
    throw new Error(`声音自动处理未达标（${report.after.integrated} LUFS / ${report.after.peak} dBTP），已保留原文件；请检查声音处理工具，无需智能体返工`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export async function muxNormalizedAudio(ffmpeg: string, video: string, sound: string, output: string) {
  return renderNormalizedAudio(ffmpeg, video, sound, output, await measureAudio(ffmpeg, sound), true);
}

/** 一次程序调用完成响度、过采样限幅和 AAC 实测校正，不消耗模型 token。 */
export async function normalizeAudio(ffmpeg: string, file: string): Promise<AudioReport> {
  const before = await measureAudio(ffmpeg, file);
  const report: AudioReport = { corrected: false, before, after: before, silent: !Number.isFinite(before.peak), passes: 0 };
  if (report.silent || acceptable(before)) {
    let recorded = false;
    try { recorded = JSON.parse(fs.readFileSync(`${file}.audio.json`, 'utf8')).fileStamp === fingerprint(file); } catch { /* no matching report */ }
    if (!recorded) saveReport(file, report);
    return report;
  }
  return renderNormalizedAudio(ffmpeg, file, file, file, before, false);
}
