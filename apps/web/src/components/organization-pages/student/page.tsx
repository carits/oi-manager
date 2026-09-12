'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { ArrowRight, BookOpenCheck, ClipboardList, ListChecks, Trophy, UsersRound } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import { LoadError } from '@/components/ui/LoadError'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import styles from '@/components/Dashboard.module.css'
import { currentWorkspacePrefix, isPersonalPath } from '@/lib/workspacePath'
import { compareDashboardTasks, type LearningTask } from '@/lib/dashboardTasks'

interface TaskItem { id: string; title: string; openAt: string; dueAt: string; closeAt: string; status: string; problemCount: number }
interface AssignmentPayload { items: TaskItem[]; pagination: { total: number }; statusCounts?: Record<string, number> }
interface SubmissionItem { id: number; problemId: string; result: string; submittedAt: string }
interface SubmissionPayload { submissions?: SubmissionItem[]; total?: number }
interface TrainingItem { id: string; title: string; status: string; scheduledStartAt?: string | null; dueAt?: string | null; problemCount?: number }
interface ContestItem { id: number; title: string; startTime: string; endTime: string; problemCount: number }

function taskStatus(task: TaskItem) {
  if (task.status === 'SCHEDULED') return { label: '即将开始', variant: 'info' as const }
  if (['OPEN', 'OVERDUE'].includes(task.status)) return { label: task.status === 'OVERDUE' ? '迟交期' : '进行中', variant: task.status === 'OVERDUE' ? 'warning' as const : 'success' as const }
  return { label: '已结束', variant: 'neutral' as const }
}

