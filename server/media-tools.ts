import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const media=require('../desktop/media-tools.cjs') as {supportBin:()=>string;ffmpegPath:()=>string;ffprobePath:()=>string;doctor:()=>{ok:boolean;ffmpeg?:string;ffprobe?:string;versions?:Record<string,string>;message?:string;color?:string}};
export default media;
