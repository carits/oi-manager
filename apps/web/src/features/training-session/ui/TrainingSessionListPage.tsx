'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { useAuth } from '@/features/auth'
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
import { StudentPicker } from '@/features/organization-account'
import { QuickProblemInput, type SelectedCanonicalProblem } from '@/features/problem-selection'
import { createTrainingSession, joinTrainingSession, listManagedTrainingTeams, listTrainingSessions, previewTrainingParticipants, publishTraining } from '../api/trainingSessionApi'
import { buildTrainingListQuery, resolveTrainingListTeamId } from '../model/trainingListScope'

type Session = { id: string; title: string; description?: string; status: string; sessionType: string; problemCount?: number; dueAt?: string | null; statusRevision?: number; canJoin?: boolean; teamId?: string | null; teamName?: string | null; _count: { Stages: number; Participants: number } }
type SessionListPayload = { items: Session[]; statusCounts: Record<ListFilter, number>; pagination: { page: number; pageSize: number; total: number; totalPages: number } }
type Team = { id: string; name: string; owner?: { id?: string }; members?: Array<{ userId: string; role: string }> }
type TeamPayload = Team[] | { items?: Team[]; data?: Team[]; totalPages?: number }
type Problem = { id: string; platform: string; problemId: string; title: string; difficulty?: string | null }
type CreateMode = 'quick' | 'custom'
type ParticipantTarget = 'team' | 'organization_students' | 'custom_students'
type CustomStageDraft = { name: string }
type ListFilter = 'active' | 'upcoming' | 'completed' | 'draft'


const statusVariant = (status: string) => status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : status === 'ENDED' || status === 'ARCHIVED' ? 'neutral' : 'info'
const normalizeTeams = (payload?: TeamPayload) => Array.isArray(payload) ? payload : payload?.items || payload?.data || []
const localDateTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

async function loadAllManagedTeams(organizationId?: string) {
  const base = new URLSearchParams({ view: 'managed', page: '1', pageSize: '100' })
  if (organizationId) base.set('organizationId', organizationId)
  const first = await listManagedTrainingTeams<TeamPayload>(base)
  if (!first.success || !first.data) return first
  const totalPages = Array.isArray(first.data) ? 1 : first.data.totalPages || 1
  if (totalPages <= 1) return first
  const remaining = await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => {
    const params = new URLSearchParams(base); params.set('page', String(index + 2))
    return listManagedTrainingTeams<TeamPayload>(params)
  }))
  const failedPage = remaining.find(result => !result.success)
  if (failedPage) return failedPage
  const data = [first, ...remaining].flatMap(result => normalizeTeams(result.data))
  return { success: true, status: 200, data } as const
}

