import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {ExportSettings} from '../../src/types/editor.ts';
import {videoEncodeArgs} from './video-encode.ts';
import {exportResolution} from './export-resolution.ts';
import {probeExportMedia} from '../general/export-media.ts';
import {ffmpegPath} from '../general/kit-env.ts';
const exec=promisify(execFile);

/** 原生逐帧渲染之后固定输出时钟；不改变通用剪辑的编码路径。 */
export function screenClockArguments(fps:number,duration:number) {
  if(!Number.isFinite(fps)||fps<=0||fps>240||!Number.isFinite(duration)||duration<=0)throw Error('录屏导出时钟无效');
  return ['-r',String(fps),'-fps_mode','cfr','-frames:v',String(Math.max(1,Math.round(duration*fps))),'-t',String(duration)];
}
export async function encodeScreenExportMedia(source:string,target:string,settings:ExportSettings,fps:number,duration:number,signal?:AbortSignal) {
  const clock=screenClockArguments(fps,duration);
  const media=await probeExportMedia(source),size=exportResolution(media,settings.resolution);
  await exec(ffmpegPath(),['-hide_banner','-v','error','-y','-i',source,'-map','0:v:0','-map','0:a?',
    '-vf',`scale=${size.width}:${size.height}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${1+1/fps},fps=${fps}:start_time=0:round=near`,
    ...videoEncodeArgs(settings.video,{...size,fps}),...clock,
    '-c:a',settings.video.codec==='prores422'?'pcm_s16le':'aac',
    ...(settings.video.codec==='prores422'?[]:['-b:a','192k']),'-movflags','+faststart',target],
    {maxBuffer:8<<20,timeout:3600000,signal});
  return probeExportMedia(target);
}
