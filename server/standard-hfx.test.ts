import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
// @ts-ignore JavaScript tool shared with the agent CLI.
import {sampleBrowser, sampleResponse, sampleFontWoff, sampleFontStatus} from './general/kit/hfx-support.mjs';
import {prepareWork} from './general/kit-env.ts';

test('sample browser avoids full Chrome but preserves explicit headless overrides', () => {
  assert.equal(sampleBrowser({CW_CHROME:'/Applications/Chrome.app/Contents/MacOS/Chrome'}), undefined);
  assert.equal(sampleBrowser({CW_CHROME:'/runtime/chrome-headless-shell'}), '/runtime/chrome-headless-shell');
  assert.equal(sampleBrowser({CW_HFX_CHROME:'/custom/shell',CW_CHROME:'/full/Chrome'}), '/custom/shell');
});
test('large TTC font delivery preserves every first-face table without HTTP gzip', () => {
  const raw = Buffer.alloc(17 * 1024 * 1024, 42);
  // Two-face collection, first face points at one table. WOFF excludes only the
  // other face, as an unindexed CSS TTC does, and retains first-face bytes.
  const ttc = Buffer.alloc(48 + raw.length);
  ttc.write('ttcf'); ttc.writeUInt32BE(0x10000,4); ttc.writeUInt32BE(2,8);
  ttc.writeUInt32BE(20,12); ttc.writeUInt32BE(20,16);
  ttc.writeUInt32BE(0x10000,20); ttc.writeUInt16BE(1,24);
  ttc.write('test',32); ttc.writeUInt32BE(1234,36); ttc.writeUInt32BE(48,40); ttc.writeUInt32BE(raw.length,44); raw.copy(ttc,48);
  const response = sampleResponse(ttc, {'content-type':'font/collection'}, 'http://hf.localhost/font.ttc');
  const woff = response.body, offset=woff.readUInt32BE(48), length=woff.readUInt32BE(52);
  assert.equal(woff.toString('ascii',0,4),'wOFF');
  assert.equal(woff.readUInt32BE(60),1234);
  assert.deepEqual(inflateSync(woff.subarray(offset,offset+length)),raw);
  assert.equal(response.headers['content-type'],'font/woff');
  assert.equal(response.headers['content-encoding'],undefined);
  assert.equal(Number(response.headers['content-length']),woff.length);
});
test('small assets retain original bytes and oversized non-font resources fail', () => {
  const small=Buffer.from('中文页面');
  assert.equal(sampleResponse(small,{},'http://hf.localhost/index.html').body,small);
  assert.throws(()=>sampleResponse(Buffer.alloc(64*1024*1024+1),{},'http://hf.localhost/huge.bin'),/超过 64 MiB/);
  assert.throws(()=>sampleFontWoff(Buffer.alloc(20)),/有效/);
  const malformed=Buffer.alloc(16);malformed.write('ttcf');malformed.writeUInt32BE(1,8);malformed.writeUInt32BE(0xffffffff,12);
  assert.throws(()=>sampleFontWoff(malformed),/有效/);
});
test('sample fails for rejected fonts rather than reporting fallback text as success', async () => {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  try {
    const fonts=Object.assign([{family:'BoardKai',status:'error'}],{ready:Promise.resolve()});
    Object.defineProperty(globalThis,'document',{value:{fonts},configurable:true});
    await assert.rejects(sampleFontStatus(),/BoardKai.*回退字体/);
    fonts[0].status='loaded';
    assert.deepEqual(await sampleFontStatus(),[{family:'BoardKai',status:'loaded'}]);
  } finally {
    if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');
  }
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
