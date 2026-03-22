'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'

// 成绩管理已整合到比赛中心
export default function ScoresPage() {
  const router = useRouter()

  useEffect(() => {
    router.push('/teacher/contests')
  }, [router])

  return (
    <ProtectedRoute requiredRole="teacher">
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>正在跳转到比赛中心...</p>
      </div>
    </ProtectedRoute>
  )
}
