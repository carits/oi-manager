'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import apiClient from '@/lib/apiClient'
import { JUDGE_RESULT_LABEL_MAP, getLanguageLabel } from '@/lib/judge-constants'
import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'

interface SubmissionDetail {
  id: number
  username: string
  oj: string
  problemId: string
  result: string
  timeUsed: number | null
  memoryUsed: number | null
  codeLength: number
  language: string
  code: string
  submitMethod: string
  ojRemoteId: string | null
  ojAccountUsername: string | null
  submittedAt: string
  errorMessage: string | null
  // 训练特有字段
  score?: number | null
  cases?: any[] | null
  subtasks?: any[] | null
  trainingProblemId?: string
}

interface SubmissionDetailModalProps {
  isOpen: boolean
  onClose: () => void
  submissionId: number | null
  viewRole?: 'teacher' | 'student' | 'admin'
  trainingId?: number // 可选：用于训练模块的提交详情
}

// 转圈动画组件
const Spinner = () => (
  <span style={{
    display: 'inline-block',
    width: '14px',
    height: '14px',
    border: '2px solid #e5e7eb',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginRight: '6px',
    verticalAlign: 'middle',
  }} />
)

// 语言 ID 到 highlight.js 语言名映射
const LANGUAGE_HLJS_MAP: Record<string, string> = {
  'c': 'c',
  'cpp': 'cpp',
  'csharp': 'csharp',
  'java': 'java',
  'python': 'python',
  'pascal': 'delphi',
  'go': 'go',
  'rust': 'rust',
  'javascript': 'javascript',
  'typescript': 'typescript',
  'kotlin': 'kotlin',
  'ruby': 'ruby',
  'php': 'php',
  'lua': 'lua',
  'perl': 'perl',
  'scala': 'scala',
  'swift': 'swift',
  'haskell': 'haskell',
  // HDU 语言 ID
  '0': 'cpp', // G++
  '1': 'c',   // GCC
  '2': 'cpp', // C++
  '3': 'c',   // C
  '4': 'delphi', // Pascal
  '5': 'java',   // Java
  '6': 'csharp', // C#
}

// 评测结果颜色
const RESULT_COLORS: Record<string, { bg: string; text: string }> = {
  accepted: { bg: '#dcfce7', text: '#166534' },
  queuing: { bg: '#dbeafe', text: '#1e40af' },
  judging: { bg: '#dbeafe', text: '#1e40af' },
  tle: { bg: '#fef3c7', text: '#92400e' },
  mle: { bg: '#fef3c7', text: '#92400e' },
  wa: { bg: '#fee2e2', text: '#991b1b' },
  re: { bg: '#fee2e2', text: '#991b1b' },
  ce: { bg: '#f3e8ff', text: '#6b21a8' },
  pe: { bg: '#fef3c7', text: '#92400e' },
  ole: { bg: '#fef3c7', text: '#92400e' },
  submit_failed: { bg: '#fee2e2', text: '#991b1b' },
}

// 测试点状态分类
function getCaseStatusClass(result: string): 'pass' | 'fail' | 'skip' {
  if (result === 'Accepted' || result === 'accepted') return 'pass'
  if (result === 'System Error' || result === 'Skipped') return 'skip'
  return 'fail'
}

function getRemoteSubmitUrl(oj: string, ojRemoteId: string, viewRole?: string): string | null {
  if (oj === 'hdu') {
    return `https://acm.hdu.edu.cn/status.php?first=${ojRemoteId}`
  }
  if (oj === 'carits' && viewRole) {
    const prefix = viewRole === 'admin' ? '/platform-admin' : viewRole === 'student' ? '/student' : '/teacher'
    return `${prefix}/submissions/${ojRemoteId}`
  }
  return null
}