function deadline(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function StudentPage() {
  const { user, sessionKey } = useAuth()
  const pathname = usePathname()
  const { organizationId } = useParams<{ organizationId?: string }>()
  const pathPrefix = currentWorkspacePrefix(pathname, '/personal')
  const homeworkResource = useResource<AssignmentPayload>(organizationId ? `/api/assignments?organizationId=${organizationId}&pageSize=100` : null, { sessionKey, dedupingInterval: 30000 })
  const trainingResource = useResource<TrainingItem[]>(organizationId ? `/api/training-sessions?organizationId=${organizationId}` : null, { sessionKey, dedupingInterval: 30000 })
  const contestResource = useResource<ContestItem[]>(organizationId ? `/api/organizations/${organizationId}/members/activities/contests` : null, { sessionKey, dedupingInterval: 30000 })
  const submissionResource = useResource<SubmissionPayload>('/api/submissions?page=1&pageSize=5', { sessionKey, isEmpty: data => (data.submissions || []).length === 0, dedupingInterval: 15000 })
  const homeworks = homeworkResource.data?.items || []
  const activeCount = homeworkResource.data?.statusCounts?.OPEN ?? homeworks.filter(task => taskStatus(task).label === '进行中').length
  const personalMode = isPersonalPath(pathname)
  const now = Date.now()
  const assignmentTasks: LearningTask[] = homeworks.filter(task => taskStatus(task).label !== '已结束').map(task => ({
    id: `assignment-${task.id}`, type: 'assignment', title: task.title, status: task.status,
    href: `${pathPrefix}/homeworks/${task.id}`, actionLabel: task.status === 'SCHEDULED' ? '作业即将开始' : task.status === 'OVERDUE' ? '作业迟交期' : '继续作业',
    actionAt: task.openAt, dueAt: task.dueAt, problemCount: task.problemCount, detail: `${task.problemCount} 道题 · 截止 ${deadline(task.dueAt)}`,
  }))
  const trainingTasks: LearningTask[] = (trainingResource.data || []).filter(item => ['SCHEDULED', 'RUNNING', 'PAUSED'].includes(item.status)).map(item => ({
    id: `training-${item.id}`, type: 'training', title: item.title, status: item.status,
    href: `${pathPrefix}/training-sessions/${item.id}`, actionLabel: item.status === 'SCHEDULED' ? '训练即将开始' : '继续训练',
    actionAt: item.scheduledStartAt, dueAt: item.dueAt, problemCount: item.problemCount,
    detail: item.status === 'SCHEDULED' ? `${item.problemCount || 0} 道题 · ${item.scheduledStartAt ? deadline(item.scheduledStartAt) + ' 开始' : '等待老师开始'}` : `${item.problemCount || 0} 道题 · 训练进行中`,
  }))
  const contestTasks: LearningTask[] = (contestResource.data || []).filter(item => new Date(item.endTime).getTime() >= now).map(item => ({
    id: `contest-${item.id}`, type: 'contest', title: item.title, status: new Date(item.startTime).getTime() <= now ? 'ONGOING' : 'SCHEDULED',
    href: `${pathPrefix}/contests/${item.id}`, actionLabel: new Date(item.startTime).getTime() <= now ? '进入比赛' : '比赛即将开始',
    actionAt: item.startTime, dueAt: item.endTime, problemCount: item.problemCount,
    detail: `${item.problemCount} 道题 · ${deadline(item.startTime)} 开始`,
  }))
  const pendingTasks = [...assignmentTasks, ...trainingTasks, ...contestTasks].sort((a, b) => compareDashboardTasks(a, b, now))
  const displayedTasks = pendingTasks.slice(0, 5)
  const learningResources = [homeworkResource, trainingResource, contestResource]
  const learningPending = learningResources.every(resource => resource.state.state === 'pending')
  const learningAllFailed = learningResources.every(resource => resource.state.state === 'error')
  const learningPartiallyFailed = !learningAllFailed && learningResources.some(resource => resource.state.state === 'error')
  const retryLearningFeed = () => { void homeworkResource.retry(); void trainingResource.retry(); void contestResource.retry() }
  const assignmentPendingCount = homeworkResource.data?.statusCounts
    ? ['SCHEDULED', 'OPEN', 'OVERDUE'].reduce((sum, status) => sum + (homeworkResource.data?.statusCounts?.[status] || 0), 0)
    : assignmentTasks.length
  const pendingTaskCount = assignmentPendingCount + trainingTasks.length + contestTasks.length
  const pendingTaskCountDisplay = (trainingResource.data?.length || 0) >= 100 ? `${pendingTaskCount}+` : pendingTaskCount

  return (
      <PageFrame>
      <PageHeader title={`你好，${user?.username || '同学'}`} description={personalMode ? '个人空间中的题目、团队和提交相互独立。' : '查看当前学校的近期学习任务。'} />

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>现在最需要完成</h2></div>
        {displayedTasks[0] ? <Link className={styles.taskItem} href={displayedTasks[0].href}><span className={styles.taskUrgency} data-level="urgent">{displayedTasks[0].type === 'assignment' ? <ClipboardList size={16} /> : displayedTasks[0].type === 'contest' ? <Trophy size={16} /> : <ListChecks size={16} />}优先任务</span><span><strong>{displayedTasks[0].title}</strong><small>{displayedTasks[0].detail}</small></span><ArrowRight size={16} /></Link> : <p className={styles.inboxEmpty}>当前没有待完成的作业、训练或比赛，可以继续题单或自主练习。</p>}
      </section>

      <div className={styles.metricGrid}>
        <div className={styles.metric}><p className={styles.metricLabel}>进行中的作业</p><p className={styles.metricValue}>{activeCount}</p><p className={styles.metricHint}>优先处理临近截止的任务</p></div>
        <div className={styles.metric}><p className={styles.metricLabel}>待完成任务</p><p className={styles.metricValue}>{pendingTaskCountDisplay}</p><p className={styles.metricHint}>包含作业、训练和比赛</p></div>
        <div className={styles.metric}><p className={styles.metricLabel}>提交总数</p><p className={styles.metricValue}>{submissionResource.data?.total ?? '—'}</p><p className={styles.metricHint}>当前范围内的全部评测记录</p></div>
      </div>

      <div className={styles.dashboardGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>近期学习安排</h2><span className={styles.sectionHint}><Link href={pathPrefix + '/homeworks'}>作业</Link> · <Link href={pathPrefix + '/training-sessions'}>训练</Link> · <Link href={pathPrefix + '/contests'}>比赛</Link></span></div>
          {learningPending ? <SkeletonRegion rows={4} /> : learningAllFailed ? <LoadError message="学习安排暂时无法加载" onRetry={retryLearningFeed} /> : <>
            {learningPartiallyFailed && <LoadError compact message="部分学习任务暂时无法加载" onRetry={retryLearningFeed} />}
            {displayedTasks.length > 0 ? (
              <div className={styles.list}>
                {displayedTasks.map(task => {
                  const label = task.type === 'assignment' ? taskStatus(homeworks.find(item => `assignment-${item.id}` === task.id)!).label : task.actionLabel
                  const variant = task.status === 'ONGOING' || task.status === 'RUNNING' ? 'success' as const : task.status === 'OVERDUE' ? 'warning' as const : 'info' as const
                  return <Link className={styles.listItem} key={task.id} href={task.href}><span className={styles.listMain}><span className={styles.listTitle}>{task.title}</span><span className={styles.listMeta}><span>{task.type === 'assignment' ? '作业' : task.type === 'training' ? '训练' : '比赛'}</span><span>{task.detail}</span></span></span><span className={styles.listEnd}><StatusBadge variant={variant}>{label}</StatusBadge><ArrowRight size={16} aria-hidden="true" /></span></Link>
                })}
              </div>
            ) : <div className={styles.inlineEmpty}>当前没有待处理任务</div>}
          </>}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>常用入口</h2></div>
          <div className={styles.actionList}>
            <Link className={styles.actionLink} href={pathPrefix + '/teams'}><span className={styles.actionIcon}><UsersRound size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>我的团队</span><span className={styles.actionHint}>查看团队训练与成员</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href={pathPrefix + '/problem-lists'}><span className={styles.actionIcon}><ListChecks size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>题单</span><span className={styles.actionHint}>继续上次的练习</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href={pathPrefix + '/submissions'}><span className={styles.actionIcon}><BookOpenCheck size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>评测记录</span><span className={styles.actionHint}>检查提交结果与代码</span></span><ArrowRight size={16} /></Link>
            {!personalMode && <Link className={styles.actionLink} href={pathPrefix + '/homeworks'}><span className={styles.actionIcon}><ClipboardList size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>全部作业</span><span className={styles.actionHint}>按状态浏览学校任务</span></span><ArrowRight size={16} /></Link>}
          </div>
        </section>
      </div>
    </PageFrame>
  )
}
