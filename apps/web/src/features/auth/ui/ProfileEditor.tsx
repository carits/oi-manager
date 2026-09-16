'use client'

import { useState, useEffect, useRef, type CSSProperties } from 'react'
import collisionStyles from './ProfileEditor.collision.module.css'
import unifiedStyles from './ProfileEditor.unified.module.css'
import { Input, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { useAuth } from '../model/AuthProvider'
import { updateAccountProfile, uploadAccountAvatar } from '../api/authApi'
import { getAssetUrl } from '@/lib/assets'
import { useToast } from '@/components/ui/Toast'

interface ProfileEditorProps {
  userType: 'teacher' | 'student' | 'admin'
}

export function ProfileEditor({ userType: _userType }: ProfileEditorProps) {
  const { user, refreshUser } = useAuth()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    email: '',
    phone: '',
    bio: ''
  })

  useEffect(() => {
    if (user) {
      setForm({
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
      const result = await updateAccountProfile(form)
      if (result.ok) {
        toast.success('保存成功')
        refreshUser?.()
      } else {
        toast.error(result.error.message || '保存失败')
      }
    } catch (error) {
      toast.error('保存失败')
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
      const result = await uploadAccountAvatar(file)
      if (result.success) {
        refreshUser?.()
      } else {
        toast.error(result.message || '上传失败')
      }
    } catch (error) {
      toast.error('上传失败')
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  if (loading) {
    return <div className={unifiedStyles.u1}><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div>
  }

  const getInitial = () => {
    return user?.username?.charAt(0)?.toUpperCase() || '?'
  }
  const avatarStyle = user?.avatar
    ? { '--profile-avatar': `url(${getAssetUrl(user.avatar)})` } as CSSProperties
    : undefined

  return (
    <div className={unifiedStyles.u2}>
      {/* 头像区域 */}
      <div className={unifiedStyles.u3}>
        {user?.avatar ? (
          <div className={unifiedStyles.profileAvatar} style={avatarStyle} />
        ) : (
          <div
            className={unifiedStyles.u4}
          >
            {getInitial()}
          </div>
        )}
        <div>
          <Button variant="primary"
            type="button"
            onClick={handleAvatarClick}
            disabled={uploadingAvatar}
          >
            {uploadingAvatar ? '上传中...' : '更换头像'}
          </Button>
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            className={unifiedStyles.u5}
          />
          <p className={unifiedStyles.u6}>
            支持 JPG、PNG 格式，建议尺寸 200x200
          </p>
        </div>
      </div>

      {/* 表单区域 */}
      <form onSubmit={handleSubmit} className={unifiedStyles.u7}>
        <FormField label="用户名" hint="账号用户名不可在这里修改；校园真实姓名由各学校身份资料独立管理。">
          <Input
            type="text"
            value={user?.username || ''}
            readOnly
          />
        </FormField>

        <FormField label="邮箱">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
            placeholder="请输入邮箱"
          />
        </FormField>

        <FormField label="手机号">
          <Input
            type="tel"
            value={form.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            placeholder="请输入手机号"
          />
        </FormField>

        <FormField label="个人简介">
          <Textarea
            value={form.bio}
            onChange={(e) => handleChange('bio', e.target.value)}
            placeholder="请输入个人简介"
            className={unifiedStyles.bioInput}
          />
        </FormField>

        <div className={unifiedStyles.u8}>
          <Button variant="primary"
            type="submit"
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </form>
    </div>
  )
}
