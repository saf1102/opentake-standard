import test from 'node:test';import assert from 'node:assert/strict';
import {h264Encode} from './editor/video-encode.ts';
test('Windows H264 uses Media Foundation without Apple or x264 flags',()=>{
 const args=h264Encode({fps:24,bitrate:'8M'},'win32');
 assert.deepEqual(args,['-c:v','h264_mf','-b:v','8M','-g','48','-pix_fmt','nv12']);
 assert.ok(!args.some(arg=>/videotoolbox|x264|allow_sw/.test(arg)));
});
test('Mac encoder arguments retain the existing contract',()=>{
 assert.deepEqual(h264Encode({fps:30,quality:70,allowSoftware:true},'darwin'),['-c:v','h264_videotoolbox','-q:v','70','-g','60','-allow_sw','1','-profile:v','high','-pix_fmt','yuv420p']);
});
