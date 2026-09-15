'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { NotificationFilter, UserNotification } from '@oi-manager/contracts'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useToast } from '@/components/ui/Toast'
import { resolveNotificationHref } from '@/components/workspace/workspaceRouting'
import { listAccountNotifications, readAccountNotification, readAllAccountNotifications, respondToNotification } from '../api/notificationApi'
import styles from './NotificationCenterPage.module.css'

export default function NotificationCenterPage() {
  const router = useRouter(), toast = useToast()
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [items, setItems] = useState<UserNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false)
  const load = async (nextPage = 1, append = false) => {
    setLoading(true)
    try {
      const data = await listAccountNotifications(filter, nextPage)
      setItems(current => append ? [...current, ...data.notifications] : data.notifications)
      setUnreadCount(data.unreadCount); setHasMore(data.hasMore); setPage(nextPage)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '通知加载失败')
    } finally { setLoading(false) }
  }
  useEffect(() => { void load(1) }, [filter])
  const open = async (item: UserNotification) => {
    if (!item.readAt) await readAccountNotification(item.id)
    const href = resolveNotificationHref(item.organizationId ? 'organization' : 'personal', item.organizationId || undefined, item.href)
    if (href) router.push(href)
    else await load(1)
  }
  const act = async (item: UserNotification, action: string) => {
    if (action === 'view') return open(item)
    const response = await respondToNotification(item, action)
    if (!response.ok) toast.error(response.error.message || '操作失败')
    await load(1)
  }
  return <PageFrame width="reading">
    <PageHeader title="消息中心" description="汇总你的账号通知和所有已加入学校的通知。" actions={<Button variant="secondary" disabled={!unreadCount} onClick={async () => { const response = await readAllAccountNotifications(); if (!response.ok) return toast.error(response.error.message || '全部已读失败'); await load(1) }}>全部已读</Button>} />
    <SegmentedControl label="通知筛选" value={filter} onChange={value => setFilter(value as NotificationFilter)} items={[{ value: 'all', label: '全部' }, { value: 'unread', label: `未读${unreadCount ? ` ${unreadCount}` : ''}` }, { value: 'actionable', label: '待处理' }]} />
    {loading ? <p className={styles.state}>正在加载通知…</p> : items.length === 0 ? <Empty title="暂无通知" description={filter === 'all' ? '新的组织、团队和账号消息会显示在这里。' : '当前筛选下没有通知。'} /> : <div className={styles.list}>{items.map(item => <article className={`${styles.item} ${!item.readAt ? styles.unread : ''}`} key={item.id}>
      <span className={styles.icon}><Bell size={18} /></span><div className={styles.body}><Button variant="ghost" className={styles.content} onClick={() => void open(item)}><strong>{item.title}</strong><span>{item.body}</span>{item.organizationName && <span>来源学校：{item.organizationName}</span>}<time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time></Button>{item.actionable && <div className={styles.actions}>{(item.actions || []).map(action => <Button key={action.key} variant={action.style === 'primary' ? 'primary' : 'secondary'} onClick={() => void act(item, action.key)}>{action.label}</Button>)}</div>}</div>
    </article>)}{hasMore && <Button variant="secondary" loading={loading} onClick={() => void load(page + 1, true)}>加载更多通知</Button>}</div>}
  </PageFrame>
}
