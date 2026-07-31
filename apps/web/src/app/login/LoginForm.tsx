'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { getLastStudentMode } from '@/lib/auth'
import type { LoginRole } from '@/lib/loginRole'
import { ENV } from '@/config/env'
import { getRoleHome } from '@/lib/roleAccess'

export function LoginForm({
  initialRole,
  nextPath,
}: {
  initialRole: LoginRole
  nextPath?: string
}) {
  const router = useRouter()
  const { login, isAuthenticated, user } = useAuth()
  const [role, setRole] = useState<LoginRole>(initialRole)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 如果已登录，跳转到对应首页
  useEffect(() => {
    if (isAuthenticated && user) {
      router.replace(nextPath || getRoleHome(user.role))
    }
  }, [isAuthenticated, nextPath, router, user])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // 学生登录默认使用上次模式
    const mode = role === 'student' ? (getLastStudentMode() || 'campus') : undefined
    const result = await login(username, password, role, mode)

    if (result.success) {
      // 登录成功后会触发 useEffect 进行跳转
    } else {
      setError(result.message || '登录失败，请检查用户名和密码')
    }

    setLoading(false)
  }

  const roleOptions: Array<{ key: string; label: string; role: LoginRole }> = [
    { key: 'teacher', label: '教师端', role: 'teacher' },
    { key: 'student', label: '学生端', role: 'student' },
    { key: 'admin', label: '管理员端', role: 'admin' },
  ]

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-page)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        padding: '2rem',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <img src="/logo.png" alt="Carits" style={{ height: '48px' }} />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {roleOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRole(opt.role)}
              aria-pressed={role === opt.role}
              style={{
                flex: 1,
                padding: '0.5rem',
                borderRadius: 'var(--radius)',
                background: role === opt.role ? 'var(--primary)' : 'var(--bg-hover)',
                color: role === opt.role ? 'white' : 'var(--text-secondary)',
                fontWeight: role === opt.role ? 500 : 400,
                fontSize: '0.875rem',
                border: '1px solid ' + (role === opt.role ? 'var(--primary)' : 'var(--border)'),
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleLogin} style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label htmlFor="login-username" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              用户名
            </label>
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                fontSize: '1rem'
              }}
            />
          </div>

          <div>
            <label htmlFor="login-password" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              密码
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
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
              borderRadius: 'var(--radius)',
              fontSize: '1rem',
              fontWeight: 500,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
              border: 'none'
            }}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        {ENV.IS_DEV && (
          <p style={{ marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            演示账号: teacher / student / admin (密码: 123456)
          </p>
        )}
      </div>
    </main>
  )
}
