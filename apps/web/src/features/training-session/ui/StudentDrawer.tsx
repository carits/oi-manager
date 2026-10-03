'use client'

import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { trainingProgressStatusLabel } from '@/lib/humanPresentation'
import type { ClassroomParticipant } from './trainingClassroomTypes'
import styles from './TrainingEngine.module.css'

const duration = (seconds?: number | null) => {
  const value = Math.max(0, Math.floor(seconds || 0))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

export function StudentDrawer({
  participant,
  arrangementName,
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
  participant?: ClassroomParticipant
  arrangementName?: string
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
  if (!participant) return null
  const currentProgress = participant.progress.find(item => item.stageProblemId === participant.currentProblemId) || participant.progress.find(item => item.status === 'STUCK')
  const stuck = participant.progress.some(item => item.status === 'STUCK')
  return <Drawer isOpen title={participant.user.username} description={`${groupName || '未分组'} · ${participant.online ? '在线' : '当前离线'}`} onClose={onClose} busy={busy} size="md" closeLabel="关闭学生详情">
    <section className={styles.participantCurrent}>
      <span>当前安排</span><strong>{arrangementName || '尚未开始'}</strong>
      <span>当前题目</span><strong>{problemName || '尚未选择题目'}</strong>
    </section>
    <dl className={styles.participantMetrics}>
      <div><dt>完成情况</dt><dd>{participant.completedCount} / {participant.requiredCount}</dd></div>
      <div><dt>最高分</dt><dd>{currentProgress?.bestScore ?? 0}</dd></div>
      <div><dt>提交</dt><dd>{currentProgress?.attemptCount || 0} 次</dd></div>
      <div><dt>有效训练</dt><dd>{duration(participant.activeSeconds)}</dd></div>
    </dl>
    <div className={styles.participantState}><span>最近状态</span><strong>{stuck ? '可能卡题' : !participant.online ? '当前离线' : participant.completed ? '已完成当前要求' : trainingProgressStatusLabel(currentProgress?.status || 'NOT_STARTED')}</strong></div>
    <div className={styles.participantActions}>
      {participant.currentProblemId && <Button variant="secondary" onClick={onViewProblem}>查看当前题与提示</Button>}
      {participant.currentProblemId && <Button variant="outline" disabled={busy} onClick={onUnlock}>单独解锁</Button>}
      {participant.currentProblemId && <Button variant="outline" disabled={busy} onClick={onSkip}>允许跳过</Button>}
      {stuck && <Button variant="outline" disabled={busy} onClick={onClearStuck}>清除卡题状态</Button>}
      <Button variant="outline" disabled={busy} onClick={onMessage}>发送消息</Button>
      <Button variant="outline" disabled={busy} onClick={onChangeGroup}>调整训练分组</Button>
      <Button variant="danger" disabled={busy} onClick={onLeave}>记录中途退出</Button>
    </div>
    <p className={styles.participantDrawerNote}>课堂临时操作不会删除学生已有草稿、提交或训练记录。</p>
  </Drawer>
}
