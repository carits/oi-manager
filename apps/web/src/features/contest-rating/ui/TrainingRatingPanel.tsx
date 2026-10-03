'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/FormControls'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'
import styles from './TrainingRatingPanel.module.css'
import { finalizeContestRating, getContestRating, getContestRatingParticipation, rebuildContestRating, updateContestRatingParticipation } from '@/features/contest-rating/api/contestRatingApi'
import type { ContestRatingData, ContestRatingParticipation } from '@oi-manager/contracts'

type RatingPayload = ContestRatingData

type ContestRatingTraining = {
  status: string
  runtimeStatus?: 'upcoming' | 'ongoing' | 'finished'
  format: 'oi' | 'ioi' | 'icpc'
  isAdmin: boolean
  finalizationStatus?: 'LIVE' | 'JUDGING' | 'FINALIZING' | 'FINALIZED' | 'HELD' | 'FAILED'
  ratingConfig?: {
    scope: 'NONE' | 'ORGANIZATION' | 'GLOBAL' | 'BOTH'
    track: 'OI' | 'IOI' | 'ACM'
    weight: number
    locked: boolean
  } | null
}

const stateLabel: Record<string, string> = {
  LIVE: '进行中', JUDGING: '等待评测完成', FINALIZING: '正在结算',
  FINALIZED: '已结算', HELD: '重测后待重放', FAILED: '结算失败',
}

const skipReasonLabel: Record<string, string> = {
  INSUFFICIENT_PARTICIPANTS: '有效参赛人数未达到最低要求',
  NOT_ENOUGH_PARTICIPANTS: '有效参赛人数未达到最低要求',
  NOT_FINALIZED: '最终榜单尚未生成',
  HELD: '赛后重测后等待重放',
}

function scopeText(scope: string, track: string, organizationName?: string) {
  return scope === 'GLOBAL' ? `全局 ${track}` : `${organizationName || '所属学校'} ${track}`
}

