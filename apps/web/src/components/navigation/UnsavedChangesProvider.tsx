'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/ui/Dialogs'

type BeforeNavigate = () => boolean | Promise<boolean>
type LeaveRequest =
  | { kind: 'navigation'; href: string; hard?: boolean; beforeNavigate?: BeforeNavigate }
  | { kind: 'action'; run: () => void | Promise<void> }

type UnsavedChangesContextValue = {
  hasUnsavedChanges: boolean
  setDirty: (scope: string, dirty: boolean) => void
  requestNavigation: (href: string, options?: { hard?: boolean; beforeNavigate?: BeforeNavigate }) => void
  requestAction: (run: () => void | Promise<void>) => void
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null)

function localHref(anchor: HTMLAnchorElement): string | null {
  if (anchor.target && anchor.target !== '_self') return null
  if (anchor.hasAttribute('download') || anchor.dataset.skipUnsavedGuard === 'true') return null
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  return `${url.pathname}${url.search}${url.hash}`
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [dirtyScopes, setDirtyScopes] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<LeaveRequest | null>(null)
  const bypass = useRef(false)
  const hasUnsavedChanges = dirtyScopes.size > 0

  const setDirty = useCallback((scope: string, dirty: boolean) => {
    setDirtyScopes(current => {
      const next = new Set(current)
      if (dirty) next.add(scope)
      else next.delete(scope)
      return next
    })
  }, [])

  const allowLeave = useCallback(() => {
    bypass.current = true
    setDirtyScopes(new Set())
    window.setTimeout(() => { bypass.current = false }, 0)
  }, [])

  const navigate = useCallback(async (request: Extract<LeaveRequest, { kind: 'navigation' }>) => {
    if (request.beforeNavigate) {
      let ready = false
      try { ready = await request.beforeNavigate() } catch { ready = false }
      if (!ready) return
    }
    allowLeave()
    if (request.hard) window.location.assign(request.href)
    else router.push(request.href)
  }, [allowLeave, router])

  const requestNavigation = useCallback((href: string, options?: { hard?: boolean; beforeNavigate?: BeforeNavigate }) => {
    const request = { kind: 'navigation' as const, href, hard: options?.hard, beforeNavigate: options?.beforeNavigate }
    if (!hasUnsavedChanges || bypass.current) void navigate(request)
    else setPending(request)
  }, [hasUnsavedChanges, navigate])

  const requestAction = useCallback((run: () => void | Promise<void>) => {
    if (!hasUnsavedChanges || bypass.current) void run()
    else setPending({ kind: 'action', run })
  }, [hasUnsavedChanges])

  useEffect(() => {
    const protectUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges || bypass.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectUnload)
    return () => window.removeEventListener('beforeunload', protectUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    const protectLink = (event: MouseEvent) => {
      if (!hasUnsavedChanges || bypass.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null
      if (!anchor) return
      const href = localHref(anchor)
      if (!href || href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
      event.preventDefault()
      event.stopPropagation()
      setPending({ kind: 'navigation', href })
    }
    document.addEventListener('click', protectLink, true)
    return () => document.removeEventListener('click', protectLink, true)
  }, [hasUnsavedChanges])

  const value = useMemo(() => ({ hasUnsavedChanges, setDirty, requestNavigation, requestAction }), [hasUnsavedChanges, requestAction, requestNavigation, setDirty])
  return <UnsavedChangesContext.Provider value={value}>
    {children}
    <ConfirmDialog
      isOpen={Boolean(pending)}
      onClose={() => setPending(null)}
      onConfirm={() => {
        const request = pending
        setPending(null)
        if (!request) return
        if (request.kind === 'navigation') void navigate(request)
        else {
          allowLeave()
          void request.run()
        }
      }}
      title="有未保存的更改"
      message="离开后，本页尚未保存的修改将丢失。"
      cancelText="继续编辑"
      confirmText="放弃更改并离开"
      danger
    />
  </UnsavedChangesContext.Provider>
}

export function useUnsavedChanges(scope: string, dirty: boolean) {
  const context = useContext(UnsavedChangesContext)
  if (!context) throw new Error('useUnsavedChanges must be used within UnsavedChangesProvider')
  const setDirty = context.setDirty
  useEffect(() => {
    setDirty(scope, dirty)
    return () => setDirty(scope, false)
  }, [setDirty, dirty, scope])
  return context
}

export function useNavigationGuard() {
  const context = useContext(UnsavedChangesContext)
  if (!context) throw new Error('useNavigationGuard must be used within UnsavedChangesProvider')
  return context
}
