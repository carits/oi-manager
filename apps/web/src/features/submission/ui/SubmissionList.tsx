'use client'

import { useEffect, useState, type SyntheticEvent } from 'react'
import dynamic from 'next/dynamic'
import { Input, Select } from '@/components/ui/FormControls'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RotateCcw, Search } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { hasAccountCapability } from '@/lib/capabilities'
import { useResource } from '@/hooks/useResource'
import { JUDGE_RESULT_OPTIONS, LANGUAGE_OPTIONS, getLanguageLabel, judgeResultLabel } from '@/lib/judge-constants'
import { SUBMISSION_OJ_OPTIONS, ojPlatformDisplayName } from '@/lib/oj-platforms'
import { Button } from '@/components/ui/Button'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { StatusBadge, getResultVariant } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { UserIdentityLink } from '@/features/user-profile'
import styles from './SubmissionList.module.css'

const SubmissionDetailModal = dynamic(
  () => import('./SubmissionDetailModal').then(module => module.SubmissionDetailModal),
  { ssr: false },
)

interface Submission { id: number; userId?: string; userType?: 'student' | 'teacher' | 'user'; username: string; oj: string; problemId: string; problemInternalId?: string; problemVisibility?: string | null; result: string; timeUsed: number | null; memoryUsed: number | null; codeLength: number | null; language: string; submittedAt: string }
interface SubmissionPayload { submissions?: Submission[]; totalPages?: number; total?: number; scope?: 'all' | 'personal' | 'campus' }
interface SubmissionListProps { viewRole: 'teacher' | 'student' | 'admin' }

const fields = ['username', 'oj', 'problemId', 'result', 'language'] as const
type FilterField = typeof fields[number]

