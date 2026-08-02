'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Copy, Plus, RotateCcw, Search } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import apiClient from '@/lib/apiClient'
import { OJ_PLATFORMS, OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { Button } from '@/components/ui/Button'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { Toolbar, ToolbarGroup } from '@/components/ui/Toolbar'
import { useToast } from '@/components/ui/Toast'
import styles from './ProblemList.module.css'

type LibraryScope = 'school' | 'platform'

interface ProblemPermissions {
  canEdit: boolean
  canPublish: boolean
  canArchive: boolean
  canCopyToSchool: boolean
}

interface Problem {
  id: string
  title: string
  problemId: string
  platform: string
  difficulty?: string | null
  platforms?: string[]
  status: 'draft' | 'published' | 'archived'
  ownerId: string
  ownerName: string
  createdAt: string
  publishedAt?: string | null
  permissions: ProblemPermissions
}

interface ProblemListResponse {
  data: Problem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface LibraryCreator { id: string; name: string; count: number }
interface ProblemListProps { role: 'teacher' | 'student' | 'admin' }

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已归档' },
]

const statusBadge = (status: Problem['status']) => {
  if (status === 'published') return <StatusBadge variant="success">已发布</StatusBadge>
  if (status === 'archived') return <StatusBadge variant="neutral">已归档</StatusBadge>
  return <StatusBadge variant="warning">草稿</StatusBadge>
}

const difficultyBadge = (difficulty?: string | null) => {
  if (!difficulty) return <StatusBadge variant="neutral">未标注</StatusBadge>
  const variant = difficulty === '简单' ? 'success' : difficulty === '困难' ? 'error' : 'warning'
  return <StatusBadge variant={variant}>{difficulty}</StatusBadge>
}

export function ProblemList({ role }: ProblemListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { sessionKey } = useAuth()
  const toast = useToast()
  const isTeacherWorkspace = role === 'teacher'
  const library: LibraryScope = isTeacherWorkspace && searchParams.get('library') !== 'platform'
    ? 'school'
    : 'platform'
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = Math.max(10, Number(searchParams.get('pageSize')) || 20)
  const keyword = searchParams.get('keyword') || ''
  const platform = searchParams.get('platform') || ''
  const status = library === 'school' ? searchParams.get('status') || '' : ''
  const ownerId = library === 'school' ? searchParams.get('ownerId') || '' : ''
  const [searchInput, setSearchInput] = useState(keyword)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const pathPrefix = role === 'admin' ? '/platform-admin' : role === 'student' ? '/personal' : '/teacher'

  useEffect(() => setSearchInput(keyword), [keyword])

  const query = new URLSearchParams({ library, page: String(page), pageSize: String(pageSize) })
  if (keyword) query.set('keyword', keyword)
  if (platform) query.set('platform', platform)
  if (status) query.set('status', status)
  if (ownerId) query.set('ownerId', ownerId)
  const resource = useResource<ProblemListResponse>(`/api/problems?${query}`, {
    sessionKey,
    isEmpty: data => data.data.length === 0,
    dedupingInterval: 15000,
  })
  const creators = useResource<LibraryCreator[]>(
    isTeacherWorkspace && library === 'school' ? '/api/problems/library/creators' : null,
    { sessionKey, isEmpty: data => data.length === 0, dedupingInterval: 30000 },
  )
  const problems = resource.data?.data || []
  const total = resource.data?.total || 0
  const totalPages = resource.data?.totalPages || 1

  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false })
  }

  const switchLibrary = (nextLibrary: LibraryScope) => {
    navigate({
      library: nextLibrary === 'school' ? null : 'platform',
      status: null,
      ownerId: null,
      page: null,
    })
  }

  const copyToSchool = async (problem: Problem) => {
    if (copyingId) return
    setCopyingId(problem.id)
    const result = await apiClient.mutate<{ problem: { id: string }; skippedFiles: string[] }>(
      `/api/problems/${problem.id}/copy-to-school`,
      'POST',
    )
    setCopyingId(null)
    if (result.ok) {
      if (result.data.skippedFiles.length > 0) {
        toast.warning('题目已复制，部分外部文件需要在编辑页确认')
      } else {
        toast.success('已复制到校内题库，并保存为草稿')
      }
      router.push(`/teacher/problems/${result.data.problem.id}/edit`)
      return
    }
    const existingId = (result.error.data as { id?: string } | undefined)?.id
    if (result.error.code === 'SCHOOL_PROBLEM_EXISTS') {
      toast.info('本校题库已经有这道题')
      if (existingId) router.push(`/teacher/problems/${existingId}`)
      return
    }
    toast.error(result.error.message)
  }

  const resetFilters = () => {
    setSearchInput('')
    navigate({ keyword: null, platform: null, status: null, ownerId: null, page: null })
  }

  return (
    <PageFrame>
      <PageHeader
        title={library === 'school' ? '校内题库' : role === 'student' ? '题库' : '平台题库'}
        description={library === 'school'
          ? '维护本校教学题目。草稿仅创建教师与学校负责人可见。'
          : isTeacherWorkspace
            ? '浏览平台已发布题目，复制后可在本校独立修改。'
            : '浏览平台已发布题目。'}
        actions={isTeacherWorkspace && library === 'school'
          ? <Button icon={<Plus size={17} />} onClick={() => router.push('/teacher/problems/new')}>新建题目</Button>
          : undefined}
      />

      {isTeacherWorkspace && (
        <Tabs
          label="题库范围"
          value={library}
          onChange={switchLibrary}
          items={[
            { value: 'school', label: '校内题库' },
            { value: 'platform', label: '平台题库' },
          ]}
        />
      )}

      <Toolbar>
        <ToolbarGroup>
          <select className={styles.search} style={{ width: 150 }} aria-label="来源平台" value={platform} onChange={event => navigate({ platform: event.target.value || null, page: null })}>
            {OJ_PLATFORMS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {library === 'school' && (
            <select className={styles.search} style={{ width: 140 }} aria-label="题目状态" value={status} onChange={event => navigate({ status: event.target.value || null, page: null })}>
              {statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
          {library === 'school' && creators.data && creators.data.length > 0 && (
            <select className={styles.search} style={{ width: 170 }} aria-label="创建教师" value={ownerId} onChange={event => navigate({ ownerId: event.target.value || null, page: null })}>
              <option value="">全部创建教师</option>
              {creators.data.map(creator => <option key={creator.id} value={creator.id}>{creator.name} ({creator.count})</option>)}
            </select>
          )}
          <input
            className={styles.search}
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') navigate({ keyword: searchInput.trim() || null, page: null }) }}
            placeholder="搜索题号或标题"
            aria-label="搜索题目"
          />
        </ToolbarGroup>
        <ToolbarGroup>
          {(keyword || platform || status || ownerId) && <Button variant="secondary" icon={<RotateCcw size={16} />} onClick={resetFilters}>重置</Button>}
          <Button icon={<Search size={16} />} onClick={() => navigate({ keyword: searchInput.trim() || null, page: null })}>搜索</Button>
        </ToolbarGroup>
      </Toolbar>

      <Table
        data={problems}
        loading={resource.state.state === 'pending' && !resource.state.previousData}
        refreshing={resource.state.state === 'ready' && resource.state.refreshing}
        error={resource.state.state === 'error' && !resource.state.previousData ? resource.state.error.message : undefined}
        onRetry={resource.retry}
        emptyText="暂无题目"
        emptyDescription={library === 'school' ? '新建题目，或从平台题库复制一份到本校。' : '当前筛选条件下没有平台题目。'}
        rowKey={problem => problem.id}
        onRowClick={problem => router.push(`${pathPrefix}/problems/${problem.id}`)}
        actions={isTeacherWorkspace && library === 'platform'
          ? problem => problem.permissions.canCopyToSchool
            ? <Button size="sm" variant="secondary" icon={<Copy size={15} />} loading={copyingId === problem.id} onClick={() => void copyToSchool(problem)}>复制到校内</Button>
            : null
          : undefined}
        columns={[
          { key: 'platform', label: '来源', width: '140px', render: problem => (problem.platforms || [problem.platform]).filter(Boolean).map(value => OJ_PLATFORM_LABEL_MAP[value] || value).join(', ') || '-' },
          { key: 'problemId', label: '题号', width: '130px', render: problem => <span className={styles.titleLink}>{problem.problemId}</span> },
          { key: 'title', label: '标题' },
          ...(library === 'school' ? [
            { key: 'status', label: '状态', width: '100px', render: (problem: Problem) => statusBadge(problem.status) },
            { key: 'ownerName', label: '创建教师', width: '140px' },
            { key: 'publishedAt', label: '发布时间', width: '150px', render: (problem: Problem) => problem.publishedAt ? new Date(problem.publishedAt).toLocaleDateString('zh-CN') : '-' },
          ] : []),
          { key: 'difficulty', label: '难度', width: '110px', render: problem => difficultyBadge(problem.difficulty) },
        ]}
      />
      {total > 0 && <Pagination currentPage={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={nextPage => navigate({ page: nextPage <= 1 ? null : String(nextPage) })} onPageSizeChange={nextSize => navigate({ pageSize: String(nextSize), page: null })} />}
    </PageFrame>
  )
}
