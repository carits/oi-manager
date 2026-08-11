'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import PersonalRankingsTab from '@/app/student/rating/PersonalRankingsTab'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

type RankingTab = 'rating' | 'solved'

export default function PersonalRankingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab: RankingTab = searchParams.get('tab') === 'solved' ? 'solved' : 'rating'

  const setTab = (tab: RankingTab) => {
    const params = new URLSearchParams(searchParams.toString())
    tab === 'rating' ? params.delete('tab') : params.set('tab', tab)
    router.replace(`/personal/rankings${params.size ? `?${params}` : ''}`, { scroll: false })
  }

  return (
    <PageFrame>
      <PageHeader title="个人排行榜" description="仅展示个人工作区的公开用户名资料。" />
      <SegmentedControl label="排名指标" value={activeTab} onChange={setTab} items={[{ value: 'rating', label: 'Rating' }, { value: 'solved', label: '做题量' }]} />
      <PersonalRankingsTab type={activeTab} />
    </PageFrame>
  )
}
