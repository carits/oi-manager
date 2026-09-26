'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { ContestTestSetUpdatePreview } from '@oi-manager/contracts'
import { applyContestTestSetUpdate, previewContestTestSetUpdate } from '../../api/contestApi'
import { useToast } from '@/components/ui/Toast'
import styles from './ContestHackSyncAction.module.css'

export function ContestHackSyncAction({ contestId, contestProblemId }: { contestId: string; contestProblemId: string }) {
  const toast = useToast()
  const [preview, setPreview] = useState<ContestTestSetUpdatePreview | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let active = true
    previewContestTestSetUpdate(contestId, contestProblemId)
      .then(result => { if (active) setPreview(result) })
      .catch(() => undefined)
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
      const result = await applyContestTestSetUpdate(contestId, contestProblemId, preview.latestRevisionId || undefined)
      if (!result.ok) return toast.error(result.error.message || '测试版本更新失败')
      toast.success('活动已固定到题库最新测试版本')
      setPreview(current => current ? {
        ...current,
        pending: false,
        currentRevision: result.data.currentRevision ?? current.latestRevision,
        currentRevisionId: result.data.currentRevisionId ?? current.latestRevisionId,
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
