'use client'

import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Link2, LogOut, Menu, PanelLeftClose, ShieldCheck, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth'
import { roleNames, type NavigationRole } from '@/config/navigation'
import { migrateLegacySidebarNavigationPreference, setSidebarNavigationOpen } from '@/lib/auth'
import { SessionUnavailable } from './SessionUnavailable'
import { WorkspaceSwitcher } from '@/features/workspace'
import { NotificationBell } from '@/features/notification'
import { ChatButton } from '@/features/chat'
import { useNavigationGuard } from './navigation/UnsavedChangesProvider'
import { PrimaryNavigation } from './navigation/PrimaryNavigation'
import { UserAvatar } from './user/UserAvatar'
import { navigationHome, resolveNavigationContext } from '@/lib/navigationContext'
import { accountContextMatches, pageLayoutForPath } from '@/lib/applicationShell'
import styles from './AppShell.module.css'
import layoutStyles from './AppShellLayout.module.css'

interface AppShellProps { children: ReactNode; initialSidebarExpanded?: boolean }
const accountPaths = { profile: '/account/profile', security: '/account/security', binding: '/account/platform-bindings' }

export function AppShell({ children, initialSidebarExpanded = true }: AppShellProps) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { requestAction } = useNavigationGuard()
  const shellId = useId()
  const userMenuId = useId()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [isPersistentSidebar, setIsPersistentSidebar] = useState<boolean | null>(null)
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(initialSidebarExpanded)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [navigationMotion, setNavigationMotion] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const navigationContext = resolveNavigationContext(pathname, user)
  const organizationId = navigationContext.organizationId
  const contextKind = navigationContext.workspace

  useEffect(() => {
    if (!user) return
    const migrated = migrateLegacySidebarNavigationPreference(
      user.userId,
      [user.accountRole, user.organizationRole],
      [organizationId || contextKind, contextKind],
    )
    if (migrated) setDesktopSidebarExpanded(migrated === 'open')
  }, [contextKind, organizationId, user?.accountRole, user?.organizationRole, user?.userId])

  useEffect(() => {
    // CSS owns the first responsive frame; this subscription controls interaction only.
    const persistentSidebar = window.matchMedia('(min-width: 1100px)')
    const syncNavigation = () => {
      setNavigationMotion(false)
      setIsPersistentSidebar(persistentSidebar.matches)
      setDrawerOpen(false)
      setShowUserMenu(false)
    }
    syncNavigation()
    persistentSidebar.addEventListener('change', syncNavigation)
    return () => persistentSidebar.removeEventListener('change', syncNavigation)
  }, [])

  useEffect(() => {
    if (isPersistentSidebar || !drawerOpen) return
    const sidebar = sidebarRef.current
    if (!sidebar) return
    const previousOverflow = document.body.style.overflow
    const background = [headerRef.current, mainRef.current].filter((node): node is HTMLElement => Boolean(node))
    const previousInert = background.map(node => node.inert)
    background.forEach(node => { node.inert = true })
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => document.getElementById('app-sidebar-close')?.focus())
    const trapFocus = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Tab') return
      // A confirmation dialog opened above the drawer owns focus until it closes.
      const topDialog = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].at(-1)
      if (topDialog && topDialog !== sidebar) return
      const focusable = [...sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', trapFocus)
      document.body.style.overflow = previousOverflow
      background.forEach((node, index) => { node.inert = previousInert[index] })
      window.requestAnimationFrame(() => {
        const toggle = document.getElementById('app-navigation-toggle')
        if (toggle?.offsetParent !== null) toggle?.focus()
      })
    }
  }, [drawerOpen, isPersistentSidebar])

  useEffect(() => {
    setNavigationMotion(false)
    setShowUserMenu(false)
    if (!isPersistentSidebar) setDrawerOpen(false)
  }, [pathname, isPersistentSidebar])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setShowUserMenu(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return
      if (showUserMenu) {
        event.preventDefault()
        setShowUserMenu(false)
        userMenuRef.current?.querySelector<HTMLButtonElement>('[data-account-trigger]')?.focus()
      } else if (drawerOpen) {
        const topDialog = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].at(-1)
        if (topDialog && topDialog !== sidebarRef.current) return
        event.preventDefault()
        setDrawerOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => { document.removeEventListener('mousedown', handlePointerDown); document.removeEventListener('keydown', handleEscape) }
  }, [showUserMenu, drawerOpen])

  if (!user) return <SessionUnavailable message="当前会话不可用，请重新登录" />
  const role = (navigationContext.workspace === 'organization' ? navigationContext.organizationRole || navigationContext.accountRole : navigationContext.accountRole) as NavigationRole
  const roleName = roleNames[role] || user.accountRole
  const isPersonal = contextKind === 'personal'
  const contextReady = accountContextMatches(pathname, user)
  const profile = user.profile as { name?: string } | undefined
  const visibleName = isPersonal || !contextReady ? user.username : profile?.name || user.username
  const userContext = isPersonal ? '个人账号' : `@${user.username}`
  const navigationLabel = `${isPersonal ? '个人' : roleName}主导航`
  const navigationOpen = isPersistentSidebar === false ? drawerOpen : desktopSidebarExpanded
  const navigationMode = isPersistentSidebar === null ? 'pending' : isPersistentSidebar ? (desktopSidebarExpanded ? 'expanded' : 'collapsed') : (drawerOpen ? 'drawer' : 'closed')
  const sidebarHidden = isPersistentSidebar === false ? !drawerOpen : false
  const compactWorkspaceSwitcher = isPersistentSidebar !== false && !desktopSidebarExpanded
  const setNavigationOpen = (open: boolean) => {
    setNavigationMotion(true)
    if (window.matchMedia('(min-width: 1100px)').matches) {
      setDesktopSidebarExpanded(open)
      setSidebarNavigationOpen(user.userId, user.accountRole, organizationId || contextKind, open)
    } else setDrawerOpen(open)
    if (!open) setShowUserMenu(false)
  }

  const userMenu = <div className={styles.userMenuRoot} ref={userMenuRef}>
    <Button variant="ghost" type="button" className={styles.accountCard} data-account-trigger onClick={() => {
      setShowUserMenu(current => !current)
      if (!showUserMenu) window.requestAnimationFrame(() => userMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
    }} aria-expanded={showUserMenu} aria-controls={userMenuId} aria-haspopup="menu" aria-label="打开账号菜单">
      <UserAvatar avatar={user.avatar} username={user.username} name={visibleName} decorative />
      <span className={styles.userText}><span className={styles.userName}>{visibleName}</span><span className={styles.userContext}>{userContext}</span></span>
      <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
    </Button>
    {showUserMenu && <div id={userMenuId} className={styles.userMenu} role="menu" onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      if (!items.length) return
      event.preventDefault()
      const index = items.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
      items[next]?.focus()
    }}>
      <Link className={styles.menuItem} href={accountPaths.profile} role="menuitem" onClick={() => setShowUserMenu(false)}><UserRound size={17} aria-hidden="true" />个人信息</Link>
      <Link className={styles.menuItem} href={accountPaths.security} role="menuitem" onClick={() => setShowUserMenu(false)}><ShieldCheck size={17} aria-hidden="true" />账号安全</Link>
      <Link className={styles.menuItem} href={accountPaths.binding} role="menuitem" onClick={() => setShowUserMenu(false)}><Link2 size={17} aria-hidden="true" />平台绑定</Link>
      <div className={styles.menuDivider} />
      <Button variant="ghost" className={`${styles.menuItem} ${styles.logoutItem}`} type="button" role="menuitem" onClick={() => requestAction(logout)}><LogOut size={17} aria-hidden="true" />退出登录</Button>
    </div>}
  </div>

  return <div className={styles.shell} data-app-shell={shellId} data-navigation-mode={navigationMode} data-desktop-sidebar={desktopSidebarExpanded ? 'expanded' : 'collapsed'} data-drawer-open={drawerOpen} data-navigation-motion={navigationMotion} onTransitionEnd={event => {
    if (event.target === sidebarRef.current && (event.propertyName === 'transform' || event.propertyName === 'width')) setNavigationMotion(false)
  }}>
    <header ref={headerRef} className={styles.header} data-app-header>
      <div className={styles.headerInner}>
        <div className={styles.headerStart}>
          <Button id="app-navigation-toggle" variant="ghost" type="button" className={styles.navigationToggle} onClick={() => setNavigationOpen(!(window.matchMedia('(min-width: 1100px)').matches ? desktopSidebarExpanded : drawerOpen))} aria-controls="app-sidebar" aria-expanded={isPersistentSidebar === null ? undefined : navigationOpen} aria-label={isPersistentSidebar && navigationOpen ? '收起导航' : '显示导航'} title={isPersistentSidebar && navigationOpen ? '收起导航' : '显示导航'}><Menu size={21} aria-hidden="true" /></Button>
          <Link className={styles.brandLink} href={navigationHome(navigationContext)} aria-label="返回首页"><img className={styles.logo} src="/logo.png" alt="Carits" /></Link>
        </div>
        <div className={styles.headerEnd}><ChatButton /><NotificationBell /></div>
      </div>
    </header>
    {!isPersistentSidebar && drawerOpen && <div className={styles.sidebarBackdrop} data-navigation-backdrop aria-hidden="true" onClick={() => setNavigationOpen(false)} />}
    <aside ref={sidebarRef} id="app-sidebar" className={styles.sidebar} aria-label={navigationLabel} aria-hidden={sidebarHidden} role={!isPersistentSidebar && drawerOpen ? 'dialog' : undefined} aria-modal={!isPersistentSidebar && drawerOpen ? true : undefined}>
      <div className={styles.sidebarHeader}><span>功能导航</span><Button id="app-sidebar-close" variant="ghost" type="button" className={styles.sidebarClose} onClick={() => setNavigationOpen(false)} aria-label={isPersistentSidebar ? '收起导航' : '关闭导航'} title={isPersistentSidebar ? '收起导航' : '关闭导航'}><PanelLeftClose size={19} aria-hidden="true" /></Button></div>
      <div className={styles.sidebarWorkspace}><WorkspaceSwitcher compact={compactWorkspaceSwitcher} /></div>
      <PrimaryNavigation label={navigationLabel} onNavigate={() => { if (!isPersistentSidebar) setNavigationOpen(false) }} />
      <div className={styles.sidebarFooter}>{userMenu}</div>
    </aside>
    <main ref={mainRef} className={styles.main} data-app-content><div className={`${styles.mainInner} ${layoutStyles.content}`} data-page-host data-layout={pageLayoutForPath(pathname)}>{children}</div></main>
  </div>
}
