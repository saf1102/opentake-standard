/** Eight workspace modules in three groups. The home page and the module dock read this one list, in this order. */
export type WorkspaceModuleGroup = 'prepare' | 'make' | 'review'
export type WorkspaceModuleOnly = 'koubo' | 'general'
export type WorkspaceModuleId = 'topics' | 'library' | 'reader' | 'screen' | 'studio' | 'motion' | 'styles' | 'analytics'
export type WorkspaceModule = {
  readonly id: WorkspaceModuleId
  readonly path: string
  readonly name: string
  readonly shortName: string
  readonly description: string
  /** One short line for the home module card. */
  readonly brief: string
  readonly pro?: boolean
  readonly group: WorkspaceModuleGroup
  /** Set only when the module serves one kind of editing. */
  readonly only?: WorkspaceModuleOnly
}

/** The general-editing entrance: /general starts a new project (① 选风格 → ② 放素材); /general/projects/:id is its work page. */
export const GENERAL_EDIT_PATH = '/general'

export const MODULE_GROUPS: readonly { readonly id: WorkspaceModuleGroup; readonly label: string }[] = [
  { id: 'prepare', label: '准备' },
  { id: 'make', label: '制作' },
  { id: 'review', label: '发布与复盘' },
]

export const MODULE_ONLY_LABELS: Readonly<Record<WorkspaceModuleOnly, string>> = { koubo: '口播专用', general: '通用专用' }

export const WORKSPACE_MODULES: readonly WorkspaceModule[] = [
  { id: 'topics', pro: true, path: '/pro/topics', name: 'AI智能选题库', shortName: '智能选题', description: '同步飞书选题与分析维度，阅读研究资料。', brief: '同步选题和研究资料', group: 'prepare' },
  { id: 'reader', pro: true, path: '/pro/reader', name: '链接读取器', shortName: '链接读取', description: '从链接获取正文与视频，整理可用内容。', brief: '从链接取正文和视频', group: 'prepare' },
  { id: 'screen', path: '/screen-motion', name: '录屏运镜工作台', shortName: '录屏运镜', description: '编辑录屏、安排镜头，制作清晰的操作演示。', brief: '剪录屏，排镜头', group: 'prepare' },
  { id: 'studio', path: '/studio', name: '剪辑台', shortName: '剪辑台', description: '通用剪辑工程都在这里。', brief: '通用剪辑和全部工程', group: 'make' },
  { id: 'motion', pro: true, path: '/pro/motion', name: '动效库', shortName: '动效库', description: '预览、比较和挑选动效卡。', brief: '预览、挑选动效卡', group: 'make', only: 'koubo' },
  { id: 'styles', path: '/styles', name: '风格库', shortName: '风格库', description: '预览和挑选通用剪辑的视频风格。', brief: '56 种视频风格', group: 'make', only: 'general' },
  { id: 'library', pro: true, path: '/pro/publish', name: '文案发布', shortName: '文案发布', description: '写稿、审核、标题简介和封面，最后一键填进各平台发布页。', brief: '写好稿子，发出去', group: 'review' },
  { id: 'analytics', pro: true, path: '/pro/analytics', name: '自媒体运营分析台', shortName: '运营分析', description: '对照内容数据与历史快照，复盘运营表现。', brief: '对照数据做复盘', group: 'review' },
]

export function workspaceModuleById(id: WorkspaceModuleId) {
  return WORKSPACE_MODULES.find(m => m.id === id)
}

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`)

export function workspaceModule(pathname: string) {
  if (pathname === '/studio/motion-lab') return workspaceModuleById('motion')
  // 参考资料池 (the former 文案素材库 page) belongs to 文案发布.
  if (pathname === '/library') return workspaceModuleById('library')
  // General editing is the second entrance of 剪辑台.
  if (within(pathname, GENERAL_EDIT_PATH)) return workspaceModuleById('studio')
  return WORKSPACE_MODULES.find(m => within(pathname, m.path))
}

/** Groups in display order, each with its modules in list order. */
export function groupedModules() {
  return MODULE_GROUPS.map(group => ({ ...group, modules: WORKSPACE_MODULES.filter(m => m.group === group.id) }))
}

/** Arrow-key focus across all module capsules, wrapping at both ends. `current` is -1 when no capsule has focus. */
export function nextModuleIndex(current: number, direction: 'previous' | 'next', total: number) {
  if (total <= 0) return -1
  if (direction === 'previous') return current <= 0 || current >= total ? total - 1 : current - 1
  return current < 0 || current >= total - 1 ? 0 : current + 1
}
