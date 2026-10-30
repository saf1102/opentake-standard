/** 标准版只接通用轨道；不导入口播的卡位、粗剪、导演布局和转写模块。 */
import type {EditProject, MediaAsset, Timeline, TimelineClip, TimelineTrack} from '@/types'
export const timelineHasCards = (_timeline: Timeline) => false
export type CardTaskState = {sourceIds: string[]; message: string}
export type PendingCut = {start: number; end: number; clipId: string; ripple: boolean}
export type SlotDropPreview = {trackId: string; sourceClipId: string; targetClipId?: string; start: number; duration: number; mode: 'move' | 'swap' | 'fit' | 'expand' | 'append'; label: string}
export type LibrarySlotDropPreview = Omit<SlotDropPreview, 'sourceClipId' | 'targetClipId'>
export type VoiceClipAnnotations = {pauses: never[]}
export const diagramCardTracks = (timeline: Timeline) => timeline.tracks
export const CARD_SLOT_LEGEND: {kind: string; icon: string; label: string}[] = []
export const cardSlotState = (_clip: TimelineClip, _tasks: CardTaskState[] = []) => ({kind: 'ready', icon: '', label: ''})
export const MOTION_CARD_TIMELINE_LABELS = {small: 'S', half: 'M', full: 'F'}
export const timelineClipLabel = (_kind: TimelineTrack['kind'], clip: TimelineClip, _stateShown = false) => clip.text || clip.name
export const timelineClipAppearance = (kind: TimelineTrack['kind'], clip: TimelineClip): {background: string | undefined; color: string | undefined; badge?: string; cardType?: 'small' | 'half' | 'full'} => ({background: kind === 'subtitle' ? '#FFD43B' : kind === 'voice' ? '#102A27' : clip.color, color: kind === 'subtitle' ? '#15130A' : undefined})
export const presentationLayoutIntervals = (_timeline: Timeline, clip: TimelineClip) => [{start: clip.start, end: clip.start + clip.duration}]
export const librarySlotDropPreview = (_timeline: Timeline, _asset: MediaAsset, _track: string, _time: number): LibrarySlotDropPreview | undefined => undefined
export const voiceAnnotationsForClip = (_clip: TimelineClip, _transcript: EditProject['transcript']): VoiceClipAnnotations => ({pauses: []})
export function VoiceTimelineAnnotations(_props: {clip: TimelineClip; annotations: VoiceClipAnnotations; pixelsPerSecond: number}) { return null }
export function VoiceWaveform(_props: {projectId: string; asset: MediaAsset; clip: TimelineClip}) { return null }
export function CutRangeOverlay(_props: {range: PendingCut; pixelsPerSecond: number; fps: number; duration: number; snapping: boolean; timelineEdges: number[]; onChange: (edge: 'start' | 'end', at: number) => void; onRestore: (range: PendingCut) => void; onSeek: (time: number) => void}) { return null }
export function TimelineSmartTools(_props: {onSmartMusic: () => void; smartMusicBusy?: boolean; onSmartRoughcut: () => void; onGlobalMotion: () => void; onGlobalSfx: () => void; onSmartBroll: () => void; onAutoPlace: () => void; autoPlaceRunning?: boolean; globalMotionDisabled?: boolean}) { return null }
