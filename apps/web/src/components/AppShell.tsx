'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Activity, BookOpen, ChevronDown, ClipboardList, GraduationCap, Home, Library, Link2, ListChecks, LogOut, Menu, PanelLeftClose, School, ShieldCheck, Trophy, UserRound, WalletCards, Users, UsersRound, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { getNavConfig, getActiveNavItem, roleLabels, roleNames, UserRole } from '@/config/navigation'
import { getSidebarNavigationPreference, setSidebarNavigationOpen } from '@/lib/auth'
import { isGlobalAdministrator } from '@/lib/capabilities'
import { SessionUnavailable } from './SessionUnavailable'
import { WorkspaceSwitcher } from '@/components/workspace/WorkspaceSwitcher'
import { NotificationBell } from '@/components/notification/NotificationBell'
import { ChatButton } from '@/components/chat/ChatButton'
import { UserAvatar } from '@/components/user/UserAvatar'
import styles from './AppShell.module.css'
import { navigationHome, resolveNavigationContext } from '@/lib/navigationContext'

interface AppShellProps { children: ReactNode }

const accountPaths = {
  profile: '/account/profile',
  security: '/account/security',
  binding: '/account/platform-bindings',
}

const labelIcons: Record<string, LucideIcon> = {
  '首页': Home, '概览': Home, '校园': School, '学校信息': School, '学校管理': School, '教师管理': GraduationCap, '教师': GraduationCap,
  '学生管理': Users, '学生': Users, '管理': ShieldCheck, '成员与权限': ShieldCheck, '账号管理': Users, '团队': UsersRound, '我的团队': UsersRound,
  '组织': School,
  '作业': ClipboardList, '比赛': Trophy, '题单': ListChecks, '题库': Library,
  '题库管理': Library, '排名': Activity, '评测记录': BookOpen, 'OJ账号': Link2, '平台绑定': Link2,
  '贡献': Activity, '钱包': WalletCards, '贡献审计': ShieldCheck,
  'AI Token': WalletCards,
  '私信举报': ShieldCheck,
  '博客治理': ShieldCheck, '知识广场': BookOpen,

}

function getNavIcon(label: string): LucideIcon { return labelIcons[label] || Home }
function isWorkbenchPath(pathname: string): boolean {
  return /\/(trainings|submissions)\/[^/]+$/.test(pathname) || /\/problems\/[^/]+$/.test(pathname)
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { user, logout } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mobileNavigation, setMobileNavigation] = useState(true)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const navigationContext = resolveNavigationContext(pathname, user)
  const organizationId = navigationContext.organizationId
  const contextKind = navigationContext.workspace

  useEffect(() => {
    if (!user) return
    const contextKey = organizationId || contextKind
    const desktop = window.matchMedia('(min-width: 1200px)')
    const mobile = window.matchMedia('(max-width: 767px)')
    const syncNavigation = () => {
      setMobileNavigation(mobile.matches)
      const preference = getSidebarNavigationPreference(user.userId, user.role, contextKey)
      setSidebarOpen(preference === null ? desktop.matches : preference === 'open')
    }
    syncNavigation()
    desktop.addEventListener('change', syncNavigation)
    mobile.addEventListener('change', syncNavigation)
    setShowUserMenu(false)
    return () => {
      desktop.removeEventListener('change', syncNavigation)
      mobile.removeEventListener('change', syncNavigation)
    }
  }, [organizationId, contextKind, user?.role, user?.userId])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setShowUserMenu(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showUserMenu) setShowUserMenu(false)
      else if (sidebarOpen) setSidebarOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showUserMenu, sidebarOpen])

  if (!user) return <SessionUnavailable message="当前会话不可用，请重新登录" />

  const accountRole = user.role as UserRole
  const context = contextKind
  const isGlobalAdmin = isGlobalAdministrator(accountRole)
  const role = navigationContext.role as UserRole
  const navConfig = getNavConfig(role, context)
  const resolvedNavConfig = organizationId ? {
    ...navConfig,
    items: navConfig.items.map(item => ({ ...item, href: item.scope === 'global' ? item.href : `/org/${organizationId}/${item.href}` })),
  } : navConfig
  const activeItem = getActiveNavItem(pathname, role, context)
  const isPersonal = context === 'personal'
  const isStudent = role === 'student'
  const roleLabel = roleLabels[role] || '用户'
  const roleName = roleNames[role] || user.role
  const profile = user.profile as { name?: string } | undefined
  const visibleName = isPersonal ? user.username : profile?.name || user.username
  const userContext = isPersonal
    ? '个人'
    : isStudent
      ? user.organizationName || '校园'
      : roleLabel

  const setNavigationOpen = (open: boolean) => {
    setSidebarOpen(open)
    setSidebarNavigationOpen(user.userId, user.role, organizationId || context, open)
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
    const Icon = getNavIcon(item.label)
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
      <Link key={item.href} href={href} className={styles.sidebarLink} aria-current={current ? 'page' : undefined} title={item.label} onClick={() => { if (mobileNavigation) setNavigationOpen(false) }}>
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
          {!isGlobalAdmin && <Link className={styles.menuItem} href="/identity" role="menuitem" onClick={() => setShowUserMenu(false)}><UsersRound size={17} aria-hidden="true" />切换身份</Link>}
          <div className={styles.menuDivider} />
          <Button variant="ghost" className={`${styles.menuItem} ${styles.logoutItem}`} type="button" role="menuitem" onClick={() => void logout()}><LogOut size={17} aria-hidden="true" />退出登录</Button>
        </div>
      )}
    </div>
  )

  return (
    <div className={`${styles.shell} ${sidebarOpen ? styles.shellSidebarOpen : styles.shellSidebarCompact}`} data-navigation-mode={mobileNavigation ? (sidebarOpen ? 'drawer' : 'closed') : (sidebarOpen ? 'expanded' : 'compact')}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerStart}>
            <Button variant="ghost" type="button" className={styles.navigationToggle} onClick={() => setNavigationOpen(!sidebarOpen)} aria-controls="app-sidebar" aria-expanded={sidebarOpen} aria-label={sidebarOpen ? (mobileNavigation ? '关闭导航' : '收起导航') : '显示导航'} title={sidebarOpen ? (mobileNavigation ? '关闭导航' : '收起导航') : '显示导航'}>
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
      <aside id="app-sidebar" className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`} aria-label={`${isPersonal ? '个人' : roleName}主导航`} aria-hidden={mobileNavigation && !sidebarOpen}>
        <div className={styles.sidebarHeader}>
          <Link className={styles.sidebarBrandLink} href={navigationHome(navigationContext)} aria-label="返回首页" onClick={() => { if (mobileNavigation) setNavigationOpen(false) }}><img className={styles.logo} src="/logo.png" alt="Carits" /></Link>
          <Button variant="ghost" type="button" className={styles.sidebarClose} onClick={() => setNavigationOpen(false)} aria-label={mobileNavigation ? '关闭导航' : '收起导航'} title={mobileNavigation ? '关闭导航' : '收起导航'}><PanelLeftClose size={19} aria-hidden="true" /></Button>
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
