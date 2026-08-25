'use client'

import { AlertTriangle, Crown } from 'lucide-react'
import { FormDialog } from '@/components/ui/Dialogs'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'
import styles from './Team.module.css'

interface TransferCandidate {
  id: string
  name: string
  memberType: 'teacher' | 'student' | 'user'
}

interface TeamTransferModalProps {
  isOpen: boolean
  onClose: () => void
  teamId: string
  selectedTarget: { id: string; memberType: 'teacher' | 'student' | 'user'; name: string } | null
  candidates: TransferCandidate[]
  onSuccess: () => void
}

export function TeamTransferModal({ isOpen, onClose, teamId, selectedTarget, onSuccess }: TeamTransferModalProps) {
  const toast = useToast()

  const handleTransfer = async () => {
    if (!selectedTarget) {
      toast.warning('请选择新所有者')
      return
    }

    try {
      const result = await apiClient.post(`/api/teams/${teamId}/transfer`, {
        newOwnerId: selectedTarget.id,
        newOwnerType: selectedTarget.memberType,
      })
      if (result.success) {
        toast.success('所有权转移成功')
        onClose()
        onSuccess()
      } else {
        toast.error(result.message || '转移失败')
      }
    } catch (error) {
      console.error('Transfer error:', error)
      toast.error('转移失败')
    }
  }

  return (
    <FormDialog
      isOpen={isOpen}
      onClose={onClose}
      title="转移团队所有权"
      size="md"
      footer={
        <div className={styles.modalActionBar}>
          <span>这是高风险操作，请确认目标成员无误。</span>
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button variant="danger" icon={<Crown size={16} />} onClick={handleTransfer}>确认转移</Button>
          </div>
        </div>
      }
    >
      <div className={styles.dangerNotice}>
        <AlertTriangle size={20} aria-hidden="true" />
        <div>
          <h3>即将转移给 {selectedTarget?.name || '该成员'}</h3>
          <p>转移后，您将成为普通成员，新所有者将拥有团队编辑、成员管理和解散团队等完整权限。</p>
        </div>
      </div>
    </FormDialog>
  )
}