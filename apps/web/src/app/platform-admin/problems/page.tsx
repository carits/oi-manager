'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import apiClient from '@/lib/apiClient'

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
  cookies: Record<string, string>
  lastUsedAt: string | null
}

// 题目类型
interface Problem {
  id: string
  problemCode: string
  title: string
  difficulty: string | null
  status: string
  ojBindings: string | null
  ownerName?: string
  createdAt: string
}

// OJ 平台列表（与后端 KNOWN_OJ_PLATFORMS 保持同步）
const OJ_PLATFORMS = [
  { value: '', label: '全部平台' },
  { value: 'poj', label: 'POJ' },
  { value: 'zoj', label: 'ZOJ' },
  { value: 'uva', label: 'UVA' },
  { value: 'livearchive', label: 'Live Archive' },
  { value: 'sgu', label: 'SGU' },
  { value: 'ural', label: 'URAL' },
  { value: 'hust', label: 'HUST' },
  { value: 'spoj', label: 'SPOJ' },
  { value: 'hdu', label: 'HDU' },
  { value: 'hysbz', label: 'HYSBZ' },
  { value: 'codeforces', label: 'CodeForces' },
  { value: 'z-trening', label: 'Z-Trening' },
  { value: 'aizu', label: 'Aizu' },
  { value: 'lightoj', label: 'LightOJ' },
  { value: 'uestc', label: 'UESTC' },
  { value: 'nbut', label: 'NBUT' },
  { value: 'fzu', label: 'FZU' },
  { value: 'csu', label: 'CSU' },
  { value: 'scu', label: 'SCU' },
  { value: 'acdream', label: 'ACdream' },
  { value: 'codechef', label: 'CodeChef' },
  { value: 'openjudge', label: 'OpenJudge' },
  { value: 'kattis', label: 'Kattis' },
  { value: 'hihocoder', label: 'HihoCoder' },
  { value: 'hit', label: 'HIT' },
  { value: 'hrbust', label: 'HRBUST' },
  { value: 'eijudge', label: 'EIJudge' },
  { value: 'atcoder', label: 'AtCoder' },
  { value: 'hackerrank', label: 'HackerRank' },
  { value: '51nod', label: '51Nod' },
  { value: 'topcoder', label: 'TopCoder' },
  { value: 'eolymp', label: 'EOlymp' },
  { value: 'jisuanke', label: '计蒜客' },
  { value: 'libreoj', label: 'LibreOJ' },
  { value: 'universaloj', label: 'UniversalOJ' },
  { value: 'darkbzoj', label: '黑暗爆炸' },
  { value: 'csgdmoj', label: 'CSGDMOJ' },
  { value: 'toph', label: 'Toph' },
  { value: 'luogu', label: '洛谷' },
  { value: 'baekjoon', label: 'Baekjoon' },
  { value: 'qoj', label: 'QOJ' },
  { value: 'cses', label: 'CSES' },
  { value: 'usaco', label: 'USACO' },
  { value: 'oj.uz', label: 'oj.uz' },
  { value: 'yosupo', label: 'Yosupo' },
  { value: 'yukicoder', label: 'yukicoder' },
  { value: 'vnoj', label: 'VNOJ' },
  { value: 'tlx', label: 'TLX' },
  { value: 'bzoj', label: 'BZOJ' },
  { value: 'kilonova', label: 'Kilonova' },
  { value: 'szkopul', label: 'Szkopuł' },
  { value: 'csacademy', label: 'CSAcademy' },
  { value: 'nowcoder', label: '牛客' },
  { value: 'krsu', label: 'KRSU' },
  { value: 'codefun', label: '代码源OJ' },
  { value: 'other', label: '其他' },
]

// 有实际 adapter 的平台（批量拉取只允许这些）
const FETCHABLE_PLATFORMS = [
  { value: 'luogu', label: '洛谷' },
]

// 不含"全部平台"的纯平台列表
const OJ_PLATFORMS_NO_ALL = OJ_PLATFORMS.filter(p => p.value !== '')

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
  background: variant === 'primary' ? 'var(--primary)' : variant === 'danger' ? '#fef2f2' : 'var(--gray-100)',
  color: variant === 'primary' ? 'white' : variant === 'danger' ? '#dc2626' : 'inherit',
  border: variant === 'primary' ? 'none' : '1px solid var(--border)',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.75rem',
})

