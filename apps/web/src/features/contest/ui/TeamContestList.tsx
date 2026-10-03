'use client'

import { useState } from 'react'
import unifiedStyles from './TeamContestList.unified.module.css'
import Link from 'next/link'
import { CalendarDays, Clock3, FileText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth'
import { useResource } from '@/hooks/useResource'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { LoadError } from '@/components/ui/LoadError'
import { ContestFormModal } from './ContestFormModal'
import { typeLabel } from '../model/types'
import styles from './ContestList.module.css'
import { compareContestSchedules } from '@/lib/contestOrdering'

interface Contest { id: string; title: string; description: string | null; format: string; type: string; startTime: string; endTime: string; status: string; createdBy: string; problemCount: number; participantCount: number; createdAt: string }
interface TeamContestListProps { teamId?: string; schoolId?: string; organizationId?: string; basePath: string; isAdmin: boolean; mode?: 'contest' | 'contest' | 'homework'; schoolRole?: 'teacher' | 'student' }
const STATUS_MAP: Record<string, string> = { upcoming: '未开始', ongoing: '进行中', finished: '已结束' }
const FORMAT_MAP: Record<string, string> = { oi: 'OI', ioi: 'IOI', icpc: 'ICPC' }
function formatDuration(start: string, end: string) { const ms = new Date(end).getTime() - new Date(start).getTime(); const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); return h > 0 && m > 0 ? `${h}小时${m}分钟` : h > 0 ? `${h}小时` : `${m}分钟` }
function formatDateTime(iso: string) { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
function sortContests(contests: Contest[]) { return [...contests].sort(compareContestSchedules) }

export default function TeamContestList({ teamId, schoolId, organizationId, basePath, isAdmin, mode = 'contest', schoolRole = 'teacher' }: TeamContestListProps) {
  const { sessionKey } = useAuth(); const [showCreateModal, setShowCreateModal] = useState(false)
  const endpoint = organizationId
    ? '/api/organizations/' + organizationId + '/members/activities/contests'
    : '/api/teams/' + teamId + '/contests?type=' + mode
  const resource = useResource<Contest[]>(endpoint, { sessionKey, isEmpty: data => data.length === 0, dedupingInterval: 30000, refreshInterval: 30000 })
  const contests = resource.data ?? (resource.state.state === 'error' ? resource.state.previousData : undefined) ?? []
  const label = typeLabel(mode)
  if (resource.state.state === 'pending') return <SkeletonRegion rows={5} label={`${label}列表正在准备`} />
  if (resource.state.state === 'error' && !resource.state.previousData) return <LoadError message={resource.state.error.userMessage} requestId={resource.state.error.requestId} onRetry={resource.retry} />
  const ordered = sortContests(contests); const ongoingCount = contests.filter(t => t.status === 'ongoing').length; const detailPath = mode === 'contest' ? 'contests' : mode === 'homework' ? 'homeworks' : 'contests'
  return <div className={styles.panel}>
    {resource.state.state === 'error' && <LoadError compact message={resource.state.error.userMessage} requestId={resource.state.error.requestId} onRetry={resource.retry} />}
    <div className={styles.toolbar}><div className={styles.summary}><strong>{label}安排</strong><span>共 {contests.length} 场</span>{ongoingCount > 0 && <span className={styles.liveCount}>进行中 {ongoingCount}</span>}</div>{isAdmin && <div className={styles.createButton}><Button onClick={() => setShowCreateModal(true)}>创建{label}</Button></div>}</div>
    {ordered.length === 0 ? <div className={styles.empty}><strong>暂无{label}</strong><span>{isAdmin ? `可通过右上角创建新的${label}` : `当前没有可参与的${label}`}</span></div> : <div className={styles.list}>{ordered.map(contest => {
      const href = mode === 'contest'
        ? `${basePath}/${contest.id}`
        : `${basePath}/${teamId}/${detailPath}/${contest.id}`
      if (!href) return null
      return <Link key={contest.id} href={href} className={`${styles.card} ${contest.status === 'ongoing' ? styles.cardOngoing : contest.status === 'finished' ? styles.cardFinished : ''}`}><div className={styles.statusRail} data-status={contest.status} /><div className={styles.main}><div className={styles.heading}><span className={styles.title}>{contest.title}</span><span className={styles.format}>{FORMAT_MAP[contest.format] || '比赛'}</span><span className={styles.status} data-status={contest.status}><span className={styles.dot} />{STATUS_MAP[contest.status] || '未开始'}</span></div><div className={styles.meta}><span className={styles.metaItem}><CalendarDays size={15} />{formatDateTime(contest.startTime)} 至 {formatDateTime(contest.endTime)}</span><span className={styles.metaItem}><Clock3 size={15} />{formatDuration(contest.startTime, contest.endTime)}</span></div></div><div className={styles.facts}><div className={styles.fact}><span className={styles.factValue}>{contest.problemCount}</span><span className={styles.factLabel}>题目</span></div><div className={styles.fact}><span className={styles.factValue}>{contest.participantCount}</span><span className={styles.factLabel}>参与人数</span></div><div className={styles.fact}><FileText size={18} aria-label="比赛详情" className={unifiedStyles.u1} /><span className={styles.factLabel}>查看详情</span></div></div></Link>
    })}</div>}
    <ContestFormModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} teamId={teamId} schoolId={schoolId} organizationId={organizationId} onSaved={() => { setShowCreateModal(false); void resource.retry() }} mode={mode} />
  </div>
}