const stopRowActivation = (event: SyntheticEvent) => event.stopPropagation()

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
  const pathname = usePathname()
  // 管理员权限以当前会话的全局角色为准，不能被旧入口或个人区路径降级。
  const isGlobalAdmin = hasAccountCapability(user?.accountRole, 'view-all-submissions')
  const isAdminView = viewRole === 'admin' || isGlobalAdmin
  const adminHome = user?.accountRole === 'super_admin' ? '/admin' : '/platform-admin'
  const pathPrefix = currentWorkspacePrefix(pathname, isAdminView ? adminHome : '/personal')
  const campusStudentView = viewRole === 'student' && pathname.startsWith('/org/')
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSizeOptions = [20, 50, 100]
  const requestedPageSize = Number(searchParams.get('pageSize'))
  const pageSize = isAdminView && pageSizeOptions.includes(requestedPageSize)
    ? requestedPageSize
    : 20
  const [draft, setDraft] = useState<Record<FilterField, string>>(() => Object.fromEntries(fields.map(field => [field, searchParams.get(field) || ''])) as Record<FilterField, string>)
  const [detailSubmissionId, setDetailSubmissionId] = useState<number | null>(null)

  useEffect(() => {
    setDraft(Object.fromEntries(fields.map(field => [field, searchParams.get(field) || ''])) as Record<FilterField, string>)
  }, [searchParams])

  const query = new URLSearchParams()
  fields.forEach(field => { const value = searchParams.get(field); if (value) query.set(field, value) })
  query.set('page', String(page))
  query.set('pageSize', String(pageSize))
  if (isAdminView) query.set('scope', 'all')
  const resource = useResource<SubmissionPayload>(`/api/submissions?${query}`, { sessionKey, isEmpty: data => (data.submissions || []).length === 0, dedupingInterval: 10000 })
  const submissions = resource.data?.submissions || []
  const total = resource.data?.total || 0
  const totalPages = resource.data?.totalPages || 1
  const isGlobalAdminView = isAdminView && (resource.data?.scope === 'all' || resource.data?.scope == null)
  const showUsernameFilter = viewRole !== 'student' || isGlobalAdmin
  const displayStart = total > 0 ? (page - 1) * pageSize + 1 : 0
  const displayEnd = total > 0 ? Math.min(page * pageSize, total) : 0
  const pageDescription = isGlobalAdminView
    ? '查看全平台所有用户、个人区、校园区和比赛提交。'
    : showUsernameFilter
      ? '按用户、平台、题目、结果和语言定位提交。'
      : '按平台、题目、结果和语言定位自己的提交。'

  useEffect(() => {
    if (!submissions.some(item => item.result === 'queuing' || item.result === 'judging')) return
    const timer = window.setInterval(() => { void resource.mutate() }, 5000)
    return () => window.clearInterval(timer)
  }, [resource, submissions])

  const navigate = (next: URLSearchParams) => router.replace(`${pathPrefix}/submissions${next.size ? `?${next}` : ''}`, { scroll: false })
  const applyFilters = () => {
    const next = new URLSearchParams()
    fields.forEach(field => { if (draft[field].trim()) next.set(field, draft[field].trim()) })
    navigate(next)
  }
  const reset = () => { setDraft({ username: '', oj: '', problemId: '', result: '', language: '' }); navigate(new URLSearchParams()) }
  const setPage = (nextPage: number) => { const next = new URLSearchParams(searchParams.toString()); nextPage <= 1 ? next.delete('page') : next.set('page', String(nextPage)); navigate(next) }
  const setPageSize = (nextPageSize: number) => {
    if (!pageSizeOptions.includes(nextPageSize)) return
    const next = new URLSearchParams(searchParams.toString())
    next.delete('page')
    nextPageSize === 20 ? next.delete('pageSize') : next.set('pageSize', String(nextPageSize))
    navigate(next)
  }

  const problemCell = (submission: Submission) => {
    // Campus students do not have direct access to the school problem library.
    // Their submission row still opens the authorized submission detail, but
    // linking the problem cell to /org/:id/problems/:id only bounces them back
    // to the overview and presents a false interactive affordance.
    const canOpenLocal = !campusStudentView && submission.problemInternalId && ['public', 'private'].includes(submission.problemVisibility || '')
    if (canOpenLocal) return <Link className={styles.link} href={`${pathPrefix}/problems/${submission.problemInternalId}`} onClick={stopRowActivation} onKeyDown={stopRowActivation}>{submission.problemId}</Link>
    const external = externalProblemUrl(submission.oj, submission.problemId)
    return external ? <a className={styles.link} href={external} target="_blank" rel="noreferrer" onClick={stopRowActivation} onKeyDown={stopRowActivation}>{submission.problemId}</a> : submission.problemId
  }

  return (
    <PageFrame>
      <PageHeader title="评测记录" description={pageDescription} />
      {isGlobalAdminView && <div className={styles.scopeSummary} role="status"><strong>管理员全量视图</strong><span>全平台所有用户、个人区、校园区和比赛提交</span>{total > 0 && <span>当前显示第 {displayStart}–{displayEnd} 条，共 {total} 条</span>}</div>}
      <form
        className={styles.filterPanel}
        role="search"
        aria-label="评测记录筛选"
        onSubmit={event => { event.preventDefault(); applyFilters() }}
      >
        <div className={`${styles.filterGrid} ${showUsernameFilter ? styles.filterGridWithUser : styles.filterGridPersonal}`}>
          {showUsernameFilter && (
            <label className={styles.filterField} htmlFor="submission-filter-username">
              <span>用户名</span>
              <Input id="submission-filter-username" className={styles.filterControl} placeholder="输入用户名" value={draft.username} onChange={event => setDraft(current => ({ ...current, username: event.target.value }))} />
            </label>
          )}
          <label className={styles.filterField} htmlFor="submission-filter-platform">
            <span>平台</span>
            <Select id="submission-filter-platform" className={styles.filterControl} value={draft.oj} onChange={event => setDraft(current => ({ ...current, oj: event.target.value }))}>{SUBMISSION_OJ_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
          </label>
          <label className={styles.filterField} htmlFor="submission-filter-problem">
            <span>题号</span>
            <Input id="submission-filter-problem" className={styles.filterControl} placeholder="例如 1041" value={draft.problemId} onChange={event => setDraft(current => ({ ...current, problemId: event.target.value }))} />
          </label>
          <label className={styles.filterField} htmlFor="submission-filter-result">
            <span>评测结果</span>
            <Select id="submission-filter-result" className={styles.filterControl} value={draft.result} onChange={event => setDraft(current => ({ ...current, result: event.target.value }))}>{JUDGE_RESULT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
          </label>
          <label className={styles.filterField} htmlFor="submission-filter-language">
            <span>语言</span>
            <Select id="submission-filter-language" className={styles.filterControl} value={draft.language} onChange={event => setDraft(current => ({ ...current, language: event.target.value }))}>{LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
          </label>
          <div className={styles.filterActions}>
            <Button type="button" variant="secondary" icon={<RotateCcw size={16} />} onClick={reset}>重置</Button>
            <Button type="submit" icon={<Search size={16} />}>筛选</Button>
          </div>
        </div>
      </form>
      <Table
        caption="评测记录列表"
        data={submissions}
        loading={resource.state.state === 'pending' && !resource.state.previousData}
        refreshing={resource.state.state === 'ready' && resource.state.refreshing}
        error={resource.state.state === 'error' && !resource.state.previousData ? resource.state.error.userMessage : undefined}
        onRetry={resource.retry}
        emptyText="暂无评测记录"
        rowKey={item => String(item.id)}
        onRowClick={item => setDetailSubmissionId(item.id)}
        columns={[
          { key: 'id', label: '提交', width: '86px', render: item => <span className={styles.link}>#{item.id}</span> },
          ...(!showUsernameFilter ? [] : [{ key: 'username', label: '用户', width: '120px', render: (item: Submission) => <span onClick={stopRowActivation} onKeyDown={stopRowActivation}><UserIdentityLink id={item.userId} userType={item.userType} username={item.username} /></span> }]),
          { key: 'oj', label: '平台', width: '110px', render: item => item.oj === 'carits' ? 'Carits' : ojPlatformDisplayName(item.oj) },
          { key: 'problemId', label: '题目', render: problemCell },
          { key: 'result', label: '结果', width: '120px', render: item => <StatusBadge variant={getResultVariant(item.result)}>{judgeResultLabel(item.result)}</StatusBadge> },
          { key: 'timeUsed', label: '\u65f6\u95f4', width: '100px', render: item => item.timeUsed == null ? '\u2014' : `${item.timeUsed} MS` },
          { key: 'memoryUsed', label: '\u5185\u5b58', width: '100px', render: item => item.memoryUsed == null ? '\u2014' : `${(item.memoryUsed / 1024).toFixed(2)} MB` },
          { key: 'language', label: '语言', width: '100px', render: item => getLanguageLabel(item.language) },
          { key: 'submittedAt', label: '提交时间', width: '170px', render: item => new Date(item.submittedAt).toLocaleString('zh-CN') },
        ]}
      />
      {total > 0 && <Pagination currentPage={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={isAdminView ? setPageSize : undefined} pageSizeOptions={pageSizeOptions} />}
      <SubmissionDetailModal
        isOpen={detailSubmissionId !== null}
        onClose={() => setDetailSubmissionId(null)}
        submissionId={detailSubmissionId}
        viewRole={isAdminView ? 'admin' : viewRole}
        submissionPathPrefix={pathPrefix}
        onSubmissionUpdated={() => { void resource.mutate() }}
      />
    </PageFrame>
  )
}
