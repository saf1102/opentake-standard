import {ffmpegPath} from '../general/kit-env.ts';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';

type Stream = {
  child: ChildProcessWithoutNullStreams;
  iterator: AsyncIterator<Buffer>;
  buffer: Buffer;
  next: number;
  cache: Map<number, Buffer>;
  error: string;
};

/** A bounded sequential decoder per source/fps. Serialize seeks, including rewind,
 * so concurrent pages cannot replace a stream another request is consuming. */
export class VideoFrames {
  private streams = new Map<string, Stream>();
  private queues = new Map<string, Promise<unknown>>();
  private generation = 0;

  private stop(stream: Stream) {
    // FFmpeg can block writing to a full pipe and ignore SIGTERM until it drains.
    stream.child.stdout.destroy();
    stream.child.stdin.destroy();
    stream.child.kill('SIGKILL');
  }

  private start(src: string, fps: number): Stream {
    const child = spawn(ffmpegPath(), [
      '-v', 'error', '-nostdin', '-i', src, '-an', '-vf', `fps=${fps}`,
      '-sws_flags', 'neighbor+accurate_rnd', '-f', 'image2pipe',
      '-c:v', 'png', '-pix_fmt', 'rgba', '-threads', '1', 'pipe:1',
    ]);
    const stream: Stream = {child, iterator: child.stdout[Symbol.asyncIterator](),
      buffer: Buffer.alloc(0), next: 0, cache: new Map(), error: ''};
    child.stderr.on('data', b => {stream.error = (stream.error + b.toString()).slice(-4000);});
    child.on('error', error => {stream.error = error.message;});
    return stream;
  }

  get(src: string, frame: number, fps: number): Promise<Buffer> {
    if (!src || !Number.isInteger(frame) || frame < 0 || !Number.isFinite(fps) || fps <= 0)
      return Promise.reject(new Error('Invalid video frame request'));
    const key = src + '\0' + fps, generation = this.generation;
    const work = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      if (generation !== this.generation) throw Error('Video decoder closed');
      let stream = this.streams.get(key);
      if (stream && frame < stream.next && !stream.cache.has(frame)) {
        this.stop(stream); this.streams.delete(key); stream = undefined;
      }
      if (!stream) {stream = this.start(src, fps); this.streams.set(key, stream);}
      const cached = stream.cache.get(frame);
      if (cached) return cached;
      while (stream.next <= frame) {
        let end = 0;
        for (;;) {
          if (stream.buffer.length >= 8) {
            let position = 8;
            while (position + 12 <= stream.buffer.length) {
              const length = stream.buffer.readUInt32BE(position);
              if (position + 12 + length > stream.buffer.length) break;
              if (stream.buffer.toString('ascii', position + 4, position + 8) === 'IEND') {
                end = position + 12 + length; break;
              }
              position += 12 + length;
            }
          }
          if (end) break;
          const chunk = await stream.iterator.next();
          if (chunk.done) throw Error('Video decode ended before requested frame: ' + stream.error);
          stream.buffer = Buffer.concat([stream.buffer, chunk.value]);
        }
        const image = stream.buffer.subarray(0, end);
        stream.buffer = stream.buffer.subarray(end);
        stream.cache.set(stream.next++, image);
        while (stream.cache.size > 12) stream.cache.delete(stream.cache.keys().next().value!);
      }
      return stream.cache.get(frame)!;
    });
    this.queues.set(key, work.catch(() => undefined));
    return work;
  }

  close() {
    this.generation++;
    for (const stream of this.streams.values()) this.stop(stream);
    this.streams.clear(); this.queues.clear();
  }
}
