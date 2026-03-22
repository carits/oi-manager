'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { getAssetUrl } from '@/lib/assets'

interface UserProfile {
  id: string
  name: string
  username: string
  avatar: string | null
  bio: string | null
  userType: 'teacher'
  school: {
    id: string
    name: string
  } | null
}

export default function TeacherProfilePage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (id) {
      fetchProfile()
    }
  }, [id])

  const fetchProfile = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiClient.get<UserProfile>(`/api/users/${id}/profile?userType=teacher`)
      if (result.success) {
        setProfile(result.data || null)
      } else {
        setError(result.message || '获取用户信息失败')
      }
    } catch (err) {
      console.error('Fetch profile error:', err)
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  const getInitial = () => {
    return profile?.name?.charAt(0)?.toUpperCase() || '?'
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--gray-50)'
      }}>
        <div style={{ color: 'var(--gray-500)' }}>加载中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--gray-50)',
        gap: '1rem'
      }}>
        <div style={{ color: 'var(--danger)' }}>{error}</div>
        <button
          onClick={() => router.back()}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          返回
        </button>
      </div>
    )
  }

  if (!profile) return null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      {/* 顶部导航 */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid var(--border)',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem'
      }}>
        <button
          onClick={() => router.back()}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--gray-600)',
            fontSize: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem'
          }}
        >
          ← 返回
        </button>
      </div>

      {/* 个人信息卡片 */}
      <div style={{
        maxWidth: '600px',
        margin: '2rem auto',
        background: 'white',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        overflow: 'hidden'
      }}>
        {/* 头像区域 */}
        <div style={{
          padding: '2.5rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          background: 'linear-gradient(135deg, var(--primary) 0%, #6366f1 100%)'
        }}>
          {profile.avatar ? (
            <div
              style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: `url(${getAssetUrl(profile.avatar)}) center/cover`,
                border: '4px solid white',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
              }}
            />
          ) : (
            <div
              style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
                fontSize: '3rem',
                fontWeight: 700,
                border: '4px solid white',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
              }}
            >
              {getInitial()}
            </div>
          )}

          {/* 姓名 */}
          <h1 style={{
            marginTop: '1rem',
            fontSize: '1.5rem',
            fontWeight: 600,
            color: 'white',
            margin: '1rem 0 0'
          }}>
            {profile.name}
          </h1>

          {/* 用户名 */}
          {profile.username && (
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
              @{profile.username}
            </p>
          )}
        </div>

        {/* 信息区域 */}
        <div style={{ padding: '1.5rem 2rem' }}>
          {/* 角色标签 */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
            <span
              style={{
                padding: '0.375rem 1rem',
                borderRadius: '999px',
                fontSize: '0.875rem',
                fontWeight: 500,
                background: 'var(--blue-100)',
                color: 'var(--blue-700)'
              }}
            >
              教师
            </span>
          </div>

          {/* 学校 */}
          {profile.school && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                marginBottom: '1.5rem',
                color: 'var(--gray-600)',
                fontSize: '0.9375rem'
              }}
            >
              <span>🏫</span>
              <span>{profile.school.name}</span>
            </div>
          )}

          {/* 分隔线 */}
          <div
            style={{
              height: '1px',
              background: 'var(--border)',
              margin: '1.5rem 0'
            }}
          />

          {/* 个人简介 */}
          <div>
            <h3 style={{
              fontSize: '0.9375rem',
              fontWeight: 600,
              marginBottom: '0.75rem',
              color: 'var(--gray-700)'
            }}>
              个人简介
            </h3>
            {profile.bio ? (
              <p style={{
                fontSize: '0.9375rem',
                lineHeight: 1.7,
                color: 'var(--gray-600)',
                margin: 0,
                whiteSpace: 'pre-wrap'
              }}>
                {profile.bio}
              </p>
            ) : (
              <p style={{
                color: 'var(--gray-400)',
                fontSize: '0.875rem',
                margin: 0
              }}>
                暂无个人简介
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}