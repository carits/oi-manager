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

  const refreshStableSnapshot = async () => {
    setSyncing(true)
    try {
      const result = await applyContestTestSetUpdate(contestId, contestProblemId)
      if (!result.ok) return toast.error(result.error.message || 'Stable 数据快照更新失败')
      toast.success('比赛已刷新到当前 Stable 数据')
      setPreview(current => current ? {
        ...current,
        pending: false,
        currentGraphHash: result.data.currentGraphHash ?? current.stableGraphHash,
        currentFencingToken: result.data.currentFencingToken ?? current.stableFencingToken,
      } : current)
    } finally { setSyncing(false) }
  }

  return (
    <div className={styles.update}>
      <div><strong>题库有新的正式测试数据</strong><span>更新只影响本活动之后的新提交。</span></div>
      <Button variant="outline" type="button" onClick={refreshStableSnapshot} disabled={syncing}>
        {syncing ? '正在更新…' : '使用最新测试数据'}
      </Button>
    </div>
  )
}
