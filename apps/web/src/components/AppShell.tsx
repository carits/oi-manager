'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { BookOpenText, ChevronDown, Link2, LogOut, Menu, PanelLeftClose, PenLine, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { getNavConfig, getActiveNavItem, roleNames, NavigationRole } from '@/config/navigation'
import { getSidebarNavigationPreference, setSidebarNavigationOpen } from '@/lib/auth'
import { isGlobalAdministrator } from '@/lib/capabilities'
import { SessionUnavailable } from './SessionUnavailable'
import { WorkspaceSwitcher } from '@/features/workspace'
import { NotificationBell } from '@/features/notification'
import { ChatButton } from '@/features/chat'
import { UserAvatar } from '@/components/user/UserAvatar'
import styles from './AppShell.module.css'
import { navigationHome, resolveNavigationContext } from '@/lib/navigationContext'
import { getNavigationIcon } from '@/config/navigationIcons'

interface AppShellProps { children: ReactNode }

const accountPaths = {
  profile: '/account/profile',
  security: '/account/security',
  binding: '/account/platform-bindings',
}

function isWorkbenchPath(pathname: string): boolean {
  return /\/(trainings|submissions)\/[^/]+$/.test(pathname) || /\/problems\/[^/]+$/.test(pathname)
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { user, logout } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [isPersistentSidebar, setIsPersistentSidebar] = useState(false)
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const navigationContext = resolveNavigationContext(pathname, user)
  const organizationId = navigationContext.organizationId
  const contextKind = navigationContext.workspace

  useEffect(() => {
    if (!user) return
    const contextKey = organizationId || contextKind
    const persistentSidebar = window.matchMedia('(min-width: 1100px)')
    const syncNavigation = () => {
      const persistent = persistentSidebar.matches
      setIsPersistentSidebar(persistent)
      setDrawerOpen(false)
      if (!persistent) return

      const preference = getSidebarNavigationPreference(user.userId, user.accountRole, contextKey)
      setDesktopSidebarExpanded(preference === null ? true : preference === 'open')
    }
    syncNavigation()
    persistentSidebar.addEventListener('change', syncNavigation)
    setShowUserMenu(false)
    return () => {
      persistentSidebar.removeEventListener('change', syncNavigation)
    }
  }, [organizationId, contextKind, user?.accountRole, user?.userId])

  useEffect(() => {
    if (isPersistentSidebar || !drawerOpen) return
    const sidebar = sidebarRef.current
    if (!sidebar) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => document.getElementById('app-sidebar-close')?.focus())
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = [...sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', trapFocus)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => {
        const toggle = document.getElementById('app-navigation-toggle')
        if (toggle?.offsetParent !== null) toggle?.focus()
      })
    }
  }, [drawerOpen, isPersistentSidebar])

  useEffect(() => {
    if (!isPersistentSidebar) setDrawerOpen(false)
  }, [pathname, isPersistentSidebar])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setShowUserMenu(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showUserMenu) setShowUserMenu(false)
      else if (drawerOpen) setDrawerOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showUserMenu, drawerOpen])

  if (!user) return <SessionUnavailable message="当前会话不可用，请重新登录" />

  const accountRole = user.accountRole as NavigationRole
  const context = contextKind
  const isGlobalAdmin = isGlobalAdministrator(accountRole)
  const role = (navigationContext.workspace === 'organization'
    ? navigationContext.organizationRole || navigationContext.accountRole
    : navigationContext.accountRole) as NavigationRole
  const navConfig = getNavConfig(role, context)
  const resolvedNavConfig = organizationId ? {
    ...navConfig,
    items: navConfig.items.map(item => ({ ...item, href: item.scope === 'global' ? item.href : `/org/${organizationId}/${item.href}` })),
  } : navConfig
  const activeItem = getActiveNavItem(pathname, role, context)
  const isPersonal = context === 'personal'
  const roleName = roleNames[role] || user.accountRole
  const profile = user.profile as { name?: string } | undefined
  const visibleName = isPersonal ? user.username : profile?.name || user.username
  const userContext = isPersonal ? '个人账号' : `@${user.username}`

  const navigationOpen = isPersistentSidebar ? desktopSidebarExpanded : drawerOpen
  const navigationMode = isPersistentSidebar
    ? (desktopSidebarExpanded ? 'expanded' : 'collapsed')
    : (drawerOpen ? 'drawer' : 'closed')

  const setNavigationOpen = (open: boolean) => {
    if (isPersistentSidebar) {
      setDesktopSidebarExpanded(open)
      setSidebarNavigationOpen(user.userId, user.accountRole, organizationId || context, open)
    } else {
      setDrawerOpen(open)
    }
    if (!open) setShowUserMenu(false)
  }

  const navGroups = resolvedNavConfig.items.reduce<Array<{ label: string | null; items: typeof resolvedNavConfig.items }>>((groups, item) => {
    const label = item.group || null
    const current = groups.at(-1)
    if (!current || current.label !== label) groups.push({ label, items: [item] })
    else current.items.push(item)
    return groups
  }, [])

  const renderNavLink = (item: (typeof resolvedNavConfig.items)[number]) => {
    const Icon = getNavigationIcon(item.label)
    const href = item.href
    const hrefPath = href.split('?')[0]
    const hrefSearch = href.includes('?') ? new URLSearchParams(href.slice(href.indexOf('?') + 1)) : null
    const pathMatches = pathname === hrefPath || pathname.startsWith(`${hrefPath}/`)
    const exactQueryMatches = hrefSearch ? [...hrefSearch.entries()].every(([key, value]) => searchParams.get(key) === value) : true
    const anotherItemMatchesQuery = !hrefSearch && resolvedNavConfig.items.some(other => {
      const [otherPath, otherQuery] = other.href.split('?')
      if (otherPath !== hrefPath || !otherQuery) return false
      return [...new URLSearchParams(otherQuery).entries()].every(([key, value]) => searchParams.get(key) === value)
    })
    const current = organizationId
      ? pathMatches && exactQueryMatches && !anotherItemMatchesQuery
      : activeItem === item.label
    return (
      <Link key={item.href} href={href} className={styles.sidebarLink} aria-current={current ? 'page' : undefined} title={item.label} onClick={() => { if (!isPersistentSidebar) setNavigationOpen(false) }}>
        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    )
  }

  const userMenu = (
    <div className={styles.userMenuRoot} ref={userMenuRef}>
      <Button variant="ghost" type="button" className={styles.accountCard} onClick={() => setShowUserMenu(current => !current)} aria-expanded={showUserMenu} aria-haspopup="menu" aria-label="打开账号菜单">
        <UserAvatar avatar={user.avatar} username={user.username} name={visibleName} decorative />
        <span className={styles.userText}><span className={styles.userName}>{visibleName}</span><span className={styles.userContext}>{userContext}</span></span>
        <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
      </Button>
      {showUserMenu && (
        <div className={styles.userMenu} role="menu">
          <Link className={styles.menuItem} href={accountPaths.profile} role="menuitem" onClick={() => setShowUserMenu(false)}><UserRound size={17} aria-hidden="true" />个人信息</Link>
          <Link className={styles.menuItem} href={accountPaths.security} role="menuitem" onClick={() => setShowUserMenu(false)}><ShieldCheck size={17} aria-hidden="true" />账号安全</Link>
          <Link className={styles.menuItem} href={accountPaths.binding} role="menuitem" onClick={() => setShowUserMenu(false)}><Link2 size={17} aria-hidden="true" />平台绑定</Link>
          <Link className={styles.menuItem} href="/blog" role="menuitem" onClick={() => setShowUserMenu(false)}><BookOpenText size={17} aria-hidden="true" />知识广场</Link>
          {!isGlobalAdmin && <Link className={styles.menuItem} href="/personal/blogs" role="menuitem" onClick={() => setShowUserMenu(false)}><PenLine size={17} aria-hidden="true" />我的文章</Link>}
          {!isGlobalAdmin && <Link className={styles.menuItem} href="/identity" role="menuitem" onClick={() => setShowUserMenu(false)}><UsersRound size={17} aria-hidden="true" />切换身份</Link>}
          <div className={styles.menuDivider} />
          <Button variant="ghost" className={`${styles.menuItem} ${styles.logoutItem}`} type="button" role="menuitem" onClick={() => void logout()}><LogOut size={17} aria-hidden="true" />退出登录</Button>
        </div>
      )}
    </div>
  )

  return (
    <div className={`${styles.shell} ${navigationOpen ? styles.shellSidebarOpen : ''}`} data-navigation-mode={navigationMode}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerStart}>
            <Button id="app-navigation-toggle" variant="ghost" type="button" className={styles.navigationToggle} onClick={() => setNavigationOpen(!navigationOpen)} aria-controls="app-sidebar" aria-expanded={navigationOpen} aria-label="显示导航" title="显示导航">
              <Menu size={21} aria-hidden="true" />
            </Button>
            <Link className={styles.brandLink} href={navigationHome(navigationContext)} aria-label="返回首页"><img className={styles.logo} src="/logo.png" alt="Carits" /></Link>
          </div>
          <div className={styles.headerEnd}>
            <ChatButton />
            <NotificationBell />
            <WorkspaceSwitcher />
          </div>
        </div>
      </header>
      {!isPersistentSidebar && drawerOpen && <div className={styles.sidebarBackdrop} data-navigation-backdrop aria-hidden="true" onClick={() => setNavigationOpen(false)} />}
      <aside ref={sidebarRef} id="app-sidebar" className={`${styles.sidebar} ${navigationOpen ? styles.sidebarOpen : ''}`} aria-label={`${isPersonal ? '个人' : roleName}主导航`} aria-hidden={!navigationOpen} role={!isPersistentSidebar && drawerOpen ? 'dialog' : undefined} aria-modal={!isPersistentSidebar && drawerOpen ? true : undefined}>
        <div className={styles.sidebarHeader}>
          <Link className={styles.sidebarBrandLink} href={navigationHome(navigationContext)} aria-label="返回首页" onClick={() => { if (!isPersistentSidebar) setNavigationOpen(false) }}><img className={styles.logo} src="/logo.png" alt="Carits" /></Link>
          <Button id="app-sidebar-close" variant="ghost" type="button" className={styles.sidebarClose} onClick={() => setNavigationOpen(false)} aria-label={isPersistentSidebar ? '收起导航' : '关闭导航'} title={isPersistentSidebar ? '收起导航' : '关闭导航'}><PanelLeftClose size={19} aria-hidden="true" /></Button>
        </div>
        <nav className={styles.sidebarNav} aria-label={`${isPersonal ? '个人' : roleName}主导航`}>
          {navGroups.map((group, index) => <div className={styles.navGroup} key={`${group.label || 'primary'}-${index}`}>
            {group.label && <p className={styles.navGroupLabel}>{group.label}</p>}
            <div className={styles.navGroupLinks}>{group.items.map(renderNavLink)}</div>
          </div>)}
        </nav>
        <div className={styles.sidebarFooter}>{userMenu}</div>
      </aside>
      <main className={styles.main} data-app-content><div className={styles.mainInner} data-page-host data-layout={isWorkbenchPath(pathname) ? 'workbench' : 'default'}>{children}</div></main>
    </div>
  )
}
