'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import TeachersTab from '../school/components/TeachersTab'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import styles from '@/components/management/ManagementList.module.css'

interface School {
  id: string
  name: string
  currentPrincipalTeacherId: string | null
}

export default function TeachersPage() {
  const { user } = useAuth()
  const [school, setSchool] = useState<School | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPrincipal, setIsPrincipal] = useState(false)

  useEffect(() => {
    if (user?.schoolId) {
      fetchSchool()
      checkPrincipal()
    } else {
      setLoading(false)
    }
  }, [user?.schoolId])

  const fetchSchool = async () => {
    try {
      const result = await apiClient.get<School>(`/api/schools/${user?.schoolId}`)
      if (result.success) {
        setSchool(result.data ?? null)
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
          setIsPrincipal((teacherResult.data as any).id === schoolResult.data.currentPrincipalTeacherId)
        }
      }
    } catch (error) {
      console.error('Failed to check principal:', error)
    }
  }

  if (loading) {
    return <PageLoadingFrame title="教师" />
  }

  if (!school) {
    return (
      <div className={styles.page}>
        <PageHeader title="教师" description="管理本校教师账号与身份" />
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>未找到学校信息</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="教师" description="管理本校教师账号与身份" />
      <TeachersTab school={school} isPrincipal={isPrincipal} showActions={true} />
    </div>
  )
}
