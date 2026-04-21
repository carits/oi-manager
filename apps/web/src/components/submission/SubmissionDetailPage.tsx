'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import apiClient from '@/lib/apiClient'
import { getLanguageLabel } from '@/lib/judge-constants'
import { getAvatarUrl } from '@/lib/assets'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'

interface CaseResult {
  caseId: number
  subtaskId?: number
  result: string
  time: number
  memory: number
  score?: number
  message?: string
}

interface SubtaskResult {
  id: number
  type: string
  score: number
  cases: CaseResult[]
}

interface SubmissionDetail {
  id: number
  username: string
  submitterName: string
  submitterAvatar: string | null
  oj: string
  problemId: string
  problemTitle: string | null
  result: string
  timeUsed: number | null
  memoryUsed: number | null
  score: number | null
  cases: CaseResult[] | null
  subtasks: SubtaskResult[] | null
  codeLength: number
  language: string
  code: string
  submitMethod: string
  ojRemoteId: string | null
  submittedAt: string
  errorMessage: string | null
}

interface SubmissionDetailPageProps {
  role: 'teacher' | 'student' | 'admin'
  submissionId: string
}

// Hydro-style score color gradient (0=red → 100=green)
function getScoreColor(score: number): string {
  const colors = [
    '#ff4f4f', '#ff694f', '#f8603a', '#fc8354', '#fa9231',
    '#f7bb3b', '#ecdb44', '#e2ec52', '#b0d628', '#93b127', '#25ad40',
  ]
  return colors[Math.floor(Math.max(0, Math.min(100, score)) / 10)]
}

// Map result to Hydro-style status class
function getStatusClass(result: string): 'pass' | 'fail' | 'progress' | 'pending' {
  if (result === 'accepted') return 'pass'
  if (result === 'queuing') return 'pending'
  if (result === 'judging') return 'progress'
  return 'fail'
}

// Hydro-style status colors
const STATUS_COLORS: Record<string, string> = {
  pass: '#25ad40',
  fail: '#fb5555',
  progress: '#f39800',
  pending: '#9fa0a0',
}

// Result display labels
const RESULT_LABELS: Record<string, string> = {
  accepted: 'Accepted',
  queuing: 'Waiting',
  judging: 'Running',
  tle: 'Time Exceeded',
  mle: 'Memory Exceeded',
  wa: 'Wrong Answer',
  re: 'Runtime Error',
  ce: 'Compile Error',
  pe: 'Presentation Error',
  ole: 'Output Exceeded',
  submit_failed: 'Submit Failed',
  se: 'System Error',
  skipped: 'Skipped',
}

// Case result status class
function getCaseStatusClass(result: string): 'pass' | 'fail' | 'skip' {
  if (result === 'Accepted') return 'pass'
  if (result === 'Skipped') return 'skip'
  return 'fail'
}

// Language to highlight.js mapping
const LANGUAGE_HLJS_MAP: Record<string, string> = {
  c: 'c', cpp: 'cpp', csharp: 'csharp', java: 'java', python: 'python',
  pascal: 'delphi', go: 'go', rust: 'rust', javascript: 'javascript',
  typescript: 'typescript', kotlin: 'kotlin', ruby: 'ruby', php: 'php',
  lua: 'lua', perl: 'perl', scala: 'scala', swift: 'swift', haskell: 'haskell',
  '0': 'cpp', '1': 'c', '2': 'cpp', '3': 'c', '4': 'delphi', '5': 'java', '6': 'csharp',
}

// OJ display labels
const OJ_LABELS: Record<string, string> = {
  carits: 'Carits平台',
  luogu: '洛谷',
  codeforces: 'CF',
  hdu: 'HDU',
  qoj: 'QOJ',
  loj: 'LOJ',
}

