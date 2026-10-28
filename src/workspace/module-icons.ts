import { ChartNoAxesCombined, Film, Library, Lightbulb, Link2, MonitorPlay, Sparkles, SwatchBook, type LucideIcon } from 'lucide-react'
import type { WorkspaceModuleId } from './modules'

/** One icon per module, looked up by id (shared by the module dock and the home page). */
export const MODULE_ICONS: Readonly<Record<WorkspaceModuleId, LucideIcon>> = {
  topics: Lightbulb,
  library: Library,
  reader: Link2,
  screen: MonitorPlay,
  studio: Film,
  motion: Sparkles,
  styles: SwatchBook,
  analytics: ChartNoAxesCombined,
}
