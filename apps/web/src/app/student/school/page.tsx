'use client'

import { useEffect, useState } from 'react'
import apiClient from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import HomeTab, { type CampusSchool } from '@/app/teacher/school/components/HomeTab'

export default function StudentSchoolPage() {
  const { user } = useAuth()
  const [school, setSchool] = useState<CampusSchool | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSchool = async () => {
    if (!user?.schoolId) {
      setLoading(false)
      return
    }

    try {
      const result = await apiClient.get<CampusSchool>(`/api/schools/${user.schoolId}`)
      if (result.success && result.data) setSchool(result.data)
    } catch (error) {
      console.error('Failed to fetch school:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSchool() }, [user?.schoolId])

  if (loading) return <PageLoadingFrame title="校园" />

  if (!school) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}><p>未找到学校信息</p></div>
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: 'clamp(1rem, 3vw, 2rem)' }}>
      <HomeTab school={school} isPrincipal={false} onAnnouncementUpdate={fetchSchool} />
    </div>
  )
}