export function TrainingSessionListPage({ organizationId, teamId }: { organizationId?: string; teamId?: string }) {
  const router = useRouter(), searchParams = useSearchParams(), toast = useToast(), { user } = useAuth()
  const canViewTrainingManagement = Boolean(organizationId && (user?.organizationRole === 'teacher' || user?.organizationRole === 'school_principal'))
  const urlTeamId = resolveTrainingListTeamId(teamId, searchParams.get('teamId'))
  const [sessions, setSessions] = useState<Session[]>([]), [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true), [creating, setCreating] = useState(false), [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CreateMode>('quick'), [simpleStep, setSimpleStep] = useState(0)
  const [title, setTitle] = useState(''), [description, setDescription] = useState('')
  const [scheduledStartAt, setScheduledStartAt] = useState(() => localDateTime(new Date())), [dueAt, setDueAt] = useState(() => localDateTime(new Date(Date.now() + 7 * 24 * 3600_000)))
  const [selectedTeamId, setSelectedTeamId] = useState(teamId || '')
  const [participantTarget, setParticipantTarget] = useState<ParticipantTarget>(organizationId ? 'team' : 'team')
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [participantPreview, setParticipantPreview] = useState<{ participantCount: number; targetName: string } | null>(null), [previewLoading, setPreviewLoading] = useState(false), [schoolWideConfirmed, setSchoolWideConfirmed] = useState(false)
  const [rankingMode, setRankingMode] = useState('PROGRESS_ONLY'), [peerVisibility, setPeerVisibility] = useState('PROGRESS'), [joinMode, setJoinMode] = useState('CURRENT_STAGE')
  const [allowHints, setAllowHints] = useState(true)
  const [completionMode, setCompletionMode] = useState<'all' | 'count'>('all'), [requiredCount, setRequiredCount] = useState(1)
  const [selectedProblems, setSelectedProblems] = useState<Problem[]>([])
  const [customStages, setCustomStages] = useState<CustomStageDraft[]>([{ name: '阶段 1' }])
  const [listFilter, setListFilter] = useState<ListFilter>('active'), [listQuery, setListQuery] = useState(''), [listTeamId, setListTeamId] = useState(urlTeamId)
  const [listPage, setListPage] = useState(1), [listTotal, setListTotal] = useState(0), [listTotalPages, setListTotalPages] = useState(1)
  const [statusCounts, setStatusCounts] = useState<Record<ListFilter, number>>({ active: 0, upcoming: 0, completed: 0, draft: 0 })
  useEffect(() => {
    setListTeamId(current => current === urlTeamId ? current : urlTeamId)
    setListPage(1)
  }, [urlTeamId])

  const load = useCallback(async () => {
    setLoading(true)
    const listQueryParams = buildTrainingListQuery({
      organizationId,
      fixedTeamId: teamId,
      selectedTeamId: listTeamId,
      statusGroup: listFilter,
      page: listPage,
      pageSize: 20,
      keyword: listQuery,
    })
    try {
      const [listResult, teamResult] = await Promise.allSettled([
        listTrainingSessions(listQueryParams),
        teamId ? Promise.resolve({ success: true, data: [] as Team[], status: 200, message: undefined })
          : organizationId && canViewTrainingManagement
            ? loadAllManagedTeams(organizationId)
            : organizationId
              ? Promise.resolve({ success: true, data: [] as Team[], status: 200, message: undefined })
              : loadAllManagedTeams(),
      ])

      if (listResult.status === 'fulfilled') {
        const list = listResult.value
        if (Array.isArray(list)) {
          setSessions(list as Session[])
          setStatusCounts({ active: 0, upcoming: 0, completed: 0, draft: 0 })
          setListTotal(list.length)
          setListTotalPages(1)
        } else {
          setSessions(list.items as Session[])
          setStatusCounts(list.statusCounts as Record<ListFilter, number>)
          setListTotal(list.pagination.total)
          setListTotalPages(Math.max(1, list.pagination.totalPages))
        }
      } else {
        toast.error(listResult.reason instanceof Error ? listResult.reason.message : '训练列表加载失败')
      }


      if (teamResult.status === 'fulfilled' && teamResult.value.success) {
        const manageable = normalizeTeams(teamResult.value.data)
        setTeams(manageable)
        setSelectedTeamId(current => current || manageable[0]?.id || '')
      } else if (teamResult.status === 'rejected') {
        toast.error(teamResult.reason instanceof Error ? teamResult.reason.message : '可管理团队加载失败')
      } else if (!teamResult.value.success) {
        toast.error(teamResult.value.message || '可管理团队加载失败')
      }
    } finally {
      setLoading(false)
    }
  }, [canViewTrainingManagement, listFilter, listPage, listQuery, listTeamId, organizationId, teamId, toast])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer) }, [load])

  const targetTeamId = teamId || selectedTeamId
  const useTeamScope = !organizationId || participantTarget === 'team'
  const scopeReady = useTeamScope ? Boolean(targetTeamId) : participantTarget === 'custom_students' ? selectedStudentIds.length > 0 : user?.organizationRole === 'school_principal'
  const simpleValid = [Boolean(title.trim() && dueAt), selectedProblems.length > 0, scopeReady, Boolean(participantPreview?.participantCount && (participantTarget !== 'organization_students' || schoolWideConfirmed))][simpleStep]
  useEffect(() => {
    if (!open || mode !== 'quick' || simpleStep !== 3 || !scopeReady) { setParticipantPreview(null); return }
    setPreviewLoading(true)
    const payload = { organizationId: useTeamScope ? undefined : organizationId, teamId: useTeamScope ? targetTeamId : undefined, participantTarget, participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined }
    void previewTrainingParticipants(payload).then(response => {
      setParticipantPreview(response.ok ? response.data : null)
      if (!response.ok) toast.error(response.error.message || '无法确认训练对象')
      setPreviewLoading(false)
    })
  }, [mode, open, organizationId, participantTarget, scopeReady, selectedStudentIds, simpleStep, targetTeamId, toast, useTeamScope])
  const resetDialog = () => {
    setSimpleStep(0); setTitle(''); setDescription(''); setSelectedProblems([]); setCustomStages([{ name: '阶段 1' }]); setCompletionMode('all'); setRequiredCount(1); setSelectedStudentIds([]); setParticipantTarget('team'); setParticipantPreview(null); setSchoolWideConfirmed(false)
    setScheduledStartAt(localDateTime(new Date())); setDueAt(localDateTime(new Date(Date.now() + 7 * 24 * 3600_000)))
  }
  const closeDialog = () => { if (!creating) { setOpen(false); resetDialog() } }

  const createCustomDraft = async () => {
    if (!title.trim() || !scopeReady) return
    setCreating(true)
    const response = await createTrainingSession({
      title,
      description,
      sessionType: 'GENERAL',
      organizationId: useTeamScope ? undefined : organizationId,
      teamId: useTeamScope ? targetTeamId : undefined,
      participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined,
      scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : null,
      rankingMode: rankingMode as 'PROGRESS_ONLY',
      peerVisibility: peerVisibility as 'PROGRESS',
      joinMode: joinMode as 'CURRENT_STAGE',
      allowHints,
      settings: { participantTarget },
      stages: customStages.map((stage, index) => ({
        name: stage.name.trim() || `阶段 ${index + 1}`,
        description: '',
        kind: 'TRAINING',
        endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE',
        accessScope: 'CURRENT_STAGE',
        submissionMode: 'ENABLED',
        problems: [],
        groups: [],
      })),
    })
    setCreating(false)
    if (!response.ok || !response.data) return toast.error(response.ok ? '创建训练失败' : response.error.message)
    toast.success('训练草稿已创建，可自由新增多个阶段后再发布')
    setOpen(false)
    router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${response.data.id}/design`)
  }

  const createSimpleTraining = async () => {
    if (!title.trim() || !dueAt || !selectedProblems.length || !scopeReady) return
    const count = completionMode === 'all' ? selectedProblems.length : Math.min(Math.max(1, requiredCount), selectedProblems.length)
    setCreating(true)
    const response = await createTrainingSession({
      title, description, organizationId: useTeamScope ? undefined : organizationId, teamId: useTeamScope ? targetTeamId : undefined,
      scheduledStartAt: new Date(scheduledStartAt || Date.now()).toISOString(), rankingMode: 'PROGRESS_ONLY', peerVisibility: 'PROGRESS', joinMode: 'CURRENT_STAGE',
      allowHints: true,
      participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined,
      settings: { dueAt: new Date(dueAt).toISOString(), completionMode, requiredProblemCount: count, participantTarget },
      stages: [{ name: '训练任务', kind: 'TRAINING', problems: selectedProblems.map(problem => ({ problemId: problem.id, allowedSubtaskIds: [] })) }],
    })
    if (!response.ok || !response.data) { setCreating(false); return toast.error(response.ok ? '创建训练失败' : response.error.message) }
    const published = await publishTraining(response.data.id, { expectedRevision: response.data.statusRevision ?? 0 })
    setCreating(false)
    if (!published.ok) {
      toast.error(`训练草稿已保存，但发布检查未通过：${published.error.message || '请继续完善'}`); setOpen(false)
      return router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${response.data.id}/design`)
    }
    toast.success('训练已创建并发布'); closeDialog(); await load()
  }

  const canCreateTraining = canViewTrainingManagement || Boolean(!organizationId && (teamId || teams.length))
  const managerView = canViewTrainingManagement || Boolean(!organizationId && (teamId || teams.length))
  useEffect(() => { if (!managerView && listFilter === 'draft') setListFilter('active') }, [listFilter, managerView])
  const countFor = (filter: ListFilter) => statusCounts[filter] || 0
  const visibleSessions = sessions
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
    if (item.canJoin) { const joined = await joinTrainingSession(item.id); if (!joined.ok) return toast.error(joined.error.message || '加入训练失败') }
    router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${item.id}${item.status === 'DRAFT' ? '/design' : ''}`)
  }
  const cardFacts = (item: Session) => {
    const people = `${item._count.Participants} 名学生`
    const deadline = item.dueAt ? ` · 截止 ${new Date(item.dueAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''
    return `${item._count.Stages} 个阶段 · ${item.problemCount || 0} 道题 · ${people}${deadline}`
  }

  const simpleSteps = ['基本信息', '选择题目', '学员范围', '检查并发布']
  const dialogFooter = mode === 'quick'
    ? <> <Button variant="secondary" onClick={closeDialog} disabled={creating}>取消</Button>{simpleStep > 0 && <Button variant="secondary" onClick={() => setSimpleStep(step => step - 1)} disabled={creating}>上一步</Button>}{simpleStep < 3 ? <Button onClick={() => setSimpleStep(step => step + 1)} disabled={!simpleValid}>下一步</Button> : <Button onClick={() => void createSimpleTraining()} loading={creating} disabled={!simpleValid || previewLoading}>确认并发布</Button>} </>
    : mode === 'custom'
      ? <> <Button variant="secondary" onClick={closeDialog} disabled={creating}>取消</Button><Button onClick={() => void createCustomDraft()} loading={creating} disabled={!title.trim() || !scopeReady || !customStages.length}>创建并编排多个阶段</Button> </>
      : null
  return <PageFrame className={styles.trainingListFrame}><div className={styles.stack}>
    <PageHeader title="训练" description={managerView ? '布置和管理学生练习。' : '查看老师安排的训练并继续练习。'} actions={canCreateTraining ? <Button icon={<Plus size={17} />} onClick={() => setOpen(true)}>创建训练</Button> : undefined} />
    <div className={styles.listControls}>
      <Tabs label={managerView ? '训练状态' : '我的训练状态'} value={listFilter} onChange={value => { setListFilter(value as ListFilter); setListPage(1) }} items={filterItems} />
      {managerView && <div className={styles.listFilters}>{teams.length > 0 && <Select aria-label="筛选团队" value={listTeamId} onChange={event => { const value = event.target.value; setListTeamId(value); setListPage(1); const params = new URLSearchParams(searchParams.toString()); if (value) params.set('teamId', value); else params.delete('teamId'); router.replace(`?${params}`) }}><option value="">全部训练范围</option>{organizationId && <option value="organization">校级训练</option>}{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select>}<Input aria-label="搜索训练" placeholder="搜索训练" value={listQuery} onChange={event => { setListQuery(event.target.value); setListPage(1) }} /></div>}
    </div>
    <Section title={managerView ? '训练列表' : '我的训练'} description={loading ? '正在准备训练列表…' : listTotal ? `共 ${listTotal} 个` : undefined}>
      {loading ? <p className={styles.loadingCopy}>正在准备训练列表…</p> : !visibleSessions.length ? <Empty title={emptyCopy[0]} description={emptyCopy[1]} action={canCreateTraining && listFilter === 'active' ? <Button icon={<Plus size={16} />} onClick={() => setOpen(true)}>创建训练</Button> : undefined} /> : <div className={styles.grid}>{visibleSessions.map(item => <article className={styles.card} key={item.id}><div className={styles.actions}><StatusBadge variant={statusVariant(item.status)}>{trainingStatusLabel(item.status)}</StatusBadge>{managerView && <StatusBadge variant="neutral">{trainingSessionTypeLabel(item.sessionType)}</StatusBadge>}{managerView && item.teamName && <StatusBadge variant="info">{item.teamName}</StatusBadge>}</div><h3>{item.title}</h3><p className={styles.muted}>{item.description || (managerView ? '暂无说明' : '老师暂未填写训练说明')}</p>{managerView && <p>{cardFacts(item)}</p>}<Button variant={item.status === 'DRAFT' ? 'primary' : item.canJoin ? 'primary' : 'secondary'} onClick={() => void openSession(item)}>{item.status === 'DRAFT' ? '继续编排' : item.canJoin ? '加入训练' : item.status === 'ENDED' || item.status === 'ARCHIVED' ? '查看训练' : '继续训练'}</Button></article>)}</div>}
      {listTotalPages > 1 && <div className={styles.pagination}><span>共 {listTotal} 个 · 第 {listPage}/{listTotalPages} 页</span><div className={styles.actions}><Button size="sm" variant="secondary" disabled={listPage <= 1 || loading} onClick={() => setListPage(page => page - 1)}>上一页</Button><Button size="sm" variant="secondary" disabled={listPage >= listTotalPages || loading} onClick={() => setListPage(page => page + 1)}>下一页</Button></div></div>}
    </Section>

    <FormDialog isOpen={open} onClose={closeDialog} title="创建训练" description={mode === 'quick' ? '快速创建只适合“单阶段·全班统一”，会直接发布；需要多阶段或分组训练请使用“自定义多阶段”。' : '多阶段训练先固定学员并创建阶段骨架，创建后在独立设计器中统一配置训练分组和阶段规则。'} size="wide" loading={creating} dirty={Boolean(title || selectedProblems.length)} footer={dialogFooter}>
      <div className={styles.stack}>
        <div className={styles.creationModeGrid} role="radiogroup" aria-label="选择创建方式">
          {[
            { value: 'quick' as const, title: '快速训练', description: '单阶段、全班统一，适合日常刷题。' },
            { value: 'custom' as const, title: '多阶段训练', description: '先搭建课堂骨架，再进入全屏设计器配置阶段。' },
          ].map(item => <Button variant="ghost" role="radio" key={item.value} className={`${styles.creationModeCard} ${mode === item.value ? styles.creationModeCardActive : ''}`} aria-checked={mode === item.value} onClick={() => setMode(item.value)}>
            <strong>{item.title}</strong><span>{item.description}</span><small>{mode === item.value ? '已选择' : '选择此方式'}</small>
          </Button>)}
        </div>
        {mode === 'quick' && <>
          <div className={styles.designSteps}>{simpleSteps.map((label, index) => index === simpleStep ? <strong key={label}>{index + 1}. {label}</strong> : <span key={label}>{index + 1}. {label}</span>)}</div>
          {simpleStep === 0 && <div className={styles.stack}><label className={styles.field}>训练名称<Input autoFocus value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label><label className={styles.field}>训练说明（可选）<Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label><div className={styles.grid}><label className={styles.field}>开始时间<Input type="datetime-local" value={scheduledStartAt} onChange={event => setScheduledStartAt(event.target.value)} /></label><label className={styles.field}>截止时间<Input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /><small>到期后系统自动结束训练。</small></label></div></div>}
          {simpleStep === 1 && <div className={styles.stack}><QuickProblemInput existingProblemIds={selectedProblems.map(item => item.id)} onResolved={(problems: SelectedCanonicalProblem[]) => setSelectedProblems(current => [...current, ...problems.map(problem => ({ id: problem.id, platform: problem.platform, problemId: problem.problemCode, title: problem.title, difficulty: problem.difficulty }))])} /><p className={styles.muted}>已添加 {selectedProblems.length} 道题；发布时自动固定各题当前正式版本。</p>{selectedProblems.length > 0 && <div className={styles.actions}>{selectedProblems.map(problem => <Button size="sm" variant="secondary" key={problem.id} onClick={() => setSelectedProblems(current => current.filter(item => item.id !== problem.id))}>移除 {problem.problemId}</Button>)}</div>}</div>}
          {simpleStep === 2 && <div className={styles.stack}>{organizationId ? <><label className={styles.field}>训练对象<Select value={participantTarget} onChange={event => { setParticipantTarget(event.target.value as ParticipantTarget); setSchoolWideConfirmed(false) }}><option value="team">团队（推荐）</option><option value="custom_students">自定义学生</option>{user?.organizationRole === 'school_principal' && <option value="organization_students">全校学生</option>}</Select></label>{participantTarget === 'team' && <label className={styles.field}>学员团队<Select value={selectedTeamId} onChange={event => setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}{participantTarget === 'custom_students' && <StudentPicker organizationId={organizationId} teams={teams} selectedIds={selectedStudentIds} onChange={setSelectedStudentIds} />}{participantTarget === 'organization_students' && <div className={styles.card}><strong>全校学生</strong><span>仅包含当前学校的有效学生，不会加入教师或负责人。</span><small className={styles.muted}>下一步会由服务器计算真实人数并要求再次确认。</small></div>}</> : !teamId && <label className={styles.field}>学员团队<Select value={selectedTeamId} onChange={event => setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}<div className={styles.card}><strong>参与范围</strong><span>{useTeamScope ? '所选团队中的学生' : participantTarget === 'custom_students' ? `已选择 ${selectedStudentIds.length} 名学生` : '当前学校的全部有效学生'}</span><small className={styles.muted}>发布时固定符合条件的学生名单。</small></div><label className={styles.field}>完成要求<Select value={completionMode} onChange={event => setCompletionMode(event.target.value as 'all' | 'count')}><option value="all">完成全部题目</option><option value="count">至少完成指定题数</option></Select></label>{completionMode === 'count' && <label className={styles.field}>至少完成<Input type="number" min={1} max={Math.max(1, selectedProblems.length)} value={requiredCount} onChange={event => setRequiredCount(Number(event.target.value))} /><small>最多 {selectedProblems.length} 道题。</small></label>}</div>}
          {simpleStep === 3 && <div className={styles.stack}>{previewLoading ? <p className={styles.loadingCopy}>正在确认训练对象…</p> : participantPreview ? <><div className={styles.publishChecklist}><p><strong>{title}</strong><span>训练名称</span></p><p><strong>{participantPreview.targetName} · {participantPreview.participantCount} 人</strong><span>训练对象</span></p><p><strong>{selectedProblems.length} 道</strong><span>训练题目</span></p><p><strong>{completionMode === 'all' ? '全部完成' : `至少 ${Math.min(requiredCount, selectedProblems.length)} 道`}</strong><span>完成要求</span></p><p><strong>{new Date(scheduledStartAt).toLocaleString()}</strong><span>开始时间</span></p><p><strong>{new Date(dueAt).toLocaleString()}</strong><span>截止时间</span></p></div>{participantTarget === 'organization_students' && <div className={styles.message}><strong>这是全校范围发布</strong><p>将向当前学校 {participantPreview.participantCount} 名有效学生发布训练。</p><Checkbox label={`我确认向全校 ${participantPreview.participantCount} 名学生发布`} checked={schoolWideConfirmed} onChange={event => setSchoolWideConfirmed(event.target.checked)} /></div>}</> : <p className={styles.message}>无法确认训练对象，请返回上一步检查范围。</p>}</div>}
        </>}
        {mode === 'custom' && <div className={styles.stack}>
          <div className={styles.message}><strong>先创建草稿，再自由编排多个阶段</strong><p>创建后会进入训练设计器。你可以从阶段 1 开始，继续新增、复制、删除和排序未来阶段；确认完整后再统一发布。</p></div>
          {organizationId && <label className={styles.field}>训练对象<Select value={participantTarget} onChange={event => setParticipantTarget(event.target.value as ParticipantTarget)}><option value="team">团队（推荐）</option><option value="custom_students">自定义学生</option>{user?.organizationRole === 'school_principal' && <option value="organization_students">全校学生</option>}</Select></label>}
          {(!organizationId && !teamId || organizationId && participantTarget === 'team') && <label className={styles.field}>团队范围<Select value={selectedTeamId} onChange={event => setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}
          {organizationId && participantTarget === 'custom_students' && <StudentPicker organizationId={organizationId} teams={teams} selectedIds={selectedStudentIds} onChange={setSelectedStudentIds} />}
          {organizationId && participantTarget === 'organization_students' && <p className={styles.muted}>将面向全校有效学生创建训练草稿；发布前仍可在设计器中检查。</p>}
          <label className={styles.field}>训练名称<Input autoFocus value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
          <label className={styles.field}>训练说明<Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <label className={styles.field}>计划开始（可选）<Input type="datetime-local" value={scheduledStartAt} onChange={event => setScheduledStartAt(event.target.value)} /></label>
          <div className={styles.card}>
            <strong>阶段编排</strong>
            <p>现在就可以先建立多个阶段骨架。创建后进入设计器继续为每个阶段配置题目、分组、时长和规则。</p>
            <p className={styles.muted}>训练分组属于整场训练，创建后请在独立设计器的“学员与训练分组”面板统一配置，避免同一组被重复配置到多个阶段。</p>
            </div>
            <div className={styles.stack}>
              {customStages.map((stage, index) => <article className={styles.card} key={index}>
                <div className={styles.actions}>
                  <label className={styles.field}>
                    阶段名称
                    <Input
                      aria-label={`阶段 ${index + 1} 名称`}
                      value={stage.name}
                      maxLength={200}
                      placeholder={`阶段 ${index + 1}`}
                      onChange={event => setCustomStages(current => current.map((item, currentIndex) => currentIndex === index ? { ...item, name: event.target.value } : item))}
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={customStages.length === 1}
                    onClick={() => setCustomStages(current => current.filter((_, currentIndex) => currentIndex !== index))}
                  >
                    删除阶段
                  </Button>
                </div>
              </article>)}
              <Button
                size="sm"
                variant="outline"
                icon={<Plus size={14} />}
                disabled={customStages.length >= 30}
                onClick={() => setCustomStages(current => [...current, { name: `阶段 ${current.length + 1}` }])}
              >
                新增阶段
              </Button>
              <small className={styles.muted}>当前 {customStages.length}/30 个阶段；阶段参与方式和统一训练分组将在设计器中配置。</small>
            </div>
        </div>}
      </div>
    </FormDialog>
  </div></PageFrame>
}
