'use client'

import { useEffect, useState } from 'react'
import unifiedStyles from './TeachersManagementContent.unified.module.css'
import { useParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import TeachersTab from '@/components/organization-pages/teacher/school/components/TeachersTab'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import styles from '@/components/management/ManagementList.module.css'

interface School {
  id: string
  name: string
}

export default function TeachersManagementContent() {
  const { user } = useAuth()
  const { organizationId } = useParams<{ organizationId?: string }>()
  const [school, setSchool] = useState<School | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPrincipal, setIsPrincipal] = useState(false)

  useEffect(() => {
    if (!organizationId) { setLoading(false); return }
    setSchool({ id: organizationId, name: '' })
    setIsPrincipal(user?.organizationRole === 'school_principal')
    setLoading(false)
  }, [organizationId, user?.organizationRole])

  if (loading) {
    return <PageLoadingFrame title="教师" />
  }

  if (!school) {
    return (
      <div className={styles.page}>
        <PageHeader title="教师" description="管理本校教师账号与身份" />
        <div className={unifiedStyles.u1}>
          <p>未找到学校信息</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="教师" description="管理本校教师账号与身份" />
      <TeachersTab school={school} isPrincipal={isPrincipal} showActions={true} organizationId={organizationId} />
    </div>
  )
}
