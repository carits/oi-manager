'use client'

import { useState } from 'react'
import unifiedStyles from './PasswordEditor.unified.module.css'
import { Input } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import apiClient from '@/lib/apiClient'

export function PasswordEditor() {
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState('')
  const [revoking, setRevoking] = useState(false)

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
    setSuccessMessage('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage('')

    // 验证
    if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
      setError('请填写所有密码字段')
      return
    }

    if (form.newPassword !== form.confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }

    if (form.newPassword.length < 6) {
      setError('新密码长度至少6位')
      return
    }

    if (form.currentPassword === form.newPassword) {
      setError('新密码不能与当前密码相同')
      return
    }

    setSaving(true)
    try {
      const result = await apiClient.put('/api/auth/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      })
      if (result.success) {
        setSuccessMessage('密码修改成功，其他设备已退出')
        setForm({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        })
      } else {
        setError(result.message || '修改失败')
      }
    } catch (error) {
      setError('修改失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={unifiedStyles.u1}>
      <h3 className={unifiedStyles.u2}>
        修改密码
      </h3>

      {successMessage && (
        <div className={unifiedStyles.u3}>
          {successMessage}
        </div>
      )}

      {error && (
        <div className={unifiedStyles.u4}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className={unifiedStyles.u5}>
        <FormField label="当前密码">
          <Input
            type="password"
            value={form.currentPassword}
            onChange={(e) => handleChange('currentPassword', e.target.value)}
            placeholder="请输入当前密码"
          />
        </FormField>

        <FormField label="新密码">
          <Input
            type="password"
            value={form.newPassword}
            onChange={(e) => handleChange('newPassword', e.target.value)}
            placeholder="请输入新密码（至少6位）"
          />
        </FormField>

        <FormField label="确认新密码">
          <Input
            type="password"
            value={form.confirmPassword}
            onChange={(e) => handleChange('confirmPassword', e.target.value)}
            placeholder="请再次输入新密码"
          />
        </FormField>

        <div className={unifiedStyles.u6}>
          <Button variant="primary"
            type="submit"
            disabled={saving}
          >
            {saving ? '保存中...' : '修改密码'}
          </Button>
        </div>
      </form>

      <div className={unifiedStyles.u5}>
        <div>
          <h3 className={unifiedStyles.u2}>登录设备</h3>
          <p>让其他浏览器和设备上的登录状态立即失效，当前设备会继续保持登录。</p>
        </div>
        <div className={unifiedStyles.u6}>
          <Button
            variant="secondary"
            type="button"
            loading={revoking}
            onClick={async () => {
              setRevoking(true)
              setError(null)
              const result = await apiClient.post('/api/auth/sessions/revoke')
              setRevoking(false)
              if (result.success) setSuccessMessage('其他设备已退出，当前设备保持登录')
              else setError(result.message || '退出其他设备失败')
            }}
          >
            退出其他设备
          </Button>
        </div>
      </div>
    </div>
  )
}
