'use client'

import { useEffect, useState } from 'react'
import unifiedStyles from './page.unified.module.css'
import { Button } from '@/components/ui/Button'
import { useRouter, useParams } from 'next/navigation'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { getManagedUser, type ManagedUser as UserDetail } from '@/features/user-admin'
import { organizationRoleLabel } from '@/lib/humanPresentation'

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
      setUser(await getManagedUser(userId))
    } catch (e) {
      setError('网络错误')
      console.error('Fetch user error:', e)
    } finally {
      setLoading(false)
    }
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
                <p className={unifiedStyles.u10}>{organizationRoleLabel(user.accountRole)}</p>
              </div>
              <div>
                <label className={unifiedStyles.u9}>状态</label>
                <span className={`${unifiedStyles.statusBadge} ${user.status === 'active' ? unifiedStyles.statusActive : unifiedStyles.statusInactive}`}>
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
