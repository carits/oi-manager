'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, UserPlus } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'
import { notificationTeamHref } from '@/components/workspace/workspaceRouting'
import { resolveNavigationContext } from '@/lib/navigationContext'
import styles from '@/components/AppShell.module.css'

export interface UserNotification {
  id: string
  type: string
  title: string
  body: string
  href?: string | null
  sourceType: string
  sourceId: string
  actionable: boolean
  actions?: Array<{ key: string; label: string; style: string }>
  readAt?: string | null
  createdAt: string
}

type NotificationPayload = { notifications: UserNotification[]; unreadCount: number }

export function NotificationBell() {
  const pathname = usePathname(), router = useRouter(), { user } = useAuth()
  const navigationContext = resolveNavigationContext(pathname, user)
  const organizationId = navigationContext.organizationId
  const context = navigationContext.workspace
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState('')
  const [processingId, setProcessingId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    const response = await apiClient.get<NotificationPayload>('/api/notifications?pageSize=10')
    if (response.success && response.data) { setNotifications(response.data.notifications); setUnreadCount(response.data.unreadCount); setError('') }
    else setError(response.message || '通知加载失败')
  }
  useEffect(() => {
    if (!user) return
    void load()
    const timer = window.setInterval(() => void load(), 45000)
    const focus = () => void load()
    window.addEventListener('focus', focus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [context, organizationId, user?.userId])
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [])

  const markRead = async (id: string) => {
    const response = await apiClient.patch(`/api/notifications/${id}/read`)
    if (response.success) { setNotifications(current => current.map(item => item.id === id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item)); setUnreadCount(current => Math.max(0, current - 1)) }
  }
  const openNotification = async (notification: UserNotification) => {
    await markRead(notification.id)
    const href = notification.href?.startsWith('/') ? notification.href : notificationTeamHref(context, organizationId, notification.href)
    if (href) { setOpen(false); router.push(href) }
  }
  const act = async (notification: UserNotification, action: string) => {
    if (action === 'view') return openNotification(notification)
    setProcessingId(notification.id)
    let endpoint = notification.type === 'organization_invitation'
      ? `/api/organization-invitations/${notification.sourceId}/${action}`
      : notification.type === 'team_invitation'
        ? `/api/teams/invitations/${notification.sourceId}/${action === 'decline' ? 'reject' : action}`
        : `/api/teams/join-requests/${notification.sourceId}/${action}`
    let response = await apiClient.post(endpoint)
    if (!response.success && response.status === 404 && notification.type === 'organization_invitation') {
      endpoint = `/api/workspaces/organization-invitations/${notification.sourceId}/${action === 'decline' ? 'reject' : action}`
      response = await apiClient.post(endpoint)
    }
    setProcessingId(null)
    if (response.success || response.code?.includes('ALREADY_PROCESSED')) await load()
    else setError(response.message || '操作失败，请重试')
  }

  return <div className={styles.notificationRoot} ref={rootRef}>
    <Button variant="ghost" type="button" className={styles.notificationButton} onClick={() => setOpen(current => !current)} aria-expanded={open} aria-haspopup="true" aria-label={unreadCount ? `打开通知，${unreadCount} 条未读` : '打开通知'} title="通知"><Bell size={20} aria-hidden="true" />{unreadCount > 0 && <span className={styles.notificationBadge}>{unreadCount > 99 ? '99+' : unreadCount}</span>}</Button>
    {open && <div className={styles.notificationPanel} role="region" aria-label="通知">
      <div className={styles.notificationHeader}><strong>通知</strong><Button variant="ghost" type="button" className={styles.readAllButton} disabled={!unreadCount} onClick={async () => { const response = await apiClient.post('/api/notifications/read-all'); if (response.success) await load() }}>全部已读</Button></div>
      <div className={styles.notificationList}>{error && <p className={styles.notificationError} role="status">{error}</p>}{!error && notifications.length === 0 && <p className={styles.notificationEmpty}>暂时没有新通知</p>}{notifications.map(notification => <article key={notification.id} className={`${styles.notificationItem} ${!notification.readAt ? styles.notificationUnread : ''}`}>
        <Button variant="ghost" type="button" className={styles.notificationContent} onClick={() => void openNotification(notification)}><span className={styles.notificationIcon} aria-hidden="true">{notification.type.includes('join_application') ? <UserPlus size={17} /> : <Bell size={17} />}</span><span className={styles.notificationText}><strong>{notification.title}</strong><span>{notification.body}</span><time>{new Date(notification.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span>{!notification.readAt && <span className={styles.unreadDot} aria-label="未读" />}</Button>
        {notification.actionable && <div className={styles.notificationActions}>{(notification.actions || []).map(action => <Button key={action.key} variant="ghost" type="button" className={action.style === 'primary' ? styles.primaryAction : styles.secondaryAction} disabled={processingId === notification.id} onClick={() => void act(notification, action.key)}>{action.label}</Button>)}</div>}
      </article>)}</div>
      <div className={styles.notificationHeader}><Button variant="ghost" type="button" onClick={() => { setOpen(false); router.push('/account/notifications') }}>查看全部通知</Button></div>
    </div>}
  </div>
}
