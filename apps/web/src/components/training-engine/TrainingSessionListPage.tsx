'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { Tabs } from '@/components/ui/Tabs'
import { StatusBadge } from '@/components/ui/Badge'
import { Empty } from '@/components/ui/Empty'
import { useToast } from '@/components/ui/Toast'
import styles from './TrainingEngine.module.css'
import { trainingSessionTypeLabel, trainingStatusLabel } from '@/lib/humanPresentation'

type Template = { key: string; name: string; description: string; sessionType: string; stages: Array<Record<string, unknown>> }
type Session = { id: string; title: string; description?: string; status: string; sessionType: string; productMode?: 'simple' | 'coach'; problemCount?: number; dueAt?: string | null; statusRevision?: number; canJoin?: boolean; teamId?: string | null; teamName?: string | null; _count: { Stages: number; Participants: number } }
type Team = { id: string; name: string; owner?: { id?: string }; members?: Array<{ userId: string; role: string }> }
type TeamPayload = Team[] | { items?: Team[]; data?: Team[] }
type Problem = { id: string; platform: string; problemId: string; title: string; difficulty?: string }
type ProblemPage = { data: Problem[]; total: number }
type Student = { userId: string; name: string; user?: { username?: string } }
type StudentPage = { items?: Student[]; data?: Student[] }
type CreateMode = 'simple' | 'coach'
type ParticipantTarget = 'team' | 'organization_students' | 'custom_students'
type ListFilter = 'active' | 'upcoming' | 'completed' | 'draft'

const statusVariant = (status: string) => status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : status === 'ENDED' || status === 'ARCHIVED' ? 'neutral' : 'info'
const normalizeTeams = (payload?: TeamPayload) => Array.isArray(payload) ? payload : payload?.items || payload?.data || []
const localDateTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

