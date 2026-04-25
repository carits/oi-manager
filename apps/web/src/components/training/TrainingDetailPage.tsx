'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { SubmissionDetailModal } from '@/components/submission/SubmissionDetailModal'
import { JUDGE_RESULT_LABEL_MAP, LANGUAGE_LABEL_MAP, LANGUAGE_OPTIONS } from '@/lib/judge-constants'
import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { TrainingFormModal } from './TrainingFormModal'
import { useAuth } from '@/components/AuthProvider'

// ========== Helper Functions ==========

/**
 * 将数字转换为 Excel 风格的列名（A, B, ..., Z, AA, AB, ..., AZ, BA, ...）
 * @param index 从0开始的索引
 */
function toExcelColumnName(index: number): string {
  let result = ''
  let i = index
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result
    i = Math.floor(i / 26) - 1
  }
  return result
}

// ========== Types ==========

interface PlatformLanguage {
  id: string
  name: string
}

interface TrainingInfo {
  id: string
  teamId: string
  title: string
  description: string | null
  format: 'ioi' | 'icpc'
  startTime: string
  endTime: string
  status: string
  createdBy: string
  problemIdVisible: boolean
  solutionVisible: boolean
  includeAdminInRanking: boolean
  problemCount: number
  isAdmin: boolean
}

interface TrainingProblem {
  id: string
  alias: string | null
  orderIndex: number
  points: number | null
  hasSolution: boolean
  solutionVisible: boolean
  attachmentCount: number
  problemId?: string
  problemTitle?: string
  platform?: string
  platformProblemId?: string
  difficulty?: string
  timeLimit?: number
  memoryLimit?: number
}

interface ProblemDetail {
  alias: string | null
  points: number | null
  timeLimit: number | null
  memoryLimit: number | null
  difficulty: string | null
  description: string | null
  statementType: string
  statements: Array<{
    id: string
    format: string
    language: string | null
    content: string | null
    fileUrl: string | null
  }>
  problemTitle?: string
  platform?: string
  platformProblemId?: string
}

interface SubmissionRow {
  id: number
  userId: string
  userName: string
  username: string
  userType: string
  problemAlias: string
  problemOrderIndex: number
  trainingProblemId: string
  oj: string
  language: string
  result: string
  score: number | null
  timeUsed: number | null
  memoryUsed: number | null
  codeLength: number
  ojRemoteId: string | null
  createdAt: string
}

interface Attachment {
  id: string
  fileName: string
  fileSize: number
  fileUrl: string
  uploadedBy: string
  uploadedAt: string
}

interface ProblemListEntry {
  id: string
  alias: string
  orderIndex: number
  points: number | null
  platform: string | null
  platformProblemId: string | null
  problemTableId: string
  platformLabel: string
  problemUrl: string | null
  bestScore: number | null
  bestResult: string | null
}

type TabType = 'problems' | 'problemList' | 'submissions' | 'solutions' | 'attachments' | 'ranking'

interface TrainingDetailPageProps {
  basePath: string
}

// ========== Constants ==========

const STATEMENT_LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English'
}

// ========== Helpers ==========

function getPdfUrl(fileUrl: string): string | null {
  if (!fileUrl) return null
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
  if (fileUrl.startsWith('/')) {
    // 本地文件
    return `${apiUrl}${fileUrl}`
  }
  return fileUrl
}

function getResultColor(result: string): string {
  if (result === 'accepted') return 'var(--success)'
  if (['wa', 'tle', 'mle', 're', 'ole'].includes(result)) return 'var(--error)'
  if (result === 'ce') return 'var(--warning)'
  if (result === 'pending_review') return 'var(--primary)'
  return 'var(--text-secondary)'
}

function formatResult(result: string): string {
  return JUDGE_RESULT_LABEL_MAP[result] || result
}

function formatLanguage(lang: string): string {
  return LANGUAGE_LABEL_MAP[lang] || lang
}

const RESULT_COLORS: Record<string, { bg: string; text: string }> = {
  accepted: { bg: 'var(--success-light)', text: 'var(--success-text)' },
  queuing: { bg: 'var(--info-light)', text: 'var(--info-text)' },
  tle: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  mle: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  wa: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  re: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  ce: { bg: 'var(--warning-light)', text: 'var(--text-secondary)' },
  pe: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  ole: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
}

function getResultBadge(result: string) {
  const label = JUDGE_RESULT_LABEL_MAP[result] || result
  const colors = RESULT_COLORS[result] || { bg: 'var(--bg-muted)', text: 'var(--text-primary)' }
  if (result === 'queuing' || result === 'judging') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: colors.bg, color: colors.text }}>
        <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #e5e7eb', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: '4px', verticalAlign: 'middle' }} />
        {label}
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: colors.bg, color: colors.text }}>
      {label}
    </span>
  )
}

function getOjLabel(oj: string): string {
  if (oj === 'carits') return 'Carits平台'
  return OJ_PLATFORM_LABEL_MAP[oj] || oj
}

