'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// 旧路由重定向到新路由
export default function SuperAdminRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/admin/schools')
  }, [router])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <p>正在跳转...</p>
    </div>
  )
}