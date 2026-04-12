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
}

interface SubmissionDetailModalProps {
  isOpen: boolean
  onClose: () => void
  submissionId: number | null
  viewRole?: 'teacher' | 'student' | 'admin'
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
  tle: { bg: '#fef3c7', text: '#92400e' },
  mle: { bg: '#fef3c7', text: '#92400e' },
  wa: { bg: '#fee2e2', text: '#991b1b' },
  re: { bg: '#fee2e2', text: '#991b1b' },
  ce: { bg: '#f3e8ff', text: '#6b21a8' },
  pe: { bg: '#fef3c7', text: '#92400e' },
  ole: { bg: '#fef3c7', text: '#92400e' },
  submit_failed: { bg: '#fee2e2', text: '#991b1b' },
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

export function SubmissionDetailModal({ isOpen, onClose, submissionId, viewRole }: SubmissionDetailModalProps) {
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
  }, [isOpen, submissionId])

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

  const getResultBadge = (result: string) => {
    const label = JUDGE_RESULT_LABEL_MAP[result] || result
    const colors = RESULT_COLORS[result] || { bg: '#f3f4f6', text: '#374151' }

    // queuing 状态显示转圈动画
    if (result === 'queuing') {
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
              {getResultBadge(detail.result)}
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>耗时</div>
              <div style={{ fontWeight: 500 }}>{detail.timeUsed ? `${detail.timeUsed}ms` : '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>内存</div>
              <div style={{ fontWeight: 500 }}>{detail.memoryUsed ? `${detail.memoryUsed}KB` : '-'}</div>
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