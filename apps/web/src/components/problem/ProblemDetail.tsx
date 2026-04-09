'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import apiClient from '@/lib/apiClient'
import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { LANGUAGE_OPTIONS, JUDGE_RESULT_OPTIONS, JUDGE_RESULT_LABEL_MAP, LANGUAGE_LABEL_MAP } from '@/lib/judge-constants'
import { TranslateModal } from './TranslateModal'

interface Statement {
  id: string
  format: 'markdown' | 'pdf'
  language: 'zh' | 'en' | null
  content: string | null
  fileUrl: string | null
  isVisible: boolean
}

interface Problem {
  id: string
  problemId: string
  platform: string
  title: string
  difficulty: string | null
  timeLimit: number | null
  memoryLimit: number | null
  status: string
  visibility: string
  ownerType: string
  ownerName: string
  ojBindings: string | null
  createdAt: string
  // 多版本字段
  statements: Statement[]
  solutions: Statement[]
}

interface OjBinding {
  platform: string
  problemId: string
  url?: string  // 后端存储的原题 URL，优先使用
}

interface Attachment {
  id: string
  problemId: string
  fileName: string
  fileSize: number
  fileUrl: string
  description: string | null
  uploadedAt: string
}

const getOjProblemUrl = (platform: string, problemId: string): string => {
  switch (platform) {
    // 已有适配器（24 个）
    case 'luogu': return `https://www.luogu.com.cn/problem/${problemId}`
    case 'codeforces': {
      const cfMatch = problemId.match(/^(\d+)([A-Za-z]\d*)$/)
      if (cfMatch) return `https://codeforces.com/problemset/problem/${cfMatch[1]}/${cfMatch[2]}`
      return `https://codeforces.com/problemset/problem/${problemId}`
    }
    case 'atcoder': {
      const lastUnderscore = problemId.lastIndexOf('_')
      const contestId = lastUnderscore >= 0 ? problemId.substring(0, lastUnderscore) : problemId
      return `https://atcoder.jp/contests/${contestId}/tasks/${problemId}?lang=en`
    }
    case 'gym': {
      const gymMatch = problemId.match(/^(\d+)([A-Za-z]\d*)$/)
      if (gymMatch) return `https://codeforces.com/gym/${gymMatch[1]}/problem/${gymMatch[2]}`
      return `https://codeforces.com/gym/${problemId}`
    }
    case 'qoj': return `https://qoj.ac/problem/${problemId}`
    case 'hdu': return `https://acm.hdu.edu.cn/showproblem.php?pid=${problemId}`
    case 'poj': return `http://poj.org/problem?id=${problemId}`
    case 'ural': return `https://acm.timus.ru/problem.aspx?space=1&num=${problemId}`
    case 'usaco': return `https://usaco.org/index.php?page=viewproblem2&cpid=${problemId}`
    case 'tlx': return `https://tlx.toki.id/problems/${problemId}`
    case 'libreoj': case 'loj': return `https://loj.ac/p/${problemId}`
    case 'yosupo': return `https://judge.yosupo.jp/problem/${problemId}`
    case '51nod': return `https://www.51nod.com/Challenge/Problem.html#problemId=${problemId}`
    case 'csacademy': return `https://csacademy.com/contest/archive/task/${problemId}/`
    case 'kattis': return `https://open.kattis.com/problems/${problemId}`
    case 'yukicoder': return `https://yukicoder.me/problems/no/${problemId}`
    case 'vnoj': return `https://oj.vnoi.info/problem/${problemId}`
    case 'kilonova': return `https://kilonova.ro/problems/${problemId}`
    case 'ojuz': return `https://oj.uz/problem/view/${problemId}`
    case 'aizu': return `https://onlinejudge.u-aizu.ac.jp/problems/${problemId}`
    case 'openj_bailian': return `http://bailian.openjudge.cn/practice/${problemId}/`
    case 'openj_noi': return `http://noi.openjudge.cn/problem/${problemId}/`
    case 'openj_poj': return `http://poj.openjudge.cn/practice/${problemId}/`
    case 'uoj': return `https://uoj.ac/problem/${problemId}`
    case 'csg': return `https://csgoj.com/problem/${problemId}`
    case 'nowcoder': return `https://ac.nowcoder.com/acm/problem/${problemId}`

    // 待实现适配器
    case 'szkopul': return `https://szkopul.edu.pl/problemset/problem/${problemId}/site/`
    case 'darkbzoj': return `https://darkbzoj.cc/problem/${problemId}`
    case 'dmoj': return `https://dmoj.ca/problem/${problemId}`
    case 'baekjoon': return `https://www.acmicpc.net/problem/${problemId}`
    case 'codechef': return `https://www.codechef.com/problems/${problemId}`
    case 'cses': return `https://cses.fi/problemset/task/${problemId}`
    case 'spoj': return `https://www.spoj.com/problems/${problemId}`
    case 'uva': return `https://onlinejudge.org/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=${problemId}`
    case 'vijos': return `https://vijos.org/p/${problemId}`
    case 'eolymp': return `https://www.eolymp.com/en/problems/${problemId}`
    case 'hackerrank': return `https://www.hackerrank.com/challenges/${problemId}/problem`

    // 仅记录平台
    case 'bzoj': return `https://www.lydsy.com/JudgeOnline/problem.php?id=${problemId}`
    case 'zoj': return `https://zoj.pintia.cn/problem-sets/918273645003/problems/${problemId}`
    case 'lightoj': return `https://lightoj.com/problem/${problemId}`
    case 'hihocoder': return `https://hihocoder.com/problemset/problem/${problemId}`
    case 'topcoder': return `https://community.topcoder.com/stat?c=problem_statement&pm=${problemId}`
    case 'jisuanke': return `https://www.jisuanke.com/problem/${problemId}`

    default: return '#'
  }
}

