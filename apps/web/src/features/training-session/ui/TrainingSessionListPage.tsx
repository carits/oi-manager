'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Copy, Plus } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
import { FormField } from '@/components/ui/FormField'
import { Tabs } from '@/components/ui/Tabs'
import { StatusBadge } from '@/components/ui/Badge'
import { Empty } from '@/components/ui/Empty'
import { LoadError } from '@/components/ui/LoadError'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { useToast } from '@/components/ui/Toast'
import { useFeatureResource } from '@/hooks/data/useFeatureResource'
import { useListScrollRestoration } from '@/hooks/useListScrollRestoration'
import { trainingStatusLabel } from '@/lib/humanPresentation'
import { cloneTrainingSession, joinTrainingSession, listManagedTrainingTeams, listTrainingSessions } from '../api/trainingSessionApi'
import { buildTrainingListQuery, resolveTrainingListTeamId, type TrainingListStatus } from '../model/trainingListScope'
import { readTrainingListLocation, updateTrainingListLocation, type TrainingListLocation } from '../model/trainingListLocation'
import { TrainingSetupDialog, type TrainingSetupTeam } from './TrainingSetupDialog'
import styles from './TrainingEngine.module.css'
import listStyles from './TrainingList.module.css'

type Session = {
  id: string; title: string; description?: string; status: string; statusRevision?: number;
  problemCount?: number; dueAt?: string | null; canJoin?: boolean; teamId?: string | null; teamName?: string | null;
  _count: { Stages: number; Participants: number }
}
type SessionListPayload = {
  items: Session[];
  statusCounts: Record<TrainingListStatus, number>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}
type Team = TrainingSetupTeam & { owner?: { id?: string }; members?: Array<{ userId: string; role: string }> }
type TeamPayload = Team[] | { items?: Team[]; data?: Team[]; totalPages?: number }
const normalizeTeams = (payload?: TeamPayload) => Array.isArray(payload) ? payload : payload?.items || payload?.data || []
const emptyCounts = { active: 0, upcoming: 0, completed: 0, draft: 0 }
const statusVariant = (status: string) => status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : status === 'ENDED' || status === 'ARCHIVED' ? 'neutral' : 'info'

async function loadAllManagedTeams(organizationId?: string): Promise<Team[]> {
  const base = new URLSearchParams({ view: 'managed', page: '1', pageSize: '100' })
  if (organizationId) base.set('organizationId', organizationId)
  const first = await listManagedTrainingTeams<TeamPayload>(base)
  if (!first.success || !first.data) throw new Error(first.message || '可管理团队加载失败')
  const totalPages = Array.isArray(first.data) ? 1 : first.data.totalPages || 1
  const remaining = await Promise.all(Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => {
    const params = new URLSearchParams(base)
    params.set('page', String(index + 2))
    return listManagedTrainingTeams<TeamPayload>(params)
  }))
  const failed = remaining.find(result => !result.success)
  if (failed) throw new Error(failed.message || '部分团队加载失败')
  return [first, ...remaining].flatMap(result => normalizeTeams(result.data))
}

