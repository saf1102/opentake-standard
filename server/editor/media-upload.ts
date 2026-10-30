import fs from 'node:fs';
import path from 'node:path';
import {Transform, type Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

/** Uploads must work in imported projects that have never created a local media directory. */
export async function uploadMediaStream(req: Readable, destination: string): Promise<number> {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  const temporary = `${destination}.upload`;
  let size = 0, ownsTemporary = false;
  const output = fs.createWriteStream(temporary, {flags: 'wx'});
  output.once('open', () => { ownsTemporary = true; });
  const count = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(size > 20 * 1024 ** 3 ? new Error('单文件不能超过 20GB') : null, chunk);
    },
  });
  try {
    await pipeline(req, count, output);
    // pipeline has finished and closed the output before promotion. A rename
    // failure rejects this promise instead of escaping an event callback.
    fs.renameSync(temporary, destination);
    return size;
  } catch (error) {
    // A failed exclusive open does not own another upload's temporary file.
    if (ownsTemporary) fs.rmSync(temporary, {force: true});
    throw error;
  }
}
