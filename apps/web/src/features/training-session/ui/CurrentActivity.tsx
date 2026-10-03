'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Pause, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { trainingStatusLabel } from '@/lib/humanPresentation'
import styles from './TrainingEngine.module.css'

const duration = (seconds?: number | null) => {
  const value = Math.max(0, Math.floor(seconds || 0))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

export function CurrentActivity({
  status,
  name,
  problemCount,
  activeElapsedSeconds,
  runningSince,
  plannedDurationSeconds,
  completed,
  total,
  stuck,
  offline,
  busy,
  onStart,
  onPause,
  onResume,
  onNext,
}: {
  status: string
  name?: string
  problemCount: number
  activeElapsedSeconds: number
  runningSince?: string | null
  plannedDurationSeconds?: number | null
  completed: number
  total: number
  stuck: number
  offline: number
  busy: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onNext: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (status !== 'RUNNING' || !runningSince) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [runningSince, status])
  const extra = status === 'RUNNING' && runningSince ? Math.max(0, Math.floor((now - new Date(runningSince).getTime()) / 1000)) : 0
  const elapsed = activeElapsedSeconds + extra
  return <section className={styles.runtimeHero} aria-label="当前安排">
    <div className={styles.runtimeHeroMain}>
      <div className={styles.runtimeHeroTitle}>
        <span>现在练什么</span>
        <h2>{name || (status === 'SCHEDULED' ? '等待开始训练' : '还没有课堂安排')}</h2>
        {name && <small>{problemCount ? `${problemCount} 道题` : '统一课堂活动'}</small>}
      </div>
      <StatusBadge variant={status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : 'neutral'}>{trainingStatusLabel(status)}</StatusBadge>
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
      {status === 'PAUSED' && <Button icon={<RotateCcw size={17} />} disabled={busy} loading={busy} onClick={onResume}>继续训练</Button>}
      {['RUNNING', 'PAUSED'].includes(status) && name && <Button icon={<ArrowRight size={17} />} disabled={busy} onClick={onNext}>下一步</Button>}
    </div>
  </section>
}
