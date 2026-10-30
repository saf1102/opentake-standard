import type {ExportVideoSettings} from '../../src/types/editor.ts';
export type VideoToolboxOptions={fps?:number;quality?:number;bitrate?:number|string;proxy?:boolean;allowSoftware?:boolean;fast?:boolean;tenBit?:boolean};
function common(o:VideoToolboxOptions){
 const rate=o.bitrate===undefined?['-q:v',String(o.quality??65)]:['-b:v',String(o.bitrate),...(!o.proxy?['-maxrate',String(o.bitrate),'-bufsize',typeof o.bitrate==='number'?String(o.bitrate*2):o.bitrate]:[])];
 return [...rate,...(o.proxy?[]:['-g',String(Math.max(1,Math.round((o.fps??30)*2)))]),...(o.allowSoftware?['-allow_sw','1']:[]),...(o.fast?['-prio_speed','1']:[])];
}
/** Final video has a two-second GOP; seek proxies deliberately retain VT's dense default. */
export function h264Encode(o:VideoToolboxOptions={},platform:NodeJS.Platform=process.platform){if(platform==='win32')return ['-c:v','h264_mf','-b:v',String(o.bitrate??(o.proxy?'4M':'12M')),'-g',String(Math.max(1,Math.round((o.fps??30)*2))),'-pix_fmt','nv12'];return ['-c:v','h264_videotoolbox',...common(o),'-profile:v','high','-pix_fmt','yuv420p'];}
export function hevcEncode(o:VideoToolboxOptions={}){if(process.platform==='win32')throw Error('Windows HEVC 尚未验收，请选择 H.264 MP4');return ['-c:v','hevc_videotoolbox',...common(o),'-tag:v','hvc1','-profile:v',o.tenBit?'main10':'main','-pix_fmt',o.tenBit?'p010le':'yuv420p'];}

export type EncodeCanvas = {width:number; height:number; fps?:number};
/** Scale the hardware budget with output pixels and frame rate, including portrait video. */
export function videoBitrate(video: ExportVideoSettings, canvas: EncodeCanvas = {width:1920,height:1080}) {
  const base = video.quality === 'fast' ? 6_000_000 : video.quality === 'balanced' ? 10_000_000 : 18_000_000;
  return Math.round(base * Math.max(0.5, canvas.width * canvas.height / (1920 * 1080)) * Math.max(1, (canvas.fps ?? 30) / 30));
}
export function videoEncodeArgs(video: ExportVideoSettings, canvas?: EncodeCanvas) {
  if (video.codec === "prores422")
    return ["-c:v", "prores_ks", "-profile:v", "2", "-pix_fmt", "yuv422p10le"];
  const options = {fps:canvas?.fps??30,quality:video.quality==='fast'?55:video.quality==='balanced'?65:70,fast:video.quality==='fast',allowSoftware:video.encoder==='software',
    ...(video.encoder!=='software'?{bitrate:videoBitrate(video,canvas)}:{})};
  return video.codec==='h265'?hevcEncode(options):h264Encode(options);
}

