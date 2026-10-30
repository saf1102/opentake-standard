import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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

// 默认跟产品选中的工具；复审/CI 可传 JSON 数组，在同一次测试中覆盖多个 FFmpeg。
const matrix: string[] = process.env.OPENTAKE_AUDIO_TEST_FFMPEGS ? JSON.parse(process.env.OPENTAKE_AUDIO_TEST_FFMPEGS) : [ffmpeg];
assert.ok(Array.isArray(matrix) && matrix.length && matrix.every(bin => typeof bin === 'string' && bin), 'FFmpeg 测试矩阵须为非空路径数组');
for (const [index, bin] of matrix.entries()) {
  for (const fixture of ['现场音乐与提示音', '高真峰值合成音']) {
    test(`AAC 最终实测达标：${fixture}，FFmpeg ${index + 1}`, async t => {
      const evidence = process.env.OPENTAKE_AUDIO_TEST_EVIDENCE_DIR;
      const dir = evidence
        ? fs.mkdtempSync(path.join(evidence, `audio-${index}-${fixture === '现场音乐与提示音' ? 'real' : 'spike'}-`))
        : fs.mkdtempSync(path.join(os.tmpdir(), 'task19-audio-'));
      const invoke = (args: string[]) => execFileSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 32 << 20 });
      const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
      try {
        const video = path.join(dir, 'video.mp4'), sound = path.join(dir, 'mix.wav'), out = path.join(dir, 'out.mp4');
        invoke(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=5:d=15', '-an', '-c:v', 'mpeg4', video]);
        if (fixture === '现场音乐与提示音') {
          const root = new URL('./fixtures/audio-task19/', import.meta.url);
          const provenance = JSON.parse(fs.readFileSync(new URL('provenance.json', root), 'utf8'));
          const inputs: string[] = [];
          for (const source of provenance.files) {
            const file = fileURLToPath(new URL(source.file, root));
            assert.equal(hash(fs.readFileSync(file)), source.sha256);
            assert.equal(hash(invoke(['-i', file, '-f', 's16le', '-'])), source.decodedPcmSha256, '现场 WAV 无损转换，采样不变');
            inputs.push('-i', file);
          }
          invoke([...inputs, '-filter_complex', '[0:a]atrim=start=0:duration=15,asetpts=PTS-STARTPTS,volume=1,adelay=0|0,aresample=48000[a0];[1:a]atrim=start=0:duration=15,asetpts=PTS-STARTPTS,volume=1,adelay=0|0,aresample=48000[a1];[a0][a1]amix=inputs=2:normalize=0:duration=longest,apad,atrim=duration=15[mix]', '-map', '[mix]', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_f32le', sound]);
        } else {
          // 18 kHz、0.5 ms 的尖峰高于 0 dBFS，覆盖普通正弦音无法发现的过冲。
          invoke(['-f', 'lavfi', '-i', 'aevalsrc=0.08*sin(440*2*PI*t)+if(lt(mod(t\\,0.5)\\,0.0005)\\,4*sin(18000*2*PI*t)\\,0):s=48000:d=15', '-ac', '2', '-c:a', 'pcm_f32le', sound]);
          assert.ok((await measureAudio(bin, sound)).peak > 6);
        }
        const original = hash(fs.readFileSync(sound));
        const report = await muxNormalizedAudio(bin, video, sound, out);
        const after = await measureAudio(bin, out);
        assert.deepEqual(after, report.after, '以最终 AAC 解码实测为准');
        assert.ok(Math.abs(after.integrated + 14) <= .5, JSON.stringify(report));
        assert.ok(after.peak <= -1, JSON.stringify(report));
        assert.equal(hash(fs.readFileSync(sound)), original, '不修改源混音');
        assert.deepEqual(invoke(['-i', out, '-map', '0:v', '-f', 'framemd5', '-']), invoke(['-i', video, '-map', '0:v', '-f', 'framemd5', '-']), '不修改画面');
        const samples = invoke(['-i', out, '-vn', '-f', 'f32le', '-']);
        assert.ok(Math.abs(samples.length / (4 * 2 * 48000) - 15) < .03, '限幅与编码不截断音轨或追加 lookahead 延迟');
        const delivered = hash(fs.readFileSync(out));
        assert.equal((await normalizeAudio(bin, out)).corrected, false, '复查不重复有损编码');
        assert.equal(hash(fs.readFileSync(out)), delivered);
        // 既有失败成片也经过同一修正入口；它没有源混音可用。
        const old = path.join(dir, 'old.mp4');
        invoke(['-i', video, '-i', sound, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'aformat=channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11:linear=false,aresample=48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', '-shortest', old]);
        const repair = await normalizeAudio(bin, old);
        assert.ok(Math.abs(repair.after.integrated + 14) <= .5 && repair.after.peak <= -1, JSON.stringify(repair));
        const record = { fixture, ffmpeg: bin, version: execFileSync(bin, ['-version'], { encoding: 'utf8' }).split('\n')[0], sourceSha256: original, report, repair, outputSha256: delivered };
        fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(record, null, 2));
        t.diagnostic(JSON.stringify(record));
      } finally { if (!evidence) fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }
}
