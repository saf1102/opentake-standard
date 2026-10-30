import {z} from 'zod';
export const TrackKindSchema = z.enum([
  'video', 'proxy', 'visual', 'composition', 'voice', 'source-bed', 'music', 'sfx', 'subtitle', 'overlay', 'enhanced', 'camera', 'openscreen',
  // 通用剪辑: an agent-written page (window.shot.frame(t)) on the picture track
  'page',
])
export type TrackKind = z.infer<typeof TrackKindSchema>

export const ClipLinkRoleSchema = z.enum(['video', 'voice', 'mg', 'sfx'])
export type ClipLinkRole = z.infer<typeof ClipLinkRoleSchema>

export const ClipSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  assetId: z.string().optional(),
  presetId: z.string().optional(),
  name: z.string(),
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  sourceStart: z.number().nonnegative().default(0),
  sourceDuration: z.number().positive().optional(),
  text: z.string().optional(),
  color: z.string().optional(),
  transform: z.object({
    x: z.number().default(0), y: z.number().default(0), scale: z.number().positive().default(1),
    rotation: z.number().default(0), crop: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).optional(),
  }).optional(),
  volume: z.number().min(0).max(10).default(1),
  fadeIn: z.number().nonnegative().default(0),
  fadeOut: z.number().nonnegative().default(0),
  linkGroupId: z.string().optional(),
  linkRole: ClipLinkRoleSchema.optional(),
  params: z.record(z.string(), z.unknown()).default({}),
})
export type TimelineClip = z.infer<typeof ClipSchema>

export const AudioAutomationSegmentSchema = z.object({
  id: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  action: z.enum(['hold', 'mute', 'fade-up', 'fade-down', 'boost']),
  gainDb: z.number().min(-96).max(12).default(0),
  directorSceneId: z.string().optional(),
})
export type AudioAutomationSegment = z.infer<typeof AudioAutomationSegmentSchema>

export const TrackSchema = z.object({
  id: z.string(), name: z.string(), kind: TrackKindSchema, order: z.number().int(),
  locked: z.boolean().default(false), hidden: z.boolean().default(false), muted: z.boolean().default(false),
  hiddenInEditor: z.boolean().default(false),
  brollMediaType: z.enum(['image', 'video']).optional(),
  brollVideoTrackId: z.string().optional(),
  role: z.enum(['anchor', 'follower']).optional(),
  volume: z.number().min(0).max(10).optional(),
  audioRouting: z.object({ duckDepthDb: z.number().min(-48).max(0).default(-14) }).optional(),
  automation: z.array(AudioAutomationSegmentSchema).default([]),
  clips: z.array(ClipSchema).default([]),
})
export type TimelineTrack = z.infer<typeof TrackSchema>

export const TimelineSchema = z.object({
  duration: z.number().nonnegative().default(0), fps: z.number().positive().default(30),
  playhead: z.number().nonnegative().default(0), tracks: z.array(TrackSchema),
})
export type Timeline = z.infer<typeof TimelineSchema>

export const MediaAssetSchema = z.object({
  removedFromLibrary: z.boolean().optional(),
  id: z.string(), name: z.string(), type: z.enum(['video', 'audio', 'image']), mimeType: z.string(),
  originalFile: z.string(), proxyFile: z.string().optional(), clearProxyFile: z.string().optional(), thumbnailFile: z.string().optional(),
  filmstripFile: z.string().optional(), waveformFile: z.string().optional(),
  duration: z.number().nonnegative().default(0), width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(), fps: z.number().positive().optional(),
  hasAudio: z.boolean().optional(),
  size: z.number().int().nonnegative(), createdAt: z.number(), status: z.enum(['processing', 'ready', 'error']),
  error: z.string().optional(),
  // A project owns every physical source and derivative. OpenScreen documents
  // only reference those assets and never replace the immutable recording.
  origin: z.enum(['imported', 'screen-recording', 'openscreen-published', 'b-roll', 'general']).optional(),
  importRole: z.enum(['main', 'broll', 'music', 'screen']).optional(),
  parentAssetIds: z.array(z.string()).optional(),
  openScreenDocumentId: z.string().optional(),
  openScreenRevision: z.number().int().nonnegative().optional(),
  publicationVersion: z.number().int().positive().optional(),
  capture: z.object({
    engine: z.enum(['openscreen', 'imported-screen']),
    sourceType: z.enum(['display', 'window']), sourceId: z.string().optional(), sourceName: z.string().optional(),
    cursorDataFile: z.string().optional(), openscreenProjectFile: z.string().optional(), recordedAt: z.number(),
  }).optional(),
})
export type MediaAsset = z.infer<typeof MediaAssetSchema>

