'use client'

import { useState, useEffect } from 'react'
import collisionStyles from './page.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './page.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Pagination } from '@/components/ui/Pagination'
import apiClient from '@/lib/apiClient'
import {
  OJ_PLATFORMS,
  OJ_PLATFORMS_NO_ALL,
  FETCHABLE_PLATFORMS,
  PLATFORM_COOKIE_FIELDS,
} from '@/lib/oj-platforms'

// 拉取任务类型
interface FetchJob {
  id: string
  platform: string
  problemId: string
  status: 'pending' | 'fetching' | 'success' | 'failed' | 'duplicate'
  message: string | null
  hasAttachment: boolean
  attachmentStatus: 'pending' | 'success' | 'failed' | 'skipped' | null
  createdProblemId: string | null
  createdAt: string
}

// 平台配置类型
interface PlatformConfig {
  platform: string
  configured: boolean
  cookieNames: string[]
  lastUsedAt: string | null
}

// 题目类型
interface Problem {
  id: string
  problemId: string
  platform: string
  title: string
  difficulty: string | null
  status: string
  ojBindings: string | null
  ownerName?: string
  createdAt: string
}

// 拉取任务状态选项
const JOB_STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '等待中' },
  { value: 'fetching', label: '拉取中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'duplicate', label: '已存在' },
]

const selectStyle: React.CSSProperties = {
  padding: '0.5rem',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '0.875rem',
  minWidth: '150px',
}

const smallBtnStyle = (variant: 'default' | 'primary' | 'danger' = 'default'): React.CSSProperties => ({
  padding: '0.25rem 0.5rem',
  background: variant === 'primary' ? 'var(--primary)' : variant === 'danger' ? 'var(--error-light)' : 'var(--gray-100)',
  color: variant === 'primary' ? 'white' : variant === 'danger' ? 'var(--error)' : 'inherit',
  border: variant === 'primary' ? 'none' : '1px solid var(--border)',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.75rem',
})

