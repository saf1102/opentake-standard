import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {ExportSettings} from '../../src/types/editor.ts';
import {videoEncodeArgs} from '../editor/video-encode.ts';
import {exportResolution} from '../editor/export-resolution.ts';
import {ffmpegPath,ffprobePath} from './kit-env.ts';
const exec=promisify(execFile);
export async function probeExportMedia(file:string) {
 const {stdout}=await exec(ffprobePath(),['-v','error','-show_streams','-show_format','-of','json',file]);
 const data=JSON.parse(stdout);const v=data.streams.find((s:{codec_type:string})=>s.codec_type==='video');
 if(!v)throw Error('版本没有视频画面');
 const [n,d]=String(v.avg_frame_rate||v.r_frame_rate).split('/').map(Number);
 return {width:Number(v.width),height:Number(v.height),fps:n/(d||1),duration:Number(data.format.duration),audio:data.streams.some((s:{codec_type:string})=>s.codec_type==='audio')};
}
/** Encode only after the renderer has sampled animations at the requested frame clock. */
export async function encodeExportMedia(source:string,target:string,settings:ExportSettings,signal?:AbortSignal) {
 const media=await probeExportMedia(source),size=exportResolution(media,settings.resolution);
 const fps=typeof settings.fps==='number'?settings.fps:media.fps;
 await exec(ffmpegPath(),['-hide_banner','-v','error','-y','-i',source,'-map','0:v:0','-map','0:a?',
  '-vf',`scale=${size.width}:${size.height}:flags=lanczos`,...videoEncodeArgs(settings.video,{...size,fps}),
  '-r',String(fps),'-c:a',settings.video.codec==='prores422'?'pcm_s16le':'aac',
  ...(settings.video.codec==='prores422'?[]:['-b:a','192k']),'-movflags','+faststart',target],{maxBuffer:8<<20,timeout:3600000,signal});
 return probeExportMedia(target);
}
