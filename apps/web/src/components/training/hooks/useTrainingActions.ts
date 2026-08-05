import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { createClientUUID } from '@/lib/uuid'
import { saveBlobDownload } from '@/lib/download'
import { useToast } from '@/components/ui/Toast'
import type { TrainingInfo, TrainingProblem, Attachment } from '../types'

export function useTrainingActions(
  trainingId: string,
  training: TrainingInfo | null,
  basePath: string,
  teamId: string | null | undefined,
  selectedProblemId: string | null,
  problems: TrainingProblem[],
  activeTab: string,
) {
  const router = useRouter()
  const toast = useToast()

  // Submit modal state
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [submitLanguage, setSubmitLanguage] = useState('cpp')
  const [submitCode, setSubmitCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitMethod, setSubmitMethod] = useState<'robot' | 'myAccount' | 'archive'>('robot')
  const submitKeyRef = useRef<string | null>(null)

  // Edit/delete state
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSubmitCode = useCallback(async () => {
    if (!selectedProblemId || !submitCode.trim()) {
      toast.error('请输入代码')
      return
    }
    // 训练/比赛只支持机器人账号提交
    if (submitMethod !== 'robot') {
      toast.error('训练/比赛暂不支持个人账号提交，请使用机器人账号')
      return
    }
    setSubmitting(true)
    try {
      submitKeyRef.current ||= createClientUUID()
      const result = await apiClient.mutate<{ submissionId?: number }>(
        `/api/trainings/${trainingId}/submit`,
        'POST',
        {
          trainingProblemId: selectedProblemId,
          language: submitLanguage,
          code: submitCode,
          submitMethod,
        },
        { headers: { 'Idempotency-Key': submitKeyRef.current } },
      )
      if (result.ok) {
        submitKeyRef.current = null
        toast.success('提交成功')
        setSubmitCode('')
        setShowSubmitModal(false)
        // 打开提交详情
        if (result.data?.submissionId) {
          return result.data.submissionId
        }
      } else {
        if (result.error.status > 0 && result.error.status < 500) {
          submitKeyRef.current = null
        }
        toast.error(result.error.message || '提交失败')
      }
      return null
    } catch {
      toast.error('提交失败')
      return null
    } finally {
      setSubmitting(false)
    }
  }, [selectedProblemId, submitCode, submitMethod, submitLanguage, trainingId, toast])

  const handleDelete = useCallback(async () => {
    if (!training) return false
    setDeleting(true)
    try {
      const res = await apiClient.delete(`/api/trainings/${training.id}`)
      if (res.success) {
        toast.success('训练已删除')
        router.push(`${basePath}?tab=contest`)
        return true
      } else {
        toast.error(res.message || '删除失败')
        return false
      }
    } catch {
      toast.error('删除失败')
      return false
    } finally {
      setDeleting(false)
    }
  }, [training, basePath, teamId, router, toast])

  const handleDownloadAttachment = useCallback(async (attachment: Attachment) => {
    try {
      const result = await apiClient.download(attachment.fileUrl)
      saveBlobDownload(result.blob, attachment.fileName)
    } catch {
      toast.error('下载失败')
    }
  }, [toast])

  return {
    // Submit
    showSubmitModal, setShowSubmitModal,
    submitLanguage, setSubmitLanguage,
    submitCode, setSubmitCode,
    submitting,
    submitMethod, setSubmitMethod,
    handleSubmitCode,
    // Edit/delete
    showEditModal, setShowEditModal,
    showDeleteConfirm, setShowDeleteConfirm,
    deleting,
    handleDelete,
    // Download
    handleDownloadAttachment,
  }
}
