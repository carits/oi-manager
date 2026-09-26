'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { listTeamProblemLists } from '../api/teamApi'
import { listTeamContests } from '@/features/contest'
import { listTrainingSessions } from '@/features/training-session'
import { StatusBadge } from '@/components/ui/Badge'
import styles from './Team.module.css'
import { activityStatusLabel } from '@/lib/humanPresentation'

type Activity = { id: string; kind: 'contest' | 'training' | 'problem-list'; title: string; status?: string; at: string }

export function TeamActivityOverview({ teamId, workspaceBase }: { teamId: string; workspaceBase: string }) {
  const [items, setItems] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    void Promise.allSettled([
      listTeamContests(teamId),
      listTrainingSessions({ teamId }),
      listTeamProblemLists(teamId),
    ]).then(([contests, trainings, lists]) => {
      if (!active) return
      const contestItems = contests.status === 'fulfilled' ? contests.value : []
      const trainingResult = trainings.status === 'fulfilled' ? trainings.value : []
      const trainingItems = Array.isArray(trainingResult) ? trainingResult : trainingResult.items
      const listItems = lists.status === 'fulfilled' ? lists.value : []
      const merged: Activity[] = [
        ...contestItems.map(item => ({ id: String(item.id), kind: 'contest' as const, title: item.title, status: item.status, at: item.startTime || item.createdAt || '' })),
        ...trainingItems.map(item => ({ id: item.id, kind: 'training' as const, title: item.title, status: item.status, at: item.createdAt || '' })),
        ...listItems.map(item => ({ id: item.problemList.id, kind: 'problem-list' as const, title: item.problemList.title, at: item.createdAt || '' })),
      ]
      setItems(merged.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [teamId])
  const links = useMemo(() => ({ contest: `${workspaceBase}/contests`, training: `${workspaceBase}/training-sessions`, 'problem-list': `${workspaceBase}/problem-lists` }), [workspaceBase])
  return <section className={styles.activityOverview} aria-labelledby="team-activity-title">
    <header><div><h2 id="team-activity-title">近期活动</h2><p>团队只负责成员关系；比赛、训练和题单在各自工作区统一管理。</p></div><div className={styles.activityActions}><Link className={styles.activityLink} href={`${links.contest}?teamId=${encodeURIComponent(teamId)}`}>查看比赛</Link><Link className={styles.activityLink} href={`${links.training}?teamId=${encodeURIComponent(teamId)}`}>查看训练</Link><Link className={styles.activityLink} href={`${links['problem-list']}?teamId=${encodeURIComponent(teamId)}`}>查看题单</Link></div></header>
    {loading ? <p>正在整理团队活动…</p> : items.length ? <div className={styles.activityList}>{items.map(item => <Link className={styles.activityItem} href={`${links[item.kind]}/${item.id}`} key={`${item.kind}:${item.id}`}><span><strong>{item.title}</strong><small>{item.kind === 'contest' ? '比赛' : item.kind === 'training' ? '训练' : '题单'}</small></span>{item.status && <StatusBadge variant="neutral">{activityStatusLabel(item.status)}</StatusBadge>}</Link>)}</div> : <p className={styles.activityEmpty}>暂无近期活动。请从比赛、训练或题单页面创建并选择这个团队。</p>}
  </section>
}
