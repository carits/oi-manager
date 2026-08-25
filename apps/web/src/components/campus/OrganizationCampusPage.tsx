'use client'

import { useCallback, useEffect, useState } from 'react'
import unifiedStyles from './OrganizationCampusPage.unified.module.css'
import { useParams } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import HomeTab, { type CampusSchool } from '@/components/organization-pages/teacher/school/components/HomeTab'
import EditSchoolModal from '@/components/organization-pages/teacher/school/components/EditSchoolModal'

export default function OrganizationCampusPage() {
  const { organizationId } = useParams<{ organizationId: string }>()
  const { user } = useAuth()
  const [school, setSchool] = useState<CampusSchool | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const isPrincipal = user?.organizationRole === 'school_principal'
  const fetchCampus = useCallback(async () => {
    setLoading(true)
    try {
      const result = await apiClient.get<CampusSchool>(`/api/organizations/${organizationId}/members/campus`)
      if (result.success && result.data) setSchool(result.data)
    } finally {
      setLoading(false)
    }
  }, [organizationId])
  useEffect(() => { void fetchCampus() }, [fetchCampus])
  if (loading) return <PageLoadingFrame title="校园" />
  if (!school) return <div className={unifiedStyles.u1}>未找到校园资料</div>
  const endpoint = `/api/organizations/${organizationId}/members/campus`
  return <div className={unifiedStyles.u2}>
    <HomeTab school={school} isPrincipal={isPrincipal} onAnnouncementUpdate={fetchCampus} onEditSchool={() => setEditing(true)} canViewWallet={user?.organizationRole === 'teacher' || isPrincipal} announcementEndpoint={`${endpoint}/announcement`} walletHref={`/org/${organizationId}/management?tab=wallet`} />
    {editing && <EditSchoolModal school={school} endpoint={endpoint} onClose={() => setEditing(false)} onSuccess={fetchCampus} />}
  </div>
}
