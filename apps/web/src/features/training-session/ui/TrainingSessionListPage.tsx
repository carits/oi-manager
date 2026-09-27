'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Copy, Plus } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
import { Tabs } from '@/components/ui/Tabs'
import { StatusBadge } from '@/components/ui/Badge'
import { Empty } from '@/components/ui/Empty'
import { useToast } from '@/components/ui/Toast'
import { trainingStatusLabel } from '@/lib/humanPresentation'
import { cloneTrainingSession, joinTrainingSession, listManagedTrainingTeams, listTrainingSessions } from '../api/trainingSessionApi'
import { buildTrainingListQuery, resolveTrainingListTeamId } from '../model/trainingListScope'
import { TrainingSetupDialog, type TrainingSetupTeam } from './TrainingSetupDialog'
import styles from './TrainingEngine.module.css'

type ListFilter = 'active' | 'upcoming' | 'completed' | 'draft'
type Session = {
  id: string
  title: string
  description?: string
  status: string
  statusRevision?: number
  problemCount?: number
  dueAt?: string | null
  canJoin?: boolean
  teamId?: string | null
  teamName?: string | null
  _count: { Stages: number; Participants: number }
}
type SessionListPayload = {
  items: Session[]
  statusCounts: Record<ListFilter, number>
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}
type Team = TrainingSetupTeam & { owner?: { id?: string }; members?: Array<{ userId: string; role: string }> }
type TeamPayload = Team[] | { items?: Team[]; data?: Team[]; totalPages?: number }

const statusVariant = (status: string) =>
  status === 'RUNNING' ? 'success'
    : status === 'PAUSED' ? 'warning'
      : status === 'ENDED' || status === 'ARCHIVED' ? 'neutral'
        : 'info'

const normalizeTeams = (payload?: TeamPayload) =>
  Array.isArray(payload) ? payload : payload?.items || payload?.data || []

async function loadAllManagedTeams(organizationId?: string) {
  const base = new URLSearchParams({ view: 'managed', page: '1', pageSize: '100' })
  if (organizationId) base.set('organizationId', organizationId)
  const first = await listManagedTrainingTeams<TeamPayload>(base)
  if (!first.success || !first.data) return first
  const totalPages = Array.isArray(first.data) ? 1 : first.data.totalPages || 1
  if (totalPages <= 1) return first
  const remaining = await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => {
    const params = new URLSearchParams(base)
    params.set('page', String(index + 2))
    return listManagedTrainingTeams<TeamPayload>(params)
  }))
  const failedPage = remaining.find(result => !result.success)
  if (failedPage) return failedPage
  const data = [first, ...remaining].flatMap(result => normalizeTeams(result.data))
  return { success: true, status: 200, data } as const
}

