'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, CalendarClock, ListChecks } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { compareContestSchedules, contestLifecycle } from '@/lib/contestOrdering'
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
  return contestLifecycle(item)
}

const statusMeta = {
  ongoing: { label: '进行中', variant: 'success' as const },
  upcoming: { label: '即将开始', variant: 'info' as const },
  finished: { label: '已结束', variant: 'neutral' as const },
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
    .sort(compareContestSchedules)

  const setStatus = (status: StatusFilter) => {
    const params = new URLSearchParams(searchParams.toString())
    status === 'all' ? params.delete('status') : params.set('status', status)
    router.replace(`/personal/contests${params.size ? `?${params}` : ''}`, { scroll: false })
  }

  return (
    <PageFrame>
      <PageHeader title="比赛" description="显示个人团队比赛和面向全平台开放的正式比赛。" />
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
