'use client'

import { ReactNode, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'

interface StudentLayoutProps {
  children: ReactNode
}

export default function StudentLayout({ children }: StudentLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()
  // 本地状态：是否已检查过登录状态（避免依赖 AuthProvider 的 loading）
  const [checked, setChecked] = useState(false)

  // 组件挂载后立即检查 localStorage
  useEffect(() => {
    const token = localStorage.getItem('token')
    const role = localStorage.getItem('role')
    if (!token || !role) {
      // 无 token，直接跳转登录页
      router.replace('/login?role=student')
    } else {
      setChecked(true)
    }
  }, [router])

  // 未检查完成时显示加载中
  if (!checked) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--gray-50)'
      }}>
        加载中...
      </div>
    )
  }

  // loading=true 时等待 AuthProvider 完成验证
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--gray-50)'
      }}>
        验证登录状态...
      </div>
    )
  }

  // loading=false 且 user=null 时跳转登录页
  if (!user) {
    router.replace('/login?role=student')
    return null
  }

  // student 目录下的页面使用 AppShell
  // 注意：student/page.tsx (首页) 自己处理 AppShell，避免重复嵌套
  const isStudentHome = pathname === '/student'

  if (isStudentHome) {
    return <>{children}</>
  }

  return <AppShell>{children}</AppShell>
}