export const ProjectSettingsSchema = z.object({
  width: z.number().int().positive().default(1080), height: z.number().int().positive().default(1920),
  fps: z.number().positive().default(30), canvasMode: z.enum(['auto', 'custom']).default('auto'),
  screenStyle: z.object({
    background: z.string().default('#111318'), padding: z.number().min(0).max(160).default(48),
    borderRadius: z.number().min(0).max(80).default(24), shadow: z.number().min(0).max(100).default(38),
    cursorScale: z.number().min(0.5).max(3).default(1), showCursor: z.boolean().default(true),
    cursorStyle: z.enum(['arrow', 'dot', 'crosshair']).default('arrow'),
    cursorSmoothing: z.number().min(0).max(1).default(0.72), clickHighlight: z.boolean().default(true),
    aspectRatio: z.enum(['source', '16:9', '9:16', '1:1']).default('source'),
  }).default({
    background: '#111318', padding: 48, borderRadius: 24, shadow: 38,
    cursorScale: 1, showCursor: true, cursorStyle: 'arrow', cursorSmoothing: 0.72,
    clickHighlight: true, aspectRatio: 'source',
  }),
})
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>

export const TranscriptTokenSchema = z.object({
  id: z.string(), text: z.string(), start: z.number().nonnegative(), end: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).default(0), source: z.enum(['audio', 'script', 'ocr']),
  matched: z.boolean().default(true),
})
export type TranscriptToken = z.infer<typeof TranscriptTokenSchema>

export const SubtitleSegmentSchema = z.object({
  id: z.string(), start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string(),
  tokens: z.array(TranscriptTokenSchema).default([]), unmatchedScript: z.array(z.string()).default([]),
})
export type SubtitleSegment = z.infer<typeof SubtitleSegmentSchema>


export const CaptureSourceSchema = z.object({
  id: z.string(), type: z.enum(['display', 'window', 'microphone']), name: z.string(),
  // OpenScreen 的 sources 接口返回内部 id，但 record 命令实际需要：
  // 显示器 index、窗口 title、麦克风 label。captureValue 专门保存这个 CLI 值，
  // 避免把 screen:1:0 一类内部 id 错传给 --display。
  captureValue: z.string(), displayIndex: z.number().int().nonnegative().optional(),
  displayId: z.string().optional(), appName: z.string().optional(), thumbnail: z.string().optional(),
})
export type CaptureSource = z.infer<typeof CaptureSourceSchema>

export const CaptureSettingsSchema = z.object({
  sourceType: z.enum(['display', 'window']), sourceId: z.string(), sourceName: z.string().optional(),
  sourceValue: z.string().optional(),
  systemAudio: z.boolean().default(true), microphone: z.boolean().default(false), microphoneId: z.string().optional(),
  cursor: z.enum(['editable-overlay', 'system', 'hidden']).default('editable-overlay'),
  countdownSeconds: z.number().int().min(0).max(10).default(3),
})
export type CaptureSettings = z.infer<typeof CaptureSettingsSchema>

export const CaptureJobSchema = z.object({
  id: z.string(), projectId: z.string(), status: z.enum(['queued', 'recording', 'stopping', 'processing', 'completed', 'failed', 'interrupted']),
  settings: CaptureSettingsSchema, progress: z.number().min(0).max(100).default(0),
  createdAt: z.number(), updatedAt: z.number(), startedAt: z.number().optional(), stoppedAt: z.number().optional(),
  elapsedMs: z.number().nonnegative().default(0), assetId: z.string().optional(), error: z.string().optional(),
  rawProjectFile: z.string().optional(), cursorDataFile: z.string().optional(),
})
export type CaptureJob = z.infer<typeof CaptureJobSchema>

export const OpenScreenEnvironmentStatusSchema = z.object({
  installed: z.boolean(), executable: z.string().optional(), version: z.string().optional(), supported: z.boolean(),
  expectedVersion: z.string(), repository: z.string().url(), installUrl: z.string().url(),
  permissions: z.object({
    screenRecording: z.enum(['granted', 'missing', 'unknown']),
    accessibility: z.enum(['granted', 'missing', 'unknown']),
    systemAudio: z.enum(['granted', 'missing', 'unknown']),
  }),
  message: z.string().optional(),
})
export type OpenScreenEnvironmentStatus = z.infer<typeof OpenScreenEnvironmentStatusSchema>

