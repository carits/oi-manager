'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, LogIn } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { getAccountWorkspaceMode } from '@/lib/auth'
import type { LoginRole } from '@/lib/loginRole'
import { ENV } from '@/config/env'
import { getRoleHome } from '@/lib/roleAccess'
import styles from './login.module.css'

export function LoginForm({ initialRole, nextPath }: { initialRole: LoginRole; nextPath?: string }) {
  const router = useRouter()
  const { login, isAuthenticated, user } = useAuth()
  const [role, setRole] = useState<LoginRole>(initialRole)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isAuthenticated && user) router.replace(nextPath || getRoleHome(user.role, user.workspaceMode || 'work'))
  }, [isAuthenticated, nextPath, router, user])

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    const mode = getAccountWorkspaceMode(username, role) === 'personal' ? 'personal' : 'campus'
    const result = await login(username.trim(), password, role, mode)
    if (!result.success) {
      setError(result.message || '登录失败，请检查用户名和密码')
      setLoading(false)
    }
  }

  const roleOptions: Array<{ label: string; role: LoginRole }> = [
    { label: '学生', role: 'student' },
    { label: '教师', role: 'teacher' },
    { label: '管理员', role: 'admin' },
  ]

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brand}><img className={styles.logo} src="/logo.png" alt="Carits" /></div>
        <div className={styles.content}>
          <div className={styles.heading}><h1 className={styles.title} id="login-title">登录</h1><p className={styles.subtitle}>选择入口后使用账号继续</p></div>
          <div className={styles.roleSelector} role="group" aria-label="登录入口">
            {roleOptions.map(option => (
              <button key={option.role} type="button" className={styles.roleButton} aria-pressed={role === option.role} onClick={() => { setRole(option.role); setError('') }}>{option.label}</button>
            ))}
          </div>
          <form className={styles.form} onSubmit={handleLogin}>
            <FormField label="用户名" required>
              <input name="username" type="text" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required autoFocus />
            </FormField>
            <FormField label="密码" required>
              <input name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
            </FormField>
            {error && <p className={styles.error} role="alert"><AlertCircle size={18} aria-hidden="true" />{error}</p>}
            <Button type="submit" size="lg" fullWidth loading={loading} icon={<LogIn size={18} aria-hidden="true" />}>登录</Button>
          </form>
          {ENV.IS_DEV && <p className={styles.devHint}>开发环境演示账号密码为 123456</p>}
        </div>
      </section>
    </main>
  )
}
