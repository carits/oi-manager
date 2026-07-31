'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { OJ_PLATFORMS, OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { Pagination } from '@/components/ui/Pagination'

interface Problem {
  id: string
  title: string
  problemId: string
  platform: string
  difficulty?: string
  platforms?: string[]
  timeLimit?: number
  memoryLimit?: number
  ownerName?: string
  status?: string
  visibility?: string
  createdAt: string
}

interface ProblemListResponse {
  list: Problem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface ProblemListProps {
  role: string
}

const thStyle: React.CSSProperties = { padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }
const tdStyle: React.CSSProperties = { padding: '0.75rem 1rem', fontSize: '0.875rem' }

export function ProblemList({ role }: ProblemListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { sessionKey } = useAuth()

  const tabFromUrl = searchParams.get('tab')
  const initialTab: 'private' | 'public' = tabFromUrl === 'private' ? 'private' : 'public'
  const [activeTab, setActiveTab] = useState<'private' | 'public'>(initialTab)
  const [problems, setProblems] = useState<Problem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [searchInput, setSearchInput] = useState('')

  useEffect(() => {
    fetchProblems()
  }, [activeTab, page, pageSize, searchKeyword, selectedPlatform])

  const fetchProblems = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        visibility: activeTab,
        page: String(page),
        pageSize: String(pageSize)
      })
      if (searchKeyword) params.append('keyword', searchKeyword)
      if (selectedPlatform) params.append('platform', selectedPlatform)

      const result = await apiClient.get<ProblemListResponse>(`/api/problems?${params}`)
      if (result.success && result.data) {
        // API 返回 { data: [...], total, totalPages }，前端期望 { list: [...] }
        const responseData = result.data as any
        setProblems(responseData?.data || [])
        setTotal(responseData.total)
        setTotalPages(responseData.totalPages)
      }
    } catch (error) {
      console.error('Failed to fetch problems:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    setSearchKeyword(searchInput)
    setPage(1)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const handleReset = () => {
    setSearchInput('')
    setSearchKeyword('')
    setSelectedPlatform('')
    setPage(1)
  }

  const getDifficultyColor = (difficulty: string | null) => {
    switch (difficulty) {
      case '简单': return 'var(--success)'
      case '中等': return 'var(--warning)'
      case '困难': return 'var(--error)'
      default: return 'var(--gray-500)'
    }
  }

  const canCreate = role === 'teacher' || role === 'student' || role === 'admin'

  const handleTabChange = (tab: 'private' | 'public') => {
    setActiveTab(tab)
    setPage(1)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const getPathPrefix = () => {
    if (role === 'admin') return '/platform-admin'
    if (role === 'student') return '/student'
    return '/teacher'
  }
  const pathPrefix = getPathPrefix()

  const getTabLabel = (tab: 'private' | 'public') => {
    if (role === 'admin') return tab === 'private' ? '私有题库' : '公共题库'
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

        {/* Tab 切换 */}
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

        {/* 搜索和筛选 */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {activeTab === 'public' && (
            <select aria-label="选择"
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

        {/* 内容 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}><span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" /></div>
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
                    <th style={thStyle}>平台</th>
                    <th style={thStyle}>题号</th>
                    <th style={thStyle}>标题</th>
                    <th style={thStyle}>难度</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((problem) => (
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
                      <td style={{ ...tdStyle, color: 'var(--gray-600)' }}>
                        {(problem.platforms || []).map((p: string) => OJ_PLATFORM_LABEL_MAP[p] || p).join(', ') || '-'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--primary)', fontWeight: 500 }}>
                        {problem.problemId}
                      </td>
                      <td style={tdStyle}>
                        {problem.title}
                      </td>
                      <td style={tdStyle}>
                        {problem.difficulty ? (
                          <span style={{ color: getDifficultyColor(problem.difficulty) }}>
                            {problem.difficulty}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--gray-400)' }}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            />
          </>
        )}
      </div>
    </div>
  )
}
