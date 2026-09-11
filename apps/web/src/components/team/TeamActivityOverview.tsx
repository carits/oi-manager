'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import apiClient from '@/lib/apiClient'
import { StatusBadge } from '@/components/ui/Badge'
import styles from './Team.module.css'

type LegacyActivity = { id: string; title: string; status?: string; startTime?: string; createdAt?: string }
type CoachSession = { id: string; title: string; status: string; createdAt?: string }
type ProblemListItem = { problemListId: string; createdAt?: string; problemList: { id: string; title: string } }
type Activity = { id: string; kind: 'contest' | 'training' | 'problem-list'; title: string; status?: string; at: string }

export function TeamActivityOverview({ teamId, workspaceBase }: { teamId: string; workspaceBase: string }) {
  const [items, setItems] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    void Promise.all([
      apiClient.get<LegacyActivity[]>(`/api/teams/${teamId}/trainings?type=contest`),
      apiClient.get<CoachSession[]>(`/api/training-sessions?teamId=${encodeURIComponent(teamId)}`),
      apiClient.get<ProblemListItem[]>(`/api/teams/${teamId}/problem-lists`),
    ]).then(([contests, trainings, lists]) => {
      if (!active) return
      const merged: Activity[] = [
        ...(contests.success ? contests.data || [] : []).map(item => ({ id: item.id, kind: 'contest' as const, title: item.title, status: item.status, at: item.startTime || item.createdAt || '' })),
        ...(trainings.success ? trainings.data || [] : []).map(item => ({ id: item.id, kind: 'training' as const, title: item.title, status: item.status, at: item.createdAt || '' })),
        ...(lists.success ? lists.data || [] : []).map(item => ({ id: item.problemList.id, kind: 'problem-list' as const, title: item.problemList.title, at: item.createdAt || '' })),
      ]
      setItems(merged.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)); setLoading(false)
    })
    return () => { active = false }
  }, [teamId])
  const links = useMemo(() => ({ contest: `${workspaceBase}/contests`, training: `${workspaceBase}/training-sessions`, 'problem-list': `${workspaceBase}/problem-lists` }), [workspaceBase])
  return <section className={styles.activityOverview} aria-labelledby="team-activity-title">
    <header><div><h2 id="team-activity-title">近期活动</h2><p>团队只负责成员关系；比赛、训练和题单在各自工作区统一管理。</p></div><div className={styles.activityActions}><Link className={styles.activityLink} href={`${links.contest}?teamId=${encodeURIComponent(teamId)}`}>查看比赛</Link><Link className={styles.activityLink} href={`${links.training}?teamId=${encodeURIComponent(teamId)}`}>查看训练</Link><Link className={styles.activityLink} href={`${links['problem-list']}?teamId=${encodeURIComponent(teamId)}`}>查看题单</Link></div></header>
    {loading ? <p>正在整理团队活动…</p> : items.length ? <div className={styles.activityList}>{items.map(item => <Link className={styles.activityItem} href={`${links[item.kind]}/${item.id}`} key={`${item.kind}:${item.id}`}><span><strong>{item.title}</strong><small>{item.kind === 'contest' ? '比赛' : item.kind === 'training' ? '教练训练' : '题单'}</small></span>{item.status && <StatusBadge variant="neutral">{item.status}</StatusBadge>}</Link>)}</div> : <p className={styles.activityEmpty}>暂无近期活动。请从比赛、训练或题单页面创建并选择这个团队。</p>}
  </section>
}
