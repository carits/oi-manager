'use client'

import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'

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

export function TeamTransferModal({
  isOpen,
  onClose,
  teamId,
  selectedTarget,
  candidates,
  onSuccess
}: TeamTransferModalProps) {
  const toast = useToast()

  const handleTransfer = async () => {
    if (!selectedTarget) {
      toast.warning('请选择新所有者')
      return
    }

    try {
      const result = await apiClient.post(`/api/teams/${teamId}/transfer`, {
        newOwnerId: selectedTarget.id,
        newOwnerType: selectedTarget.memberType
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
    <Modal isOpen={isOpen} onClose={onClose} title="转移团队所有权" width="400px">
      <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '1rem' }}>
        确定要将团队所有权转移给 <strong>{selectedTarget?.name || '该用户'}</strong> 吗？
      </p>
      <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '1rem' }}>
        转移后，您将成为普通成员，新所有者将拥有团队的完全控制权。
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button variant="danger" onClick={handleTransfer}>
          确认转移
        </Button>
      </div>
    </Modal>
  )
}
