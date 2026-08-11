'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import apiClient from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
// 复用教师端的组件
import HomeTab from '@/app/teacher/school/components/HomeTab'
import TeachersTab from '@/app/teacher/school/components/TeachersTab'
import StudentsTab from '@/app/teacher/school/components/StudentsTab'
import RankingsTab from '@/app/teacher/school/components/RankingsTab'
import TeamsTab from '@/app/teacher/school/components/TeamsTab'
import ContestsTab from '@/app/teacher/school/components/ContestsTab'

type TabType = 'home' | 'teachers' | 'students' | 'rankings' | 'teams' | 'contests'

interface School {
  id: string
  name: string
  shortName: string | null
  description: string | null
  announcement: string | null
  region: string | null
  schoolType: string | null
  schoolNature: string | null
  educationSystem: string | null
  educationSystemDetail: { primaryYears?: number; middleYears?: number; highYears?: number } | null
  informaticsEnabled: boolean
  informaticsStages: string[] | null
  informaticsContests: string[] | null
  informaticsTracks: string[] | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  currentPrincipalTeacherId: string | null
  _count: {
    teams: number
    teachers: number
    students: number
  }
}

export default function StudentSchoolPage() {
  const { user, sessionKey } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabType>((searchParams.get('tab') as TabType) || 'home')
  const [school, setSchool] = useState<School | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user?.schoolId) {
      fetchSchool()
    } else {
      setLoading(false)
    }
  }, [user?.schoolId])

  useEffect(() => {
    const tab = searchParams.get('tab') as TabType
    if (tab && ['home', 'teachers', 'students', 'rankings', 'teams', 'contests'].includes(tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    router.push(`/student/school?tab=${tab}`, { scroll: false })
  }

  const fetchSchool = async () => {
    try {
      const result = await apiClient.get<School>(`/api/schools/${user?.schoolId}`)
      if (result.success) {
        setSchool(result.data || null)
      }
    } catch (error) {
      console.error('Failed to fetch school:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <PageLoadingFrame title="我的学校" />
  }

  if (!school) {
    return (
      <>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>未找到学校信息</p>
        </div>
      </>
    )
  }

  const tabs = [
    { key: 'home', label: '主页' },
    { key: 'teachers', label: '教师' },
    { key: 'students', label: '学生' },
    { key: 'rankings', label: 'Rating 排名' },
    { key: 'teams', label: '团队' },
    { key: 'contests', label: '比赛' }
  ]

  return (
    <>
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
          <PageHeader title="校园" />

          {/* Tab 导航 */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              marginBottom: '1.5rem',
              borderBottom: '1px solid var(--border)',
              background: 'white',
              padding: '0.5rem 1rem',
              borderRadius: '8px 8px 0 0'
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key as TabType)}
                style={{
                  padding: '0.5rem 1rem',
                  background: activeTab === tab.key ? 'var(--primary-50)' : 'transparent',
                  color: activeTab === tab.key ? 'var(--primary)' : 'var(--gray-700)',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  transition: 'all 0.2s'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab 内容 - 复用教师端组件，但学生端不需要操作权限 */}
          <div style={activeTab === 'home' ? undefined : { background: 'white', borderRadius: '0 0 8px 8px', padding: '1.5rem' }}>
            {activeTab === 'home' && (
              <HomeTab school={school} isPrincipal={false} onAnnouncementUpdate={fetchSchool} />
            )}
            {activeTab === 'teachers' && <TeachersTab school={school} isPrincipal={false} showActions={false} />}
            {activeTab === 'students' && <StudentsTab schoolId={school.id} showHeader={true} />}
            {activeTab === 'rankings' && <RankingsTab schoolId={school.id} educationSystem={school.educationSystem} />}
            {activeTab === 'teams' && <TeamsTab schoolId={school.id} sessionKey={sessionKey} />}
            {activeTab === 'contests' && <ContestsTab schoolId={school.id} />}
          </div>
        </div>
      </div>
    </>
  )
}
