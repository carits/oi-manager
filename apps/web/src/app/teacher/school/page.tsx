'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import HomeTab from './components/HomeTab'
import TeachersTab from './components/TeachersTab'
import StudentsTab from './components/StudentsTab'
import RankingsTab from './components/RankingsTab'
import TeamsTab from './components/TeamsTab'
import ProblemListsTab from './components/ProblemListsTab'
import ContestsTab from './components/ContestsTab'
import EditSchoolModal from './components/EditSchoolModal'

type TabType = 'home' | 'teachers' | 'students' | 'rankings' | 'teams' | 'problem-lists' | 'contests'

interface School {
  id: string
  name: string
  shortName: string | null
  announcement: string | null
  region: string | null
  schoolType: string | null
  educationSystem: string | null
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

export default function SchoolPage() {
  const { user, sessionKey } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabType>((searchParams.get('tab') as TabType) || 'home')
  const [school, setSchool] = useState<School | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPrincipal, setIsPrincipal] = useState(false)
  const [showEditSchoolModal, setShowEditSchoolModal] = useState(false)

  useEffect(() => {
    if (user?.schoolId) {
      fetchSchool()
      checkPrincipal()
    } else {
      setLoading(false)
    }
  }, [user?.schoolId])

  useEffect(() => {
    const tab = searchParams.get('tab') as TabType
    if (tab && ['home', 'teachers', 'students', 'rankings', 'teams', 'problem-lists', 'contests'].includes(tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    router.push(`/teacher/school?tab=${tab}`, { scroll: false })
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

  const checkPrincipal = async () => {
    try {
      const teacherResult = await apiClient.get<{ id: string }>('/api/teachers/me')
      if (teacherResult.success && user?.schoolId) {
        const schoolResult = await apiClient.get<School>(`/api/schools/${user.schoolId}`)
        if (schoolResult.success && schoolResult.data) {
          setIsPrincipal(teacherResult.data?.id === schoolResult.data.currentPrincipalTeacherId)
        }
      }
    } catch (error) {
      console.error('Failed to check principal:', error)
    }
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole="teacher">
        <div style={{ padding: '2rem', textAlign: 'center' }}>加载中...</div>
      </ProtectedRoute>
    )
  }

  if (!school) {
    return (
      <ProtectedRoute requiredRole="teacher">
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>未找到学校信息</p>
        </div>
      </ProtectedRoute>
    )
  }

  const tabs = [
    { key: 'home', label: '主页' },
    { key: 'teachers', label: '教师' },
    { key: 'students', label: '学生' },
    { key: 'rankings', label: 'Rating 排名' },
    { key: 'teams', label: '团队' },
    { key: 'problem-lists', label: '题单' },
    { key: 'contests', label: '比赛' }
  ]

  return (
    <ProtectedRoute requiredRole="teacher">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
          <PageHeader title={school.name}>
            {isPrincipal && (
              <Button onClick={() => setShowEditSchoolModal(true)}>编辑学校信息</Button>
            )}
          </PageHeader>

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
                  background: activeTab === tab.key ? 'var(--primary)' : 'transparent',
                  color: activeTab === tab.key ? 'white' : 'var(--gray-700)',
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

          {/* Tab 内容 */}
          <div style={{ background: 'white', borderRadius: '0 0 8px 8px', padding: '1.5rem' }}>
            {activeTab === 'home' && (
              <HomeTab school={school} isPrincipal={isPrincipal} onAnnouncementUpdate={fetchSchool} />
            )}
            {activeTab === 'teachers' && <TeachersTab school={school} isPrincipal={isPrincipal} showActions={false} />}
            {activeTab === 'students' && <StudentsTab schoolId={school.id} showHeader={true} />}
            {activeTab === 'rankings' && <RankingsTab schoolId={school.id} educationSystem={school.educationSystem} />}
            {activeTab === 'teams' && <TeamsTab schoolId={school.id} sessionKey={sessionKey} />}
            {activeTab === 'problem-lists' && <ProblemListsTab schoolId={school.id} />}
            {activeTab === 'contests' && <ContestsTab schoolId={school.id} />}
          </div>
        </div>

        {showEditSchoolModal && (
          <EditSchoolModal
            school={school}
            onClose={() => setShowEditSchoolModal(false)}
            onSuccess={fetchSchool}
          />
        )}
      </div>
    </ProtectedRoute>
  )
}
