import type { ExportPreset, ExportSelection, ExportSettings } from '../types/editor'

export const EXPORT_PRESET_COPY: Record<ExportPreset, { label: string; description: string }> = {
  quick: { label: '快速成片', description: '剪好后直接使用' },
  standard: { label: '标准交付', description: '成片、静音母版、字幕与有效分轨' },
  jianying: { label: '剪映工程', description: '带齐素材，继续精剪' },
  motion: { label: '动效交付', description: '完整时间线透明卡片视频' },
  archive: { label: '完整归档', description: '全部视频、分轨、动效与工程文件' },
  custom: { label: '自定义', description: '按需选择每一项产物' },
}

const selection = (value: Partial<ExportSelection>): ExportSelection => ({
  mixedVideo: false,
  silentVideo: false,
  subtitleSrt: false,
  subtitleAss: false,
  subtitleWords: false,
  voiceStem: false,
  sourceBedStem: false,
  musicStem: false,
  sfxStem: false,
  cardTimeline: false,
  cardIndividual: false,
  projectSnapshot: false,
  jianyingDraft: false,
  jianyingMedia: false,
  ...value,
})

export function exportSettingsForPreset(
  preset: ExportPreset,
  current?: Pick<ExportSettings, 'destinationDir' | 'folderName' | 'conflictPolicy' | 'revealWhenDone' | 'resolution'>,
): ExportSettings {
  const shared = {
    resolution: current?.resolution || 'original' as const,
    destinationDir: current?.destinationDir || '',
    folderName: current?.folderName || '',
    conflictPolicy: current?.conflictPolicy || 'versioned' as const,
    revealWhenDone: current?.revealWhenDone || false,
  }
  if (preset === 'standard') return {
    ...shared,
    preset,
    selection: selection({
      mixedVideo: true, silentVideo: true, subtitleSrt: true, subtitleAss: true,
      voiceStem: true, sourceBedStem: true, musicStem: true, sfxStem: true,
      projectSnapshot: true,
    }),
    video: { container: 'mp4', codec: 'h264', quality: 'balanced', encoder: 'auto' },
    audioFormat: 'wav', importToJianying: false,
  }
  if (preset === 'jianying') return {
    ...shared,
    preset,
    selection: selection({
      mixedVideo: false, subtitleSrt: true, voiceStem: true, sourceBedStem: true,
      musicStem: true, sfxStem: true, cardIndividual: true, projectSnapshot: true,
      jianyingDraft: true, jianyingMedia: true,
    }),
    video: { container: 'mp4', codec: 'h264', quality: 'balanced', encoder: 'auto' },
    audioFormat: 'wav', importToJianying: true,
  }
  if (preset === 'motion') return {
    ...shared,
    preset,
    selection: selection({ cardTimeline: true, projectSnapshot: true }),
    video: { container: 'mov', codec: 'prores422', quality: 'high', encoder: 'software' },
    audioFormat: 'wav', importToJianying: false,
  }
  if (preset === 'archive') return {
    ...shared,
    preset,
    selection: selection({
      mixedVideo: true, silentVideo: true, subtitleSrt: true, subtitleAss: true,
      subtitleWords: true, voiceStem: true, sourceBedStem: true, musicStem: true,
      sfxStem: true, cardTimeline: true, cardIndividual: true, projectSnapshot: true,
      jianyingDraft: true, jianyingMedia: true,
    }),
    video: { container: 'mp4', codec: 'h264', quality: 'high', encoder: 'software' },
    audioFormat: 'wav', importToJianying: false,
  }
  if (preset === 'custom') {
    const base = exportSettingsForPreset('quick', current)
    return { ...base, preset: 'custom' }
  }
  return {
    ...shared,
    preset: 'quick',
    selection: selection({ mixedVideo: true, subtitleSrt: true }),
    video: { container: 'mp4', codec: 'h264', quality: 'fast', encoder: 'auto' },
    audioFormat: 'aac', importToJianying: false,
  }
}

export function hasSelectedExport(selection: ExportSelection) {
  return Object.values(selection).some(Boolean)
}

export function isFilmExportPreset(preset: ExportPreset) {
  return preset === 'quick' || preset === 'custom'
}

export type ExportDialogSettings = { settings: ExportSettings; film: ExportSettings }

/** 成片选择独立保存；非成片方式始终使用原预设，不携带成片的编码和帧率。 */
export function createExportDialogSettings(settings: ExportSettings): ExportDialogSettings {
  return isFilmExportPreset(settings.preset)
    ? {settings, film: settings}
    : {settings: exportSettingsForPreset(settings.preset, settings), film: exportSettingsForPreset('quick', settings)}
}

export function updateExportDialogSettings(state: ExportDialogSettings, settings: ExportSettings): ExportDialogSettings {
  return {settings, film: isFilmExportPreset(settings.preset) ? settings : state.film}
}

export function switchExportDialogPreset(state: ExportDialogSettings, preset: ExportPreset): ExportDialogSettings {
  const defaults = exportSettingsForPreset(preset, state.settings)
  if (!isFilmExportPreset(preset)) return {...state, settings: defaults}
  const settings = {...defaults, resolution: state.film.resolution, video: state.film.video,
    ...(state.film.fps === undefined ? {} : {fps: state.film.fps})}
  return {settings, film: settings}
}

/** 提交前再次收口，避免旧偏好或后续界面改动把成片参数送入剪映素材编码。 */
export function exportDialogSubmission(state: ExportDialogSettings): ExportSettings {
  return isFilmExportPreset(state.settings.preset)
    ? state.settings
    : exportSettingsForPreset(state.settings.preset, state.settings)
}

export function exportDialogPreferences(state: ExportDialogSettings): ExportSettings {
  const {destinationDir, folderName, conflictPolicy, revealWhenDone} = state.settings
  return {...state.film, destinationDir, folderName, conflictPolicy, revealWhenDone}
}
