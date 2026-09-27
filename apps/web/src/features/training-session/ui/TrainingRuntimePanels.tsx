'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Pause, Play, RotateCcw, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { trainingProgressStatusLabel, trainingStatusLabel } from '@/lib/humanPresentation'
import styles from './TrainingEngine.module.css'

export type TrainingDashboardProgress = {
  stageProblemId?: string
  status: string
  bestScore?: number | null
  attemptCount?: number
  activeSeconds?: number
  continuousActiveSeconds?: number
}

export type TrainingDashboardParticipant = {
  id: string
  user: { id: string; username: string }
  online: boolean
  currentProblemId?: string
  currentGroupId?: string | null
  activeSeconds?: number
  requiredCount: number
  completedCount: number
  completed: boolean
  progress: TrainingDashboardProgress[]
}

const duration = (seconds?: number | null) => {
  const value = Math.max(0, Math.floor(seconds || 0))
  const minutes = Math.floor(value / 60)
  return `${minutes}:${String(value % 60).padStart(2, '0')}`
}

export function TrainingRuntimeHeader({
  status,
  stageName,
  stageIndex,
  stageCount,
  activeElapsedSeconds,
  runningSince,
  plannedDurationSeconds,
  completed,
  total,
  stuck,
  offline,
  hasNextStage,
  busy,
  onStart,
  onPause,
  onResume,
  onAdvance,
}: {
  status: string
  stageName?: string
  stageIndex: number
  stageCount: number
  activeElapsedSeconds: number
  runningSince?: string | null
  plannedDurationSeconds?: number | null
  completed: number
  total: number
  stuck: number
  offline: number
  hasNextStage: boolean
  busy: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onAdvance: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (status !== 'RUNNING' || !runningSince) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [runningSince, status])
  const extra = status === 'RUNNING' && runningSince
    ? Math.max(0, Math.floor((now - new Date(runningSince).getTime()) / 1000))
    : 0
  const elapsed = activeElapsedSeconds + extra

  return <section className={styles.runtimeHero} aria-label="课堂状态">
    <div className={styles.runtimeHeroMain}>
      <div className={styles.runtimeHeroTitle}>
        <span>{stageName ? `阶段 ${stageIndex + 1} / ${stageCount}` : '课堂状态'}</span>
        <h2>{stageName || (status === 'SCHEDULED' ? '等待开始训练' : '暂无进行中的阶段')}</h2>
      </div>
      <StatusBadge variant={status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : 'neutral'}>
        {trainingStatusLabel(status)}
      </StatusBadge>
    </div>
    <div className={styles.runtimeHeroMetrics}>
      <div><strong>{duration(elapsed)}{plannedDurationSeconds ? ` / ${duration(plannedDurationSeconds)}` : ''}</strong><span>课堂用时</span></div>
      <div><strong>{completed} / {total}</strong><span>已完成</span></div>
      <div><strong>{stuck}</strong><span>可能卡题</span></div>
      <div><strong>{offline}</strong><span>当前离线</span></div>
    </div>
    <div className={styles.runtimePrimaryActions}>
      {status === 'SCHEDULED' && <Button icon={<Play size={17} />} disabled={busy} loading={busy} onClick={onStart}>开始训练</Button>}
      {status === 'RUNNING' && <Button variant="secondary" icon={<Pause size={17} />} disabled={busy} onClick={onPause}>暂停训练</Button>}
      {status === 'PAUSED' && <Button icon={<RotateCcw size={17} />} disabled={busy} loading={busy} onClick={onResume}>恢复训练</Button>}
      {['RUNNING', 'PAUSED'].includes(status) && stageName && <Button icon={<ArrowRight size={17} />} disabled={busy} onClick={onAdvance}>{hasNextStage ? '进入下一阶段' : '完成训练'}</Button>}
    </div>
  </section>
}

