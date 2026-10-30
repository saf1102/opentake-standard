import {ffmpegPath, ffprobePath} from '../general/kit-env.ts';
export function binary(name: string) {
  return name === 'ffmpeg' ? ffmpegPath() : name === 'ffprobe' ? ffprobePath() : undefined;
}
