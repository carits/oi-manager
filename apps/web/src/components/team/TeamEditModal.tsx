'use client'

import { useEffect, useState } from 'react'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Globe2, LockKeyhole, Save } from 'lucide-react'
import { FormDialog } from '@/components/ui/Dialogs'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'
import styles from './Team.module.css'

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

export function TeamEditModal({ isOpen, onClose, teamId, initialData, onSuccess }: TeamEditModalProps) {
  const toast = useToast()
  const [formData, setFormData] = useState<TeamEditFormData>(initialData)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) setFormData(initialData)
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
        isPublic: formData.isPublic,
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
    <FormDialog
      isOpen={isOpen}
      onClose={onClose}
      title="编辑团队"
      size="md"
      closeOnOverlay={!saving}
      footer={
        <div className={styles.modalActionBar}>
          <span>保存后会立即同步到团队页面。</span>
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={onClose} disabled={saving}>取消</Button>
            <Button icon={<Save size={16} />} onClick={handleSave} loading={saving}>保存</Button>
          </div>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        <label className={styles.dialogField}>
          <span>团队名称 <strong>*</strong></span>
          <Input value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} placeholder="请输入团队名称" />
        </label>

        {formData.teamId && (
          <label className={styles.dialogField}>
            <span>团队标识</span>
            <Input value={formData.teamId} disabled />
            <small>团队标识创建后不可修改。</small>
          </label>
        )}

        <label className={styles.dialogField}>
          <span>团队描述</span>
          <Textarea value={formData.description} onChange={(event) => setFormData({ ...formData, description: event.target.value })} rows={3} placeholder="说明训练方向或加入要求" />
        </label>

        <fieldset className={styles.dialogFieldset}>
          <legend>加入方式</legend>
          <div className={styles.visibilityOptions}>
            <label className={styles.visibilityOption}>
              <Input type="radio" name="edit-team-visibility" checked={formData.isPublic} onChange={() => setFormData({ ...formData, isPublic: true })} />
              <Globe2 size={18} aria-hidden="true" />
              <span>公开<br /><small>其他用户可以申请加入</small></span>
            </label>
            <label className={styles.visibilityOption}>
              <Input type="radio" name="edit-team-visibility" checked={!formData.isPublic} onChange={() => setFormData({ ...formData, isPublic: false })} />
              <LockKeyhole size={18} aria-hidden="true" />
              <span>私有<br /><small>仅通过邀请加入</small></span>
            </label>
          </div>
        </fieldset>
      </div>
    </FormDialog>
  )
}