const getPdfUrl = (path: string | null) => {
  if (!path) return null
  // 绝对外部 URL 直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  // /api/files/:id/public → 通过 Next.js 同域代理加载（避免跨域 iframe 被拒）
  const fileMatch = path.match(/\/api\/files\/([^/]+)\/public/)
  if (fileMatch) {
    return `/api/files/download/${fileMatch[1]}?public=true`
  }
  // /api/files/:id/download → 通过 Next.js 同域代理加载
  const dlMatch = path.match(/\/api\/files\/([^/]+)\/download/)
  if (dlMatch) {
    return `/api/files/download/${dlMatch[1]}`
  }
  // /uploads/ 路径 → 通过 Next.js 同域代理加载
  if (path.startsWith('/uploads/')) {
    return `/api/problems/pdf-proxy?path=${encodeURIComponent(path)}`
  }
  return path
}

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English'
}

interface ProblemDetailProps {
  role: 'teacher' | 'student' | 'admin'
  problemId: string
}

export function ProblemDetail({ role, problemId }: ProblemDetailProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const toast = useToast()
  type TabType = 'statement' | 'solution' | 'attachments' | 'submit' | 'records'
  const VALID_TABS: TabType[] = ['statement', 'solution', 'attachments', 'submit', 'records']
  const [problem, setProblem] = useState<Problem | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>(
    VALID_TABS.includes(searchParams.get('tab') as TabType) ? (searchParams.get('tab') as TabType) : 'statement'
  )
  const [submitLanguage, setSubmitLanguage] = useState('cpp')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)
  const [selectedSolutionId, setSelectedSolutionId] = useState<string | null>(null)
  const [hasVisitedAttachments, setHasVisitedAttachments] = useState(false)
  const [showTranslateModal, setShowTranslateModal] = useState(false)
  const [aiLoading, setAiLoading] = useState<'translate' | 'format' | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [aiUsage, setAiUsage] = useState<{
    isAdmin: boolean
    translations: { zh: boolean; en: boolean }
    formattedStatementIds: string[]
  } | null>(null)

  // 获取路径前缀
  const getPathPrefix = () => {
    if (role === 'admin') return '/platform-admin'
    if (role === 'student') return '/student'
    return '/teacher'
  }
  const pathPrefix = getPathPrefix()

  useEffect(() => {
    fetchProblem()
    fetchAttachments()  // 同时获取附件数据，用于气泡显示
    fetchAiUsage()
  }, [problemId])

  useEffect(() => {
    const tab = searchParams.get('tab') as TabType
    if (VALID_TABS.includes(tab)) setActiveTab(tab)
  }, [searchParams])

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    router.push(`${pathPrefix}/problems/${problemId}?tab=${tab}`, { scroll: false })
  }

  // 当 problem 数据更新后，设置默认选中的版本
  useEffect(() => {
    if (problem) {
      // 题面版本选择
      const visibleStatements = problem.statements.filter(s => s.isVisible || canModify())
      if (visibleStatements.length > 0 && !selectedStatementId) {
        // 1. 优先恢复用户上次的选择（localStorage）
        const savedStatementKey = localStorage.getItem(`problem-stmt-pref-${problem.id}`)
        const savedStatement = savedStatementKey
          ? visibleStatements.find(s =>
              `${s.format}-${s.language || 'unknown'}` === savedStatementKey
            )
          : null

        if (savedStatement) {
          setSelectedStatementId(savedStatement.id)
        } else {
          // 2. 默认选中文版本
          const zhStatement = visibleStatements.find(s => s.language === 'zh')
          setSelectedStatementId(zhStatement?.id || visibleStatements[0].id)
        }
      }

      // 题解版本选择
      const visibleSolutions = problem.solutions.filter(s => s.isVisible || canModify())
      if (visibleSolutions.length > 0 && !selectedSolutionId) {
        const savedSolutionKey = localStorage.getItem(`problem-sol-pref-${problem.id}`)
        const savedSolution = savedSolutionKey
          ? visibleSolutions.find(s =>
              `${s.format}-${s.language || 'unknown'}` === savedSolutionKey
            )
          : null

        if (savedSolution) {
          setSelectedSolutionId(savedSolution.id)
        } else {
          const zhSolution = visibleSolutions.find(s => s.language === 'zh')
          setSelectedSolutionId(zhSolution?.id || visibleSolutions[0].id)
        }
      }
    }
  }, [problem])

  const fetchAiUsage = async () => {
    try {
      const result = await apiClient.get(`/api/problems/${problemId}/ai/usage`)
      if (result.success && result.data) {
        setAiUsage(result.data)
      }
    } catch {
      // 静默失败，不影响页面
    }
  }

  const fetchProblem = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<Problem>(`/api/problems/${problemId}`)
      if (result.success && result.data) {
        setProblem(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch problem:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAttachments = async () => {
    try {
      setAttachmentsLoading(true)
      const result = await apiClient.get<Attachment[]>(`/api/problems/${problemId}/attachments`)
      if (result.success && result.data) {
        setAttachments(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch attachments:', error)
    } finally {
      setAttachmentsLoading(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // 处理附件下载（需要认证）
  const handleDownload = async (attachment: Attachment) => {
    try {
      // 如果是新格式的 File API URL
      if (attachment.fileUrl.startsWith('/api/files/')) {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}${attachment.fileUrl}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        })
        if (!response.ok) throw new Error('下载失败')
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = attachment.fileName
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      } else {
        // 旧格式直接打开
        window.open(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}${attachment.fileUrl}`, '_blank')
      }
    } catch (error) {
      console.error('Download failed:', error)
      toast.error('下载失败，请重试')
    }
  }

  const handleDelete = async () => {
    if (!problem) return
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    setDeleteConfirmOpen(false)
    try {
      const result = await apiClient.delete(`/api/problems/${problemId}`)
      if (result.success) {
        router.back()
      }
    } catch (error) {
      console.error('Failed to delete problem:', error)
    }
  }

  // 判断是否有编辑/删除权限
  const canModify = () => {
    if (!problem || !user) return false
    // 管理员可以修改所有题目
    if (role === 'admin') return true
    // 私有题目，所有者可以修改
    if (problem.visibility === 'private') {
      // 检查是否是所有者
      if (role === 'student' && problem.ownerType === 'student') return true
      if ((role === 'teacher') && problem.ownerType === 'teacher') return true
    }
    return false
  }

  const getDifficultyColor = (difficulty: string | null) => {
    switch (difficulty) {
      case '简单': return '#10b981'
      case '中等': return '#f59e0b'
      case '困难': return '#ef4444'
      default: return 'var(--gray-500)'
    }
  }

  // 获取选中的题面
  const getSelectedStatement = (): Statement | null => {
    if (!problem) return null
    return problem.statements.find(s => s.id === selectedStatementId) || problem.statements[0] || null
  }

  // 获取选中的题解
  const getSelectedSolution = (): Statement | null => {
    if (!problem) return null
    return problem.solutions.find(s => s.id === selectedSolutionId) || problem.solutions[0] || null
  }

  // 获取可显示的题面列表
  const getVisibleStatements = (): Statement[] => {
    if (!problem) return []
    // 编辑者可以看到所有版本，查看者只能看到可见版本
    if (canModify()) return problem.statements
    return problem.statements.filter(s => s.isVisible)
  }

  // 获取可显示的题解列表
  const getVisibleSolutions = (): Statement[] => {
    if (!problem) return []
    // 学生在公共题目上只能看到可见的题解
    if (role === 'student' && problem.visibility === 'public' && !canModify()) {
      return problem.solutions.filter(s => s.isVisible)
    }
    if (canModify()) return problem.solutions
    return problem.solutions.filter(s => s.isVisible)
  }

  // AI 翻译处理
  const handleTranslate = async (targetLang: string) => {
    if (!problem) return
    setAiLoading('translate')
    setAiError(null)
    try {
      const result = await apiClient.post(`/api/problems/${problemId}/ai/translate`, {
        targetLang,
        statementId: selectedStatementId,
      })
      if (result.success) {
        // 重新获取题目数据以包含新翻译的版本
        await fetchProblem()
        fetchAiUsage()
        setShowTranslateModal(false)
      } else {
        setAiError(result.message || '翻译失败')
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || '翻译失败'
      setAiError(msg)
    } finally {
      setAiLoading(null)
    }
  }

  // AI 格式化处理
  const handleFormat = async () => {
    if (!problem) return
    setAiLoading('format')
    setAiError(null)
    try {
      const result = await apiClient.post(`/api/problems/${problemId}/ai/format`, {
        statementId: selectedStatementId,
      })
      if (result.success) {
        await fetchProblem()
        fetchAiUsage()
      } else {
        setAiError(result.message || '格式化失败')
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || '格式化失败'
      setAiError(msg)
    } finally {
      setAiLoading(null)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        加载中...
      </div>
    )
  }

  if (!problem) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        题目不存在
      </div>
    )
  }

  const ojBindings: OjBinding[] = problem.ojBindings ? JSON.parse(problem.ojBindings) : []

  const visibleStatements = getVisibleStatements()
  const visibleSolutions = getVisibleSolutions()
  const currentStatement = getSelectedStatement()
  const currentSolution = getSelectedSolution()

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '2rem' }}>
        {/* 返回按钮 */}
        <button
          onClick={() => router.back()}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--primary)',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontSize: '0.875rem'
          }}
        >
          ← 返回列表
        </button>

        {/* 题目头部 */}
        <div style={{
          background: 'white',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          padding: '2rem',
          marginBottom: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--gray-500)', fontWeight: 500 }}>{problem.problemId}</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>{problem.title}</span>
              </div>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--gray-500)' }}>
                {problem.difficulty && (
                  <span style={{ color: getDifficultyColor(problem.difficulty) }}>{problem.difficulty}</span>
                )}
                {problem.timeLimit && <span>时间限制: {problem.timeLimit}ms</span>}
                {problem.memoryLimit && <span>空间限制: {problem.memoryLimit}MB</span>}
                <span style={{
                  padding: '0.125rem 0.5rem',
                  borderRadius: '4px',
                  background: problem.visibility === 'public' ? '#dbeafe' : 'var(--gray-100)',
                  color: problem.visibility === 'public' ? '#1d4ed8' : 'var(--gray-600)'
                }}>
                  {problem.visibility === 'public' ? '公共' : '私有'}
                </span>
              </div>
            </div>
            {canModify() && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => router.push(`${pathPrefix}/problems/${problemId}/edit`)}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid var(--border)',
                    background: 'white',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={handleDelete}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid #ef4444',
                    background: 'white',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    color: '#ef4444'
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>

          {/* OJ 绑定 */}
          {ojBindings.length > 0 && (
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)', marginRight: '0.5rem' }}>OJ链接:</span>
              {ojBindings.map((binding, index) => (
                <a
                  key={index}
                  href={binding.url || getOjProblemUrl(binding.platform, binding.problemId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    marginRight: '0.5rem',
                    color: 'var(--primary)',
                    textDecoration: 'none',
                    fontSize: '0.875rem'
                  }}
                >
                  [{OJ_PLATFORM_LABEL_MAP[binding.platform] || binding.platform} {binding.problemId}]
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Tab 切换 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => handleTabChange('statement')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'statement' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'statement' ? 'var(--primary)' : 'var(--gray-500)',
                fontWeight: activeTab === 'statement' ? 600 : 400
              }}
            >
              题面
            </button>
            <button
              onClick={() => handleTabChange('solution')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'solution' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'solution' ? 'var(--primary)' : 'var(--gray-500)',
                fontWeight: activeTab === 'solution' ? 600 : 400
              }}
            >
              题解
            </button>
            <button
              onClick={() => {
                handleTabChange('attachments')
                setHasVisitedAttachments(true)
              }}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'attachments' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'attachments' ? 'var(--primary)' : 'var(--gray-500)',
                fontWeight: activeTab === 'attachments' ? 600 : 400,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}
            >
              附件
              {attachments.length > 0 && !hasVisitedAttachments && (
                <span style={{
                  background: 'var(--primary)',
                  color: 'white',
                  fontSize: '0.75rem',
                  padding: '0.125rem 0.375rem',
                  borderRadius: '10px',
                  minWidth: '18px',
                  textAlign: 'center'
                }}>
                  {attachments.length}
                </span>
              )}
            </button>
            <button
              onClick={() => handleTabChange('submit')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'submit' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'submit' ? 'var(--primary)' : 'var(--gray-500)',
                fontWeight: activeTab === 'submit' ? 600 : 400
              }}
            >
              提交
            </button>
            <button
              onClick={() => handleTabChange('records')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'records' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'records' ? 'var(--primary)' : 'var(--gray-500)',
                fontWeight: activeTab === 'records' ? 600 : 400
              }}
            >
              提交记录
            </button>
          </div>

          {/* 思路记录按钮 */}
          <button
            onClick={() => router.push(`${pathPrefix}/problems/${problemId}/note`)}
            style={{
              padding: '0.5rem 1rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '-1px'
            }}
          >
            ✏️ 写思路
          </button>
        </div>

        {/* 内容区域 + AI侧边栏 */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          {/* 主内容 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              background: 'white',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
            }}>
          {/* 题面 Tab */}
          {activeTab === 'statement' && (
            <>
              {/* 左上角版本选择 */}
              {visibleStatements.length > 1 && (
                <div style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <select
                    value={selectedStatementId || ''}
                    onChange={(e) => {
                      const id = e.target.value
                      setSelectedStatementId(id)
                      // 持久化用户选择（format-language key）
                      if (problem) {
                        const stmt = problem.statements.find(s => s.id === id)
                        if (stmt) {
                          localStorage.setItem(`problem-stmt-pref-${problem.id}`, `${stmt.format}-${stmt.language || 'unknown'}`)
                        }
                      }
                    }}
                    style={{
                      padding: '0.375rem 0.75rem',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      fontSize: '0.875rem',
                      background: 'white'
                    }}
                  >
                    {visibleStatements.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.format === 'pdf' ? 'PDF' : `${s.language ? LANGUAGE_LABELS[s.language] : '未知'}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ padding: '2rem' }}>
                {currentStatement ? (
                  currentStatement.format === 'pdf' && currentStatement.fileUrl ? (
                    currentStatement.fileUrl.startsWith('/') ? (
                      <iframe
                        src={getPdfUrl(currentStatement.fileUrl) || ''}
                        style={{ width: '100%', height: '600px', border: 'none' }}
                      />
                    ) : (
                      <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                        <p style={{ color: 'var(--gray-600)', marginBottom: '1rem' }}>
                          题面为外部 PDF 文件，请在新窗口中查看
                        </p>
                        <a
                          href={currentStatement.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-block',
                            padding: '0.5rem 1.5rem',
                            backgroundColor: 'var(--primary)',
                            color: '#fff',
                            borderRadius: 'var(--radius)',
                            textDecoration: 'none',
                            fontSize: '0.875rem',
                          }}
                        >
                          打开 PDF 题面
                        </a>
                      </div>
                    )
                  ) : currentStatement.content ? (
                    <MarkdownRenderer content={currentStatement.content} />
                  ) : (
                    <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '1.5rem' }}>
                      暂无题面内容
                    </div>
                  )
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '1.5rem' }}>
                    暂无题面内容
                  </div>
                )}
              </div>
            </>
          )}

          {/* 题解 Tab */}
          {activeTab === 'solution' && (
            <>
              {/* 左上角版本选择 */}
              {visibleSolutions.length > 1 && (
                <div style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <select
                    value={selectedSolutionId || ''}
                    onChange={(e) => {
                      const id = e.target.value
                      setSelectedSolutionId(id)
                      // 持久化用户选择（format-language key）
                      if (problem) {
                        const sol = problem.solutions.find(s => s.id === id)
                        if (sol) {
                          localStorage.setItem(`problem-sol-pref-${problem.id}`, `${sol.format}-${sol.language || 'unknown'}`)
                        }
                      }
                    }}
                    style={{
                      padding: '0.375rem 0.75rem',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      fontSize: '0.875rem',
                      background: 'white'
                    }}
                  >
                    {visibleSolutions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.format === 'pdf' ? 'PDF' : `${s.language ? LANGUAGE_LABELS[s.language] : '未知'}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ padding: '2rem' }}>
                {/* 学生在公共题目上检查题解是否可见 */}
                {!canModify() && problem.visibility === 'public' && currentSolution && !currentSolution.isVisible ? (
                  <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '1.5rem' }}>
                    题解暂未公开
                  </div>
                ) : currentSolution ? (
                  currentSolution.format === 'pdf' && currentSolution.fileUrl ? (
                    currentSolution.fileUrl.startsWith('/') ? (
                      <iframe
                        src={getPdfUrl(currentSolution.fileUrl) || ''}
                        style={{ width: '100%', height: '600px', border: 'none' }}
                      />
                    ) : (
                      <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                        <p style={{ color: 'var(--gray-600)', marginBottom: '1rem' }}>
                          题解为外部 PDF 文件，请在新窗口中查看
                        </p>
                        <a
                          href={currentSolution.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-block',
                            padding: '0.5rem 1.5rem',
                            backgroundColor: 'var(--primary)',
                            color: '#fff',
                            borderRadius: 'var(--radius)',
                            textDecoration: 'none',
                            fontSize: '0.875rem',
                          }}
                        >
                          打开 PDF 题解
                        </a>
                      </div>
                    )
                  ) : currentSolution.content ? (
                    <MarkdownRenderer content={currentSolution.content} />
                  ) : (
                    <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '1.5rem' }}>
                      暂无题解内容
                    </div>
                  )
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '1.5rem' }}>
                    暂无题解内容
                  </div>
                )}
              </div>
            </>
          )}

          {/* 附件 Tab */}
          {activeTab === 'attachments' && (
            <div style={{ padding: '2rem' }}>
              {attachmentsLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '1.5rem' }}>
                  加载中...
                </div>
              ) : attachments.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '1.5rem' }}>
                  暂无附件
                </div>
              ) : (
                <div>
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.75rem 1rem',
                        borderBottom: '1px solid var(--border)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '1.25rem' }}>📎</span>
                        <div>
                          <div style={{ fontWeight: 500 }}>{attachment.fileName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                            {formatFileSize(attachment.fileSize)}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDownload(attachment)}
                        style={{
                          padding: '0.375rem 0.75rem',
                          background: 'var(--primary)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.875rem'
                        }}
                      >
                        下载
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 提交 Tab */}
          {activeTab === 'submit' && (
            <div style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-700)' }}>提交语言</label>
                <select
                  value={submitLanguage}
                  onChange={e => setSubmitLanguage(e.target.value)}
                  style={{
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    minWidth: '150px',
                    background: 'white',
                  }}
                >
                  {LANGUAGE_OPTIONS.filter(o => o.value).map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <textarea
                placeholder="在此输入代码..."
                style={{
                  width: '100%',
                  minHeight: '400px',
                  padding: '1rem',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
                  lineHeight: 1.5,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  background: '#f8fafc',
                  color: '#1e293b',
                }}
                disabled
              />
              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  disabled
                  style={{
                    padding: '0.625rem 2rem',
                    background: 'var(--gray-300)',
                    color: 'var(--gray-500)',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    cursor: 'not-allowed',
                  }}
                >
                  提交
                </button>
              </div>
              <div style={{
                marginTop: '0.75rem',
                textAlign: 'center',
                fontSize: '0.8rem',
                color: 'var(--gray-400)',
              }}>
                提交功能暂未开放
              </div>
            </div>
          )}

          {/* 提交记录 Tab */}
          {activeTab === 'records' && (
            <div style={{ padding: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap' }}>用户名</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap' }}>评测结果</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap' }}>耗时(ms)</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap' }}>内存(MB)</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap' }}>代码长度(B)</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap' }}>语言</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                      暂无提交记录
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>{/* /主内容 */}

        {/* AI 工具侧边栏 - 仅 Markdown 题面时显示 */}
        {activeTab === 'statement' && currentStatement?.format === 'markdown' && (
          <div style={{
            width: '180px',
            flexShrink: 0,
            position: 'sticky',
            top: '2rem',
          }}>
            <div style={{
              background: 'white',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '0.25rem' }}>
                AI 工具
              </div>
              {(() => {
                const isAdmin = aiUsage?.isAdmin || false
                const currentLang = currentStatement?.language || 'zh'
                const targetLang = currentLang === 'zh' ? 'en' : 'zh'
                const targetLabel = targetLang === 'zh' ? '中文' : '英文'
                // 翻译：检查目标语言是否已有 statement
                const alreadyTranslated = !isAdmin && aiUsage && aiUsage.translations[targetLang as 'zh' | 'en']
                // 格式化：检查当前 statement 是否已被格式化过
                const alreadyFormatted = !isAdmin && aiUsage && selectedStatementId && aiUsage.formattedStatementIds.includes(selectedStatementId)

                return (
                  <>
                    <button
                      onClick={() => !alreadyTranslated && setShowTranslateModal(true)}
                      disabled={aiLoading === 'translate' || !!alreadyTranslated}
                      style={{
                        padding: '0.5rem',
                        background: alreadyTranslated ? 'var(--gray-100)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: alreadyTranslated ? 'var(--gray-400)' : 'white',
                        border: alreadyTranslated ? '1px solid var(--border)' : 'none',
                        borderRadius: '6px',
                        cursor: (aiLoading === 'translate' || alreadyTranslated) ? 'not-allowed' : 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        opacity: aiLoading === 'translate' ? 0.7 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.25rem'
                      }}
                    >
                      {aiLoading === 'translate' ? '翻译中...' : alreadyTranslated ? '🌐 已翻译' : '🌐 翻译'}
                    </button>
                    {alreadyTranslated && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', textAlign: 'center' }}>
                        已有{targetLabel}版本
                      </div>
                    )}
                    <button
                      onClick={() => !alreadyFormatted && handleFormat()}
                      disabled={aiLoading === 'format' || !!alreadyFormatted}
                      style={{
                        padding: '0.5rem',
                        background: alreadyFormatted ? 'var(--gray-100)' : 'var(--gray-100)',
                        color: alreadyFormatted ? 'var(--gray-400)' : 'var(--gray-700)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        cursor: (aiLoading === 'format' || alreadyFormatted) ? 'not-allowed' : 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        opacity: aiLoading === 'format' ? 0.7 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.25rem'
                      }}
                    >
                      {aiLoading === 'format' ? '格式化中...' : alreadyFormatted ? '✨ 已格式化' : '✨ 格式化'}
                    </button>
                    {alreadyFormatted && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', textAlign: 'center' }}>
                        该版本已格式化
                      </div>
                    )}
                  </>
                )
              })()}
              {aiError && (
                <div style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem' }}>
                  {aiError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>{/* /flex container */}

      {/* 翻译弹窗 */}
      {showTranslateModal && (
        <TranslateModal
          currentLang={currentStatement?.language || 'zh'}
          onConfirm={handleTranslate}
          onCancel={() => setShowTranslateModal(false)}
          loading={aiLoading === 'translate'}
        />
      )}
    </div>
    </div>
  )
}