'use client'

import { useEffect, useState } from 'react'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { AlertCircle, LogIn } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../model/AuthProvider'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { ENV } from '@/config/env'
import { getRoleHome } from '@/lib/roleAccess'
import { isGlobalAdministrator } from '@/lib/capabilities'
import styles from './LoginForm.module.css'

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter()
  const { login, isAuthenticated, user } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isAuthenticated && user) {
      const isGlobalAdmin = isGlobalAdministrator(user.accountRole)
      router.replace(nextPath || (isGlobalAdmin ? getRoleHome(user.accountRole, 'organization') : '/identity'))
    }
  }, [isAuthenticated, nextPath, router, user])

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    const result = await login(username.trim(), password)
    if (!result.success) {
      setError('登录失败，请检查用户名和密码')
      setLoading(false)
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brand}><img className={styles.logo} src="/logo.png" alt="Carits" /></div>
        <div className={styles.content}>
          <div className={styles.heading}><h1 className={styles.title} id="login-title">登录</h1><p className={styles.subtitle}>使用账号登录后选择身份</p></div>
          <form className={styles.form} onSubmit={handleLogin}>
            <FormField label="用户名" required>
              <Input name="username" type="text" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required autoFocus />
            </FormField>
            <FormField label="密码" required>
              <Input name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
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
