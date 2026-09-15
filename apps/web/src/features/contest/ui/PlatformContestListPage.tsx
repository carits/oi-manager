'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, CalendarClock, ListChecks, Plus, UsersRound } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { Button } from '@/components/ui/Button'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TrainingFormModal } from './TrainingFormModal'
import styles from '@/components/TrainingIndex.module.css'

interface PlatformContest {
  id: number
  title: string
  format: string
  startTime: string
  endTime: string
  status: string
  problemCount: number
  participantCount: number
  ratingConfig?: { scope: string; track: string } | null
}

const statusPresentation = {
  ongoing: { label: '进行中', variant: 'success' as const },
  upcoming: { label: '即将开始', variant: 'info' as const },
  finished: { label: '已结束', variant: 'neutral' as const },
}

function displayTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function PlatformContestListPage({ basePath }: { basePath: '/admin' | '/platform-admin' }) {
  const { sessionKey } = useAuth()
  const [creating, setCreating] = useState(false)
  const resource = useResource<PlatformContest[]>('/api/platform-contests', {
    sessionKey,
    dedupingInterval: 15_000,
  })

  return (
    <PageFrame>
      <PageHeader
        title="平台比赛"
        description="创建面向全平台用户的正式个人赛，并在开始前配置全局或双 Rating。"
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>创建平台比赛</Button>}
      />
      <AsyncRegion state={resource.state} onRetry={resource.retry} emptyText="尚未创建平台比赛" skeletonRows={5}>
        {(contests, refreshing) => (
          <div className={styles.list} aria-busy={refreshing || undefined}>
            {contests.map(contest => {
              const status = statusPresentation[contest.status as keyof typeof statusPresentation] || statusPresentation.upcoming
              const ratingLabel = contest.ratingConfig?.scope === 'BOTH'
                ? '全局 + 组织 Rating'
                : contest.ratingConfig?.scope === 'GLOBAL'
                  ? '全局 Rating'
                  : '不计 Rating'
              return (
                <Link key={contest.id} className={styles.item} href={`${basePath}/contests/${contest.id}`}>
                  <span className={styles.itemMain}>
                    <span className={styles.itemTitle}>{contest.title}</span>
                    <span className={styles.itemMeta}>
                      <span><CalendarClock size={14} />{displayTime(contest.startTime)} 至 {displayTime(contest.endTime)}</span>
                      <span><ListChecks size={14} />{contest.problemCount} 题</span>
                      <span><UsersRound size={14} />{contest.participantCount} 人</span>
                      <span>{contest.format.toUpperCase()} · {ratingLabel}</span>
                    </span>
                  </span>
                  <span className={styles.itemEnd}><StatusBadge variant={status.variant}>{status.label}</StatusBadge><ArrowRight size={17} /></span>
                </Link>
              )
            })}
          </div>
        )}
      </AsyncRegion>
      <TrainingFormModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); void resource.retry() }}
        mode="contest"
      />
    </PageFrame>
  )
}
