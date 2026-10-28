import {spawn} from 'node:child_process';
import {processOwner, trackChildProcess, registerOwnedCancellation} from '../proc.ts';
import {exportDiagnostic} from './export-diagnostics.ts';

export type MotionFrameProducer = (push: (png: Buffer, index: number, frame: number) => Promise<void>, signal: AbortSignal) => Promise<void>;

/** Reorder at most one frame per Chrome worker. Resolving push releases that worker. */
export async function orderedMotionFrames(frames: number, produce: (push: (png: Buffer, frame: number) => Promise<void>) => Promise<unknown>,
  consume: (png: Buffer, frame: number) => Promise<void>, signal: AbortSignal) {
  let cursor = 0, flushing = false, failure: Error | undefined;
  let queuedBytes = 0, peakBytes = 0, peakFrames = 0;
  const pending = new Map<number, {png: Buffer; resolve: () => void; reject: (error: Error) => void}>();
  let rejectFailure!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => { rejectFailure = reject; });
  void failed.catch(() => {});
  const fail = (error: unknown) => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    rejectFailure(failure);
    for (const entry of pending.values()) entry.reject(failure);
    pending.clear();
  };
  const abort = () => fail(signal.reason || new Error('动效帧传输已取消'));
  signal.addEventListener('abort', abort, {once: true});
  if (signal.aborted) abort();
  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (!failure && pending.has(cursor)) {
        const entry = pending.get(cursor)!;
        await consume(entry.png, cursor);
        pending.delete(cursor++);
        queuedBytes -= entry.png.length;
        entry.resolve();
      }
    } catch (error) { fail(error); }
    finally { flushing = false; }
  };
  const push = (png: Buffer, frame: number) => new Promise<void>((resolve, reject) => {
    if (failure) return reject(failure);
    if (!Number.isInteger(frame) || frame < cursor || frame >= frames || pending.has(frame)) {
      const error = new Error(`无效动效帧 ${frame}`); fail(error); return reject(error);
    }
    pending.set(frame, {png, resolve, reject});
    queuedBytes += png.length; peakBytes = Math.max(peakBytes, queuedBytes); peakFrames = Math.max(peakFrames, pending.size);
    void flush();
  });
  try {
    await Promise.race([Promise.resolve().then(() => {if (failure) throw failure; return produce(push);}), failed]);
    if (cursor !== frames) throw new Error(`动效帧数不完整：${cursor}/${frames}`);
  } catch (error) { fail(error); throw error; }
  finally { signal.removeEventListener('abort', abort); exportDiagnostic('motion-frame-buffer', {frames: cursor, peakBytes, peakFrames}); }
}

/** Length-prefixed PNGs, never a transparent video or a frame directory on disk. */
export async function runMotionFramePipe(executable: string, args: string[], produce: MotionFrameProducer, options: {
  onStdout: (chunk: string) => void; stallTimeoutMs?: number;
}) {
  const child = spawn(executable, args, {stdio: ['pipe', 'pipe', 'pipe'],
    detached: processOwner.getStore() !== undefined && process.platform !== 'win32'});
  trackChildProcess(child);
  const controller = new AbortController();
  let stderr = '', bytes = 0, frames = 0, failure: Error | undefined;
  let rejectFailure!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => {rejectFailure = reject;});
  void failed.catch(() => {});
  const fail = (error: unknown) => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    controller.abort(failure); rejectFailure(failure); child.kill('SIGKILL');
  };
  const timer = setTimeout(() => fail(new Error('动效帧合成停止推进')), options.stallTimeoutMs ?? 120_000);
  const deadline = setTimeout(() => fail(new Error('动效帧合成超过一小时')), 3_600_000);
  const release = registerOwnedCancellation(() => fail(new Error('导出已取消')));
  child.stdin.on('error', fail);
  child.stdout.on('data', chunk => {try {timer.refresh(); options.onStdout(chunk.toString());} catch (error) {fail(error);}});
  child.stderr.on('data', chunk => {stderr = (stderr + chunk.toString()).slice(-32768);});
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', error => {fail(error); reject(error);});
    child.once('close', code => {
      if (code === 0 && child.stdin.writableEnded) resolve();
      else {const error = failure || new Error(`动效帧合成失败 (${code}): ${stderr}`); fail(error); reject(error);}
    });
  });
  void closed.catch(() => {});
  const write = (data: Buffer) => new Promise<void>((resolve, reject) => child.stdin.write(data, error => error ? reject(error) : resolve()));
  let producer: Promise<void> | undefined;
  try {
    producer = produce(async (png, index, frame) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (png.length > 256 * 1024 * 1024) throw new Error('动效帧超过传输上限');
      const header = Buffer.alloc(12);
      header.writeUInt32BE(index, 0); header.writeUInt32BE(frame, 4); header.writeUInt32BE(png.length, 8);
      await write(header); await write(png);
      frames++; bytes += png.length; timer.refresh();
    }, controller.signal);
    await Promise.race([producer, failed]);
    child.stdin.end();
    await Promise.race([closed, failed]);
  } catch (error) {
    fail(error); await closed.catch(() => {});
    // Producer observes abort and closes its browser before a compatibility retry.
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([producer?.catch(() => {}), new Promise<void>(resolve => {cleanupTimer = setTimeout(resolve, 2000);})]);
    clearTimeout(cleanupTimer);
    throw error;
  } finally {
    release(); clearTimeout(timer); clearTimeout(deadline);
    exportDiagnostic('motion-frame-pipe-end', {frames, bytes, intermediateVideoBytes: 0, error: failure?.message});
  }
}

