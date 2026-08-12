'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Activity, Bell, BookOpen, Check, ChevronDown, ClipboardList, GraduationCap, Home, Library, Link2, ListChecks, LogOut, Menu, School, ShieldCheck, Trophy, UserPlus, UserRound, Users, UsersRound, X, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { getNavConfig, getActiveNavItem, roleLabels, roleNames, UserRole } from '@/config/navigation'
import { getAssetUrl } from '@/lib/assets'
import { getSidebarNavigationOpen, setSidebarNavigationOpen } from '@/lib/auth'
import { getRoleHome } from '@/lib/roleAccess'
import { SegmentedControl } from './ui/SegmentedControl'
import { SessionUnavailable } from './SessionUnavailable'
import { apiClient } from '@/lib/apiClient'
import styles from './AppShell.module.css'

interface AppShellProps { children: ReactNode }

interface UserNotification {
  id: string
  type: string
  title: string
  body: string
  href?: string | null
  sourceType: string
  sourceId: string
  readAt?: string | null
  createdAt: string
}

interface NotificationPayload {
  notifications: UserNotification[]
  unreadCount: number
}

const accountPaths = {
  profile: '/account/profile',
  security: '/account/security',
  binding: '/account/platform-bindings',
}

const labelIcons: Record<string, LucideIcon> = {
  '首页': Home, '概览': Home, '校园': School, '学校管理': School, '教师管理': GraduationCap,
  '学生管理': Users, '学生': Users, '账号管理': Users, '团队': UsersRound, '我的团队': UsersRound,
  '作业': ClipboardList, '比赛': Trophy, '题单': ListChecks, '题库': Library,
  '题库管理': Library, '排名': Activity, '评测记录': BookOpen, '提交管理': BookOpen,
}

