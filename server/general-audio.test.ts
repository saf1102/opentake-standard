import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { measureAudio, normalizeAudio, muxNormalizedAudio } from './general/audio.ts';
import { machineChecks } from './general/review.ts';
import { ffmpegPath, ffprobePath } from './general/kit-env.ts';

const ffmpeg = ffmpegPath();
const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
test('真实低音量成片自动归一；画面不变、机检不因响度返工，错误时长仍失败', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task14-audio-'));
  try {
    const video = path.join(dir, 'quiet.mp4');
    run(['-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:r=5:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-af', 'volume=0.03', '-c:v', 'mpeg4', '-q:v', '12', '-c:a', 'aac', video]);
    const pixels = () => run(['-i', video, '-map', '0:v', '-f', 'framemd5', '-']);
    const beforePixels = pixels();
    const report = await normalizeAudio(ffmpeg, video);
    assert.ok(report.before.integrated < -40);
    assert.ok(report.corrected);
    assert.ok(Math.abs(report.after.integrated + 14) <= .5);
    assert.ok(report.after.peak <= -1);
    assert.equal(pixels(), beforePixels);
    const checks = await machineChecks(ffmpeg, ffprobePath(), video, { aspect: '16:9', length: 'auto' });
    assert.ok(checks.find(c => c.text.startsWith('声音已由程序'))?.ok);
    assert.ok(checks.some(c => !c.ok && c.text.startsWith('时长')));
    assert.equal((await normalizeAudio(ffmpeg, video)).corrected, false, '已达标不重复编码');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('浮点重叠混音超过 0 dB、尖峰和静音都确定处理；源音轨不变', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task14-mix-'));
  try {
    const video = path.join(dir, 'video.mp4'), sound = path.join(dir, 'mix.wav'), out = path.join(dir, 'out.mp4');
    run(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=5:d=6', '-an', '-c:v', 'mpeg4', video]);
    run(['-f', 'lavfi', '-i', 'aevalsrc=0.4*sin(440*2*PI*t)+if(lt(mod(t\\,1)\\,0.01)\\,2*sin(1800*2*PI*t)\\,0):s=48000:d=6', '-c:a', 'pcm_f32le', sound]);
    const original = fs.readFileSync(sound);
    assert.ok((await measureAudio(ffmpeg, sound)).peak > 0);
    const report = await muxNormalizedAudio(ffmpeg, video, sound, out);
    assert.ok(report.after.peak <= -1);
    assert.ok(Math.abs(report.after.integrated + 14) <= .5);
    assert.deepEqual(fs.readFileSync(sound), original);
    run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-af', 'volume=-70dB', '-c:a', 'pcm_f32le', sound]);
    const tiny = await muxNormalizedAudio(ffmpeg, video, sound, out);
    assert.ok(!tiny.silent && tiny.corrected && Math.abs(tiny.after.integrated + 14) <= .5, '非零声音低于门限仍由程序修复');
    run(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', '-c:a', 'aac', out]);
    const silent = await normalizeAudio(ffmpeg, out);
    assert.ok(silent.silent && !silent.corrected, '静音不能靠增益修复，不能伪造合格');
    await assert.rejects(normalizeAudio(ffmpeg, path.join(dir, 'missing.mp4')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
