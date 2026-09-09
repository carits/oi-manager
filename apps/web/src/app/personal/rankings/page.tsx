'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import PersonalRankingsTab from '@/components/organization-pages/student/rating/PersonalRankingsTab'
import { PersonalRatingDashboard } from '@/components/ranking/PersonalRatingDashboard'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import styles from '@/components/ranking/RankingPage.module.css'

type RankingTab = 'rating' | 'solved' | 'contribution'

export default function PersonalRankingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab: RankingTab = searchParams.get('tab') === 'solved' ? 'solved' : searchParams.get('tab') === 'contribution' ? 'contribution' : 'rating'

  const setTab = (tab: RankingTab) => {
    const params = new URLSearchParams(searchParams.toString())
    tab === 'rating' ? params.delete('tab') : params.set('tab', tab)
    router.replace(`/personal/rankings${params.size ? `?${params}` : ''}`, { scroll: false })
  }

  return (
    <PageFrame>
      <div className={styles.content}>
        <PageHeader title="个人排行榜" description="仅展示个人工作区的公开用户名资料。" />
        <SegmentedControl label="排名指标" value={activeTab} onChange={setTab} items={[{ value: 'rating', label: 'Rating' }, { value: 'solved', label: '做题量' }, { value: 'contribution', label: '贡献' }]} />
        {activeTab === 'rating' && <PersonalRatingDashboard />}
        <PersonalRankingsTab type={activeTab} />
      </div>
    </PageFrame>
  )
}
