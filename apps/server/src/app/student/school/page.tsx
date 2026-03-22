'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { PageHeader } from '@/components/ui/PageHeader'
import { getAuthHeaders } from '@/lib/auth'
import { useAuth } from '@/components/AuthProvider'
// 复用教师端的组件
import HomeTab from '@/app/teacher/school/components/HomeTab'
import TeachersTab from '@/app/teacher/school/components/TeachersTab'
import StudentsTab from '@/app/teacher/school/components/StudentsTab'
import RankingsTab from '@/app/teacher/school/components/RankingsTab'
import TeamsTab from '@/app/teacher/school/components/TeamsTab'

type TabType = 'home' | 'teachers' | 'students' | 'rankings' | 'teams'

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

export default function StudentSchoolPage() {
  const { user } = useAuth()
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
    if (tab && ['home', 'teachers', 'students', 'rankings', 'teams'].includes(tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    router.push(`/student/school?tab=${tab}`, { scroll: false })
  }

  const fetchSchool = async () => {
    try {
      const res = await fetch(`http://localhost:3001/api/schools/${user?.schoolId}`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        setSchool(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch school:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole="student">
        <div style={{ padding: '2rem', textAlign: 'center' }}>加载中...</div>
      </ProtectedRoute>
    )
  }

  if (!school) {
    return (
      <ProtectedRoute requiredRole="student">
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
    { key: 'teams', label: '团队' }
  ]

  return (
    <ProtectedRoute requiredRole="student">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
          <PageHeader title={school.name} />

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

          {/* Tab 内容 - 复用教师端组件，但学生端不需要操作权限 */}
          <div style={{ background: 'white', borderRadius: '0 0 8px 8px', padding: '1.5rem' }}>
            {activeTab === 'home' && (
              <HomeTab school={school} isPrincipal={false} onAnnouncementUpdate={fetchSchool} />
            )}
            {activeTab === 'teachers' && <TeachersTab school={school} isPrincipal={false} showActions={false} />}
            {activeTab === 'students' && <StudentsTab schoolId={school.id} showHeader={true} />}
            {activeTab === 'rankings' && <RankingsTab schoolId={school.id} educationSystem={school.educationSystem} />}
            {activeTab === 'teams' && <TeamsTab schoolId={school.id} />}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}
