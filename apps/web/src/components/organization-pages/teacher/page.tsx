'use client'

import Link from 'next/link'
import { ArrowRight, ClipboardList, GraduationCap, Trophy, Users, UsersRound } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { usePathname } from 'next/navigation'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import styles from '@/components/Dashboard.module.css'

interface Team { id: string; name: string; description?: string | null; _count?: { members?: number } }
interface TeamPayload { items?: Team[]; data?: Team[]; total?: number }

function normalizeTeams(payload: TeamPayload | Team[] | undefined): Team[] {
  if (Array.isArray(payload)) return payload
  return payload?.items || payload?.data || []
}

export default function TeacherPage() {
  const { user, sessionKey } = useAuth()
  const pathname = usePathname()
  const prefix = currentWorkspacePrefix(pathname, '/personal')
  const principal = user?.role === 'school_principal'
  const teamResource = useResource<TeamPayload | Team[]>('/api/teams?view=mine&page=1&pageSize=6', { sessionKey, isEmpty: data => normalizeTeams(data).length === 0, dedupingInterval: 30000 })
  const invitationResource = useResource<unknown[]>('/api/teams/admin-invitations', { sessionKey, dedupingInterval: 30000 })
  const teams = normalizeTeams(teamResource.data)
  const memberCount = teams.reduce((sum, team) => sum + (team._count?.members || 0), 0)

  return (
    <PageFrame>
      <PageHeader title={principal ? '学校工作概览' : '教学工作概览'} description={`你好，${user?.username || '老师'}。从待处理事项开始今天的工作。`} />
      <div className={styles.metricGrid}>
        <div className={styles.metric}><p className={styles.metricLabel}>负责团队</p><p className={styles.metricValue}>{teams.length || '—'}</p><p className={styles.metricHint}>当前账号可管理的团队</p></div>
        <div className={styles.metric}><p className={styles.metricLabel}>团队成员</p><p className={styles.metricValue}>{memberCount || '—'}</p><p className={styles.metricHint}>最近载入的团队成员数</p></div>
        <div className={styles.metric}><p className={styles.metricLabel}>待处理邀请</p><p className={styles.metricValue}>{invitationResource.data?.length ?? '—'}</p><p className={styles.metricHint}>团队管理员邀请</p></div>
      </div>
      <div className={styles.dashboardGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>我的团队</h2><Link className={styles.sectionLink} href={`${prefix}/teams`}>团队列表<ArrowRight size={14} /></Link></div>
          <AsyncRegion state={teamResource.state} onRetry={teamResource.retry} emptyText="还没有负责的团队" skeletonRows={4}>
            {() => <div className={styles.list}>{teams.map(team => <Link className={styles.listItem} key={team.id} href={`${prefix}/teams/${team.id}`}><span className={styles.listMain}><span className={styles.listTitle}>{team.name}</span><span className={styles.listMeta}><span>{team._count?.members || 0} 名成员</span><span>{team.description || '暂无团队说明'}</span></span></span><ArrowRight size={16} /></Link>)}</div>}
          </AsyncRegion>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>开始处理</h2></div>
          <div className={styles.actionList}>
            <Link className={styles.actionLink} href={`${prefix}/management?tab=students`}><span className={styles.actionIcon}><Users size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>学生</span><span className={styles.actionHint}>查找、导入和维护学生</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href={`${prefix}/homeworks`}><span className={styles.actionIcon}><ClipboardList size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>作业</span><span className={styles.actionHint}>查看进行中和即将开始的任务</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href={`${prefix}/contests`}><span className={styles.actionIcon}><Trophy size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>比赛</span><span className={styles.actionHint}>维护团队与校级比赛</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href={`${prefix}/teams`}><span className={styles.actionIcon}><UsersRound size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>团队</span><span className={styles.actionHint}>管理成员、邀请和训练</span></span><ArrowRight size={16} /></Link>
            {principal && <Link className={styles.actionLink} href={`${prefix}/management?tab=teachers`}><span className={styles.actionIcon}><GraduationCap size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>教师</span><span className={styles.actionHint}>学校教师与权限</span></span><ArrowRight size={16} /></Link>}
          </div>
        </section>
      </div>
    </PageFrame>
  )
}
