'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, UserPlus } from 'lucide-react'
import { usePathname } from 'next/navigation'
import type { UserNotification } from '@oi-manager/contracts'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth'
import { resolveNotificationHref } from '@/features/workspace'
import { resolveNavigationContext } from '@/lib/navigationContext'
import {
  listContextNotifications,
  readAllContextNotifications,
  readContextNotification,
  respondToNotification,
} from '../api/notificationApi'
import styles from '@/components/AppShell.module.css'
import { useNavigationGuard } from '@/components/navigation/UnsavedChangesProvider'

export function NotificationBell() {
  const pathname = usePathname(), { user } = useAuth()
  const { requestNavigation } = useNavigationGuard()
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
    try {
      const data = await listContextNotifications(10)
      setNotifications(data.notifications); setUnreadCount(data.unreadCount); setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '通知加载失败')
    }
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
    const response = await readContextNotification(id)
    if (response.ok) { setNotifications(current => current.map(item => item.id === id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item)); setUnreadCount(response.data.unreadCount) }
  }
  const openNotification = async (notification: UserNotification) => {
    await markRead(notification.id)
    const href = resolveNotificationHref(context, organizationId, notification.href)
    if (href) { setOpen(false); requestNavigation(href, { hard: href.startsWith('/org/') }) }
  }
  const act = async (notification: UserNotification, action: string) => {
    if (action === 'view') return openNotification(notification)
    setProcessingId(notification.id)
    const response = await respondToNotification(notification, action)
    setProcessingId(null)
    if (response.ok || (!response.ok && response.error.code?.includes('ALREADY_PROCESSED'))) await load()
    else if (!response.ok) setError(response.error.message || '操作失败，请重试')
  }

  return <div className={styles.notificationRoot} ref={rootRef}>
    <Button variant="ghost" type="button" className={styles.notificationButton} onClick={() => setOpen(current => !current)} aria-expanded={open} aria-haspopup="true" aria-label={unreadCount ? `打开通知，${unreadCount} 条未读` : '打开通知'} title="通知"><Bell size={20} aria-hidden="true" />{unreadCount > 0 && <span className={styles.notificationBadge}>{unreadCount > 99 ? '99+' : unreadCount}</span>}</Button>
    {open && <div className={styles.notificationPanel} role="region" aria-label="通知">
      <div className={styles.notificationHeader}><strong>通知</strong><Button variant="ghost" type="button" className={styles.readAllButton} disabled={!unreadCount} onClick={async () => { const response = await readAllContextNotifications(); if (response.ok) await load(); else setError(response.error.message || '全部已读失败，请重试') }}>全部已读</Button></div>
      <div className={styles.notificationList}>{error && <p className={styles.notificationError} role="status">{error}</p>}{!error && notifications.length === 0 && <p className={styles.notificationEmpty}>暂时没有新通知</p>}{notifications.map(notification => <article key={notification.id} className={`${styles.notificationItem} ${!notification.readAt ? styles.notificationUnread : ''}`}>
        <Button variant="ghost" type="button" className={styles.notificationContent} onClick={() => void openNotification(notification)}><span className={styles.notificationIcon} aria-hidden="true">{notification.type.includes('join_application') ? <UserPlus size={17} /> : <Bell size={17} />}</span><span className={styles.notificationText}><strong>{notification.title}</strong><span>{notification.body}</span><time>{new Date(notification.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span>{!notification.readAt && <span className={styles.unreadDot} aria-label="未读" />}</Button>
        {notification.actionable && <div className={styles.notificationActions}>{(notification.actions || []).map(action => <Button key={action.key} variant="ghost" type="button" className={action.style === 'primary' ? styles.primaryAction : styles.secondaryAction} disabled={processingId === notification.id} onClick={() => void act(notification, action.key)}>{action.label}</Button>)}</div>}
      </article>)}</div>
      <div className={styles.notificationHeader}><Button variant="ghost" type="button" onClick={() => { setOpen(false); requestNavigation('/account/notifications') }}>查看全部通知</Button></div>
    </div>}
  </div>
}
