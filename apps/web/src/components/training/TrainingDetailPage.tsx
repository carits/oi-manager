'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { JUDGE_RESULT_LABEL_MAP, LANGUAGE_LABEL_MAP } from '@/lib/judge-constants'

// ========== Types ==========

interface TrainingInfo {
  id: string
  teamId: string
  title: string
  description: string | null
  format: string
  startTime: string
  endTime: string
  status: string
  createdBy: string
  problemCount: number
  isAdmin: boolean
}

interface TrainingProblem {
  id: string
  alias: string
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
  alias: string
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
  userType: string
  problemAlias: string
  trainingProblemId: string
  language: string
  result: string
  score: number | null
  timeUsed: number | null
  memoryUsed: number | null
  codeLength: number
  createdAt: string
}

interface SubmissionDetail {
  id: number
  userId: string
  userType: string
  problemAlias: string
  language: string
  result: string
  score: number | null
  timeUsed: number | null
  memoryUsed: number | null
  code: string | null
  codeLength: number
  cases: any[] | null
  subtasks: any[] | null
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

type TabType = 'problems' | 'submissions' | 'solutions' | 'attachments' | 'ranking'

interface TrainingDetailPageProps {
  basePath: string
}

// ========== Helpers ==========

function getResultColor(result: string): string {
  if (result === 'accepted') return '#16a34a'
  if (['wa', 'tle', 'mle', 're', 'ole'].includes(result)) return '#dc2626'
  if (result === 'ce') return '#d97706'
  if (result === 'pending_review') return '#8b5cf6'
  return '#6b7280'
}

function formatResult(result: string): string {
  return JUDGE_RESULT_LABEL_MAP[result] || result
}

function formatLanguage(lang: string): string {
  return LANGUAGE_LABEL_MAP[lang] || lang
}

function getScoreColor(score: number, max: number): string {
  const ratio = max > 0 ? score / max : 0
  if (ratio >= 1) return '#16a34a'
  if (ratio >= 0.5) return '#d97706'
  return '#dc2626'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ========== Component ==========

export function TrainingDetailPage({ basePath }: TrainingDetailPageProps) {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const trainingId = params.tid as string
  const teamId = params.id as string

  // Core state
  const [training, setTraining] = useState<TrainingInfo | null>(null)
  const [problems, setProblems] = useState<TrainingProblem[]>([])
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null)
  const [problemDetail, setProblemDetail] = useState<ProblemDetail | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('problems')
  const [loading, setLoading] = useState(true)

  // Note
  const [noteContent, setNoteContent] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [showNotePanel, setShowNotePanel] = useState(false)
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Code submit
  const [submitLanguage, setSubmitLanguage] = useState('cpp')
  const [submitCode, setSubmitCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showSubmitModal, setShowSubmitModal] = useState(false)

  // Submissions tab - 筛选
  const [filterProblemId, setFilterProblemId] = useState<string>('')
  const [filterUsername, setFilterUsername] = useState('')
  const [filterResult, setFilterResult] = useState<string>('')
  const [filterLanguage, setFilterLanguage] = useState<string>('')
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [submissionsPage, setSubmissionsPage] = useState(1)
  const [submissionsTotal, setSubmissionsTotal] = useState(0)
  const [submissionDetail, setSubmissionDetail] = useState<SubmissionDetail | null>(null)
  const [showSubmissionDetail, setShowSubmissionDetail] = useState(false)

  // Solutions tab - 所有题目的题解
  const [allSolutions, setAllSolutions] = useState<Record<string, { content: string; visible: boolean }>>({})
  const [editingSolutionId, setEditingSolutionId] = useState<string | null>(null)
  const [editingSolutionContent, setEditingSolutionContent] = useState('')
  const [editingSolutionVisible, setEditingSolutionVisible] = useState(false)

  // Attachments tab - 所有题目的附件
  const [allAttachments, setAllAttachments] = useState<Record<string, Attachment[]>>({})

  // Ranking tab
  const [rankingData, setRankingData] = useState<any>(null)

  // Countdown
  const [timeDisplay, setTimeDisplay] = useState('')

  // ========== Data loading ==========

  useEffect(() => {
    const loadTraining = async () => {
      try {
        const res = await apiClient.get<TrainingInfo>(`/api/trainings/${trainingId}`)
        if (res.success && res.data) {
          setTraining(res.data)
        } else {
          toast.error('训练不存在')
          router.back()
        }
      } catch (error) {
        toast.error('加载失败')
        router.back()
      }
    }
    loadTraining()
  }, [trainingId])

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

  // Load submissions when tab changes
  useEffect(() => {
    if (activeTab !== 'submissions') return
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

  // Load all solutions when tab changes
  useEffect(() => {
    if (activeTab !== 'solutions' || problems.length === 0) return
    const loadAllSolutions = async () => {
      const solutions: Record<string, { content: string; visible: boolean }> = {}
      for (const p of problems) {
        try {
          const res = await apiClient.get<{ id: string; content: string; visible: boolean } | null>(`/api/trainings/${trainingId}/problems/${p.id}/solution`)
          if (res.success && res.data) {
            solutions[p.id] = { content: res.data.content || '', visible: res.data.visible ?? false }
          }
        } catch (error) {
          console.error('Failed to load solution for', p.id, error)
        }
      }
      setAllSolutions(solutions)
    }
    loadAllSolutions()
  }, [activeTab, trainingId, problems])

  // Load all attachments when tab changes
  useEffect(() => {
    if (activeTab !== 'attachments' || problems.length === 0) return
    const loadAllAttachments = async () => {
      const attachments: Record<string, Attachment[]> = {}
      for (const p of problems) {
        try {
          const res = await apiClient.get<Attachment[]>(`/api/trainings/${trainingId}/problems/${p.id}/attachments`)
          if (res.success && res.data) {
            attachments[p.id] = res.data
          }
        } catch (error) {
          console.error('Failed to load attachments for', p.id, error)
        }
      }
      setAllAttachments(attachments)
    }
    loadAllAttachments()
  }, [activeTab, trainingId, problems])

  // Load ranking when tab changes
  useEffect(() => {
    if (activeTab !== 'ranking') return
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
    setSubmitting(true)
    try {
      const res = await apiClient.post(`/api/trainings/${trainingId}/submit`, {
        trainingProblemId: selectedProblemId,
        language: submitLanguage,
        code: submitCode,
      })
      if (res.success) {
        toast.success('提交成功')
        setSubmitCode('')
        setShowSubmitModal(false)
        if (activeTab === 'submissions') {
          setSubmissionsPage(1)
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

  const handleSaveSolution = async (problemId: string) => {
    try {
      const res = await apiClient.put(`/api/trainings/${trainingId}/problems/${problemId}/solution`, {
        content: editingSolutionContent,
        visible: editingSolutionVisible,
      })
      if (res.success) {
        toast.success('题解已保存')
        setAllSolutions(prev => ({ ...prev, [problemId]: { content: editingSolutionContent, visible: editingSolutionVisible } }))
        setEditingSolutionId(null)
      } else {
        toast.error(res.message || '保存失败')
      }
    } catch (error) {
      toast.error('保存失败')
    }
  }

  const handleViewSubmission = async (submissionId: number) => {
    try {
      const res = await apiClient.get<SubmissionDetail>(`/api/trainings/${trainingId}/submissions/${submissionId}`)
      if (res.success && res.data) {
        setSubmissionDetail(res.data)
        setShowSubmissionDetail(true)
      }
    } catch (error) {
      toast.error('加载失败')
    }
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

  // ========== Render ==========

  if (loading || !training) {
    return <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>加载中...</div>
  }

  const formatLabel = training.format === 'icpc' ? 'ICPC' : 'IOI'
  const statusColors: Record<string, { bg: string; color: string }> = {
    upcoming: { bg: '#dbeafe', color: '#1e40af' },
    ongoing: { bg: '#dcfce7', color: '#166534' },
    finished: { bg: '#f3f4f6', color: '#6b7280' },
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
            <button onClick={() => router.push(`${basePath}/${teamId}?tab=training`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-600)', fontSize: '0.875rem' }}>← 返回</button>
            <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{training.title}</h1>
            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: '#f3f4f6' }}>{formatLabel}</span>
            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: sc.bg, color: sc.color }}>
              {training.status === 'upcoming' ? '未开始' : training.status === 'ongoing' ? '进行中' : '已结束'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 500, fontFamily: 'monospace', color: training.status === 'ongoing' ? 'var(--primary)' : 'var(--gray-500)' }}>
              {timeDisplay}
            </div>
            {training.isAdmin && (
              <button
                onClick={() => router.push(`${basePath}/${teamId}/trainings/${trainingId}/edit`)}
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
            )}
          </div>
        </div>
      </div>

      {/* Announcement */}
      {training.description && (
        <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '0.5rem 1.5rem', fontSize: '0.8rem', color: '#92400e' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <strong>公告：</strong>{training.description}
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ background: 'white', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', gap: 0 }}>
          {(['problems', 'submissions', 'solutions', 'attachments', 'ranking'] as TabType[]).map(tab => {
            const labels: Record<TabType, string> = {
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
        {/* ====== Problems Tab ====== */}
        {activeTab === 'problems' && (
          <div style={{ display: 'flex', gap: '1rem' }}>
            {/* 左侧：题目按钮 */}
            <div style={{ width: '140px', flexShrink: 0 }}>
              <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {problems.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProblemId(p.id)}
                      style={{
                        padding: '0.4rem 0.75rem',
                        border: '1px solid',
                        borderColor: selectedProblemId === p.id ? 'var(--primary)' : 'var(--border)',
                        background: selectedProblemId === p.id ? 'var(--primary)' : 'white',
                        color: selectedProblemId === p.id ? 'white' : 'var(--gray-700)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        minWidth: '40px',
                      }}
                    >
                      {p.alias}
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
                    <div style={{ padding: '0.5rem 1rem', background: '#fafafa', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--gray-600)' }}>
                      <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--gray-800)' }}>{problemDetail.alias}</span>
                      {problemDetail.points != null && <span>分值: {problemDetail.points}</span>}
                      {problemDetail.timeLimit && <span>时间: {problemDetail.timeLimit}s</span>}
                      {problemDetail.memoryLimit && <span>内存: {problemDetail.memoryLimit}MB</span>}
                      {problemDetail.difficulty && (
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: problemDetail.difficulty === '简单' ? '#d1fae5' : problemDetail.difficulty === '中等' ? '#fef3c7' : '#fee2e2', color: problemDetail.difficulty === '简单' ? '#166534' : problemDetail.difficulty === '中等' ? '#92400e' : '#991b1b' }}>
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
                    {/* Statement */}
                    <div style={{ padding: '1.5rem' }}>
                      {(() => {
                        const visibleStatements = (problemDetail.statements || []).filter(s => true)
                        const stmt = visibleStatements.find(s => s.format === 'markdown' && s.language === 'zh')
                          || visibleStatements.find(s => s.format === 'markdown')
                          || visibleStatements[0]
                        if (stmt?.content) {
                          return <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}><MarkdownRenderer content={stmt.content} /></div>
                        }
                        if (problemDetail.description) {
                          return <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}><MarkdownRenderer content={problemDetail.description} /></div>
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
                    {noteSaving && <span style={{ color: '#92400e', fontSize: '0.7rem' }}>保存中...</span>}
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
                    background: showNotePanel ? 'var(--gray-100)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: showNotePanel ? 'var(--gray-600)' : 'white',
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
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    width: '100%',
                    opacity: isOngoing ? 1 : 0.5,
                  }}
                  disabled={!isOngoing}
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
                      color: 'var(--gray-600)',
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
                <label style={{ fontSize: '0.8rem', color: 'var(--gray-600)' }}>题号:</label>
                <select
                  value={filterProblemId}
                  onChange={e => { setFilterProblemId(e.target.value); setSubmissionsPage(1) }}
                  style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minWidth: '80px', background: 'white' }}
                >
                  <option value="">全部</option>
                  {problems.map(p => <option key={p.id} value={p.id}>{p.alias}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--gray-600)' }}>用户名:</label>
                <input
                  type="text"
                  value={filterUsername}
                  onChange={e => { setFilterUsername(e.target.value); setSubmissionsPage(1) }}
                  placeholder="输入用户名"
                  style={{ padding: '0.35rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', width: '120px' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--gray-600)' }}>结果:</label>
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
                <label style={{ fontSize: '0.8rem', color: 'var(--gray-600)' }}>语言:</label>
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
                style={{ padding: '0.35rem 0.75rem', background: 'var(--gray-100)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                重置
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>#</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>题号</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>提交者</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>评测结果</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>分数</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>耗时</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>内存</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>语言</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => handleViewSubmission(s.id)}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '0.5rem 0.75rem' }}>{s.id}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{s.problemAlias}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{s.userName}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <span style={{ color: getResultColor(s.result), fontWeight: 500 }}>
                        {formatResult(s.result)}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>{s.score ?? '-'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>{s.timeUsed != null ? `${s.timeUsed}ms` : '-'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>{s.memoryUsed != null ? `${(s.memoryUsed / 1024).toFixed(0)}MB` : '-'}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{formatLanguage(s.language)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--gray-500)' }}>{new Date(s.createdAt).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
                {submissions.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-400)' }}>暂无评测记录</td>
                  </tr>
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
            {problems.map(p => {
              const sol = allSolutions[p.id]
              const isEditing = editingSolutionId === p.id
              const canView = sol?.visible || training.isAdmin
              return (
                <div key={p.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{p.alias}</span>
                    {training.isAdmin && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {!isEditing && (
                          <button
                            onClick={() => {
                              setEditingSolutionId(p.id)
                              setEditingSolutionContent(sol?.content || '')
                              setEditingSolutionVisible(sol?.visible || false)
                            }}
                            style={{ padding: '0.25rem 0.5rem', background: 'var(--gray-100)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
                          >
                            编辑
                          </button>
                        )}
                        {!sol?.content && !isEditing && (
                          <button
                            onClick={() => {
                              setEditingSolutionId(p.id)
                              setEditingSolutionContent('')
                              setEditingSolutionVisible(false)
                            }}
                            style={{ padding: '0.25rem 0.5rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
                          >
                            添加题解
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {isEditing ? (
                    <div>
                      <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <input type="checkbox" checked={editingSolutionVisible} onChange={e => setEditingSolutionVisible(e.target.checked)} />
                          对学生可见
                        </label>
                        <button onClick={() => handleSaveSolution(p.id)} style={{ padding: '0.25rem 0.5rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}>保存</button>
                        <button onClick={() => setEditingSolutionId(null)} style={{ padding: '0.25rem 0.5rem', background: 'var(--gray-100)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}>取消</button>
                      </div>
                      <textarea
                        value={editingSolutionContent}
                        onChange={e => setEditingSolutionContent(e.target.value)}
                        placeholder="编写题解（Markdown）..."
                        rows={6}
                        style={{
                          width: '100%', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '6px',
                          fontSize: '0.85rem', fontFamily: 'Consolas, Monaco, monospace', lineHeight: 1.5,
                          resize: 'vertical', boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ) : canView && sol?.content ? (
                    <div style={{ fontSize: '0.85rem', lineHeight: 1.6 }}><MarkdownRenderer content={sol.content} /></div>
                  ) : (
                    <div style={{ color: 'var(--gray-400)', fontSize: '0.85rem' }}>暂无题解</div>
                  )}
                </div>
              )
            })}
            {problems.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--gray-400)' }}>暂无题目</div>
            )}
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
                  <div style={{ fontWeight: 600, color: 'var(--primary)', marginBottom: '0.5rem' }}>{p.alias}</div>
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '50px' }}>排名</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>姓名</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>用户名</th>
                  {rankingData.format === 'ioi' ? (
                    <>
                      <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>总分</th>
                      {rankingData.problems.map((p: any) => (
                        <th key={p.id} style={{ padding: '0.6rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>{p.alias}</th>
                      ))}
                    </>
                  ) : (
                    <>
                      <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>通过</th>
                      <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>罚时</th>
                      {rankingData.problems.map((p: any) => (
                        <th key={p.id} style={{ padding: '0.6rem 0.75rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>{p.alias}</th>
                      ))}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rankingData.ranking.map((row: any, idx: number) => (
                  <tr key={row.userId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 600 }}>{idx + 1}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{row.name}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--gray-500)', fontSize: '0.8rem' }}>{row.username || '-'}</td>
                    {rankingData.format === 'ioi' ? (
                      <>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700 }}>{row.totalScore}</td>
                        {rankingData.problems.map((p: any) => {
                          const pd = row.problems[p.id]
                          const maxPts = p.points ?? 100
                          return (
                            <td key={p.id} style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: pd?.score > 0 ? getScoreColor(pd.score, maxPts) : 'var(--gray-400)' }}>
                              {pd?.score ?? 0}
                            </td>
                          )
                        })}
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700 }}>{row.solvedCount}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>{row.totalPenalty} min</td>
                        {rankingData.problems.map((p: any) => {
                          const pd = row.problems[p.id]
                          return (
                            <td key={p.id} style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                              {pd?.solved ? (
                                <span style={{ color: '#16a34a', fontWeight: 500 }}>
                                  +{pd.attempts > 1 ? `(${pd.attempts - 1})` : ''}
                                  <br />
                                  <span style={{ fontSize: '0.75rem' }}>{Math.round(pd.penalty)}min</span>
                                </span>
                              ) : pd?.attempts > 0 ? (
                                <span style={{ color: '#dc2626', fontSize: '0.85rem' }}>-{pd.attempts}</span>
                              ) : (
                                <span style={{ color: 'var(--gray-400)' }}>-</span>
                              )}
                            </td>
                          )
                        })}
                      </>
                    )}
                  </tr>
                ))}
                {rankingData.ranking.length === 0 && (
                  <tr>
                    <td colSpan={20} style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-400)' }}>暂无排名数据</td>
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
      {showSubmissionDetail && submissionDetail && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowSubmissionDetail(false)}
        >
          <div
            style={{ background: 'white', borderRadius: '8px', width: '800px', maxHeight: '80vh', overflowY: 'auto', padding: '1.5rem' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>提交 #{submissionDetail.id}</h3>
              <button onClick={() => setShowSubmissionDetail(false)} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--gray-400)' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
              <div><strong>题号:</strong> {submissionDetail.problemAlias}</div>
              <div><strong>语言:</strong> {formatLanguage(submissionDetail.language)}</div>
              <div><strong>结果:</strong> <span style={{ color: getResultColor(submissionDetail.result), fontWeight: 600 }}>{formatResult(submissionDetail.result)}</span></div>
              <div><strong>分数:</strong> {submissionDetail.score ?? '-'}</div>
              <div><strong>耗时:</strong> {submissionDetail.timeUsed != null ? `${submissionDetail.timeUsed}ms` : '-'}</div>
              <div><strong>内存:</strong> {submissionDetail.memoryUsed != null ? `${(submissionDetail.memoryUsed / 1024).toFixed(0)}MB` : '-'}</div>
              <div><strong>代码长度:</strong> {submissionDetail.codeLength}B</div>
              <div><strong>提交时间:</strong> {new Date(submissionDetail.createdAt).toLocaleString('zh-CN')}</div>
            </div>
            {submissionDetail.cases && submissionDetail.cases.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>测试点</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ padding: '0.4rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>#</th>
                      <th style={{ padding: '0.4rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>状态</th>
                      <th style={{ padding: '0.4rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>分数</th>
                      <th style={{ padding: '0.4rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>耗时</th>
                      <th style={{ padding: '0.4rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>内存</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissionDetail.cases.map((c: any, i: number) => (
                      <tr key={i} style={{ borderLeft: `3px solid ${getResultColor(c.result || c.status || '')}` }}>
                        <td style={{ padding: '0.4rem', textAlign: 'center' }}>{i + 1}</td>
                        <td style={{ padding: '0.4rem', textAlign: 'center', color: getResultColor(c.result || c.status || '') }}>{formatResult(c.result || c.status || '')}</td>
                        <td style={{ padding: '0.4rem', textAlign: 'center' }}>{c.score ?? '-'}</td>
                        <td style={{ padding: '0.4rem', textAlign: 'center' }}>{c.time != null ? `${c.time}ms` : '-'}</td>
                        <td style={{ padding: '0.4rem', textAlign: 'center' }}>{c.memory != null ? `${(c.memory / 1024).toFixed(0)}MB` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {submissionDetail.code && (
              <div>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>源代码</h4>
                <pre style={{
                  background: '#1e293b', color: '#e2e8f0', padding: '1rem', borderRadius: '6px',
                  fontSize: '0.8rem', fontFamily: 'Consolas, Monaco, monospace', lineHeight: 1.5,
                  overflowX: 'auto', maxHeight: '300px', overflowY: 'auto',
                }}>
                  {submissionDetail.code}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====== Submit Code Modal ====== */}
      {showSubmitModal && isOngoing && (
        <Modal
          isOpen={true}
          onClose={() => setShowSubmitModal(false)}
          title={`提交代码 - ${selectedProblem?.alias || ''}`}
          width="700px"
        >
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
              <option value="c">C</option>
              <option value="cpp">C++</option>
              <option value="cpp14">C++14</option>
              <option value="cpp17">C++17</option>
              <option value="cpp20">C++20</option>
              <option value="java">Java</option>
              <option value="python">Python</option>
            </select>
          </div>
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
            }}
          />
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleSubmitCode}
              disabled={submitting || !submitCode.trim()}
              style={{
                padding: '0.625rem 2rem',
                background: submitting || !submitCode.trim() ? 'var(--gray-300)' : 'var(--primary)',
                color: submitting || !submitCode.trim() ? 'var(--gray-500)' : 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: submitting || !submitCode.trim() ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? '提交中...' : '提交'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}