import test from 'node:test';
import assert from 'node:assert/strict';
import {macVideoEncodingError,runVideoEncode,videoEncodeArgs} from './editor/video-encode.ts';
import type {ExportVideoSettings} from '../src/types/editor.ts';
const canvas={width:1280,height:720,fps:30};
const video=(codec:ExportVideoSettings['codec'],encoder:ExportVideoSettings['encoder']='auto'):ExportVideoSettings=>({codec,encoder,container:codec==='prores422'?'mov':'mp4',quality:'balanced'});

test('Intel HEVC encoder unavailable reports a useful alternative without silently changing output',async()=>{
  const original=Object.assign(Error('ffmpeg failed'),{stderr:'[hevc_videotoolbox @ 0x1] Error: cannot create compression session: -12908\nThe hardware encoder may be busy, or not supported. Try -allow_sw 1.'});
  for(const encoder of ['auto','hardware','software'] as const){
    let calls=0;
    await assert.rejects(runVideoEncode(video('h265',encoder),canvas,async args=>{calls++;assert.equal(args[1],'hevc_videotoolbox');throw original;},'darwin'),error=>{
      assert.ok(error instanceof Error);assert.equal(error.cause,original);
      assert.match(error.message,/HEVC.*VideoToolbox/);assert.match(error.message,/改选 H.264/);assert.match(error.message,/ProRes（软件编码/);return true;
    });
    assert.equal(calls,1);
  }
});

test('ProRes remains a software encoder; H264/HEVC software mode retains Apple software permission',async()=>{
  for(const encoder of ['auto','hardware','software'] as const){
    const args=videoEncodeArgs(video('prores422',encoder),canvas,'darwin');assert.equal(args[1],'prores_ks');
    const result=await runVideoEncode(video('prores422',encoder),canvas,async()=>({}),'darwin');assert.equal(result.encoder,'software');
  }
  for(const codec of ['h264','h265'] as const){const args=videoEncodeArgs(video(codec,'software'),canvas,'darwin');assert.equal(args[args.indexOf('-allow_sw')+1],'1');}
});

test('missing FFmpeg encoders explain tool remediation, not missing Intel hardware',()=>{
  for(const codec of ['h264_videotoolbox','hevc_videotoolbox','prores_ks']){
    const failure=macVideoEncodingError(Error(`Unknown encoder '${codec}'`),'darwin');
    assert.ok(failure instanceof Error);assert.match(failure.message,/FFmpeg 缺少/);assert.match(failure.message,/npm run doctor/);
  }
});

test('H264 delivery reports system capability; cancellation, unrelated failures and Windows retain original errors',()=>{
  const vt=Error('[h264_videotoolbox @ 0x1] Error: cannot create compression session: -12908');
  assert.match((macVideoEncodingError(vt,'darwin') as Error).message,/H.264 VideoToolbox/);
  assert.equal(macVideoEncodingError(vt,'win32'),vt);
  for(const failure of [Error('No space left on device'),Error('Error while opening encoder'),Error('[h264_videotoolbox] Permission denied'),Object.assign(Error(vt.message),{name:'AbortError',code:'ABORT_ERR'})])assert.equal(macVideoEncodingError(failure,'darwin'),failure);
});
