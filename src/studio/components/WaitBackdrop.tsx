import { LoginBackdrop } from '@/desktop/LoginBackdrop'

/** The sign-in page's studio shot, playing behind the editor's long waits (rough cut, smart motion, placement, export).
 *  Put it first inside a backdrop marked `wait-host`; the dialog floats over it as glass. */
export function WaitBackdrop() {
  return <LoginBackdrop variant="wait" src="/login/studio.mp4" poster="/login/studio-poster.jpg" />
}
