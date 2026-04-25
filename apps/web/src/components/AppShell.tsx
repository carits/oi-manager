'use client'

import { ReactNode, useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { getNavConfig, getActiveNavItem, roleLabels, roleNames, UserRole } from '@/config/navigation'
import { getAssetUrl } from '@/lib/assets'

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
        background: 'var(--bg-page)'
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

  const getPlatformBindingPath = () => {
    if (role === 'super_admin' || role === 'platform_admin') return '/admin/platform-bindings'
    if (role === 'student') return '/student/platform-bindings'
    return '/teacher/platform-bindings'
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
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)' }}>
      {/* 统一顶部导航 */}
      <header style={{
        background: 'var(--bg-card)',
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
          <img
            src="/logo.png"
            alt="Carits"
            style={{ height: '48px', cursor: 'pointer' }}
            onClick={() => router.push(`/${role === 'super_admin' ? 'admin/schools' : role === 'platform_admin' ? 'platform-admin' : role === 'student' ? 'student' : 'teacher'}`)}
          />
          <nav style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem' }}>
            {navConfig.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  color: activeItem === item.label ? 'var(--primary)' : 'var(--text-secondary)',
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
              borderRadius: 'var(--radius)',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            {/* 头像 */}
            {user.avatar ? (
              <img
                src={getAssetUrl(user.avatar)}
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
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                {user.username}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {roleLabel}
              </span>
            </div>
            {/* 下拉箭头 */}
            <span style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
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
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
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
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
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
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                账号安全
              </Link>
              <Link
                href={getPlatformBindingPath()}
                onClick={() => setShowUserMenu(false)}
                style={{
                  display: 'block',
                  padding: '0.75rem 1rem',
                  fontSize: '0.875rem',
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                平台绑定
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
                  color: 'var(--error)',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--error-light)'}
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
