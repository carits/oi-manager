'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { OJ_PLATFORMS } from '@/lib/oj-platforms'

export function ProblemList({ role }: ProblemListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { sessionKey } = useAuth()

  // 从 URL 读取 tab 参数，默认为 public
  const tabFromUrl = searchParams.get('tab')
  const initialTab: 'private' | 'public' = tabFromUrl === 'private' ? 'private' : 'public'
  const [activeTab, setActiveTab] = useState<'private' | 'public'>(initialTab)
  const [problems, setProblems] = useState<Problem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // 搜索和筛选状态
  const [searchKeyword, setSearchKeyword] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [searchInput, setSearchInput] = useState('') // 输入框的值（防抖用）

  useEffect(() => {
    fetchProblems()
  }, [activeTab, page, searchKeyword, selectedPlatform])

  const fetchProblems = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        visibility: activeTab,
        page: String(page),
        pageSize: '10'
      })
      if (searchKeyword) {
        params.append('keyword', searchKeyword)
      }
      if (selectedPlatform && activeTab === 'public') {
        params.append('platform', selectedPlatform)
      }

      const result = await apiClient.get<ProblemListResponse>(`/api/problems?${params}`)
      if (result.success && result.data) {
        setProblems(result.data.list)
        setTotalPages(result.data.totalPages)
      }
    } catch (error) {
      console.error('Failed to fetch problems:', error)
    } finally {
      setLoading(false)
    }
  }

  // 搜索按钮点击
  const handleSearch = () => {
    setSearchKeyword(searchInput)
    setPage(1)
  }

  // 回车搜索
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  // 重置筛选
  const handleReset = () => {
    setSearchInput('')
    setSearchKeyword('')
    setSelectedPlatform('')
    setPage(1)
  }

  const getDifficultyColor = (difficulty: string | null) => {
    switch (difficulty) {
      case '简单': return '#10b981'
      case '中等': return '#f59e0b'
      case '困难': return '#ef4444'
      default: return 'var(--gray-500)'
    }
  }

  const getStatusBadge = (status: string) => {
    if (status === 'published') {
      return { text: '已发布', color: '#10b981' }
    }
    return { text: '草稿', color: 'var(--gray-500)' }
  }

  const getVisibilityBadge = (visibility: string) => {
    if (visibility === 'public') {
      return { text: '公共', color: '#3b82f6' }
    }
    return { text: '私有', color: 'var(--gray-500)' }
  }

  const canCreate = role === 'teacher' || role === 'student' || role === 'admin'

  // 切换 Tab 时更新 URL
  const handleTabChange = (tab: 'private' | 'public') => {
    setActiveTab(tab)
    setPage(1)
    // 更新 URL 参数
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  // 获取路径前缀
  const getPathPrefix = () => {
    if (role === 'admin') return '/platform-admin'
    if (role === 'student') return '/student'
    return '/teacher'
  }
  const pathPrefix = getPathPrefix()

  // 管理端的Tab标签
  const getTabLabel = (tab: 'private' | 'public') => {
    if (role === 'admin') {
      return tab === 'private' ? '私有题库' : '公共题库'
    }
    return tab === 'private' ? '我的题库' : '公共题库'
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        {/* 页面标题 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>题库</h1>
          {canCreate && (
            <button
              onClick={() => router.push(`${pathPrefix}/problems/new`)}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              + 新建题目
            </button>
          )}
        </div>

        {/* Tab 切换 - 公共题库在左 */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => handleTabChange('public')}
            style={{
              padding: '0.75rem 1rem',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'public' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: activeTab === 'public' ? 'var(--primary)' : 'var(--gray-500)'
            }}
          >
            {getTabLabel('public')}
          </button>
          <button
            onClick={() => handleTabChange('private')}
            style={{
              padding: '0.75rem 1rem',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'private' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: activeTab === 'private' ? 'var(--primary)' : 'var(--gray-500)'
            }}
          >
            {getTabLabel('private')}
          </button>
        </div>

        {/* 搜索和筛选区域 */}
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          marginBottom: '1.5rem',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}>
          {/* 平台下拉（仅在公有题库显示） */}
          {activeTab === 'public' && (
            <select
              value={selectedPlatform}
              onChange={(e) => { setSelectedPlatform(e.target.value); setPage(1); }}
              style={{
                padding: '0.5rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem',
                minWidth: '120px'
              }}
            >
              {OJ_PLATFORMS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          )}

          {/* 搜索输入框 */}
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索题号或标题..."
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.875rem',
              minWidth: '200px'
            }}
          />

          {/* 搜索按钮 */}
          <button
            onClick={handleSearch}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            搜索
          </button>

          {/* 重置按钮 */}
          {(searchKeyword || selectedPlatform) && (
            <button
              onClick={handleReset}
              style={{
                padding: '0.5rem 1rem',
                background: 'white',
                color: 'var(--gray-600)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              重置
            </button>
          )}
        </div>

        {/* 内容区域 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>加载中...</div>
        ) : problems.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            background: 'white',
            borderRadius: '8px',
            border: '1px solid var(--border)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📝</div>
            <h3 style={{ marginBottom: '0.5rem' }}>暂无题目</h3>
            <p style={{ color: 'var(--gray-500)', marginBottom: '1rem' }}>
              {activeTab === 'public' ? '公共题库暂无题目' : '点击"新建题目"创建您的第一道题目'}
            </p>
            {activeTab === 'private' && canCreate && (
              <button
                onClick={() => router.push(`${pathPrefix}/problems/new`)}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                新建题目
              </button>
            )}
          </div>
        ) : (
          <>
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }}>题号</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }}>标题</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }}>难度</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }}>时限</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }}>内存</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }}>创建者</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }}>状态</th>
                    {role === 'admin' && (
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }}>可见性</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {problems.map((problem) => {
                    const statusBadge = getStatusBadge(problem.status)
                    const visibilityBadge = getVisibilityBadge(problem.visibility)
                    return (
                      <tr
                        key={problem.id}
                        onClick={() => router.push(`${pathPrefix}/problems/${problem.id}`)}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gray-50)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: 'var(--primary)', fontWeight: 500 }}>
                          {problem.problemCode}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                          {problem.title}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                          {problem.difficulty ? (
                            <span style={{ color: getDifficultyColor(problem.difficulty) }}>
                              {problem.difficulty}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--gray-400)' }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                          {problem.timeLimit ? `${problem.timeLimit}s` : '-'}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                          {problem.memoryLimit ? `${problem.memoryLimit}M` : '-'}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                          {problem.ownerName || '-'}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{
                            fontSize: '0.75rem',
                            padding: '0.125rem 0.5rem',
                            borderRadius: '4px',
                            background: statusBadge.color === '#10b981' ? '#d1fae5' : 'var(--gray-100)',
                            color: statusBadge.color
                          }}>
                            {statusBadge.text}
                          </span>
                        </td>
                        {role === 'admin' && (
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span style={{
                              fontSize: '0.75rem',
                              padding: '0.125rem 0.5rem',
                              borderRadius: '4px',
                              background: visibilityBadge.color === '#3b82f6' ? '#dbeafe' : 'var(--gray-100)',
                              color: visibilityBadge.color
                            }}>
                              {visibilityBadge.text}
                            </span>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid var(--border)',
                    background: 'white',
                    borderRadius: '6px',
                    cursor: page === 1 ? 'not-allowed' : 'pointer',
                    opacity: page === 1 ? 0.5 : 1
                  }}
                >
                  上一页
                </button>
                <span style={{ padding: '0.5rem 1rem', color: 'var(--gray-600)' }}>
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid var(--border)',
                    background: 'white',
                    borderRadius: '6px',
                    cursor: page === totalPages ? 'not-allowed' : 'pointer',
                    opacity: page === totalPages ? 0.5 : 1
                  }}
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}