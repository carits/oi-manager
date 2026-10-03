'use client'

import { useState } from 'react'
import unifiedStyles from './page.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { createPlatformAdministrator } from '@/features/user-admin'

export default function NewPlatformAdminPage() {
  const router = useRouter()
  const toast = useToast()
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    name: '',
    phone: '',
    email: '',
    bio: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.username || !formData.password || !formData.name) {
      setError('用户名、密码和姓名为必填项')
      return
    }

    if (formData.password.length < 6) {
      setError('密码长度至少为6位')
      return
    }

    setLoading(true)

    try {
      const result = await createPlatformAdministrator(formData)

      if (result.ok) {
        toast.success('平台管理员创建成功')
        router.push('/admin/users')
      } else {
        setError(result.error.userMessage || '创建失败')
      }
    } catch (e) {
      setError('网络错误')
      console.error('Create platform admin error:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className={unifiedStyles.u1}>
        <main className={unifiedStyles.u2}>
          <div className={unifiedStyles.u3}>
            <Button variant="ghost"
              onClick={() => router.push('/admin/users')}
              className={unifiedStyles.u4}
            >
              ← 返回
            </Button>
            <h2 className={unifiedStyles.u5}>创建平台管理员</h2>
          </div>

          {error && (
            <div className={unifiedStyles.u6}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className={unifiedStyles.u7}>
            <div className={unifiedStyles.u3}>
              <label className={unifiedStyles.u8}>
                用户名 <span className={unifiedStyles.u9}>*</span>
              </label>
              <Input
                aria-label="用户名"
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className={unifiedStyles.u10}
                required
              />
            </div>

            <div className={unifiedStyles.u3}>
              <label className={unifiedStyles.u8}>
                密码 <span className={unifiedStyles.u9}>*</span>
              </label>
              <Input
                aria-label="密码"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={unifiedStyles.u10}
                required
                minLength={6}
              />
              <p className={unifiedStyles.u11}>至少6位字符</p>
            </div>

            <div className={unifiedStyles.u3}>
              <label className={unifiedStyles.u8}>
                姓名 <span className={unifiedStyles.u9}>*</span>
              </label>
              <Input
                aria-label="姓名"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={unifiedStyles.u10}
                required
              />
            </div>

            <div className={unifiedStyles.u3}>
              <label className={unifiedStyles.u8}>
                手机号
              </label>
              <Input
                aria-label="手机号"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className={unifiedStyles.u10}
              />
            </div>

            <div className={unifiedStyles.u3}>
              <label className={unifiedStyles.u8}>
                邮箱
              </label>
              <Input
                aria-label="邮箱"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={unifiedStyles.u10}
              />
            </div>

            <div className={unifiedStyles.u3}>
              <label className={unifiedStyles.u8}>
                简介
              </label>
              <Textarea
                aria-label="简介"
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                rows={3}
                className={unifiedStyles.u10}
              />
            </div>

            <div className={unifiedStyles.u12}>
              <Button variant="primary"
                type="submit"
                disabled={loading}
              >
                {loading ? '创建中...' : '创建'}
              </Button>
              <Button variant="ghost"
                type="button"
                onClick={() => router.push('/admin/users')}
                className={unifiedStyles.u13}
              >
                取消
              </Button>
            </div>
          </form>
        </main>
      </div>
    </>
  )
}
