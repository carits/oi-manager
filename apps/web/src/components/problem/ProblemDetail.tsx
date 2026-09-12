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
import { getOjProblemUrl, OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { LANGUAGE_OPTIONS, JUDGE_RESULT_OPTIONS, JUDGE_RESULT_LABEL_MAP, LANGUAGE_LABEL_MAP, getLanguageLabel } from '@/lib/judge-constants'
import { TranslateModal } from './TranslateModal'
import { SubmissionDetailModal } from '@/components/submission/SubmissionDetailModal'
import { UserProblemContentPanel } from './UserProblemContentPanel'
import { StatementVersionWorkspace } from './StatementVersionWorkspace'
import { ProblemHackPanel } from './ProblemHackPanel'
import { SolutionEditorialPanel } from './SolutionEditorialPanel'
import { ProblemRelatedBlogs } from '@/components/blog/ProblemRelatedBlogs'
import { SubmissionIoFields, type SubmissionIoValue } from '@/components/submission/SubmissionIoFields'
import { SubmissionCodeEditor, clearSubmissionDraft } from '@/components/submission/SubmissionCodeEditor'
import { Menu as ActionMenu } from '@/components/ui/OverlayPrimitives'

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
  legacyIoSuggestion?: SubmissionIoValue | null
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
  type TabType = 'statement' | 'solution' | 'knowledge' | 'attachments' | 'records' | 'hack'
  const VALID_TABS: TabType[] = ['statement', 'solution', 'knowledge', 'attachments', 'records', 'hack']
  const [problem, setProblem] = useState<Problem | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>(
    searchParams.get('tab') === 'my-content' ? 'solution' : VALID_TABS.includes(searchParams.get('tab') as TabType) ? (searchParams.get('tab') as TabType) : 'statement'
  )
  const [submitLanguage, setSubmitLanguage] = useState('cpp')
  const [showSubmitPanel, setShowSubmitPanel] = useState(false)
  const [submissionIo, setSubmissionIo] = useState<SubmissionIoValue>({ inputFilename: null, outputFilename: null })
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
  }, [problemId])

  useEffect(() => {
    setSubmissionIo(problem?.legacyIoSuggestion || { inputFilename: null, outputFilename: null })
  }, [problem?.id, problem?.legacyIoSuggestion?.inputFilename, problem?.legacyIoSuggestion?.outputFilename])

  useEffect(() => {
    const requested = searchParams.get('tab')
    const tab = requested === 'my-content' ? 'solution' : requested as TabType
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
          inputFilename: submissionIo.inputFilename || null,
          outputFilename: submissionIo.outputFilename || null,
        },
        { headers: { 'Idempotency-Key': submitKeyRef.current } },
      )

      if (result.ok && result.data?.submissionId) {
        submitKeyRef.current = null
        toast.success('提交成功')
        setShowSubmitPanel(false)
        clearSubmissionDraft(`${user?.userId || 'account'}:problem:${problem.id}`, submitLanguage)
        setSubmitCode('')
        setSubmissionIo(problem.legacyIoSuggestion || { inputFilename: null, outputFilename: null })
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
            {(canModify() || problem.permissions.canCopyToSchool) && <ActionMenu
              label="题目管理操作"
              trigger={<Button variant="outline">管理题目</Button>}
              items={[
                ...(problem.permissions.canCopyToSchool ? [{ key: 'copy', label: copyingToSchool ? '正在复制…' : '复制到校内题库', disabled: copyingToSchool, onSelect: () => void copyToSchool() }] : []),
                ...(canModify() ? [
                  { key: 'edit', label: '编辑题目', onSelect: () => router.push(`${pathPrefix}/problems/${problemId}/edit`) },
                  { key: 'archive', label: '归档题目', danger: true, onSelect: handleDelete },
                ] : []),
              ]}
            />}
          </div>

          {/* OJ 绑定 */}
          {ojBindings.length > 0 && (
            <div className={unifiedStyles.u14}>
              <span className={unifiedStyles.u15}>OJ链接:</span>
              {ojBindings.map((binding, index) => (
                <a
                  key={index}
                  href={binding.url || getOjProblemUrl(binding.platform, binding.problemId) || undefined}
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
              题目
            </Button>
            <Button variant="ghost"
              onClick={() => handleTabChange('solution')}
              className={unifiedStyles.tabButton} aria-selected={activeTab === 'solution'}
            >
              题解
            </Button>
            <Button variant="ghost"
              onClick={() => handleTabChange('records')}
              className={unifiedStyles.tabButton} aria-selected={activeTab === 'records'}
            >
              提交记录
            </Button>
            <ActionMenu
              label="题目更多内容"
              trigger={<Button variant="ghost" className={unifiedStyles.tabButton} aria-selected={['knowledge', 'attachments', 'hack'].includes(activeTab)}>更多</Button>}
              items={[
                { key: 'knowledge', label: '相关知识文章', onSelect: () => handleTabChange('knowledge') },
                { key: 'attachments', label: `附件${attachments.length > 0 && !hasVisitedAttachments ? `（${attachments.length}）` : ''}`, onSelect: () => { handleTabChange('attachments'); setHasVisitedAttachments(true) } },
                ...(problem.hack && (problem.permissions.canSubmit || canModify()) ? [{ key: 'hack', label: problem.hack.enabled ? `贡献数据与 Hack${problem.hack.acceptedCount > 0 ? `（${problem.hack.acceptedCount}）` : ''}` : '贡献数据', onSelect: () => handleTabChange('hack') }] : []),
              ]}
            />
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
              <SolutionEditorialPanel problemId={problemId} canManage={canModify()} />

              {visibleSolutions.length > 0 && <div className={unifiedStyles.u23}>旧版题解</div>}
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
              {(problem.permissions.canSubmit || canModify()) && <details className={unifiedStyles.u25}>
                <summary>撰写我的题解</summary>
                <p className={unifiedStyles.u26}>个人题解与官方题解放在同一个工作区，可单独保存并授权活动使用。</p>
                <UserProblemContentPanel problemId={problemId} />
              </details>}
            </>
          )}

          {activeTab === 'knowledge' && <ProblemRelatedBlogs problemId={problemId} />}

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

          {activeTab === 'hack' && problem.hack && (problem.permissions.canSubmit || canModify()) && (
            <ProblemHackPanel problemId={problemId} acceptedCount={problem.hack.acceptedCount} languages={hackLanguages} mode={problem.hack.mode} hackEnabled={problem.hack.enabled} onConfigureAssets={() => router.push(`${pathPrefix}/problems/${problemId}/edit?section=judge-assets`)} />
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
                      <TableCell colSpan={8} className={unifiedStyles.u41}>
                        <span className={[("resource-skeleton-line"), collisionStyles.u3].filter(Boolean).join(' ')}  aria-label="内容正在准备" />
                      </TableCell>
                    </TableRow>
                  ) : problemSubmissions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className={unifiedStyles.u41}>
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

          {/* 提交代码工作台入口 */}
          <div className={unifiedStyles.u53}>
            <Button variant="ghost"
              onClick={() => setShowSubmitPanel(value => !value)}
              aria-expanded={showSubmitPanel}
              className={unifiedStyles.u54}
            >
              {showSubmitPanel ? '收起代码工作台' : '▶ 打开代码工作台'}
            </Button>
          </div>
        </div>
      </div>{/* /flex container */}

      {/* 提交是题目主页面的一部分；远端历史导入只存在于账号绑定页。 */}
      {showSubmitPanel && (
        <section className={unifiedStyles.u55} aria-label="代码提交工作台">
          <div className={unifiedStyles.u61}>
            <strong>{OJ_PLATFORM_LABEL_MAP[problem.platform] || problem.platform} {problem.problemId} · 代码工作台</strong>
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
          </div>
          <SubmissionCodeEditor value={submitCode} onChange={setSubmitCode} language={submitLanguage} draftKey={`${user?.userId || 'account'}:problem:${problem.id}`} minHeight={420} />
          <details>
            <summary>文件输入输出设置</summary>
            <SubmissionIoFields value={submissionIo} onChange={setSubmissionIo} legacySuggested={Boolean(problem.legacyIoSuggestion)} />
          </details>
          <div className={unifiedStyles.u63}>
            <span className={unifiedStyles.u64}>代码会使用本站当前正式数据评测；失败时草稿仍会保留。</span>
            <Button variant="primary" onClick={handleSubmitCode} disabled={submitLoading || !submitCode.trim() || submissionIo.inputFilename === '' || submissionIo.outputFilename === ''}>{submitLoading ? '提交中...' : '提交评测'}</Button>
          </div>
        </section>
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
