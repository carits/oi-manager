'use client'

import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { trainingStatusLabel } from '@/lib/humanPresentation'
import styles from './TrainingEngine.module.css'

export function ClassroomHeader({
  title,
  description,
  status,
  connectionState,
  lastSyncedAt,
  onRefresh,
}: {
  title: string
  description?: string
  status: string
  connectionState: 'connecting' | 'connected' | 'reconnecting'
  lastSyncedAt?: number
  onRefresh: () => void
}) {
  return <PageHeader
    title={title}
    description={description || '课堂训练'}
    actions={<div className={styles.actions}>
      <StatusBadge variant={connectionState === 'connected' ? 'success' : 'warning'}>
        {connectionState === 'connected' ? '实时连接正常' : connectionState === 'connecting' ? '正在连接课堂' : '连接中断，正在恢复'}
      </StatusBadge>
      {lastSyncedAt && <span className={styles.muted}>同步于 {new Date(lastSyncedAt).toLocaleTimeString('zh-CN')}</span>}
      <Button size="sm" variant="ghost" onClick={onRefresh}>刷新</Button>
      <StatusBadge variant={status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : 'neutral'}>{trainingStatusLabel(status)}</StatusBadge>
    </div>}
  />
}
