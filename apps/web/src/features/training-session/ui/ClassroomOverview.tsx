'use client'

import { AlertTriangle, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/Badge'
import type { ClassroomArrangement, ClassroomGroup, ClassroomParticipant } from './trainingClassroomTypes'
import styles from './TrainingEngine.module.css'

export function StudentProgress({ participants }: { participants: ClassroomParticipant[] }) {
  const total = participants.length
  const completed = participants.filter(item => item.completed).length
  const working = participants.filter(item => item.online && !item.completed && !item.progress.some(progress => progress.status === 'STUCK')).length
  const attention = participants.filter(item => !item.online || item.progress.some(progress => progress.status === 'STUCK')).length
  return <Section title="学生练得怎么样" description="先看整体，再处理真正需要关注的学生。">
    <div className={styles.summary}>
      <div className={styles.metric}><strong>{completed} / {total}</strong>已完成</div>
      <div className={styles.metric}><strong>{working}</strong>训练中</div>
      <div className={styles.metric}><strong>{attention}</strong>需要关注</div>
    </div>
  </Section>
}

export function AttentionNeeded({
  participants,
  problemNames,
  onOpen,
  onOpenAll,
}: {
  participants: ClassroomParticipant[]
  problemNames: Record<string, string>
  onOpen: (participant: ClassroomParticipant) => void
  onOpenAll: () => void
}) {
  return <section className={styles.attentionPanel} aria-labelledby="training-attention-title">
    <header>
      <div><span className={styles.attentionIcon}><AlertTriangle size={18} /></span><div><h2 id="training-attention-title">需要关注</h2><p>优先处理卡题或暂时离线的学生。</p></div></div>
      <Button size="sm" variant="ghost" icon={<Users size={16} />} onClick={onOpenAll}>全部学生</Button>
    </header>
    {participants.length > 0 ? <div className={styles.attentionList}>{participants.slice(0, 6).map(participant => {
      const progress = participant.progress.find(item => item.status === 'STUCK') || participant.progress.find(item => item.stageProblemId === participant.currentProblemId)
      const problemName = participant.currentProblemId ? problemNames[participant.currentProblemId] : undefined
      const details = [progress?.status === 'STUCK' ? '可能卡题' : !participant.online ? '当前离线' : '需要查看', problemName, progress?.attemptCount ? `${progress.attemptCount} 次提交` : undefined].filter(Boolean).join(' · ')
      return <article key={participant.id}><div><strong>{participant.user.username}</strong><span>{details}</span></div><Button size="sm" variant="outline" onClick={() => onOpen(participant)}>查看</Button></article>
    })}</div> : <div className={styles.attentionEmpty}><strong>当前没有需要立即处理的学生</strong><span>课堂状态变化后会自动更新。</span></div>}
  </section>
}

export function GroupOverview({
  groups,
  participants,
  current,
  canManage,
  onSplit,
  onMerge,
}: {
  groups: ClassroomGroup[]
  participants: ClassroomParticipant[]
  current?: ClassroomArrangement
  canManage: boolean
  onSplit: (group: ClassroomGroup) => void
  onMerge: (group: ClassroomGroup) => void
}) {
  const activeGroups = groups.filter(group => group.status === 'active')
  return <Section title="当前分组" description="学生属于训练组；当前安排可以统一执行，也可以按组调整。">
    <div className={styles.runtimeGroupList}>{activeGroups.map(group => {
      const members = participants.filter(item => item.currentGroupId === group.id)
      const completed = members.filter(item => item.completed).length
      const attention = members.filter(item => !item.online || item.progress.some(progress => progress.status === 'STUCK')).length
      const plan = current?.Plans.find(item => item.groupId === group.id) || current?.Plans.find(item => item.isDefault)
      return <article className={styles.runtimeGroupCard} key={group.id}>
        <div><strong>{group.name}</strong><StatusBadge variant={current ? 'success' : 'neutral'}>{current ? '正在训练' : '等待开始'}</StatusBadge></div>
        <p>{plan?.name || current?.name || '统一安排'}</p>
        <span>{completed} / {members.length} 完成{attention ? ` · ${attention} 人需要关注` : ''}</span>
        {canManage && <div className={styles.actions}>
          {members.length > 1 && <Button size="sm" variant="outline" onClick={() => onSplit(group)}>拆组</Button>}
          {activeGroups.length > 1 && <Button size="sm" variant="ghost" onClick={() => onMerge(group)}>合并到…</Button>}
        </div>}
      </article>
    })}</div>
  </Section>
}

export function ClassroomOverview({
  participants,
  attention,
  problemNames,
  groups,
  current,
  canManage,
  onOpenParticipant,
  onOpenAll,
  onSplit,
  onMerge,
}: {
  participants: ClassroomParticipant[]
  attention: ClassroomParticipant[]
  problemNames: Record<string, string>
  groups: ClassroomGroup[]
  current?: ClassroomArrangement
  canManage: boolean
  onOpenParticipant: (participant: ClassroomParticipant) => void
  onOpenAll: () => void
  onSplit: (group: ClassroomGroup) => void
  onMerge: (group: ClassroomGroup) => void
}) {
  return <section aria-label="课堂概览" className={styles.stack}>
    <StudentProgress participants={participants} />
    <div className={styles.runtimeOverviewGrid}>
      <AttentionNeeded participants={attention} problemNames={problemNames} onOpen={onOpenParticipant} onOpenAll={onOpenAll} />
      <GroupOverview groups={groups} participants={participants} current={current} canManage={canManage} onSplit={onSplit} onMerge={onMerge} />
    </div>
  </section>
}