export function TrainingSessionListPage({ organizationId, teamId }: { organizationId?: string; teamId?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const toast = useToast()
  const { user, sessionKey } = useAuth()
  const prefix = teamId ? 'training.' : ''
  const location = readTrainingListLocation(new URLSearchParams(searchParams.toString()), prefix)
  const listTeamId = resolveTrainingListTeamId(teamId, prefix ? location.teamId : searchParams.get('teamId'))
  const [keywordDraft, setKeywordDraft] = useState(location.keyword)
  const [setupOpen, setSetupOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const busyRef = useRef(false)
  const canViewTrainingManagement = Boolean(organizationId && (user?.organizationRole === 'teacher' || user?.organizationRole === 'school_principal'))
  const teamsResource = useFeatureResource<Team[]>(`training:managed-teams:${organizationId || 'personal'}`, sessionKey, () => loadAllManagedTeams(organizationId), {
    enabled: !teamId && (!organizationId || canViewTrainingManagement), keepPreviousData: false,
  })
  const teams = teamsResource.data || []
  const canCreateTraining = canViewTrainingManagement || Boolean(!organizationId && (teamId || teams.length))
  const managerView = canCreateTraining
  const listFilter = location.status === 'draft' && organizationId && !canViewTrainingManagement ? 'active' : location.status
  const query = buildTrainingListQuery({ organizationId, fixedTeamId: teamId, selectedTeamId: listTeamId, statusGroup: listFilter, page: location.page, pageSize: 20, keyword: location.keyword })
  const queryKey = `training:list:${JSON.stringify(query)}`
  const resource = useFeatureResource<SessionListPayload>(queryKey, sessionKey, async () => {
    const result = await listTrainingSessions(query) as Session[] | SessionListPayload
    return Array.isArray(result) ? { items: result, statusCounts: emptyCounts, pagination: { page: 1, pageSize: 20, total: result.length, totalPages: 1 } } : result
  })
  const rememberPosition = useListScrollRestoration(`${sessionKey}:${pathname}:${queryKey}`, Boolean(resource.data) && !resource.showingPreviousQuery)
  const updateLocation = useCallback((patch: Partial<TrainingListLocation>, replace = false) => {
    if (window.location.pathname !== pathname) return
    const params = updateTrainingListLocation(new URLSearchParams(window.location.search), patch, prefix)
    const href = `${pathname}${params.size ? `?${params.toString()}` : ''}${window.location.hash}`
    if (replace) window.history.replaceState(null, '', href)
    else window.history.pushState(null, '', href)
  }, [pathname, prefix])

  useEffect(() => { setKeywordDraft(location.keyword) }, [location.keyword])
  useEffect(() => {
    if (keywordDraft === location.keyword) return
    const timer = window.setTimeout(() => updateLocation({ keyword: keywordDraft }, true), 250)
    return () => window.clearTimeout(timer)
  }, [keywordDraft, location.keyword, updateLocation])
  useEffect(() => {
    if (!managerView && !teamsResource.isLoading && location.status === 'draft') updateLocation({ status: 'active' }, true)
  }, [location.status, managerView, teamsResource.isLoading, updateLocation])
  useEffect(() => {
    if (!resource.data || resource.error || resource.showingPreviousQuery) return
    const pages = Math.max(1, resource.data.pagination.totalPages)
    if (location.page > pages) updateLocation({ page: pages }, true)
  }, [location.page, resource.data, resource.error, resource.showingPreviousQuery, updateLocation])

  const countFor = (status: TrainingListStatus) => resource.data?.statusCounts[status]
  const filterItems = managerView ? [
    { value: 'active', label: '进行中', count: countFor('active') },
    { value: 'upcoming', label: '待开始', count: countFor('upcoming') },
    { value: 'draft', label: '草稿', count: countFor('draft') },
    { value: 'completed', label: '已结束', count: countFor('completed') },
  ] : [
    { value: 'active', label: '进行中', count: countFor('active') },
    { value: 'upcoming', label: '待开始', count: countFor('upcoming') },
    { value: 'completed', label: '已完成', count: countFor('completed') },
  ]
  const filtered = Boolean(location.keyword || (!teamId && listTeamId))
  const emptyCopy = filtered ? ['没有符合条件的训练', '调整关键词或训练范围后再试。']
    : managerView ? listFilter === 'draft' ? ['没有训练草稿', '未发布的课堂训练会保存在这里。']
      : listFilter === 'active' ? ['还没有进行中的训练', '布置一组题目给学生练习。']
        : listFilter === 'upcoming' ? ['没有待开始的训练', '设置未来的开始时间后，训练会出现在这里。']
          : ['还没有已结束的训练', '训练结束后会保留在这里，方便查看结果。']
    : listFilter === 'active' ? ['暂无训练', '目前老师还没有给你安排需要完成的训练。']
      : listFilter === 'upcoming' ? ['暂无待开始训练', '老师安排的后续训练会显示在这里。']
        : ['暂无已完成训练', '完成过的训练会保留在这里，方便以后复习。']

  const openSession = async (item: Session) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusyId(item.id)
    rememberPosition()
    try {
      if (item.canJoin) {
        const joined = await joinTrainingSession(item.id)
        if (!joined.ok) { toast.error(joined.error.message || '加入训练失败'); return }
      }
      router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${item.id}${item.status === 'DRAFT' ? '/design' : ''}`)
    } catch (error) { toast.error(error instanceof Error ? error.message : '无法打开训练') }
    finally { busyRef.current = false; setBusyId(null) }
  }
  const cloneSession = async (item: Session) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusyId(item.id)
    rememberPosition()
    try {
      const result = await cloneTrainingSession(item.id, { expectedRevision: item.statusRevision || 0 })
      if (!result.ok) { toast.error(result.error.message || '复制训练失败'); return }
      toast.success('已复制为新的训练草稿')
      router.push((organizationId ? '/org/' + organizationId : '/personal') + '/training-sessions/' + result.data.id + '/design')
    } catch (error) { toast.error(error instanceof Error ? error.message : '复制训练失败') }
    finally { busyRef.current = false; setBusyId(null) }
  }
  const actionLabel = (item: Session) => item.canJoin ? '加入训练'
    : item.status === 'DRAFT' ? '继续编辑'
      : item.status === 'RUNNING' || item.status === 'PAUSED' ? '进入课堂'
        : item.status === 'SCHEDULED' ? '查看设置' : '查看结果'
  const sessionFacts = (item: Session) => `${item.teamName || (organizationId ? '校级训练' : '个人团队')} · ${item._count.Participants} 人`
  const sessionProgress = (item: Session) => item.status === 'DRAFT' ? `已配置 ${item.problemCount || 0} 道题`
    : `${item.problemCount || 0} 道题${item.dueAt ? ` · 截止 ${new Date(item.dueAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}`

  return <PageFrame className={styles.trainingListFrame}>
    <PageHeader title="训练" description={managerView ? '管理和布置学生训练。' : '查看老师安排的训练并继续练习。'} actions={canCreateTraining ? <Button icon={<Plus size={17} />} onClick={() => setSetupOpen(true)}>布置训练</Button> : undefined} />
    <Tabs label={managerView ? '训练状态' : '我的训练状态'} value={listFilter} onChange={value => updateLocation({ status: value as TrainingListStatus })} items={filterItems} />
    <div className={listStyles.filters} role="search" aria-label="筛选训练">
      <FormField label="搜索训练"><Input type="search" aria-label="搜索训练" placeholder="搜索训练" value={keywordDraft} maxLength={200} onChange={event => setKeywordDraft(event.target.value)} /></FormField>
      {managerView && !teamId && <FormField label="训练范围"><Select aria-label="筛选团队" value={listTeamId} disabled={teamsResource.isLoading} onChange={event => updateLocation({ teamId: event.target.value })}>
        <option value="">全部训练范围</option>{organizationId && <option value="organization">校级训练</option>}
        {listTeamId && listTeamId !== 'organization' && !teams.some(team => team.id === listTeamId) && <option value={listTeamId}>当前链接指定的团队</option>}
        {teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}
      </Select></FormField>}
    </div>
    {teamsResource.error && <LoadError compact message={`训练列表仍可使用；团队筛选暂不可用：${teamsResource.error.message}`} onRetry={() => void teamsResource.retry()} />}
    <Section title={managerView ? '训练列表' : '我的训练'} description={resource.data ? `共 ${resource.data.pagination.total} 个` : undefined}>
      <AsyncRegion state={resource.state} onRetry={() => void resource.retry()}>{(data, refreshing) => <div aria-busy={refreshing}>
        {refreshing && <p className={listStyles.notice} role="status">{resource.showingPreviousQuery ? '正在更新筛选结果，暂时显示上一次列表…' : '正在更新训练列表…'}</p>}
        {resource.error && <p className={listStyles.notice}>以下为上一次成功获取的列表，可能不是最新结果。</p>}
        {!data.items.length ? <Empty title={emptyCopy[0]} description={emptyCopy[1]} action={filtered
          ? <Button variant="secondary" onClick={() => { setKeywordDraft(''); updateLocation({ keyword: '', teamId: '' }) }}>清空筛选</Button>
          : canCreateTraining && listFilter === 'active' ? <Button icon={<Plus size={16} />} onClick={() => setSetupOpen(true)}>布置训练</Button> : undefined} />
          : <div className={styles.sessionGrid}>{data.items.map(item => <article className={styles.sessionCard} key={item.id}>
            <div className={styles.sessionCardHeader}><h3>{item.title}</h3><StatusBadge variant={statusVariant(item.status)}>{trainingStatusLabel(item.status)}</StatusBadge></div>
            <p className={styles.sessionAudience}>{sessionFacts(item)}</p>{item.description && <p className={styles.muted}>{item.description}</p>}
            <p className={styles.sessionProgress}>{sessionProgress(item)}</p>
            <div className={styles.actions}>
              <Button variant={item.status === 'DRAFT' || item.canJoin || item.status === 'RUNNING' ? 'primary' : 'secondary'} disabled={Boolean(busyId) || resource.showingPreviousQuery} loading={busyId === item.id} onClick={() => void openSession(item)}>{actionLabel(item)}</Button>
              {managerView && <Button variant="outline" icon={<Copy size={15} />} disabled={Boolean(busyId) || resource.showingPreviousQuery} onClick={() => void cloneSession(item)}>复制训练</Button>}
            </div>
          </article>)}</div>}
        {data.pagination.totalPages > 1 && <div className={styles.pagination}><span>共 {data.pagination.total} 个 · 第 {location.page}/{Math.max(1, data.pagination.totalPages)} 页</span><div className={styles.actions}>
          <Button size="sm" variant="secondary" disabled={location.page <= 1 || resource.showingPreviousQuery} onClick={() => updateLocation({ page: location.page - 1 })}>上一页</Button>
          <Button size="sm" variant="secondary" disabled={location.page >= data.pagination.totalPages || resource.showingPreviousQuery} onClick={() => updateLocation({ page: location.page + 1 })}>下一页</Button>
        </div></div>}
      </div>}</AsyncRegion>
    </Section>
    <TrainingSetupDialog isOpen={setupOpen} organizationId={organizationId} fixedTeamId={teamId} teams={teams} onClose={() => setSetupOpen(false)} onPublished={resource.retry} />
  </PageFrame>
}
