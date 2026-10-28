/** ⌘ on a Mac, Ctrl elsewhere: the key held to drag a selection on the player. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
export const QUOTE_KEY = IS_MAC ? '⌘' : 'Ctrl'
