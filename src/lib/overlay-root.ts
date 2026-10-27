import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Where floating layers (menus, the in-place text editor) attach: the element shown full screen when there is one —
 *  the browser draws nothing outside it, so a menu on the page would open unseen — otherwise the page itself. */
export function overlayRoot(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null) ?? document.body
}

/** A layer rendered where it is, except while something is full screen: then inside that, so it can be seen. */
export function withinFullscreen(node: ReactNode): ReactNode {
  const root = document.fullscreenElement
  return root ? createPortal(node, root) : node
}
