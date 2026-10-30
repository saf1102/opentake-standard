import type {ExportSettings} from '../types/editor';
export type ExportHistoryEntry = {
  id: string;
  completedAt: number;
  outputDir?: string;
  settings?: ExportSettings;
  media?: {width:number;height:number;fps:number};
  availability: 'available' | 'missing' | 'replaced';
  videos: string[];
  packageAvailable?: boolean;
};
export type ExportHistoryPage = {entries: ExportHistoryEntry[];nextOffset?:number};
export function exportHistoryQuality(entry: ExportHistoryEntry) {
  const s=entry.settings;
  if(!s)return '旧记录未保存画质设置';
  if(s.selection.jianyingDraft||s.selection.jianyingMedia||s.importToJianying)return '剪映工程 · 保留素材原始规格';
  const resolution=entry.media?`${entry.media.width} × ${entry.media.height} · ${entry.media.fps} fps`
    :({original:'原片分辨率（旧记录）','4k':'最高 4K','1080p':'最高 1080P','720p':'最高 720P'}[s.resolution||'original']);
  if(!s.selection.mixedVideo&&!s.selection.silentVideo)return '音轨、字幕或卡片素材';
  const codec={h264:'H.264',h265:'HEVC',prores422:'ProRes 422'}[s.video.codec];
  return `${resolution} · ${codec} · ${{fast:'快速',balanced:'均衡',high:'高质量'}[s.video.quality]}`;
}

export function exportHistoryKind(entry: ExportHistoryEntry): 'video' | 'jianying' | 'files' {
  const s=entry.settings;
  if(s&&(s.selection.jianyingDraft||s.selection.jianyingMedia||s.importToJianying))return 'jianying';
  if(s?.selection.mixedVideo||s?.selection.silentVideo||entry.videos.length)return 'video';
  return 'files';
}
