'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'

type Role = 'teacher' | 'student' | 'admin'

export default function LoginPage() {
  const router = useRouter()
  const { login, isAuthenticated, loading: authLoading, user } = useAuth()
  const [role, setRole] = useState<Role>('teacher')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 如果已登录，跳转到对应首页
  useEffect(() => {
    if (!authLoading && isAuthenticated && user) {
      if (user.role === 'super_admin') {
        router.push('/admin/schools')
      } else if (user.role === 'platform_admin') {
        router.push('/platform-admin')
      } else if (user.role === 'school_principal' || user.role === 'teacher') {
        router.push('/teacher')
      } else if (user.role === 'student') {
        router.push('/student')
      } else {
        router.push('/login')
      }
    }
  }, [authLoading, isAuthenticated, router, user])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const result = await login(username, password, role)

    if (result.success) {
      // 登录成功后会触发 useEffect 进行跳转
    } else {
      setError(result.message || '登录失败，请检查用户名和密码')
    }

    setLoading(false)
  }

  const roleLabels = {
    teacher: '教师端',
    student: '学生端',
    admin: '管理员端'
  }

  const allowedRoles: Role[] = ['teacher', 'student', 'admin']

  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <p>加载中...</p>
      </div>
    )
  }

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--gray-50)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        padding: '2rem',
        background: 'white',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <img src="/logo.png" alt="Carits" style={{ height: '48px' }} />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {allowedRoles.map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              style={{
                flex: '1 1 30%',
                minWidth: '80px',
                padding: '0.5rem',
                borderRadius: '6px',
                background: role === r ? 'var(--primary)' : 'var(--gray-100)',
                color: role === r ? 'white' : 'var(--gray-700)',
                fontWeight: role === r ? 500 : 400,
                fontSize: '0.875rem'
              }}
            >
              {roleLabels[r]}
            </button>
          ))}
        </div>

        <form onSubmit={handleLogin} style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--gray-700)' }}>
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '1rem'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--gray-700)' }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '1rem'
              }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--error)', fontSize: '0.875rem' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.5rem',
              padding: '0.75rem',
              background: 'var(--primary)',
              color: 'white',
              borderRadius: '6px',
              fontSize: '1rem',
              fontWeight: 500,
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p style={{ marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--gray-500)', textAlign: 'center' }}>
          演示账号: teacher / student / admin (密码: 123456)
        </p>
      </div>
    </main>
  )
}
