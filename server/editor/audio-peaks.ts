import {cachePath as projectCachePath} from './cache-location.ts';
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { binary } from "./media-binary.ts";
import { findProject } from "./store.ts";

const PCM_RATE = 16_000;
const MAX_PEAK_BLOCKS = 24_000;
const PEAK_BLOCKS_PER_SECOND = 200;
const DECODE_TIMEOUT_MS = 120_000;

class PeakFolder {
  readonly peaks: Float32Array;
  private readonly samplesPerBlock: number;
  private sampleIndex = 0;
  private pendingLowByte: number | null = null;

  constructor(blocks: number, totalSamples: number) {
    this.peaks = new Float32Array(blocks * 2);
    this.samplesPerBlock = Math.max(1, totalSamples / blocks);
  }

  push(chunk: Buffer) {
    let offset = 0;
    if (this.pendingLowByte !== null && chunk.length > 0) {
      this.addSample((chunk[0] << 8) | this.pendingLowByte);
      this.pendingLowByte = null;
      offset = 1;
    }
    const end = chunk.length - ((chunk.length - offset) % 2);
    for (let index = offset; index < end; index += 2)
      this.addSample(chunk.readInt16LE(index));
    if (end < chunk.length) this.pendingLowByte = chunk[end];
  }

  private addSample(raw: number) {
    const signed = raw > 32_767 ? raw - 65_536 : raw;
    const value = signed / 32_768;
    const block = Math.min(
      this.peaks.length / 2 - 1,
      Math.floor(this.sampleIndex / this.samplesPerBlock),
    );
    const offset = block * 2;
    if (value < this.peaks[offset]) this.peaks[offset] = value;
    if (value > this.peaks[offset + 1]) this.peaks[offset + 1] = value;
    this.sampleIndex++;
  }
}

async function decodeAudioPeaks(input: string, durationSec: number) {
  const ffmpeg = binary("ffmpeg");
  if (!ffmpeg) throw new Error("宿主机未安装 ffmpeg，不能生成音频波形");
  const blocks = Math.min(
    MAX_PEAK_BLOCKS,
    Math.max(1, Math.ceil(durationSec * PEAK_BLOCKS_PER_SECOND)),
  );
  const folder = new PeakFolder(blocks, durationSec * PCM_RATE);
  const child = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-i", input,
    "-vn", "-ac", "1", "-ar", String(PCM_RATE), "-f", "s16le", "-",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  return new Promise<Float32Array>((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(folder.peaks);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("生成波形超时"));
    }, DECODE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => folder.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2_048);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code !== 0)
        finish(new Error(`素材没有可解码的音轨${stderr ? `：${stderr.trim()}` : ""}`));
      else finish();
    });
  });
}

export async function getProjectMediaAudioPeaks(
  projectId: string,
  assetId: string,
  requestedDuration?: number,
) {
  const { dir, project } = findProject(projectId);
  const asset = project.media.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error("素材不存在");
  if (asset.type !== "video" && asset.type !== "audio")
    throw new Error("该素材没有音轨");
  // Cache identity is the immutable source asset, not an individual timeline
  // clip. Always fold the complete source at one stable resolution; otherwise
  // the first trimmed clip to ask for peaks would poison the cache for every
  // later clip of the same asset.
  const duration = asset.duration || (
    Number.isFinite(requestedDuration) && Number(requestedDuration) > 0
      ? Number(requestedDuration)
      : 0
  );
  if (!duration) throw new Error("素材时长尚未探测完成");

  const cacheDir = projectCachePath(dir, "audio-peaks");
  const cachePath = path.join(cacheDir, `${asset.id}.f32`);
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath);

  const input = path.join(dir, asset.proxyFile || asset.originalFile);
  const peaks = await decodeAudioPeaks(input, duration);
  fs.mkdirSync(cacheDir, { recursive: true });
  const buffer = Buffer.from(peaks.buffer, peaks.byteOffset, peaks.byteLength);
  const temporary = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, buffer);
  fs.renameSync(temporary, cachePath);
  return buffer;
}
