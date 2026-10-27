import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
// @ts-ignore JavaScript tool shared with the agent CLI.
import {sampleBrowser, sampleResponse} from './general/kit/hfx-support.mjs';
import {prepareWork} from './general/kit-env.ts';

test('sample browser avoids full Chrome but preserves explicit headless overrides', () => {
  assert.equal(sampleBrowser({CW_CHROME:'/Applications/Chrome.app/Contents/MacOS/Chrome'}), undefined);
  assert.equal(sampleBrowser({CW_CHROME:'/runtime/chrome-headless-shell'}), '/runtime/chrome-headless-shell');
  assert.equal(sampleBrowser({CW_HFX_CHROME:'/custom/shell',CW_CHROME:'/full/Chrome'}), '/custom/shell');
});
test('large sample assets are lossless gzip, small assets retain original bytes', () => {
  const small = Buffer.from('中文页面');
  const a = sampleResponse(small, {'content-type':'text/html'}, 'http://hf.localhost/index.html');
  assert.equal(a.body, small);
  assert.equal(a.headers['content-encoding'], undefined);
  const large = Buffer.alloc(17 * 1024 * 1024, '字体');
  const b = sampleResponse(large, {'content-type':'font/collection'}, 'http://hf.localhost/font.ttc');
  assert.deepEqual(gunzipSync(b.body), large);
  assert.equal(b.headers['content-type'], 'font/collection');
  assert.equal(b.headers['content-encoding'], 'gzip');
  assert.equal(Number(b.headers['content-length']), b.body.length);
});
test('oversized compressed resources fail before CDP transfer', () => {
  const url = 'http://hf.localhost/oversized.bin';
  const cache = new Map([[url, Buffer.alloc(64 * 1024 * 1024 + 1)]]);
  assert.throws(() => sampleResponse(Buffer.alloc(17 * 1024 * 1024), {}, url, cache), /超过 64 MiB/);
});
test('prepareWork restores executable bits stripped by ZIP even for unchanged wrappers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfx-wrapper-'));
  const names = ['LINKREADER_BIN_DIR','LINKREADER_PYTHON','CW_CHROME'];
  const previous = names.map(name => process.env[name]);
  try {
    for (const name of ['ffmpeg','ffprobe']) fs.writeFileSync(path.join(dir,name), '#!/bin/sh\nexit 0\n', {mode:0o755});
    process.env.LINKREADER_BIN_DIR=dir; process.env.LINKREADER_PYTHON=process.execPath; process.env.CW_CHROME=process.execPath;
    prepareWork(dir, {}, false);
    const wrapper=path.join(dir,'work/.opentake/bin/hfx');
    const content=fs.readFileSync(wrapper,'utf8');
    fs.chmodSync(wrapper,0o644);
    prepareWork(dir, {}, false);
    assert.equal(fs.readFileSync(wrapper,'utf8'),content);
    fs.accessSync(wrapper,fs.constants.X_OK);
  } finally {
    names.forEach((name,i)=>{if(previous[i]===undefined) delete process.env[name]; else process.env[name]=previous[i];});
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
