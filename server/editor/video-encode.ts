export type VideoToolboxOptions={fps?:number;quality?:number;bitrate?:number|string;proxy?:boolean;allowSoftware?:boolean;fast?:boolean;tenBit?:boolean};
function common(o:VideoToolboxOptions){
 const rate=o.bitrate===undefined?['-q:v',String(o.quality??65)]:['-b:v',String(o.bitrate),...(!o.proxy?['-maxrate',String(o.bitrate),'-bufsize',typeof o.bitrate==='number'?String(o.bitrate*2):o.bitrate]:[])];
 return [...rate,...(o.proxy?[]:['-g',String(Math.max(1,Math.round((o.fps??30)*2)))]),...(o.allowSoftware?['-allow_sw','1']:[]),...(o.fast?['-prio_speed','1']:[])];
}
/** Final video has a two-second GOP; seek proxies deliberately retain VT's dense default. */
export function h264Encode(o:VideoToolboxOptions={}){return ['-c:v','h264_videotoolbox',...common(o),'-profile:v','high','-pix_fmt','yuv420p'];}
export function hevcEncode(o:VideoToolboxOptions={}){return ['-c:v','hevc_videotoolbox',...common(o),'-tag:v','hvc1','-profile:v',o.tenBit?'main10':'main','-pix_fmt',o.tenBit?'p010le':'yuv420p'];}
