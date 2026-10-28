import type { GeneralProjectSummary } from '../general/general-contract.ts'

/** 口播 or 通用. Project files carry no type field yet, so this file format stays untouched: a project whose
 *  optional `kind` is anything other than 'general' — including every existing project — is a 口播 project. */
export type ProjectKind = 'koubo' | 'general'
export type ProjectKindFilter = 'all' | ProjectKind

export const PROJECT_KIND_LABELS: Readonly<Record<ProjectKind, string>> = { koubo: '口播', general: '通用' }

export function projectKind(project: object): ProjectKind {
  return (project as { kind?: unknown }).kind === 'general' ? 'general' : 'koubo'
}

export function filterProjectsByKind<T extends object>(projects: readonly T[], filter: ProjectKindFilter): T[] {
  return filter === 'all' ? [...projects] : projects.filter(project => projectKind(project) === filter)
}

type ListedProject = { updatedAt: number; deletedAt?: number; archivedAt?: number }

/** The home row: newest first, without archived or deleted projects (the same set as 剪辑台 · 最近工程). */
export function recentProjects<T extends ListedProject>(projects: readonly T[], filter: ProjectKindFilter, limit: number): T[] {
  return filterProjectsByKind(projects.filter(project => !project.deletedAt && !project.archivedAt), filter)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, limit))
}

/** A general project as a library row: the same shape as its summary, with times in milliseconds like 口播 projects. */
export type GeneralLibraryProject = Omit<GeneralProjectSummary, 'updatedAt' | 'createdAt'> & { updatedAt: number; createdAt: number }

const milliseconds = (iso: string) => { const value = Date.parse(iso); return Number.isFinite(value) ? value : 0 }

export function generalLibraryProject(summary: GeneralProjectSummary): GeneralLibraryProject {
  return { ...summary, kind: 'general', updatedAt: milliseconds(summary.updatedAt), createdAt: milliseconds(summary.createdAt) }
}

export const isGeneralProject = (project: object): project is GeneralLibraryProject => projectKind(project) === 'general'

/** One library for both kinds (S先生: 两种工程放在同一个工程库里), newest first. A general project never comes from the 口播 list. */
export function mergeProjectLibrary<T extends ListedProject & { id: string }>(koubo: readonly T[], general: readonly GeneralProjectSummary[]): (T | GeneralLibraryProject)[] {
  return [...koubo.filter(project => projectKind(project) === 'koubo'), ...general.map(generalLibraryProject)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** How many projects each filter tab holds. */
export function countProjectsByKind(projects: readonly object[]): Record<ProjectKindFilter, number> {
  const counts = { all: projects.length, koubo: 0, general: 0 }
  for (const project of projects) counts[projectKind(project)]++
  return counts
}

/** A stable key across both kinds (a 口播 and a general project could share an id). */
export const libraryKey = (project: { id: string }) => `${projectKind(project)}:${project.id}`

/** 10月24日 within the current year, 2025年10月24日 otherwise (local time). */
export function formatProjectDate(time: number, now = Date.now()) {
  const date = new Date(time)
  const day = `${date.getMonth() + 1}月${date.getDate()}日`
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${date.getFullYear()}年${day}`
}