export function TrainingRatingPanel({ trainingId, training, onChanged }: {
  trainingId: string
  training: ContestRatingTraining
  onChanged: () => void | Promise<void>
}) {
  const [data, setData] = useState<RatingPayload | null>(null)
  const [participation, setParticipation] = useState<ContestRatingParticipation | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [participationSaving, setParticipationSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'finalize' | 'rebuild' | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [response, participationResponse] = await Promise.all([
        getContestRating(Number(trainingId)),
        getContestRatingParticipation(Number(trainingId)),
      ])
      setData(response)
      setParticipation(participationResponse)
      setSelectedOrganizationId(participationResponse.selectedOrganizationId || '')
    } catch (reason) {
      setError(publicErrorMessage(reason, '读取 Rating 结算状态失败'))
    } finally {
      setLoading(false)
    }
  }, [trainingId])

  useEffect(() => { void load() }, [load])

  const execute = async (kind: 'finalize' | 'rebuild') => {
    setAction(kind)
    setError('')
    try {
      const response = kind === 'finalize'
        ? await finalizeContestRating(Number(trainingId))
        : await rebuildContestRating(Number(trainingId))
      if (!response.ok) throw response.error
      setData(response.data)
      await onChanged()
    } catch (reason) {
      setError(publicErrorMessage(reason, 'Rating 操作失败'))
    } finally {
      setAction(null)
    }
  }

  const saveParticipation = async () => {
    setParticipationSaving(true)
    setError('')
    try {
      const response = await updateContestRatingParticipation(Number(trainingId), selectedOrganizationId || null)
      if (!response.ok) throw response.error
      setParticipation(response.data)
      setSelectedOrganizationId(response.data.selectedOrganizationId || '')
    } catch (reason) {
      setError(publicErrorMessage(reason, '保存参赛组织失败'))
    } finally {
      setParticipationSaving(false)
    }
  }

  const status = data?.finalizationStatus || training.finalizationStatus || 'LIVE'
  const enabled = (data?.config.scope || training.ratingConfig?.scope || 'NONE') !== 'NONE'
  const configuredScope = data?.config.scope || training.ratingConfig?.scope || 'NONE'
  const configuredTrack = data?.config.track || training.ratingConfig?.track || training.format.toUpperCase()
  const configuredWeight = data?.config.weight ?? training.ratingConfig?.weight ?? 1
  const ratingDescription = configuredScope === 'BOTH'
    ? `本场计 Rating：全局 ${configuredTrack} + 参赛学校 ${configuredTrack}`
    : configuredScope === 'GLOBAL' ? `本场计 Rating：全局 ${configuredTrack}` : `本场计 Rating：参赛学校 ${configuredTrack}`
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
        ? `${ratingDescription}；影响强度：标准比赛的 ${Math.round(configuredWeight * 100)}%`
        : '本场比赛不计 Rating；普通实时排名仍正常显示。'}
      actions={actionButton}
    >
      <div className={styles.summary}>
        <StatusBadge variant={status === 'FINALIZED' ? 'success' : status === 'HELD' || status === 'FAILED' ? 'warning' : 'pending'}>
          {stateLabel[status] || '结算状态待确认'}
        </StatusBadge>
        {data?.standing && <span>最终榜单 · {data.standing.entries.length} 人</span>}
        {data?.batches.map(batch => (
          <span key={batch.id}>
            {scopeText(batch.scope, batch.track, batch.organization?.shortName || batch.organization?.name)}：
            {batch.status === 'APPLIED' ? `${batch.changes.length} 人已结算` : `未结算（${skipReasonLabel[batch.skipReason || ''] || '等待结算条件满足'}）`}
          </span>
        ))}
      </div>
      {enabled && !participation?.fixed && <p className={styles.muted}>首次提交后，你在本场比赛中的学校归属将固定。</p>}
      {data?.myChanges && data.myChanges.length > 0 && <div className={styles.myChanges}>{data.myChanges.map(change => <div key={change.batchId}><span>{scopeText(change.scope, change.track, change.organization?.shortName || change.organization?.name)}</span><strong>{change.ratingBefore} → {change.ratingAfter}（{change.appliedDelta >= 0 ? '+' : ''}{change.appliedDelta}）</strong></div>)}</div>}
      {participation?.fixed && participation.selectedOrganization && (
        <p className={styles.muted}>Rating 学校归属：{participation.selectedOrganization.name}（首次提交后固定）</p>
      )}
      {participation?.context === 'platform' && participation.scope === 'BOTH' && participation.organizations.length > 0 && (
        <div className={styles.participation}>
          <div>
            <strong>参赛学校</strong>
            <span>首次提交后固定；全局 Rating 不受此选择影响。</span>
          </div>
          <Select
            aria-label="参赛学校"
            value={selectedOrganizationId}
            disabled={!participation.canChange || participationSaving}
            onChange={event => setSelectedOrganizationId(event.target.value)}
          >
            <option value="">请选择参赛学校</option>
            {participation.organizations.map(organization => (
              <option key={organization.id} value={organization.id}>{organization.shortName || organization.name}</option>
            ))}
          </Select>
          {participation.canChange && (
            <Button size="sm" loading={participationSaving} disabled={!selectedOrganizationId} onClick={() => void saveParticipation()}>保存归属</Button>
          )}
        </div>
      )}
      {participation?.requiresExplicitSelection && <p className={styles.warning}>你属于多所学校，必须先选择本场比赛的 Rating 归属学校，才能首次提交。</p>}
      {participation?.context === 'platform' && participation.scope === 'BOTH' && participation.organizations.length === 0 && (
        <p className={styles.muted}>当前账号没有可用学校，本场只计全局 Rating。</p>
      )}
      {status === 'HELD' && <p className={styles.warning}>赛后重测已改变可计算输入。旧榜单和 Rating 历史仍保留，但在完成重放前不应作为当前结果。</p>}
      {loading && <p className={styles.muted}>正在读取结算状态…</p>}
      {error && <div className={styles.error} role="alert">{error}<Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div>}
      {data?.standing && data.standing.entries.length > 0 && (
        <details className={styles.details}>
          <summary>查看最终榜单与计算规则（{data.standing.entries.length}）</summary>
          <div className={styles.entries}>
            {data.standing.entries.map(entry => <div key={entry.userId} className={styles.entry}>
              <strong>#{entry.rank} {entry.user?.username || '未知用户'}</strong>
              <span>{entry.totalScore !== null && entry.totalScore !== undefined
                ? `${entry.totalScore} 分`
                : `${entry.solvedCount || 0} 题 · ${entry.penaltySeconds || 0} 秒`}{data.batches.flatMap(batch => batch.changes.map(change => ({ ...change, batch }))).filter(change => change.userId === entry.userId).map(change => ` · ${scopeText(change.batch.scope, change.batch.track, change.batch.organization?.shortName || change.batch.organization?.name)} ${change.ratingBefore} → ${change.ratingAfter}（${change.appliedDelta >= 0 ? '+' : ''}${change.appliedDelta}）`).join('')}</span>
            </div>)}
          </div>
        </details>
      )}
    </Section>
  )
}
