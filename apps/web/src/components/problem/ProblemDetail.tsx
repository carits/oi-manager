'use client'

import { useState, useEffect, useRef } from 'react'
import collisionStyles from './ProblemDetail.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './ProblemDetail.unified.module.css'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { DetailDialog } from '@/components/ui/Dialogs'
import apiClient from '@/lib/apiClient'
import { createClientUUID } from '@/lib/uuid'
import { saveBlobDownload } from '@/lib/download'
import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { LANGUAGE_OPTIONS, JUDGE_RESULT_OPTIONS, JUDGE_RESULT_LABEL_MAP, LANGUAGE_LABEL_MAP, getLanguageLabel } from '@/lib/judge-constants'
import { TranslateModal } from './TranslateModal'
import { SubmissionDetailModal } from '@/components/submission/SubmissionDetailModal'
import { Copy } from 'lucide-react'
import { UserProblemContentPanel } from './UserProblemContentPanel'
import { StatementVersionWorkspace } from './StatementVersionWorkspace'
import { ProblemHackPanel } from './ProblemHackPanel'

interface Statement {
  id: string
  format: 'markdown' | 'pdf'
  language: 'zh' | 'en' | null
  content: string | null
  fileUrl: string | null
  isVisible: boolean
}

interface PlatformLanguage {
  id: string
  name: string
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
  libraryScope: 'platform' | 'school'
  ownerId: string
  ownerType: string
  ownerName: string
  ojBindings: string | null
  allowedLanguages: string | null  // JSON string: PlatformLanguage[]
  createdAt: string
  permissions: {
    canEdit: boolean
    canPublish: boolean
    canArchive: boolean
    canCopyToSchool: boolean
    canSubmit?: boolean
  }
  hack?: { enabled: boolean; acceptedCount: number; canHack: boolean; mode: 'acm' | 'oi' }
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
  const pathname = usePathname()
  const toast = useToast()
  type TabType = 'statement' | 'solution' | 'attachments' | 'my-content' | 'records' | 'hack'
  const VALID_TABS: TabType[] = ['statement', 'solution', 'attachments', 'my-content', 'records', 'hack']
  const [problem, setProblem] = useState<Problem | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>(
    VALID_TABS.includes(searchParams.get('tab') as TabType) ? (searchParams.get('tab') as TabType) : 'statement'
  )
  const [submitLanguage, setSubmitLanguage] = useState('cpp')
  const [showSubmitPanel, setShowSubmitPanel] = useState(false)
  const [submitMethod, setSubmitMethod] = useState<'local' | 'archive'>('local')
  const [submitCode, setSubmitCode] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const submitKeyRef = useRef<string | null>(null)
  const [detailSubmissionId, setDetailSubmissionId] = useState<number | null>(null)
  const [problemSubmissions, setProblemSubmissions] = useState<any[]>([])
  const [problemSubmissionsLoading, setProblemSubmissionsLoading] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)
  const [selectedSolutionId, setSelectedSolutionId] = useState<string | null>(null)
  const [hasVisitedAttachments, setHasVisitedAttachments] = useState(false)
  const [showTranslateModal, setShowTranslateModal] = useState(false)
  const [aiLoading, setAiLoading] = useState<'translate' | 'format' | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [copyingToSchool, setCopyingToSchool] = useState(false)
  const [aiUsage, setAiUsage] = useState<{
    isAdmin: boolean
    translations: { zh: boolean; en: boolean }
    formattedStatementIds: string[]
  } | null>(null)

  // 平台绑定状态
  const [platformBinding, setPlatformBinding] = useState<{
    bound: boolean
    platformUsername?: string
  } | null>(null)

  // 获取路径前缀
  const getPathPrefix = () => {
    if (pathname === '/personal' || pathname.startsWith('/personal/')) return '/personal'
    const workspacePrefix = currentWorkspacePrefix(pathname, '')
    if (workspacePrefix) return workspacePrefix
    if (role === 'admin') return '/platform-admin'
    return currentWorkspacePrefix(pathname, '/personal')
  }
  const pathPrefix = getPathPrefix()

  useEffect(() => {
    fetchProblem()
    fetchAttachments()  // 同时获取附件数据，用于气泡显示
    setSubmitMethod('local')
  }, [problemId])

  // Archive is a separate remote-history import and is never a code submit.
  useEffect(() => {
    if (problem?.platform && submitMethod === 'archive') {
      setPlatformBinding(null) // 先重置状态
      apiClient.get(`/api/platform-bindings/${problem.platform}`).then(res => {
        if (res.success && res.data) {
          const data = res.data as { bound: boolean; platformUsername?: string }
          setPlatformBinding({
            bound: data.bound,
            platformUsername: data.platformUsername
          })
        }
      }).catch(() => {
        setPlatformBinding({ bound: false })
      })
    }
  }, [problem?.platform, submitMethod])

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
      // 题面版本选择（所有版本可见）
      const visibleStatements = problem.statements
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
      const result = await apiClient.get<any>(`/api/problems/${problemId}/ai/usage`)
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
        if (result.data.permissions.canEdit) void fetchAiUsage()
        // 设置默认提交语言为平台语言列表的第一项
        const langs: PlatformLanguage[] = result.data.allowedLanguages
          ? JSON.parse(result.data.allowedLanguages)
          : []
        if (langs.length > 0) {
          setSubmitLanguage(langs[0].id)
        }
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

  // 提交代码
  const handleSubmitCode = async () => {
    if (!problem || !submitCode.trim()) {
      toast.error('请输入代码')
      return
    }

    setSubmitLoading(true)
    try {
      submitKeyRef.current ||= createClientUUID()
      const result = await apiClient.mutate<{ submissionId?: number }>(
        '/api/submit',
        'POST',
        {
          problemId: problem.problemId,
          oj: problem.platform,
          language: submitLanguage,
          code: submitCode,
          submitMethod: 'local',
        },
        { headers: { 'Idempotency-Key': submitKeyRef.current } },
      )

      if (result.ok && result.data?.submissionId) {
        submitKeyRef.current = null
        toast.success('提交成功')
        setShowSubmitPanel(false)
        setSubmitCode('')
        // 刷新提交记录
        fetchProblemSubmissions()
        // 打开状态弹窗
        setDetailSubmissionId(result.data.submissionId)
      } else {
        if (!result.ok && result.error.status > 0 && result.error.status < 500) {
          submitKeyRef.current = null
        }
        toast.error(result.ok ? '提交结果缺少评测编号' : result.error.message)
      }
    } catch (error: any) {
      toast.error(error.message || '提交失败')
    } finally {
      setSubmitLoading(false)
    }
  }

  // 归档同步处理（同步提交记录到 Submission 表）
  // 快速同步最新一条 → 弹窗展示 → 后台异步同步剩余
  const handleArchiveSync = async () => {
    if (!problem || !platformBinding?.bound) return
    setSubmitLoading(true)
    try {
      const result = await apiClient.post<{
        firstSubmission?: {
          id: string
          result: string
          score: number
          language: string
          code: string
          timeUsed: number
          memoryUsed: number
          submittedAt: string
          ojRemoteId: string
          problemId: string
        }
        totalCount: number
        pendingCount: number
        skipped: number
      }>(
        `/api/platform-bindings/${problem.platform}/sync-submissions`,
        { problemId: problem.problemId },
        { timeout: 30000 }  // 30秒超时（快速同步只需约5秒）
      )

      if (result.success && result.data) {
        const { firstSubmission, totalCount, pendingCount, skipped } = result.data

        if (firstSubmission) {
          // 弹窗展示最新提交
          setDetailSubmissionId(parseInt(firstSubmission.id))
          toast.success(`已同步最新提交，剩余 ${pendingCount} 条正在后台同步`)
          setShowSubmitPanel(false)
          // 立即刷新提交列表
          fetchProblemSubmissions()
        } else if (skipped > 0) {
          toast.info('该题提交记录已存在')
        } else {
          const platformName = OJ_PLATFORM_LABEL_MAP[problem.platform] || problem.platform
          toast.warning(`未在 ${platformName} 提交记录中找到该题`)
        }
      } else {
        toast.error(result.message || '归档同步失败')
      }
    } catch (error: any) {
      toast.error(error.message || '归档同步失败')
    } finally {
      setSubmitLoading(false)
    }
  }

  // 获取题目提交记录
  const fetchProblemSubmissions = async () => {
    if (!problemId) return
    setProblemSubmissionsLoading(true)
    try {
      const result = await apiClient.get<{
        submissions: any[]
        total: number
      }>(`/api/problems/${problemId}/submissions`)
      if (result.success && result.data) {
        setProblemSubmissions(result.data.submissions || [])
      }
    } catch (error) {
      console.error('Failed to fetch submissions:', error)
    } finally {
      setProblemSubmissionsLoading(false)
    }
  }

  // 当 activeTab 变为 records 时获取提交记录
  useEffect(() => {
    if (activeTab === 'records') {
      fetchProblemSubmissions()
    }
  }, [activeTab])

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
        const result = await apiClient.download(attachment.fileUrl)
        saveBlobDownload(result.blob, attachment.fileName)
      } else {
        // 旧格式直接打开
        window.open(`${process.env.NEXT_PUBLIC_API_URL || ''}${attachment.fileUrl}`, '_blank')
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
        router.push(`${pathPrefix}/problems`)
      }
    } catch (error) {
      console.error('Failed to delete problem:', error)
    }
  }

  const copyToSchool = async () => {
    if (!problem || copyingToSchool) return
    setCopyingToSchool(true)
    const result = await apiClient.mutate<{ problem: { id: string }; skippedFiles: string[] }>(
      `/api/problems/${problem.id}/copy-to-school`,
      'POST',
    )
    setCopyingToSchool(false)
    if (result.ok) {
      toast.success('已复制到校内题库，并保存为草稿')
      router.push(`${pathPrefix}/problems/${result.data.problem.id}/edit`)
      return
    }
    if (result.error.code === 'SCHOOL_PROBLEM_EXISTS') {
      const existingId = (result.error.data as { id?: string } | undefined)?.id
      toast.info('本校题库已经有这道题')
      if (existingId) router.push(`${pathPrefix}/problems/${existingId}`)
      return
    }
    toast.error(result.error.message)
  }

  // 判断是否有编辑/删除权限
  const canModify = () => {
    return problem?.permissions.canEdit ?? false
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

  // 获取可显示的题面列表（所有版本对所有人可见，不做 isVisible 限制）
  const getVisibleStatements = (): Statement[] => {
    if (!problem) return []
    return problem.statements
  }

  // 获取可显示的题解列表
  const getVisibleSolutions = (): Statement[] => {
    if (!problem) return []
    // 学生在公共题目上只能看到可见的题解
    if (!canModify()) {
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
      <div className={unifiedStyles.u1}>
        <span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" />
      </div>
    )
  }

  if (!problem) {
    return (
      <div className={unifiedStyles.u1}>
        题目不存在
      </div>
    )
  }

  const ojBindings: OjBinding[] = problem.ojBindings ? JSON.parse(problem.ojBindings) : []

  const visibleStatements = getVisibleStatements()
  const visibleSolutions = getVisibleSolutions()
  const currentStatement = getSelectedStatement()
  const currentSolution = getSelectedSolution()
  const hackLanguages = (() => {
    const localLanguages = ['c', 'c11', 'cpp', 'cpp11', 'cpp14', 'cpp17', 'cpp20', 'python3']
    const locallySupported = new Set(localLanguages)
    if (!problem.allowedLanguages) return localLanguages
    try {
      const parsed = JSON.parse(problem.allowedLanguages) as Array<string | PlatformLanguage>
      const values = parsed.map(item => typeof item === 'string' ? item : item.id).filter(Boolean)
      return values.length > 0 ? values.filter(value => locallySupported.has(value)) : localLanguages
    } catch {
      return localLanguages
    }
  })()

  return (
    <div className={unifiedStyles.u2}>
      <div className={unifiedStyles.u3}>
        {/* 返回按钮 */}
        <Button variant="ghost"
          onClick={() => router.push(`${pathPrefix}/problems`)}
          className={unifiedStyles.u4}
        >
          ← 返回列表
        </Button>

        {/* 题目头部 */}
        <div className={unifiedStyles.u5}>
          <div className={unifiedStyles.u6}>
            <div>
              <div className={unifiedStyles.u7}>
                <span className={unifiedStyles.u8}>{problem.problemId}</span>
                <h1 className={unifiedStyles.u9}>{problem.title}</h1>
              </div>
              <div className={unifiedStyles.u10}>
                {problem.difficulty && (
                  <span className={unifiedStyles.difficulty} data-difficulty={problem.difficulty}>{problem.difficulty}</span>
                )}
                {problem.timeLimit && <span>时间限制: {problem.timeLimit}ms</span>}
                {problem.memoryLimit && <span>空间限制: {problem.memoryLimit}MB</span>}
                <span className={unifiedStyles.libraryScope} data-scope={problem.libraryScope}>
                  {problem.libraryScope === 'platform' ? '平台题库' : '校内题库'}
                </span>
                {problem.libraryScope === 'school' && (
                  <span>{problem.status === 'published' ? '已发布' : problem.status === 'archived' ? '已归档' : '草稿'}</span>
                )}
              </div>
            </div>
            {(canModify() || problem.permissions.canCopyToSchool) && (
              <div className={unifiedStyles.u11}>
                {problem.permissions.canCopyToSchool && (
                  <Button variant="outline"
                    onClick={() => void copyToSchool()}
                    disabled={copyingToSchool}
                    className={unifiedStyles.copyButton}
                  >
                    <Copy size={15} aria-hidden="true" />{copyingToSchool ? '复制中' : '复制到校内'}
                  </Button>
                )}
                {canModify() && <>
                <Button variant="ghost"
                  onClick={() => router.push(`${pathPrefix}/problems/${problemId}/edit`)}
                  className={unifiedStyles.u12}
                >
                  编辑
                </Button>
                <Button variant="ghost"
                  onClick={handleDelete}
                  className={unifiedStyles.u13}
                >
                  归档
                </Button>
                </>}
              </div>
            )}
          </div>

          {/* OJ 绑定 */}
          {ojBindings.length > 0 && (
            <div className={unifiedStyles.u14}>
              <span className={unifiedStyles.u15}>OJ链接:</span>
              {ojBindings.map((binding, index) => (
                <a
                  key={index}
                  href={binding.url || getOjProblemUrl(binding.platform, binding.problemId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={unifiedStyles.u16}
                >
                  [{OJ_PLATFORM_LABEL_MAP[binding.platform] || binding.platform} {binding.problemId}]
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Tab 切换 */}
        <div className={unifiedStyles.u17}>
          <div className={unifiedStyles.u11}>
            <Button variant="ghost"
              onClick={() => handleTabChange('statement')}
              className={unifiedStyles.tabButton} aria-selected={activeTab === 'statement'}
            >
              题面
            </Button>
            <Button variant="ghost"
              onClick={() => handleTabChange('solution')}
              className={unifiedStyles.tabButton} aria-selected={activeTab === 'solution'}
            >
              题解
            </Button>
            <Button variant="ghost"
              onClick={() => {
                handleTabChange('attachments')
                setHasVisitedAttachments(true)
              }}
              className={`${unifiedStyles.tabButton} ${unifiedStyles.attachmentTab}`} aria-selected={activeTab === 'attachments'}
            >
              附件
              {attachments.length > 0 && !hasVisitedAttachments && (
                <span className={unifiedStyles.u18}>
                  {attachments.length}
                </span>
              )}
            </Button>
            <Button variant="ghost"
              onClick={() => handleTabChange('my-content')}
              className={unifiedStyles.tabButton} aria-selected={activeTab === 'my-content'}
            >
              我的题解
            </Button>
            <Button variant="ghost"
              onClick={() => handleTabChange('records')}
              className={unifiedStyles.tabButton} aria-selected={activeTab === 'records'}
            >
              提交记录
            </Button>
            {problem.hack?.enabled && (problem.hack.canHack || canModify()) && (
              <Button variant="ghost"
                onClick={() => handleTabChange('hack')}
                className={unifiedStyles.tabButton} aria-selected={activeTab === 'hack'}
              >
                Hack{problem.hack.acceptedCount > 0 ? ` ${problem.hack.acceptedCount}` : ''}
              </Button>
            )}
          </div>

          {/* 思路记录按钮 */}
          <Button variant="ghost"
            onClick={() => router.push(`${pathPrefix}/problems/${problemId}/note`)}
            className={unifiedStyles.u19}
          >
            写思路
          </Button>
        </div>

        {/* 内容区域 + AI侧边栏 */}
        <div className={unifiedStyles.u20}>
          {/* 主内容 */}
          <div className={unifiedStyles.u21}>
            <div className={unifiedStyles.u22}>
          {/* 题面 Tab */}
          {activeTab === 'statement' && (
            <StatementVersionWorkspace problemId={problemId} />
          )}

          {/* 题解 Tab */}
          {activeTab === 'solution' && (
            <>
              {/* 左上角版本选择 */}
              {visibleSolutions.length > 1 && (
                <div className={unifiedStyles.u23}>
                  <Select aria-label="选择"
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
                    className={unifiedStyles.u24}
                  >
                    {visibleSolutions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.format === 'pdf' ? 'PDF' : `${s.language ? LANGUAGE_LABELS[s.language] : '未知'}`}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div className={unifiedStyles.u25}>
                {/* 学生在公共题目上检查题解是否可见 */}
                {!canModify() && currentSolution && !currentSolution.isVisible ? (
                  <div className={unifiedStyles.u26}>
                    题解暂未公开
                  </div>
                ) : currentSolution ? (
                  currentSolution.format === 'pdf' && currentSolution.fileUrl ? (
                    currentSolution.fileUrl.startsWith('/') ? (
                      <iframe
                        src={getPdfUrl(currentSolution.fileUrl) || ''}
                        className={unifiedStyles.u27}
                      />
                    ) : (
                      <div className={unifiedStyles.u28}>
                        <p className={unifiedStyles.u29}>
                          题解为外部 PDF 文件，请在新窗口中查看
                        </p>
                        <a
                          href={currentSolution.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={unifiedStyles.u30}
                        >
                          打开 PDF 题解
                        </a>
                      </div>
                    )
                  ) : currentSolution.content ? (
                    <MarkdownRenderer content={currentSolution.content} />
                  ) : (
                    <div className={unifiedStyles.u26}>
                      暂无题解内容
                    </div>
                  )
                ) : (
                  <div className={unifiedStyles.u26}>
                    暂无题解内容
                  </div>
                )}
              </div>
            </>
          )}

          {/* 附件 Tab */}
          {activeTab === 'attachments' && (
            <div className={unifiedStyles.u25}>
              {attachmentsLoading ? (
                <div className={unifiedStyles.u26}>
                  <span className={[("resource-skeleton-line"), collisionStyles.u2].filter(Boolean).join(' ')}  aria-label="内容正在准备" />
                </div>
              ) : attachments.length === 0 ? (
                <div className={unifiedStyles.u26}>
                  暂无附件
                </div>
              ) : (
                <div>
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className={unifiedStyles.u31}
                    >
                      <div className={unifiedStyles.u32}>
                        <span className={unifiedStyles.u33}>附件</span>
                        <div>
                          <div className={unifiedStyles.u34}>{attachment.fileName}</div>
                          <div className={unifiedStyles.u35}>
                            {formatFileSize(attachment.fileSize)}
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost"
                        onClick={() => handleDownload(attachment)}
                        className={unifiedStyles.u36}
                      >
                        下载
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 提交记录 Tab */}
          {activeTab === 'my-content' && (
            <UserProblemContentPanel problemId={problemId} />
          )}

          {activeTab === 'hack' && problem.hack?.enabled && (problem.hack.canHack || canModify()) && (
            <ProblemHackPanel problemId={problemId} acceptedCount={problem.hack.acceptedCount} languages={hackLanguages} mode={problem.hack.mode} />
          )}

          {/* 提交记录 Tab */}
          {activeTab === 'records' && (
            <div className={unifiedStyles.u37}>
              <TableRoot className={unifiedStyles.u38}>
                <TableHead>
                  <TableRow className={unifiedStyles.u39}>
                    <TableHeaderCell className={unifiedStyles.u40}>评测ID</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u40}>用户名</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u40}>评测结果</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u40}>类型</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u40}>耗时(MS)</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u40}>内存(MB)</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u40}>代码长度(B)</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u40}>语言</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u40}>提交时间</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {problemSubmissionsLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className={unifiedStyles.u41}>
                        <span className={[("resource-skeleton-line"), collisionStyles.u3].filter(Boolean).join(' ')}  aria-label="内容正在准备" />
                      </TableCell>
                    </TableRow>
                  ) : problemSubmissions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className={unifiedStyles.u41}>
                        暂无提交记录
                      </TableCell>
                    </TableRow>
                  ) : (
                    problemSubmissions.map(s => (
                      <TableRow key={s.id} className={unifiedStyles.u42}>
                        <TableCell
                          onClick={() => {
                            router.push(`${pathPrefix}/submissions/${s.id}`)
                          }}
                          className={unifiedStyles.u43}
                        >#{s.id}</TableCell>
                        <TableCell className={unifiedStyles.u44}>{s.username}</TableCell>
                        <TableCell className={unifiedStyles.u44}>
                          <span className={unifiedStyles.submissionResult} data-result={s.result}>
                            {JUDGE_RESULT_LABEL_MAP[s.result] || s.result}
                          </span>
                        </TableCell>
                        <TableCell className={unifiedStyles.u45}>
                          {s.submitMethod === 'archive' ? '远程归档' : '本地评测'}
                        </TableCell>
                        <TableCell className={unifiedStyles.u44}>{s.timeUsed ?? '-'}</TableCell>
                        <TableCell className={unifiedStyles.u44}>{s.memoryUsed != null ? (s.memoryUsed / 1024).toFixed(2) : '-'}</TableCell>
                        <TableCell className={unifiedStyles.u44}>{s.codeLength ?? '-'}</TableCell>
                        <TableCell
                          onClick={() => setDetailSubmissionId(s.id)}
                          className={unifiedStyles.u46}
                        >
                          {getLanguageLabel(s.language)}
                        </TableCell>
                        <TableCell className={unifiedStyles.u47}>
                          {s.submittedAt ? new Date(s.submittedAt).toLocaleString('zh-CN') : '-'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </TableRoot>
            </div>
          )}
        </div>
        </div>{/* /主内容 */}

        {/* 右侧边栏 */}
        <div className={unifiedStyles.u48}>
          {/* AI 工具 - 仅 Markdown 题面时显示 */}
          {canModify() && activeTab === 'statement' && currentStatement?.format === 'markdown' && (
            <div className={unifiedStyles.u49}>
              <div className={unifiedStyles.u50}>
                AI 工具
              </div>
              {(() => {
                const isAdmin = aiUsage?.isAdmin || false
                const currentLang = currentStatement?.language || 'zh'
                const targetLang = currentLang === 'zh' ? 'en' : 'zh'
                const targetLabel = targetLang === 'zh' ? '中文' : '英文'
                const alreadyTranslated = !isAdmin && aiUsage && aiUsage.translations[targetLang as 'zh' | 'en']
                const alreadyFormatted = !isAdmin && aiUsage && selectedStatementId && aiUsage.formattedStatementIds.includes(selectedStatementId)

                return (
                  <>
                    <Button variant="primary"
                      onClick={() => !alreadyTranslated && setShowTranslateModal(true)}
                      disabled={aiLoading === 'translate' || !!alreadyTranslated}
                      className={unifiedStyles.aiAction}
                    >
                      {aiLoading === 'translate' ? '翻译中...' : alreadyTranslated ? '已翻译' : '翻译'}
                    </Button>
                    {alreadyTranslated && (
                      <div className={unifiedStyles.u51}>
                        已有{targetLabel}版本
                      </div>
                    )}
                    <Button variant="secondary"
                      onClick={() => !alreadyFormatted && handleFormat()}
                      disabled={aiLoading === 'format' || !!alreadyFormatted}
                      className={unifiedStyles.aiAction}
                    >
                      {aiLoading === 'format' ? '格式化中...' : alreadyFormatted ? '✨ 已格式化' : '✨ 格式化'}
                    </Button>
                    {alreadyFormatted && (
                      <div className={unifiedStyles.u51}>
                        该版本已格式化
                      </div>
                    )}
                  </>
                )
              })()}
              {aiError && (
                <div className={unifiedStyles.u52}>
                  {aiError}
                </div>
              )}
            </div>
          )}

          {/* 提交代码按钮 */}
          <div className={unifiedStyles.u53}>
            <Button variant="ghost"
              onClick={() => setShowSubmitPanel(true)}
              className={unifiedStyles.u54}
            >
              ▶ 提交代码
            </Button>
          </div>
        </div>
      </div>{/* /flex container */}

      {/* 提交代码弹窗 */}
      {showSubmitPanel && (
        <DetailDialog
          isOpen={true}
          onClose={() => setShowSubmitPanel(false)}
          title={`${OJ_PLATFORM_LABEL_MAP[problem.platform] || problem.platform} ${problem.problemId}`}
          size="xl"
        >
          <div className={unifiedStyles.u55}>
            本站提交的代码统一使用本地测试数据评测；远程归档仅同步历史记录，不参与本站成绩。
          </div>

          {/* Only platforms with archive connectors expose the archive action. */}
          {['codeforces', 'luogu'].includes(problem.platform) && (
            <div className={unifiedStyles.u56}>
              {([
                { key: 'local', label: '本地评测' },
                { key: 'archive', label: '同步归档' },
              ] as const)
                .map(m => (
                  <Button variant="ghost"
                    key={m.key}
                    onClick={() => setSubmitMethod(m.key)}
                    className={unifiedStyles.submitMethod} aria-selected={submitMethod === m.key}
                  >
                    {m.label}
                  </Button>
                ))}
            </div>
          )}

          {/* Archive requires a bound source-platform account. */}
          {submitMethod === 'archive' && (
            <div className={unifiedStyles.u57}>
              <span>平台账号</span>
              {platformBinding === null ? (
                <span className={unifiedStyles.u58}>检查中...</span>
              ) : platformBinding.bound ? (
                <span className={unifiedStyles.u59}>
                  已绑定: {platformBinding.platformUsername}
                </span>
              ) : (
                <span
                  className={unifiedStyles.u60}
                  onClick={() => router.push('/account/platform-bindings')}
                >
                  未绑定，点击去绑定
                </span>
              )}
            </div>
          )}

          {/* 语言选择 - 归档模式下隐藏 */}
          {submitMethod !== 'archive' && (
          <div className={unifiedStyles.u61}>
            {(() => {
              const platformLangs: PlatformLanguage[] = problem.allowedLanguages
                ? JSON.parse(problem.allowedLanguages)
                : []
              const langs = platformLangs.length > 0
                ? platformLangs
                : LANGUAGE_OPTIONS.filter(o => o.value).map(o => ({ id: o.value, name: o.label }))
              return (
                <Select aria-label="选择"
                  value={submitLanguage}
                  onChange={e => setSubmitLanguage(e.target.value)}
                  className={unifiedStyles.u62}
                >
                  {langs.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </Select>
              )
            })()}
          </div>
          )}

          {/* 代码输入框 - 归档模式下隐藏 */}
          {submitMethod !== 'archive' && (
          <Textarea
            placeholder="在此输入代码..."
            value={submitCode}
            onChange={e => setSubmitCode(e.target.value)}
            className={unifiedStyles.codeInput}
          />
          )}

          {/* 提交按钮 */}
          <div className={unifiedStyles.u63}>
            <span className={unifiedStyles.u64}>
              {submitMethod === 'local' ? '本地评测' : '远程归档：只同步展示，不参与评测或计分'}
            </span>
            {submitMethod === 'archive' ? (
              <Button variant="primary"
                onClick={handleArchiveSync}
                disabled={submitLoading || !platformBinding?.bound}
              >
                {submitLoading ? '同步中...' : '同步归档'}
              </Button>
            ) : (
              <Button variant="primary"
                onClick={handleSubmitCode}
                disabled={submitLoading || !submitCode.trim()}
              >
                {submitLoading ? '提交中...' : '提交'}
              </Button>
            )}
          </div>
        </DetailDialog>
      )}

      {/* 翻译弹窗 */}
      {showTranslateModal && (
        <TranslateModal
          currentLang={currentStatement?.language || 'zh'}
          onConfirm={handleTranslate}
          onCancel={() => setShowTranslateModal(false)}
          loading={aiLoading === 'translate'}
        />
      )}

      {/* 提交详情弹窗 */}
      <SubmissionDetailModal
        isOpen={detailSubmissionId !== null}
        onClose={() => setDetailSubmissionId(null)}
        submissionId={detailSubmissionId}
        viewRole={role}
      />
    </div>
    </div>
  )
}
