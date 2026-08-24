'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import styles from './SubmissionDetail.module.css'
import { getLanguageLabel } from '@/lib/judge-constants'
import { getAvatarUrl } from '@/lib/assets'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { LoadError } from '@/components/ui/LoadError'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { useAuth } from '@/components/AuthProvider'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { SubmissionJudgeResult } from './SubmissionJudgeResult'

interface CaseResult {
  caseId: number | string
  subtaskId?: number | string
  result: string
  time?: number | null
  memory?: number | null
  score?: number
  message?: string
}

interface SubtaskResult {
  id: number | string
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
  judgeMode: 'acm' | 'oi'
  judgeConfig?: { mode: 'acm' | 'oi' }
  trainingId?: number | null
  trainingProblemId?: string | null
  problemAlias?: string | null
  problemOrderIndex?: number | null
  contestFormat?: string | null
}

interface SubmissionDetailPageProps {
  role: 'teacher' | 'student' | 'admin'
  submissionId: string
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

export function SubmissionDetailPage({ role, submissionId }: SubmissionDetailPageProps) {
  const { user } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showCode, setShowCode] = useState(true)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!submissionId) return

    const fetchDetail = async () => {
      setError(null)
      try {
        const data = await apiClient.query<SubmissionDetail>(`/api/submissions/${submissionId}`)
          setDetail(data)
          if (data.result !== 'queuing' && data.result !== 'judging') {
            if (intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
            }
          }
          // 按需抓取：CF 归档提交代码为空时，自动触发 fetch-code API
          if (data.oj === 'codeforces' && (!data.code || data.code.length === 0) && data.submitMethod === 'archive') {
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
    if (pathname === '/personal' || pathname.startsWith('/personal/')) return '/personal'
    const workspacePrefix = currentWorkspacePrefix(pathname, '')
    if (workspacePrefix) return workspacePrefix
    return currentWorkspacePrefix(pathname, '/personal')
  }

  if (loading) {
    return (
      <PageFrame width="workbench"><PageHeader title="提交详情" breadcrumbs={[{ label: '评测记录', href: `${getPathPrefix()}/submissions` }, { label: '详情' }]} /><SkeletonRegion rows={8} label="评测详情正在准备" /></PageFrame>
    )
  }

  if (error && !detail) {
    return (
      <PageFrame><PageHeader title="提交详情" breadcrumbs={[{ label: '评测记录', href: `${getPathPrefix()}/submissions` }, { label: '详情' }]} /><LoadError message={error} onRetry={() => window.location.reload()} /></PageFrame>
    )
  }

  if (!detail) {
    return (
      <PageFrame><PageHeader title="提交详情" breadcrumbs={[{ label: '评测记录', href: `${getPathPrefix()}/submissions` }, { label: '详情' }]} /><Empty title="提交记录不存在" description="记录可能已被删除，或当前账号没有查看权限。" action={<Button variant="secondary" onClick={() => router.push(`${getPathPrefix()}/submissions`)}>返回评测记录</Button>} /></PageFrame>
    )
  }

  const ojLabel = OJ_LABELS[detail.oj] || detail.oj

  return (
    <>
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <PageFrame width="workbench">
        <PageHeader title={`提交 #${detail.id}`} description={`${ojLabel} · ${detail.problemId}${detail.problemTitle ? ` · ${detail.problemTitle}` : ''}`} breadcrumbs={[{ label: '评测记录', href: `${getPathPrefix()}/submissions` }, { label: `#${detail.id}` }]} />
        <div className={styles.grid}>
          {/* Left column (9/12) */}
          <div className={styles.main}>
            <SubmissionJudgeResult
              judgeMode={detail.judgeMode}
              result={detail.result}
              score={detail.score}
              cases={detail.cases}
              subtasks={detail.subtasks}
            />

            {/* Code section */}
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <Button variant="text" icon={showCode ? <ChevronDown size={16} /> : <ChevronRight size={16} />} onClick={() => setShowCode(!showCode)}>
                  源代码
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.8125rem' }}>
                    ({detail.codeLength}B)
                  </span>
                </Button>
                {showCode && detail.code && (
                  <Button size="sm" variant="secondary" icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={handleCopy}>{copied ? '已复制' : '复制'}</Button>
                )}
              </div>
              {showCode && (
                detail.code ? (
                <div className={styles.codeArea}>
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
                ) : (
                <div style={{
                  padding: '2rem',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-muted)',
                }}>
                  {detail.submitMethod === 'archive' ? '归档记录，源代码不可用' : '无源代码'}
                </div>
                )
              )}
            </div>
          </div>

          {/* Right column (3/12) — Information sidebar */}
          <aside className={styles.sidebar}>
            <div className={styles.panel}>
              <div className={styles.panelHeader}><h2 className={styles.panelTitle}>提交信息</h2></div>

              <div style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem' }}>
                {/* Submitter */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem', fontSize: '0.75rem' }}>提交人</div>
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
                        fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-inverse)',
                      }}>
                        {detail.submitterName?.charAt(0) || '?'}
                      </div>
                    )}
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{detail.submitterName}</span>
                  </div>
                </div>

                {/* Problem */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem', fontSize: '0.75rem' }}>题目</div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    [{ojLabel}-{detail.problemId}]
                    {detail.problemTitle ? ` ${detail.problemTitle}` : ''}
                  </div>
                </div>

                {/* Language */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem', fontSize: '0.75rem' }}>语言</div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{getLanguageLabel(detail.language)}</div>
                </div>

                {/* Code Length */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem', fontSize: '0.75rem' }}>代码长度</div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{detail.codeLength}B</div>
                </div>

                {/* Submit At */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem', fontSize: '0.75rem' }}>提交时间</div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    {new Date(detail.submittedAt).toLocaleString('zh-CN')}
                  </div>
                </div>

                {/* OJ Remote ID */}
                {detail.ojRemoteId && (
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem', fontSize: '0.75rem' }}>远端记录编号</div>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {detail.oj === 'carits' ? (
                        <a
                          href={`${getPathPrefix()}/submissions/${detail.id}`}
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
                      ) : detail.oj === 'codeforces' ? (
                        <a
                          href={`https://codeforces.com/contest/${detail.problemId.replace(/^(\d+).*$/, '$1')}/submission/${detail.ojRemoteId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--primary)', textDecoration: 'none' }}
                        >
                          {detail.ojRemoteId}
                        </a>
                      ) : detail.oj === 'luogu' ? (
                        <a
                          href={`https://www.luogu.com.cn/record/${detail.ojRemoteId}`}
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
          </aside>
        </div>
      </PageFrame>
    </>
  )
}