export default function PlatformAdminProblemsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')

  // 从URL参数获取当前tab，默认为 'fetch'
  const [activeTab, setActiveTab] = useState<'fetch' | 'public' | 'private'>(
    (tabParam as 'fetch' | 'public' | 'private') || 'fetch'
  )

  // 拉取队列状态
  const [jobs, setJobs] = useState<FetchJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsPage, setJobsPage] = useState(1)
  const [jobsTotalPages, setJobsTotalPages] = useState(1)
  const [jobsPlatformFilter, setJobsPlatformFilter] = useState('')
  const [jobsStatusFilter, setJobsStatusFilter] = useState('')

  // Cookie 配置
  const [luoguCookies, setLuoguCookies] = useState<{ __client_id: string; _uid: string }>({
    __client_id: '',
    _uid: '',
  })
  const [savingCookies, setSavingCookies] = useState(false)

  // 批量拉取
  const [problemIdsInput, setProblemIdsInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [fetchPlatform, setFetchPlatform] = useState('luogu')

  // 公共题库
  const [publicProblems, setPublicProblems] = useState<Problem[]>([])
  const [publicLoading, setPublicLoading] = useState(false)
  const [publicPage, setPublicPage] = useState(1)
  const [publicTotalPages, setPublicTotalPages] = useState(1)

  // 私有题库
  const [privateProblems, setPrivateProblems] = useState<Problem[]>([])
  const [privateLoading, setPrivateLoading] = useState(false)
  const [privatePage, setPrivatePage] = useState(1)
  const [privateTotalPages, setPrivateTotalPages] = useState(1)

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
  const fetchJobs = async () => {
    try {
      setJobsLoading(true)
      const params = new URLSearchParams({
        page: jobsPage.toString(),
        pageSize: '20',
      })
      if (jobsPlatformFilter) params.append('platform', jobsPlatformFilter)
      if (jobsStatusFilter) params.append('status', jobsStatusFilter)
      const result = await apiClient.get<{ list: FetchJob[]; page: number; totalPages: number; total: number }>(`/api/oj-fetcher/jobs?${params}`)
      if (result.success && result.data) {
        setJobs(result.data.list ?? [])
        setJobsTotalPages(result.data.totalPages ?? 1)
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setJobsLoading(false)
    }
  }

  // 加载平台配置
  const fetchConfig = async () => {
    try {
      const result = await apiClient.get<PlatformConfig>('/api/oj-fetcher/platforms/luogu/config')
      if (result.success && result.data) {
        setLuoguCookies({
          __client_id: result.data.cookies?.__client_id || '',
          _uid: result.data.cookies?._uid || '',
        })
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
        pageSize: '10',
      })
      if (selectedPlatform) params.append('platform', selectedPlatform)
      if (searchKeyword) params.append('keyword', searchKeyword)
      const result = await apiClient.get<{ list: Problem[]; totalPages: number }>(`/api/problems?${params}`)
      if (result.success && result.data) {
        setPublicProblems(result.data.list ?? [])
        setPublicTotalPages(result.data.totalPages)
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
        pageSize: '10',
      })
      if (searchKeyword) params.append('keyword', searchKeyword)
      const result = await apiClient.get<{ list: Problem[]; totalPages: number }>(`/api/problems?${params}`)
      if (result.success && result.data) {
        setPrivateProblems(result.data.list ?? [])
        setPrivateTotalPages(result.data.totalPages)
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
      if (luoguCookies.__client_id) cookies.__client_id = luoguCookies.__client_id
      if (luoguCookies._uid) cookies._uid = luoguCookies._uid
      await apiClient.put('/api/oj-fetcher/platforms/luogu/config', { cookies })
      alert('配置已保存')
    } catch (error) {
      console.error('Failed to save config:', error)
      alert('保存失败')
    } finally {
      setSavingCookies(false)
    }
  }

  // 批量拉取
  const handleSubmit = async () => {
    const ids = problemIdsInput.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) { alert('请输入题号'); return }
    try {
      setSubmitting(true)
      const result = await apiClient.post<{ total: number; new: number; existing: number }>('/api/oj-fetcher/jobs/batch', {
        platform: fetchPlatform,
        problemIds: ids,
      })
      if (result.success && result.data) {
        alert(`已创建 ${result.data.new} 个新任务，${result.data.existing} 个已存在`)
        setProblemIdsInput('')
        fetchJobs()
      }
    } catch (error) {
      console.error('Failed to submit:', error)
      alert('提交失败')
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
    if (!confirm('确定删除此任务？')) return
    try {
      await apiClient.delete(`/api/oj-fetcher/jobs/${jobId}`)
      fetchJobs()
    } catch (error) { console.error('Failed to delete:', error) }
  }

  // 删除题目
  const handleDeleteProblem = async (problemId: string) => {
    if (!confirm('确定删除此题目？此操作不可恢复。')) return
    try {
      const result = await apiClient.delete<{ success: boolean }>(`/api/problems/${problemId}`)
      if (result.success) {
        if (activeTab === 'public') fetchPublicProblems()
        else if (activeTab === 'private') fetchPrivateProblems()
      }
    } catch (error) {
      console.error('Failed to delete problem:', error)
      alert('删除失败')
    }
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

  useEffect(() => { fetchConfig(); fetchJobs() }, [])
  useEffect(() => { if (activeTab === 'public') fetchPublicProblems() }, [activeTab, publicPage, selectedPlatform, searchKeyword])
  useEffect(() => { if (activeTab === 'private') fetchPrivateProblems() }, [activeTab, privatePage, searchKeyword])
  useEffect(() => { if (activeTab === 'fetch') fetchJobs() }, [jobsPage, jobsPlatformFilter, jobsStatusFilter])

  // 自动刷新任务列表
  useEffect(() => {
    if (activeTab !== 'fetch') return
    const hasPending = jobs.some(j => j.status === 'pending' || j.status === 'fetching')
    if (hasPending) {
      const timer = setTimeout(fetchJobs, 2000)
      return () => clearTimeout(timer)
    }
  }, [activeTab, jobs])

  // ==================== 渲染辅助 ====================

  const renderStatus = (status: string) => {
    const map: Record<string, { text: string; color: string }> = {
      pending: { text: '⏳ 等待中', color: '#9ca3af' },
      fetching: { text: '🔄 拉取中', color: '#3b82f6' },
      success: { text: '✅ 成功', color: '#10b981' },
      failed: { text: '❌ 失败', color: '#ef4444' },
      duplicate: { text: '⚠️ 已存在', color: '#f59e0b' },
    }
    const s = map[status] || { text: status, color: '#6b7280' }
    return <span style={{ color: s.color }}>{s.text}</span>
  }

  const renderAttachmentStatus = (status: string | null) => {
    if (!status) return <span style={{ color: '#9ca3af' }}>-</span>
    const map: Record<string, { text: string; color: string }> = {
      pending: { text: '⏳ 待处理', color: '#9ca3af' },
      success: { text: '✅ 成功', color: '#10b981' },
      failed: { text: '❌ 失败', color: '#ef4444' },
      skipped: { text: '⚠️ 跳过', color: '#f59e0b' },
    }
    const s = map[status] || { text: status, color: '#6b7280' }
    return <span style={{ color: s.color }}>{s.text}</span>
  }

  // 分页组件
  const renderPagination = (page: number, totalPages: number, setPage: (p: number) => void) => {
    if (totalPages <= 1) return null
    return (
      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
          style={{ padding: '0.5rem 1rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'white', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>
          上一页
        </button>
        <span style={{ padding: '0.5rem 1rem' }}>{page} / {totalPages}</span>
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
          style={{ padding: '0.5rem 1rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'white', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}>
          下一页
        </button>
      </div>
    )
  }

  // 题目列表渲染
  const renderProblemTable = (
    problems: Problem[], loading: boolean, page: number, totalPages: number,
    setPage: (p: number) => void, showPlatform?: boolean, showRefetch?: boolean,
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
                let source = '-'
                if (problem.ojBindings) {
                  try {
                    const bindings = JSON.parse(problem.ojBindings)
                    if (bindings.length > 0) source = `${bindings[0].platform} / ${bindings[0].problemId}`
                  } catch {}
                }
                return (
                  <tr key={problem.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem' }}>{problem.problemCode}</td>
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
        </div>
      )}
      {renderPagination(page, totalPages, setPage)}
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
            {/* Cookie 配置 */}
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>洛谷 Cookie 配置</h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '1rem' }}>
                配置后可下载需要登录的附件。在浏览器登录洛谷后，从开发者工具获取 __client_id 和 _uid。
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-600)', marginBottom: '0.25rem' }}>__client_id</label>
                  <input type="text" value={luoguCookies.__client_id} onChange={(e) => setLuoguCookies({ ...luoguCookies, __client_id: e.target.value })} placeholder="例如: 7d78f829..."
                    style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', width: '300px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-600)', marginBottom: '0.25rem' }}>_uid</label>
                  <input type="text" value={luoguCookies._uid} onChange={(e) => setLuoguCookies({ ...luoguCookies, _uid: e.target.value })} placeholder="例如: 401467"
                    style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', width: '150px' }} />
                </div>
                <button onClick={handleSaveCookies} disabled={savingCookies}
                  style={{ padding: '0.5rem 1rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                  {savingCookies ? '保存中...' : '保存配置'}
                </button>
              </div>
            </div>

            {/* 批量拉取 */}
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>批量拉取</h2>
              {/* 平台选择 */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-600)', marginBottom: '0.25rem' }}>选择平台</label>
                <select value={fetchPlatform} onChange={(e) => setFetchPlatform(e.target.value)} style={selectStyle}>
                  {FETCHABLE_PLATFORMS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginLeft: '0.5rem' }}>
                  目前仅支持洛谷平台拉取，其他平台敬请期待
                </span>
              </div>
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

            {/* 任务列表 */}
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>任务列表</h2>
                <button onClick={fetchJobs} style={{ ...smallBtnStyle(), padding: '0.25rem 0.75rem' }}>刷新</button>
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
                        <td style={{ padding: '0.75rem' }}>{job.hasAttachment ? renderAttachmentStatus(job.attachmentStatus) : '-'}</td>
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
              {renderPagination(jobsPage, jobsTotalPages, setJobsPage)}
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
            {renderProblemTable(publicProblems, publicLoading, publicPage, publicTotalPages, setPublicPage, true, true)}
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
            {renderProblemTable(privateProblems, privateLoading, privatePage, privateTotalPages, setPrivatePage, false, false)}
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}
