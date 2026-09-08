'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/apiClient'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { StatusBadge } from '@/components/ui/Badge'
import { Empty } from '@/components/ui/Empty'
import { useToast } from '@/components/ui/Toast'
import styles from './TrainingEngine.module.css'

type Template = { key: string; name: string; description: string; sessionType: string; stages: Array<Record<string, unknown>> }
type Session = { id: string; title: string; description?: string; status: string; sessionType: string; scheduledStartAt?: string; canJoin?: boolean; _count: { Stages: number; Participants: number } }
type Problem = { id: string; platform: string; problemId: string; title: string }

const statusVariant = (status: string) => status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : status === 'ENDED' || status === 'ARCHIVED' ? 'neutral' : 'info'

export function TrainingSessionListPage({ organizationId, teamId }: { organizationId?: string; teamId?: string }) {
  const router = useRouter(), toast = useToast()
  const [sessions, setSessions] = useState<Session[]>([]), [templates, setTemplates] = useState<Template[]>([]), [problems, setProblems] = useState<Problem[]>([])
  const [loading, setLoading] = useState(true), [creating, setCreating] = useState(false), [open, setOpen] = useState(false)
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [templateKey, setTemplateKey] = useState('oi-standard'), [selected, setSelected] = useState<string[]>([]), [scheduledStartAt, setScheduledStartAt] = useState('')
  const [rankingMode, setRankingMode] = useState('PROGRESS_ONLY'), [peerVisibility, setPeerVisibility] = useState('PROGRESS'), [joinMode, setJoinMode] = useState('CURRENT_STAGE')
  const [allowHints, setAllowHints] = useState(true), [allowSolution, setAllowSolution] = useState(false), [allowDiscussion, setAllowDiscussion] = useState(false)
  const scopeQuery = organizationId ? `organizationId=${encodeURIComponent(organizationId)}` : teamId ? `teamId=${encodeURIComponent(teamId)}` : ''
  const load = useCallback(async () => {
    setLoading(true)
    const [list, templateResult, problemResult] = await Promise.all([
      apiClient.get<Session[]>(`/api/training-sessions${scopeQuery ? `?${scopeQuery}` : ''}`),
      apiClient.get<Template[]>('/api/training-session-templates'),
      apiClient.get<{ data: Problem[] }>('/api/problems?library=platform&sourceGroup=carits&pageSize=100'),
    ])
    if (list.success) setSessions(list.data || []); else toast.error(list.message || '训练列表加载失败')
    if (templateResult.success) setTemplates(templateResult.data || [])
    if (problemResult.success) setProblems(problemResult.data?.data || [])
    setLoading(false)
  }, [scopeQuery, toast])
  useEffect(() => { void load() }, [load])
  const chosenTemplate = useMemo(() => templates.find(item => item.key === templateKey), [templateKey, templates])
  const create = async () => {
    if (!title.trim() || !chosenTemplate || !selected.length) return
    setCreating(true)
    const stages = chosenTemplate.stages.map(stage => ({ ...stage, problems: ['TEACHING', 'REVIEW'].includes(String(stage.mode)) && stage.mode === 'TEACHING' ? [] : selected.map(problemId => ({ problemId })) }))
    const response = await apiClient.post<Session>('/api/training-sessions', { title, description, templateKey, sessionType: chosenTemplate.sessionType, organizationId, teamId, scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : null, rankingMode, peerVisibility, joinMode, allowHints, allowSolution, allowDiscussion, stages })
    setCreating(false)
    if (!response.success || !response.data) return toast.error(response.message || '创建训练失败')
    toast.success('训练草稿已创建'); setOpen(false); router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${response.data.id}`)
  }
  const canCreate = Boolean(organizationId || teamId)
  const openSession = async (item: Session) => {
    if (item.canJoin) {
      const joined = await apiClient.post(`/api/training-sessions/${item.id}/join`, {})
      if (!joined.success) return toast.error(joined.message || '加入训练失败')
    }
    router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${item.id}`)
  }
  return <PageFrame width="workbench"><div className={styles.stack}>
    <PageHeader title="教练训练" description="训练与比赛相互独立：按阶段控制题目、提交、提示和课堂节奏。" actions={canCreate ? <Button onClick={() => setOpen(true)}>创建训练</Button> : undefined} />
    <Section title="训练场次" description={loading ? '正在准备训练列表…' : `共 ${sessions.length} 场`}>
      {!loading && !sessions.length ? <Empty title="暂无训练" description={canCreate ? '创建一场训练并配置阶段与题目。' : '加入学校或团队训练后会显示在这里。'} /> : <div className={styles.grid}>{sessions.map(item => <article className={styles.card} key={item.id}><div className={styles.actions}><StatusBadge variant={statusVariant(item.status)}>{item.status}</StatusBadge><StatusBadge variant="neutral">{item.sessionType}</StatusBadge></div><h3>{item.title}</h3><p className={styles.muted}>{item.description || '暂无说明'}</p><p>{item._count.Stages} 个阶段 · {item._count.Participants} 名学员</p><Button variant={item.canJoin ? 'primary' : 'secondary'} onClick={() => void openSession(item)}>{item.canJoin ? '加入训练' : '进入训练'}</Button></article>)}</div>}
    </Section>
    <FormDialog isOpen={open} onClose={() => setOpen(false)} title="创建教练训练" description="选择模板后，题目会固定当前 TestSet Revision。" size="xl" loading={creating} dirty={Boolean(title || selected.length)} footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={creating}>取消</Button><Button onClick={() => void create()} loading={creating} disabled={!title.trim() || !selected.length}>创建草稿</Button></>}>
      <div className={styles.stack}><label className={styles.field}>训练名称<Input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label><label className={styles.field}>训练说明<Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label><label className={styles.field}>计划开始（可选）<Input type="datetime-local" value={scheduledStartAt} onChange={event => setScheduledStartAt(event.target.value)} /></label><label className={styles.field}>训练模板<Select value={templateKey} onChange={event => setTemplateKey(event.target.value)}>{templates.map(item => <option value={item.key} key={item.key}>{item.name} · {item.description}</option>)}</Select></label><div className={styles.grid}><label className={styles.field}>训练展示<Select value={rankingMode} onChange={event => setRankingMode(event.target.value)}><option value="OFF">不显示榜单</option><option value="PROGRESS_ONLY">只显示完成进度</option><option value="SCORE">显示训练分数</option><option value="ACM_RANKING">ACM 完成数与提交次数</option></Select></label><label className={styles.field}>同学状态可见性<Select value={peerVisibility} onChange={event => setPeerVisibility(event.target.value)}><option value="NONE">互不可见</option><option value="PROGRESS">仅完成进度</option><option value="SCORE">进度与分数</option><option value="FULL">完整训练状态</option></Select></label><label className={styles.field}>迟到学员<Select value={joinMode} onChange={event => setJoinMode(event.target.value)}><option value="CURRENT_STAGE">进入当前阶段</option><option value="FROM_BEGINNING">从第一阶段开始</option><option value="TEACHER_ASSIGN">等待教练分配</option></Select></label></div><div className={styles.grid}><Checkbox label="允许使用提示" checked={allowHints} onChange={event => setAllowHints(event.target.checked)} /><Checkbox label="允许查看开放题解" checked={allowSolution} onChange={event => setAllowSolution(event.target.checked)} /><Checkbox label="允许课堂讨论" checked={allowDiscussion} onChange={event => setAllowDiscussion(event.target.checked)} /></div><div className={styles.field}>选择题目<small>同一批题目按模板进入训练阶段；发布后结构冻结。</small><div className={styles.problemPicker}>{problems.map(problem => <Checkbox key={problem.id} label={`${problem.problemId} ${problem.title}`} description={problem.platform} checked={selected.includes(problem.id)} onChange={event => setSelected(current => event.target.checked ? [...current, problem.id] : current.filter(id => id !== problem.id))} />)}</div></div></div>
    </FormDialog>
  </div></PageFrame>
}
