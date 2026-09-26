'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import styles from './ContestHackSyncAction.module.css'

type Preview = {
  pending: boolean
  frozen: boolean
  frozenReason?: string | null
  currentRevisionId: string | null
  currentRevision: number | null
  latestRevisionId: string | null
  latestRevision: number | null
}

export function ContestHackSyncAction({ contestId, contestProblemId }: { contestId: string; contestProblemId: string }) {
  const toast = useToast()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let active = true
    apiClient.get<Preview>(`/api/contests/${contestId}/problems/${contestProblemId}/test-set-update`)
      .then(result => { if (active && result.success && result.data) setPreview(result.data) })
    return () => { active = false }
  }, [contestId, contestProblemId])

  if (!preview?.pending) return null
  if (preview.frozen) return (
    <div className={styles.frozen} role="status">
      <strong>本活动使用的测试数据已固定</strong>
      <span>题库已有更新；{preview.frozenReason}，当前活动不会自动更换。</span>
    </div>
  )

  const updateRevision = async () => {
    setSyncing(true)
    try {
      const result = await apiClient.post<{ currentRevision: number; currentRevisionId: string }>(
        `/api/contests/${contestId}/problems/${contestProblemId}/test-set-update`,
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
      <div><strong>题库有新的正式测试数据</strong><span>更新只影响本活动之后的新提交。</span></div>
      <Button variant="outline" type="button" onClick={updateRevision} disabled={syncing}>
        {syncing ? '正在更新…' : '使用最新测试数据'}
      </Button>
    </div>
  )
}
