import {ffmpegPath, ffprobePath} from '../general/kit-env.ts';
export function binary(name: string) {
  return name === 'ffmpeg' ? ffmpegPath() : name === 'ffprobe' ? ffprobePath() : undefined;
}
export function requireBinary(name:string){const file=binary(name);if(!file)throw new Error('未找到媒体处理工具：'+name);return file;}
