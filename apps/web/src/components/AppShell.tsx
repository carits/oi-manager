'use client'

import { ReactNode, useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { getNavConfig, getActiveNavItem, roleLabels, roleNames, UserRole } from '@/config/navigation'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, logout, loading } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [activeItem, setActiveItem] = useState('')
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    console.log('[AppShell] Mounted, pathname:', pathname)
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted && user?.role) {
      setActiveItem(getActiveNavItem(pathname, user.role))
    }
  }, [mounted, pathname, user?.role])

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!mounted) {
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

  if (!user) {
    router.push('/login')
    return null
  }

  const role = user.role as UserRole
  const navConfig = getNavConfig(role)
  const roleLabel = roleLabels[role] || '用户'
  const roleName = roleNames[role] || user.role

  // 根据角色获取个人中心和账号安全页面路径
  const getProfilePath = () => {
    if (role === 'super_admin' || role === 'platform_admin') return '/admin/profile'
    if (role === 'student') return '/student/profile'
    return '/teacher/profile'
  }

  const getSecurityPath = () => {
    if (role === 'super_admin' || role === 'platform_admin') return '/admin/security'
    if (role === 'student') return '/student/security'
    return '/teacher/security'
  }

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  // 获取用户名首字母
  const getInitial = () => {
    const profile = user.profile as { name?: string } | undefined
    const name = profile?.name || user.username
    return name?.charAt(0)?.toUpperCase() || '?'
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      {/* 统一顶部导航 */}
      <header style={{
        background: 'white',
        borderBottom: '1px solid var(--border)',
        padding: '0.75rem 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        {/* 左侧：Logo + 导航 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <h1
            style={{
              fontSize: '1.125rem',
              fontWeight: 600,
              cursor: 'pointer',
              color: 'var(--primary)'
            }}
            onClick={() => router.push(`/${role === 'super_admin' ? 'admin/schools' : role === 'platform_admin' ? 'platform-admin' : role === 'student' ? 'student' : 'teacher'}`)}
          >
            OI 管理平台
          </h1>
          <nav style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem' }}>
            {navConfig.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  color: activeItem === item.label ? 'var(--primary)' : 'var(--gray-600)',
                  fontWeight: activeItem === item.label ? 500 : 400,
                  textDecoration: 'none',
                  padding: '0.25rem 0',
                  borderBottom: activeItem === item.label ? '2px solid var(--primary)' : '2px solid transparent',
                  transition: 'all 0.2s',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* 右侧：头像下拉菜单 */}
        <div style={{ position: 'relative' }} ref={userMenuRef}>
          <div
            onClick={() => setShowUserMenu(!showUserMenu)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              cursor: 'pointer',
              padding: '0.25rem 0.5rem',
              borderRadius: '6px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gray-100)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            {/* 头像 */}
            {user.avatar ? (
              <img
                src={`http://localhost:3001${user.avatar}`}
                alt="头像"
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '2px solid var(--border)'
                }}
              />
            ) : (
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'var(--primary)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.875rem',
                fontWeight: 600
              }}>
                {getInitial()}
              </div>
            )}
            {/* 用户名和角色 */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-800)' }}>
                {user.username}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                {roleLabel}
              </span>
            </div>
            {/* 下拉箭头 */}
            <span style={{
              fontSize: '0.75rem',
              color: 'var(--gray-400)',
              transform: showUserMenu ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s'
            }}>
              ▼
            </span>
          </div>

          {/* 下拉菜单 */}
          {showUserMenu && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              background: 'white',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              border: '1px solid var(--border)',
              minWidth: '160px',
              overflow: 'hidden',
              zIndex: 200
            }}>
              <Link
                href={getProfilePath()}
                onClick={() => setShowUserMenu(false)}
                style={{
                  display: 'block',
                  padding: '0.75rem 1rem',
                  fontSize: '0.875rem',
                  color: 'var(--gray-700)',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gray-50)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                个人信息
              </Link>
              <Link
                href={getSecurityPath()}
                onClick={() => setShowUserMenu(false)}
                style={{
                  display: 'block',
                  padding: '0.75rem 1rem',
                  fontSize: '0.875rem',
                  color: 'var(--gray-700)',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gray-50)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                账号安全
              </Link>
              <button
                onClick={() => {
                  setShowUserMenu(false)
                  handleLogout()
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '0.75rem 1rem',
                  fontSize: '0.875rem',
                  color: '#ef4444',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 主内容区 */}
      <main style={{ padding: '1.5rem 2rem', maxWidth: '1400px', margin: '0 auto' }}>
        {children}
      </main>
    </div>
  )
}

// 页面标题组件
export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{title}</h2>
      {description && (
        <p style={{ color: 'var(--gray-500)', marginTop: '0.25rem', fontSize: '0.875rem' }}>
          {description}
        </p>
      )}
    </div>
  )
}

// 卡片容器组件
export function Card({ children, title, style }: { children: ReactNode; title?: string; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      padding: '1.5rem',
      border: '1px solid var(--border)',
      ...style
    }}>
      {title && (
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}
