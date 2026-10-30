import fs from 'node:fs';
import path from 'node:path';
import type {MediaAsset} from '../../src/types/editor.ts';
import {execFileAsync} from '../proc.ts';
import {findProject} from './store.ts';
import {binary} from './media-binary.ts';
import {saveMediaResult} from './media-state.ts';

/** Screen-library import only; no speech editing or automatic timeline placement. */
export async function processScreenMedia(projectId: string, assetId: string, _options?: unknown) {
  const {dir, project} = findProject(projectId);
  const asset = project.media.find(item => item.id === assetId);
  if (!asset) throw new Error('素材不存在');
  try {
    const file = path.resolve(dir, asset.originalFile);
    if (!file.startsWith(dir + path.sep) || !fs.realpathSync(file).startsWith(fs.realpathSync(dir) + path.sep)) throw new Error('素材路径无效');
    const ffprobe = binary('ffprobe'), ffmpeg = binary('ffmpeg');
    if (!ffprobe || !ffmpeg) throw new Error('未找到 FFmpeg / ffprobe');
    const data = JSON.parse((await execFileAsync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], {timeout: 60_000})).stdout);
    const video = data.streams?.find((s: {codec_type: string}) => s.codec_type === 'video');
    const duration = Number(data.format?.duration || video?.duration);
    if (!video || !(duration > 0) || !video.width || !video.height) throw new Error('没有可读取的视频画面或时长');
    const [a, b] = String(video.r_frame_rate).split('/').map(Number);
    const updates: Partial<MediaAsset> = {width: video.width, height: video.height, fps: a / b || 30, duration, hasAudio: data.streams.some((s: {codec_type: string}) => s.codec_type === 'audio'), status: 'ready', error: undefined};
    const thumbnailFile = `media/${asset.id}.jpg`;
    await execFileAsync(ffmpeg, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', path.join(dir, thumbnailFile)], {timeout: 60_000});
    updates.thumbnailFile = thumbnailFile;
    return saveMediaResult(projectId, assetId, updates);
  } catch (error) {
    saveMediaResult(projectId, assetId, {status: 'error', error: error instanceof Error ? error.message : String(error)});
    throw error;
  }
}
