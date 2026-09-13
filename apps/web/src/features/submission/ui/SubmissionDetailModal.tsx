'use client'

import { DetailDialog } from '@/components/ui/Dialogs'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import {
  SubmissionDetailContent,
  SubmissionDetailErrorState,
  submissionDetailTitle,
} from './SubmissionDetailContent'
import { useSubmissionDetail } from '../model/useSubmissionDetail'

interface SubmissionDetailModalProps {
  isOpen: boolean
  onClose: () => void
  submissionId: number | null
  viewRole?: 'teacher' | 'student' | 'admin'
  trainingId?: number
  trainingFormat?: 'oi' | 'ioi' | 'icpc'
  submissionPathPrefix?: string
  onSubmissionUpdated?: () => void
}
export function SubmissionDetailModal({
  isOpen,
  onClose,
  submissionId,
  trainingId,
  onSubmissionUpdated,
}: SubmissionDetailModalProps) {
  const { detail, loading, error, retry } = useSubmissionDetail({
    submissionId,
    trainingId,
    enabled: isOpen,
    onSettled: onSubmissionUpdated,
  })

  if (!isOpen) return null
  return (
    <DetailDialog isOpen={isOpen} onClose={onClose} title={detail ? submissionDetailTitle(detail) : '评测详情'} size="xl" scrollMode="page">
      {loading && !detail ? (
        <SkeletonRegion rows={7} label="评测详情正在准备" />
      ) : error && !detail ? (
        <SubmissionDetailErrorState error={error} onRetry={retry} onBack={onClose} />
      ) : detail ? (
        <SubmissionDetailContent detail={detail} />
      ) : null}
    </DetailDialog>
  )
}
