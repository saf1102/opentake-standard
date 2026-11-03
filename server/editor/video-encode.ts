import type {ExportVideoSettings} from '../../src/types/editor.ts';
import {assertVideoExportSupported} from '../../shared/export-video.ts';
export type VideoToolboxOptions={fps?:number;quality?:number;bitrate?:number|string;proxy?:boolean;allowSoftware?:boolean;fast?:boolean;tenBit?:boolean;encoder?:ExportVideoSettings['encoder']};
function common(o:VideoToolboxOptions){
 const rate=o.bitrate===undefined?['-q:v',String(o.quality??65)]:['-b:v',String(o.bitrate),...(!o.proxy?['-maxrate',String(o.bitrate),'-bufsize',typeof o.bitrate==='number'?String(o.bitrate*2):o.bitrate]:[])];
 return [...rate,...(o.proxy?[]:['-g',String(Math.max(1,Math.round((o.fps??30)*2)))]),...(o.allowSoftware?['-allow_sw','1']:[]),...(o.fast?['-prio_speed','1']:[])];
}
/** Final video has a two-second GOP; seek proxies deliberately retain VT's dense default. */
export function h264Encode(o:VideoToolboxOptions={},platform:NodeJS.Platform=process.platform){if(platform==='win32')return ['-c:v','h264_mf',...(o.encoder&&o.encoder!=='auto'?['-hw_encoding',o.encoder==='hardware'?'1':'0']:[]),'-b:v',String(o.bitrate??(o.proxy?'4M':'12M')),'-g',String(Math.max(1,Math.round((o.fps??30)*2))),'-pix_fmt','nv12'];return ['-c:v','h264_videotoolbox',...common(o),'-profile:v','high','-pix_fmt','yuv420p'];}
export function hevcEncode(o:VideoToolboxOptions={},platform:NodeJS.Platform=process.platform){assertVideoExportSupported({codec:'h265'},platform);return ['-c:v','hevc_videotoolbox',...common(o),'-tag:v','hvc1','-profile:v',o.tenBit?'main10':'main','-pix_fmt',o.tenBit?'p010le':'yuv420p'];}

export type EncodeCanvas = {width:number; height:number; fps?:number};
/** Scale the bitrate with output pixels and frame rate, including portrait video. */
export function videoBitrate(video: ExportVideoSettings, canvas: EncodeCanvas = {width:1920,height:1080}) {
  const base = video.quality === 'fast' ? 6_000_000 : video.quality === 'balanced' ? 10_000_000 : 18_000_000;
  return Math.round(base * Math.max(0.5, canvas.width * canvas.height / (1920 * 1080)) * Math.max(1, (canvas.fps ?? 30) / 30));
}
export function videoEncodeArgs(video: ExportVideoSettings, canvas?: EncodeCanvas, platform:NodeJS.Platform=process.platform) {
  if (video.codec === "prores422")
    return ["-c:v", "prores_ks", "-profile:v", "2", "-pix_fmt", "yuv422p10le"];
  const options = {fps:canvas?.fps??30,quality:video.quality==='fast'?55:video.quality==='balanced'?65:70,fast:video.quality==='fast',allowSoftware:video.encoder==='software',encoder:video.encoder,
    ...(platform==='win32'||video.encoder!=='software'?{bitrate:videoBitrate(video,canvas)}:{})};
  return video.codec==='h265'?hevcEncode(options,platform):h264Encode(options,platform);
}

export type VideoEncodingResult = {codec:string; requestedEncoder:ExportVideoSettings['encoder']; encoder:ExportVideoSettings['encoder']; implementation?:string; bitrate?:number; fallbackReason?:string};
/** Auto may retry a failed hardware encoder once. Explicit hardware never silently falls back. */
export async function runVideoEncode(video:ExportVideoSettings,canvas:EncodeCanvas,run:(args:string[])=>Promise<{stderr?:string}>,platform:NodeJS.Platform=process.platform):Promise<VideoEncodingResult> {
  assertVideoExportSupported(video,platform);
  const windowsH264=platform==='win32'&&video.codec==='h264';
  const modes=video.codec==='prores422'?['software'] as const:windowsH264&&video.encoder==='auto'?['hardware','software'] as const:[video.encoder];
  let fallbackReason:string|undefined;
  for(const encoder of modes) {
    try {
      const args=videoEncodeArgs({...video,encoder},canvas,platform);
      const result=await run(args);
      return {codec:args[1],requestedEncoder:video.encoder,encoder,
        ...(windowsH264?{bitrate:videoBitrate(video,canvas)}:{}),
        ...(result.stderr?.match(/MFT name: '([^'\r\n]+)'/)?.[1]?{implementation:result.stderr.match(/MFT name: '([^'\r\n]+)'/)![1]}:{}),
        ...(fallbackReason?{fallbackReason}:{})};
    } catch(error) {
      const failure=error as Error&{code?:string;stderr?:string};
      const detail=String(failure.stderr||failure.message||error);
      const encoderFailure=/could not (?:find any MFT|create MFT|set (?:input|output) type)|MF_E_|Error while opening encoder|Error initializing output stream|Failed to (?:create|initialize).*(?:encoder|device|MFT|DXGI)/i.test(detail);
      if(!windowsH264||failure.name==='AbortError'||failure.code==='ABORT_ERR'||!encoderFailure)throw error;
      if(encoder==='hardware'&&video.encoder==='auto') {fallbackReason='硬件编码器无法处理当前参数，已使用软件编码。';continue;}
      if(encoder==='hardware')throw new Error('当前设备无法使用硬件编码，请选择自动或软件编码后重试。\n'+detail,{cause:error});
      throw error;
    }
  }
  throw new Error('没有可用的视频编码器');
}

