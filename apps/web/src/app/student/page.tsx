'use client'

import Link from 'next/link'
import { ArrowRight, BookOpenCheck, ClipboardList, ListChecks, UsersRound } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import styles from '@/components/Dashboard.module.css'

interface TaskItem { id: number; title: string; startTime: string; endTime: string; problemCount: number }
interface SubmissionItem { id: number; problemId: string; result: string; submittedAt: string }
interface SubmissionPayload { submissions?: SubmissionItem[]; total?: number }

function taskStatus(task: TaskItem) {
  const now = Date.now()
  if (now < new Date(task.startTime).getTime()) return { label: '即将开始', variant: 'info' as const }
  if (now <= new Date(task.endTime).getTime()) return { label: '进行中', variant: 'success' as const }
  return { label: '已结束', variant: 'neutral' as const }
}

function deadline(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function StudentPage() {
  const { user, sessionKey } = useAuth()
  const homeworkResource = useResource<TaskItem[]>('/api/students/my-homeworks', { sessionKey, dedupingInterval: 30000 })
  const submissionResource = useResource<SubmissionPayload>('/api/submissions?page=1&pageSize=5', { sessionKey, isEmpty: data => (data.submissions || []).length === 0, dedupingInterval: 15000 })
  const homeworks = homeworkResource.data || []
  const activeCount = homeworks.filter(task => taskStatus(task).label === '进行中').length
  const nextTasks = [...homeworks].filter(task => taskStatus(task).label !== '已结束').sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime()).slice(0, 5)
  const personalMode = user?.workspaceMode === 'personal'

  return (
    <PageFrame>
      <PageHeader title={`你好，${user?.username || '同学'}`} description={personalMode ? '个人空间中的题目、团队和提交相互独立。' : `查看${user?.schoolName ? `${user.schoolName}的` : ''}近期学习任务。`} />

      <div className={styles.metricGrid}>
        <div className={styles.metric}><p className={styles.metricLabel}>进行中的作业</p><p className={styles.metricValue}>{activeCount}</p><p className={styles.metricHint}>优先处理临近截止的任务</p></div>
        <div className={styles.metric}><p className={styles.metricLabel}>待完成任务</p><p className={styles.metricValue}>{nextTasks.length}</p><p className={styles.metricHint}>包含即将开始的作业</p></div>
        <div className={styles.metric}><p className={styles.metricLabel}>最近提交</p><p className={styles.metricValue}>{submissionResource.data?.total ?? '—'}</p><p className={styles.metricHint}>当前模式下的评测记录</p></div>
      </div>

      <div className={styles.dashboardGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>近期任务</h2><Link className={styles.sectionLink} href="/student/homeworks">查看全部<ArrowRight size={14} /></Link></div>
          <AsyncRegion state={homeworkResource.state} onRetry={homeworkResource.retry} emptyText="当前没有作业" skeletonRows={4}>
            {() => nextTasks.length > 0 ? (
              <div className={styles.list}>
                {nextTasks.map(task => {
                  const status = taskStatus(task)
                  return <Link className={styles.listItem} key={task.id} href={`/student/homeworks/${task.id}`}><span className={styles.listMain}><span className={styles.listTitle}>{task.title}</span><span className={styles.listMeta}><span>{task.problemCount} 题</span><span>截止 {deadline(task.endTime)}</span></span></span><span className={styles.listEnd}><StatusBadge variant={status.variant}>{status.label}</StatusBadge><ArrowRight size={16} aria-hidden="true" /></span></Link>
                })}
              </div>
            ) : <div className={styles.inlineEmpty}>当前没有待处理任务</div>}
          </AsyncRegion>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>常用入口</h2></div>
          <div className={styles.actionList}>
            <Link className={styles.actionLink} href="/student/team"><span className={styles.actionIcon}><UsersRound size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>我的团队</span><span className={styles.actionHint}>查看团队训练与成员</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href="/student/problem-lists"><span className={styles.actionIcon}><ListChecks size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>题单</span><span className={styles.actionHint}>继续上次的练习</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href="/student/submissions"><span className={styles.actionIcon}><BookOpenCheck size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>评测记录</span><span className={styles.actionHint}>检查提交结果与代码</span></span><ArrowRight size={16} /></Link>
            {!personalMode && <Link className={styles.actionLink} href="/student/homeworks"><span className={styles.actionIcon}><ClipboardList size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>全部作业</span><span className={styles.actionHint}>按状态浏览学校任务</span></span><ArrowRight size={16} /></Link>}
          </div>
        </section>
      </div>
    </PageFrame>
  )
}