/** Bounded look-ahead overlaps base rendering with card work, without creating disk assets. */
export function warmMotionFrames(source: MotionFrameProducer, budgetBytes = 64 * 1024 * 1024) {
  const controller = new AbortController();
  const queue: {png: Buffer; index: number; frame: number}[] = [];
  const waiters = new Set<() => void>();
  let bytes = 0, peakBytes = 0, peakFrames = 0, flushing = false, used = false;
  let consumer: Parameters<MotionFrameProducer>[0] | undefined;
  let work: Promise<void> | undefined;
  const wake = () => {for (const resolve of waiters) resolve(); waiters.clear();};
  const changed = () => new Promise<void>(resolve => {waiters.add(resolve);});
  const check = () => {if (controller.signal.aborted) throw controller.signal.reason;};
  const abort = () => {queue.length = 0; bytes = 0; wake();};
  controller.signal.addEventListener('abort', abort, {once: true});
  const flush = async () => {
    if (flushing || !consumer) return;
    flushing = true;
    try {
      while (queue.length) {
        check(); const entry = queue[0];
        await consumer(entry.png, entry.index, entry.frame);
        check(); queue.shift(); bytes -= entry.png.length; wake();
      }
    } catch (error) {controller.abort(error);}
    finally {flushing = false; wake();}
  };
  const warm = () => {
    if (!work) {
      work = Promise.resolve().then(() => {
        check();
        return source(async (png, index, frame) => {
          check();
          // A single oversized frame may exceed the byte target, never a growing duration.
          while (queue.length && (queue.length >= 256 || bytes + png.length > budgetBytes)) {await changed(); check();}
          queue.push({png, index, frame}); bytes += png.length;
          peakBytes = Math.max(peakBytes, bytes); peakFrames = Math.max(peakFrames, queue.length);
          void flush();
        }, controller.signal);
      });
      void work.catch(error => controller.abort(error));
    }
  };
  const close = async () => {
    controller.abort(new Error('动效帧预备已结束'));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([work?.catch(() => {}), new Promise<void>(resolve => {timer = setTimeout(resolve, 2000);})]);
    clearTimeout(timer); controller.signal.removeEventListener('abort', abort); release();
    exportDiagnostic('motion-lookahead-buffer', {peakBytes, peakFrames, budgetBytes});
  };
  const release = registerOwnedCancellation(() => {controller.abort(new Error('导出已取消'));});
  const produce: MotionFrameProducer = async (push, signal) => {
    if (used) throw new Error('动效帧流不能重复消费');
    used = true;
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, {once: true});
    try {
      if (signal.aborted) throw signal.reason;
      consumer = push; warm(); void flush(); await work;
      while (queue.length || flushing) {check(); await changed();}
      check();
    } finally {signal.removeEventListener('abort', cancel);}
  };
  return {warm, produce, close};
}
