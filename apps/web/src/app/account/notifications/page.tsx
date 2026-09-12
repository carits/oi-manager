'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useToast } from '@/components/ui/Toast'
import type { UserNotification } from '@/components/notification/NotificationBell'
import { useAuth } from '@/components/AuthProvider'
import { resolveNavigationContext } from '@/lib/navigationContext'
import { resolveNotificationHref } from '@/components/workspace/workspaceRouting'
import styles from './page.module.css'

type Payload = { notifications: UserNotification[]; unreadCount: number; hasMore: boolean }

export default function NotificationCenterPage() {
  const router = useRouter(), pathname = usePathname(), toast = useToast(), { user } = useAuth()
  const navigationContext = resolveNavigationContext(pathname, user)
  const [filter, setFilter] = useState('all')
  const [items, setItems] = useState<UserNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false)
  const load = async (nextPage = 1, append = false) => {
    setLoading(true)
    const response = await apiClient.get<Payload>(`/api/notifications?filter=${filter}&page=${nextPage}&pageSize=50`)
    setLoading(false)
    if (response.success && response.data) { setItems(current => append ? [...current, ...response.data!.notifications] : response.data!.notifications); setUnreadCount(response.data.unreadCount); setHasMore(response.data.hasMore); setPage(nextPage) }
    else toast.error(response.message || '通知加载失败')
  }
  useEffect(() => { void load(1) }, [filter])
  const open = async (item: UserNotification) => {
    if (!item.readAt) await apiClient.patch(`/api/notifications/${item.id}/read`)
    const href = resolveNotificationHref(navigationContext.workspace, navigationContext.organizationId, item.href)
    if (href) router.push(href)
    else await load(1)
  }
  const act = async (item: UserNotification, action: string) => {
    if (action === 'view') return open(item)
    let response = item.type === 'organization_invitation'
      ? await apiClient.post(`/api/organization-invitations/${item.sourceId}/${action}`)
      : item.type === 'team_invitation'
        ? await apiClient.post(`/api/teams/invitations/${item.sourceId}/${action === 'decline' ? 'reject' : action}`)
        : await apiClient.post(`/api/teams/join-requests/${item.sourceId}/${action}`)
    if (!response.success && response.status === 404 && item.type === 'organization_invitation') response = await apiClient.post(`/api/workspaces/organization-invitations/${item.sourceId}/${action === 'decline' ? 'reject' : action}`)
    if (!response.success) toast.error(response.message || '操作失败')
    await load(1)
  }
  return <PageFrame width="reading">
    <PageHeader title="消息中心" description="账号通知和当前学校通知会统一显示在这里。" actions={<Button variant="secondary" disabled={!unreadCount} onClick={async () => { const response = await apiClient.post('/api/notifications/read-all'); if (!response.success) return toast.error(response.message || '全部已读失败'); await load(1) }}>全部已读</Button>} />
    <SegmentedControl label="通知筛选" value={filter} onChange={setFilter} items={[{ value: 'all', label: '全部' }, { value: 'unread', label: `未读${unreadCount ? ` ${unreadCount}` : ''}` }, { value: 'actionable', label: '待处理' }]} />
    {loading ? <p className={styles.state}>正在加载通知…</p> : items.length === 0 ? <Empty title="暂无通知" description={filter === 'all' ? '新的组织、团队和账号消息会显示在这里。' : '当前筛选下没有通知。'} /> : <div className={styles.list}>{items.map(item => <article className={`${styles.item} ${!item.readAt ? styles.unread : ''}`} key={item.id}>
      <span className={styles.icon}><Bell size={18} /></span><div className={styles.body}><Button variant="ghost" className={styles.content} onClick={() => void open(item)}><strong>{item.title}</strong><span>{item.body}</span><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time></Button>{item.actionable && <div className={styles.actions}>{(item.actions || []).map(action => <Button key={action.key} variant={action.style === 'primary' ? 'primary' : 'secondary'} onClick={() => void act(item, action.key)}>{action.label}</Button>)}</div>}</div>
    </article>)}{hasMore && <Button variant="secondary" loading={loading} onClick={() => void load(page + 1, true)}>加载更多通知</Button>}</div>}
  </PageFrame>
}
