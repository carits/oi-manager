'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { Check, ChevronDown, Plus, Search, School, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '@/features/auth'
import type { WorkspaceSummary } from '@oi-manager/contracts'
import { isGlobalAdministrator } from '@/lib/capabilities'
import { nextWorkspaceFocusIndex, workspaceHref, workspaceModule, workspaceRoleLabel, type WorkspaceFocusKey } from '../model/workspaceRouting'
import { useWorkspaceDirectory } from '../model/useWorkspaceDirectory'
import { filterWorkspaces, isCurrentWorkspace, workspaceSubtitle, workspaceTitle } from '../model/workspacePresentation'
import styles from './WorkspaceSwitcher.module.css'
import { useNavigationGuard } from '@/components/navigation/UnsavedChangesProvider'
import { resolveNavigationContext } from '@/lib/navigationContext'
import { accountContextMatches } from '@/lib/applicationShell'

const emptyWorkspaces: WorkspaceSummary[] = []

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { user, prepareWorkspaceTransition } = useAuth()
  const toast = useToast()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isGlobalAdmin = isGlobalAdministrator(user?.accountRole)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [switchingKey, setSwitchingKey] = useState<string | null>(null)
  const [directoryEnabled, setDirectoryEnabled] = useState(false)
  const directory = useWorkspaceDirectory(user?.userId, directoryEnabled && !isGlobalAdmin)
  const workspaces = directory.data?.workspaces || emptyWorkspaces
  const loaded = Boolean(directory.data)
  const loading = directory.isLoading
  const loadError = directory.error?.message || ''
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const openRef = useRef(false)
  const initialFocusRef = useRef<'first' | 'last'>('first')
  const popoverId = useId()
  const titleId = useId()
  const { requestNavigation } = useNavigationGuard()
  const currentOrganization = resolveNavigationContext(pathname, user).organizationId
  const contextReady = accountContextMatches(pathname, user)
  const username = user?.username || ''
  const visible = useMemo(() => filterWorkspaces(workspaces, query, username), [query, username, workspaces])
  const shouldSearch = loaded && workspaces.filter(item => item.type === 'organization').length > 5
  const personalWorkspace = workspaces.find(item => item.type === 'personal')
  openRef.current = open

  const positionPopover = useCallback(() => {
    const trigger = rootRef.current?.querySelector<HTMLButtonElement>('[data-workspace-trigger]')
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const desktop = window.matchMedia('(min-width: 1100px)').matches
    const gap = desktop ? 20 : 8
    const left = desktop ? rect.right + gap : Math.max(16, rect.left)
    const top = desktop ? Math.max(16, rect.top) : rect.bottom + gap
    const availableWidth = Math.max(240, window.innerWidth - left - 16)
    const popover = popoverRef.current
    if (!popover) return
    popover.style.top = `${top}px`
    popover.style.left = `${left}px`
    popover.style.width = `${Math.min(360, availableWidth)}px`
    popover.style.maxHeight = `${Math.max(240, window.innerHeight - top - 16)}px`
  }, [])

  const focusTrigger = useCallback(() => { rootRef.current?.querySelector<HTMLButtonElement>('[aria-controls]')?.focus() }, [])
  const closeSwitcher = useCallback((restoreFocus = false) => {
    setOpen(false)
    setQuery('')
    if (restoreFocus) window.requestAnimationFrame(focusTrigger)
  }, [focusTrigger])
  const focusPopover = useCallback(() => {
    const popover = popoverRef.current
    if (!popover) return
    const options = Array.from(popover.querySelectorAll<HTMLButtonElement>('[data-workspace-option="true"]:not(:disabled)'))
    const target = initialFocusRef.current === 'last' ? options.at(-1)
      : shouldSearch ? popover.querySelector<HTMLInputElement>('input[type="search"]') : options[0]
    ;(target || popover.querySelector<HTMLButtonElement>('button:not(:disabled)') || popover).focus()
    initialFocusRef.current = 'first'
  }, [shouldSearch])
  const openSwitcher = async (initialFocus: 'first' | 'last' = 'first') => {
    initialFocusRef.current = initialFocus
    setDirectoryEnabled(true)
    setOpen(true)
    if (loaded || directory.refreshing || !directoryEnabled) return
    await directory.retry()
  }
  useEffect(() => { closeSwitcher() }, [closeSwitcher, pathname, user?.userId])
  useEffect(() => {
    if (!open) return
    positionPopover()
    const frame = window.requestAnimationFrame(() => {
      if (loading) popoverRef.current?.focus()
      else focusPopover()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusPopover, loaded, loading, open, positionPopover])
  useEffect(() => {
    if (!open) return
    const update = () => positionPopover()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, positionPopover])
  useEffect(() => {
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (openRef.current && rootRef.current && !rootRef.current.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) closeSwitcher()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || !openRef.current) return
      const topDialog = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].at(-1)
      const containingDialog = rootRef.current?.closest<HTMLElement>('[aria-modal="true"]')
      if (topDialog && topDialog !== containingDialog) return
      event.preventDefault()
      closeSwitcher(true)
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => { document.removeEventListener('mousedown', closeOnOutsidePointer); document.removeEventListener('keydown', closeOnEscape, true) }
  }, [closeSwitcher])

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    void openSwitcher(event.key === 'ArrowUp' ? 'last' : 'first')
  }
  const handlePopoverKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const supported = ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const
    if (!supported.includes(event.key as typeof supported[number])) return
    if (event.target instanceof HTMLInputElement && (event.key === 'Home' || event.key === 'End')) return
    const options = Array.from(popoverRef.current?.querySelectorAll<HTMLButtonElement>('[data-workspace-option="true"]:not(:disabled)') || [])
    const nextIndex = nextWorkspaceFocusIndex(options.indexOf(document.activeElement as HTMLButtonElement), options.length, event.key as WorkspaceFocusKey)
    if (nextIndex < 0) return
    event.preventDefault()
    options[nextIndex]?.focus()
  }
  const select = (workspace: WorkspaceSummary) => {
    if (isCurrentWorkspace(workspace, currentOrganization)) { closeSwitcher(true); return }
    const targetKey = workspace.organizationId || workspace.type
    const href = workspaceHref(workspace, workspaceModule(pathname), searchParams.toString())
    focusTrigger()
    closeSwitcher()
    requestNavigation(href, {
      beforeNavigate: async () => {
        setSwitchingKey(targetKey)
        try {
          await prepareWorkspaceTransition(workspace)
          return true
        } catch (error) {
          toast.error(publicErrorMessage(error, '目标工作区暂时无法进入，请重试'))
          return false
        } finally {
          setSwitchingKey(current => current === targetKey ? null : current)
        }
      },
    })
  }
  if (isGlobalAdmin) return null
  const title = !contextReady ? '确认工作区…' : currentOrganization ? user?.organizationName || '当前学校' : '个人空间'
  const subtitle = !contextReady ? '' : currentOrganization ? workspaceRoleLabel(user?.organizationRole) : username
  return <div className={styles.root} ref={rootRef} data-compact={compact || undefined}>
    <Button variant="ghost" className={styles.trigger} type="button" data-workspace-trigger onClick={() => { if (open) closeSwitcher(); else void openSwitcher() }} onKeyDown={handleTriggerKeyDown}
      aria-expanded={open} aria-controls={popoverId} aria-label={`切换工作区，当前${title}${subtitle ? `，${subtitle}` : ''}`} title={compact ? `${title}${subtitle ? ` · ${subtitle}` : ''}` : undefined}>
      <span className={styles.badge}>{currentOrganization ? <School size={17} /> : <UserRound size={17} />}</span>
      <span className={styles.currentText}><strong>{title}</strong><small>{subtitle}</small></span><ChevronDown size={16} />
    </Button>
    {open && typeof document !== 'undefined' && createPortal(<section ref={popoverRef} id={popoverId} className={styles.menu} data-sidebar-portal="workspace" role="region" aria-labelledby={titleId} tabIndex={-1} onKeyDown={handlePopoverKeyDown}>
      <header><strong id={titleId}>切换工作区</strong></header>
      {shouldSearch && <label className={styles.search}><Search size={16} aria-hidden="true" /><Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索学校或个人空间" aria-label="搜索工作区" /></label>}
      <div className={styles.list}>
        {loading && <p className={styles.empty} role="status">正在加载工作区列表…</p>}
        {loadError && <div className={styles.empty} role="alert"><p>工作区列表加载失败，当前身份不会改变。{loadError}</p><Button size="sm" variant="outline" type="button" onClick={() => void directory.retry()}>重新加载</Button></div>}
        {!loading && loaded && visible.map(item => { const itemKey = item.organizationId || item.type; return <Button variant="ghost" key={itemKey} className={styles.item} type="button" data-workspace-option="true" onClick={() => select(item)} disabled={switchingKey !== null} aria-busy={switchingKey === itemKey}>
          <span className={styles.itemBadge}>{item.type === 'platform' ? <ShieldCheck size={17} /> : item.type === 'personal' ? <UserRound size={17} /> : <School size={17} />}</span>
          <span><strong>{workspaceTitle(item)}</strong><small>{workspaceSubtitle(item, username)}</small></span>
          {isCurrentWorkspace(item, currentOrganization) && <Check className={styles.check} size={17} />}
        </Button> })}
        {!loading && loaded && !loadError && !visible.length && <p className={styles.empty}>没有匹配的工作区</p>}
      </div>
      <div className={styles.footer}><Button variant="ghost" className={styles.joinAction} type="button" data-workspace-option="true" disabled={switchingKey !== null || !personalWorkspace} onClick={() => {
        if (!personalWorkspace) return
        focusTrigger(); closeSwitcher()
        requestNavigation('/personal/organizations', { beforeNavigate: async () => {
          setSwitchingKey('personal')
          try { await prepareWorkspaceTransition(personalWorkspace); return true }
          catch (error) { toast.error(publicErrorMessage(error, '个人空间暂时无法进入，请重试')); return false }
          finally { setSwitchingKey(current => current === 'personal' ? null : current) }
        } })
      }}><Plus size={17} /><span>加入或创建学校</span></Button></div>
    </section>, document.body)}
  </div>
}
