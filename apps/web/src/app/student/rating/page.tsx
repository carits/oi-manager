'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import RankingsTab from '@/app/teacher/school/components/RankingsTab'
import SolvedCountTab from '@/app/teacher/school/components/SolvedCountTab'
import apiClient from '@/lib/apiClient'
import { Empty } from '@/components/ui/Empty'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import PersonalRankingsTab from './PersonalRankingsTab'

type TabType = 'rating' | 'solved'

export default function StudentRatingPage() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isPersonalMode = user?.workspaceMode === 'personal'
  const activeTab: TabType = searchParams.get('tab') === 'solved' ? 'solved' : 'rating'
  const [schoolInfo, setSchoolInfo] = useState<{ educationSystem?: string | null } | null>(null)

  useEffect(() => {
    if (user?.schoolId && !isPersonalMode) {
      apiClient.get<{ educationSystem?: string | null }>(`/api/schools/${user.schoolId}`).then(result => {
        if (result.success && result.data) setSchoolInfo({ educationSystem: result.data.educationSystem })
      })
    }
  }, [isPersonalMode, user?.schoolId])

  const setTab = (tab: TabType) => {
    const params = new URLSearchParams(searchParams.toString())
    tab === 'rating' ? params.delete('tab') : params.set('tab', tab)
    router.replace(`/student/rating${params.size ? `?${params}` : ''}`, { scroll: false })
  }

  return (
    <PageFrame>
      <PageHeader title={isPersonalMode ? '个人排名' : '校内排名'} description={isPersonalMode ? `当前按用户名 ${user?.username || ''} 展示个人模式数据。` : '当前排名范围仅包含所在学校。'} />
      <Tabs label="排名指标" value={activeTab} onChange={setTab} items={[{ value: 'rating', label: 'Rating' }, { value: 'solved', label: '做题量' }]} />
      {isPersonalMode ? <PersonalRankingsTab type={activeTab} /> : user?.schoolId ? activeTab === 'rating' ? <RankingsTab schoolId={user.schoolId} educationSystem={schoolInfo?.educationSystem} /> : <SolvedCountTab schoolId={user.schoolId} educationSystem={schoolInfo?.educationSystem} /> : <Empty title="尚未绑定学校" description="绑定学校后才能查看校内排名。" />}
    </PageFrame>
  )
}
