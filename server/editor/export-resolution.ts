import type { EditProject, ExportSettings } from '../../src/types/editor.ts';

/** Output size only; never mutate authored timelines or the preview preference. */
export function exportResolution(canvas: Pick<EditProject['settings'], 'width' | 'height'>, resolution: ExportSettings['resolution']) {
  if (!resolution || resolution === 'original') return {...canvas};
  const shortEdge = resolution === '4k' ? 2160 : resolution === '1080p' ? 1080 : 720;
  const scale = Math.min(1, shortEdge / Math.min(canvas.width, canvas.height));
  const even = (n: number) => Math.max(2, Math.round(n * scale / 2) * 2);
  return {width: even(canvas.width), height: even(canvas.height)};
}

/** Apply authored pixel dimensions after director materialization, on the export copy only. */
export function scaleExportMasks(project: EditProject, authoredWidth: number) {
  const ratio = project.settings.width / authoredWidth;
  if (ratio === 1) return;
  for (const track of project.timeline.tracks) for (const clip of track.clips) {
    const enhanced = clip.params.enhancedCode as {imported?: boolean; width?: number; height?: number} | undefined;
    // Imported shells are authored in project pixels. The iframe still uses its
    // original composition size and fits itself into this scaled output shell.
    if (enhanced?.imported && typeof enhanced.width === 'number' && typeof enhanced.height === 'number') {
      clip.params = {...clip.params, enhancedCode: {...enhanced, width: enhanced.width * ratio, height: enhanced.height * ratio}};
    }
    const mask = clip.params.visualMask;
    if (!mask || typeof mask !== 'object' || Array.isArray(mask)) continue;
    const values = mask as Record<string, unknown>;
    clip.params = {...clip.params, visualMask: {...values,
      ...(typeof values.borderWidth === 'number' ? {borderWidth: values.borderWidth * ratio} : {}),
      ...(typeof values.cornerRadius === 'number' ? {cornerRadius: values.cornerRadius * ratio} : {}),
    }};
  }
}