function formatMemory(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)}MB`
  return `${kb}KB`
}

export function SubmissionDetailPage({ role, submissionId }: SubmissionDetailPageProps) {
  const router = useRouter()
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [showCode, setShowCode] = useState(true)
  const [expandedCase, setExpandedCase] = useState<number | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!submissionId) return

    const fetchDetail = async () => {
      try {
        const res = await apiClient.get<SubmissionDetail>(`/api/submissions/${submissionId}`)
        if (res.success && res.data) {
          setDetail(res.data)
          setLoading(false)
          if (res.data.result !== 'queuing' && res.data.result !== 'judging') {
            if (intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
            }
          }
        }
      } catch {
        setLoading(false)
      }
    }

    fetchDetail()
    intervalRef.current = setInterval(fetchDetail, 2000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [submissionId])

  const handleCopy = async () => {
    if (detail?.code) {
      try {
        await navigator.clipboard.writeText(detail.code)
      } catch {
        const textarea = document.createElement('textarea')
        textarea.value = detail.code
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const getHighlightedCode = () => {
    if (!detail?.code) return ''
    const lang = LANGUAGE_HLJS_MAP[detail.language] || 'cpp'
    try {
      return hljs.highlight(detail.code, { language: lang }).value
    } catch {
      return detail.code
    }
  }

  const getPathPrefix = () => {
    if (role === 'admin') return '/platform-admin'
    if (role === 'student') return '/student'
    return '/teacher'
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole={role === 'admin' ? undefined : role}>
        <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
          加载中...
        </div>
      </ProtectedRoute>
    )
  }

  if (!detail) {
    return (
      <ProtectedRoute requiredRole={role === 'admin' ? undefined : role}>
        <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
          提交记录不存在
          <div style={{ marginTop: '1rem' }}>
            <button
              onClick={() => router.push(`${getPathPrefix()}/submissions`)}
              style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              返回评测记录
            </button>
          </div>
        </div>
      </ProtectedRoute>
    )
  }

  const statusClass = getStatusClass(detail.result)
  const statusColor = STATUS_COLORS[statusClass]
  const resultLabel = RESULT_LABELS[detail.result] || detail.result
  const isQueuing = detail.result === 'queuing' || detail.result === 'judging'
  const ojLabel = OJ_LABELS[detail.oj] || detail.oj

  // Calculate summary stats from cases
  const cases = detail.cases || []
  const passedCount = cases.filter(c => c.result === 'Accepted').length
  const peakTime = cases.length > 0 ? Math.max(...cases.map(c => c.time || 0)) : null
  const peakMemory = cases.length > 0 ? Math.max(...cases.map(c => c.memory || 0)) : null

  return (
    <ProtectedRoute requiredRole={role === 'admin' ? undefined : role}>
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={{ padding: '1rem 1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <button
            onClick={() => router.push(`${getPathPrefix()}/submissions`)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.875rem', color: '#6b7280', padding: '0.25rem 0',
            }}
          >
            ← 返回列表
          </button>
          <span style={{ color: '#d1d5db' }}>|</span>
          <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>#{detail.id}</span>
        </div>

        <div style={{ display: 'flex', gap: '1.25rem' }}>
          {/* Left column (9/12) */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Status section header — Hydro style */}
            <div style={{
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              overflow: 'hidden',
              marginBottom: '1rem',
            }}>
              <div style={{
                padding: '0.875rem 1rem',
                background: '#fafafa',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                {/* Status icon */}
                {isQueuing ? (
                  <span style={{
                    display: 'inline-block',
                    width: '16px', height: '16px',
                    border: '2px solid #e5e7eb',
                    borderTopColor: statusColor,
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                ) : statusClass === 'pass' ? (
                  <span style={{ color: statusColor, fontSize: '1.1rem', lineHeight: 1 }}>✓</span>
                ) : (
                  <span style={{ color: statusColor, fontSize: '1rem', lineHeight: 1 }}>✕</span>
                )}
                {/* Score */}
                {detail.score !== null && detail.score !== undefined && (
                  <span style={{
                    color: getScoreColor(detail.score),
                    fontWeight: 700,
                    fontSize: '1.125rem',
                  }}>
                    {detail.score}
                  </span>
                )}
                {/* Status text */}
                <span style={{ color: statusColor, fontWeight: 600, fontSize: '0.9375rem' }}>
                  {resultLabel}
                </span>
                {/* Progress */}
                {isQueuing && detail.cases && detail.cases.length > 0 && (
                  <span style={{ color: '#9ca3af', fontSize: '0.8125rem', marginLeft: '0.25rem' }}>
                    {passedCount}/{cases.length}
                  </span>
                )}
              </div>

              {/* Compiler / error text */}
              {detail.errorMessage && (
                <div style={{
                  padding: '0.625rem 1rem',
                  background: '#fff5f5',
                  fontSize: '0.8125rem',
                  color: '#991b1b',
                  fontFamily: 'Consolas, Monaco, monospace',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '200px',
                  overflow: 'auto',
                }}>
                  {detail.errorMessage}
                </div>
              )}

              {/* Test case table — Hydro style */}
              {cases.length > 0 && (
                <div style={{ overflow: 'auto', maxHeight: '500px' }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.8125rem',
                  }}>
                    <thead>
                      <tr style={{ background: '#fafafa' }}>
                        <th style={{ padding: '0.5rem 0.625rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', width: '60px' }}>#</th>
                        <th style={{ padding: '0.5rem 0.625rem', textAlign: 'left', fontWeight: 500, color: '#6b7280' }}>Status</th>
                        <th style={{ padding: '0.5rem 0.625rem', textAlign: 'right', fontWeight: 500, color: '#6b7280', width: '80px' }}>Score</th>
                        <th style={{ padding: '0.5rem 0.625rem', textAlign: 'right', fontWeight: 500, color: '#6b7280', width: '100px' }}>Time</th>
                        <th style={{ padding: '0.5rem 0.625rem', textAlign: 'right', fontWeight: 500, color: '#6b7280', width: '100px' }}>Memory</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const subtasks = detail.subtasks
                        if (subtasks && subtasks.length > 0) {
                          // 按子任务分组显示
                          const rows: React.ReactNode[] = []
                          let caseIdx = 0
                          for (const st of subtasks) {
                            const stPassed = st.cases.every(c => c.result === 'Accepted')
                            const stColor = stPassed ? '#25ad40' : '#fb5555'
                            // 子任务标题行
                            rows.push(
                              <tr key={`st-${st.id}`} style={{ background: '#f8f9fa' }}>
                                <td colSpan={5} style={{
                                  padding: '0.5rem 0.625rem',
                                  borderLeft: `3px solid ${stColor}`,
                                  fontWeight: 600,
                                  fontSize: '0.8125rem',
                                }}>
                                  <span style={{ color: '#374151' }}>子任务 {st.id}</span>
                                  <span style={{ marginLeft: '0.75rem', color: '#9ca3af', fontWeight: 400 }}>
                                    {st.cases.length} 测试点 · {st.type}
                                  </span>
                                  <span style={{ marginLeft: '0.75rem', fontWeight: 700, color: stColor }}>
                                    {st.score} 分
                                  </span>
                                </td>
                              </tr>
                            )
                            // 子任务的测试点行
                            for (const c of st.cases) {
                              const cClass = getCaseStatusClass(c.result)
                              const borderColor = cClass === 'pass' ? '#25ad40' : cClass === 'skip' ? '#9ca3af' : '#fb5555'
                              rows.push(
                                <tr key={`case-${caseIdx}`}>
                                  <td style={{
                                    padding: '0.5rem 0.625rem',
                                    color: '#6b7280',
                                    borderLeft: `3px solid ${borderColor}`,
                                    fontWeight: 500,
                                  }}>
                                    {caseIdx + 1}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.625rem' }}>
                                    <span style={{ color: cClass === 'pass' ? '#25ad40' : cClass === 'skip' ? '#9ca3af' : '#fb5555', fontWeight: 500 }}>
                                      {cClass === 'pass' ? '✓' : cClass === 'skip' ? '-' : '✕'}
                                    </span>
                                    <span style={{ marginLeft: '0.375rem', color: '#374151' }}>{c.result}</span>
                                    {c.message && (
                                      <span style={{ marginLeft: '0.5rem', color: '#9ca3af', fontSize: '0.75rem' }}>{c.message}</span>
                                    )}
                                  </td>
                                  <td style={{
                                    padding: '0.5rem 0.625rem',
                                    textAlign: 'right',
                                    color: c.score !== undefined && c.score !== null
                                      ? (cClass === 'pass' ? '#25ad40' : '#fb5555')
                                      : '#9ca3af',
                                    fontWeight: 600,
                                  }}>
                                    {c.score !== undefined && c.score !== null ? c.score : '-'}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.625rem', textAlign: 'right', color: '#374151' }}>
                                    {c.time ? `${c.time}ms` : '-'}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.625rem', textAlign: 'right', color: '#374151' }}>
                                    {c.memory ? formatMemory(c.memory) : '-'}
                                  </td>
                                </tr>
                              )
                              caseIdx++
                            }
                          }
                          return rows
                        }
                        // 无子任务：直接显示测试点
                        return cases.map((c, idx) => {
                          const cClass = getCaseStatusClass(c.result)
                          const borderColor = cClass === 'pass' ? '#25ad40' : cClass === 'skip' ? '#9ca3af' : '#fb5555'
                          return (
                            <tr key={idx}>
                              <td style={{
                                padding: '0.5rem 0.625rem',
                                color: '#6b7280',
                                borderLeft: `3px solid ${borderColor}`,
                                fontWeight: 500,
                              }}>
                                {idx + 1}
                              </td>
                              <td style={{ padding: '0.5rem 0.625rem' }}>
                                <span style={{ color: cClass === 'pass' ? '#25ad40' : cClass === 'skip' ? '#9ca3af' : '#fb5555', fontWeight: 500 }}>
                                  {cClass === 'pass' ? '✓' : cClass === 'skip' ? '-' : '✕'}
                                </span>
                                <span style={{ marginLeft: '0.375rem', color: '#374151' }}>{c.result}</span>
                                {c.message && (
                                  <span style={{ marginLeft: '0.5rem', color: '#9ca3af', fontSize: '0.75rem' }}>{c.message}</span>
                                )}
                              </td>
                              <td style={{
                                padding: '0.5rem 0.625rem',
                                textAlign: 'right',
                                color: c.score !== undefined && c.score !== null
                                  ? (cClass === 'pass' ? '#25ad40' : '#fb5555')
                                  : '#9ca3af',
                                fontWeight: 600,
                              }}>
                                {c.score !== undefined && c.score !== null ? c.score : '-'}
                              </td>
                              <td style={{ padding: '0.5rem 0.625rem', textAlign: 'right', color: '#374151' }}>
                                {c.time ? `${c.time}ms` : '-'}
                              </td>
                              <td style={{ padding: '0.5rem 0.625rem', textAlign: 'right', color: '#374151' }}>
                                {c.memory ? formatMemory(c.memory) : '-'}
                              </td>
                            </tr>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Summary bar — Hydro style horizontal dl */}
              {(detail.score !== null && detail.score !== undefined || detail.timeUsed || detail.memoryUsed) && (
                <div style={{
                  display: 'flex',
                  gap: '2rem',
                  padding: '0.625rem 1rem',
                  borderTop: '1px solid #f3f4f6',
                  background: '#fafafa',
                  fontSize: '0.8125rem',
                  color: '#6b7280',
                }}>
                  {detail.score !== null && detail.score !== undefined && (
                    <div>
                      <span>Score: </span>
                      <span style={{ fontWeight: 600, color: getScoreColor(detail.score) }}>{detail.score}</span>
                    </div>
                  )}
                  {detail.timeUsed !== null && detail.timeUsed !== undefined && (
                    <div>
                      <span>Total Time: </span>
                      <span style={{ fontWeight: 500, color: '#374151' }}>{detail.timeUsed}ms</span>
                    </div>
                  )}
                  {peakTime !== null && (
                    <div>
                      <span>Peak Time: </span>
                      <span style={{ fontWeight: 500, color: '#374151' }}>{peakTime}ms</span>
                    </div>
                  )}
                  {detail.memoryUsed !== null && detail.memoryUsed !== undefined && (
                    <div>
                      <span>Peak Memory: </span>
                      <span style={{ fontWeight: 500, color: '#374151' }}>{formatMemory(detail.memoryUsed)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Code section */}
            <div style={{
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.625rem 1rem',
                background: '#fafafa',
                borderBottom: '1px solid #e5e7eb',
              }}>
                <button
                  onClick={() => setShowCode(!showCode)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', color: '#374151' }}
                >
                  {showCode ? '▾ Source Code' : '▸ Source Code'}
                  <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: '0.5rem', fontSize: '0.8125rem' }}>
                    ({detail.codeLength}B)
                  </span>
                </button>
                {showCode && (
                  <button
                    onClick={handleCopy}
                    style={{
                      padding: '0.25rem 0.625rem',
                      background: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      color: '#374151',
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              {showCode && (
                <div style={{
                  maxHeight: '500px',
                  overflow: 'auto',
                  background: '#f8fafc',
                }}>
                  <pre style={{
                    margin: 0,
                    padding: '1rem',
                    fontSize: '0.8125rem',
                    lineHeight: 1.6,
                  }}>
                    <code
                      dangerouslySetInnerHTML={{ __html: getHighlightedCode() }}
                      style={{ fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace" }}
                    />
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* Right column (3/12) — Information sidebar */}
          <div style={{ width: '260px', flexShrink: 0 }}>
            <div style={{
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '0.625rem 1rem',
                background: '#fafafa',
                borderBottom: '1px solid #e5e7eb',
                fontWeight: 600,
                fontSize: '0.875rem',
                color: '#374151',
              }}>
                Information
              </div>

              <div style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem' }}>
                {/* Submitter */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: '#9ca3af', marginBottom: '0.25rem', fontSize: '0.75rem' }}>Submit By</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {detail.submitterAvatar ? (
                      <img
                        src={getAvatarUrl(detail.submitterAvatar)}
                        alt=""
                        style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '50%',
                        background: 'var(--primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 600, color: '#fff',
                      }}>
                        {detail.submitterName?.charAt(0) || '?'}
                      </div>
                    )}
                    <span style={{ fontWeight: 500, color: '#1e293b' }}>{detail.submitterName}</span>
                  </div>
                </div>

                {/* Problem */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: '#9ca3af', marginBottom: '0.25rem', fontSize: '0.75rem' }}>Problem</div>
                  <div style={{ fontWeight: 500, color: '#1e293b' }}>
                    [{ojLabel}-{detail.problemId}]
                    {detail.problemTitle ? ` ${detail.problemTitle}` : ''}
                  </div>
                </div>

                {/* Language */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: '#9ca3af', marginBottom: '0.25rem', fontSize: '0.75rem' }}>Language</div>
                  <div style={{ fontWeight: 500, color: '#1e293b' }}>{getLanguageLabel(detail.language)}</div>
                </div>

                {/* Code Length */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: '#9ca3af', marginBottom: '0.25rem', fontSize: '0.75rem' }}>Code Length</div>
                  <div style={{ fontWeight: 500, color: '#1e293b' }}>{detail.codeLength}B</div>
                </div>

                {/* Submit At */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: '#9ca3af', marginBottom: '0.25rem', fontSize: '0.75rem' }}>Submit At</div>
                  <div style={{ fontWeight: 500, color: '#1e293b' }}>
                    {new Date(detail.submittedAt).toLocaleString('zh-CN')}
                  </div>
                </div>

                {/* OJ Remote ID */}
                {detail.ojRemoteId && (
                  <div>
                    <div style={{ color: '#9ca3af', marginBottom: '0.25rem', fontSize: '0.75rem' }}>Remote ID</div>
                    <div style={{ fontWeight: 500, color: '#1e293b' }}>
                      {detail.oj === 'carits' ? (
                        <a
                          href={`${role === 'admin' ? '/platform-admin' : role === 'student' ? '/student' : '/teacher'}/submissions/${detail.ojRemoteId}`}
                          style={{ color: 'var(--primary)', textDecoration: 'none' }}
                        >
                          {detail.ojRemoteId}
                        </a>
                      ) : detail.oj === 'hdu' ? (
                        <a
                          href={`https://acm.hdu.edu.cn/status.php?first=${detail.ojRemoteId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--primary)', textDecoration: 'none' }}
                        >
                          {detail.ojRemoteId}
                        </a>
                      ) : (
                        detail.ojRemoteId
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}
