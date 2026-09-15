'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, School } from 'lucide-react'
import type { ProfileUserType, PublicUserProfile } from '@oi-manager/contracts'
import { getAssetUrl } from '@/lib/assets'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { LoadError } from '@/components/ui/LoadError'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { getPublicUserProfile } from '../api/userProfileApi'
import styles from './UserProfilePage.module.css'

export function UserProfilePage({ userType }: { userType: ProfileUserType }) {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const roleLabel = userType === 'student' ? '学生' : userType === 'teacher' ? '教师' : '用户'
  const [profile, setProfile] = useState<PublicUserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProfile = async () => {
    setLoading(true)
    setError(null)
    try {
      setProfile(await getPublicUserProfile(id, userType))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '用户资料读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchProfile()
  }, [id, userType])

  if (loading) return <PageLoadingFrame title={`${roleLabel}资料`} rows={5} />

  return (
    <PageFrame width="reading">
      <PageHeader
        title={`${roleLabel}资料`}
        breadcrumbs={[{ label: '用户资料' }, { label: profile?.name || profile?.username || roleLabel }]}
        actions={<Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => router.back()}>返回</Button>}
      />
      {error || !profile ? (
        <LoadError message={error || '用户资料不存在'} onRetry={fetchProfile} onBack={() => router.back()} />
      ) : (
        <Card padding="none" className={styles.profileCard}>
          <div className={styles.identity}>
            {profile.avatar ? (
              <img className={styles.avatar} src={getAssetUrl(profile.avatar)} alt={(profile.name || profile.username) + '的头像'} />
            ) : (
              <div className={styles.initial} aria-hidden="true">{(profile.name || profile.username)?.charAt(0)?.toUpperCase() || '?'}</div>
            )}
            <div>
              <h2 className={styles.name}>{profile.name || `@${profile.username}`}</h2>
              {profile.name && <p className={styles.username}>@{profile.username}</p>}
              <Badge variant={userType === 'student' ? 'success' : userType === 'teacher' ? 'info' : 'neutral'}>{roleLabel}</Badge>
            </div>
          </div>
          <div className={styles.details}>
            {profile.school && <div className={styles.school}><School aria-hidden="true" size={17} />{profile.school.name}</div>}
            <section>
              <h3 className={styles.sectionTitle}>个人简介</h3>
              <p className={styles.bio}>{profile.bio || '暂无个人简介'}</p>
            </section>
          </div>
        </Card>
      )}
    </PageFrame>
  )
}
