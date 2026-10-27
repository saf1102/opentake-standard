  export type TextItem = { id: string; start: number; end: number; text: string; role?: string; preset: string; place?: string; reveal?: string; size?: string; rotate?: number }
  export const SIZE_FACTOR: Record<string, number>
  export function presetForRole<T>(preset: T, role?: string): T
  export function renderTextLayer(root: HTMLElement, items: TextItem[], t: number, options: { width: number; height: number; presets: Record<string, unknown>; fallback?: string }): void