function getNavIcon(label: string): LucideIcon { return labelIcons[label] || Home }
function isWorkbenchPath(pathname: string): boolean {
  return /\/(trainings|submissions)\/[^/]+$/.test(pathname) || /\/problems\/[^/]+$/.test(pathname)
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout, switchWorkspace } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [switchingMode, setSwitchingMode] = useState(false)
  const [modeError, setModeError] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationError, setNotificationError] = useState('')
  const [processingNotificationId, setProcessingNotificationId] = useState<string | null>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const notificationRef = useRef<HTMLDivElement>(null)

  const storedWorkspaceMode = user?.workspaceMode || (user?.studentMode === 'personal' ? 'personal' : 'work')

  useEffect(() => {
    if (!user) return
    setSidebarOpen(getSidebarNavigationOpen(user.userId, user.role, storedWorkspaceMode))
    setShowUserMenu(false)
  }, [storedWorkspaceMode, user?.role, user?.userId])

  const loadNotifications = async () => {
    const response = await apiClient.get<NotificationPayload>('/api/notifications')
    if (response.success && response.data) {
      setNotifications(response.data.notifications)
      setUnreadCount(response.data.unreadCount)
      setNotificationError('')
    } else {
      setNotificationError(response.message || '通知加载失败')
    }
  }

  useEffect(() => {
    if (!user) return
    void loadNotifications()
    const timer = window.setInterval(() => void loadNotifications(), 45000)
    const handleFocus = () => void loadNotifications()
    window.addEventListener('focus', handleFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
    }
  }, [storedWorkspaceMode, user?.userId])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setShowUserMenu(false)
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) setShowNotifications(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showNotifications) setShowNotifications(false)
      else if (showUserMenu) setShowUserMenu(false)
      else if (sidebarOpen) setSidebarOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showNotifications, showUserMenu, sidebarOpen])

  if (!user) return <SessionUnavailable message="当前会话不可用，请重新登录" />

  const role = user.role as UserRole
  const workspaceMode = storedWorkspaceMode
  const navConfig = getNavConfig(role, workspaceMode)
  const activeItem = getActiveNavItem(pathname, role, workspaceMode)
  const isPersonal = workspaceMode === 'personal'
  const isStudent = role === 'student'
  const roleLabel = roleLabels[role] || '用户'
  const roleName = roleNames[role] || user.role
  const profile = user.profile as { name?: string } | undefined
  const visibleName = isPersonal ? user.username : profile?.name || user.username
  const userContext = isPersonal
    ? '个人工作区'
    : isStudent
      ? user.schoolName || '校园工作区'
      : roleLabel

  const setNavigationOpen = (open: boolean) => {
    setSidebarOpen(open)
    setSidebarNavigationOpen(user.userId, user.role, workspaceMode, open)
    if (!open) setShowUserMenu(false)
  }

  const handleModeChange = async (mode: 'work' | 'personal') => {
    if (mode === workspaceMode || switchingMode) return
    setSwitchingMode(true)
    setModeError('')
    const success = await switchWorkspace(mode)
    setSwitchingMode(false)
    if (!success) {
      setModeError('模式切换失败，请重试')
    }
  }

  const getTeamHref = (notification: UserNotification) => {
    const teamId = notification.href?.replace('team:', '')
    if (!teamId) return null
    if (isPersonal) return `/personal/teams/${teamId}`
    return isStudent ? `/student/team/${teamId}` : `/teacher/teams/${teamId}`
  }

  const markRead = async (notificationId: string) => {
    const response = await apiClient.patch(`/api/notifications/${notificationId}/read`)
    if (response.success) {
      setNotifications(current => current.map(item => item.id === notificationId ? { ...item, readAt: item.readAt || new Date().toISOString() } : item))
      setUnreadCount(current => Math.max(0, current - 1))
    }
  }

  const markAllRead = async () => {
    const response = await apiClient.post('/api/notifications/read-all')
    if (response.success) {
      setNotifications(current => current.map(item => ({ ...item, readAt: item.readAt || new Date().toISOString() })))
      setUnreadCount(0)
    }
  }

  const handleNotificationClick = async (notification: UserNotification) => {
    await markRead(notification.id)
    const href = getTeamHref(notification)
    if (href) {
      setShowNotifications(false)
      router.push(href)
    }
  }

  const handleNotificationAction = async (notification: UserNotification, action: 'accept' | 'reject' | 'approve') => {
    setProcessingNotificationId(notification.id)
    const endpoint = notification.type === 'team_invitation'
      ? `/api/teams/invitations/${notification.sourceId}/${action === 'accept' ? 'accept' : 'reject'}`
      : `/api/teams/join-requests/${notification.sourceId}/${action === 'approve' ? 'approve' : 'reject'}`
    const response = await apiClient.post(endpoint)
    setProcessingNotificationId(null)
    if (response.success) await loadNotifications()
    else setNotificationError(response.message || '操作失败，请重试')
  }

  const navLinks = navConfig.items.map(item => {
    const Icon = getNavIcon(item.label)
    return (
      <Link key={item.href} href={item.href} className={styles.sidebarLink} aria-current={activeItem === item.label ? 'page' : undefined}>
        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    )
  })

  const userMenu = (
    <div className={styles.userMenuRoot} ref={userMenuRef}>
      <button type="button" className={styles.accountCard} onClick={() => setShowUserMenu(current => !current)} aria-expanded={showUserMenu} aria-haspopup="menu" aria-label="打开账号菜单">
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
    <div className={`${styles.shell} ${sidebarOpen ? styles.shellSidebarOpen : ''}`}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerStart}>
            <button type="button" className={styles.navigationToggle} onClick={() => setNavigationOpen(!sidebarOpen)} aria-controls="app-sidebar" aria-expanded={sidebarOpen} aria-label={sidebarOpen ? '隐藏导航' : '显示导航'} title={sidebarOpen ? '隐藏导航' : '显示导航'}>
              <Menu size={21} aria-hidden="true" />
            </button>
            <Link className={styles.brandLink} href={getRoleHome(role, workspaceMode)} aria-label="返回工作区首页"><img className={styles.logo} src="/logo.png" alt="Carits" /></Link>
          </div>
          <div className={styles.headerEnd}>
            <div className={styles.notificationRoot} ref={notificationRef}>
              <button type="button" className={styles.notificationButton} onClick={() => setShowNotifications(current => !current)} aria-expanded={showNotifications} aria-haspopup="dialog" aria-label={unreadCount ? `打开通知，${unreadCount} 条未读` : '打开通知'} title="通知">
                <Bell size={20} aria-hidden="true" />
                {unreadCount > 0 && <span className={styles.notificationBadge}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>
              {showNotifications && (
                <div className={styles.notificationPanel} role="dialog" aria-label="通知">
                  <div className={styles.notificationHeader}>
                    <strong>通知</strong>
                    <button type="button" className={styles.readAllButton} onClick={() => void markAllRead()} disabled={unreadCount === 0}>全部已读</button>
                  </div>
                  <div className={styles.notificationList}>
                    {notificationError && <p className={styles.notificationError} role="status">{notificationError}</p>}
                    {!notificationError && notifications.length === 0 && <p className={styles.notificationEmpty}>暂时没有新通知</p>}
                    {notifications.map(notification => {
                      const isActionable = notification.type === 'team_invitation' || notification.type === 'team_join_request'
                      const processing = processingNotificationId === notification.id
                      return <article key={notification.id} className={`${styles.notificationItem} ${!notification.readAt ? styles.notificationUnread : ''}`}>
                        <button type="button" className={styles.notificationContent} onClick={() => void handleNotificationClick(notification)}>
                          <span className={styles.notificationIcon} aria-hidden="true">{notification.type === 'team_join_request' ? <UserPlus size={17} /> : <Bell size={17} />}</span>
                          <span className={styles.notificationText}><strong>{notification.title}</strong><span>{notification.body}</span><time>{new Date(notification.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span>
                          {!notification.readAt && <span className={styles.unreadDot} aria-label="未读" />}
                        </button>
                        {isActionable && <div className={styles.notificationActions}>
                          {notification.type === 'team_invitation'
                            ? <><button type="button" className={styles.secondaryAction} disabled={processing} onClick={() => void handleNotificationAction(notification, 'reject')}>拒绝</button><button type="button" className={styles.primaryAction} disabled={processing} onClick={() => void handleNotificationAction(notification, 'accept')}>接受</button></>
                            : <><button type="button" className={styles.secondaryAction} disabled={processing} onClick={() => void handleNotificationAction(notification, 'reject')}>拒绝</button><button type="button" className={styles.primaryAction} disabled={processing} onClick={() => void handleNotificationAction(notification, 'approve')}>同意</button></>}
                        </div>}
                      </article>
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className={styles.modeArea}>
              <span className={styles.modeLabel}>工作区切换</span>
              <div className={styles.modeControl}>
                <SegmentedControl label="工作区" value={workspaceMode} disabled={switchingMode} onChange={handleModeChange} items={[{ value: 'work', label: role === 'super_admin' || role === 'platform_admin' ? '管理' : '校园' }, { value: 'personal', label: '个人' }]} />
              </div>
              {modeError && <span className={styles.modeError} role="status">{modeError}</span>}
            </div>
          </div>
        </div>
      </header>
      <aside id="app-sidebar" className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`} aria-label={`${isPersonal ? '个人工作区' : roleName}主导航`} aria-hidden={!sidebarOpen}>
        <div className={styles.sidebarHeader}>
          <Link className={styles.sidebarBrandLink} href={getRoleHome(role, workspaceMode)} aria-label="返回工作区首页" onClick={() => setNavigationOpen(false)}><img className={styles.logo} src="/logo.png" alt="Carits" /></Link>
          <button type="button" className={styles.sidebarClose} onClick={() => setNavigationOpen(false)} aria-label="隐藏导航" title="隐藏导航"><X size={19} aria-hidden="true" /></button>
        </div>
        <nav className={styles.sidebarNav} aria-label={`${isPersonal ? '个人工作区' : roleName}主导航`}>{navLinks}</nav>
        <div className={styles.sidebarFooter}>{userMenu}</div>
      </aside>
      <main className={styles.main} data-app-content><div className={styles.mainInner} data-page-host data-layout={isWorkbenchPath(pathname) ? 'workbench' : 'default'}>{children}</div></main>
    </div>
  )
}
