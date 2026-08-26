'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import styles from './TrainingHackSyncAction.module.css'

type Preview = {
  pending: boolean
  frozen: boolean
  frozenReason?: string | null
  currentRevisionId: string | null
  currentRevision: number | null
  latestRevisionId: string | null
  latestRevision: number | null
}

export function TrainingHackSyncAction({ trainingId, trainingProblemId }: { trainingId: string; trainingProblemId: string }) {
  const toast = useToast()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let active = true
    apiClient.get<Preview>(`/api/trainings/${trainingId}/problems/${trainingProblemId}/test-set-update`)
      .then(result => { if (active && result.success && result.data) setPreview(result.data) })
    return () => { active = false }
  }, [trainingId, trainingProblemId])

  if (!preview?.pending) return null
  if (preview.frozen) return (
    <div className={styles.frozen} role="status">
      <strong>活动测试版本已冻结在 R{preview.currentRevision ?? '—'}</strong>
      <span>题库最新为 R{preview.latestRevision ?? '—'}；{preview.frozenReason}，不能更换。</span>
    </div>
  )

  const updateRevision = async () => {
    setSyncing(true)
    try {
      const result = await apiClient.post<{ currentRevision: number; currentRevisionId: string }>(
        `/api/trainings/${trainingId}/problems/${trainingProblemId}/test-set-update`,
        { revisionId: preview.latestRevisionId },
      )
      if (!result.success) return toast.error(result.message || '测试版本更新失败')
      toast.success(result.message || '活动已固定到题库最新测试版本')
      setPreview(current => current ? {
        ...current,
        pending: false,
        currentRevision: result.data?.currentRevision ?? current.latestRevision,
        currentRevisionId: result.data?.currentRevisionId ?? current.latestRevisionId,
      } : current)
    } finally { setSyncing(false) }
  }

  return (
    <div className={styles.update}>
      <div><strong>题库有新的正式测试版本</strong><span>当前 R{preview.currentRevision ?? '—'} → 最新 R{preview.latestRevision ?? '—'}</span></div>
      <Button variant="outline" type="button" onClick={updateRevision} disabled={syncing}>
        {syncing ? '正在更新…' : `更新到 R${preview.latestRevision ?? '—'}`}
      </Button>
    </div>
  )
}
