'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
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
    (tabParam as 'fetch' | 'public' | 'private') || 'fetch'
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
        visibility: 'public',
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
      success: { text: '✅ 成功', color: 'var(--success)' },
      failed: { text: '❌ 失败', color: 'var(--error)' },
      duplicate: { text: '⚠️ 已存在', color: 'var(--warning)' },
    }
    const s = map[status] || { text: status, color: 'var(--text-secondary)' }
    return <span style={{ color: s.color }}>{s.text}</span>
  }

  const renderAttachmentStatus = (status: string | null) => {
    if (!status) return <span style={{ color: 'var(--text-muted)' }}>-</span>
    const map: Record<string, { text: string; color: string }> = {
      pending: { text: '⏳ 待处理', color: 'var(--text-muted)' },
      success: { text: '✅ 成功', color: 'var(--success)' },
      failed: { text: '❌ 失败', color: 'var(--error)' },
      skipped: { text: '⚠️ 跳过', color: 'var(--warning)' },
    }
    const s = map[status] || { text: status, color: 'var(--text-secondary)' }
    return <span style={{ color: s.color }}>{s.text}</span>
  }

  // 渲染附件列：区分"无附件"和"有附件但xxx"
  const renderAttachmentColumn = (job: FetchJob) => {
    if (!job.hasAttachment) {
      return <span style={{ color: 'var(--text-muted)' }}>无附件</span>
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
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>加载中...</div>
      ) : problems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>暂无题目</div>
      ) : (
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-600)' }}>题号</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-600)' }}>标题</th>
                {showPlatform && <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-600)' }}>来源</th>}
                <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-600)' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((problem) => {
                let source = problem.platform ? `${problem.platform} / ${problem.problemId}` : '-'
                return (
                  <tr key={problem.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem' }}>{problem.problemId}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <span onClick={() => router.push(`/platform-admin/problems/${problem.id}`)} style={{ color: 'var(--primary)', cursor: 'pointer' }}>{problem.title}</span>
                    </td>
                    {showPlatform && <td style={{ padding: '0.75rem', color: 'var(--gray-500)' }}>{source}</td>}
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => router.push(`/platform-admin/problems/${problem.id}`)} style={smallBtnStyle()}>查看</button>
                        <button onClick={() => router.push(`/platform-admin/problems/${problem.id}/edit`)} style={smallBtnStyle()}>编辑</button>
                        {showRefetch && problem.ojBindings && (
                          <button onClick={() => handleRefetchProblem(problem)} style={smallBtnStyle('primary')}>重新拉取</button>
                        )}
                        <button onClick={() => handleDeleteProblem(problem.id)} style={smallBtnStyle('danger')}>删除</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
    <ProtectedRoute requiredRole="platform_admin">
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>题库管理</h1>

        {/* Tab 切换 */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
          <button onClick={() => handleTabChange('fetch')} style={tabButtonStyle(activeTab === 'fetch')}>拉取队列</button>
          <button onClick={() => handleTabChange('public')} style={tabButtonStyle(activeTab === 'public')}>公共题库</button>
          <button onClick={() => handleTabChange('private')} style={tabButtonStyle(activeTab === 'private')}>私有题库</button>
        </div>

        {/* ==================== 拉取队列 Tab ==================== */}
        {activeTab === 'fetch' && (
          <div>
            {/* 拉取配置（统一平台选择 + Cookie + 批量拉取） */}
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>拉取配置</h2>

              {/* 统一平台选择 */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-600)', marginBottom: '0.25rem' }}>选择平台</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <select value={fetchPlatform} onChange={(e) => setFetchPlatform(e.target.value)} style={selectStyle}>
                    {OJ_PLATFORMS_NO_ALL.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  {!FETCHABLE_PLATFORMS.find(p => p.value === fetchPlatform) && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                      该平台暂未支持拉取，敬请期待
                    </span>
                  )}
                </div>
              </div>

              {/* Cookie 配置（仅对该平台有字段定义时显示） */}
              {PLATFORM_COOKIE_FIELDS[fetchPlatform] && canManageCredentials && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--gray-50)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.75rem' }}>
                    已保存的值不会回传到浏览器。当前已配置：
                    {configuredCookieNames.length > 0 ? configuredCookieNames.join('、') : '无'}。
                    输入的新值会整体替换现有配置。
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    {PLATFORM_COOKIE_FIELDS[fetchPlatform].map(field => (
                      <div key={field.key}>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-600)', marginBottom: '0.25rem' }}>{field.label}</label>
                        <input type="text" value={platformCookies[field.key] || ''} onChange={(e) => setPlatformCookies({ ...platformCookies, [field.key]: e.target.value })} placeholder={field.placeholder}
                          style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', width: '300px' }} />
                      </div>
                    ))}
                    <button onClick={handleSaveCookies} disabled={savingCookies}
                      style={{ padding: '0.5rem 1rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                      {savingCookies ? '保存中...' : '保存配置'}
                    </button>
                  </div>
                </div>
              )}

              {/* 批量拉取 */}
              <div style={{ borderTop: PLATFORM_COOKIE_FIELDS[fetchPlatform] && canManageCredentials ? '1px solid var(--border)' : 'none', paddingTop: PLATFORM_COOKIE_FIELDS[fetchPlatform] && canManageCredentials ? '1rem' : 0 }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>批量拉取</h3>
                <textarea value={problemIdsInput} onChange={(e) => setProblemIdsInput(e.target.value)}
                  placeholder="输入题号，每行一个或逗号分隔，例如：&#10;P1001&#10;P1002&#10;B2001"
                  style={{ width: '100%', height: '120px', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', resize: 'vertical', marginBottom: '1rem' }} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={handleSubmit} disabled={submitting}
                    style={{ padding: '0.5rem 1.5rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                    {submitting ? '提交中...' : '开始拉取'}
                  </button>
                  <button onClick={() => setProblemIdsInput('')}
                    style={{ padding: '0.5rem 1rem', background: 'var(--gray-100)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                    清空
                  </button>
                </div>
              </div>
            </div>

            {/* 任务列表 */}
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>任务列表</h2>
                <button onClick={() => fetchJobs()} style={{ ...smallBtnStyle(), padding: '0.25rem 0.75rem' }}>刷新</button>
              </div>

              {/* 任务筛选栏 */}
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <select value={jobsPlatformFilter} onChange={(e) => { setJobsPlatformFilter(e.target.value); setJobsPage(1) }} style={selectStyle}>
                  {OJ_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <select value={jobsStatusFilter} onChange={(e) => { setJobsStatusFilter(e.target.value); setJobsPage(1) }} style={selectStyle}>
                  {JOB_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {(jobsPlatformFilter || jobsStatusFilter) && (
                  <button onClick={() => { setJobsPlatformFilter(''); setJobsStatusFilter(''); setJobsPage(1) }}
                    style={{ padding: '0.5rem 1rem', background: 'var(--gray-100)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                    重置筛选
                  </button>
                )}
              </div>

              {jobsLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>加载中...</div>
              ) : !jobs || jobs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>暂无任务</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-600)' }}>平台</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-600)' }}>题号</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-600)' }}>状态</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-600)' }}>附件</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-500)' }}>信息</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--gray-600)' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.75rem' }}>{job.platform}</td>
                        <td style={{ padding: '0.75rem' }}>{job.problemId}</td>
                        <td style={{ padding: '0.75rem' }}>{renderStatus(job.status)}</td>
                        <td style={{ padding: '0.75rem' }}>{renderAttachmentColumn(job)}</td>
                        <td style={{ padding: '0.75rem', color: 'var(--gray-500)', maxWidth: '200px' }}>{job.message || '-'}</td>
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {job.createdProblemId && (
                              <button onClick={() => router.push(`/platform-admin/problems/${job.createdProblemId}`)} style={smallBtnStyle()}>查看</button>
                            )}
                            <button onClick={() => handleRetry(job.id)}
                              style={smallBtnStyle((job.status === 'failed' || job.status === 'duplicate') ? 'primary' : 'default')}>
                              {job.status === 'failed' || job.status === 'duplicate' ? '重试' : '重新拉取'}
                            </button>
                            <button onClick={() => handleDelete(job.id)} style={smallBtnStyle()}>删除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-600)', marginBottom: '0.25rem' }}>平台</label>
                <select value={selectedPlatform} onChange={(e) => setSelectedPlatform(e.target.value)} style={selectStyle}>
                  {OJ_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-600)', marginBottom: '0.25rem' }}>搜索</label>
                <input type="text" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} placeholder="搜索题号或标题..."
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem' }} />
              </div>
              <button onClick={() => { setSelectedPlatform(''); setSearchKeyword('') }}
                style={{ padding: '0.5rem 1rem', background: 'var(--gray-100)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                重置
              </button>
              <button onClick={() => router.push('/platform-admin/problems/new')}
                style={{ padding: '0.5rem 1rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                + 新建题目
              </button>
            </div>
            {renderProblemTable(publicProblems, publicLoading, publicPage, publicTotalPages, publicTotal, publicPageSize, setPublicPage, setPublicPageSize, true, true)}
          </div>
        )}

        {/* ==================== 私有题库 Tab ==================== */}
        {activeTab === 'private' && (
          <div>
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-600)', marginBottom: '0.25rem' }}>搜索</label>
                <input type="text" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} placeholder="搜索题号或标题..."
                  style={{ width: '100%', maxWidth: '300px', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem' }} />
              </div>
              <button onClick={() => setSearchKeyword('')}
                style={{ padding: '0.5rem 1rem', background: 'var(--gray-100)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                重置
              </button>
              <button onClick={() => router.push('/platform-admin/problems/new')}
                style={{ padding: '0.5rem 1rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                + 新建题目
              </button>
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
    </ProtectedRoute>
  )
}
