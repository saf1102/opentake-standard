// Where the separate sounds are in a stretch of audio (S先生 10-31: 音效一段一段). One file may hold several effects
// mixed onto one strip (锣、鼓、风); the quiet between them splits it. Used by `hfx check` (a strip that is really
// several effects has to be delivered as separate clips) and by the editor's 按声音切开 for films made before that.
import { execFile } from 'node:child_process';

export const BURST_RATE = 8000;
/** A sound-effect clip longer than this holding at least MIXED_SOUNDS sounds is several effects on one strip. */
export const MIXED_SECONDS = 3;
export const MIXED_SOUNDS = 3;
const WINDOW = 0.01;

/**
 * The sounds in mono samples (Int16Array or numbers in −1…1 scaled by `scale`): runs of 10 ms windows louder than
 * `floorDb`, joined across quiet shorter than `gap`, each widened by `lead` before and `tail` after (an effect's
 * attack and decay sit under the floor). Seconds from the start of the samples.
 */
export function bursts(samples, rate = BURST_RATE, { floorDb = -50, gap = 0.25, lead = 0.02, tail = 0.12, shortest = 0.04, scale = 32768 } = {}) {
  const step = Math.max(1, Math.round(rate * WINDOW)), floor = 10 ** (floorDb / 20) * scale, out = [];
  let on = -1, last = -1;
  for (let i = 0; i < samples.length; i += step) {
    let sum = 0;
    const end = Math.min(samples.length, i + step);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    const loud = Math.sqrt(sum / (end - i)) >= floor, t = i / rate;
    if (loud) {
      if (on < 0) on = t;
      else if (t - last > gap) { out.push([on, last + WINDOW]); on = t; }
      last = t;
    }
  }
  if (on >= 0) out.push([on, last + WINDOW]);
  const length = samples.length / rate;
  return out.filter(([a, b]) => b - a >= shortest).map(([a, b], i, all) => ({
    // widened, but never into the next sound
    start: Math.max(0, i ? Math.max(all[i - 1][1], a - lead) : a - lead),
    end: Math.min(length, i < all.length - 1 ? Math.min(all[i + 1][0], b + tail) : b + tail),
  })).map(({ start, end }) => ({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 }));
}

/** `duration` seconds of `file` from `from`, as 8 kHz mono 16-bit samples. */
export function decodeMono(ffmpeg, file, from = 0, duration) {
  const args = ['-v', 'error', '-ss', String(Math.max(0, from)), ...(duration > 0 ? ['-t', String(duration)] : []), '-i', file, '-vn', '-ac', '1', '-ar', String(BURST_RATE), '-f', 's16le', '-'];
  return new Promise((resolve, reject) => execFile(ffmpeg, args, { encoding: 'buffer', maxBuffer: 256 << 20 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2)));
  }));
}

/** The sounds in `duration` seconds of `file` from `from`; seconds from `from`. */
export async function soundBursts(ffmpeg, file, from = 0, duration, options) {
  return bursts(await decodeMono(ffmpeg, file, from, duration), BURST_RATE, options);
}