function getScoreColor(score: number, max: number): string {
  const ratio = max > 0 ? score / max : 0
  if (ratio >= 1) return 'var(--success)'
  if (ratio >= 0.5) return 'var(--warning)'
  return 'var(--error)'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getProblemOrderIndex(problems: TrainingProblem[], trainingProblemId: string): number {
  const problem = problems.find(p => p.id === trainingProblemId)
  return problem?.orderIndex ?? 0
}

const RESULT_SHORT_MAP: Record<string, string> = {
  accepted: 'AC',
  wa: 'WA', tle: 'TLE', mle: 'MLE', re: 'RE',
  ce: 'CE', pe: 'PE', ole: 'OLE',
  pending_review: 'Pending',
  queuing: 'Queuing', judging: 'Judging',
  remote_unavailable: 'Err', judge_failed: 'Err', unknown_error: 'Err', submit_failed: 'Err',
}

const RANK_MEDAL_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32']

// ========== Component ==========

export function TrainingDetailPage({ basePath }: TrainingDetailPageProps) {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const { user } = useAuth()
  const trainingId = params.tid as string
  const teamId = params.id as string

  // Core state
  const [training, setTraining] = useState<TrainingInfo | null>(null)
  const [problems, setProblems] = useState<TrainingProblem[]>([])
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null)
  const [problemDetail, setProblemDetail] = useState<ProblemDetail | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('problemList')
  const [loading, setLoading] = useState(true)

  // Note
  const [noteContent, setNoteContent] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [showNotePanel, setShowNotePanel] = useState(false)
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Statement switch
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)

  // Code submit
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [submitLanguage, setSubmitLanguage] = useState('cpp')
  const [submitCode, setSubmitCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitMethod, setSubmitMethod] = useState<'robot' | 'myAccount' | 'archive'>('robot')

  // Submissions tab - 筛选
  const [filterProblemId, setFilterProblemId] = useState<string>('')
  const [filterUsername, setFilterUsername] = useState('')
  const [filterResult, setFilterResult] = useState<string>('')
  const [filterLanguage, setFilterLanguage] = useState<string>('')
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [submissionsPage, setSubmissionsPage] = useState(1)
  const [submissionsTotal, setSubmissionsTotal] = useState(0)
  const [detailSubmissionId, setDetailSubmissionId] = useState<number | null>(null)

  // Solutions tab - 所有题目的题解
  const [allSolutions, setAllSolutions] = useState<Record<string, { content: string; visible: boolean; source?: 'training' | 'problem'; solutionType?: string; solutionPdfUrl?: string }>>({})

  // Attachments tab - 所有题目的附件
  const [allAttachments, setAllAttachments] = useState<Record<string, Attachment[]>>({})

  // Ranking tab
  const [rankingData, setRankingData] = useState<any>(null)

  // Problem list tab
  const [problemListData, setProblemListData] = useState<ProblemListEntry[]>([])

  // Countdown
  const [timeDisplay, setTimeDisplay] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ========== Data loading ==========

  const loadTraining = useCallback(async () => {
    try {
      const res = await apiClient.get<TrainingInfo>(`/api/trainings/${trainingId}`)
      if (res.success && res.data) {
        setTraining(res.data)
      }
    } catch {
      // ignore refresh errors
    }
  }, [trainingId])

  useEffect(() => {
    loadTraining()
  }, [loadTraining])

  useEffect(() => {
    if (!training) return
    const loadProblems = async () => {
      try {
        const res = await apiClient.get<TrainingProblem[]>(`/api/trainings/${trainingId}/problems`)
        if (res.success && res.data) {
          setProblems(res.data)
          if (res.data.length > 0 && !selectedProblemId) {
            setSelectedProblemId(res.data[0].id)
          }
        }
      } catch (error) {
        console.error('Failed to load problems:', error)
      } finally {
        setLoading(false)
      }
    }
    loadProblems()
  }, [training])

  useEffect(() => {
    if (!selectedProblemId) return
    const loadDetail = async () => {
      try {
        const res = await apiClient.get<ProblemDetail>(`/api/trainings/${trainingId}/problems/${selectedProblemId}/detail`)
        if (res.success && res.data) {
          setProblemDetail(res.data)
          // 恢复用户之前的题面版本偏好
          const visibleStatements = (res.data.statements || []).filter(s => true)
          if (visibleStatements.length > 0) {
            const savedKey = localStorage.getItem(`training-stmt-pref-${selectedProblemId}`)
            const savedStmt = savedKey
              ? visibleStatements.find(s => `${s.format}-${s.language || 'unknown'}` === savedKey)
              : null
            if (savedStmt) {
              setSelectedStatementId(savedStmt.id)
            } else {
              // 默认选择中文 markdown 版本
              const zhStatement = visibleStatements.find(s => s.format === 'markdown' && s.language === 'zh')
              setSelectedStatementId(zhStatement?.id || visibleStatements[0].id)
            }
          } else {
            setSelectedStatementId(null)
          }
        }
      } catch (error) {
        console.error('Failed to load problem detail:', error)
      }
    }
    loadDetail()
    setShowNotePanel(false)
  }, [selectedProblemId, trainingId])

  // Load note
  useEffect(() => {
    if (!selectedProblemId || !training) return
    const loadNote = async () => {
      try {
        const res = await apiClient.get<{ content: string }>(`/api/trainings/${trainingId}/problems/${selectedProblemId}/note`)
        if (res.success && res.data) {
          setNoteContent(res.data.content || '')
        }
      } catch (error) {
        console.error('Failed to load note:', error)
      }
    }
    loadNote()
  }, [selectedProblemId, trainingId])

  // Auto-save note
  useEffect(() => {
    if (!selectedProblemId || !showNotePanel) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        setNoteSaving(true)
        await apiClient.put(`/api/trainings/${trainingId}/problems/${selectedProblemId}/note`, { content: noteContent })
      } catch (error) {
        console.error('Failed to save note:', error)
      } finally {
        setNoteSaving(false)
      }
    }, 2000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [noteContent, selectedProblemId, trainingId, showNotePanel])

  // Load submissions when tab changes, clear on leave
  useEffect(() => {
    if (activeTab !== 'submissions') {
      setSubmissions([])
      setSubmissionsTotal(0)
      return
    }
    const loadSubmissions = async () => {
      try {
        const params = new URLSearchParams()
        params.set('page', String(submissionsPage))
        params.set('pageSize', '50')
        if (filterProblemId) params.set('problemId', filterProblemId)
        if (filterUsername) params.set('username', filterUsername)
        if (filterResult) params.set('result', filterResult)
        if (filterLanguage) params.set('language', filterLanguage)
        const res = await apiClient.get<{ submissions: SubmissionRow[]; page: number; totalPages: number; total: number }>(
          `/api/trainings/${trainingId}/submissions?${params.toString()}`
        )
        if (res.success && res.data) {
          setSubmissions(res.data.submissions)
          setSubmissionsTotal(res.data.total)
        }
      } catch (error) {
        console.error('Failed to load submissions:', error)
      }
    }
    loadSubmissions()
  }, [activeTab, trainingId, submissionsPage, filterProblemId, filterUsername, filterResult, filterLanguage])

  // Load all solutions when tab changes, clear on leave
  useEffect(() => {
    if (activeTab !== 'solutions') {
      setAllSolutions({})
      return
    }
    if (problems.length === 0) return
    const loadAllSolutions = async () => {
      const solutions: Record<string, { content: string; visible: boolean; source?: 'training' | 'problem'; solutionType?: string; solutionPdfUrl?: string }> = {}
      await Promise.all(problems.map(async (p) => {
        try {
          const res = await apiClient.get<{ id: string | null; content: string; visible: boolean; source?: 'training' | 'problem'; solutionType?: string; solutionPdfUrl?: string } | null>(`/api/trainings/${trainingId}/problems/${p.id}/solution`)
          if (res.success && res.data) {
            solutions[p.id] = {
              content: res.data.content || '',
              visible: res.data.visible ?? false,
              source: res.data.source,
              solutionType: res.data.solutionType,
              solutionPdfUrl: res.data.solutionPdfUrl,
            }
          }
        } catch (error) {
          console.error('Failed to load solution for', p.id, error)
        }
      }))
      setAllSolutions(solutions)
    }
    loadAllSolutions()
  }, [activeTab, trainingId, problems])

  // Load all attachments when tab changes, clear on leave
  useEffect(() => {
    if (activeTab !== 'attachments') {
      setAllAttachments({})
      return
    }
    if (problems.length === 0) return
    const loadAllAttachments = async () => {
      const attachments: Record<string, Attachment[]> = {}
      await Promise.all(problems.map(async (p) => {
        try {
          const res = await apiClient.get<Attachment[]>(`/api/trainings/${trainingId}/problems/${p.id}/attachments`)
          if (res.success && res.data) {
            attachments[p.id] = res.data
          }
        } catch (error) {
          console.error('Failed to load attachments for', p.id, error)
        }
      }))
      setAllAttachments(attachments)
    }
    loadAllAttachments()
  }, [activeTab, trainingId, problems])

  // Load ranking when tab changes, clear on leave
  useEffect(() => {
    if (activeTab !== 'ranking') {
      setRankingData(null)
      return
    }
    const loadRanking = async () => {
      try {
        const res = await apiClient.get<any>(`/api/trainings/${trainingId}/ranking`)
        if (res.success && res.data) {
          setRankingData(res.data)
        }
      } catch (error) {
        console.error('Failed to load ranking:', error)
      }
    }
    loadRanking()
  }, [activeTab, trainingId])

  // Load problem list when tab changes, clear on leave
  useEffect(() => {
    if (activeTab !== 'problemList') {
      setProblemListData([])
      return
    }
    const loadProblemList = async () => {
      try {
        const res = await apiClient.get<{ problems: ProblemListEntry[] }>(`/api/trainings/${trainingId}/problem-status`)
        if (res.success && res.data) {
          setProblemListData(res.data.problems)
        }
      } catch (error) {
        console.error('Failed to load problem list:', error)
      }
    }
    loadProblemList()
  }, [activeTab, trainingId])

  // Countdown timer
  useEffect(() => {
    if (!training) return
    const update = () => {
      const now = new Date()
      const start = new Date(training.startTime)
      const end = new Date(training.endTime)
      if (now < start) {
        const diff = start.getTime() - now.getTime()
        const h = Math.floor(diff / 3600000)
        const m = Math.floor((diff % 3600000) / 60000)
        const s = Math.floor((diff % 60000) / 1000)
        setTimeDisplay(`距离开始: ${h}h ${m}m ${s}s`)
      } else if (now <= end) {
        const diff = end.getTime() - now.getTime()
        const h = Math.floor(diff / 3600000)
        const m = Math.floor((diff % 3600000) / 60000)
        const s = Math.floor((diff % 60000) / 1000)
        setTimeDisplay(`剩余: ${h}h ${m}m ${s}s`)
      } else {
        setTimeDisplay('已结束')
      }
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [training])

  // ========== Actions ==========

  const handleSubmitCode = async () => {
    if (!selectedProblemId || !submitCode.trim()) {
      toast.error('请输入代码')
      return
    }
    if (submitMethod !== 'robot') {
      toast.error('暂未开放此提交方式')
      return
    }
    setSubmitting(true)
    try {
      const res = await apiClient.post<{ submissionId?: number }>(`/api/trainings/${trainingId}/submit`, {
        trainingProblemId: selectedProblemId,
        language: submitLanguage,
        code: submitCode,
        submitMethod,
      })
      if (res.success) {
        toast.success('提交成功')
        setSubmitCode('')
        setShowSubmitModal(false)
        if (activeTab === 'submissions') {
          setSubmissionsPage(1)
        }
        // 打开提交详情
        if (res.data?.submissionId) {
          setDetailSubmissionId(res.data.submissionId)
        }
      } else {
        toast.error(res.message || '提交失败')
      }
    } catch (error) {
      toast.error('提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleViewSubmission = (submissionId: number) => {
    setDetailSubmissionId(submissionId)
  }

  const handleDownloadAttachment = async (attachment: Attachment) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}${attachment.fileUrl}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
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
    } catch (error) {
      toast.error('下载失败')
    }
  }

  const handleDelete = async () => {
    if (!training) return
    setDeleting(true)
    try {
      const res = await apiClient.delete(`/api/trainings/${training.id}`)
      if (res.success) {
        toast.success('训练已删除')
        router.push(`${basePath}/${teamId}?tab=training`)
      } else {
        toast.error(res.message || '删除失败')
      }
    } catch {
      toast.error('删除失败')
    } finally {
      setDeleting(false)
    }
  }

  // ========== Render ==========

  if (loading || !training) {
    return <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>加载中...</div>
  }

  const formatLabel = training.format === 'icpc' ? 'ICPC' : 'IOI'
  const statusColors: Record<string, { bg: string; color: string }> = {
    upcoming: { bg: 'var(--info-light)', color: 'var(--info-text)' },
    ongoing: { bg: 'var(--success-light)', color: 'var(--success-text)' },
    finished: { bg: 'var(--bg-muted)', color: 'var(--text-secondary)' },
  }
  const sc = statusColors[training.status] || statusColors.upcoming
  const selectedProblem = problems.find(p => p.id === selectedProblemId)
  const isOngoing = training.status === 'ongoing'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: 'white', borderBottom: '1px solid var(--border)', padding: '0.75rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={() => router.push(`${basePath}/${teamId}?tab=training`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>← 返回</button>
            <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{training.title}</h1>
            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', background: 'var(--bg-muted)' }}>{formatLabel}</span>
            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', background: sc.bg, color: sc.color }}>
              {training.status === 'upcoming' ? '未开始' : training.status === 'ongoing' ? '进行中' : '已结束'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 500, fontFamily: 'monospace', color: training.status === 'ongoing' ? 'var(--primary)' : 'var(--gray-500)' }}>
              {timeDisplay}
            </div>
            {training.isAdmin && (
              <>
                <button
                  onClick={() => setShowEditModal(true)}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid var(--border)',
                    background: 'white',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid var(--error)',
                    background: 'white',
                    color: 'var(--error)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  删除
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Announcement */}
      {training.description && (
        <div style={{ background: 'var(--warning-light)', borderBottom: '1px solid #fde68a', padding: '0.5rem 1.5rem', fontSize: '0.8rem', color: 'var(--warning-text)' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <strong>公告：</strong>{training.description}
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ background: 'white', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', gap: 0 }}>
          {(['problemList', 'problems', 'submissions', 'solutions', 'attachments', 'ranking'] as TabType[]).map(tab => {
            const labels: Record<TabType, string> = {
              problemList: '题目列表',
              problems: '题面',
              submissions: '评测记录',
              solutions: '题解',
              attachments: '附件',
              ranking: '排名'
            }
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '0.6rem 1.25rem',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                  background: 'none',
                  color: isActive ? 'var(--primary)' : 'var(--gray-500)',
                  fontWeight: isActive ? 600 : 400,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                {labels[tab]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '1rem', boxSizing: 'border-box' }}>
        {/* ====== Problem List Tab ====== */}
        {activeTab === 'problemList' && (() => {
          // 判断是否应该隐藏来源列
          const trainingFinished = training.status === 'finished' || new Date() > new Date(training.endTime)
          const hideSourceColumn = !training.problemIdVisible && !trainingFinished && !training.isAdmin

          return (
          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', width: '80px' }}>状态</th>
                  <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', width: '60px' }}>题号</th>
                  {!hideSourceColumn && <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', width: '180px' }}>来源</th>}
                  <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)' }}>标题</th>
                </tr>
              </thead>
              <tbody>
                {problemListData.length === 0 && (
                  <tr>
                    <td colSpan={hideSourceColumn ? 3 : 4} style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-400)' }}>暂无题目</td>
                  </tr>
                )}
                {problemListData.map(p => {
                  const isAccepted = p.bestResult === 'accepted'
                  const hasSubmission = p.bestResult != null
                  const maxPoints = p.points ?? 100

                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      {/* 状态列 */}
                      <td style={{ padding: '0.6rem 1rem' }}>
                        {training.format === 'icpc' ? (
                          // ICPC: 紧凑缩写 Badge
                          hasSubmission ? (
                            <span style={{
                              display: 'inline-block',
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              fontFamily: 'monospace',
                              background: isAccepted ? 'var(--success-light)' : 'var(--error-light)',
                              color: isAccepted ? 'var(--success-text)' : 'var(--error-text)',
                            }}>
                              {RESULT_SHORT_MAP[p.bestResult!] || p.bestResult}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                          )
                        ) : (
                          // IOI: 分数显示
                          hasSubmission ? (
                            <span style={{ fontWeight: 600, color: getScoreColor(p.bestScore ?? 0, maxPoints) }}>
                              {isAccepted ? '✓ ' : ''}{p.bestScore}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                          )
                        )}
                      </td>

                      {/* 序号列 */}
                      <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontWeight: 500 }}>
                        {toExcelColumnName(p.orderIndex)}
                      </td>

                      {/* 来源列 - 仅当允许显示时渲染 */}
                      {!hideSourceColumn && (
                      <td style={{ padding: '0.6rem 1rem' }}>
                        {(() => {
                          // 显示题号
                          if (p.platform === 'carits') {
                            return (
                              <a
                                href={`${basePath.split('/team')[0]}/problems/${p.problemTableId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--primary)', textDecoration: 'none' }}
                              >
                                Carits {p.platformProblemId}
                              </a>
                            )
                          } else if (p.platform && p.problemUrl) {
                            return (
                              <a
                                href={p.problemUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--primary)', textDecoration: 'none' }}
                              >
                                {p.platformLabel} {p.platformProblemId}
                              </a>
                            )
                          } else if (p.platform) {
                            return <span style={{ color: 'var(--text-secondary)' }}>{p.platformLabel} {p.platformProblemId}</span>
                          } else {
                            return <span style={{ color: 'var(--gray-400)' }}>-</span>
                          }
                        })()}
                      </td>
                      )}

                      {/* 标题列 */}
                      <td style={{ padding: '0.6rem 1rem' }}>
                        <span
                          onClick={() => {
                            setSelectedProblemId(p.id)
                            setActiveTab('problems')
                          }}
                          style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'none' }}
                        >
                          {p.alias || '未命名'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )})()}

        {/* ====== Problems Tab ====== */}
        {activeTab === 'problems' && (
          <div style={{ display: 'flex', gap: '1rem' }}>
            {/* 左侧：题目按钮 */}
            <div style={{ width: '200px', flexShrink: 0 }}>
              <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {problems.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProblemId(p.id)}
                      style={{
                        padding: '0.3rem 0.5rem',
                        border: '1px solid',
                        borderColor: selectedProblemId === p.id ? 'var(--primary)' : 'var(--border)',
                        background: selectedProblemId === p.id ? 'var(--primary)' : 'white',
                        color: selectedProblemId === p.id ? 'white' : 'var(--gray-700)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        minWidth: '28px',
                      }}
                    >
                      {/* 显示自动生成的字母序号（A, B, ..., Z, AA, AB, ...） */}
                      {toExcelColumnName(p.orderIndex)}
                    </button>
                  ))}
                  {problems.length === 0 && (
                    <div style={{ color: 'var(--gray-400)', fontSize: '0.85rem' }}>暂无题目</div>
                  )}
                </div>
              </div>
            </div>

            {/* 中间：题面内容 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                {problemDetail ? (
                  <>
                    {/* Problem Header */}
                    <div style={{ padding: '0.5rem 1rem', background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--gray-800)' }}>{problemDetail.alias || problemDetail.problemTitle || '未命名'}</span>
                      {problemDetail.points != null && <span>分值: {problemDetail.points}</span>}
                      {problemDetail.timeLimit && <span>时间: {problemDetail.timeLimit}s</span>}
                      {problemDetail.memoryLimit && <span>内存: {problemDetail.memoryLimit}MB</span>}
                      {problemDetail.difficulty && (
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', background: problemDetail.difficulty === '简单' ? 'var(--success-light)' : problemDetail.difficulty === '中等' ? 'var(--warning-light)' : 'var(--error-light)', color: problemDetail.difficulty === '简单' ? 'var(--success-text)' : problemDetail.difficulty === '中等' ? 'var(--warning-text)' : 'var(--error-text)' }}>
                          {problemDetail.difficulty}
                        </span>
                      )}
                      {training.isAdmin && problemDetail.problemTitle && (
                        <>
                          <div style={{ width: '1px', height: '12px', background: 'var(--border)' }} />
                          <span style={{ color: 'var(--primary)' }}>{problemDetail.platformProblemId}</span>
                          <span>{problemDetail.problemTitle}</span>
                          <span style={{ color: 'var(--gray-400)' }}>({problemDetail.platform})</span>
                        </>
                      )}
                    </div>
                    {/* Statement Version Selector */}
                    {(() => {
                      const visibleStatements = (problemDetail.statements || []).filter(s => true)
                      return visibleStatements.length > 1 && (
                        <div style={{
                          padding: '0.5rem 1rem',
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
                              // 持久化用户选择
                              if (selectedProblemId) {
                                const stmt = visibleStatements.find(s => s.id === id)
                                if (stmt) {
                                  localStorage.setItem(`training-stmt-pref-${selectedProblemId}`, `${stmt.format}-${stmt.language || 'unknown'}`)
                                }
                              }
                            }}
                            style={{
                              padding: '0.25rem 0.5rem',
                              border: '1px solid var(--border)',
                              borderRadius: '4px',
                              fontSize: '0.8rem',
                              background: 'white'
                            }}
                          >
                            {visibleStatements.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.format === 'pdf' ? 'PDF' : `${s.language ? STATEMENT_LANGUAGE_LABELS[s.language] || s.language : '未知'}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      )
                    })()}
                    {/* Statement Content */}
                    <div style={{ padding: '1.5rem' }}>
                      {(() => {
                        const visibleStatements = (problemDetail.statements || []).filter(s => true)
                        if (visibleStatements.length === 0 && problemDetail.description) {
                          return <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}><MarkdownRenderer content={problemDetail.description} /></div>
                        }
                        // 获取当前选中的题面
                        const currentStatement = selectedStatementId
                          ? visibleStatements.find(s => s.id === selectedStatementId)
                          : visibleStatements.find(s => s.format === 'markdown' && s.language === 'zh')
                            || visibleStatements.find(s => s.format === 'markdown')
                            || visibleStatements[0]
                        if (!currentStatement) {
                          return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>暂无题面</div>
                        }
                        // PDF 题面
                        if (currentStatement.format === 'pdf' && currentStatement.fileUrl) {
                          const pdfUrl = getPdfUrl(currentStatement.fileUrl)
                          if (pdfUrl && pdfUrl.startsWith('/')) {
                            return <iframe src={pdfUrl} style={{ width: '100%', height: '600px', border: 'none' }} />
                          }
                          return (
                            <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>题面为外部 PDF 文件，请在新窗口中查看</p>
                              <a
                                href={currentStatement.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-block',
                                  padding: '0.5rem 1.5rem',
                                  backgroundColor: 'var(--primary)',
                                  color: 'var(--text-inverse)',
                                  borderRadius: '6px',
                                  textDecoration: 'none',
                                  fontSize: '0.875rem',
                                }}
                              >
                                打开 PDF 题面
                              </a>
                            </div>
                          )
                        }
                        // Markdown 题面
                        if (currentStatement.content) {
                          return <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}><MarkdownRenderer content={currentStatement.content} /></div>
                        }
                        return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>暂无题面</div>
                      })()}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-400)' }}>
                    {problems.length > 0 ? '请选择左侧题目查看' : '暂无题目'}
                  </div>
                )}
              </div>

              {/* 思路面板 */}
              {showNotePanel && (
                <div style={{ marginTop: '1rem', background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>思路记录</span>
                    {noteSaving && <span style={{ color: 'var(--warning-text)', fontSize: '0.7rem' }}>保存中...</span>}
                  </div>
                  <textarea
                    value={noteContent}
                    onChange={e => setNoteContent(e.target.value)}
                    placeholder="在这里记录你的解题思路..."
                    rows={8}
                    style={{
                      width: '100%', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '6px',
                      fontSize: '0.85rem', fontFamily: 'Consolas, Monaco, monospace', lineHeight: 1.5,
                      resize: 'vertical', boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}
            </div>

            {/* 右侧：操作按钮 */}
            <div style={{ width: '150px', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {/* 写思路 */}
                <button
                  onClick={() => setShowNotePanel(!showNotePanel)}
                  style={{
                    padding: '0.6rem 1rem',
                    background: showNotePanel ? 'var(--bg-hover)' : 'var(--primary)',
                    color: showNotePanel ? 'var(--text-secondary)' : 'white',
                    border: showNotePanel ? '1px solid var(--border)' : 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    width: '100%',
                  }}
                >
                  ✏️ {showNotePanel ? '关闭思路' : '写思路'}
                </button>
                {/* 提交代码 */}
                <button
                  onClick={() => setShowSubmitModal(true)}
                  style={{
                    padding: '0.6rem 1rem',
                    background: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: isOngoing && (selectedProblem?.platform === 'carits' || selectedProblem?.platform === 'hdu') ? 'pointer' : 'not-allowed',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    width: '100%',
                    opacity: isOngoing && (selectedProblem?.platform === 'carits' || selectedProblem?.platform === 'hdu') ? 1 : 0.5,
                  }}
                  disabled={!isOngoing || (selectedProblem?.platform !== 'carits' && selectedProblem?.platform !== 'hdu')}
                >
                  ▶ 提交代码
                </button>
                {!isOngoing && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', textAlign: 'center' }}>
                    训练未开始
                  </div>
                )}
                {/* 附件 */}
                {(selectedProblem?.attachmentCount ?? 0) > 0 && (
                  <button
                    onClick={() => setActiveTab('attachments')}
                    style={{
                      padding: '0.6rem 1rem',
                      background: 'white',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      width: '100%',
                    }}
                  >
                    📎 附件 ({selectedProblem?.attachmentCount ?? 0})
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ====== Submissions Tab ====== */}
        {activeTab === 'submissions' && (
          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
            {/* 筛选栏 */}
            <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>题号:</label>
                <select
                  value={filterProblemId}
                  onChange={e => { setFilterProblemId(e.target.value); setSubmissionsPage(1) }}
                  style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minWidth: '80px', background: 'white' }}
                >
                  <option value="">全部</option>
                  {problems.map(p => <option key={p.id} value={p.id}>{toExcelColumnName(p.orderIndex)}</option>)}
                </select>
              </div>
              {training.isAdmin && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>用户名:</label>
                  <input
                    type="text"
                    value={filterUsername}
                    onChange={e => { setFilterUsername(e.target.value); setSubmissionsPage(1) }}
                    placeholder="输入用户名"
                    style={{ padding: '0.35rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', width: '120px' }}
                  />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>结果:</label>
                <select
                  value={filterResult}
                  onChange={e => { setFilterResult(e.target.value); setSubmissionsPage(1) }}
                  style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minWidth: '100px', background: 'white' }}
                >
                  <option value="">全部</option>
                  <option value="accepted">Accepted</option>
                  <option value="wa">Wrong Answer</option>
                  <option value="tle">Time Limit</option>
                  <option value="mle">Memory Limit</option>
                  <option value="re">Runtime Error</option>
                  <option value="ce">Compile Error</option>
                  <option value="pe">Presentation Error</option>
                  <option value="ole">Output Limit</option>
                  <option value="pending">Pending</option>
                  <option value="judging">Judging</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>语言:</label>
                <select
                  value={filterLanguage}
                  onChange={e => { setFilterLanguage(e.target.value); setSubmissionsPage(1) }}
                  style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minWidth: '100px', background: 'white' }}
                >
                  <option value="">全部</option>
                  <option value="c">C</option>
                  <option value="cpp">C++</option>
                  <option value="cpp14">C++14</option>
                  <option value="cpp17">C++17</option>
                  <option value="cpp20">C++20</option>
                  <option value="java">Java</option>
                  <option value="python">Python</option>
                  <option value="python3">Python3</option>
                  <option value="pascal">Pascal</option>
                  <option value="go">Go</option>
                  <option value="rust">Rust</option>
                </select>
              </div>
              <button
                onClick={() => { setFilterProblemId(''); setFilterUsername(''); setFilterResult(''); setFilterLanguage(''); setSubmissionsPage(1) }}
                style={{ padding: '0.35rem 0.75rem', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                重置
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>评测ID</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>题号</th>
                  {training.isAdmin && (
                    <>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>姓名</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>用户名</th>
                    </>
                  )}
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>OJ</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>评测结果</th>
                  {training.format === 'ioi' && <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>分数</th>}
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>耗时(MS)</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>内存(MB)</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>代码长度(B)</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>语言</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {submissions.length === 0 ? (
                  <tr>
                    <td colSpan={9 + (training.isAdmin ? 2 : 0) + (training.format === 'ioi' ? 1 : 0)} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      暂无评测记录
                    </td>
                  </tr>
                ) : (
                  submissions.map(s => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td
                        onClick={() => handleViewSubmission(s.id)}
                        style={{ padding: '0.75rem 1rem', color: 'var(--primary)', fontFamily: 'monospace', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        #{s.id}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', fontWeight: 500 }}>{toExcelColumnName(s.problemOrderIndex)}</td>
                      {training.isAdmin && (
                        <>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.userName}</td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{s.username}</td>
                        </>
                      )}
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{getOjLabel(s.oj)}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>{getResultBadge(s.result)}</td>
                      {training.format === 'ioi' && <td style={{ padding: '0.75rem 1rem', textAlign: 'center', color: 'var(--text-primary)' }}>{s.score ?? '-'}</td>}
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.timeUsed ?? '-'}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.memoryUsed != null ? (s.memoryUsed / 1024).toFixed(2) : '-'}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.codeLength ?? '-'}</td>
                      <td
                        onClick={() => setDetailSubmissionId(s.id)}
                        style={{ padding: '0.75rem 1rem', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {formatLanguage(s.language)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(s.createdAt).toLocaleString('zh-CN')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {submissionsTotal > 50 && (
              <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                <Button variant="secondary" disabled={submissionsPage <= 1} onClick={() => setSubmissionsPage(p => p - 1)}>上一页</Button>
                <span style={{ lineHeight: '2.2rem', fontSize: '0.85rem', color: 'var(--gray-500)' }}>
                  {submissionsPage} / {Math.ceil(submissionsTotal / 50)}
                </span>
                <Button variant="secondary" disabled={submissionsPage >= Math.ceil(submissionsTotal / 50)} onClick={() => setSubmissionsPage(p => p + 1)}>下一页</Button>
              </div>
            )}
          </div>
        )}

        {/* ====== Solutions Tab ====== */}
        {activeTab === 'solutions' && (
          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1rem' }}>
            {(() => {
              const trainingFinished = training.status === 'finished' || new Date() > new Date(training.endTime)
              const hideSolution = !training.solutionVisible && !trainingFinished && !training.isAdmin

              if (hideSolution) {
                return (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    题解将在比赛结束后显示
                  </div>
                )
              }

              return problems.map(p => {
                const sol = allSolutions[p.id]
                const hasPdfSolution = sol?.solutionType === 'pdf' && sol?.solutionPdfUrl
                const hasContent = sol?.content || hasPdfSolution
                if (!hasContent) return null  // 只显示有题解的题目
                return (
                  <div key={p.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{toExcelColumnName(p.orderIndex)}. {p.alias || p.problemTitle || '未命名'}</span>
                      {sol?.source === 'problem' && (
                        <span style={{ fontSize: '0.75rem', background: 'var(--bg-hover)', padding: '0.15rem 0.4rem', borderRadius: '4px', color: 'var(--gray-500)' }}>
                          原题目题解
                        </span>
                      )}
                    </div>
                    <div>
                      {hasPdfSolution ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <a
                            href={sol!.solutionPdfUrl!}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          >
                            <span>📄</span>
                            <span>查看 PDF 题解</span>
                          </a>
                        </div>
                      ) : sol?.content ? (
                        <div style={{ fontSize: '0.85rem', lineHeight: 1.6 }}><MarkdownRenderer content={sol.content} /></div>
                      ) : null}
                    </div>
                  </div>
                )
              })
            })()}
            {(() => {
              const trainingFinished = training.status === 'finished' || new Date() > new Date(training.endTime)
              const hideSolution = !training.solutionVisible && !trainingFinished && !training.isAdmin
              if (hideSolution) return null

              return problems.every(p => {
                const sol = allSolutions[p.id]
                const hasPdfSolution = sol?.solutionType === 'pdf' && sol?.solutionPdfUrl
                return !sol?.content && !hasPdfSolution
              }) && (
                <div style={{ textAlign: 'center', color: 'var(--gray-400)' }}>暂无题解</div>
              )
            })()}
          </div>
        )}

        {/* ====== Attachments Tab ====== */}
        {activeTab === 'attachments' && (
          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1rem' }}>
            {problems.map(p => {
              const atts = allAttachments[p.id] || []
              if (atts.length === 0) return null
              return (
                <div key={p.id} style={{ marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--primary)', marginBottom: '0.5rem' }}>{toExcelColumnName(p.orderIndex)}. {p.alias || p.problemTitle || '未命名'}</div>
                  {atts.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1rem' }}>📎</span>
                        <span>{a.fileName}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>{formatFileSize(a.fileSize)}</span>
                      </div>
                      <button
                        onClick={() => handleDownloadAttachment(a)}
                        style={{ padding: '0.25rem 0.5rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        下载
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}
            {Object.keys(allAttachments).length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--gray-400)' }}>暂无附件</div>
            )}
          </div>
        )}

        {/* ====== Ranking Tab ====== */}
        {activeTab === 'ranking' && rankingData && (
          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: 'var(--bg-muted)' }}>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '50px' }}>#</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '120px' }}>姓名</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '100px' }}>用户名</th>
                  {rankingData.format === 'ioi' ? (
                    <>
                      <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '70px' }}>总分</th>
                      {rankingData.problems.map((p: any) => (
                        <th key={p.id} style={{ padding: '0.6rem 0.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)' }}>{toExcelColumnName(p.orderIndex ?? 0)}</th>
                      ))}
                    </>
                  ) : (
                    <>
                      <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '50px' }}>通过</th>
                      <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '70px' }}>罚时</th>
                      {rankingData.problems.map((p: any) => (
                        <th key={p.id} style={{ padding: '0.6rem 0.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)' }}>{toExcelColumnName(p.orderIndex ?? 0)}</th>
                      ))}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rankingData.ranking.map((row: any, idx: number) => {
                  const isCurrentUser = row.userId === user?.userId
                  return (
                  <tr key={row.userId} style={{ borderBottom: '1px solid #f1f5f9', background: isCurrentUser ? 'var(--info-light)' : 'transparent' }}>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700, color: idx < 3 ? RANK_MEDAL_COLORS[idx] : 'var(--text-secondary)' }}>
                      {idx + 1}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>{row.name}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{row.username}</td>
                    {rankingData.format === 'ioi' ? (
                      <>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700, fontSize: '0.95rem', color: 'var(--success)' }}>{row.totalScore}</td>
                        {rankingData.problems.map((p: any) => {
                          const pd = row.problems[p.id]
                          const maxPts = p.points ?? 100
                          const score = pd?.score ?? 0
                          const isFull = score >= maxPts
                          return (
                            <td key={p.id} style={{ padding: '0.5rem 0.5rem', textAlign: 'center', fontWeight: isFull ? 600 : 400, color: score > 0 ? getScoreColor(score, maxPts) : 'var(--border-hover)' }}>
                              {score}
                            </td>
                          )
                        })}
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700, color: 'var(--success)' }}>{row.solvedCount}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{row.totalPenalty}</td>
                        {rankingData.problems.map((p: any) => {
                          const pd = row.problems[p.id]
                          return (
                            <td key={p.id} style={{ padding: '0.5rem 0.5rem', textAlign: 'center' }}>
                              {pd?.solved ? (
                                <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                                  +{pd.attempts > 1 ? <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-secondary)' }}>({pd.attempts - 1})</span> : ''}
                                </span>
                              ) : pd?.attempts > 0 ? (
                                <span style={{ color: 'var(--error)', fontWeight: 500 }}>-{pd.attempts}</span>
                              ) : (
                                <span style={{ color: 'var(--border-hover)' }}>-</span>
                              )}
                            </td>
                          )
                        })}
                      </>
                    )}
                  </tr>
                )
                })}
                {rankingData.ranking.length === 0 && (
                  <tr>
                    <td colSpan={20} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>暂无排名数据</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {activeTab === 'ranking' && !rankingData && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-400)' }}>加载中...</div>
        )}
      </div>

      {/* ====== Submission Detail Modal ====== */}
      {/* 提交详情弹窗 */}
      <SubmissionDetailModal
        isOpen={detailSubmissionId !== null}
        onClose={() => setDetailSubmissionId(null)}
        submissionId={detailSubmissionId}
        viewRole={basePath.startsWith('/student') ? 'student' : basePath.startsWith('/platform-admin') ? 'admin' : 'teacher'}
        trainingId={parseInt(trainingId)}
        trainingFormat={training.format}
      />

      {/* ====== Submit Code Modal ====== */}
      {showSubmitModal && isOngoing && (
        <Modal
          isOpen={true}
          onClose={() => setShowSubmitModal(false)}
          title={(() => {
            const trainingFinished = training.status === 'finished' || new Date() > new Date(training.endTime)
            const hideProblemId = !training.problemIdVisible && !trainingFinished && !training.isAdmin
            const platformPrefix = selectedProblem?.platform ? (OJ_PLATFORM_LABEL_MAP[selectedProblem.platform] || selectedProblem.platform) + ' ' : ''
            const problemIdPart = hideProblemId ? '' : (selectedProblem?.platformProblemId || '')
            return `${platformPrefix}${problemIdPart} - ${selectedProblem?.alias || selectedProblem?.problemTitle || ''}`
          })()}
          width="700px"
        >
          {/* 非 Carits 平台：提交方式选择 */}
          {selectedProblem?.platform && selectedProblem.platform !== 'carits' && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              {([
                { key: 'robot' as const, label: '机器人账号' },
                { key: 'myAccount' as const, label: '我的账号' },
                { key: 'archive' as const, label: '归档' },
              ]).map(m => (
                <button
                  key={m.key}
                  onClick={() => setSubmitMethod(m.key)}
                  style={{
                    padding: '0.5rem 1rem',
                    fontSize: '0.875rem',
                    border: '1px solid',
                    borderColor: submitMethod === m.key ? 'var(--primary)' : 'var(--border)',
                    borderRadius: '6px',
                    background: submitMethod === m.key ? 'var(--info-light)' : 'white',
                    color: submitMethod === m.key ? 'var(--primary)' : 'var(--gray-500)',
                    cursor: 'pointer',
                    fontWeight: submitMethod === m.key ? 600 : 400,
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {/* 我的账号/归档时显示平台账号绑定提示 */}
          {selectedProblem?.platform && selectedProblem.platform !== 'carits' && (submitMethod === 'myAccount' || submitMethod === 'archive') && (
            <div style={{
              fontSize: '0.875rem',
              color: 'var(--gray-500)',
              padding: '0.5rem 0.75rem',
              background: 'var(--gray-50)',
              borderRadius: '6px',
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>平台账号</span>
              <span style={{ color: 'var(--warning)' }}>未绑定</span>
            </div>
          )}

          {/* 语言选择 */}
          <div style={{ marginBottom: '1rem' }}>
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

          {/* 代码输入框 */}
          <textarea
            placeholder="在此输入代码..."
            value={submitCode}
            onChange={e => setSubmitCode(e.target.value)}
            style={{
              width: '100%',
              minHeight: '350px',
              padding: '1rem',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
              lineHeight: 1.5,
              resize: 'vertical',
              boxSizing: 'border-box',
              background: submitMethod === 'robot' ? 'white' : 'var(--bg-muted)',
              color: submitMethod === 'robot' ? 'var(--text-primary)' : 'var(--gray-400)',
            }}
            disabled={submitMethod !== 'robot'}
          />

          {/* 提交按钮 */}
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--gray-400)' }}>
              {selectedProblem?.platform === 'carits'
                ? '本地评测'
                : submitMethod === 'robot'
                  ? `${OJ_PLATFORM_LABEL_MAP[selectedProblem?.platform || ''] || ''} 机器人提交已启用`
                  : '暂未开放此提交方式'}
            </span>
            <button
              onClick={handleSubmitCode}
              disabled={submitting || !submitCode.trim() || submitMethod !== 'robot'}
              style={{
                padding: '0.625rem 2rem',
                background: (submitting || !submitCode.trim() || submitMethod !== 'robot') ? 'var(--gray-300)' : 'var(--primary)',
                color: (submitting || !submitCode.trim() || submitMethod !== 'robot') ? 'var(--gray-500)' : 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: (submitting || !submitCode.trim() || submitMethod !== 'robot') ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? '提交中...' : '提交'}
            </button>
          </div>
        </Modal>
      )}

      <TrainingFormModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        teamId={teamId}
        trainingId={trainingId}
        onSaved={() => {
          setShowEditModal(false)
          loadTraining()
        }}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="删除训练"
        message={`确定要删除训练「${training.title}」吗？训练题目和题解将被删除，但已提交的评测记录会保留。`}
        confirmText="确认删除"
        danger
        loading={deleting}
      />
    </div>
  )
}