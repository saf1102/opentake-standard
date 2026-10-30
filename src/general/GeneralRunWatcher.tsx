import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { GeneralRunState } from './general-contract'
import { generalApi } from './general-api'
import { generalProjectHref, runNotices, runStateActive, type RunNotice } from './general-logic'

const POLL_MS = 6000

/**
 * Runs keep going after the person leaves the work page. While any general project is working this reads the library
 * every few seconds; when one finishes, fails or asks to reach the network it tells the person: a 系统通知 when the
 * window is in the background, a toast when they are elsewhere in the app, nothing when they are watching that project.
 * It also refreshes the library views so their cards show the new state. Idle otherwise; a started run nudges it.
 */
export function GeneralRunWatcher() {
  const navigate = useNavigate()
  const navigation = useRef(navigate)
  navigation.current = navigate
  const { pathname } = useLocation()
  const path = useRef(pathname)
  path.current = pathname

  useEffect(() => {
    let alive = true, timer = 0, busy = false, again = false
    let known: Map<string, GeneralRunState | undefined> | null = null
    const open = (id: string) => navigation.current(generalProjectHref(id))
    const tell = (notice: RunNotice) => {
      const focused = document.hasFocus()
      if (focused && path.current === generalProjectHref(notice.id)) return
      if (!focused && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const shown = new Notification(notice.title, { body: notice.body, tag: `opentake-general-${notice.id}` })
          shown.onclick = () => { window.focus(); open(notice.id); shown.close() }
          return
        } catch { /* fall back to the in-app toast */ }
      }
      toast(notice.title, { description: notice.body, action: { label: '去看看', onClick: () => open(notice.id) } })
    }
    const poll = async () => {
      if (busy) { again = true; return }
      busy = true
      window.clearTimeout(timer)
      try {
        const list = await generalApi.list()
        if (!alive) return
        const changed = !!known && list.some(project => known!.get(project.id) !== project.runState)
        if (known) runNotices(known, list).forEach(tell)
        known = new Map(list.map(project => [project.id, project.runState]))
        if (changed) window.dispatchEvent(new Event('workspace-projects-changed'))
        if (list.some(project => runStateActive(project.runState))) timer = window.setTimeout(() => void poll(), POLL_MS)
      } catch {
        // A temporary service failure must not silence a run already being watched.
        if (alive && known && [...known.values()].some(runStateActive)) timer = window.setTimeout(() => void poll(), POLL_MS)
      }
      finally {
        busy = false
        if (again && alive) { again = false; void poll() }
      }
    }
    const nudge = () => void poll()
    window.addEventListener('general-runs-changed', nudge)
    void poll()
    return () => { alive = false; window.clearTimeout(timer); window.removeEventListener('general-runs-changed', nudge) }
  }, [])
  return null
}
