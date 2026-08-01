'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import PersonalRankingsTab from '@/app/student/rating/PersonalRankingsTab'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/components/AuthProvider'

type RankingTab = 'rating' | 'solved'

export default function PersonalRankingsPage() {
  const { user } = useAuth()
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
      <PageHeader title="个人排名" description={`当前以用户名 ${user?.username || ''} 参与个人工作区排名。`} />
      <Tabs label="排名指标" value={activeTab} onChange={setTab} items={[{ value: 'rating', label: 'Rating' }, { value: 'solved', label: '做题量' }]} />
      <PersonalRankingsTab type={activeTab} />
    </PageFrame>
  )
}
