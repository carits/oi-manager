'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
// 教师管理已整合到"我的学校"页面
export default function SchoolTeachersPage() {
  const router = useRouter()

  useEffect(() => {
    router.push('/teacher/schools')
  }, [router])

  return (
    <>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>正在跳转到我的学校...</p>
      </div>
    </>
  )
}
