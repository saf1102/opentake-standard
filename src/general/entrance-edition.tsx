import allowed from '@/standard/styles.json'
import categoryStyles from '@/standard/category-styles.json'
export {ProStyleDialog as EntranceUpgrade} from '@/standard/ProStyleDialog'
export type Handoff = {text?: string; draft?: never}
export const entranceHasFreeStyle = false
export const entranceCountSuffix = ' · 10 个可用'
export const categoryAllowed = (index: number, id: string) => allowed.includes(id) && ((categoryStyles as Record<string, string[]>)[String(index)] || []).includes(id)
export function Composer(_props: {handoff?: Handoff}) { return null }
export function EntranceHandoff(_props: {handoff: Handoff; onDrop: () => void}) { return null }
