import type {ExportVideoSettings} from '../src/types/editor.ts';

/** One capability contract for the dialog and every export entry point. */
export function videoExportCapabilities(platform: string) {
  const codecs: ExportVideoSettings['codec'][] = ['h264', 'prores422'];
  const unavailable: Record<string, string> = {};
  if (platform === 'win32') unavailable.h265 = 'Windows HEVC 暂不可用，请选择 H.264 或 ProRes 422。';
  else codecs.splice(1, 0, 'h265');
  return {codecs, unavailable};
}

export function assertVideoExportSupported(video: Pick<ExportVideoSettings, 'codec'>, platform: string) {
  const reason = videoExportCapabilities(platform).unavailable[video.codec];
  if (reason) throw Object.assign(new Error(reason), {status: 400});
}
