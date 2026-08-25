'use client'

import { ConfirmDialog } from '@/components/ui/Dialogs'

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  loading = false
}: ConfirmModalProps) {
  return <ConfirmDialog
    isOpen={isOpen}
    onClose={onClose}
    onConfirm={onConfirm}
    title={title}
    message={message}
    confirmText={confirmText}
    cancelText={cancelText}
    danger={danger}
    loading={loading}
  />
}
