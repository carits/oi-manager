'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { JUDGE_RESULT_OPTIONS, LANGUAGE_OPTIONS, JUDGE_RESULT_LABEL_MAP, getLanguageLabel } from '@/lib/judge-constants'
import { SUBMISSION_OJ_OPTIONS, OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { Pagination } from '@/components/ui/Pagination'
import { SubmissionDetailModal } from './SubmissionDetailModal'

interface Submission {
  id: number
  username: string
  oj: string
  problemId: string
  problemInternalId?: string
  problemVisibility?: string | null
  result: string
  timeUsed: number | null
  memoryUsed: number | null
  codeLength: number | null
  language: string
  submittedAt: string
}

interface SubmissionListProps {
  viewRole: 'teacher' | 'student' | 'admin'
}

// 评测结果颜色
const RESULT_COLORS: Record<string, { bg: string; text: string }> = {
  accepted: { bg: 'var(--success-light)', text: 'var(--success-text)' },
  queuing: { bg: 'var(--info-light)', text: 'var(--info-text)' },
  judging: { bg: 'var(--info-light)', text: 'var(--info-text)' },
  tle: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  mle: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  wa: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  re: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  ce: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  pe: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  ole: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  submit_failed: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  judge_failed: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  remote_unavailable: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  unknown_error: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  system_error: { bg: 'var(--error-light)', text: 'var(--error-text)' },
}

const selectStyle: React.CSSProperties = {
  padding: '0.5rem',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '0.875rem',
  minWidth: '140px',
  background: 'white',
}

const inputStyle: React.CSSProperties = {
  padding: '0.5rem',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '0.875rem',
  minWidth: '120px',
}

export function SubmissionList({ viewRole }: SubmissionListProps) {
  const router = useRouter()

  // 筛选状态
  const [filterUsername, setFilterUsername] = useState('')
  const [filterOj, setFilterOj] = useState('')
  const [filterProblemId, setFilterProblemId] = useState('')
  const [filterResult, setFilterResult] = useState('')
  const [filterLanguage, setFilterLanguage] = useState('')

  // 数据状态
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [total, setTotal] = useState(0)
  const pageSize = 20

  // 详情弹窗状态
  const [detailSubmissionId, setDetailSubmissionId] = useState<number | null>(null)

  // 获取路径前缀
  const getPathPrefix = () => {
    if (viewRole === 'admin') return '/platform-admin'
    if (viewRole === 'student') return '/student'
    return '/teacher'
  }

  // 格式化内存显示（后端返回 KB，转换为 MB 显示）
  const formatMemory = (oj: string, memoryUsed: number | null): string => {
    if (memoryUsed === null) return '-'
    if (memoryUsed === 0) return '0'
    return (memoryUsed / 1024).toFixed(2)
  }

  // 格式化时间显示（MS）
  const formatTime = (timeUsed: number | null): string => {
    if (timeUsed === null) return '-'
    return String(timeUsed)
  }

  const canClickProblem = (submission: Submission) => {
    return !!submission.problemInternalId && (submission.problemVisibility === 'public' || submission.problemVisibility === 'private')
  }

  // 获取外部题目链接（用于归档提交）
  const getExternalProblemUrl = (oj: string, problemId: string): string | null => {
    if (oj === 'luogu') return `https://www.luogu.com.cn/problem/${problemId}`
    if (oj === 'codeforces') {
      // CF 题号格式如 1234A, 1234B1, round1234_problemA
      const match = problemId.match(/^(\d+)/)
      if (match) {
        const contestId = match[1]
        const problemIndex = problemId.replace(contestId, '') || problemId
        return `https://codeforces.com/problemset/problem/${contestId}/${problemIndex}`
      }
    }
    return null
  }

  // 点击题号跳转题库本地题目详情页
  const handleProblemClick = (submission: Submission) => {
    if (canClickProblem(submission)) {
      window.open(`${getPathPrefix()}/problems/${submission.problemInternalId}`, '_blank')
    }
  }

  const fetchSubmissions = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterUsername) params.set('username', filterUsername)
      if (filterOj) params.set('oj', filterOj)
      if (filterProblemId) params.set('problemId', filterProblemId)
      if (filterResult) params.set('result', filterResult)
      if (filterLanguage) params.set('language', filterLanguage)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))

      const res = await apiClient.get<{
        submissions?: any[]
        totalPages?: number
        total?: number
      }>(`/api/submissions?${params.toString()}`)
      if (res.success && res.data) {
        setSubmissions(res.data.submissions || [])
        setTotalPages(res.data.totalPages || 0)
        setTotal(res.data.total || 0)
      }
    } catch {
      // 暂时忽略错误，后端骨架返回空数组
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSubmissions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const handleFilter = () => {
    setPage(1)
    fetchSubmissions()
  }

  const handleReset = () => {
    setFilterUsername('')
    setFilterOj('')
    setFilterProblemId('')
    setFilterResult('')
    setFilterLanguage('')
    setPage(1)
  }

  const getOjLabel = (oj: string) => {
    if (oj === 'carits') return 'Carits平台'
    return OJ_PLATFORM_LABEL_MAP[oj] || oj.toUpperCase()
  }

  // 转圈动画组件
  const Spinner = () => (
    <span style={{
      display: 'inline-block',
      width: '12px',
      height: '12px',
      border: '2px solid #e5e7eb',
      borderTopColor: 'var(--primary)',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginRight: '4px',
      verticalAlign: 'middle',
    }} />
  )

  const getResultBadge = (result: string) => {
    const label = JUDGE_RESULT_LABEL_MAP[result] || result
    const colors = RESULT_COLORS[result] || { bg: 'var(--bg-muted)', text: 'var(--text-secondary)' }

    // queuing 状态显示转圈动画
    if (result === 'queuing') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: 500,
          background: colors.bg,
          color: colors.text,
        }}>
          <Spinner />
          {label}
        </span>
      )
    }

    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 500,
        background: colors.bg,
        color: colors.text,
      }}>
        {label}
      </span>
    )
  }

  return (
    <ProtectedRoute>
      {/* 添加 spin 动画 */}
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', color: 'var(--text-primary)' }}>
          评测记录
        </h2>

        {/* 筛选栏 */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
          marginBottom: '1rem',
          padding: '1rem',
          background: 'var(--bg-muted)',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>用户名</label>
            <input
              style={inputStyle}
              placeholder="搜索用户名"
              value={filterUsername}
              onChange={e => setFilterUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleFilter()}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>OJ</label>
            <select aria-label="选择"
              style={selectStyle}
              value={filterOj}
              onChange={e => setFilterOj(e.target.value)}
            >
              {SUBMISSION_OJ_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>题号</label>
            <input
              style={inputStyle}
              placeholder="搜索题号"
              value={filterProblemId}
              onChange={e => setFilterProblemId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleFilter()}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>评测结果</label>
            <select aria-label="选择"
              style={selectStyle}
              value={filterResult}
              onChange={e => setFilterResult(e.target.value)}
            >
              {JUDGE_RESULT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>语言</label>
            <select aria-label="选择"
              style={selectStyle}
              value={filterLanguage}
              onChange={e => setFilterLanguage(e.target.value)}
            >
              {LANGUAGE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', paddingTop: '16px' }}>
            <button
              onClick={handleFilter}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              过滤
            </button>
            <button
              onClick={handleReset}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--gray-100)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              重置
            </button>
          </div>
        </div>

        {/* 表格 */}
        <div style={{
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>评测ID</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>用户名</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>OJ</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>题号</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>评测结果</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>耗时(MS)</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>内存(MB)</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>代码长度(B)</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>语言</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>提交时间</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    加载中...
                  </td>
                </tr>
              ) : submissions.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    暂无评测记录
                  </td>
                </tr>
              ) : (
                submissions.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td
                      onClick={() => router.push(`${getPathPrefix()}/submissions/${s.id}`)}
                      style={{ padding: '0.75rem 1rem', color: 'var(--primary)', fontFamily: 'monospace', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      #{s.id}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.username}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{getOjLabel(s.oj)}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {canClickProblem(s) ? (
                      <span
                        onClick={() => handleProblemClick(s)}
                        style={{
                          color: 'var(--primary)',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        {s.problemId}
                      </span>
                      ) : getExternalProblemUrl(s.oj, s.problemId) ? (
                      <a
                        href={getExternalProblemUrl(s.oj, s.problemId)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: 'var(--primary)',
                          textDecoration: 'underline',
                        }}
                      >
                        {s.problemId}
                      </a>
                      ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {s.problemId}
                      </span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>{getResultBadge(s.result)}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{formatTime(s.timeUsed)}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{formatMemory(s.oj, s.memoryUsed)}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.codeLength ?? '-'}</td>
                    <td
                      onClick={() => setDetailSubmissionId(s.id)}
                      style={{
                        padding: '0.75rem 1rem',
                        color: 'var(--primary)',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      {getLanguageLabel(s.language)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {new Date(s.submittedAt).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {total > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>
        )}

        {/* 提交详情弹窗 */}
        <SubmissionDetailModal
          isOpen={detailSubmissionId !== null}
          onClose={() => setDetailSubmissionId(null)}
          submissionId={detailSubmissionId}
          viewRole={viewRole}
        />
      </div>
    </ProtectedRoute>
  )
}