export const OpenScreenDocumentRefSchema = z.object({
  id: z.string(),
  schemaVersion: z.number().int().positive(),
  relativePath: z.string(),
  title: z.string(),
  duration: z.number().nonnegative().default(0),
  previewAssetId: z.string().optional(),
  sourceAssetIds: z.array(z.string()).default([]),
  publishedAssetIds: z.array(z.string()).default([]),
  latestPublishedAssetId: z.string().optional(),
  lastPublishedAt: z.number().optional(),
  revision: z.number().int().nonnegative().default(0),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().optional(),
})
export type OpenScreenDocumentRef = z.infer<typeof OpenScreenDocumentRefSchema>

export const OpenScreenCompoundParamsSchema = z.object({
  kind: z.literal('openscreen-compound'),
  documentId: z.string(),
  sourceStart: z.number().nonnegative().default(0),
  sourceDuration: z.number().positive(),
})
export type OpenScreenCompoundParams = z.infer<typeof OpenScreenCompoundParamsSchema>

export const OpenScreenEditorSessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  documentId: z.string(),
  clientId: z.string(),
  revision: z.number().int().nonnegative(),
  writable: z.boolean(),
  saveState: z.enum(['saved', 'saving', 'conflict', 'error']).default('saved'),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type OpenScreenEditorSession = z.infer<typeof OpenScreenEditorSessionSchema>

export const OpenScreenHostCandidateSchema = z.object({
  file: z.string(),
  title: z.string(),
  upstreamProjectId: z.string().optional(),
  schemaVersion: z.number().int().positive().optional(),
  duration: z.number().nonnegative().default(0),
  sourceCount: z.number().int().nonnegative().default(0),
  sizeBytes: z.number().int().nonnegative().default(0),
  updatedAt: z.number(),
})
export type OpenScreenHostCandidate = z.infer<typeof OpenScreenHostCandidateSchema>

export const OpenScreenHostSessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: z.enum(['launching', 'waiting', 'recording', 'processing', 'selecting', 'completed', 'cancelled', 'failed']),
  mode: z.enum(['native-hud', 'cli']),
  createdAt: z.number(),
  updatedAt: z.number(),
  candidateFiles: z.array(z.string()).default([]),
  candidates: z.array(OpenScreenHostCandidateSchema).default([]),
  baselineFingerprints: z.record(z.string(), z.string()).default({}),
  observedArtifacts: z.record(z.string(), z.string()).default({}),
  lastActivityAt: z.number().optional(),
  selectedFile: z.string().optional(),
  documentId: z.string().optional(),
  error: z.string().optional(),
})
export type OpenScreenHostSession = z.infer<typeof OpenScreenHostSessionSchema>

export const OpenScreenBridgeMessageSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  type: z.enum(['ready', 'open', 'save-state', 'document-changed', 'recording-state', 'export-state', 'export-dialog', 'task-state', 'error']),
  projectId: z.string(),
  documentId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.number(),
})
export type OpenScreenBridgeMessage = z.infer<typeof OpenScreenBridgeMessageSchema>

export const OpenScreenExportJobSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  documentId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  format: z.enum(['mp4', 'gif']),
  purpose: z.enum(['export', 'publish']).default('export'),
  publishedAssetId: z.string().optional(),
  quality: z.enum(['medium', 'good', 'source']).default('good'),
  progress: z.number().min(0).max(100).default(0),
  currentFrame: z.number().int().nonnegative().optional(),
  totalFrames: z.number().int().positive().optional(),
  outputFile: z.string(),
  outputDir: z.string().optional(),
  exportSettings: z.unknown().optional(),
  requestClientId: z.string().optional(),
  savedDocumentRevision: z.number().int().nonnegative().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  videoDurationS: z.number().nonnegative().optional(),
  wallS: z.number().nonnegative().optional(),
  error: z.string().optional(),
})
export type OpenScreenExportJob = z.infer<typeof OpenScreenExportJobSchema>
export const EditProjectSchema = z.object({schemaVersion:z.literal(5),id:z.string(),name:z.string(),createdAt:z.number(),updatedAt:z.number(),revision:z.number(),settings:ProjectSettingsSchema,media:z.array(MediaAssetSchema),timeline:TimelineSchema,transcript:z.array(SubtitleSegmentSchema).default([]),timelineVersions:z.array(z.object({id:z.string(),name:z.string(),timeline:TimelineSchema,createdAt:z.number()})),activeTimelineVersionId:z.string(),storageOffline:z.boolean().optional(),standardKind:z.literal('screen').optional(),deletedAt:z.number().optional(),archivedAt:z.number().optional(),openScreenDocuments:z.array(OpenScreenDocumentRefSchema).default([])});
export type EditProject=z.infer<typeof EditProjectSchema>;

