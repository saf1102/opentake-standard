import path from 'node:path';
import {deflateSync} from 'node:zlib';

// Full Chrome requires macOS app services denied by the offline agent sandbox.
// Leave executablePath unset to use Playwright's installed headless shell.
export function sampleBrowser(env) {
  return env.CW_HFX_CHROME || (/headless[-_]shell/i.test(path.basename(env.CW_CHROME || '')) ? env.CW_CHROME : undefined);
}

/** Repackage the same sfnt tables as WOFF 1 (lossless, no glyph subsetting).
 * CSS webfonts use the first face of an unindexed TTC. Keep every table of that
 * face, including its names, outlines and metrics; never modify the source file.
 * Unlike HTTP gzip, WOFF is decoded by Chromium's font loader even when the
 * resource is supplied by CDP Fetch.fulfillRequest rather than an HTTP server.
 */
export function sampleFontWoff(original) {
  const fail = () => { throw Error('样张字体不是有效的 TrueType/OpenType 字体'); };
  if (original.length < 12) fail();
  const collection = original.toString('ascii', 0, 4) === 'ttcf';
  if (collection && (original.length < 16 || original.readUInt32BE(8) < 1)) fail();
  const base = collection ? original.readUInt32BE(12) : 0;
  if (base + 12 > original.length) fail();
  const flavor = original.readUInt32BE(base);
  if (flavor !== 0x00010000 && flavor !== 0x4f54544f && flavor !== 0x74727565) fail();
  const count = original.readUInt16BE(base + 4);
  if (!count || count > 4095 || base + 12 + 16 * count > original.length) fail();
  const align = n => Math.ceil(n / 4) * 4;
  const tables = [], tags = new Set();
  let offset = 44 + 20 * count, totalSfnt = 12 + 16 * count;
  for (let i = 0; i < count; i++) {
    const p = base + 12 + 16 * i, tag = original.subarray(p, p + 4);
    const checksum = original.readUInt32BE(p + 4), start = original.readUInt32BE(p + 8), length = original.readUInt32BE(p + 12);
    if (start + length > original.length || tags.has(tag.toString('hex'))) fail();
    tags.add(tag.toString('hex'));
    const raw = original.subarray(start, start + length), compressed = deflateSync(raw);
    const data = compressed.length < raw.length ? compressed : raw;
    tables.push({tag, checksum, length, data, offset});
    offset += align(data.length); totalSfnt += align(length);
  }
  const out = Buffer.alloc(offset);
  out.write('wOFF'); out.writeUInt32BE(flavor, 4); out.writeUInt32BE(offset, 8);
  out.writeUInt16BE(count, 12); out.writeUInt32BE(totalSfnt, 16); out.writeUInt16BE(1, 20);
  tables.forEach((t, i) => {
    const p = 44 + 20 * i; t.tag.copy(out, p);
    out.writeUInt32BE(t.offset, p + 4); out.writeUInt32BE(t.data.length, p + 8);
    out.writeUInt32BE(t.length, p + 12); out.writeUInt32BE(t.checksum, p + 16);
    t.data.copy(out, t.offset);
  });
  return out;
}

export function sampleResponse(original, originalHeaders, url, cache = new Map()) {
  let body = original;
  const headers = {...originalHeaders};
  // CDP's base64 message cap is 100 MiB. Reserve protocol headroom. Do not send
  // HTTP gzip: route.fulfill gives those bytes directly to the font decoder,
  // which rejects the gzip header and silently falls back to another font.
  if (body.length > 16 * 1024 * 1024 && /\.(ttc|ttf|otf)$/i.test(new URL(url).pathname)) {
    if (!cache.has(url)) cache.set(url, sampleFontWoff(body));
    body = cache.get(url);
    headers['content-type'] = 'font/woff';
  }
  if (body.length > 64 * 1024 * 1024) throw Error(`样张资源仍超过 64 MiB：${new URL(url).pathname}。请报告此资源，不能用缺失素材的样张代替。`);
  delete headers['content-encoding'];
  headers['content-length'] = String(body.length);
  return {body, headers};
}

/** Runs in the rendering page after every seek, including newly mounted scenes. */
export async function sampleFontStatus() {
  await document.fonts.ready;
  const fonts = Array.from(document.fonts, font => ({family: font.family, status: font.status}));
  const failed = fonts.filter(font => font.status === 'error');
  if (failed.length) throw Error(`样张字体加载失败：${[...new Set(failed.map(font => font.family))].join('、')}；不能使用回退字体冒充成功。`);
  return fonts;
}
