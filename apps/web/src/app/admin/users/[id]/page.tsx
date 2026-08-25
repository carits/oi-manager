'use client'

import { useEffect, useState } from 'react'
import unifiedStyles from './page.unified.module.css'
import { Button } from '@/components/ui/Button'
import { useRouter, useParams } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

interface UserDetail {
  id: string
  username: string
  role: string
  status: string
  phone?: string
  email?: string
  bio?: string
  createdAt: string
  profile?: {
    name: string
    schoolName?: string
    teamName?: string
  }
}

export default function UserDetailPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.id as string

  const [user, setUser] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchUser()
  }, [userId])

  const fetchUser = async () => {
    try {
      const result = await apiClient.get<UserDetail>(`/api/users/${userId}`)
      if (result.success) {
        setUser(result.data || null)
      } else {
        setError(result.message || '加载失败')
      }
    } catch (e) {
      setError('网络错误')
      console.error('Fetch user error:', e)
    } finally {
      setLoading(false)
    }
  }

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      super_admin: '超级管理员',
      platform_admin: '平台管理员',
      school_principal: '学校负责人',
      teacher: '教师',
      student: '学生'
    }
    return labels[role] || role
  }

  if (loading) {
    return <PageLoadingFrame title="用户详情" />
  }

  if (error || !user) {
    return (
      <>
        <div className={unifiedStyles.u1}>
          <div className={unifiedStyles.u2}>
            {error || '用户不存在'}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className={unifiedStyles.u3}>
        <main className={unifiedStyles.u4}>
          <Button variant="ghost"
            onClick={() => router.push('/admin/users')}
            className={unifiedStyles.u5}
          >
            ← 返回
          </Button>

          <h2 className={unifiedStyles.u6}>用户详情</h2>

          <div className={unifiedStyles.u7}>
            <div className={unifiedStyles.u8}>
              <div>
                <label className={unifiedStyles.u9}>用户名</label>
                <p className={unifiedStyles.u10}>{user.username}</p>
              </div>
              <div>
                <label className={unifiedStyles.u9}>姓名</label>
                <p className={unifiedStyles.u10}>{user.profile?.name || '-'}</p>
              </div>
              <div>
                <label className={unifiedStyles.u9}>角色</label>
                <p className={unifiedStyles.u10}>{getRoleLabel(user.role)}</p>
              </div>
              <div>
                <label className={unifiedStyles.u9}>状态</label>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  background: user.status === 'active' ? 'var(--success-light)' : 'var(--error-light)',
                  color: user.status === 'active' ? 'var(--success-text)' : 'var(--error-text)'
                }}>
                  {user.status === 'active' ? '正常' : '禁用'}
                </span>
              </div>
              <div>
                <label className={unifiedStyles.u9}>手机号</label>
                <p className={unifiedStyles.u11}>{user.phone || '-'}</p>
              </div>
              <div>
                <label className={unifiedStyles.u9}>邮箱</label>
                <p className={unifiedStyles.u11}>{user.email || '-'}</p>
              </div>
              {user.profile?.schoolName && (
                <div>
                  <label className={unifiedStyles.u9}>学校</label>
                  <p className={unifiedStyles.u11}>{user.profile.schoolName}</p>
                </div>
              )}
              {user.profile?.teamName && (
                <div>
                  <label className={unifiedStyles.u9}>团队</label>
                  <p className={unifiedStyles.u11}>{user.profile.teamName}</p>
                </div>
              )}
              <div>
                <label className={unifiedStyles.u9}>创建时间</label>
                <p className={unifiedStyles.u11}>{new Date(user.createdAt).toLocaleString()}</p>
              </div>
            </div>

            {user.bio && (
              <div className={unifiedStyles.u12}>
                <label className={unifiedStyles.u9}>简介</label>
                <p className={unifiedStyles.u11}>{user.bio}</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
