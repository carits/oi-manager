'use client'

import { useCallback, useEffect, useState } from 'react'
import apiClient from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { TrainingInfo } from '../types'
import styles from './TrainingRatingPanel.module.css'

type RatingPayload = {
  finalizationStatus: string
  config: { scope: string; track: string; weight: number; lockedAt?: string | null }
  standing?: {
    revision: number
    finalizedAt: string
    entries: Array<{
      userId: string
      rank: number
      totalScore?: number | null
      solvedCount?: number | null
      penaltySeconds?: number | null
      user?: { username: string }
    }>
  } | null
  batches: Array<{
    id: string
    scope: string
    organizationId?: string | null
    track: string
    status: string
    fieldSize: number
    skipReason?: string | null
    changes: Array<{ userId: string; ratingBefore: number; appliedDelta: number; ratingAfter: number }>
  }>
}

const stateLabel: Record<string, string> = {
  LIVE: '进行中', JUDGING: '等待评测完成', FINALIZING: '正在结算',
  FINALIZED: '已结算', HELD: '重测后待重放', FAILED: '结算失败',
}

export function TrainingRatingPanel({ trainingId, training, onChanged }: {
  trainingId: string
  training: TrainingInfo
  onChanged: () => void | Promise<void>
}) {
  const [data, setData] = useState<RatingPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'finalize' | 'rebuild' | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiClient.get<RatingPayload>(`/api/trainings/${trainingId}/rating`)
      if (!response.success || !response.data) throw new Error(response.message || '读取 Rating 结算状态失败')
      setData(response.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取 Rating 结算状态失败')
    } finally {
      setLoading(false)
    }
  }, [trainingId])

  useEffect(() => { void load() }, [load])

  const execute = async (kind: 'finalize' | 'rebuild') => {
    setAction(kind)
    setError('')
    try {
      const suffix = kind === 'finalize' ? 'finalize' : 'rating/rebuild'
      const response = await apiClient.post<RatingPayload>(`/api/trainings/${trainingId}/${suffix}`, {})
      if (!response.success || !response.data) throw new Error(response.message || 'Rating 操作失败')
      setData(response.data)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rating 操作失败')
    } finally {
      setAction(null)
    }
  }

  const status = data?.finalizationStatus || training.finalizationStatus || 'LIVE'
  const enabled = (data?.config.scope || training.ratingConfig?.scope || 'NONE') !== 'NONE'
  const ended = training.status === 'finished' || training.runtimeStatus === 'finished'
  const actionButton = training.isAdmin && ended && status !== 'FINALIZED'
    ? status === 'HELD'
      ? <Button size="sm" loading={action === 'rebuild'} onClick={() => void execute('rebuild')}>重放最终榜单与 Rating</Button>
      : <Button size="sm" loading={action === 'finalize'} onClick={() => void execute('finalize')}>生成最终榜单并结算</Button>
    : undefined

  return (
    <Section
      title="比赛 Rating"
      description={enabled
        ? `${data?.config.track || training.ratingConfig?.track || training.format.toUpperCase()} · ${data?.config.scope || training.ratingConfig?.scope} · 权重 ${data?.config.weight ?? training.ratingConfig?.weight ?? 1}`
        : '本场比赛不计 Rating；普通实时排名仍正常显示。'}
      actions={actionButton}
    >
      <div className={styles.summary}>
        <StatusBadge variant={status === 'FINALIZED' ? 'success' : status === 'HELD' || status === 'FAILED' ? 'warning' : 'pending'}>
          {stateLabel[status] || status}
        </StatusBadge>
        {data?.standing && <span>最终榜单 R{data.standing.revision} · {data.standing.entries.length} 人</span>}
        {data?.batches.map(batch => (
          <span key={batch.id}>
            {batch.scope === 'GLOBAL' ? '全局' : '组织'} {batch.track}：
            {batch.status === 'APPLIED' ? `${batch.changes.length} 人已结算` : `未结算（${batch.skipReason || batch.status}）`}
          </span>
        ))}
      </div>
      {status === 'HELD' && <p className={styles.warning}>赛后重测已改变可计算输入。旧榜单和 Rating 历史仍保留，但在完成重放前不应作为当前结果。</p>}
      {loading && <p className={styles.muted}>正在读取结算状态…</p>}
      {error && <div className={styles.error} role="alert">{error}<Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div>}
      {data?.standing && data.standing.entries.length > 0 && (
        <details className={styles.details}>
          <summary>查看不可变最终榜单（{data.standing.entries.length}）</summary>
          <div className={styles.entries}>
            {data.standing.entries.map(entry => <div key={entry.userId} className={styles.entry}>
              <strong>#{entry.rank} {entry.user?.username || entry.userId}</strong>
              <span>{entry.totalScore !== null && entry.totalScore !== undefined
                ? `${entry.totalScore} 分`
                : `${entry.solvedCount || 0} 题 · ${entry.penaltySeconds || 0} 秒`}</span>
            </div>)}
          </div>
        </details>
      )}
    </Section>
  )
}
