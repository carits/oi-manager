'use client'

import { useState, useEffect, useRef, type CSSProperties } from 'react'
import unifiedStyles from './SubmissionDetailModal.unified.module.css'
import { Button } from '@/components/ui/Button'
import { useRouter } from 'next/navigation'
import { DetailDialog } from '@/components/ui/Dialogs'
import apiClient from '@/lib/apiClient'
import { JUDGE_RESULT_LABEL_MAP, getLanguageLabel } from '@/lib/judge-constants'
import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { LoadError } from '@/components/ui/LoadError'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { SubmissionJudgeResult } from './SubmissionJudgeResult'

interface SubmissionDetail {
  id: number
  username: string
  oj?: string
  problemId?: string
  problemSourceHidden?: boolean
  problemIdentityHidden?: boolean
  result: string | null
  displayResult?: 'pending' | 'queuing' | string  // OI 赛中非管理员显示的脱敏结果
  hidden?: boolean  // OI 赛中非管理员标记
  timeUsed: number | null
  memoryUsed: number | null
  codeLength: number
  language: string
  code: string | null
  submitMethod: string
  ojRemoteId: string | null
  hideRemoteId?: boolean
  ojAccountUsername: string | null
  submittedAt: string
  errorMessage: string | null
  // 训练特有字段
  score?: number | null
  cases?: any[] | null
  subtasks?: any[] | null
  trainingProblemId?: string
  judgeMode?: 'acm' | 'oi'
  judgeConfig?: { mode: 'acm' | 'oi' }
  trainingId?: number | null
  problemAlias?: string | null
  problemOrderIndex?: number | null
  contestFormat?: string | null
  io?: { input: { type: 'stdin' } | { type: 'file'; filename: string }; output: { type: 'stdout' } | { type: 'file'; filename: string } }
}

interface SubmissionDetailModalProps {
  isOpen: boolean
  onClose: () => void
  submissionId: number | null
  viewRole?: 'teacher' | 'student' | 'admin'
  trainingId?: number // 可选：用于训练模块的提交详情
  trainingFormat?: 'oi' | 'ioi' | 'icpc' // 可选：训练赛制，ICPC时不显示分数
  submissionPathPrefix?: string
}

// 转圈动画组件
const Spinner = () => (
  <span className={unifiedStyles.u1} />
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
    'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
    'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)', 'var(--chart-9)', 'var(--chart-10)', 'var(--chart-11)',
  ]
  return colors[Math.floor(Math.max(0, Math.min(100, score)) / 10)]
}

const resultBadgeStyle = (background: string, color: string): CSSProperties => ({
  '--submission-result-bg': background,
  '--submission-result-text': color,
} as CSSProperties)

const scoreStyle = (score: number | null | undefined): CSSProperties => ({
  '--submission-score-color': score == null ? 'var(--text-muted)' : getScoreColor(score),
} as CSSProperties)

// 测试点状态分类
function getCaseStatusClass(result: string): 'pass' | 'fail' | 'skip' {
  if (result === 'Accepted' || result === 'accepted') return 'pass'
  if (result === 'System Error' || result === 'Skipped') return 'skip'
  return 'fail'
}

function getRemoteSubmitUrl(oj: string, localSubmissionId: number, ojRemoteId: string, viewRole?: string, problemId?: string, submissionPathPrefix?: string): string | null {
  if (oj === 'hdu') {
    return `https://acm.hdu.edu.cn/status.php?first=${ojRemoteId}`
  }
  if (oj === 'luogu') {
    return `https://www.luogu.com.cn/record/${ojRemoteId}`
  }
  if (oj === 'codeforces' && problemId) {
    const match = problemId.match(/^(\d+)/)
    if (match) {
      return `https://codeforces.com/contest/${match[1]}/submission/${ojRemoteId}`
    }
  }
  if (oj === 'carits' && viewRole) {
    const prefix = submissionPathPrefix || (viewRole === 'admin' ? '/platform-admin' : '/personal')
    return `${prefix}/submissions/${localSubmissionId}`
  }
  return null
}

