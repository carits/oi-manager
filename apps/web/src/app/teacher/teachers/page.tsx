'use client'

import { useEffect, useState } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import TeachersTab from '../school/components/TeachersTab'

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
    return (
      <ProtectedRoute requiredRole="teacher">
        <div style={{ padding: '2rem', textAlign: 'center' }}>加载中...</div>
      </ProtectedRoute>
    )
  }

  if (!school) {
    return (
      <ProtectedRoute requiredRole="teacher">
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>教师管理</h2>
        </div>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>未找到学校信息</p>
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="teacher">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>教师管理</h2>
      </div>
      <div style={{ background: 'white', borderRadius: '8px', padding: '1.5rem', border: '1px solid var(--border)' }}>
        <TeachersTab school={school} isPrincipal={isPrincipal} showActions={true} />
      </div>
    </ProtectedRoute>
  )
}