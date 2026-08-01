'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus, RotateCcw, Search } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import { OJ_PLATFORMS, OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { Button } from '@/components/ui/Button'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { Toolbar, ToolbarGroup } from '@/components/ui/Toolbar'
import styles from './ProblemList.module.css'

interface Problem { id: string; title: string; problemId: string; platform: string; difficulty?: string; platforms?: string[]; createdAt: string }
interface ProblemListResponse { data?: Problem[]; list?: Problem[]; total: number; page: number; pageSize: number; totalPages: number }
interface ProblemListProps { role: string }

export function ProblemList({ role }: ProblemListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { sessionKey } = useAuth()
  const activeTab: 'private' | 'public' = searchParams.get('tab') === 'private' ? 'private' : 'public'
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = Math.max(10, Number(searchParams.get('pageSize')) || 20)
  const keyword = searchParams.get('keyword') || ''
  const platform = searchParams.get('platform') || ''
  const [searchInput, setSearchInput] = useState(keyword)
  const pathPrefix = role === 'admin' ? '/platform-admin' : role === 'student' ? '/student' : '/teacher'
  const canCreate = ['teacher', 'student', 'admin'].includes(role)

  useEffect(() => setSearchInput(keyword), [keyword])

  const query = new URLSearchParams({ visibility: activeTab, page: String(page), pageSize: String(pageSize) })
  if (keyword) query.set('keyword', keyword)
  if (platform) query.set('platform', platform)
  const resource = useResource<ProblemListResponse>(`/api/problems?${query}`, { sessionKey, isEmpty: data => (data.data || data.list || []).length === 0, dedupingInterval: 15000 })
  const problems = resource.data?.data || resource.data?.list || []
  const total = resource.data?.total || 0
  const totalPages = resource.data?.totalPages || 1

  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false })
  }

  const difficultyBadge = (difficulty?: string) => {
    if (!difficulty) return <StatusBadge variant="neutral">未标注</StatusBadge>
    const variant = difficulty === '简单' ? 'success' : difficulty === '困难' ? 'error' : 'warning'
    return <StatusBadge variant={variant}>{difficulty}</StatusBadge>
  }

  return (
    <PageFrame>
      <PageHeader title="题库" description="搜索公共题目，或维护当前账号创建的题目。" actions={canCreate ? <Button icon={<Plus size={17} />} onClick={() => router.push(`${pathPrefix}/problems/new`)}>新建题目</Button> : undefined} />
      <Tabs label="题库范围" value={activeTab} onChange={tab => navigate({ tab: tab === 'public' ? null : tab, page: null })} items={[{ value: 'public', label: '公共题库' }, { value: 'private', label: role === 'admin' ? '私有题库' : '我的题库' }]} />
      <Toolbar>
        <ToolbarGroup>
          {activeTab === 'public' && <select className={styles.search} style={{ width: 150 }} aria-label="题目平台" value={platform} onChange={event => navigate({ platform: event.target.value || null, page: null })}>{OJ_PLATFORMS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
          <input className={styles.search} value={searchInput} onChange={event => setSearchInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') navigate({ keyword: searchInput.trim() || null, page: null }) }} placeholder="搜索题号或标题" aria-label="搜索题目" />
        </ToolbarGroup>
        <ToolbarGroup>{(keyword || platform) && <Button variant="secondary" icon={<RotateCcw size={16} />} onClick={() => { setSearchInput(''); navigate({ keyword: null, platform: null, page: null }) }}>重置</Button>}<Button icon={<Search size={16} />} onClick={() => navigate({ keyword: searchInput.trim() || null, page: null })}>搜索</Button></ToolbarGroup>
      </Toolbar>
      <Table
        data={problems}
        loading={resource.state.state === 'pending' && !resource.state.previousData}
        refreshing={resource.state.state === 'ready' && resource.state.refreshing}
        error={resource.state.state === 'error' && !resource.state.previousData ? resource.state.error.message : undefined}
        onRetry={resource.retry}
        emptyText="暂无题目"
        emptyDescription={activeTab === 'public' ? '当前筛选下没有公共题目。' : '创建题目后会显示在这里。'}
        rowKey={problem => problem.id}
        onRowClick={problem => router.push(`${pathPrefix}/problems/${problem.id}`)}
        columns={[
          { key: 'platform', label: '平台', width: '150px', render: problem => (problem.platforms || [problem.platform]).filter(Boolean).map(value => OJ_PLATFORM_LABEL_MAP[value] || value).join(', ') || '—' },
          { key: 'problemId', label: '题号', width: '130px', render: problem => <span className={styles.titleLink}>{problem.problemId}</span> },
          { key: 'title', label: '标题' },
          { key: 'difficulty', label: '难度', width: '110px', render: problem => difficultyBadge(problem.difficulty) },
        ]}
      />
      {total > 0 && <Pagination currentPage={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={nextPage => navigate({ page: nextPage <= 1 ? null : String(nextPage) })} onPageSizeChange={nextSize => navigate({ pageSize: String(nextSize), page: null })} />}
    </PageFrame>
  )
}
