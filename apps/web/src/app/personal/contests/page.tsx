'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, CalendarClock, ListChecks } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import styles from '@/components/TrainingIndex.module.css'

interface ContestItem {
  id: number
  title: string
  startTime: string
  endTime: string
  status: string
  problemCount: number
}

type StatusFilter = 'all' | 'ongoing' | 'upcoming' | 'finished'

function runtimeStatus(item: ContestItem): Exclude<StatusFilter, 'all'> {
  const now = Date.now()
  if (now < new Date(item.startTime).getTime()) return 'upcoming'
  if (now <= new Date(item.endTime).getTime()) return 'ongoing'
  return 'finished'
}

const statusMeta = {
  ongoing: { label: '进行中', variant: 'success' as const },
  upcoming: { label: '即将开始', variant: 'info' as const },
  finished: { label: '已结束', variant: 'neutral' as const },
}

const STATUS_ORDER: Record<Exclude<StatusFilter, 'all'>, number> = { ongoing: 0, upcoming: 1, finished: 2 }

function titleLevel(title: string) {
  const match = title.match(/\d+/)
  if (!match) return 0
  const level = Number(match[0])
  return Number.isFinite(level) ? level : 0
}

function compareContests(a: ContestItem, b: ContestItem) {
  const statusDiff = STATUS_ORDER[runtimeStatus(a)] - STATUS_ORDER[runtimeStatus(b)]
  if (statusDiff !== 0) return statusDiff
  const levelDiff = titleLevel(b.title) - titleLevel(a.title)
  if (levelDiff !== 0) return levelDiff
  return new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
}

const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
})

export default function PersonalContestsPage() {
  const { sessionKey } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawStatus = searchParams.get('status') as StatusFilter | null
  const activeStatus: StatusFilter = ['ongoing', 'upcoming', 'finished'].includes(rawStatus || '') ? rawStatus! : 'all'
  const resource = useResource<ContestItem[]>('/api/me/contests', { sessionKey, dedupingInterval: 30000 })
  const contests = resource.data || []
  const visible = contests
    .filter(item => activeStatus === 'all' || runtimeStatus(item) === activeStatus)
    .sort(compareContests)

  const setStatus = (status: StatusFilter) => {
    const params = new URLSearchParams(searchParams.toString())
    status === 'all' ? params.delete('status') : params.set('status', status)
    router.replace(`/personal/contests${params.size ? `?${params}` : ''}`, { scroll: false })
  }

  return (
    <PageFrame>
      <PageHeader title="比赛" description="仅显示个人团队范围内的比赛。" />
      <Tabs label="比赛状态" value={activeStatus} onChange={setStatus} items={[{ value: 'all', label: '全部', count: contests.length }, { value: 'ongoing', label: '进行中' }, { value: 'upcoming', label: '即将开始' }, { value: 'finished', label: '已结束' }]} />
      <AsyncRegion state={resource.state} onRetry={resource.retry} emptyText="当前没有个人比赛" skeletonRows={5}>
        {(_, refreshing) => visible.length === 0
          ? <div className={styles.empty}>当前筛选下没有比赛</div>
          : <div className={styles.list} aria-busy={refreshing || undefined}>{visible.map(item => {
              const status = statusMeta[runtimeStatus(item)]
              return <Link key={item.id} className={styles.item} href={`/personal/contests/${item.id}`}><span className={styles.itemMain}><span className={styles.itemTitle}>{item.title}</span><span className={styles.itemMeta}><span><CalendarClock size={14} />{formatTime(item.startTime)} 至 {formatTime(item.endTime)}</span><span><ListChecks size={14} />{item.problemCount} 题</span></span></span><span className={styles.itemEnd}><StatusBadge variant={status.variant}>{status.label}</StatusBadge><ArrowRight size={17} /></span></Link>
            })}</div>}
      </AsyncRegion>
    </PageFrame>
  )
}
