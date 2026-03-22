'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { formStyles } from '@/lib/styles'
import { getAssetUrl } from '@/lib/assets'

interface ProfileEditorProps {
  userType: 'teacher' | 'student' | 'admin'
}

export function ProfileEditor({ userType }: ProfileEditorProps) {
  const { user, refreshUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    bio: ''
  })

  useEffect(() => {
    if (user) {
      const profile = user.profile as { name?: string; bio?: string } | undefined
      setForm({
        name: profile?.name || user.username || '',
        email: user.email || '',
        phone: user.phone || '',
        bio: user.bio || ''
      })
      setLoading(false)
    }
  }, [user])

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const result = await apiClient.put('/api/auth/profile', form)
      if (result.success) {
        alert('保存成功')
        refreshUser?.()
      } else {
        alert(result.message || '保存失败')
      }
    } catch (error) {
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('avatar', file)

      const result = await apiClient.postFile('/api/auth/avatar', formData)
      if (result.success) {
        refreshUser?.()
      } else {
        alert(result.message || '上传失败')
      }
    } catch (error) {
      alert('上传失败')
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>加载中...</div>
  }

  const getInitial = () => {
    const profile = user?.profile as { name?: string } | undefined
    const name = profile?.name || user?.username
    return name?.charAt(0)?.toUpperCase() || '?'
  }

  return (
    <div style={{ maxWidth: '600px' }}>
      {/* 头像区域 */}
      <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        {user?.avatar ? (
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: `url(${getAssetUrl(user.avatar)}) center/cover`,
              border: '3px solid var(--border)'
            }}
          />
        ) : (
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--primary), #6366f1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '2rem',
              fontWeight: 700,
              border: '3px solid var(--border)'
            }}
          >
            {getInitial()}
          </div>
        )}
        <div>
          <button
            type="button"
            onClick={handleAvatarClick}
            disabled={uploadingAvatar}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: uploadingAvatar ? 'not-allowed' : 'pointer',
              opacity: uploadingAvatar ? 0.7 : 1
            }}
          >
            {uploadingAvatar ? '上传中...' : '更换头像'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            style={{ display: 'none' }}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.5rem', margin: '0.5rem 0 0' }}>
            支持 JPG、PNG 格式，建议尺寸 200x200
          </p>
        </div>
      </div>

      {/* 表单区域 */}
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.25rem' }}>
        <div style={formStyles.field}>
          <label style={formStyles.label}>姓名</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="请输入姓名"
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>邮箱</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
            placeholder="请输入邮箱"
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>手机号</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            placeholder="请输入手机号"
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>个人简介</label>
          <textarea
            value={form.bio}
            onChange={(e) => handleChange('bio', e.target.value)}
            placeholder="请输入个人简介"
            style={{ ...formStyles.input, minHeight: '100px', resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '0.625rem 1.5rem',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
              fontSize: '0.875rem',
              fontWeight: 500
            }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}