export function SubmissionDetailModal({ isOpen, onClose, submissionId, viewRole, trainingId }: SubmissionDetailModalProps) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isOpen && submissionId) {
      setLoading(true)

      const fetchDetail = async () => {
        const res = await apiClient.get<SubmissionDetail>(`/api/submissions/${submissionId}`)
        if (res.success && res.data) {
          setDetail(res.data)
          setLoading(false)
          // 如果不再是 queuing 状态，停止轮询
          if (res.data.result !== 'queuing' && intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      }

      fetchDetail() // 立即加载一次

      // 如果是 queuing 状态，启动轮询
      if (detail?.result === 'queuing' || !detail) {
        intervalRef.current = setInterval(fetchDetail, 2000)
      }

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    }
  }, [isOpen, submissionId, trainingId])

  const handleCopy = async () => {
    if (detail?.code) {
      try {
        await navigator.clipboard.writeText(detail.code)
      } catch {
        // Fallback for non-HTTPS contexts (e.g. IP address access)
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

  const getResultBadge = (result: string, score?: number | null) => {
    const label = JUDGE_RESULT_LABEL_MAP[result] || result
    const colors = RESULT_COLORS[result] || { bg: '#f3f4f6', text: '#374151' }

    // queuing 状态显示转圈动画
    if (result === 'queuing' || result === 'judging') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '4px 12px',
          borderRadius: '6px',
          fontSize: '0.875rem',
          fontWeight: 600,
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
        padding: '4px 12px',
        borderRadius: '6px',
        fontSize: '0.875rem',
        fontWeight: 600,
        background: colors.bg,
        color: colors.text,
      }}>
        {result === 'accepted' && <span style={{ marginRight: '4px' }}>✓</span>}
        {result !== 'accepted' && result !== 'queuing' && result !== 'judging' && <span style={{ marginRight: '4px' }}>✕</span>}
        {label}
      </span>
    )
  }

  const getLanguageLabelLocal = (lang: string) => {
    return getLanguageLabel(lang)
  }

  const getOjLabel = (oj: string) => {
    return OJ_PLATFORM_LABEL_MAP[oj] || oj
  }

  if (!isOpen) return null

  return (
    <>
      {/* 添加 spin 动画 */}
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={detail ? `#${detail.id} | ${detail.username}'s solution for [${getOjLabel(detail.oj)}-${detail.problemId}]` : '加载中...'}
        width="900px"
      >
      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
          加载中...
        </div>
      ) : detail ? (
        <div>
          {/* 提交信息表格 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '1rem',
            marginBottom: '1.5rem',
            padding: '1rem',
            background: '#f9fafb',
            borderRadius: '8px',
          }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>评测结果</div>
              {getResultBadge(detail.result, detail.score)}
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>耗时</div>
              <div style={{ fontWeight: 500 }}>{detail.timeUsed ? `${detail.timeUsed}MS` : '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>内存</div>
              <div style={{ fontWeight: 500 }}>
                {detail.memoryUsed != null
                  ? `${(detail.memoryUsed / 1024).toFixed(2)}MB`
                  : '-'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>代码长度</div>
              <div style={{ fontWeight: 500 }}>{detail.codeLength}B</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>语言</div>
              <div style={{ fontWeight: 500 }}>{getLanguageLabelLocal(detail.language)}</div>
            </div>
          </div>

          {/* 提交时间和远程提交ID */}
          <div style={{
            display: 'flex',
            gap: '2rem',
            marginBottom: '1.5rem',
            padding: '0.75rem 1rem',
            background: '#f9fafb',
            borderRadius: '8px',
          }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>提交时间：</span>
              <span style={{ fontWeight: 500 }}>{new Date(detail.submittedAt).toLocaleString('zh-CN')}</span>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>远程提交ID：</span>
              {detail.ojRemoteId ? (
                getRemoteSubmitUrl(detail.oj, detail.ojRemoteId, viewRole) ? (
                  <a
                    href={getRemoteSubmitUrl(detail.oj, detail.ojRemoteId, viewRole)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--primary)', textDecoration: 'none' }}
                  >
                    {detail.ojRemoteId}
                  </a>
                ) : (
                  <span>{detail.ojRemoteId}</span>
                )
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', color: '#6b7280' }}>
                  <Spinner />
                  等待分配...
                </span>
              )}
            </div>
          </div>

          {/* 错误信息 */}
          {detail.errorMessage && (
            <div style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              background: '#fef2f2',
              borderRadius: '8px',
              color: '#991b1b',
              fontSize: '0.875rem',
            }}>
              {detail.errorMessage}
            </div>
          )}

          {/* 测试点表格 — Hydro 风格（训练提交） */}
          {detail.cases && detail.cases.length > 0 && (
            <div style={{
              marginBottom: '1rem',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              overflow: 'hidden',
            }}>
              {/* 测试点摘要色条 */}
              <div style={{
                padding: '0.5rem 1rem',
                background: '#f9fafb',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>测试点摘要：</span>
                <div style={{ display: 'flex', gap: '2px' }}>
                  {detail.cases.map((c: any, idx: number) => {
                    const cClass = getCaseStatusClass(c.result || c.status || '')
                    return (
                      <div
                        key={idx}
                        title={`#${idx + 1} ${c.result || c.status || '-'}`}
                        style={{
                          width: '8px',
                          height: '18px',
                          borderRadius: '2px',
                          background: cClass === 'pass' ? '#25ad40' : cClass === 'skip' ? '#9ca3af' : '#fb5555',
                          opacity: cClass === 'pass' ? 0.8 : 1,
                        }}
                      />
                    )
                  })}
                </div>
              </div>

              {/* 测试点表格 */}
              <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.8125rem',
                }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ padding: '0.5rem 0.625rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', width: '60px' }}>#</th>
                      <th style={{ padding: '0.5rem 0.625rem', textAlign: 'left', fontWeight: 500, color: '#6b7280' }}>状态</th>
                      <th style={{ padding: '0.5rem 0.625rem', textAlign: 'right', fontWeight: 500, color: '#6b7280', width: '90px' }}>耗时</th>
                      <th style={{ padding: '0.5rem 0.625rem', textAlign: 'right', fontWeight: 500, color: '#6b7280', width: '90px' }}>内存</th>
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
                          const stPassed = (st.cases || []).every((c: any) => (c.result || c.status) === 'Accepted' || (c.result || c.status) === 'accepted')
                          const stColor = stPassed ? '#25ad40' : '#fb5555'
                          // 子任务标题行
                          rows.push(
                            <tr key={`st-${st.id}`} style={{ background: '#f8f9fa' }}>
                              <td colSpan={4} style={{ padding: '0.5rem 0.625rem', fontWeight: 600 }}>
                                <span style={{
                                  display: 'inline-block',
                                  width: '4px',
                                  height: '14px',
                                  borderRadius: '2px',
                                  background: stColor,
                                  marginRight: '6px',
                                  verticalAlign: 'middle',
                                }} />
                                子任务 {st.id}
                                <span style={{ marginLeft: '0.5rem', color: '#6b7280', fontSize: '0.75rem' }}>
                                  ({(st.cases || []).length} 个测试点)
                                </span>
                              </td>
                            </tr>
                          )
                          // 子任务下的测试点
                          for (const c of (st.cases || [])) {
                            const cClass = getCaseStatusClass(c.result || c.status || '')
                            const cColor = cClass === 'pass' ? '#25ad40' : cClass === 'skip' ? '#9ca3af' : '#fb5555'
                            rows.push(
                              <tr key={`st-${st.id}-${caseIdx}`} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                <td style={{ padding: '0.5rem 0.625rem', color: '#6b7280' }}>{caseIdx + 1}</td>
                                <td style={{ padding: '0.5rem 0.625rem' }}>
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    background: cClass === 'pass' ? '#dcfce7' : cClass === 'skip' ? '#f3f4f6' : '#fee2e2',
                                    color: cColor,
                                    fontSize: '0.75rem',
                                    fontWeight: 500,
                                  }}>
                                    {cClass === 'pass' ? '✓' : cClass === 'skip' ? '⊘' : '✕'}
                                    {c.result || c.status || '-'}
                                  </span>
                                </td>
                                <td style={{ padding: '0.5rem 0.625rem', textAlign: 'right', color: '#374151' }}>
                                  {c.time ? `${c.time}ms` : '-'}
                                </td>
                                <td style={{ padding: '0.5rem 0.625rem', textAlign: 'right', color: '#374151' }}>
                                  {c.memory ? `${c.memory}KB` : '-'}
                                </td>
                              </tr>
                            )
                            caseIdx++
                          }
                        }
                        return rows
                      } else {
                        // 无子任务，平铺显示
                        return detail.cases.map((c: any, idx: number) => {
                          const cClass = getCaseStatusClass(c.result || c.status || '')
                          const cColor = cClass === 'pass' ? '#25ad40' : cClass === 'skip' ? '#9ca3af' : '#fb5555'
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '0.5rem 0.625rem', color: '#6b7280' }}>{idx + 1}</td>
                              <td style={{ padding: '0.5rem 0.625rem' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  background: cClass === 'pass' ? '#dcfce7' : cClass === 'skip' ? '#f3f4f6' : '#fee2e2',
                                  color: cColor,
                                  fontSize: '0.75rem',
                                  fontWeight: 500,
                                }}>
                                  {cClass === 'pass' ? '✓' : cClass === 'skip' ? '⊘' : '✕'}
                                  {c.result || c.status || '-'}
                                </span>
                              </td>
                              <td style={{ padding: '0.5rem 0.625rem', textAlign: 'right', color: '#374151' }}>
                                {c.time ? `${c.time}ms` : '-'}
                              </td>
                              <td style={{ padding: '0.5rem 0.625rem', textAlign: 'right', color: '#374151' }}>
                                {c.memory ? `${c.memory}KB` : '-'}
                              </td>
                            </tr>
                          )
                        })
                      }
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 源码显示区 */}
          <div style={{
            position: 'relative',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            overflow: 'hidden',
          }}>
            {/* Copy Code 按钮 */}
            <button
              onClick={handleCopy}
              style={{
                position: 'absolute',
                top: '0.5rem',
                right: '0.5rem',
                padding: '0.375rem 0.75rem',
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '4px',
                fontSize: '0.75rem',
                cursor: 'pointer',
                zIndex: 10,
              }}
            >
              {copied ? '已复制' : 'Copy Code'}
            </button>

            {/* 代码区域 */}
            <div style={{
              maxHeight: '400px',
              overflow: 'auto',
              background: '#f8fafc',
            }}>
              <pre style={{
                margin: 0,
                padding: '1rem',
                fontSize: '0.875rem',
                lineHeight: 1.6,
              }}>
                <code
                  dangerouslySetInnerHTML={{ __html: getHighlightedCode() }}
                  style={{ fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace" }}
                />
              </pre>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
          提交记录不存在
        </div>
      )}
    </Modal>
    </>
  )
}