export const ExportPresetSchema = z.enum(['quick', 'standard', 'jianying', 'motion', 'archive', 'custom'])
export type ExportPreset = z.infer<typeof ExportPresetSchema>

export const ExportSelectionSchema = z.object({
  mixedVideo: z.boolean().default(true),
  silentVideo: z.boolean().default(false),
  subtitleSrt: z.boolean().default(true),
  subtitleAss: z.boolean().default(false),
  subtitleWords: z.boolean().default(false),
  voiceStem: z.boolean().default(false),
  sourceBedStem: z.boolean().default(false),
  musicStem: z.boolean().default(false),
  sfxStem: z.boolean().default(false),
  cardTimeline: z.boolean().default(false),
  cardIndividual: z.boolean().default(false),
  projectSnapshot: z.boolean().default(false),
  jianyingDraft: z.boolean().default(false),
  jianyingMedia: z.boolean().default(false),
})
export type ExportSelection = z.infer<typeof ExportSelectionSchema>

export const ExportVideoSettingsSchema = z.object({
  container: z.enum(['mp4', 'mov']).default('mp4'),
  codec: z.enum(['h264', 'h265', 'prores422']).default('h264'),
  quality: z.enum(['fast', 'balanced', 'high']).default('fast'),
  encoder: z.enum(['auto', 'hardware', 'software']).default('auto'),
})
export type ExportVideoSettings = z.infer<typeof ExportVideoSettingsSchema>

export const ExportSettingsSchema = z.object({
  resolution: z.enum(['original', '4k', '1080p', '720p']).optional(),
  fps: z.union([z.literal('project'), z.literal(24), z.literal(60)]).optional(),
  preset: ExportPresetSchema.default('quick'),
  destinationDir: z.string().max(2_048).default(''),
  folderName: z.string().max(80).default(''),
  conflictPolicy: z.enum(['versioned', 'replace']).default('versioned'),
  selection: ExportSelectionSchema.default({
    mixedVideo: true,
    silentVideo: false,
    subtitleSrt: true,
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
  }),
  video: ExportVideoSettingsSchema.default({
    container: 'mp4', codec: 'h264', quality: 'fast', encoder: 'auto',
  }),
  audioFormat: z.enum(['wav', 'aac']).default('wav'),
  importToJianying: z.boolean().default(false),
  revealWhenDone: z.boolean().default(false),
})
export type ExportSettings = z.infer<typeof ExportSettingsSchema>

export const ExportPhaseSchema = z.enum([
  'queued', 'preparing', 'reference', 'motion', 'compositing', 'audio',
  'cards', 'jianying', 'finalizing', 'completed', 'failed', 'cancelled',
])
export type ExportPhase = z.infer<typeof ExportPhaseSchema>

/** One closed interval per phase: when it started, when it ended, how long it took. */
export const ExportStageSchema = z.object({
  phase: ExportPhaseSchema,
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationSeconds: z.number().optional(),
})
export type ExportStage = z.infer<typeof ExportStageSchema>

export const ExportJobSchema = z.object({
  id: z.string(), projectId: z.string(), status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  progress: z.number().min(0).max(100), createdAt: z.number(), updatedAt: z.number(), outputDir: z.string().optional(), error: z.string().optional(),
  phase: ExportPhaseSchema.optional(), message: z.string().optional(), currentItem: z.number().int().nonnegative().optional(),
  totalItems: z.number().int().nonnegative().optional(), settings: ExportSettingsSchema.optional(),
  jianyingImportDir: z.string().optional(),
  outputMedia: z.object({width:z.number().positive(),height:z.number().positive(),fps:z.number().positive()}).optional(),
  estimatedRemainingSeconds: z.number().nonnegative().optional(),
  warnings: z.array(z.string()).optional(),
  /** Project revision the export snapshot was taken from. */
  sourceRevision: z.number().int().nonnegative().optional(),
  /** Per-phase timing log, recorded on phase transitions in updateJob. */
  stages: z.array(ExportStageSchema).optional(),
})
export type ExportJob = z.infer<typeof ExportJobSchema>

export const ExportCapabilitiesSchema = z.object({
  defaults: z.object({preset:ExportPresetSchema,resolution:z.enum(['original','4k','1080p','720p']),revealWhenDone:z.boolean(),container:z.enum(['mp4','mov']),quality:z.enum(['fast','balanced','high'])}).optional(),
  defaultDestination: z.string(),
  freeBytes: z.number().nonnegative().optional(),
  jianying: z.object({
    available: z.boolean(),
    draftDir: z.string().optional(),
    appPath: z.string().optional(),
    warning: z.string().optional(),
  }),
})
export type ExportCapabilities = z.infer<typeof ExportCapabilitiesSchema>

