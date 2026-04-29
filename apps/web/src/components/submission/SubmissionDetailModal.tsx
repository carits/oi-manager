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
  result: string | null
  displayResult?: 'pending' | 'queuing' | string  // OI 赞中非管理员显示的脱敏结果
  hidden?: boolean  // OI 赞中非管理员标记
  timeUsed: number | null
  memoryUsed: number | null
  codeLength: number
  language: string
  code: string | null
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
  trainingFormat?: 'oi' | 'ioi' | 'icpc' // 可选：训练赛制，ICPC时不显示分数
}

// 转圈动画组件
const Spinner = () => (
  <span style={{
    display: 'inline-block',
    width: '14px',
    height: '14px',
    border: '2px solid #e5e7eb',
    borderTopColor: 'var(--primary)',
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
  accepted: { bg: 'var(--success-light)', text: 'var(--success-text)' },
  queuing: { bg: 'var(--info-light)', text: 'var(--info-text)' },
  judging: { bg: 'var(--info-light)', text: 'var(--info-text)' },
  tle: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  mle: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  wa: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  re: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  ce: { bg: 'var(--warning-light)', text: 'var(--text-secondary)' },
  pe: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  ole: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  submit_failed: { bg: 'var(--error-light)', text: 'var(--error-text)' },
}

// 分数颜色渐变（0=红 → 100=绿）
function getScoreColor(score: number): string {
  const colors = [
    '#ff4f4f', '#ff694f', '#f8603a', '#fc8354', '#fa9231',
    '#f7bb3b', '#ecdb44', '#e2ec52', '#b0d628', '#93b127', '#25ad40',
  ]
  return colors[Math.floor(Math.max(0, Math.min(100, score)) / 10)]
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

export function SubmissionDetailModal({ isOpen, onClose, submissionId, viewRole, trainingId, trainingFormat }: SubmissionDetailModalProps) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isOpen && submissionId) {
      setLoading(true)

      const fetchDetail = async () => {
        // 训练提交使用训练专用端点
        const res = trainingId
          ? await apiClient.get<SubmissionDetail>(`/api/trainings/${trainingId}/submissions/${submissionId}`)
          : await apiClient.get<SubmissionDetail>(`/api/submissions/${submissionId}`)

        if (res.success && res.data) {
          setDetail(res.data)
          setLoading(false)
          // OI 赞中非管理员（hidden=true）或不再是 queuing 状态，停止轮询
          if ((res.data.hidden || res.data.result !== 'queuing') && intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      }

      fetchDetail() // 立即加载一次

      // 如果是 queuing 状态且未隐藏，启动轮询
      if (detail?.result === 'queuing' && !detail?.hidden || !detail) {
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

  const getResultBadge = (result: string | null, score?: number | null, hidden?: boolean, displayResult?: string) => {
    // OI 赞中非管理员：显示"已提交"
    if (hidden || displayResult === 'pending') {
      return (
        <span style={{
          display: 'inline-block',
          padding: '4px 12px',
          borderRadius: '6px',
          fontSize: '0.875rem',
          fontWeight: 600,
          background: 'var(--info-light)',
          color: 'var(--info-text)',
        }}>
          已提交
        </span>
      )
    }

    if (!result) {
      return (
        <span style={{
          display: 'inline-block',
          padding: '4px 12px',
          borderRadius: '6px',
          fontSize: '0.875rem',
          fontWeight: 600,
          background: 'var(--bg-muted)',
          color: 'var(--text-muted)',
        }}>
          -
        </span>
      )
    }

    const label = JUDGE_RESULT_LABEL_MAP[result] || result
    const colors = RESULT_COLORS[result] || { bg: 'var(--bg-muted)', text: 'var(--text-primary)' }

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
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          加载中...
        </div>
      ) : detail ? (
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '75vh', overflow: 'hidden' }}>
          {/* 提交信息表格 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: '1rem',
            marginBottom: '1.5rem',
            padding: '1rem',
            background: 'var(--bg-muted)',
            borderRadius: '8px',
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>评测结果</div>
              {getResultBadge(detail.result, detail.score, detail.hidden, detail.displayResult)}
            </div>
            {trainingFormat !== 'icpc' && !detail.hidden && (
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>分数</div>
              <div style={{
                fontWeight: 700,
                fontSize: '1.125rem',
                color: detail.score !== null && detail.score !== undefined
                  ? getScoreColor(detail.score)
                  : 'var(--text-muted)',
              }}>
                {detail.score !== null && detail.score !== undefined ? detail.score : '-'}
              </div>
            </div>
            )}
            {!detail.hidden && (
            <>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>耗时</div>
              <div style={{ fontWeight: 500 }}>
                {detail.timeUsed ? `${detail.timeUsed}MS` : '-'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>内存</div>
              <div style={{ fontWeight: 500 }}>
                {detail.memoryUsed != null
                  ? `${(detail.memoryUsed / 1024).toFixed(2)}MB`
                  : '-'}
              </div>
            </div>
            </>
            )}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>代码长度</div>
              <div style={{ fontWeight: 500 }}>{detail.codeLength}B</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>语言</div>
              <div style={{ fontWeight: 500 }}>{getLanguageLabelLocal(detail.language)}</div>
            </div>
          </div>

          {/* 提交时间和远程提交ID */}
          <div style={{
            display: 'flex',
            gap: '2rem',
            marginBottom: '1.5rem',
            padding: '0.75rem 1rem',
            background: 'var(--bg-muted)',
            borderRadius: '8px',
            flexShrink: 0,
          }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>提交时间：</span>
              <span style={{ fontWeight: 500 }}>{new Date(detail.submittedAt).toLocaleString('zh-CN')}</span>
            </div>
            {!detail.hidden && (
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>远程提交ID：</span>
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
                <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-secondary)' }}>
                  <Spinner />
                  等待分配...
                </span>
              )}
            </div>
            )}
          </div>

          {/* 错误信息 */}
          {detail.errorMessage && (
            <div style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              background: 'var(--error-light)',
              borderRadius: '8px',
              color: 'var(--error-text)',
              fontSize: '0.875rem',
              flexShrink: 0,
            }}>
              {detail.errorMessage}
            </div>
          )}

          {/* 源码显示区 */}
          <div style={{
            position: 'relative',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            overflow: 'hidden',
            flex: 1,
            minHeight: 0,
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
              maxHeight: '60vh',
              overflow: 'auto',
              background: 'var(--bg-muted)',
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
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          提交记录不存在
        </div>
      )}
    </Modal>
    </>
  )
}
