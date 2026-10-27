import { createContext, useContext, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
type Guard = () => Promise<unknown>
const activeSaves=new Set<Guard>()
export async function saveCurrentWorkspace(){for(const guard of activeSaves)await guard()}
const Context = createContext<{ current: Guard | null }>({ current: null })
// eslint-disable-next-line react-refresh/only-export-components -- Shares the navigation provider's save guard.
export function useWorkspaceSave() {
  const guard = useContext(Context)
  return async () => { await guard.current?.() }
}
export function WorkspaceNavigationProvider({ children }: { children: ReactNode }) {
  const guard = useRef<Guard | null>(null)
  return <Context.Provider value={guard}>{children}</Context.Provider>
}
// eslint-disable-next-line react-refresh/only-export-components -- Existing editor save hook.
export function useWorkspaceLeaveGuard(guard: Guard) {
  const contextRef = useContext(Context)
  useLayoutEffect(() => { contextRef.current = guard; activeSaves.add(guard); return () => { activeSaves.delete(guard); if (contextRef.current === guard) contextRef.current = null } }, [contextRef, guard])
}
export function WorkspaceLink({ to, onClick, ...props }: Omit<ComponentProps<typeof Link>, 'to'> & { to: string }) {
  const guard = useContext(Context), navigate = useNavigate(), pending = useRef(false)
  return <Link {...props} to={to} onClick={event => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === '_blank') return
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    void Promise.resolve().then(() => guard.current?.()).then(() => navigate(to)).catch(error => toast.error(error instanceof Error ? error.message : '请先完成保存，再切换模块')).finally(() => { pending.current = false })
  }} />
}