export function SubmissionDetailModal({ isOpen, onClose, submissionId, viewRole, trainingId, trainingFormat, submissionPathPrefix }: SubmissionDetailModalProps) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isOpen && submissionId) {
      setLoading(true)
      setDetail(null)
      setError(null)
      const fetchDetail = async () => {
        setError(null)
        try {
          const data = trainingId
            ? await apiClient.query<SubmissionDetail>(`/api/trainings/${trainingId}/submissions/${submissionId}`)
            : await apiClient.query<SubmissionDetail>(`/api/submissions/${submissionId}`)

          setDetail(data)
          // OI 赛中非管理员（hidden=true）或不再是 queuing 状态，停止轮询
          if ((data.hidden || (data.result !== 'queuing' && data.result !== 'judging')) && intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
          // 按需抓取：CF 归档提交代码为空时，自动触发 fetch-code API
          if (!trainingId && data.oj === 'codeforces' && (!data.code || data.code.length === 0) && data.submitMethod === 'archive') {
            apiClient.post<{ code: string; codeLength: number }>(`/api/submissions/${submissionId}/fetch-code`).then(fetchRes => {
              if (fetchRes.success && fetchRes.data?.code) {
                setDetail(prev => prev ? { ...prev, code: fetchRes.data!.code, codeLength: fetchRes.data!.codeLength } : prev)
              }
            }).catch(() => {})
          }
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : '评测详情获取失败')
        } finally {
          setLoading(false)
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
    // OI 赛中非管理员：显示"已提交"
    if (hidden || displayResult === 'pending') {
      return (
        <span className={unifiedStyles.u2}>
          已提交
        </span>
      )
    }

    if (!result) {
      return (
        <span className={unifiedStyles.u3}>
          -
        </span>
      )
    }

    const label = JUDGE_RESULT_LABEL_MAP[result] || result
    const colors = RESULT_COLORS[result] || { bg: 'var(--bg-muted)', text: 'var(--text-primary)' }
    const badgeStyle = resultBadgeStyle(colors.bg, colors.text)

    // queuing 状态显示转圈动画
    if (result === 'queuing' || result === 'judging') {
      return (
        <span className={`${unifiedStyles.resultBadge} ${unifiedStyles.resultBadgePending}`} style={badgeStyle}>
          <Spinner />
          {label}
        </span>
      )
    }

    return (
      <span className={unifiedStyles.resultBadge} style={badgeStyle}>
        {result === 'accepted' && <span className={unifiedStyles.u4}>✓</span>}
        {result !== 'accepted' && result !== 'queuing' && result !== 'judging' && <span className={unifiedStyles.u4}>✕</span>}
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
      <DetailDialog
        isOpen={isOpen}
        onClose={onClose}
        title={detail ? ((detail.problemSourceHidden || detail.problemIdentityHidden) ? `#${detail.id} | ${detail.username} 的比赛提交` : `#${detail.id} | ${detail.username}'s solution for [${getOjLabel(detail.oj || '')}-${detail.problemId || ''}]`) : '评测详情'}
        size="xl"
        scrollMode="page"
      >
      {loading ? (
        <SkeletonRegion rows={6} label="评测详情正在准备" />
      ) : error && !detail ? (
        <LoadError message={error} onRetry={() => window.location.reload()} />
      ) : detail ? (
        <div className={unifiedStyles.u5}>
          {/* 提交信息表格 */}
          <div className={unifiedStyles.u6}>
            <div>
              <div className={unifiedStyles.u7}>评测结果</div>
              {getResultBadge(detail.result, detail.score, detail.hidden, detail.displayResult)}
            </div>
            {detail.judgeMode === 'oi' && !detail.hidden && (
            <div>
              <div className={unifiedStyles.u7}>分数</div>
              <div className={unifiedStyles.scoreValue} style={scoreStyle(detail.score)}>
                {detail.score !== null && detail.score !== undefined ? detail.score : '-'}
              </div>
            </div>
            )}
            {!detail.hidden && (
            <>
            <div>
              <div className={unifiedStyles.u7}>耗时</div>
              <div className={unifiedStyles.u8}>
                {detail.timeUsed ? `${detail.timeUsed}MS` : '-'}
              </div>
            </div>
            <div>
              <div className={unifiedStyles.u7}>内存</div>
              <div className={unifiedStyles.u8}>
                {detail.memoryUsed != null
                  ? `${(detail.memoryUsed / 1024).toFixed(2)}MB`
                  : '-'}
              </div>
            </div>
            </>
            )}
            <div>
              <div className={unifiedStyles.u7}>代码长度</div>
              <div className={unifiedStyles.u8}>{detail.codeLength}B</div>
            </div>
            <div>
              <div className={unifiedStyles.u7}>语言</div>
              <div className={unifiedStyles.u8}>{getLanguageLabelLocal(detail.language)}</div>
            </div>
            <div>
              <div className={unifiedStyles.u7}>输入</div>
              <div className={unifiedStyles.u8}>{detail.io?.input.type === 'file' ? detail.io.input.filename : 'stdin'}</div>
            </div>
            <div>
              <div className={unifiedStyles.u7}>输出</div>
              <div className={unifiedStyles.u8}>{detail.io?.output.type === 'file' ? detail.io.output.filename : 'stdout'}</div>
            </div>
          </div>

          {/* 提交时间和远程提交ID */}
          <div className={unifiedStyles.u9}>
            <div>
              <span className={unifiedStyles.u10}>提交时间：</span>
              <span className={unifiedStyles.u8}>{new Date(detail.submittedAt).toLocaleString('zh-CN')}</span>
            </div>
            {!detail.hidden && !detail.problemSourceHidden && !detail.problemIdentityHidden && !detail.hideRemoteId && (
            <div>
              <span className={unifiedStyles.u10}>远程提交ID：</span>
              {detail.ojRemoteId ? (
                getRemoteSubmitUrl(detail.oj || '', detail.id, detail.ojRemoteId, viewRole, detail.problemId, submissionPathPrefix) ? (
                  <a
                    href={getRemoteSubmitUrl(detail.oj || '', detail.id, detail.ojRemoteId, viewRole, detail.problemId, submissionPathPrefix)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={unifiedStyles.u11}
                  >
                    {detail.ojRemoteId}
                  </a>
                ) : (
                  <span>{detail.ojRemoteId}</span>
                )
              ) : (
                <span className={unifiedStyles.u12}>
                  <Spinner />
                  等待分配...
                </span>
              )}
            </div>
            )}
          </div>

          {/* 错误信息 */}
          {detail.errorMessage && (
            <div className={unifiedStyles.u13}>
              {detail.errorMessage}
            </div>
          )}

          <SubmissionJudgeResult
            judgeMode={detail.judgeMode}
            result={detail.result}
            score={detail.score}
            cases={detail.cases}
            subtasks={detail.subtasks}
            hidden={detail.hidden}
          />

          {/* 源码显示区 */}
          {detail.code ? (
          <div className={unifiedStyles.u14}>
            {/* Copy Code 按钮 */}
            <Button variant="ghost"
              onClick={handleCopy}
              className={unifiedStyles.u15}
            >
              {copied ? '已复制' : '复制代码'}
            </Button>

            {/* 代码区域 */}
            <div className={unifiedStyles.u16}>
              <pre className={unifiedStyles.u17}>
                <code className={unifiedStyles.codeFont}
                  dangerouslySetInnerHTML={{ __html: getHighlightedCode() }}
                />
              </pre>
            </div>
          </div>
          ) : (
          <div className={unifiedStyles.u18}>
            {detail.submitMethod === 'archive' ? '归档记录，源代码不可用' : '无源代码'}
          </div>
          )}
        </div>
      ) : (
        <div className={unifiedStyles.u19}>
          提交记录不存在
        </div>
      )}
    </DetailDialog>
    </>
  )
}