export default function PlatformAdminProblemsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const toast = useToast()
  const { user } = useAuth()
  const canManageCredentials = user?.role === 'super_admin'
  const [confirmState, setConfirmState] = useState<{ id: string; message: string; action: () => Promise<void> } | null>(null)

  // 从URL参数获取当前tab，默认为 'fetch'
  const [activeTab, setActiveTab] = useState<'fetch' | 'public' | 'private'>(
    tabParam === 'private' ? 'public' : (tabParam as 'fetch' | 'public') || 'fetch'
  )

  // 拉取队列状态
  const [jobs, setJobs] = useState<FetchJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsPage, setJobsPage] = useState(1)
  const [jobsTotalPages, setJobsTotalPages] = useState(1)
  const [jobsTotal, setJobsTotal] = useState(0)
  const [jobsPageSize] = useState(20)
  const [jobsPlatformFilter, setJobsPlatformFilter] = useState('')
  const [jobsStatusFilter, setJobsStatusFilter] = useState('')

  // Cookie 配置（通用，按平台动态）
  const [platformCookies, setPlatformCookies] = useState<Record<string, string>>({})
  const [savingCookies, setSavingCookies] = useState(false)
  const [configuredCookieNames, setConfiguredCookieNames] = useState<string[]>([])

  // 批量拉取
  const [problemIdsInput, setProblemIdsInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [fetchPlatform, setFetchPlatform] = useState('luogu')

  // 公共题库
  const [publicProblems, setPublicProblems] = useState<Problem[]>([])
  const [publicLoading, setPublicLoading] = useState(false)
  const [publicPage, setPublicPage] = useState(1)
  const [publicTotalPages, setPublicTotalPages] = useState(1)
  const [publicTotal, setPublicTotal] = useState(0)
  const [publicPageSize, setPublicPageSize] = useState(10)

  // 私有题库
  const [privateProblems, setPrivateProblems] = useState<Problem[]>([])
  const [privateLoading, setPrivateLoading] = useState(false)
  const [privatePage, setPrivatePage] = useState(1)
  const [privateTotalPages, setPrivateTotalPages] = useState(1)
  const [privateTotal, setPrivateTotal] = useState(0)
  const [privatePageSize, setPrivatePageSize] = useState(10)

  // 筛选
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')

  // 切换tab时更新URL
  const handleTabChange = (tab: 'fetch' | 'public' | 'private') => {
    setActiveTab(tab)
    router.push(`/platform-admin/problems?tab=${tab}`)
  }

  // ==================== 数据加载 ====================

  // 加载任务列表（支持分页和筛选）
  // silent=true 时不切换 loading 状态（用于自动刷新，避免滚动条跳动）
  const fetchJobs = async (silent = false) => {
    try {
      if (!silent) setJobsLoading(true)
      const params = new URLSearchParams({
        page: jobsPage.toString(),
        pageSize: jobsPageSize.toString(),
      })
      if (jobsPlatformFilter) params.append('platform', jobsPlatformFilter)
      if (jobsStatusFilter) params.append('status', jobsStatusFilter)
      const result = await apiClient.get<{ data: FetchJob[]; page: number; totalPages: number; total: number }>(`/api/oj-fetcher/jobs?${params}`)
      if (result.success && result.data) {
        setJobs(result.data.data ?? [])
        setJobsTotalPages(result.data.totalPages ?? 1)
        setJobsTotal(result.data.total ?? 0)
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      if (!silent) setJobsLoading(false)
    }
  }

  // 加载当前平台的 Cookie 配置
  const fetchConfig = async () => {
    if (!canManageCredentials) return
    try {
      const result = await apiClient.get<PlatformConfig>(`/api/oj-fetcher/platforms/${fetchPlatform}/config`)
      if (result.success && result.data) {
        setConfiguredCookieNames(result.data.cookieNames || [])
        setPlatformCookies({})
      }
    } catch (error) {
      console.error('Failed to fetch config:', error)
    }
  }

  // 加载公共题库
  const fetchPublicProblems = async () => {
    try {
      setPublicLoading(true)
      const params = new URLSearchParams({
        library: 'platform',
        page: publicPage.toString(),
        pageSize: publicPageSize.toString(),
      })
      if (selectedPlatform) params.append('platform', selectedPlatform)
      if (searchKeyword) params.append('keyword', searchKeyword)
      const result = await apiClient.get<{ data: Problem[]; totalPages: number; total: number }>(`/api/problems?${params}`)
      if (result.success && result.data) {
        setPublicProblems(result.data.data ?? [])
        setPublicTotalPages(result.data.totalPages)
        setPublicTotal(result.data.total ?? 0)
      }
    } catch (error) {
      console.error('Failed to fetch public problems:', error)
    } finally {
      setPublicLoading(false)
    }
  }

  // 加载私有题库
  const fetchPrivateProblems = async () => {
    try {
      setPrivateLoading(true)
      const params = new URLSearchParams({
        visibility: 'private',
        page: privatePage.toString(),
        pageSize: privatePageSize.toString(),
      })
      if (searchKeyword) params.append('keyword', searchKeyword)
      const result = await apiClient.get<{ data: Problem[]; totalPages: number; total: number }>(`/api/problems?${params}`)
      if (result.success && result.data) {
        setPrivateProblems(result.data.data ?? [])
        setPrivateTotalPages(result.data.totalPages)
        setPrivateTotal(result.data.total ?? 0)
      }
    } catch (error) {
      console.error('Failed to fetch private problems:', error)
    } finally {
      setPrivateLoading(false)
    }
  }

  // ==================== 操作 ====================

  // 保存 Cookie 配置
  const handleSaveCookies = async () => {
    try {
      setSavingCookies(true)
      const cookies: Record<string, string> = {}
      // 只保存非空值
      for (const [key, value] of Object.entries(platformCookies)) {
        if (value) cookies[key] = value
      }
      const result = await apiClient.put<PlatformConfig>(
        `/api/oj-fetcher/platforms/${fetchPlatform}/config`,
        { cookies },
      )
      if (!result.success) {
        throw new Error(result.message || '保存失败')
      }
      setConfiguredCookieNames(result.data?.cookieNames || Object.keys(cookies))
      setPlatformCookies({})
      toast.success('配置已保存')
    } catch (error) {
      console.error('Failed to save config:', error)
      toast.error('保存失败')
    } finally {
      setSavingCookies(false)
    }
  }

  // 批量拉取
  const handleSubmit = async () => {
    const ids = problemIdsInput.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) { toast.warning('请输入题号'); return }
    try {
      setSubmitting(true)
      const result = await apiClient.post<{ total: number; new: number; existing: number }>('/api/oj-fetcher/jobs/batch', {
        platform: fetchPlatform,
        problemIds: ids,
      })
      if (result.success && result.data) {
        toast.success(`已创建 ${result.data.new} 个新任务，${result.data.existing} 个已存在`)
        setProblemIdsInput('')
        fetchJobs()
      }
    } catch (error) {
      console.error('Failed to submit:', error)
      toast.error('提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  // 重试任务
  const handleRetry = async (jobId: string) => {
    try {
      await apiClient.post(`/api/oj-fetcher/jobs/${jobId}/retry`)
      fetchJobs()
    } catch (error) { console.error('Failed to retry:', error) }
  }

  // 删除任务
  const handleDelete = async (jobId: string) => {
    setConfirmState({
      id: jobId,
      message: '确定删除此任务？',
      action: async () => {
        try {
          await apiClient.delete(`/api/oj-fetcher/jobs/${jobId}`)
          fetchJobs()
        } catch (error) { console.error('Failed to delete:', error) }
      }
    })
  }

  // 删除题目
  const handleDeleteProblem = async (problemId: string) => {
    setConfirmState({
      id: problemId,
      message: '确定删除此题目？此操作不可恢复。',
      action: async () => {
        try {
          const result = await apiClient.delete<{ success: boolean }>(`/api/problems/${problemId}`)
          if (result.success) {
            if (activeTab === 'public') fetchPublicProblems()
            else if (activeTab === 'private') fetchPrivateProblems()
          }
        } catch (error) {
          console.error('Failed to delete problem:', error)
          toast.error('删除失败')
        }
      }
    })
  }

  // 重新拉取题目
  const handleRefetchProblem = async (problem: Problem) => {
    if (!problem.ojBindings) return
    try {
      const bindings = JSON.parse(problem.ojBindings)
      if (bindings.length > 0) {
        const { platform, problemId } = bindings[0]
        await apiClient.post('/api/oj-fetcher/jobs/batch', { platform, problemIds: [problemId] })
        handleTabChange('fetch')
      }
    } catch (error) { console.error('Failed to refetch:', error) }
  }

  // ==================== Effects ====================

  useEffect(() => {
    if (canManageCredentials) fetchConfig()
    fetchJobs()
  }, [canManageCredentials])
  // 从 localStorage 恢复平台选择（SSR 安全）
  useEffect(() => {
    const saved = localStorage.getItem('oj-fetch-platform')
    if (saved && saved !== fetchPlatform) setFetchPlatform(saved)
  }, [])
  useEffect(() => {
    if (canManageCredentials) fetchConfig()
    localStorage.setItem('oj-fetch-platform', fetchPlatform)
  }, [canManageCredentials, fetchPlatform])
  useEffect(() => { if (activeTab === 'public') fetchPublicProblems() }, [activeTab, publicPage, publicPageSize, selectedPlatform, searchKeyword])
  useEffect(() => { if (activeTab === 'private') fetchPrivateProblems() }, [activeTab, privatePage, privatePageSize, searchKeyword])
  useEffect(() => { if (activeTab === 'fetch') fetchJobs() }, [jobsPage, jobsPageSize, jobsPlatformFilter, jobsStatusFilter])

  // 自动刷新任务列表
  useEffect(() => {
    if (activeTab !== 'fetch') return
    const hasPending = jobs.some(j => j.status === 'pending' || j.status === 'fetching')
    if (hasPending) {
      const timer = setTimeout(() => fetchJobs(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [activeTab, jobs])

  // ==================== 渲染辅助 ====================

  const renderStatus = (status: string) => {
    const map: Record<string, { text: string; color: string }> = {
      pending: { text: '⏳ 等待中', color: 'var(--text-muted)' },
      fetching: { text: '🔄 拉取中', color: 'var(--primary)' },
      success: { text: '成功', color: 'var(--success)' },
      failed: { text: '失败', color: 'var(--error)' },
      duplicate: { text: '已存在', color: 'var(--warning)' },
    }
    const s = map[status] || { text: status, color: 'var(--text-secondary)' }
    const statusStyle = { color: s.color }
    return <span style={statusStyle}>{s.text}</span>
  }

  const renderAttachmentStatus = (status: string | null) => {
    if (!status) return <span className={unifiedStyles.u1}>-</span>
    const map: Record<string, { text: string; color: string }> = {
      pending: { text: '⏳ 待处理', color: 'var(--text-muted)' },
      success: { text: '成功', color: 'var(--success)' },
      failed: { text: '失败', color: 'var(--error)' },
      skipped: { text: '跳过', color: 'var(--warning)' },
    }
    const s = map[status] || { text: status, color: 'var(--text-secondary)' }
    const statusStyle = { color: s.color }
    return <span style={statusStyle}>{s.text}</span>
  }

  // 渲染附件列：区分"无附件"和"有附件但xxx"
  const renderAttachmentColumn = (job: FetchJob) => {
    if (!job.hasAttachment) {
      return <span className={unifiedStyles.u1}>无附件</span>
    }
    return renderAttachmentStatus(job.attachmentStatus)
  }


  // 题目列表渲染
  const renderProblemTable = (
    problems: Problem[], loading: boolean, page: number, totalPages: number, total: number,
    pageSize: number, setPage: (p: number) => void, setPageSize?: (s: number) => void,
    showPlatform?: boolean, showRefetch?: boolean,
  ) => (
    <>
      {loading ? (
        <div className={unifiedStyles.u2}><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div>
      ) : problems.length === 0 ? (
        <div className={unifiedStyles.u2}>暂无题目</div>
      ) : (
        <div className={unifiedStyles.u3}>
          <TableRoot className={unifiedStyles.u4}>
            <TableHead>
              <TableRow className={unifiedStyles.u5}>
                <TableHeaderCell className={unifiedStyles.u6}>题号</TableHeaderCell>
                <TableHeaderCell className={unifiedStyles.u6}>标题</TableHeaderCell>
                {showPlatform && <TableHeaderCell className={unifiedStyles.u6}>来源</TableHeaderCell>}
                <TableHeaderCell className={unifiedStyles.u6}>操作</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {problems.map((problem) => {
                let source = problem.platform ? `${problem.platform} / ${problem.problemId}` : '-'
                return (
                  <TableRow key={problem.id} className={unifiedStyles.u5}>
                    <TableCell className={unifiedStyles.u7}>{problem.problemId}</TableCell>
                    <TableCell className={unifiedStyles.u7}>
                      <Button variant="ghost" type="button" onClick={() => router.push(`/platform-admin/problems/${problem.id}`)} className={unifiedStyles.u8}>{problem.title}</Button>
                    </TableCell>
                    {showPlatform && <TableCell className={unifiedStyles.u9}>{source}</TableCell>}
                    <TableCell className={unifiedStyles.u7}>
                      <div className={unifiedStyles.u10}>
                        <Button variant="ghost" onClick={() => router.push(`/platform-admin/problems/${problem.id}`)} style={smallBtnStyle()}>查看</Button>
                        <Button variant="ghost" onClick={() => router.push(`/platform-admin/problems/${problem.id}/edit`)} style={smallBtnStyle()}>编辑</Button>
                        {showRefetch && problem.ojBindings && (
                          <Button variant="ghost" onClick={() => handleRefetchProblem(problem)} style={smallBtnStyle('primary')}>重新拉取</Button>
                        )}
                        <Button variant="ghost" onClick={() => handleDeleteProblem(problem.id)} style={smallBtnStyle('danger')}>删除</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </TableRoot>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}
    </>
  )

  // Tab 按钮样式
  const tabButtonStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '0.75rem 1.5rem',
    border: 'none',
    borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: isActive ? 600 : 400,
    color: isActive ? 'var(--primary)' : 'var(--gray-500)',
  })

  // ==================== 渲染 ====================

  return (
    <>
      <div className={unifiedStyles.u11}>
        <h1 className={unifiedStyles.u12}>题库管理</h1>

        {/* Tab 切换 */}
        <div className={unifiedStyles.u13}>
          <Button variant="ghost" onClick={() => handleTabChange('fetch')} style={tabButtonStyle(activeTab === 'fetch')}>拉取队列</Button>
          <Button variant="ghost" onClick={() => handleTabChange('public')} style={tabButtonStyle(activeTab === 'public')}>平台题库</Button>
        </div>

        {/* ==================== 拉取队列 Tab ==================== */}
        {activeTab === 'fetch' && (
          <div>
            {/* 拉取配置（统一平台选择 + Cookie + 批量拉取） */}
            <div className={unifiedStyles.u14}>
              <h2 className={unifiedStyles.u15}>拉取配置</h2>

              {/* 统一平台选择 */}
              <div className={unifiedStyles.u16}>
                <label className={unifiedStyles.u17}>选择平台</label>
                <div className={unifiedStyles.u18}>
                  <Select aria-label="选择" value={fetchPlatform} onChange={(e) => setFetchPlatform(e.target.value)} style={selectStyle}>
                    {OJ_PLATFORMS_NO_ALL.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                  {!FETCHABLE_PLATFORMS.find(p => p.value === fetchPlatform) && (
                    <span className={unifiedStyles.u19}>
                      该平台暂未支持拉取，敬请期待
                    </span>
                  )}
                </div>
              </div>

              {/* Cookie 配置（仅对该平台有字段定义时显示） */}
              {PLATFORM_COOKIE_FIELDS[fetchPlatform] && canManageCredentials && (
                <div className={unifiedStyles.u20}>
                  <p className={unifiedStyles.u21}>
                    已保存的值不会回传到浏览器。当前已配置：
                    {configuredCookieNames.length > 0 ? configuredCookieNames.join('、') : '无'}。
                    输入的新值会整体替换现有配置。
                  </p>
                  <div className={unifiedStyles.u22}>
                    {PLATFORM_COOKIE_FIELDS[fetchPlatform].map(field => (
                      <div key={field.key}>
                        <label className={unifiedStyles.u17}>{field.label}</label>
                        <Input type="text" value={platformCookies[field.key] || ''} onChange={(e) => setPlatformCookies({ ...platformCookies, [field.key]: e.target.value })} placeholder={field.placeholder}
                          className={unifiedStyles.u23} />
                      </div>
                    ))}
                    <Button variant="ghost" onClick={handleSaveCookies} disabled={savingCookies}
                      className={unifiedStyles.u24}>
                      {savingCookies ? '保存中...' : '保存配置'}
                    </Button>
                  </div>
                </div>
              )}

              {/* 批量拉取 */}
              <div className={PLATFORM_COOKIE_FIELDS[fetchPlatform] && canManageCredentials ? unifiedStyles.batchFetchSeparated : undefined}>
                <h3 className={unifiedStyles.u25}>批量拉取</h3>
                <Textarea value={problemIdsInput} onChange={(e) => setProblemIdsInput(e.target.value)}
                  placeholder="输入题号，每行一个或逗号分隔，例如：&#10;P1001&#10;P1002&#10;B2001"
                  className={unifiedStyles.u26} />
                <div className={unifiedStyles.u10}>
                  <Button variant="ghost" onClick={handleSubmit} disabled={submitting}
                    className={unifiedStyles.u27}>
                    {submitting ? '提交中...' : '开始拉取'}
                  </Button>
                  <Button variant="ghost" onClick={() => setProblemIdsInput('')}
                    className={unifiedStyles.u28}>
                    清空
                  </Button>
                </div>
              </div>
            </div>

            {/* 任务列表 */}
            <div className={unifiedStyles.u29}>
              <div className={unifiedStyles.u30}>
                <h2 className={unifiedStyles.u31}>任务列表</h2>
                <Button variant="secondary" size="sm" onClick={() => fetchJobs()}>刷新</Button>
              </div>

              {/* 任务筛选栏 */}
              <div className={unifiedStyles.u32}>
                <Select aria-label="选择" value={jobsPlatformFilter} onChange={(e) => { setJobsPlatformFilter(e.target.value); setJobsPage(1) }} style={selectStyle}>
                  {OJ_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
                <Select aria-label="选择" value={jobsStatusFilter} onChange={(e) => { setJobsStatusFilter(e.target.value); setJobsPage(1) }} style={selectStyle}>
                  {JOB_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                {(jobsPlatformFilter || jobsStatusFilter) && (
                  <Button variant="ghost" onClick={() => { setJobsPlatformFilter(''); setJobsStatusFilter(''); setJobsPage(1) }}
                    className={unifiedStyles.u28}>
                    重置筛选
                  </Button>
                )}
              </div>

              {jobsLoading ? (
                <div className={unifiedStyles.u2}><span className={[("resource-skeleton-line"), collisionStyles.u2].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div>
              ) : !jobs || jobs.length === 0 ? (
                <div className={unifiedStyles.u2}>暂无任务</div>
              ) : (
                <TableRoot className={unifiedStyles.u4}>
                  <TableHead>
                    <TableRow className={unifiedStyles.u5}>
                      <TableHeaderCell className={unifiedStyles.u6}>平台</TableHeaderCell>
                      <TableHeaderCell className={unifiedStyles.u6}>题号</TableHeaderCell>
                      <TableHeaderCell className={unifiedStyles.u6}>状态</TableHeaderCell>
                      <TableHeaderCell className={unifiedStyles.u6}>附件</TableHeaderCell>
                      <TableHeaderCell className={unifiedStyles.u33}>信息</TableHeaderCell>
                      <TableHeaderCell className={unifiedStyles.u6}>操作</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id} className={unifiedStyles.u5}>
                        <TableCell className={unifiedStyles.u7}>{job.platform}</TableCell>
                        <TableCell className={unifiedStyles.u7}>{job.problemId}</TableCell>
                        <TableCell className={unifiedStyles.u7}>{renderStatus(job.status)}</TableCell>
                        <TableCell className={unifiedStyles.u7}>{renderAttachmentColumn(job)}</TableCell>
                        <TableCell className={unifiedStyles.u34}>{job.message || '-'}</TableCell>
                        <TableCell className={unifiedStyles.u7}>
                          <div className={unifiedStyles.u10}>
                            {job.createdProblemId && (
                              <Button variant="ghost" onClick={() => router.push(`/platform-admin/problems/${job.createdProblemId}`)} style={smallBtnStyle()}>查看</Button>
                            )}
                            <Button variant="ghost" onClick={() => handleRetry(job.id)}
                              style={smallBtnStyle((job.status === 'failed' || job.status === 'duplicate') ? 'primary' : 'default')}>
                              {job.status === 'failed' || job.status === 'duplicate' ? '重试' : '重新拉取'}
                            </Button>
                            <Button variant="ghost" onClick={() => handleDelete(job.id)} style={smallBtnStyle()}>删除</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </TableRoot>
              )}
              <Pagination
                currentPage={jobsPage}
                totalPages={jobsTotalPages}
                total={jobsTotal}
                pageSize={jobsPageSize}
                onPageChange={setJobsPage}
              />
            </div>
          </div>
        )}

        {/* ==================== 公共题库 Tab ==================== */}
        {activeTab === 'public' && (
          <div>
            <div className={unifiedStyles.u35}>
              <div>
                <label className={unifiedStyles.u17}>平台</label>
                <Select aria-label="选择" value={selectedPlatform} onChange={(e) => setSelectedPlatform(e.target.value)} style={selectStyle}>
                  {OJ_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              </div>
              <div className={unifiedStyles.u36}>
                <label className={unifiedStyles.u17}>搜索</label>
                <Input type="text" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} placeholder="搜索题号或标题..."
                  className={unifiedStyles.u37} />
              </div>
              <Button variant="ghost" onClick={() => { setSelectedPlatform(''); setSearchKeyword('') }}
                className={unifiedStyles.u28}>
                重置
              </Button>
              <Button variant="ghost" onClick={() => router.push('/platform-admin/problems/new')}
                className={unifiedStyles.u24}>
                + 新建题目
              </Button>
            </div>
            {renderProblemTable(publicProblems, publicLoading, publicPage, publicTotalPages, publicTotal, publicPageSize, setPublicPage, setPublicPageSize, true, true)}
          </div>
        )}

        {/* ==================== 私有题库 Tab ==================== */}
        {activeTab === 'private' && (
          <div>
            <div className={unifiedStyles.u35}>
              <div className={unifiedStyles.u36}>
                <label className={unifiedStyles.u17}>搜索</label>
                <Input type="text" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} placeholder="搜索题号或标题..."
                  className={unifiedStyles.u38} />
              </div>
              <Button variant="ghost" onClick={() => setSearchKeyword('')}
                className={unifiedStyles.u28}>
                重置
              </Button>
              <Button variant="ghost" onClick={() => router.push('/platform-admin/problems/new')}
                className={unifiedStyles.u24}>
                + 新建题目
              </Button>
            </div>
            {renderProblemTable(privateProblems, privateLoading, privatePage, privateTotalPages, privateTotal, privatePageSize, setPrivatePage, setPrivatePageSize, false, false)}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={async () => { await confirmState?.action(); setConfirmState(null) }}
        title="确认操作"
        message={confirmState?.message || ''}
        confirmText="确认"
        danger
      />
    </>
  )
}