export function TrainingAttentionPanel({
  participants,
  problemNames,
  onOpen,
  onOpenAll,
}: {
  participants: TrainingDashboardParticipant[]
  problemNames: Record<string, string>
  onOpen: (participant: TrainingDashboardParticipant) => void
  onOpenAll: () => void
}) {
  return <section className={styles.attentionPanel} aria-labelledby="training-attention-title">
    <header>
      <div>
        <span className={styles.attentionIcon}><AlertTriangle size={18} /></span>
        <div><h2 id="training-attention-title">需要关注</h2><p>卡题或暂时离线的学员会出现在这里。</p></div>
      </div>
      <Button size="sm" variant="ghost" icon={<Users size={16} />} onClick={onOpenAll}>全部学员</Button>
    </header>
    {participants.length > 0 ? <div className={styles.attentionList}>
      {participants.slice(0, 6).map(participant => {
        const progress = participant.progress.find(item => item.status === 'STUCK')
          || participant.progress.find(item => item.stageProblemId === participant.currentProblemId)
        const problemName = participant.currentProblemId ? problemNames[participant.currentProblemId] : undefined
        const details = [
          progress?.status === 'STUCK' ? '可能卡题' : !participant.online ? '当前离线' : '需要查看',
          problemName,
          progress?.attemptCount ? `${progress.attemptCount} 次提交` : undefined,
        ].filter(Boolean).join(' · ')
        return <article key={participant.id}>
          <div><strong>{participant.user.username}</strong><span>{details}</span></div>
          <Button size="sm" variant="outline" onClick={() => onOpen(participant)}>查看</Button>
        </article>
      })}
    </div> : <div className={styles.attentionEmpty}><strong>当前没有需要立即处理的学员</strong><span>课堂状态有变化时会自动更新。</span></div>}
  </section>
}

export function TrainingParticipantDrawer({
  participant,
  stageName,
  groupName,
  problemName,
  busy,
  onClose,
  onViewProblem,
  onUnlock,
  onSkip,
  onClearStuck,
  onMessage,
  onChangeGroup,
  onLeave,
}: {
  participant?: TrainingDashboardParticipant
  stageName?: string
  groupName?: string
  problemName?: string
  busy: boolean
  onClose: () => void
  onViewProblem: () => void
  onUnlock: () => void
  onSkip: () => void
  onClearStuck: () => void
  onMessage: () => void
  onChangeGroup: () => void
  onLeave: () => void
}) {
  const drawerRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!participant) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus())
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
      previousFocusRef.current?.focus()
    }
  }, [onClose, participant])
  if (!participant) return null

  const currentProgress = participant.progress.find(item => item.stageProblemId === participant.currentProblemId)
    || participant.progress.find(item => item.status === 'STUCK')
  const stuck = participant.progress.some(item => item.status === 'STUCK')

  return <div className={styles.participantDrawerLayer}>
    <button className={styles.participantDrawerBackdrop} aria-label="关闭学员详情" onClick={onClose} />
    <aside ref={drawerRef} className={styles.participantDrawer} role="dialog" aria-modal="true" aria-labelledby="participant-drawer-title">
      <header>
        <div><h2 id="participant-drawer-title">{participant.user.username}</h2><p>{groupName || '未分组'} · {participant.online ? '在线' : '当前离线'}</p></div>
        <Button iconOnly variant="ghost" aria-label="关闭学员详情" onClick={onClose}><X size={18} /></Button>
      </header>
      <div className={styles.participantDrawerBody}>
        <section className={styles.participantCurrent}>
          <span>当前阶段</span><strong>{stageName || '尚未开始'}</strong>
          <span>当前题目</span><strong>{problemName || '尚未选择题目'}</strong>
        </section>
        <dl className={styles.participantMetrics}>
          <div><dt>完成情况</dt><dd>{participant.completedCount} / {participant.requiredCount}</dd></div>
          <div><dt>最高分</dt><dd>{currentProgress?.bestScore ?? 0}</dd></div>
          <div><dt>提交</dt><dd>{currentProgress?.attemptCount || 0} 次</dd></div>
          <div><dt>有效训练</dt><dd>{duration(participant.activeSeconds)}</dd></div>
        </dl>
        <div className={styles.participantState}>
          <span>最近状态</span>
          <strong>{stuck ? '可能卡题' : !participant.online ? '当前离线' : participant.completed ? '已完成当前要求' : trainingProgressStatusLabel(currentProgress?.status || 'NOT_STARTED')}</strong>
        </div>
        <div className={styles.participantActions}>
          {participant.currentProblemId && <Button variant="secondary" onClick={onViewProblem}>查看当前题与提示</Button>}
          {participant.currentProblemId && <Button variant="outline" disabled={busy} onClick={onUnlock}>单独解锁</Button>}
          {participant.currentProblemId && <Button variant="outline" disabled={busy} onClick={onSkip}>允许跳过</Button>}
          {stuck && <Button variant="outline" disabled={busy} onClick={onClearStuck}>清除卡题状态</Button>}
          <Button variant="outline" disabled={busy} onClick={onMessage}>发送消息</Button>
          <Button variant="outline" disabled={busy} onClick={onChangeGroup}>调整训练分组</Button>
          <Button variant="danger" disabled={busy} onClick={onLeave}>记录中途退出</Button>
        </div>
        <p className={styles.participantDrawerNote}>课堂临时操作不会删除学员已有草稿、提交或训练记录。</p>
      </div>
    </aside>
  </div>
}
