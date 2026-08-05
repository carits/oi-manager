'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { RotateCcw, Search } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import { JUDGE_RESULT_OPTIONS, LANGUAGE_OPTIONS, JUDGE_RESULT_LABEL_MAP, getLanguageLabel } from '@/lib/judge-constants'
import { SUBMISSION_OJ_OPTIONS, OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { Button } from '@/components/ui/Button'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { StatusBadge, getResultVariant } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { Toolbar, ToolbarGroup } from '@/components/ui/Toolbar'
import { UserIdentityLink } from '@/components/profile/UserIdentityLink'
import styles from './SubmissionList.module.css'

interface Submission { id: number; userId?: string; userType?: 'student' | 'teacher' | 'user'; username: string; oj: string; problemId: string; problemInternalId?: string; problemVisibility?: string | null; result: string; timeUsed: number | null; memoryUsed: number | null; codeLength: number | null; language: string; submittedAt: string }
interface SubmissionPayload { submissions?: Submission[]; totalPages?: number; total?: number }
interface SubmissionListProps { viewRole: 'teacher' | 'student' | 'admin' }

const fields = ['username', 'oj', 'problemId', 'result', 'language'] as const
type FilterField = typeof fields[number]

function externalProblemUrl(oj: string, problemId: string) {
  if (oj === 'luogu') return `https://www.luogu.com.cn/problem/${problemId}`
  if (oj === 'codeforces') {
    const contestId = problemId.match(/^(\d+)/)?.[1]
    if (contestId) return `https://codeforces.com/problemset/problem/${contestId}/${problemId.replace(contestId, '')}`
  }
  return null
}

export function SubmissionList({ viewRole }: SubmissionListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, sessionKey } = useAuth()
  const pathPrefix = user?.workspaceMode === 'personal'
    ? '/personal'
    : viewRole === 'admin'
      ? '/platform-admin'
      : viewRole === 'student'
        ? '/student'
        : '/teacher'
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = 20
  const [draft, setDraft] = useState<Record<FilterField, string>>(() => Object.fromEntries(fields.map(field => [field, searchParams.get(field) || ''])) as Record<FilterField, string>)

  useEffect(() => {
    setDraft(Object.fromEntries(fields.map(field => [field, searchParams.get(field) || ''])) as Record<FilterField, string>)
  }, [searchParams])

  const query = new URLSearchParams()
  fields.forEach(field => { const value = searchParams.get(field); if (value) query.set(field, value) })
  query.set('page', String(page))
  query.set('pageSize', String(pageSize))
  const resource = useResource<SubmissionPayload>(`/api/submissions?${query}`, { sessionKey, isEmpty: data => (data.submissions || []).length === 0, dedupingInterval: 10000 })
  const submissions = resource.data?.submissions || []
  const total = resource.data?.total || 0
  const totalPages = resource.data?.totalPages || 1

  const navigate = (next: URLSearchParams) => router.replace(`${pathPrefix}/submissions${next.size ? `?${next}` : ''}`, { scroll: false })
  const applyFilters = () => {
    const next = new URLSearchParams()
    fields.forEach(field => { if (draft[field].trim()) next.set(field, draft[field].trim()) })
    navigate(next)
  }
  const reset = () => { setDraft({ username: '', oj: '', problemId: '', result: '', language: '' }); navigate(new URLSearchParams()) }
  const setPage = (nextPage: number) => { const next = new URLSearchParams(searchParams.toString()); nextPage <= 1 ? next.delete('page') : next.set('page', String(nextPage)); navigate(next) }

  const problemCell = (submission: Submission) => {
    const canOpenLocal = submission.problemInternalId && ['public', 'private'].includes(submission.problemVisibility || '')
    if (canOpenLocal) return <Link className={styles.link} href={`${pathPrefix}/problems/${submission.problemInternalId}`}>{submission.problemId}</Link>
    const external = externalProblemUrl(submission.oj, submission.problemId)
    return external ? <a className={styles.link} href={external} target="_blank" rel="noreferrer">{submission.problemId}</a> : submission.problemId
  }

  return (
    <PageFrame>
      <PageHeader title="评测记录" description="按用户、题目、结果和语言定位提交。" />
      <Toolbar>
        <ToolbarGroup className={styles.filters}>
          {viewRole !== 'student' && <input className={styles.input} aria-label="用户名" placeholder="用户名" value={draft.username} onChange={event => setDraft(current => ({ ...current, username: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters() }} />}
          <select className={styles.select} aria-label="OJ 平台" value={draft.oj} onChange={event => setDraft(current => ({ ...current, oj: event.target.value }))}>{SUBMISSION_OJ_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <input className={styles.input} aria-label="题号" placeholder="题号" value={draft.problemId} onChange={event => setDraft(current => ({ ...current, problemId: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters() }} />
          <select className={styles.select} aria-label="评测结果" value={draft.result} onChange={event => setDraft(current => ({ ...current, result: event.target.value }))}>{JUDGE_RESULT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <select className={styles.select} aria-label="语言" value={draft.language} onChange={event => setDraft(current => ({ ...current, language: event.target.value }))}>{LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        </ToolbarGroup>
        <ToolbarGroup><Button variant="secondary" icon={<RotateCcw size={16} />} onClick={reset}>重置</Button><Button icon={<Search size={16} />} onClick={applyFilters}>筛选</Button></ToolbarGroup>
      </Toolbar>
      <Table
        data={submissions}
        loading={resource.state.state === 'pending' && !resource.state.previousData}
        refreshing={resource.state.state === 'ready' && resource.state.refreshing}
        error={resource.state.state === 'error' && !resource.state.previousData ? resource.state.error.message : undefined}
        onRetry={resource.retry}
        emptyText="暂无评测记录"
        rowKey={item => String(item.id)}
        onRowClick={item => router.push(`${pathPrefix}/submissions/${item.id}`)}
        columns={[
          { key: 'id', label: '提交', width: '86px', render: item => <span className={styles.link}>#{item.id}</span> },
          ...(viewRole === 'student' ? [] : [{ key: 'username', label: '用户', width: '120px', render: (item: Submission) => <UserIdentityLink id={item.userId} userType={item.userType} username={item.username} /> }]),
          { key: 'oj', label: '平台', width: '110px', render: item => item.oj === 'carits' ? 'Carits' : OJ_PLATFORM_LABEL_MAP[item.oj] || item.oj.toUpperCase() },
          { key: 'problemId', label: '题目', render: problemCell },
          { key: 'result', label: '结果', width: '120px', render: item => <StatusBadge variant={getResultVariant(item.result)}>{JUDGE_RESULT_LABEL_MAP[item.result] || item.result}</StatusBadge> },
          { key: 'performance', label: '性能', width: '140px', render: item => `${item.timeUsed ?? '—'} ms · ${item.memoryUsed == null ? '—' : `${(item.memoryUsed / 1024).toFixed(2)} MB`}` },
          { key: 'language', label: '语言', width: '100px', render: item => getLanguageLabel(item.language) },
          { key: 'submittedAt', label: '提交时间', width: '170px', render: item => new Date(item.submittedAt).toLocaleString('zh-CN') },
        ]}
      />
      {total > 0 && <Pagination currentPage={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />}
    </PageFrame>
  )
}
