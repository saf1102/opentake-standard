import path from 'node:path';
import {gzipSync} from 'node:zlib';

// Full Chrome requires macOS app services denied by the offline agent sandbox.
// Leave executablePath unset to use Playwright's installed headless shell.
export function sampleBrowser(env) {
  return env.CW_HFX_CHROME || (/headless[-_]shell/i.test(path.basename(env.CW_CHROME || '')) ? env.CW_CHROME : undefined);
}

export function sampleResponse(original, originalHeaders, url, cache = new Map()) {
  let body = original;
  const headers = {...originalHeaders};
  // CDP base64 has a 100 MiB pipe message cap. Compress large responses losslessly
  // without opening a port or granting network access; reserve protocol headroom.
  if (body.length > 16 * 1024 * 1024) {
    if (!cache.has(url)) cache.set(url, gzipSync(body));
    body = cache.get(url);
    headers['content-encoding'] = 'gzip';
  }
  if (body.length > 64 * 1024 * 1024) throw Error(`样张资源压缩后仍超过 64 MiB：${new URL(url).pathname}。请使用较小的网页资源。`);
  headers['content-length'] = String(body.length);
  return {body, headers};
}
