'use client'

import { useEffect } from 'react'
import unifiedStyles from './page.unified.module.css'
import { useRouter } from 'next/navigation'

// 旧路由重定向到新路由
export default function SuperAdminRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/admin/schools')
  }, [router])

  return (
    <div className={unifiedStyles.u1}>
      <p>正在跳转...</p>
    </div>
  )
}