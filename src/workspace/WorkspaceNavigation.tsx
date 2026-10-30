import { WorkspaceLink as Link } from './navigation-guard'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { LayoutGrid } from 'lucide-react'
import { SystemSettings } from '@/settings/SystemSettings'
import { MODULE_ONLY_LABELS, WORKSPACE_MODULES, groupedModules, nextModuleIndex, workspaceModule } from './modules'
import { MODULE_ICONS } from './module-icons'
import './workspace.css'
import {ThemeSwitcher} from './ThemeSwitcher'
import { UsageBadge } from './UsageBadge'
import './workspace-launcher.css'
import { DesktopActions } from '@/desktop/DesktopSession'
import { DeployButton, DeployWizard } from '@/onboarding/DeployWizard'

const moduleGroups = groupedModules()

export function WorkspaceNavigation() {
  const { pathname } = useLocation()
  const current = workspaceModule(pathname)
  useEffect(() => { document.title = `${current?.name || '创作工作台'} · OpenTake` }, [current?.name])
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [active, setActive] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState<{index:number} | null>(null)
  const consumedFocus = useRef<typeof focusIndex>(null)
  const [lastPath,setLastPath]=useState(pathname);
  if(lastPath!==pathname){setLastPath(pathname);setOpen(false);setActive(null);setFocusIndex(null);}
  useEffect(() => {
    if (open && focusIndex !== null && consumedFocus.current!==focusIndex) {
      consumedFocus.current=focusIndex
      panel.current?.querySelectorAll<HTMLAnchorElement>('.workspace-module-capsule')[focusIndex.index]?.focus()
    }
  }, [open, focusIndex])
  const cancelClose = () => { clearTimeout(closeTimer.current); closeTimer.current = undefined }
  const closeDock = () => { setOpen(false); setActive(null); setFocusIndex(null) }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node)) setOpen(false) }
    // The absolutely positioned tray and its origin form one continuous hover region.
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const origin = panel.current?.getBoundingClientRect()
      const tray = dock.current?.getBoundingClientRect()
      if (!origin || !tray) return
      const inside = e.clientX >= Math.min(origin.left, tray.left) - 8
        && e.clientX <= Math.max(origin.right, tray.right) + 8
        && e.clientY >= Math.min(origin.top, tray.top) - 10
        && e.clientY <= Math.max(origin.bottom, tray.bottom) + 8
      if (inside) { clearTimeout(closeTimer.current); closeTimer.current = undefined }
      else if (closeTimer.current === undefined) {
        closeTimer.current = setTimeout(() => {
          closeTimer.current = undefined
          if (!panel.current?.contains(document.activeElement)) { setOpen(false); setActive(null) }
        }, 200)
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('pointermove', move)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('pointermove', move); clearTimeout(closeTimer.current); closeTimer.current = undefined }
  }, [open])
  return <>
    <div id="workspace-nav-ambient-slot" className="workspace-nav-ambient-slot" aria-hidden="true" />
    <header className="workspace-nav">
    <div className="workspace-launcher" data-open={open} ref={panel}
      onPointerEnter={e => { if (e.pointerType === 'mouse') { cancelClose(); setOpen(true) } }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget) && !e.currentTarget.matches(':hover')) closeDock() }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); closeDock(); toggle.current?.focus() }
        if (['ArrowRight', 'ArrowLeft', 'ArrowDown'].includes(e.key)) {
          e.preventDefault(); setOpen(true)
          const links = panel.current?.querySelectorAll<HTMLAnchorElement>('.workspace-module-capsule')
          const index = Array.from(links || []).findIndex(link => link === document.activeElement)
          const next = nextModuleIndex(index, e.key === 'ArrowLeft' ? 'previous' : 'next', links?.length || WORKSPACE_MODULES.length)
          setFocusIndex({index:next})
        }
      }}>
      <Link to="/" className="workspace-brand" aria-label="OpenTake，返回首页" onClick={closeDock}>
        <img className="workspace-brand-icon" src="/opentake-mark.svg" alt="" width="32" height="32" />
        <svg className="workspace-brand-wordmark" viewBox="0 0 226 60" height="22" aria-hidden="true">
          <text x="0" y="44" fontSize="40" fontWeight="400" fill="currentColor" opacity=".72">Open</text>
          <rect className="workspace-brand-t" x="99" y="12" width="26" height="9" rx="4.5" /><rect className="workspace-brand-t" x="108" y="12" width="8" height="38" rx="4" />
          <text x="125" y="44" fontSize="40" fontWeight="600" fill="currentColor">ake</text>
        </svg>
      </Link>
      <button ref={toggle} className="workspace-launcher-toggle" aria-label="切换工作模块" title={current?.name || '全部模块'} aria-expanded={open} aria-controls="workspace-module-menu" onClick={() => { cancelClose(); setOpen(!open); setActive(null) }}><LayoutGrid size={17} /></button>
      <nav ref={dock} id="workspace-module-menu" className="workspace-module-dock" aria-label="切换工作模块" aria-hidden={!open} inert={!open}>
        {moduleGroups.map(group => <div key={group.id} className="workspace-module-group" role="group" aria-label={group.label}>
          <span className="workspace-module-group__label" aria-hidden="true">{group.label}</span>
          {group.modules.map(m => {
            const index = WORKSPACE_MODULES.indexOf(m)
            const Icon = MODULE_ICONS[m.id]
            // Neighbours lift only inside their own group; a group label separates the rest.
            const near = active !== null && Math.abs(active - index) === 1 && WORKSPACE_MODULES[active]?.group === m.group
            return <Link key={m.id} to={m.path} className="workspace-module-capsule" title={m.name} tabIndex={open ? 0 : -1}
              data-proximity={active === index ? 'active' : near ? 'near' : 'idle'}
              aria-current={m.id === current?.id ? 'page' : undefined}
              onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onClick={closeDock}>
              <span className="workspace-module-surface"><Icon size={18} /><span className="workspace-module-name">{m.shortName}{'pro' in m && m.pro === true && <small className="home-only">Pro</small>}{m.only && <small className="workspace-module-only" data-only={m.only}><i aria-hidden="true" />{MODULE_ONLY_LABELS[m.only]}</small>}</span></span>
            </Link>
          })}
        </div>)}
      </nav>
    </div>
    <div id="workspace-project-title-slot" className="workspace-project-title-slot" />
    <div id="workspace-preview-island-slot" className="workspace-preview-island-slot" />
    <div id="workspace-editor-slot" className="workspace-editor-slot" />
    <div className="workspace-global-actions"><DeployButton /><DesktopActions /><UsageBadge /><ThemeSwitcher compact /><SystemSettings /></div>
    <div id="workspace-primary-action-slot" className="workspace-primary-action-slot" />
  </header><DeployWizard /></>
}
