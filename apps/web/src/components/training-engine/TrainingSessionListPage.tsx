'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'
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
type Session = { id: string; title: string; description?: string; status: string; sessionType: string; canJoin?: boolean; _count: { Stages: number; Participants: number } }
type Team = { id: string; name: string; owner?: { id?: string }; members?: Array<{ userId: string; role: string }> }
type TeamPayload = Team[] | { items?: Team[]; data?: Team[] }

const statusVariant = (status: string) => status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : status === 'ENDED' || status === 'ARCHIVED' ? 'neutral' : 'info'
const normalizeTeams = (payload?: TeamPayload) => Array.isArray(payload) ? payload : payload?.items || payload?.data || []

export function TrainingSessionListPage({ organizationId, teamId }: { organizationId?: string; teamId?: string }) {
  const router = useRouter(), toast = useToast(), { user } = useAuth()
  const [sessions, setSessions] = useState<Session[]>([]), [templates, setTemplates] = useState<Template[]>([]), [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true), [creating, setCreating] = useState(false), [open, setOpen] = useState(false)
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [templateKey, setTemplateKey] = useState('oi-standard'), [scheduledStartAt, setScheduledStartAt] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState(teamId || '')
  const [rankingMode, setRankingMode] = useState('PROGRESS_ONLY'), [peerVisibility, setPeerVisibility] = useState('PROGRESS'), [joinMode, setJoinMode] = useState('CURRENT_STAGE')
  const [allowHints, setAllowHints] = useState(true), [allowSolution, setAllowSolution] = useState(false), [allowDiscussion, setAllowDiscussion] = useState(false)
  const scopeQuery = organizationId ? `organizationId=${encodeURIComponent(organizationId)}` : teamId ? `teamId=${encodeURIComponent(teamId)}` : ''

  const load = useCallback(async () => {
    setLoading(true)
    const [list, templateResult, teamResult] = await Promise.all([
      apiClient.get<Session[]>(`/api/training-sessions${scopeQuery ? `?${scopeQuery}` : ''}`),
      apiClient.get<Template[]>('/api/training-session-templates'),
      organizationId || teamId ? Promise.resolve({ success: true, data: [] as Team[], status: 200 }) : apiClient.get<TeamPayload>('/api/teams?view=mine&pageSize=100'),
    ])
    if (list.success) setSessions(list.data || []); else toast.error(list.message || '训练列表加载失败')
    if (templateResult.success) setTemplates(templateResult.data || [])
    if (teamResult.success) {
      const manageable = normalizeTeams(teamResult.data).filter(team => team.owner?.id === user?.userId || team.members?.some(member => member.userId === user?.userId && ['owner', 'admin'].includes(member.role)))
      setTeams(manageable)
      setSelectedTeamId(current => current || manageable[0]?.id || '')
    }
    setLoading(false)
  }, [organizationId, scopeQuery, teamId, toast, user?.userId])
  useEffect(() => { void load() }, [load])

  const chosenTemplate = useMemo(() => templates.find(item => item.key === templateKey), [templateKey, templates])
  const targetTeamId = teamId || selectedTeamId
  const create = async () => {
    if (!title.trim() || !chosenTemplate || (!organizationId && !targetTeamId)) return
    setCreating(true)
    const stages = chosenTemplate.stages.map(stage => ({ ...stage, problems: [] }))
    const response = await apiClient.post<Session>('/api/training-sessions', { title, description, templateKey, sessionType: chosenTemplate.sessionType, organizationId, teamId: organizationId ? undefined : targetTeamId, scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : null, rankingMode, peerVisibility, joinMode, allowHints, allowSolution, allowDiscussion, stages })
    setCreating(false)
    if (!response.success || !response.data) return toast.error(response.message || '创建训练失败')
    toast.success('训练草稿已创建，请继续编排阶段与题目')
    setOpen(false)
    router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${response.data.id}/design`)
  }
  const canCreate = Boolean(organizationId || teamId || teams.length)
  const openSession = async (item: Session) => {
    if (item.canJoin) {
      const joined = await apiClient.post(`/api/training-sessions/${item.id}/join`, {})
      if (!joined.success) return toast.error(joined.message || '加入训练失败')
    }
    const suffix = item.status === 'DRAFT' ? '/design' : ''
    router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${item.id}${suffix}`)
  }

  return <PageFrame width="workbench"><div className={styles.stack}>
    <PageHeader title="教练训练" description="先编排阶段、题目顺序和解锁条件，发布后再进入运行工作台。" actions={canCreate ? <Button onClick={() => setOpen(true)}>创建并编排</Button> : undefined} />
    <Section title="训练场次" description={loading ? '正在准备训练列表…' : `共 ${sessions.length} 场`}>
      {!loading && !sessions.length ? <Empty title="暂无训练" description={canCreate ? '创建草稿后，使用独立设计器配置训练顺序。' : '你还没有可管理的团队训练。'} /> : <div className={styles.grid}>{sessions.map(item => <article className={styles.card} key={item.id}><div className={styles.actions}><StatusBadge variant={statusVariant(item.status)}>{item.status}</StatusBadge><StatusBadge variant="neutral">{item.sessionType}</StatusBadge></div><h3>{item.title}</h3><p className={styles.muted}>{item.description || '暂无说明'}</p><p>{item._count.Stages} 个阶段 · {item._count.Participants} 名学员</p><Button variant={item.status === 'DRAFT' ? 'primary' : item.canJoin ? 'primary' : 'secondary'} onClick={() => void openSession(item)}>{item.status === 'DRAFT' ? '继续编排' : item.canJoin ? '加入训练' : '进入运行工作台'}</Button></article>)}</div>}
    </Section>
    <FormDialog isOpen={open} onClose={() => setOpen(false)} title="创建训练草稿" description="模板只创建阶段骨架，不会把题目静默复制到各阶段。" size="lg" loading={creating} dirty={Boolean(title || description)} footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={creating}>取消</Button><Button onClick={() => void create()} loading={creating} disabled={!title.trim() || !chosenTemplate || (!organizationId && !targetTeamId)}>创建并编排</Button></>}>
      <div className={styles.stack}>
        {!organizationId && !teamId && <label className={styles.field}>团队范围<Select value={selectedTeamId} onChange={event => setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}
        <label className={styles.field}>训练名称<Input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
        <label className={styles.field}>训练说明<Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <label className={styles.field}>计划开始（可选）<Input type="datetime-local" value={scheduledStartAt} onChange={event => setScheduledStartAt(event.target.value)} /></label>
        <label className={styles.field}>训练模板<Select value={templateKey} onChange={event => setTemplateKey(event.target.value)}>{templates.map(item => <option value={item.key} key={item.key}>{item.name} · {item.description}</option>)}</Select><small>只导入阶段名称和推进方式，题目在下一步显式分配。</small></label>
        <div className={styles.grid}><label className={styles.field}>训练展示<Select value={rankingMode} onChange={event => setRankingMode(event.target.value)}><option value="OFF">不显示榜单</option><option value="PROGRESS_ONLY">只显示完成进度</option><option value="SCORE">显示训练分数</option><option value="ACM_RANKING">显示 ACM 排名</option></Select></label><label className={styles.field}>同学状态<Select value={peerVisibility} onChange={event => setPeerVisibility(event.target.value)}><option value="NONE">不可见</option><option value="PROGRESS">仅进度</option><option value="FULL">完整状态</option></Select></label><label className={styles.field}>迟到加入<Select value={joinMode} onChange={event => setJoinMode(event.target.value)}><option value="CURRENT_STAGE">当前阶段</option><option value="FROM_BEGINNING">从第一阶段开始</option><option value="TEACHER_ASSIGN">由教练分配</option></Select></label></div>
        <div className={styles.stack}><Checkbox label="允许提示" checked={allowHints} onChange={event => setAllowHints(event.target.checked)} /><Checkbox label="允许查看题解" checked={allowSolution} onChange={event => setAllowSolution(event.target.checked)} /><Checkbox label="允许讨论" checked={allowDiscussion} onChange={event => setAllowDiscussion(event.target.checked)} /></div>
      </div>
    </FormDialog>
  </div></PageFrame>
}