export function TrainingSessionListPage({ organizationId, teamId }: { organizationId?: string; teamId?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const { user } = useAuth()
  const canViewTrainingManagement = Boolean(
    organizationId
    && (user?.organizationRole === 'teacher' || user?.organizationRole === 'school_principal'),
  )
  const urlTeamId = resolveTrainingListTeamId(teamId, searchParams.get('teamId'))
  const [sessions, setSessions] = useState<Session[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [setupOpen, setSetupOpen] = useState(false)
  const [cloningId, setCloningId] = useState<string>()
  const [listFilter, setListFilter] = useState<ListFilter>('active')
  const [listQuery, setListQuery] = useState('')
  const [listTeamId, setListTeamId] = useState(urlTeamId)
  const [listPage, setListPage] = useState(1)
  const [listTotal, setListTotal] = useState(0)
  const [listTotalPages, setListTotalPages] = useState(1)
  const [statusCounts, setStatusCounts] = useState<Record<ListFilter, number>>({ active: 0, upcoming: 0, completed: 0, draft: 0 })

  useEffect(() => {
    setListTeamId(current => current === urlTeamId ? current : urlTeamId)
    setListPage(1)
  }, [urlTeamId])

  const load = useCallback(async () => {
    setLoading(true)
    const query = buildTrainingListQuery({
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
        listTrainingSessions(query),
        teamId
          ? Promise.resolve({ success: true, data: [] as Team[], status: 200, message: undefined })
          : organizationId && canViewTrainingManagement
            ? loadAllManagedTeams(organizationId)
            : organizationId
              ? Promise.resolve({ success: true, data: [] as Team[], status: 200, message: undefined })
              : loadAllManagedTeams(),
      ])
      if (listResult.status === 'fulfilled') {
        const list = listResult.value as Session[] | SessionListPayload
        if (Array.isArray(list)) {
          setSessions(list)
          setStatusCounts({ active: 0, upcoming: 0, completed: 0, draft: 0 })
          setListTotal(list.length)
          setListTotalPages(1)
        } else {
          setSessions(list.items)
          setStatusCounts(list.statusCounts)
          setListTotal(list.pagination.total)
          setListTotalPages(Math.max(1, list.pagination.totalPages))
        }
      } else {
        toast.error(listResult.reason instanceof Error ? listResult.reason.message : '训练列表加载失败')
      }
      if (teamResult.status === 'fulfilled' && teamResult.value.success) {
        setTeams(normalizeTeams(teamResult.value.data))
      } else if (teamResult.status === 'rejected') {
        toast.error(teamResult.reason instanceof Error ? teamResult.reason.message : '可管理团队加载失败')
      } else if (!teamResult.value.success) {
        toast.error(teamResult.value.message || '可管理团队加载失败')
      }
    } finally {
      setLoading(false)
    }
  }, [canViewTrainingManagement, listFilter, listPage, listQuery, listTeamId, organizationId, teamId, toast])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timer)
  }, [load])

  const canCreateTraining = canViewTrainingManagement || Boolean(!organizationId && (teamId || teams.length))
  const managerView = canCreateTraining
  useEffect(() => {
    if (!managerView && listFilter === 'draft') setListFilter('active')
  }, [listFilter, managerView])

  const countFor = (filter: ListFilter) => statusCounts[filter] || 0
  const filterItems = managerView
    ? [
        { value: 'active', label: '进行中', count: countFor('active') },
        { value: 'upcoming', label: '待开始', count: countFor('upcoming') },
        { value: 'draft', label: '草稿', count: countFor('draft') },
        { value: 'completed', label: '已结束', count: countFor('completed') },
      ]
    : [
        { value: 'active', label: '进行中', count: countFor('active') },
        { value: 'upcoming', label: '待开始', count: countFor('upcoming') },
        { value: 'completed', label: '已完成', count: countFor('completed') },
      ]
  const emptyCopy = managerView
    ? listFilter === 'draft' ? ['没有训练草稿', '未发布的课堂训练会保存在这里。']
      : listFilter === 'active' ? ['还没有进行中的训练', '布置一组题目给学生练习，通常几分钟即可完成。']
        : listFilter === 'upcoming' ? ['没有待开始的训练', '设置未来的开始时间后，训练会出现在这里。']
          : ['还没有已结束的训练', '训练结束后会保留在这里，方便查看结果。']
    : listFilter === 'active' ? ['暂无训练', '目前老师还没有给你安排需要完成的训练。']
      : listFilter === 'upcoming' ? ['暂无待开始训练', '老师安排的后续训练会显示在这里。']
        : ['暂无已完成训练', '完成过的训练会保留在这里，方便以后复习。']

  const openSession = async (item: Session) => {
    if (item.canJoin) {
      const joined = await joinTrainingSession(item.id)
      if (!joined.ok) return toast.error(joined.error.message || '加入训练失败')
    }
    router.push(`${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${item.id}${item.status === 'DRAFT' ? '/design' : ''}`)
  }
  const cloneSession = async (item: Session) => {
    if (cloningId) return
    setCloningId(item.id)
    const result = await cloneTrainingSession(item.id, { expectedRevision: item.statusRevision || 0 })
    setCloningId(undefined)
    if (!result.ok) return toast.error(result.error.message || '复制训练失败')
    toast.success('已复制为新的训练草稿')
    router.push((organizationId ? '/org/' + organizationId : '/personal') + '/training-sessions/' + result.data.id + '/design')
  }
  const actionLabel = (item: Session) =>
    item.canJoin ? '加入训练'
      : item.status === 'DRAFT' ? '继续编辑'
        : item.status === 'RUNNING' || item.status === 'PAUSED' ? '进入课堂'
          : item.status === 'SCHEDULED' ? '查看设置'
            : '查看结果'
  const sessionFacts = (item: Session) =>
    `${item.teamName || (organizationId ? '校级训练' : '个人团队')} · ${item._count.Participants} 人`
  const sessionProgress = (item: Session) =>
    item.status === 'DRAFT'
      ? `已配置 ${item.problemCount || 0} 道题`
      : `${item.problemCount || 0} 道题${item.dueAt ? ` · 截止 ${new Date(item.dueAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}`

  return <PageFrame className={styles.trainingListFrame}><div className={styles.stack}>
    <PageHeader title="训练" description={managerView ? '管理和布置学生训练。' : '查看老师安排的训练并继续练习。'} actions={canCreateTraining ? <Button icon={<Plus size={17} />} onClick={() => setSetupOpen(true)}>布置训练</Button> : undefined} />
    <div className={styles.listControls}>
      <Tabs label={managerView ? '训练状态' : '我的训练状态'} value={listFilter} onChange={value => { setListFilter(value as ListFilter); setListPage(1) }} items={filterItems} />
      {managerView && <div className={styles.listFilters}>{teams.length > 0 && <Select aria-label="筛选团队" value={listTeamId} onChange={event => { const value = event.target.value; setListTeamId(value); setListPage(1); const params = new URLSearchParams(searchParams.toString()); if (value) params.set('teamId', value); else params.delete('teamId'); router.replace(`?${params}`) }}><option value="">全部训练范围</option>{organizationId && <option value="organization">校级训练</option>}{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select>}<Input aria-label="搜索训练" placeholder="搜索训练" value={listQuery} onChange={event => { setListQuery(event.target.value); setListPage(1) }} /></div>}
    </div>
    <Section title={managerView ? '训练列表' : '我的训练'} description={loading ? '正在准备训练列表…' : listTotal ? `共 ${listTotal} 个` : undefined}>
      {loading ? <p className={styles.loadingCopy}>正在准备训练列表…</p>
        : !sessions.length ? <Empty title={emptyCopy[0]} description={emptyCopy[1]} action={canCreateTraining && listFilter === 'active' ? <Button icon={<Plus size={16} />} onClick={() => setSetupOpen(true)}>布置训练</Button> : undefined} />
          : <div className={styles.sessionGrid}>{sessions.map(item => <article className={styles.sessionCard} key={item.id}><div className={styles.sessionCardHeader}><h3>{item.title}</h3><StatusBadge variant={statusVariant(item.status)}>{trainingStatusLabel(item.status)}</StatusBadge></div><p className={styles.sessionAudience}>{sessionFacts(item)}</p>{item.description && <p className={styles.muted}>{item.description}</p>}<p className={styles.sessionProgress}>{sessionProgress(item)}</p><div className={styles.actions}><Button variant={item.status === 'DRAFT' || item.canJoin || item.status === 'RUNNING' ? 'primary' : 'secondary'} onClick={() => void openSession(item)}>{actionLabel(item)}</Button>{managerView && <Button variant="outline" icon={<Copy size={15} />} loading={cloningId === item.id} disabled={Boolean(cloningId)} onClick={() => void cloneSession(item)}>复制训练</Button>}</div></article>)}</div>}
      {listTotalPages > 1 && <div className={styles.pagination}><span>共 {listTotal} 个 · 第 {listPage}/{listTotalPages} 页</span><div className={styles.actions}><Button size="sm" variant="secondary" disabled={listPage <= 1 || loading} onClick={() => setListPage(page => page - 1)}>上一页</Button><Button size="sm" variant="secondary" disabled={listPage >= listTotalPages || loading} onClick={() => setListPage(page => page + 1)}>下一页</Button></div></div>}
    </Section>
    <TrainingSetupDialog isOpen={setupOpen} organizationId={organizationId} fixedTeamId={teamId} teams={teams} onClose={() => setSetupOpen(false)} onPublished={load} />
  </div></PageFrame>
}
