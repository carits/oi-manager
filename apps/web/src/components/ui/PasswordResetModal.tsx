'use client'

import { useState } from 'react'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input } from '@/components/ui/FormControls'
import { resetManagedUserPassword } from '@/features/user-admin'
import styles from './PasswordResetModal.module.css'

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
      const result = await resetManagedUserPassword(userId, password)
      if (result.ok) {
        onSuccess?.(password)
        onClose()
      } else {
        setError(result.error.userMessage || '重置失败')
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
    <FormDialog isOpen={isOpen} onClose={handleClose} onSubmit={handleSubmit} title="重置密码" size="sm" submitText="确认重置" loading={loading} danger dirty={password.length > 0}>
      <p className={styles.description}>
        为用户 <strong>{username}</strong> 设置新密码
      </p>

      <div className={styles.field}>
        <label htmlFor="password-reset-value">新密码 *</label>
        <Input
          id="password-reset-value"
          type="text"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError('') }}
          placeholder="请输入新密码（至少6位）"
          autoFocus
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </FormDialog>
  )
}
