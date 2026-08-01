'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'
import { formStyles } from '@/lib/styles'

interface TeamEditFormData {
  name: string
  description: string
  isPublic: boolean
  teamId?: string
}

interface TeamEditModalProps {
  isOpen: boolean
  onClose: () => void
  teamId: string
  initialData: TeamEditFormData
  onSuccess: () => void
}

export function TeamEditModal({
  isOpen,
  onClose,
  teamId,
  initialData,
  onSuccess
}: TeamEditModalProps) {
  const toast = useToast()
  const [formData, setFormData] = useState<TeamEditFormData>(initialData)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setFormData(initialData)
    }
  }, [isOpen, initialData])

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.warning('请输入团队名称')
      return
    }

    try {
      setSaving(true)
      const result = await apiClient.put(`/api/teams/${teamId}`, {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        isPublic: formData.isPublic
      })
      if (result.success) {
        onClose()
        onSuccess()
      } else {
        toast.error(result.message || '编辑失败')
      }
    } catch (error) {
      console.error('Edit team error:', error)
      toast.error('编辑失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="编辑团队" width="500px">
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={formStyles.field}>
          <label style={formStyles.label}>团队名称 *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            style={formStyles.input}
            placeholder="请输入团队名称"
          />
        </div>

        {formData.teamId && (
          <div style={formStyles.field}>
            <label style={formStyles.label}>团队ID</label>
            <input
              type="text"
              value={formData.teamId}
              disabled
              style={{ ...formStyles.input, background: 'var(--gray-50)', color: 'var(--gray-500)', cursor: 'not-allowed' }}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: '0.25rem' }}>
              团队ID创建后不可修改
            </p>
          </div>
        )}

        <div style={formStyles.field}>
          <label style={formStyles.label}>团队描述</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
            style={formStyles.textarea}
            placeholder="请输入团队描述（选填）"
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>团队类型</label>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="isPublic"
                checked={formData.isPublic}
                onChange={() => setFormData({ ...formData, isPublic: true })}
              />
              <span>公开团队</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="isPublic"
                checked={!formData.isPublic}
                onChange={() => setFormData({ ...formData, isPublic: false })}
              />
              <span>私有团队</span>
            </label>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.5rem' }}>
            公有团队：其他用户可以浏览并申请加入<br />
            私有团队：只能通过邀请加入
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>
    </Modal>
  )
}
