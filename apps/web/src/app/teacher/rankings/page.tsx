'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import RankingsTab from '@/app/teacher/school/components/RankingsTab'
import SolvedCountTab from '@/app/teacher/school/components/SolvedCountTab'
import { Empty } from '@/components/ui/Empty'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import styles from '@/components/ranking/RankingPage.module.css'

type TabType = 'rating' | 'solved'

export default function TeacherRankingsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab: TabType = searchParams.get('tab') === 'solved' ? 'solved' : 'rating'

  const setTab = (tab: TabType) => {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'rating') params.delete('tab')
    else params.set('tab', tab)
    params.delete('page')
    router.replace(`/teacher/rankings${params.size ? `?${params}` : ''}`, { scroll: false })
  }

  return (
    <PageFrame>
      <div className={styles.content}>
        <PageHeader title="校内排行榜" description="查看本校学生的 Rating 与做题量排名。" />
        <SegmentedControl label="排名指标" value={activeTab} onChange={setTab} items={[{ value: 'rating', label: 'Rating' }, { value: 'solved', label: '做题量' }]} />
        {user?.schoolId
          ? activeTab === 'rating' ? <RankingsTab schoolId={user.schoolId} /> : <SolvedCountTab schoolId={user.schoolId} />
          : <Empty title="尚未绑定学校" description="绑定学校后才能查看校内排名。" />}
      </div>
    </PageFrame>
  )
}
