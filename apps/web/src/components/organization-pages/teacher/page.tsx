'use client'

import Link from 'next/link'
import { ArrowRight, ClipboardList, GraduationCap, Trophy, Users, UsersRound, AlertCircle, CalendarClock } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { usePathname } from 'next/navigation'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { compareDashboardTasks, type LearningTask } from '@/lib/dashboardTasks'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import styles from '@/components/Dashboard.module.css'

interface Team { id: string; name: string; description?: string | null; _count?: { members?: number } }
interface TeamPayload { items?: Team[]; data?: Team[]; total?: number; summary?: { memberCount?: number } }
interface AssignmentItem { id: string; title: string; status: string; dueAt: string }
interface AssignmentPayload { items: AssignmentItem[]; statusCounts?: Record<string, number> }
interface JoinPayload { pending: number }
interface TrainingItem { id: string; title: string; status: string; scheduledStartAt?: string | null; dueAt?: string | null }
interface ContestItem { id: number; title: string; startTime: string; endTime: string }

function normalizeTeams(payload: TeamPayload | Team[] | undefined): Team[] {
  if (Array.isArray(payload)) return payload
  return payload?.items || payload?.data || []
}

export default function TeacherPage() {
  const { user, sessionKey } = useAuth()
  const pathname = usePathname()
  const prefix = currentWorkspacePrefix(pathname, '/personal')
  const organizationId = pathname.match(/^\/org\/([^/]+)/)?.[1] || ''
  const principal = user?.organizationRole === 'school_principal'
  const teamResource = useResource<TeamPayload | Team[]>(`/api/teams?organizationId=${encodeURIComponent(organizationId)}&view=mine&page=1&pageSize=6`, { sessionKey, isEmpty: data => normalizeTeams(data).length === 0, dedupingInterval: 30000 })
  const invitationResource = useResource<unknown[]>('/api/teams/admin-invitations', { sessionKey, dedupingInterval: 30000 })
  const assignmentResource = useResource<AssignmentPayload>(`/api/assignments?organizationId=${organizationId}&pageSize=100`, { sessionKey, dedupingInterval: 30000 })
  const joinResource = useResource<JoinPayload>(`/api/organizations/${organizationId}/join-applications?status=pending&pageSize=1`, { sessionKey, dedupingInterval: 30000 })
  const trainingResource = useResource<TrainingItem[]>(`/api/training-sessions?organizationId=${organizationId}`, { sessionKey, dedupingInterval: 30000 })
  const contestResource = useResource<ContestItem[]>(`/api/organizations/${organizationId}/members/activities/contests`, { sessionKey, dedupingInterval: 30000 })
  const teams = normalizeTeams(teamResource.data)
  const teamTotal = Array.isArray(teamResource.data) ? teamResource.data.length : teamResource.data?.total
  const memberCount = Array.isArray(teamResource.data) ? teams.reduce((sum, team) => sum + (team._count?.members || 0), 0) : teamResource.data?.summary?.memberCount
  const now = Date.now()
  const assignmentTasks: LearningTask[] = (assignmentResource.data?.items || []).filter(item => ['DRAFT', 'OPEN', 'OVERDUE', 'REVIEWING'].includes(item.status)).map(item => ({
    id: `assignment-${item.id}`, type: 'assignment', title: item.title, status: item.status,
    href: `${prefix}/homeworks/${item.id}`, actionLabel: item.status === 'DRAFT' ? '待发布' : item.status === 'REVIEWING' ? '待批改' : item.status === 'OVERDUE' ? '已截止' : '进行中',
    dueAt: item.dueAt, detail: `截止 ${new Date(item.dueAt).toLocaleString('zh-CN')}`,
  }))
  const trainingTasks: LearningTask[] = (trainingResource.data || []).filter(item => ['DRAFT', 'SCHEDULED'].includes(item.status)).map(item => ({
    id: `training-${item.id}`, type: 'training', title: item.title, status: item.status,
    href: `${prefix}/training-sessions/${item.id}${item.status === 'DRAFT' ? '/design' : ''}`, actionLabel: item.status === 'DRAFT' ? '待编排' : '待开始',
    actionAt: item.scheduledStartAt, dueAt: item.dueAt, detail: item.status === 'DRAFT' ? '继续配置题目和训练顺序' : `计划 ${item.scheduledStartAt ? new Date(item.scheduledStartAt).toLocaleString('zh-CN') : '手动开始'}`,
  }))
  const contestTasks: LearningTask[] = (contestResource.data || []).filter(item => new Date(item.endTime).getTime() >= now).map(item => ({
    id: `contest-${item.id}`, type: 'contest', title: item.title,
    status: new Date(item.startTime).getTime() <= now ? 'ONGOING' : 'SCHEDULED', href: `${prefix}/contests/${item.id}`,
    actionLabel: new Date(item.startTime).getTime() <= now ? '比赛进行中' : '比赛待开始', actionAt: item.startTime, dueAt: item.endTime,
    detail: `${new Date(item.startTime).toLocaleString('zh-CN')} 开始`,
  }))
  const dashboardTasks = [...assignmentTasks, ...trainingTasks, ...contestTasks].sort((a, b) => compareDashboardTasks(a, b, now)).slice(0, 8)
  const pendingJoins = joinResource.data?.pending || 0

  return (
    <PageFrame>
      <PageHeader title={principal ? '学校工作概览' : '教学工作概览'} description={`你好，${user?.username || '老师'}。从待处理事项开始今天的工作。`} />
      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>待处理事项</h2><span className={styles.sectionHint}>按紧急程度整理，可直接进入处理</span></div>
        <div className={styles.taskInbox}>
          {pendingJoins > 0 && <Link className={styles.taskItem} href={`${prefix}/management?tab=applications`}><span className={styles.taskUrgency} data-level="urgent"><AlertCircle size={16} />需要处理</span><span><strong>{pendingJoins} 条加入申请</strong><small>审核申请并确认学生或教师身份</small></span><ArrowRight size={16} /></Link>}
          {dashboardTasks.map(item => <Link className={styles.taskItem} href={item.href} key={item.id}><span className={styles.taskUrgency} data-level={['OVERDUE', 'REVIEWING', 'ONGOING'].includes(item.status) ? 'urgent' : 'normal'}>{item.type === 'assignment' ? <ClipboardList size={16} /> : <Trophy size={16} />}{item.actionLabel}</span><span><strong>{item.title}</strong><small><CalendarClock size={13} /> {item.detail}</small></span><ArrowRight size={16} /></Link>)}
          {!pendingJoins && !dashboardTasks.length && <p className={styles.inboxEmpty}>当前没有必须处理的事项，可以查看教学数据或准备下一项任务。</p>}
        </div>
      </section>
      <div className={styles.metricGrid}>
        <div className={styles.metric}><p className={styles.metricLabel}>负责团队</p><p className={styles.metricValue}>{teamTotal ?? '—'}</p><p className={styles.metricHint}>当前学校中可管理的团队总数</p></div>
        <div className={styles.metric}><p className={styles.metricLabel}>团队成员</p><p className={styles.metricValue}>{memberCount ?? '—'}</p><p className={styles.metricHint}>以上团队的成员关系总数</p></div>
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
