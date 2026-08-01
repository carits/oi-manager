'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, BookOpen, ChevronDown, ClipboardList, GraduationCap, Home, Library, Link2, ListChecks, LogOut, School, ShieldCheck, Trophy, UserRound, Users, UsersRound, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { getNavConfig, getActiveNavItem, roleLabels, roleNames, UserRole } from '@/config/navigation'
import { getAssetUrl } from '@/lib/assets'
import { getRoleHome } from '@/lib/roleAccess'
import { SegmentedControl } from './ui/SegmentedControl'
import { SessionUnavailable } from './SessionUnavailable'
import styles from './AppShell.module.css'

interface AppShellProps { children: ReactNode }

const accountPaths = {
  profile: '/account/profile',
  security: '/account/security',
  binding: '/account/platform-bindings',
}

const labelIcons: Record<string, LucideIcon> = {
  '首页': Home, '概览': Home, '学校管理': School, '教师管理': GraduationCap,
  '学生管理': Users, '账号管理': Users, '团队': UsersRound, '我的团队': UsersRound,
  '作业': ClipboardList, '比赛': Trophy, '题单': ListChecks, '题库': Library,
  '题库管理': Library, '排名': Activity, '评测记录': BookOpen, '提交管理': BookOpen,
}

function getNavIcon(label: string): LucideIcon { return labelIcons[label] || Home }
function isWorkbenchPath(pathname: string): boolean {
  return /\/(trainings|submissions)\/[^/]+$/.test(pathname) || /\/problems\/[^/]+$/.test(pathname)
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const { user, logout, switchWorkspace } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [switchingMode, setSwitchingMode] = useState(false)
  const [modeError, setModeError] = useState('')
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setShowUserMenu(false)
    }
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowUserMenu(false) }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  if (!user) return <SessionUnavailable message="当前会话不可用，请重新登录" />

  const role = user.role as UserRole
  const workspaceMode = user.workspaceMode || (user.studentMode === 'personal' ? 'personal' : 'work')
  const isPersonal = workspaceMode === 'personal'
  const navConfig = getNavConfig(role, workspaceMode)
  const activeItem = getActiveNavItem(pathname, role, workspaceMode)
  const isStudent = role === 'student'
  const useTopNavigation = isStudent || isPersonal
  const roleLabel = roleLabels[role] || '用户'
  const roleName = roleNames[role] || user.role
  const profile = user.profile as { name?: string } | undefined
  const visibleName = isPersonal ? user.username : profile?.name || user.username
  const userContext = isPersonal
    ? '个人工作区'
    : isStudent
      ? user.schoolName || '校园工作区'
      : roleLabel

  const handleModeChange = async (mode: 'work' | 'personal') => {
    if (mode === workspaceMode || switchingMode) return
    setSwitchingMode(true)
    setModeError('')
    const success = await switchWorkspace(mode)
    if (!success) {
      setSwitchingMode(false)
      setModeError('模式切换失败，请重试')
    }
  }

  const navLinks = (variant: 'top' | 'sidebar') => navConfig.items.map(item => {
    const Icon = getNavIcon(item.label)
    return (
      <Link key={item.href} href={item.href} className={variant === 'top' ? styles.topNavLink : styles.sidebarLink} aria-current={activeItem === item.label ? 'page' : undefined}>
        {variant === 'sidebar' && <Icon size={18} strokeWidth={1.8} aria-hidden="true" />}
        <span>{item.label}</span>
      </Link>
    )
  })

  const userMenu = (
    <div className={styles.userMenuRoot} ref={userMenuRef}>
      <button type="button" className={styles.userButton} onClick={() => setShowUserMenu(current => !current)} aria-expanded={showUserMenu} aria-haspopup="menu" aria-label="打开用户菜单">
        {user.avatar ? <img className={styles.avatar} src={getAssetUrl(user.avatar)} alt="" /> : <span className={styles.avatarFallback} aria-hidden="true">{visibleName.charAt(0).toUpperCase() || '?'}</span>}
        <span className={styles.userText}><span className={styles.userName}>{visibleName}</span><span className={styles.userContext}>{userContext}</span></span>
        <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
      </button>
      {showUserMenu && (
        <div className={styles.userMenu} role="menu">
          <Link className={styles.menuItem} href={accountPaths.profile} role="menuitem" onClick={() => setShowUserMenu(false)}><UserRound size={17} aria-hidden="true" />个人信息</Link>
          <Link className={styles.menuItem} href={accountPaths.security} role="menuitem" onClick={() => setShowUserMenu(false)}><ShieldCheck size={17} aria-hidden="true" />账号安全</Link>
          <Link className={styles.menuItem} href={accountPaths.binding} role="menuitem" onClick={() => setShowUserMenu(false)}><Link2 size={17} aria-hidden="true" />平台绑定</Link>
          <div className={styles.menuDivider} />
          <button className={`${styles.menuItem} ${styles.logoutItem}`} type="button" role="menuitem" onClick={() => void logout()}><LogOut size={17} aria-hidden="true" />退出登录</button>
        </div>
      )}
    </div>
  )

  return (
    <div className={styles.shell} data-navigation={useTopNavigation ? 'top' : 'sidebar'}>
      <header className={`${styles.header} ${useTopNavigation ? styles.studentHeader : styles.managementHeader}`}>
        <div className={styles.headerInner}>
          {useTopNavigation ? (
            <div className={styles.headerStart}>
              <div className={styles.studentBrandArea}><Link className={styles.brandLink} href={getRoleHome(role, workspaceMode)} aria-label="返回工作区首页"><img className={styles.logo} src="/logo.png" alt="Carits" /></Link></div>
              <nav className={styles.topNav} aria-label={isPersonal ? '个人工作区导航' : '校园工作区导航'}>{navLinks('top')}</nav>
            </div>
          ) : (
            <div className={styles.headerStart}>
              <div className={styles.brandArea}><Link className={styles.brandLink} href={getRoleHome(role)} aria-label={`返回${roleName}首页`}><img className={styles.logo} src="/logo.png" alt="Carits" /></Link></div>
              <span className={styles.contextLabel}>{roleName}工作台</span>
            </div>
          )}
          <div className={styles.headerEnd}>
            <div className={styles.modeArea}>
              <span className={styles.modeLabel}>工作区切换</span>
              <div className={styles.modeControl}>
                <SegmentedControl label="工作区" value={workspaceMode} disabled={switchingMode} onChange={handleModeChange} items={[{ value: 'work', label: role === 'super_admin' || role === 'platform_admin' ? '管理' : '校园' }, { value: 'personal', label: '个人' }]} />
              </div>
                {modeError && <span className={styles.modeError} role="status">{modeError}</span>}
            </div>
            {userMenu}
          </div>
        </div>
      </header>
      {useTopNavigation ? (
        <main className={styles.main} data-app-content><div className={styles.mainInner} data-page-host data-layout={isWorkbenchPath(pathname) ? 'workbench' : 'default'}>{children}</div></main>
      ) : (
        <div className={styles.managementBody}>
          <aside className={styles.sidebar}><nav className={styles.sidebarNav} aria-label={`${roleName}主导航`}>{navLinks('sidebar')}</nav><div className={styles.sidebarContext}>{user.schoolName || roleName}</div></aside>
          <main className={styles.main} data-app-content><div className={styles.mainInner} data-page-host data-layout={isWorkbenchPath(pathname) ? 'workbench' : 'default'}>{children}</div></main>
        </div>
      )}
    </div>
  )
}
