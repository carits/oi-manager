'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { JudgeSettingsTab, JudgeSettingsTabHandle } from '@/components/problem/JudgeSettingsTab'
import apiClient from '@/lib/apiClient'
import { OJ_PLATFORMS_NO_ALL as OJ_PLATFORMS } from '@/lib/oj-platforms'

interface OjBinding {
  platform: string
  problemId: string
  url?: string
}

interface OjAttachment {
  filename: string
  downloadLink: string
}

interface Statement {
  id?: string
  format: 'markdown' | 'pdf'
  language: 'zh' | 'en' | null
  content: string | null
  fileUrl: string | null
  isVisible: boolean
}

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English'
}

interface ProblemFormProps {
  mode: 'create' | 'edit'
  role: 'teacher' | 'student' | 'admin'
  problemId?: string
}

export function ProblemForm({ mode, role, problemId }: ProblemFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const judgeSettingsRef = useRef<JudgeSettingsTabHandle>(null)
  const [loading, setLoading] = useState(mode === 'edit')
  type TabType = 'statement' | 'solution' | 'judge_settings' | 'settings' | 'attachments'
  const VALID_TABS: TabType[] = ['statement', 'solution', 'judge_settings', 'settings', 'attachments']
  const [activeTab, setActiveTab] = useState<TabType>(
    VALID_TABS.includes(searchParams.get('tab') as TabType) ? (searchParams.get('tab') as TabType) : 'statement'
  )
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('edit')

  // 附件状态
  const [attachments, setAttachments] = useState<any[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [deleteAttachmentConfirm, setDeleteAttachmentConfirm] = useState<{ isOpen: boolean; attachmentId: string | null }>({ isOpen: false, attachmentId: null })

  // 评测配置保存确认弹窗状态
  const [showJudgeConfigConfirm, setShowJudgeConfigConfirm] = useState(false)
  const [pendingSaveData, setPendingSaveData] = useState<{ createdId: string } | null>(null)

  // 获取路径前缀
  const getPathPrefix = () => {
    if (role === 'admin') return '/platform-admin'
    if (role === 'student') return '/student'
    return '/teacher'
  }
  const pathPrefix = getPathPrefix()

  useEffect(() => {
    const tab = searchParams.get('tab') as TabType
    if (VALID_TABS.includes(tab)) setActiveTab(tab)
  }, [searchParams])

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    const base = mode === 'edit' ? `${pathPrefix}/problems/${problemId}/edit` : `${pathPrefix}/problems/new`
    router.push(`${base}?tab=${tab}`, { scroll: false })
  }

  // 表单状态
  const [form, setForm] = useState({
    title: '',
    platform: '',
    difficulty: '',
    timeLimit: '1000',
    memoryLimit: '256',
    visibility: 'private',
    status: 'draft'
  })

  // 多版本题面/题解状态
  const [statements, setStatements] = useState<Statement[]>([])
  const [solutions, setSolutions] = useState<Statement[]>([])

  // OJ 绑定状态
  const [ojBindings, setOjBindings] = useState<OjBinding[]>([])
  // OJ 拉取状态
  const [fetchingFromOj, setFetchingFromOj] = useState(false)
  // 远程附件（从 OJ 拉取的附件）
  const [remoteAttachments, setRemoteAttachments] = useState<OjAttachment[]>([])
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null)

  useEffect(() => {
    if (mode === 'edit' && problemId) {
      fetchProblem()
      fetchAttachments()
    }
  }, [mode, problemId])

  const fetchProblem = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<any>(`/api/problems/${problemId}`)
      if (result.success && result.data) {
        const p = result.data
        setForm({
          title: p.title,
          platform: p.platform || '',
          difficulty: p.difficulty || '',
          timeLimit: p.timeLimit?.toString() || '1000',
          memoryLimit: p.memoryLimit?.toString() || '256',
          visibility: p.visibility || 'private',
          status: p.status
        })
        if (p.ojBindings) {
          setOjBindings(JSON.parse(p.ojBindings))
        }
        // 加载多版本数据
        setStatements(p.statements || [])
        setSolutions(p.solutions || [])
      }
    } catch (error) {
      console.error('Failed to fetch problem:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAttachments = async () => {
    if (!problemId) return
    try {
      setAttachmentsLoading(true)
      const result = await apiClient.get<any[]>(`/api/problems/${problemId}/attachments`)
      if (result.success && result.data) {
        setAttachments(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch attachments:', error)
    } finally {
      setAttachmentsLoading(false)
    }
  }

  const handleChange = (field: string, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // 检查版本是否存在
  const hasStatement = (format: 'markdown' | 'pdf', language: 'zh' | 'en' | null) => {
    return statements.some(s => s.format === format && s.language === language)
  }
  const hasSolution = (format: 'markdown' | 'pdf', language: 'zh' | 'en' | null) => {
    return solutions.some(s => s.format === format && s.language === language)
  }

  // 添加题面版本
  const addStatement = (format: 'markdown' | 'pdf', language: 'zh' | 'en' | null) => {
    if (hasStatement(format, language)) return
    setStatements(prev => [...prev, {
      format,
      language,
      content: null,
      fileUrl: null,
      isVisible: true
    }])
  }

  // 添加题解版本
  const addSolution = (format: 'markdown' | 'pdf', language: 'zh' | 'en' | null) => {
    if (hasSolution(format, language)) return
    setSolutions(prev => [...prev, {
      format,
      language,
      content: null,
      fileUrl: null,
      isVisible: true
    }])
  }

  // 更新题面版本
  const updateStatement = (index: number, updates: Partial<Statement>) => {
    setStatements(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], ...updates }
      return updated
    })
  }

  // 更新题解版本
  const updateSolution = (index: number, updates: Partial<Statement>) => {
    setSolutions(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], ...updates }
      return updated
    })
  }

  // 删除题面版本
  const removeStatement = async (index: number) => {
    const stmt = statements[index]
    if (stmt.id && mode === 'edit' && problemId) {
      // 如果是已保存的版本，调用 API 删除
      try {
        await apiClient.delete(`/api/problems/${problemId}/statements/${stmt.id}`)
      } catch (error) {
        console.error('Failed to delete statement:', error)
      }
    }
    setStatements(prev => prev.filter((_, i) => i !== index))
  }

  // 删除题解版本
  const removeSolution = async (index: number) => {
    const sol = solutions[index]
    if (sol.id && mode === 'edit' && problemId) {
      try {
        await apiClient.delete(`/api/problems/${problemId}/statements/${sol.id}`)
      } catch (error) {
        console.error('Failed to delete solution:', error)
      }
    }
    setSolutions(prev => prev.filter((_, i) => i !== index))
  }

  // 上传 PDF
  const uploadPdf = async (type: 'statement' | 'solution', index: number, file: File) => {
    if (!problemId) return

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)

      const result = await apiClient.post<any>(`/api/problems/${problemId}/statements/pdf`, formData)
      if (result.success && result.data) {
        if (type === 'statement') {
          updateStatement(index, { fileUrl: result.data.fileUrl, id: result.data.id })
        } else {
          updateSolution(index, { fileUrl: result.data.fileUrl, id: result.data.id })
        }
      }
    } catch (error) {
      console.error('Failed to upload PDF:', error)
      toast.error('上传失败')
    }
  }

  const addOjBinding = () => {
    if (ojBindings.length < 3) {
      setOjBindings([...ojBindings, { platform: '', problemId: '' }])
    }
  }

  const removeOjBinding = (index: number) => {
    setOjBindings(ojBindings.filter((_, i) => i !== index))
  }

  const updateOjBinding = (index: number, field: 'platform' | 'problemId', value: string) => {
    const updated = [...ojBindings]
    updated[index][field] = value
    setOjBindings(updated)
  }

  // 从 OJ 拉取题目信息
  const handleFetchFromOj = async (index: number) => {
    const binding = ojBindings[index]
    if (!binding.platform || !binding.problemId.trim()) {
      toast.warning('请先选择平台并输入题号')
      return
    }

    try {
      setFetchingFromOj(true)
      const result = await apiClient.get<any>(`/api/oj-fetcher/${binding.platform}/${binding.problemId.trim()}`)

      if (result.success && result.data) {
        const problem = result.data
        // 自动填充表单
        setForm(prev => ({
          ...prev,
          title: problem.title || prev.title,
          timeLimit: problem.timeLimit ? String(problem.timeLimit) : prev.timeLimit,
          memoryLimit: problem.memoryLimit ? String(problem.memoryLimit) : prev.memoryLimit,
          difficulty: problem.difficulty || prev.difficulty
        }))

        // 如果没有题面，自动添加中文 Markdown 版本
        if (problem.description && !hasStatement('markdown', 'zh')) {
          addStatement('markdown', 'zh')
          setTimeout(() => {
            setStatements(prev => {
              const updated = [...prev]
              const idx = updated.findIndex(s => s.format === 'markdown' && s.language === 'zh')
              if (idx !== -1) {
                updated[idx] = { ...updated[idx], content: problem.description }
              }
              return updated
            })
          }, 100)
        }

        // 处理附件
        if (problem.attachments && problem.attachments.length > 0) {
          setRemoteAttachments(problem.attachments)
          toast.success(`已拉取题目：${problem.title}\n发现 ${problem.attachments.length} 个附件，请在附件标签页下载`)
        } else {
          toast.success(`已拉取题目：${problem.title}`)
        }
      }
    } catch (error: any) {
      console.error('Failed to fetch from OJ:', error)
      const message = error?.response?.data?.error?.message || error?.message || '拉取失败'
      toast.error(message)
    } finally {
      setFetchingFromOj(false)
    }
  }

  // 下载远程附件
  const handleDownloadRemoteAttachment = async (attachment: OjAttachment) => {
    if (!problemId) {
      toast.warning('请先保存题目后再下载附件')
      return
    }

    try {
      setDownloadingAttachment(attachment.filename)
      const result = await apiClient.post('/api/oj-fetcher/download-attachment', {
        problemId,
        url: attachment.downloadLink,
        filename: attachment.filename,
      })

      if (result.success) {
        setRemoteAttachments(prev => prev.filter(a => a.filename !== attachment.filename))
        fetchAttachments()
        toast.success(`附件 "${attachment.filename}" 下载成功`)
      } else {
        toast.error(result.message || '下载失败')
      }
    } catch (error: any) {
      console.error('Failed to download attachment:', error)
      toast.error(error?.response?.data?.message || '下载失败')
    } finally {
      setDownloadingAttachment(null)
    }
  }

  // 上传附件
  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !problemId) return

    try {
      setUploadingAttachment(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('description', '')

      const result = await apiClient.post(`/api/problems/${problemId}/attachments`, formData)

      if (result.success) {
        fetchAttachments()
      } else {
        console.error('Upload failed:', result.message)
        toast.error(result.message || '上传失败')
      }
    } catch (error) {
      console.error('Failed to upload attachment:', error)
      toast.error('上传失败')
    } finally {
      setUploadingAttachment(false)
      e.target.value = ''
    }
  }

  // 删除附件
  const handleAttachmentDelete = (attachmentId: string) => {
    setDeleteAttachmentConfirm({ isOpen: true, attachmentId })
  }

  const confirmDeleteAttachment = async () => {
    const attachmentId = deleteAttachmentConfirm.attachmentId
    if (!attachmentId) return
    setDeleteAttachmentConfirm({ isOpen: false, attachmentId: null })

    try {
      const result = await apiClient.delete(`/api/problems/${problemId}/attachments/${attachmentId}`)
      if (result.success) {
        fetchAttachments()
      }
    } catch (error) {
      console.error('Failed to delete attachment:', error)
      toast.error('删除失败')
    }
  }

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.title.trim()) {
      toast.warning('请输入题目标题')
      return
    }

    try {
      setSaving(true)

      const data: any = {
        title: form.title.trim(),
        difficulty: form.difficulty || null,
        timeLimit: form.timeLimit ? parseInt(form.timeLimit) : null,
        memoryLimit: form.memoryLimit ? parseInt(form.memoryLimit) : null,
        status: form.status,
        statements: statements.map(s => ({
          id: s.id,
          format: s.format,
          language: s.language,
          content: s.content,
          fileUrl: s.fileUrl,
          isVisible: s.isVisible
        })),
        solutions: solutions.map(s => ({
          id: s.id,
          format: s.format,
          language: s.language,
          content: s.content,
          fileUrl: s.fileUrl,
          isVisible: s.isVisible
        }))
      }

      // 只有管理员可以设置 visibility
      if (role === 'admin') {
        data.visibility = form.visibility
      }

      const validBindings = ojBindings.filter(b => b.platform && b.problemId.trim())
      if (validBindings.length > 0) {
        data.ojBindings = validBindings
      }

      let result
      if (mode === 'create') {
        result = await apiClient.post<any>('/api/problems', data)
      } else {
        result = await apiClient.put<any>(`/api/problems/${problemId}`, data)
      }

      if (result.success && result.data) {
        const createdId = result.data.id || problemId

        // 创建模式：上传暂存的评测数据 + 保存评测配置
        if (mode === 'create') {
          const stagedFiles = judgeSettingsRef.current?.getStagedFiles?.()
          if (stagedFiles && stagedFiles.length > 0) {
            try {
              const formData = new FormData()
              for (const f of stagedFiles) formData.append('files', f)
              await apiClient.postFile(`/api/problems/${createdId}/testdata`, formData)
            } catch (e) {
              console.error('Failed to upload staged testdata:', e)
              toast.warning('测试数据上传失败，请到编辑页面重新上传')
            }
          }
          // 保存评测配置（如果有）
          try {
            await judgeSettingsRef.current?.saveConfig?.(createdId)
          } catch (e) {
            console.error('Failed to save judge config:', e)
          }
          router.push(`${pathPrefix}/problems/${createdId}/edit?tab=judge_settings`)
        } else if (judgeSettingsRef.current?.isDirty()) {
          // 编辑模式：评测配置有修改，弹确认弹窗
          setPendingSaveData({ createdId })
          setShowJudgeConfigConfirm(true)
        } else {
          router.push(`${pathPrefix}/problems/${createdId}`)
        }
      }
    } catch (error) {
      console.error('Failed to save problem:', error)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 评测配置保存确认回调
  const handleConfirmSaveJudgeConfig = async () => {
    try {
      await judgeSettingsRef.current?.saveConfig()
    } catch (e) {
      console.error('Failed to save judge config:', e)
    }
    setShowJudgeConfigConfirm(false)
    if (pendingSaveData) {
      router.push(`${pathPrefix}/problems/${pendingSaveData.createdId}`)
    }
    setPendingSaveData(null)
  }

  const handleCancelSaveJudgeConfig = () => {
    setShowJudgeConfigConfirm(false)
    if (pendingSaveData) {
      router.push(`${pathPrefix}/problems/${pendingSaveData.createdId}`)
    }
    setPendingSaveData(null)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        加载中...
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem' }}>
        {/* 返回按钮 */}
        <button
          onClick={() => router.push(mode === 'edit' && problemId ? `${pathPrefix}/problems/${problemId}` : `${pathPrefix}/problems`)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--primary)',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontSize: '0.875rem'
          }}
        >
          ← 返回
        </button>

        <form onSubmit={handleSubmit}>
          {/* 基本信息 */}
          <div style={{
            background: 'white',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            padding: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>
              {mode === 'create' ? '新建题目' : '编辑题目'}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>标题 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem'
                  }}
                  placeholder="请输入题目标题"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>难度</label>
                <select
                  value={form.difficulty}
                  onChange={(e) => handleChange('difficulty', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem'
                  }}
                >
                  <option value="">请选择</option>
                  <option value="简单">简单</option>
                  <option value="中等">中等</option>
                  <option value="困难">困难</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>时间限制</label>
                <input
                  type="number"
                  value={form.timeLimit}
                  onChange={(e) => handleChange('timeLimit', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem'
                  }}
                  placeholder="1000"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>ms</span>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>空间限制</label>
                <input
                  type="number"
                  value={form.memoryLimit}
                  onChange={(e) => handleChange('memoryLimit', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem'
                  }}
                  placeholder="256"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>MB</span>
              </div>
            </div>
          </div>

          {/* Tab 切换 */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
            <button type="button" onClick={() => handleTabChange('statement')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'statement' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'statement' ? 'var(--primary)' : 'var(--gray-500)'
              }}>
              题面
            </button>
            <button type="button" onClick={() => handleTabChange('solution')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'solution' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'solution' ? 'var(--primary)' : 'var(--gray-500)'
              }}>
              题解
            </button>
            {(form.platform === 'carits' || mode === 'create') && (
              <button type="button" onClick={() => handleTabChange('judge_settings')}
                style={{
                  padding: '0.75rem 1rem',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'judge_settings' ? '2px solid var(--primary)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: activeTab === 'judge_settings' ? 'var(--primary)' : 'var(--gray-500)'
                }}>
                评测设置
              </button>
            )}
            <button type="button" onClick={() => handleTabChange('settings')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'settings' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'settings' ? 'var(--primary)' : 'var(--gray-500)'
              }}>
              发布设置
            </button>
            {mode === 'edit' && (
              <button type="button" onClick={() => handleTabChange('attachments')}
                style={{
                  padding: '0.75rem 1rem',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'attachments' ? '2px solid var(--primary)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: activeTab === 'attachments' ? 'var(--primary)' : 'var(--gray-500)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}>
                附件
                {attachments.length > 0 && (
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
            )}
          </div>

          {/* Tab 内容 */}
          <div style={{
            background: 'white',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            padding: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            {activeTab === 'statement' && (
              <div>
                {/* 已添加的版本 */}
                {statements.map((stmt, index) => (
                  <div key={index} style={{
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      background: 'var(--gray-50)',
                      padding: '0.75rem 1rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontWeight: 500 }}>
                        {stmt.format === 'pdf' ? 'PDF' : `${stmt.language ? LANGUAGE_LABELS[stmt.language] : '未知'}`}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={stmt.isVisible}
                            onChange={(e) => updateStatement(index, { isVisible: e.target.checked })}
                          />
                          可见
                        </label>
                        <button
                          type="button"
                          onClick={() => removeStatement(index)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            border: '1px solid #ef4444',
                            borderRadius: '4px',
                            background: 'white',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: '0.75rem'
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div style={{ padding: '1rem' }}>
                      {stmt.format === 'markdown' ? (
                        <div>
                          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <button type="button" onClick={() => setEditMode('edit')}
                              style={{
                                padding: '0.25rem 0.75rem',
                                border: '1px solid var(--border)',
                                borderRadius: '4px',
                                background: editMode === 'edit' ? 'var(--primary)' : 'white',
                                color: editMode === 'edit' ? 'white' : 'var(--gray-600)',
                                cursor: 'pointer',
                                fontSize: '0.75rem'
                              }}>
                              编辑
                            </button>
                            <button type="button" onClick={() => setEditMode('preview')}
                              style={{
                                padding: '0.25rem 0.75rem',
                                border: '1px solid var(--border)',
                                borderRadius: '4px',
                                background: editMode === 'preview' ? 'var(--primary)' : 'white',
                                color: editMode === 'preview' ? 'white' : 'var(--gray-600)',
                                cursor: 'pointer',
                                fontSize: '0.75rem'
                              }}>
                              预览
                            </button>
                          </div>
                          {editMode === 'edit' ? (
                            <textarea
                              value={stmt.content || ''}
                              onChange={(e) => updateStatement(index, { content: e.target.value })}
                              style={{
                                width: '100%',
                                minHeight: '400px',
                                padding: '0.75rem',
                                border: '1px solid var(--border)',
                                borderRadius: '6px',
                                fontSize: '0.875rem',
                                fontFamily: 'monospace'
                              }}
                              placeholder="请输入题面内容（支持 Markdown 和 LaTeX）"
                            />
                          ) : (
                            <div style={{
                              minHeight: '400px',
                              padding: '1rem',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              overflow: 'auto'
                            }}>
                              {stmt.content ? (
                                <MarkdownRenderer content={stmt.content} />
                              ) : (
                                <span style={{ color: 'var(--gray-400)' }}>暂无内容</span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          {mode === 'edit' && problemId ? (
                            <div>
                              <input
                                type="file"
                                accept=".pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) uploadPdf('statement', index, file)
                                }}
                                style={{ fontSize: '0.875rem' }}
                              />
                              {stmt.fileUrl && (
                                <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.5rem' }}>
                                  已上传 PDF
                                </p>
                              )}
                            </div>
                          ) : (
                            <p style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>
                              请先保存题目后再上传 PDF
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* 添加版本下拉 */}
                <div style={{ marginTop: '1rem' }}>
                  <select
                    onChange={(e) => {
                      const value = e.target.value
                      if (value === 'markdown-zh') addStatement('markdown', 'zh')
                      else if (value === 'markdown-en') addStatement('markdown', 'en')
                      else if (value === 'pdf') addStatement('pdf', null)
                      e.target.value = ''
                    }}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.875rem'
                    }}
                  >
                    <option value="">+ 添加题面版本</option>
                    <option value="markdown-zh" disabled={hasStatement('markdown', 'zh')}>
                      Markdown 中文 {hasStatement('markdown', 'zh') ? '(已添加)' : ''}
                    </option>
                    <option value="markdown-en" disabled={hasStatement('markdown', 'en')}>
                      Markdown 英文 {hasStatement('markdown', 'en') ? '(已添加)' : ''}
                    </option>
                    <option value="pdf" disabled={hasStatement('pdf', null)}>
                      上传 PDF {hasStatement('pdf', null) ? '(已添加)' : ''}
                    </option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'solution' && (
              <div>
                {/* 已添加的版本 */}
                {solutions.map((sol, index) => (
                  <div key={index} style={{
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      background: 'var(--gray-50)',
                      padding: '0.75rem 1rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontWeight: 500 }}>
                        题解 - {sol.format === 'pdf' ? 'PDF' : `${sol.language ? LANGUAGE_LABELS[sol.language] : '未知'}`}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={sol.isVisible}
                            onChange={(e) => updateSolution(index, { isVisible: e.target.checked })}
                          />
                          可见
                        </label>
                        <button
                          type="button"
                          onClick={() => removeSolution(index)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            border: '1px solid #ef4444',
                            borderRadius: '4px',
                            background: 'white',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: '0.75rem'
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div style={{ padding: '1rem' }}>
                      {sol.format === 'markdown' ? (
                        <textarea
                          value={sol.content || ''}
                          onChange={(e) => updateSolution(index, { content: e.target.value })}
                          style={{
                            width: '100%',
                            minHeight: '300px',
                            padding: '0.75rem',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            fontFamily: 'monospace'
                          }}
                          placeholder="请输入题解内容（支持 Markdown 和 LaTeX）"
                        />
                      ) : (
                        <div>
                          {mode === 'edit' && problemId ? (
                            <div>
                              <input
                                type="file"
                                accept=".pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) uploadPdf('solution', index, file)
                                }}
                                style={{ fontSize: '0.875rem' }}
                              />
                              {sol.fileUrl && (
                                <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.5rem' }}>
                                  已上传 PDF
                                </p>
                              )}
                            </div>
                          ) : (
                            <p style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>
                              请先保存题目后再上传 PDF
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* 添加版本下拉 */}
                <div style={{ marginTop: '1rem' }}>
                  <select
                    onChange={(e) => {
                      const value = e.target.value
                      if (value === 'markdown-zh') addSolution('markdown', 'zh')
                      else if (value === 'markdown-en') addSolution('markdown', 'en')
                      else if (value === 'pdf') addSolution('pdf', null)
                      e.target.value = ''
                    }}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.875rem'
                    }}
                  >
                    <option value="">+ 添加题解版本</option>
                    <option value="markdown-zh" disabled={hasSolution('markdown', 'zh')}>
                      Markdown 中文 {hasSolution('markdown', 'zh') ? '(已添加)' : ''}
                    </option>
                    <option value="markdown-en" disabled={hasSolution('markdown', 'en')}>
                      Markdown 英文 {hasSolution('markdown', 'en') ? '(已添加)' : ''}
                    </option>
                    <option value="pdf" disabled={hasSolution('pdf', null)}>
                      上传 PDF {hasSolution('pdf', null) ? '(已添加)' : ''}
                    </option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'judge_settings' && (
              <JudgeSettingsTab
                ref={judgeSettingsRef}
                problemId={problemId || ''}
                timeLimit={form.timeLimit}
                memoryLimit={form.memoryLimit}
                onTimeLimitChange={(v) => handleChange('timeLimit', v)}
                onMemoryLimitChange={(v) => handleChange('memoryLimit', v)}
              />
            )}

            {activeTab === 'settings' && (
              <div>
                {/* 管理员可选择可见性 */}
                {role === 'admin' && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>可见性</label>
                    <select
                      value={form.visibility}
                      onChange={(e) => handleChange('visibility', e.target.value)}
                      style={{
                        padding: '0.5rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '0.875rem'
                      }}
                    >
                      <option value="private">私有（仅自己可见）</option>
                      <option value="public">公共（所有人可见）</option>
                    </select>
                  </div>
                )}

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>状态</label>
                  <select
                    value={form.status}
                    onChange={(e) => handleChange('status', e.target.value)}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.875rem'
                    }}
                  >
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                  </select>
                </div>

                {/* OJ 绑定 */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>OJ 题目绑定</label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.75rem' }}>
                    绑定外部OJ题目，最多可添加3个
                  </p>

                  {ojBindings.map((binding, index) => (
                    <div key={index} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                      <select
                        value={binding.platform}
                        onChange={(e) => updateOjBinding(index, 'platform', e.target.value)}
                        style={{
                          padding: '0.5rem',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          fontSize: '0.875rem'
                        }}
                      >
                        <option value="">选择平台</option>
                        {OJ_PLATFORMS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={binding.problemId}
                        onChange={(e) => updateOjBinding(index, 'problemId', e.target.value)}
                        placeholder="题号"
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          fontSize: '0.875rem'
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleFetchFromOj(index)}
                        disabled={fetchingFromOj || !binding.platform || !binding.problemId.trim()}
                        style={{
                          padding: '0.5rem 0.75rem',
                          border: '1px solid var(--primary)',
                          borderRadius: '6px',
                          background: 'white',
                          color: 'var(--primary)',
                          cursor: fetchingFromOj ? 'not-allowed' : 'pointer',
                          fontSize: '0.75rem',
                          opacity: fetchingFromOj ? 0.5 : 1
                        }}
                      >
                        {fetchingFromOj ? '拉取中...' : '拉取'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeOjBinding(index)}
                        style={{
                          padding: '0.5rem 0.75rem',
                          border: '1px solid #ef4444',
                          borderRadius: '6px',
                          background: 'white',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontSize: '0.75rem'
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))}

                  {ojBindings.length < 3 && (
                    <button
                      type="button"
                      onClick={addOjBinding}
                      style={{
                        padding: '0.5rem 1rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        background: 'white',
                        cursor: 'pointer',
                        fontSize: '0.875rem'
                      }}
                    >
                      + 添加绑定
                    </button>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'attachments' && (
              <div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>上传附件</label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.75rem' }}>
                    支持 PDF、ZIP、RAR、7Z、TXT、CPP、C、PY、JAVA、PAS、IN、OUT、MD 格式，最大 50MB
                  </p>
                  <input
                    type="file"
                    accept=".pdf,.zip,.rar,.7z,.txt,.cpp,.c,.py,.java,.pas,.in,.out,.md"
                    onChange={handleAttachmentUpload}
                    disabled={uploadingAttachment}
                    style={{ fontSize: '0.875rem' }}
                  />
                  {uploadingAttachment && <span style={{ marginLeft: '0.5rem', fontSize: '0.875rem', color: 'var(--gray-500)' }}>上传中...</span>}
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>已上传附件</label>
                  {attachmentsLoading ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>加载中...</div>
                  ) : attachments.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>暂无附件</div>
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
                            type="button"
                            onClick={() => handleAttachmentDelete(attachment.id)}
                            style={{
                              padding: '0.375rem 0.75rem',
                              border: '1px solid #ef4444',
                              background: 'white',
                              color: '#ef4444',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.875rem'
                            }}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 远程附件（从 OJ 拉取的附件） */}
                {remoteAttachments.length > 0 && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                      远程附件（从 OJ 拉取）
                    </label>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.75rem' }}>
                      以下附件来自 OJ 平台，点击下载后保存到本系统
                    </p>
                    <div>
                      {remoteAttachments.map((attachment, index) => (
                        <div
                          key={index}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.75rem 1rem',
                            borderBottom: '1px solid var(--border)',
                            background: '#fef3c7'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ fontSize: '1.25rem' }}>📥</span>
                            <div>
                              <div style={{ fontWeight: 500 }}>{attachment.filename}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                                待下载
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDownloadRemoteAttachment(attachment)}
                            disabled={downloadingAttachment !== null}
                            style={{
                              padding: '0.375rem 0.75rem',
                              border: '1px solid var(--primary)',
                              background: downloadingAttachment === attachment.filename ? 'var(--gray-200)' : 'white',
                              color: 'var(--primary)',
                              borderRadius: '4px',
                              cursor: downloadingAttachment !== null ? 'not-allowed' : 'pointer',
                              fontSize: '0.875rem'
                            }}
                          >
                            {downloadingAttachment === attachment.filename ? '下载中...' : '下载'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 提交按钮 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => router.push(mode === 'edit' && problemId ? `${pathPrefix}/problems/${problemId}` : `${pathPrefix}/problems`)}
              style={{
                padding: '0.5rem 1rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'white',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '0.5rem 1.5rem',
                border: 'none',
                borderRadius: '6px',
                background: 'var(--primary)',
                color: 'white',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                opacity: saving ? 0.7 : 1
              }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>

      <ConfirmModal
        isOpen={deleteAttachmentConfirm.isOpen}
        onClose={() => setDeleteAttachmentConfirm({ isOpen: false, attachmentId: null })}
        onConfirm={confirmDeleteAttachment}
        title="删除附件"
        message="确定要删除这个附件吗？"
        confirmText="删除"
        danger
      />

      <ConfirmModal
        isOpen={showJudgeConfigConfirm}
        onClose={handleCancelSaveJudgeConfig}
        onConfirm={handleConfirmSaveJudgeConfig}
        title="保存评测配置"
        message="检测到评测配置有修改，是否同时保存评测配置？"
        confirmText="保存评测配置"
        cancelText="跳过"
      />
    </div>
  )
}