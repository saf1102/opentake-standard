import test from 'node:test';
import assert from 'node:assert/strict';
import {videoExportCapabilities,assertVideoExportSupported} from '../shared/export-video.ts';
import {runVideoEncode,videoEncodeArgs} from './editor/video-encode.ts';
import {exportResolution,exportVideoFilter} from './editor/export-resolution.ts';
import {ExportSettingsSchema,type ExportVideoSettings} from '../src/types/editor.ts';
import {encodeExportMedia} from './general/export-media.ts';
import {encodeScreenExportMedia} from './editor/openscreen-encode.ts';
const canvas={width:1920,height:1080,fps:30};
const video=(encoder:ExportVideoSettings['encoder']='auto',quality:ExportVideoSettings['quality']='balanced'):ExportVideoSettings=>({codec:'h264',container:'mp4',quality,encoder});
const value=(args:string[],name:string)=>args[args.indexOf(name)+1];

test('Windows codec capabilities match backend rejection; macOS HEVC remains available',()=>{
  assert.deepEqual(videoExportCapabilities('win32').codecs,['h264','prores422']);
  assert.throws(()=>assertVideoExportSupported({codec:'h265'},'win32'),{message:videoExportCapabilities('win32').unavailable.h265,status:400});
  assert.ok(videoExportCapabilities('darwin').codecs.includes('h265'));
  assert.doesNotThrow(()=>assertVideoExportSupported({codec:'h265'},'darwin'));
});

test('unsupported HEVC is rejected before probing or opening any media', {skip:process.platform!=='win32'},async()=>{
  const settings=ExportSettingsSchema.parse({video:{codec:'h265'}});
  await assert.rejects(encodeExportMedia('does-not-exist','must-not-exist',settings),/Windows HEVC/);
  await assert.rejects(encodeScreenExportMedia('does-not-exist','must-not-exist',settings,30,1),/Windows HEVC/);
});

test('hardware and software select distinct Media Foundation implementations',()=>{
  assert.equal(value(videoEncodeArgs(video('hardware'),canvas,'win32'),'-hw_encoding'),'1');
  assert.equal(value(videoEncodeArgs(video('software'),canvas,'win32'),'-hw_encoding'),'0');
});

test('all software quality tiers use distinct budgets and scale for 4K and frame rate',()=>{
  for(const [quality,bitrate] of [['fast',6_000_000],['balanced',10_000_000],['high',18_000_000]] as const){
    assert.equal(Number(value(videoEncodeArgs(video('software',quality),canvas,'win32'),'-b:v')),bitrate);
    assert.equal(Number(value(videoEncodeArgs(video('software',quality),{width:3840,height:2160,fps:60},'win32'),'-b:v')),bitrate*8);
    assert.equal(Number(value(videoEncodeArgs(video('software',quality),{width:1080,height:1920,fps:30},'win32'),'-b:v')),bitrate);
  }
});

test('auto retries an unavailable hardware encoder once and records the actual implementation',async()=>{
  const modes:string[]=[];
  const result=await runVideoEncode(video(),canvas,async args=>{
    const mode=value(args,'-hw_encoding');modes.push(mode);
    if(mode==='1')throw Object.assign(Error('encode failed'),{stderr:'could not find any MFT for the given media type'});
    return {stderr:"MFT name: 'H264 Encoder MFT'"};
  },'win32');
  assert.deepEqual(modes,['1','0']);assert.equal(result.encoder,'software');
  assert.equal(result.implementation,'H264 Encoder MFT');assert.match(result.fallbackReason!,/软件/);
});

test('explicit hardware cannot silently fall back; auto does not retry disk errors or cancellation',async()=>{
  let calls=0;
  await assert.rejects(runVideoEncode(video('hardware'),canvas,async()=>{calls++;throw Error('could not create MFT');},'win32'),/请选择自动或软件/);
  assert.equal(calls,1);
  for(const error of [Error('No space left on device'),Object.assign(Error('MF_E_SHUTDOWN'),{name:'AbortError',code:'ABORT_ERR'})]){
    calls=0;await assert.rejects(runVideoEncode(video(),canvas,async()=>{calls++;throw error;},'win32'),e=>e===error);assert.equal(calls,1);
  }
});

test('original odd dimensions preserve pixels with at most one padding pixel per edge',()=>{
  for(const source of [{width:1281,height:721},{width:721,height:1281},{width:1920,height:1080},{width:1,height:1}]){
    const before={...source},size=exportResolution(source,'original');
    assert.equal(size.width%2,0);assert.equal(size.height%2,0);
    assert.ok(size.width>=source.width&&size.width<=source.width+1);assert.ok(size.height>=source.height&&size.height<=source.height+1);
    assert.match(exportVideoFilter(source,'original'),/^pad=/);assert.doesNotMatch(exportVideoFilter(source,'original'),/scale=/);
    assert.deepEqual(source,before);
  }
  assert.deepEqual(exportResolution({width:1281,height:721},'original'),{width:1282,height:722});
  assert.deepEqual(exportResolution({width:3840,height:2160},'1080p'),{width:1920,height:1080});
  assert.throws(()=>exportResolution({width:0,height:720},'original'),/尺寸无效/);
});
