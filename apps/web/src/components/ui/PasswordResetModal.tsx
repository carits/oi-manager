'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formStyles } from '@/lib/styles'
import apiClient from '@/lib/apiClient'

interface PasswordResetModalProps {
  isOpen: boolean
  onClose: () => void
  userId: string
  username: string
  /** 重置成功回调，传入新密码 */
  onSuccess?: (newPassword: string) => void
}

export function PasswordResetModal({
  isOpen,
  onClose,
  userId,
  username,
  onSuccess,
}: PasswordResetModalProps) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (password.length < 6) {
      setError('密码长度至少为6位')
      return
    }

    try {
      setLoading(true)
      setError('')
      const result = await apiClient.post(`/api/users/${userId}/reset-password`, {
        newPassword: password,
      })
      if (result.success) {
        onSuccess?.(password)
        onClose()
      } else {
        setError(result.message || '重置失败')
      }
    } catch {
      setError('操作失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setPassword('')
    setError('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="重置密码" width="420px">
      <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '1rem' }}>
        为用户 <strong>{username}</strong> 设置新密码
      </p>

      <div style={formStyles.field}>
        <label style={formStyles.label}>新密码 *</label>
        <input
          type="text"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError('') }}
          style={formStyles.input}
          placeholder="请输入新密码（至少6位）"
          autoFocus
        />
        {error && (
          <p style={{ fontSize: '0.75rem', color: 'var(--error)', marginTop: '0.25rem' }}>
            {error}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={handleClose} disabled={loading}>
          取消
        </Button>
        <Button variant="danger" onClick={handleSubmit} disabled={loading}>
          {loading ? '重置中...' : '确认重置'}
        </Button>
      </div>
    </Modal>
  )
}