export function TrainingSessionListPage({ organizationId, teamId }: { organizationId?: string; teamId?: string }) {
  const router = useRouter(), searchParams = useSearchParams(), toast = useToast(), { user } = useAuth()
  const canViewTrainingManagement = Boolean(organizationId && (user?.organizationRole === 'teacher' || user?.organizationRole === 'school_principal'))
  const [sessions, setSessions] = useState<Session[]>([]), [templates, setTemplates] = useState<Template[]>([]), [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true), [creating, setCreating] = useState(false), [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CreateMode>('simple'), [simpleStep, setSimpleStep] = useState(0)
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [templateKey, setTemplateKey] = useState('oi-standard')
  const [scheduledStartAt, setScheduledStartAt] = useState(() => localDateTime(new Date())), [dueAt, setDueAt] = useState(() => localDateTime(new Date(Date.now() + 7 * 24 * 3600_000)))
  const [selectedTeamId, setSelectedTeamId] = useState(teamId || '')
  const [participantTarget, setParticipantTarget] = useState<ParticipantTarget>(organizationId ? 'team' : 'team')
  const [students, setStudents] = useState<Student[]>([]), [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]), [studentsLoading, setStudentsLoading] = useState(false)
  const [rankingMode, setRankingMode] = useState('PROGRESS_ONLY'), [peerVisibility, setPeerVisibility] = useState('PROGRESS'), [joinMode, setJoinMode] = useState('CURRENT_STAGE')
  const [allowHints, setAllowHints] = useState(true), [allowSolution, setAllowSolution] = useState(false), [allowDiscussion, setAllowDiscussion] = useState(false)
  const [completionMode, setCompletionMode] = useState<'all' | 'count'>('all'), [requiredCount, setRequiredCount] = useState(1)
  const [problemQuery, setProblemQuery] = useState(''), [problemSource, setProblemSource] = useState<'carits' | 'external' | 'school'>('carits')
  const [problemPool, setProblemPool] = useState<Problem[]>([]), [poolLoading, setPoolLoading] = useState(false), [selectedProblems, setSelectedProblems] = useState<Problem[]>([])
  const [listFilter, setListFilter] = useState<ListFilter>('active'), [listQuery, setListQuery] = useState(''), [listTeamId, setListTeamId] = useState(() => teamId || searchParams.get('teamId') || '')
  const scopeQuery = organizationId ? `organizationId=${encodeURIComponent(organizationId)}` : teamId ? `teamId=${encodeURIComponent(teamId)}` : ''

  const load = useCallback(async () => {
    setLoading(true)
    const [list, templateResult, teamResult] = await Promise.all([
      apiClient.get<Session[]>(`/api/training-sessions${scopeQuery ? `?${scopeQuery}` : ''}`),
      apiClient.get<Template[]>('/api/training-session-templates'),
      teamId ? Promise.resolve({ success: true, data: [] as Team[], status: 200 })
        : organizationId && canViewTrainingManagement
          ? apiClient.get<TeamPayload>(`/api/teams?organizationId=${encodeURIComponent(organizationId)}&pageSize=100`)
          : organizationId
            ? Promise.resolve({ success: true, data: [] as Team[], status: 200 })
            : apiClient.get<TeamPayload>('/api/teams?view=mine&pageSize=100'),
    ])
    if (list.success) setSessions(list.data || []); else toast.error(list.message || '训练列表加载失败')
    if (templateResult.success) setTemplates(templateResult.data || [])
    if (teamResult.success) {
      const manageable = normalizeTeams(teamResult.data).filter(team => team.owner?.id === user?.userId || team.members?.some(member => member.userId === user?.userId && ['owner', 'admin'].includes(member.role)))
      setTeams(manageable); setSelectedTeamId(current => current || manageable[0]?.id || '')
    }
    setLoading(false)
  }, [canViewTrainingManagement, organizationId, scopeQuery, teamId, toast, user?.userId])
  useEffect(() => { void load() }, [load])

  const loadProblems = useCallback(async () => {
    if (!open || mode !== 'simple' || simpleStep !== 1) return
    setPoolLoading(true)
    const params = new URLSearchParams({ page: '1', pageSize: '30' })
    if (problemQuery.trim()) params.set('keyword', problemQuery.trim())
    if (problemSource === 'school') params.set('library', 'school')
    else { params.set('library', 'platform'); params.set('sourceGroup', problemSource) }
    const response = await apiClient.get<ProblemPage>(`/api/problems?${params}`)
    setProblemPool(response.success ? response.data?.data || [] : []); setPoolLoading(false)
  }, [mode, open, problemQuery, problemSource, simpleStep])
  useEffect(() => { const timer = window.setTimeout(() => void loadProblems(), 250); return () => window.clearTimeout(timer) }, [loadProblems])

  useEffect(() => {
    if (!open || participantTarget !== 'custom_students' || !organizationId || (mode === 'simple' && simpleStep !== 2)) return
    setStudentsLoading(true)
    void apiClient.get<StudentPage>(`/api/organizations/${organizationId}/members/students?pageSize=500`).then(response => {
      setStudents(response.success ? response.data?.items || response.data?.data || [] : [])
      setStudentsLoading(false)
    })
  }, [mode, open, organizationId, participantTarget, simpleStep])

  const chosenTemplate = useMemo(() => templates.find(item => item.key === templateKey), [templateKey, templates])
  const targetTeamId = teamId || selectedTeamId
  const useTeamScope = !organizationId || participantTarget === 'team'
  const scopeReady = useTeamScope ? Boolean(targetTeamId) : participantTarget === 'custom_students' ? selectedStudentIds.length > 0 : user?.organizationRole === 'school_principal'
  const simpleValid = [Boolean(title.trim() && dueAt), selectedProblems.length > 0, scopeReady, true][simpleStep]
  const resetDialog = () => {
    setSimpleStep(0); setTitle(''); setDescription(''); setSelectedProblems([]); setProblemQuery(''); setCompletionMode('all'); setRequiredCount(1); setSelectedStudentIds([]); setParticipantTarget('team')
    setScheduledStartAt(localDateTime(new Date())); setDueAt(localDateTime(new Date(Date.now() + 7 * 24 * 3600_000)))
  }
  const closeDialog = () => { if (!creating) { setOpen(false); resetDialog() } }

  const createCoachDraft = async () => {
    if (!title.trim() || !chosenTemplate || !scopeReady) return
    setCreating(true)
    const stages = chosenTemplate.stages.map(stage => ({ ...stage, problems: [] }))
    const response = await apiClient.post<Session>('/api/training-sessions', { title, description, templateKey, sessionType: chosenTemplate.sessionType, organizationId: useTeamScope ? undefined : organizationId, teamId: useTeamScope ? targetTeamId : undefined, participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined, scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : null, rankingMode, peerVisibility, joinMode, allowHints, allowSolution, allowDiscussion, settings: { productMode: 'coach', participantTarget }, stages })
    setCreating(false)
    if (!response.success || !response.data) return toast.error(response.message || '创建训练失败')
    toast.success('训练草稿已创建，请继续编排阶段与题目'); setOpen(false)
    router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${response.data.id}/design`)
  }

  const createSimpleTraining = async () => {
    if (!title.trim() || !dueAt || !selectedProblems.length || !scopeReady) return
    const count = completionMode === 'all' ? selectedProblems.length : Math.min(Math.max(1, requiredCount), selectedProblems.length)
    setCreating(true)
    const response = await apiClient.post<Session>('/api/training-sessions', {
      title, description, organizationId: useTeamScope ? undefined : organizationId, teamId: useTeamScope ? targetTeamId : undefined,
      scheduledStartAt: new Date(scheduledStartAt || Date.now()).toISOString(), rankingMode: 'PROGRESS_ONLY', peerVisibility: 'PROGRESS', joinMode: 'CURRENT_STAGE',
      allowHints: true, allowSolution: false, allowDiscussion: false,
      participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined,
      settings: { productMode: 'simple', dueAt: new Date(dueAt).toISOString(), completionMode, requiredProblemCount: count, participantTarget },
      stages: [{ name: '训练任务', mode: 'FREE', advanceMode: 'MANUAL', problemAccessMode: 'ALL', submissionMode: 'ENABLED', rules: completionMode === 'count' ? { requiredProblemCount: count } : {}, problems: selectedProblems.map(problem => ({ problemId: problem.id })) }],
    })
    if (!response.success || !response.data) { setCreating(false); return toast.error(response.message || '创建训练失败') }
    const published = await apiClient.post<Session>(`/api/training-sessions/${response.data.id}/publish`, { expectedRevision: response.data.statusRevision ?? 0 })
    setCreating(false)
    if (!published.success) {
      toast.error(`训练草稿已保存，但发布检查未通过：${published.message || '请继续完善'}`); setOpen(false)
      return router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${response.data.id}/design`)
    }
    toast.success('训练已创建并发布'); closeDialog(); await load()
  }

  const canCreateTraining = canViewTrainingManagement || Boolean(!organizationId && (teamId || teams.length))
  const managerView = canViewTrainingManagement || Boolean(!organizationId && (teamId || teams.length))
  useEffect(() => { if (!managerView && listFilter === 'draft') setListFilter('active') }, [listFilter, managerView])
  const statusMatches = (status: string) => listFilter === 'active'
    ? status === 'RUNNING' || status === 'PAUSED'
    : listFilter === 'upcoming'
      ? status === 'SCHEDULED'
      : listFilter === 'draft'
        ? status === 'DRAFT'
        : status === 'ENDED' || status === 'ARCHIVED'
  const countFor = (filter: ListFilter) => sessions.filter(item => filter === 'active'
    ? item.status === 'RUNNING' || item.status === 'PAUSED'
    : filter === 'upcoming'
      ? item.status === 'SCHEDULED'
      : filter === 'draft'
        ? item.status === 'DRAFT'
        : item.status === 'ENDED' || item.status === 'ARCHIVED').length
  const visibleSessions = sessions.filter(item => statusMatches(item.status)
    && (!listQuery.trim() || `${item.title} ${item.description || ''}`.toLocaleLowerCase().includes(listQuery.trim().toLocaleLowerCase()))
    && (!listTeamId || (listTeamId === 'organization' ? !item.teamId : item.teamId === listTeamId)))
  const filterItems = managerView
    ? [
        { value: 'active', label: '进行中', count: countFor('active') },
        { value: 'draft', label: '草稿', count: countFor('draft') },
        { value: 'upcoming', label: '即将开始', count: countFor('upcoming') },
        { value: 'completed', label: '已结束', count: countFor('completed') },
      ]
    : [
        { value: 'active', label: '进行中', count: countFor('active') },
        { value: 'upcoming', label: '即将开始', count: countFor('upcoming') },
        { value: 'completed', label: '已完成', count: countFor('completed') },
      ]
  const emptyCopy = managerView
    ? listFilter === 'draft' ? ['没有训练草稿', '新建训练后，未发布的内容会保存在这里。']
      : listFilter === 'active' ? ['没有进行中的训练', '创建一组题目给学生练习，通常几分钟即可完成设置。']
        : listFilter === 'upcoming' ? ['没有即将开始的训练', '设置未来的开始时间后，训练会出现在这里。']
          : ['还没有已结束的训练', '训练结束后会保留在这里，方便查看记录。']
    : listFilter === 'active' ? ['暂无训练', '目前老师还没有给你安排需要完成的训练。新的训练发布后会显示在这里。']
      : listFilter === 'upcoming' ? ['暂无即将开始的训练', '老师安排的后续训练会显示在这里。']
        : ['暂无已完成训练', '完成过的训练会保留在这里，方便以后复习。']
  const openSession = async (item: Session) => {
    if (item.canJoin) { const joined = await apiClient.post(`/api/training-sessions/${item.id}/join`, {}); if (!joined.success) return toast.error(joined.message || '加入训练失败') }
    router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${item.id}${item.status === 'DRAFT' ? '/design' : ''}`)
  }
  const cardFacts = (item: Session) => {
    const people = `${item._count.Participants} 名学生`
    if (item.productMode !== 'simple') return `${item._count.Stages} 个阶段 · ${people}`
    const deadline = item.dueAt ? ` · 截止 ${new Date(item.dueAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''
    return `${item.problemCount || 0} 道题 · ${people}${deadline}`
  }

  const simpleSteps = ['基本信息', '选择题目', '学员范围', '检查并发布']
  return <PageFrame className={styles.trainingListFrame}><div className={styles.stack}>
    <PageHeader title="训练" description={managerView ? '布置和管理学生练习。' : '查看老师安排的训练并继续练习。'} actions={canCreateTraining ? <Button icon={<Plus size={17} />} onClick={() => setOpen(true)}>创建训练</Button> : undefined} />
    <div className={styles.listControls}>
      <Tabs label={managerView ? '训练状态' : '我的训练状态'} value={listFilter} onChange={value => setListFilter(value as ListFilter)} items={filterItems} />
      {managerView && <div className={styles.listFilters}>{teams.length > 0 && <Select aria-label="筛选团队" value={listTeamId} onChange={event => setListTeamId(event.target.value)}><option value="">全部训练范围</option>{organizationId && <option value="organization">校级训练</option>}{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select>}<Input aria-label="搜索训练" placeholder="搜索训练" value={listQuery} onChange={event => setListQuery(event.target.value)} /></div>}
    </div>
    <Section title={managerView ? '训练列表' : '我的训练'} description={loading ? '正在准备训练列表…' : visibleSessions.length ? `共 ${visibleSessions.length} 个` : undefined}>
      {loading ? <p className={styles.loadingCopy}>正在准备训练列表…</p> : !visibleSessions.length ? <Empty title={emptyCopy[0]} description={emptyCopy[1]} action={canCreateTraining && listFilter === 'active' ? <Button icon={<Plus size={16} />} onClick={() => setOpen(true)}>创建训练</Button> : undefined} /> : <div className={styles.grid}>{visibleSessions.map(item => <article className={styles.card} key={item.id}><div className={styles.actions}><StatusBadge variant={statusVariant(item.status)}>{trainingStatusLabel(item.status)}</StatusBadge>{managerView && <StatusBadge variant="neutral">{trainingSessionTypeLabel(item.sessionType)}</StatusBadge>}{managerView && item.teamName && <StatusBadge variant="info">{item.teamName}</StatusBadge>}</div><h3>{item.title}</h3><p className={styles.muted}>{item.description || (managerView ? '暂无说明' : '老师暂未填写训练说明')}</p>{managerView && <p>{cardFacts(item)}</p>}<Button variant={item.status === 'DRAFT' ? 'primary' : item.canJoin ? 'primary' : 'secondary'} onClick={() => void openSession(item)}>{item.status === 'DRAFT' ? '继续编排' : item.canJoin ? '加入训练' : item.status === 'ENDED' || item.status === 'ARCHIVED' ? '查看训练' : '继续训练'}</Button></article>)}</div>}
    </Section>

    <FormDialog isOpen={open} onClose={closeDialog} title="创建训练" description={mode === 'simple' ? '选择题目、学生和截止时间即可发布。' : '教练带练模式用于阶段、解锁条件和课堂控制。'} size="wide" loading={creating} dirty={Boolean(title || selectedProblems.length)} footer={mode === 'simple' ? <><Button variant="secondary" onClick={closeDialog} disabled={creating}>取消</Button>{simpleStep > 0 && <Button variant="secondary" onClick={() => setSimpleStep(step => step - 1)} disabled={creating}>上一步</Button>}{simpleStep < 3 ? <Button onClick={() => setSimpleStep(step => step + 1)} disabled={!simpleValid}>下一步</Button> : <Button onClick={() => void createSimpleTraining()} loading={creating}>确认并发布</Button>}</> : <><Button variant="secondary" onClick={closeDialog} disabled={creating}>取消</Button><Button onClick={() => void createCoachDraft()} loading={creating} disabled={!title.trim() || !chosenTemplate || !scopeReady}>创建草稿并编排</Button></>}>
      <div className={styles.stack}>
        <Tabs label="训练创建方式" value={mode} onChange={value => setMode(value as CreateMode)} items={[{ value: 'simple', label: '普通训练（推荐）' }, { value: 'coach', label: '教练带练模式' }]} />
        {mode === 'simple' ? <>
          <div className={styles.designSteps}>{simpleSteps.map((label, index) => index === simpleStep ? <strong key={label}>{index + 1}. {label}</strong> : <span key={label}>{index + 1}. {label}</span>)}</div>
          {simpleStep === 0 && <div className={styles.stack}><label className={styles.field}>训练名称<Input autoFocus value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label><label className={styles.field}>训练说明（可选）<Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label><div className={styles.grid}><label className={styles.field}>开始时间<Input type="datetime-local" value={scheduledStartAt} onChange={event => setScheduledStartAt(event.target.value)} /></label><label className={styles.field}>截止时间<Input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /><small>到期后系统自动结束训练。</small></label></div></div>}
          {simpleStep === 1 && <div className={styles.stack}><div className={styles.actions}><Tabs label="题库范围" value={problemSource} onChange={value => setProblemSource(value as typeof problemSource)} items={[...(organizationId ? [{ value: 'school' as const, label: '校内题库' }] : []), { value: 'carits' as const, label: 'Carits 平台题库' }, { value: 'external' as const, label: '其他题库' }]} /><Input aria-label="搜索题号或标题" placeholder="搜索题号或标题" value={problemQuery} onChange={event => setProblemQuery(event.target.value)} /></div><p className={styles.muted}>已选择 {selectedProblems.length} 道题；发布时自动固定各题当前正式版本。</p><div className={styles.problemPicker}>{poolLoading ? <p>正在查找题目…</p> : problemPool.map(problem => { const selected = selectedProblems.some(item => item.id === problem.id); return <Button type="button" variant="ghost" className={styles.problemButton} data-active={selected} key={problem.id} onClick={() => setSelectedProblems(current => selected ? current.filter(item => item.id !== problem.id) : [...current, problem])}><strong>{problem.platform} · {problem.problemId}</strong><br /><span>{problem.title}</span></Button> })}</div>{selectedProblems.length > 0 && <div className={styles.actions}>{selectedProblems.map(problem => <Button size="sm" variant="secondary" key={problem.id} onClick={() => setSelectedProblems(current => current.filter(item => item.id !== problem.id))}>移除 {problem.problemId}</Button>)}</div>}</div>}
          {simpleStep === 2 && <div className={styles.stack}>{organizationId ? <><label className={styles.field}>训练对象<Select value={participantTarget} onChange={event => setParticipantTarget(event.target.value as ParticipantTarget)}><option value="team">团队（推荐）</option><option value="custom_students">自定义学生</option>{user?.organizationRole === 'school_principal' && <option value="organization_students">全校学生</option>}</Select></label>{participantTarget === 'team' && <label className={styles.field}>学员团队<Select value={selectedTeamId} onChange={event => setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}{participantTarget === 'custom_students' && <div className={styles.card}><strong>选择学生（已选 {selectedStudentIds.length} 人）</strong>{studentsLoading ? <span>正在加载学生…</span> : students.map(student => <Checkbox key={student.userId} label={student.name || student.user?.username || student.userId} checked={selectedStudentIds.includes(student.userId)} onChange={event => setSelectedStudentIds(current => event.target.checked ? [...current, student.userId] : current.filter(id => id !== student.userId))} />)}</div>}{participantTarget === 'organization_students' && <div className={styles.card}><strong>全校学生</strong><span>仅包含当前学校的有效学生，不会加入教师或负责人。</span><small className={styles.muted}>发布前请确认这是面向全校的训练。</small></div>}</> : !teamId && <label className={styles.field}>学员团队<Select value={selectedTeamId} onChange={event => setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}<div className={styles.card}><strong>参与范围</strong><span>{useTeamScope ? '所选团队中的学生' : participantTarget === 'custom_students' ? `已选择 ${selectedStudentIds.length} 名学生` : '当前学校的全部有效学生'}</span><small className={styles.muted}>发布时固定符合条件的学生名单。</small></div><label className={styles.field}>完成要求<Select value={completionMode} onChange={event => setCompletionMode(event.target.value as 'all' | 'count')}><option value="all">完成全部题目</option><option value="count">至少完成指定题数</option></Select></label>{completionMode === 'count' && <label className={styles.field}>至少完成<Input type="number" min={1} max={Math.max(1, selectedProblems.length)} value={requiredCount} onChange={event => setRequiredCount(Number(event.target.value))} /><small>最多 {selectedProblems.length} 道题。</small></label>}</div>}
          {simpleStep === 3 && <div className={styles.publishChecklist}><p><strong>{title}</strong><span>训练名称</span></p><p><strong>{selectedProblems.length} 道</strong><span>训练题目</span></p><p><strong>{completionMode === 'all' ? '全部完成' : `至少 ${Math.min(requiredCount, selectedProblems.length)} 道`}</strong><span>完成要求</span></p><p><strong>{new Date(dueAt).toLocaleString()}</strong><span>截止时间</span></p></div>}
        </> : <CoachFields organizationId={organizationId} teamId={teamId} teams={teams} selectedTeamId={selectedTeamId} setSelectedTeamId={setSelectedTeamId} participantTarget={participantTarget} setParticipantTarget={setParticipantTarget} students={students} studentsLoading={studentsLoading} selectedStudentIds={selectedStudentIds} setSelectedStudentIds={setSelectedStudentIds} canUseSchoolWide={user?.organizationRole === 'school_principal'} title={title} setTitle={setTitle} description={description} setDescription={setDescription} scheduledStartAt={scheduledStartAt} setScheduledStartAt={setScheduledStartAt} templateKey={templateKey} setTemplateKey={setTemplateKey} templates={templates} rankingMode={rankingMode} setRankingMode={setRankingMode} peerVisibility={peerVisibility} setPeerVisibility={setPeerVisibility} joinMode={joinMode} setJoinMode={setJoinMode} allowHints={allowHints} setAllowHints={setAllowHints} allowSolution={allowSolution} setAllowSolution={setAllowSolution} allowDiscussion={allowDiscussion} setAllowDiscussion={setAllowDiscussion} />}
      </div>
    </FormDialog>
  </div></PageFrame>
}

function CoachFields(props: any) {
  return <div className={styles.stack}>
    {props.organizationId && <label className={styles.field}>训练对象<Select value={props.participantTarget} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => props.setParticipantTarget(event.target.value)}><option value="team">团队（推荐）</option><option value="custom_students">自定义学生</option>{props.canUseSchoolWide && <option value="organization_students">全校学生</option>}</Select></label>}
    {(!props.organizationId && !props.teamId || props.organizationId && props.participantTarget === 'team') && <label className={styles.field}>团队范围<Select value={props.selectedTeamId} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => props.setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{props.teams.map((team: Team) => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}
    {props.organizationId && props.participantTarget === 'custom_students' && <div className={styles.card}><strong>选择学生（已选 {props.selectedStudentIds.length} 人）</strong>{props.studentsLoading ? <span>正在加载学生…</span> : props.students.map((student: Student) => <Checkbox key={student.userId} label={student.name || student.user?.username || student.userId} checked={props.selectedStudentIds.includes(student.userId)} onChange={(event: React.ChangeEvent<HTMLInputElement>) => props.setSelectedStudentIds((current: string[]) => event.target.checked ? [...current, student.userId] : current.filter(id => id !== student.userId))} />)}</div>}
    {props.organizationId && props.participantTarget === 'organization_students' && <p className={styles.muted}>将面向全校有效学生发布，不包含教师和负责人。</p>}
    <label className={styles.field}>训练名称<Input value={props.title} maxLength={200} onChange={(event: React.ChangeEvent<HTMLInputElement>) => props.setTitle(event.target.value)} /></label>
    <label className={styles.field}>训练说明<Textarea rows={3} value={props.description} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => props.setDescription(event.target.value)} /></label>
    <label className={styles.field}>计划开始（可选）<Input type="datetime-local" value={props.scheduledStartAt} onChange={(event: React.ChangeEvent<HTMLInputElement>) => props.setScheduledStartAt(event.target.value)} /></label>
    <label className={styles.field}>训练模板<Select value={props.templateKey} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => props.setTemplateKey(event.target.value)}>{props.templates.map((item: Template) => <option value={item.key} key={item.key}>{item.name} · {item.description}</option>)}</Select><small>只导入阶段骨架，题目会在设计器中显式分配。</small></label>
    <div className={styles.grid}><label className={styles.field}>训练展示<Select value={props.rankingMode} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => props.setRankingMode(event.target.value)}><option value="OFF">不显示榜单</option><option value="PROGRESS_ONLY">只显示完成进度</option><option value="SCORE">显示训练分数</option><option value="ACM_RANKING">显示 ACM 排名</option></Select></label><label className={styles.field}>同学状态<Select value={props.peerVisibility} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => props.setPeerVisibility(event.target.value)}><option value="NONE">不可见</option><option value="PROGRESS">仅进度</option><option value="FULL">完整状态</option></Select></label><label className={styles.field}>迟到加入<Select value={props.joinMode} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => props.setJoinMode(event.target.value)}><option value="CURRENT_STAGE">当前阶段</option><option value="FROM_BEGINNING">从第一阶段开始</option><option value="TEACHER_ASSIGN">由教练分配</option></Select></label></div>
    <div className={styles.stack}><Checkbox label="允许提示" checked={props.allowHints} onChange={(event: React.ChangeEvent<HTMLInputElement>) => props.setAllowHints(event.target.checked)} /><Checkbox label="允许查看题解" checked={props.allowSolution} onChange={(event: React.ChangeEvent<HTMLInputElement>) => props.setAllowSolution(event.target.checked)} /><Checkbox label="允许讨论" checked={props.allowDiscussion} onChange={(event: React.ChangeEvent<HTMLInputElement>) => props.setAllowDiscussion(event.target.checked)} /></div>
  </div>
}
