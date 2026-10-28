import type { EditProject, Timeline } from '@/types'
import { timelineContentEnd } from './timeline-math'

/** Display the edited timeline length, rather than the sum of source assets. */
export function formatProjectDuration(timeline: Timeline): string {
  return formatSeconds(timelineContentEnd(timeline))
}

/** 录屏工程的剪辑在 OpenScreen 文档里，时间线是空的：用文档的时长（10-27，原来显示 00:00）。 */
export function formatScreenProjectDuration(project: Pick<EditProject, 'timeline' | 'openScreenDocuments'>): string {
  const doc = Math.max(0, ...(project.openScreenDocuments || []).filter(item => !item.archivedAt).map(item => item.duration || 0))
  return doc > 0 ? formatSeconds(doc) : formatProjectDuration(project.timeline)
}

function formatSeconds(value: number): string {
  const seconds = Math.max(0, Math.round(value))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const remainder = seconds % 60
  const pair = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pair(minutes)}:${pair(remainder)}` : `${pair(minutes)}:${pair(remainder)}`
}
