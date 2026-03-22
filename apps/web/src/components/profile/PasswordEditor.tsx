'use client'

import { useState } from 'react'
import { getAuthHeaders } from '@/lib/auth'
import { formStyles } from '@/lib/styles'

export function PasswordEditor() {
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
    setSuccess(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

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
      const res = await fetch('http://localhost:3001/api/auth/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword
        })
      })
      const data = await res.json()
      if (data.success) {
        setSuccess(true)
        setForm({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        })
      } else {
        setError(data.message || '修改失败')
      }
    } catch (error) {
      setError('修改失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: '400px' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
        修改密码
      </h3>

      {success && (
        <div style={{
          padding: '0.75rem 1rem',
          background: 'var(--green-100)',
          color: 'var(--green-700)',
          borderRadius: '6px',
          marginBottom: '1rem',
          fontSize: '0.875rem'
        }}>
          密码修改成功
        </div>
      )}

      {error && (
        <div style={{
          padding: '0.75rem 1rem',
          background: 'var(--red-100)',
          color: 'var(--red-700)',
          borderRadius: '6px',
          marginBottom: '1rem',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <div style={formStyles.field}>
          <label style={formStyles.label}>当前密码</label>
          <input
            type="password"
            value={form.currentPassword}
            onChange={(e) => handleChange('currentPassword', e.target.value)}
            placeholder="请输入当前密码"
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>新密码</label>
          <input
            type="password"
            value={form.newPassword}
            onChange={(e) => handleChange('newPassword', e.target.value)}
            placeholder="请输入新密码（至少6位）"
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>确认新密码</label>
          <input
            type="password"
            value={form.confirmPassword}
            onChange={(e) => handleChange('confirmPassword', e.target.value)}
            placeholder="请再次输入新密码"
            style={formStyles.input}
          />
        </div>

        <div style={{ marginTop: '0.5rem' }}>
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
            {saving ? '保存中...' : '修改密码'}
          </button>
        </div>
      </form>
    </div>
  )
}
