'use client'

import { useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/features/auth'
import { Empty } from '@/components/ui/Empty'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { MetricRankingWorkspace } from '@/features/ranking'
import { isPersonalPath } from '@/lib/workspacePath'
import styles from '@/features/ranking/RankingPage.module.css'

type TabType = 'rating' | 'solved' | 'contribution'

export default function StudentRatingPage() {
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams<{ organizationId?: string }>()
  const searchParams = useSearchParams()
  const isPersonalMode = isPersonalPath(pathname)
  const activeTab: TabType = searchParams.get('tab') === 'solved' ? 'solved' : searchParams.get('tab') === 'contribution' ? 'contribution' : 'rating'

  const setTab = (tab: TabType) => {
    const next = new URLSearchParams(searchParams.toString())
    tab === 'rating' ? next.delete('tab') : next.set('tab', tab)
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false })
  }

  return (
    <PageFrame>
      <div className={styles.content}>
        <PageHeader title={isPersonalMode ? '个人排行榜' : '校内排行榜'} description={isPersonalMode ? '仅展示个人空间的公开用户名资料。' : '查看当前学校成员的 Rating、做题量与贡献排名。'} />
        <SegmentedControl label="排名指标" value={activeTab} onChange={setTab} items={[{ value: 'rating', label: 'Rating' }, { value: 'solved', label: '做题量' }, { value: 'contribution', label: '贡献' }]} />
        {isPersonalMode ? <MetricRankingWorkspace scope="personal" metric={activeTab} /> : params.organizationId ? <MetricRankingWorkspace scope="campus" metric={activeTab} /> : <Empty title="未找到当前学校" description="请从身份选择页重新进入学校。" />}
      </div>
    </PageFrame>
  )
}
