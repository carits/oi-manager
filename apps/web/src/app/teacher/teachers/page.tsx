'use client'

import { useEffect, useState } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/components/AuthProvider'
import { getAuthHeaders } from '@/lib/auth'
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

  const checkPrincipal = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/teachers/me', {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success && user?.schoolId) {
        const schoolRes = await fetch(`http://localhost:3001/api/schools/${user.schoolId}`, {
          headers: getAuthHeaders()
        })
        const schoolData = await schoolRes.json()
        if (schoolData.success) {
          setIsPrincipal(data.data.id === schoolData.data.currentPrincipalTeacherId)
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
