'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import HomeTab, { type CampusSchool } from './components/HomeTab'
import EditSchoolModal from './components/EditSchoolModal'

export default function SchoolPage() {
  const { user } = useAuth()
  const [school, setSchool] = useState<CampusSchool | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPrincipal, setIsPrincipal] = useState(false)
  const [showEditSchoolModal, setShowEditSchoolModal] = useState(false)

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

  useEffect(() => {
    if (!school?.currentPrincipalTeacherId) {
      setIsPrincipal(false)
      return
    }

    apiClient.get<{ id: string }>('/api/teachers/me')
      .then(result => setIsPrincipal(Boolean(result.success && result.data?.id === school.currentPrincipalTeacherId)))
      .catch(() => setIsPrincipal(false))
  }, [school?.currentPrincipalTeacherId])

  if (loading) return <PageLoadingFrame title="校园" />

  if (!school) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}><p>未找到学校信息</p></div>
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: 'clamp(1rem, 3vw, 2rem)' }}>
      <HomeTab school={school} isPrincipal={isPrincipal} onAnnouncementUpdate={fetchSchool} onEditSchool={() => setShowEditSchoolModal(true)} canViewWallet={user?.organizationRole === 'teacher' || user?.organizationRole === 'school_principal'} />
      {showEditSchoolModal && (
        <EditSchoolModal school={school} onClose={() => setShowEditSchoolModal(false)} onSuccess={fetchSchool} />
      )}
    </div>
  )
}
