'use client'

import { useState, useEffect, useRef } from 'react'
import collisionStyles from './ProblemForm.collision.module.css'
import unifiedStyles from './ProblemForm.unified.module.css'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { JudgeSettingsTab, JudgeSettingsTabHandle } from '@/components/problem/JudgeSettingsTab'
import apiClient from '@/lib/apiClient'
import { OJ_PLATFORMS_NO_ALL as OJ_PLATFORMS } from '@/lib/oj-platforms'
import { Paperclip } from 'lucide-react'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { useUnsavedChanges } from '@/components/navigation/UnsavedChangesProvider'

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

let problemDraftBootstrap: Promise<Awaited<ReturnType<typeof apiClient.post<{ id: string }>>>> | null = null

export function ProblemForm({ mode, role, problemId }: ProblemFormProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'failed'>('idle')
  const savedFingerprintRef = useRef<string | null>(null)
  const judgeSettingsRef = useRef<JudgeSettingsTabHandle>(null)
  const [loading, setLoading] = useState(true)
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
  const pathPrefix = currentWorkspacePrefix(pathname, role === 'admin' ? '/platform-admin' : '/personal')

  // New problem creation is materialized immediately as a private draft so every
  // following editor (PDF, testdata and judge assets included) has a stable owner.
  useEffect(() => {
    if (mode !== 'create') return
    const bootstrap = async () => {
      const request = problemDraftBootstrap ||= apiClient.post<{ id: string }>('/api/problems', { title: '未命名题目', status: 'draft', statements: [], solutions: [] })
      const result = await request
      window.setTimeout(() => { if (problemDraftBootstrap === request) problemDraftBootstrap = null }, 1000)
      if (!result.success || !result.data?.id) {
        setLoading(false); toast.error(result.message || '无法创建题目草稿，请重试')
        return
      }
      router.replace(`${pathPrefix}/problems/${result.data.id}/edit?new=1`)
    }
    void bootstrap()
  }, [mode, pathPrefix, router, toast])

  useEffect(() => {
    const tab = searchParams.get('tab') as TabType
    if (VALID_TABS.includes(tab)) setActiveTab(tab)
  }, [searchParams])

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    const base = mode === 'edit' ? `${pathPrefix}/problems/${problemId}/edit` : `${pathPrefix}/problems/new`
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.push(`${base}?${params.toString()}`, { scroll: false })
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
  const [ojBindings, setOjBindings] = useState<OjBinding[]>([])

  const buildProblemPayload = () => {
    const data: Record<string, unknown> = {
      title: form.title.trim() || '未命名题目',
      difficulty: form.difficulty || null,
      timeLimit: form.timeLimit ? parseInt(form.timeLimit) : null,
      memoryLimit: form.memoryLimit ? parseInt(form.memoryLimit) : null,
      status: form.status,
      statements: statements.map(s => ({ id: s.id, format: s.format, language: s.language, content: s.content, fileUrl: s.fileUrl, isVisible: s.isVisible })),
      solutions: solutions.map(s => ({ id: s.id, format: s.format, language: s.language, content: s.content, fileUrl: s.fileUrl, isVisible: s.isVisible })),
    }
    if (role === 'admin') data.visibility = form.visibility
    const validBindings = ojBindings.filter(binding => binding.platform && binding.problemId.trim())
    if (validBindings.length) data.ojBindings = validBindings
    return data
  }

  const isAutoSaveDraft = mode === 'edit' && searchParams.get('new') === '1'
  const currentFingerprint = JSON.stringify(buildProblemPayload())
  const draftDirty = isAutoSaveDraft && savedFingerprintRef.current !== null && savedFingerprintRef.current !== currentFingerprint
  useUnsavedChanges(`problem-draft:${problemId || 'new'}`, draftDirty || autoSaveStatus === 'saving')

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

  useEffect(() => {
    if (loading || !isAutoSaveDraft || !problemId) return
    if (savedFingerprintRef.current === null) {
      savedFingerprintRef.current = currentFingerprint
      setAutoSaveStatus('saved')
      return
    }
    if (savedFingerprintRef.current === currentFingerprint) return
    setAutoSaveStatus('dirty')
    const timer = window.setTimeout(async () => {
      setAutoSaveStatus('saving')
      const fingerprint = currentFingerprint
      const result = await apiClient.put(`/api/problems/${problemId}`, buildProblemPayload())
      if (result.success) {
        savedFingerprintRef.current = fingerprint
        setAutoSaveStatus('saved')
      } else {
        setAutoSaveStatus('failed')
      }
    }, 800)
    return () => window.clearTimeout(timer)
    // Payload is intentionally represented by its stable JSON fingerprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFingerprint, isAutoSaveDraft, loading, problemId])

  const fetchProblem = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<any>(`/api/problems/${problemId}`)
      if (result.success && result.data) {
        const p = result.data
        if (!p.permissions?.canEdit) {
          toast.error('你没有权限编辑这道题')
          router.replace(`${pathPrefix}/problems/${problemId}`)
          return
        }
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

      const data = buildProblemPayload()

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
      <div className={unifiedStyles.u1}>
        <span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" />
      </div>
    )
  }

  return (
    <div className={unifiedStyles.u2}>
      <div className={unifiedStyles.u3}>
        {/* 返回按钮 */}
        <Button variant="ghost"
          onClick={() => router.push(mode === 'edit' && problemId ? `${pathPrefix}/problems/${problemId}` : `${pathPrefix}/problems`)}
          className={unifiedStyles.u4}
        >
          ← 返回
        </Button>

        <form onSubmit={handleSubmit}>
          {/* 基本信息 */}
          <div className={unifiedStyles.u5}>
            <h2 className={unifiedStyles.u6}>
              {mode === 'create' ? '正在创建题目草稿' : isAutoSaveDraft ? '题目草稿' : '编辑题目'}
            </h2>
            {isAutoSaveDraft && <p aria-live="polite" className={unifiedStyles.u8}>
              {autoSaveStatus === 'saving' ? '正在自动保存…' : autoSaveStatus === 'failed' ? '自动保存失败，请使用页面底部的保存按钮重试' : autoSaveStatus === 'dirty' ? '有更改待保存' : '已自动保存为不可见草稿'}
            </p>}
            <div className={unifiedStyles.u7}>
              <div>
                <label className={unifiedStyles.u8}>标题 *</label>
                <Input
                  type="text"
                  value={form.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  className={unifiedStyles.u9}
                  placeholder="请输入题目标题"
                />
              </div>
              <div>
                <label className={unifiedStyles.u8}>难度</label>
                <Select aria-label="选择"
                  value={form.difficulty}
                  onChange={(e) => handleChange('difficulty', e.target.value)}
                  className={unifiedStyles.u9}
                >
                  <option value="">请选择</option>
                  <option value="简单">简单</option>
                  <option value="中等">中等</option>
                  <option value="困难">困难</option>
                </Select>
              </div>
              <div>
                <label className={unifiedStyles.u8}>时间限制</label>
                <Input
                  type="number"
                  value={form.timeLimit}
                  onChange={(e) => handleChange('timeLimit', e.target.value)}
                  className={unifiedStyles.u9}
                  placeholder="1000"
                />
                <span className={unifiedStyles.u10}>ms</span>
              </div>
              <div>
                <label className={unifiedStyles.u8}>空间限制</label>
                <Input
                  type="number"
                  value={form.memoryLimit}
                  onChange={(e) => handleChange('memoryLimit', e.target.value)}
                  className={unifiedStyles.u9}
                  placeholder="256"
                />
                <span className={unifiedStyles.u10}>MB</span>
              </div>
            </div>
          </div>

          {/* Tab 切换 */}
          <div className={unifiedStyles.u11}>
            <Button variant="ghost" type="button" onClick={() => handleTabChange('statement')}
              className={unifiedStyles.tabButton} aria-selected={activeTab === 'statement'}>
              题面
            </Button>
            <Button variant="ghost" type="button" onClick={() => handleTabChange('solution')}
              className={unifiedStyles.tabButton} aria-selected={activeTab === 'solution'}>
              题解
            </Button>
            <Button variant="ghost" type="button" onClick={() => handleTabChange('judge_settings')}
                className={unifiedStyles.tabButton} aria-selected={activeTab === 'judge_settings'}>
                评测设置
            </Button>
            <Button variant="ghost" type="button" onClick={() => handleTabChange('settings')}
              className={unifiedStyles.tabButton} aria-selected={activeTab === 'settings'}>
              发布设置
            </Button>
            {mode === 'edit' && (
              <Button variant="ghost" type="button" onClick={() => handleTabChange('attachments')}
                className={`${unifiedStyles.tabButton} ${unifiedStyles.attachmentTab}`} aria-selected={activeTab === 'attachments'}>
                附件
                {attachments.length > 0 && (
                  <span className={unifiedStyles.u12}>
                    {attachments.length}
                  </span>
                )}
              </Button>
            )}
          </div>

          {/* Tab 内容 */}
          <div className={unifiedStyles.u5}>
            {activeTab === 'statement' && (
              <div>
                {/* 已添加的版本 */}
                {statements.map((stmt, index) => (
                  <div key={index} className={unifiedStyles.u13}>
                    <div className={unifiedStyles.u14}>
                      <span className={unifiedStyles.u15}>
                        {stmt.format === 'pdf' ? 'PDF' : `${stmt.language ? LANGUAGE_LABELS[stmt.language] : '未知'}`}
                      </span>
                      <div className={unifiedStyles.u16}>
                        <label className={unifiedStyles.u17}>
                          <Input
                            type="checkbox"
                            checked={stmt.isVisible}
                            onChange={(e) => updateStatement(index, { isVisible: e.target.checked })}
                          />
                          可见
                        </label>
                        <Button variant="ghost"
                          type="button"
                          onClick={() => removeStatement(index)}
                          className={unifiedStyles.u18}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                    <div className={unifiedStyles.u19}>
                      {stmt.format === 'markdown' ? (
                        <div>
                          <div className={unifiedStyles.u20}>
                            <Button variant="ghost" type="button" onClick={() => setEditMode('edit')}
                              className={unifiedStyles.editorModeButton} aria-pressed={editMode === 'edit'}>
                              编辑
                            </Button>
                            <Button variant="ghost" type="button" onClick={() => setEditMode('preview')}
                              className={unifiedStyles.editorModeButton} aria-pressed={editMode === 'preview'}>
                              预览
                            </Button>
                          </div>
                          {editMode === 'edit' ? (
                            <Textarea
                              value={stmt.content || ''}
                              onChange={(e) => updateStatement(index, { content: e.target.value })}
                              className={unifiedStyles.u21}
                              placeholder="请输入题面内容（支持 Markdown 和 LaTeX）"
                            />
                          ) : (
                            <div className={unifiedStyles.u22}>
                              {stmt.content ? (
                                <MarkdownRenderer content={stmt.content} />
                              ) : (
                                <span className={unifiedStyles.u23}>暂无内容</span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          {mode === 'edit' && problemId ? (
                            <div>
                              <Input
                                type="file"
                                accept=".pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) uploadPdf('statement', index, file)
                                }}
                                className={unifiedStyles.u24}
                              />
                              {stmt.fileUrl && (
                                <p className={unifiedStyles.u25}>
                                  已上传 PDF
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className={unifiedStyles.u26}>
                              请先保存题目后再上传 PDF
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* 添加版本下拉 */}
                <div className={unifiedStyles.u27}>
                  <Select aria-label="选择"
                    onChange={(e) => {
                      const value = e.target.value
                      if (value === 'markdown-zh') addStatement('markdown', 'zh')
                      else if (value === 'markdown-en') addStatement('markdown', 'en')
                      else if (value === 'pdf') addStatement('pdf', null)
                      e.target.value = ''
                    }}
                    className={unifiedStyles.u28}
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
                  </Select>
                </div>
              </div>
            )}

            {activeTab === 'solution' && (
              <div>
                {/* 已添加的版本 */}
                {solutions.map((sol, index) => (
                  <div key={index} className={unifiedStyles.u13}>
                    <div className={unifiedStyles.u14}>
                      <span className={unifiedStyles.u15}>
                        题解 - {sol.format === 'pdf' ? 'PDF' : `${sol.language ? LANGUAGE_LABELS[sol.language] : '未知'}`}
                      </span>
                      <div className={unifiedStyles.u16}>
                        <label className={unifiedStyles.u17}>
                          <Input
                            type="checkbox"
                            checked={sol.isVisible}
                            onChange={(e) => updateSolution(index, { isVisible: e.target.checked })}
                          />
                          可见
                        </label>
                        <Button variant="ghost"
                          type="button"
                          onClick={() => removeSolution(index)}
                          className={unifiedStyles.u18}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                    <div className={unifiedStyles.u19}>
                      {sol.format === 'markdown' ? (
                        <Textarea
                          value={sol.content || ''}
                          onChange={(e) => updateSolution(index, { content: e.target.value })}
                          className={unifiedStyles.u29}
                          placeholder="请输入题解内容（支持 Markdown 和 LaTeX）"
                        />
                      ) : (
                        <div>
                          {mode === 'edit' && problemId ? (
                            <div>
                              <Input
                                type="file"
                                accept=".pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) uploadPdf('solution', index, file)
                                }}
                                className={unifiedStyles.u24}
                              />
                              {sol.fileUrl && (
                                <p className={unifiedStyles.u25}>
                                  已上传 PDF
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className={unifiedStyles.u26}>
                              请先保存题目后再上传 PDF
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* 添加版本下拉 */}
                <div className={unifiedStyles.u27}>
                  <Select aria-label="选择"
                    onChange={(e) => {
                      const value = e.target.value
                      if (value === 'markdown-zh') addSolution('markdown', 'zh')
                      else if (value === 'markdown-en') addSolution('markdown', 'en')
                      else if (value === 'pdf') addSolution('pdf', null)
                      e.target.value = ''
                    }}
                    className={unifiedStyles.u28}
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
                  </Select>
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
                {/* 题库归属由服务端根据当前工作区和角色确定 */}
                {role === 'admin' && (
                  <div className={unifiedStyles.u30}>
                    <label className={unifiedStyles.u8}>题库归属</label>
                    <p className={unifiedStyles.u31}>平台题库</p>
                  </div>
                )}

                <div className={unifiedStyles.u30}>
                  <label className={unifiedStyles.u8}>状态</label>
                  <Select aria-label="选择"
                    value={form.status}
                    onChange={(e) => handleChange('status', e.target.value)}
                    className={unifiedStyles.u28}
                  >
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                  </Select>
                </div>

                {/* OJ 绑定 */}
                <div className={unifiedStyles.u30}>
                  <label className={unifiedStyles.u8}>OJ 题目绑定</label>
                  <p className={unifiedStyles.u32}>
                    绑定外部OJ题目，最多可添加3个
                  </p>

                  {ojBindings.map((binding, index) => (
                    <div key={index} className={unifiedStyles.u33}>
                      <Select aria-label="选择"
                        value={binding.platform}
                        onChange={(e) => updateOjBinding(index, 'platform', e.target.value)}
                        className={unifiedStyles.u28}
                      >
                        <option value="">选择平台</option>
                        {OJ_PLATFORMS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </Select>
                      <Input
                        type="text"
                        value={binding.problemId}
                        onChange={(e) => updateOjBinding(index, 'problemId', e.target.value)}
                        placeholder="题号"
                        className={unifiedStyles.u34}
                      />
                      <Button variant="outline"
                        type="button"
                        onClick={() => handleFetchFromOj(index)}
                        disabled={fetchingFromOj || !binding.platform || !binding.problemId.trim()}
                        size="sm"
                      >
                        {fetchingFromOj ? '拉取中...' : '拉取'}
                      </Button>
                      <Button variant="ghost"
                        type="button"
                        onClick={() => removeOjBinding(index)}
                        className={unifiedStyles.u35}
                      >
                        删除
                      </Button>
                    </div>
                  ))}

                  {ojBindings.length < 3 && (
                    <Button variant="ghost"
                      type="button"
                      onClick={addOjBinding}
                      className={unifiedStyles.u36}
                    >
                      + 添加绑定
                    </Button>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'attachments' && (
              <div>
                <div className={unifiedStyles.u37}>
                  <label className={unifiedStyles.u8}>上传附件</label>
                  <p className={unifiedStyles.u32}>
                    支持 PDF、ZIP、RAR、7Z、TXT、CPP、C、PY、JAVA、PAS、IN、OUT、MD 格式，最大 50MB
                  </p>
                  <Input
                    type="file"
                    accept=".pdf,.zip,.rar,.7z,.txt,.cpp,.c,.py,.java,.pas,.in,.out,.md"
                    onChange={handleAttachmentUpload}
                    disabled={uploadingAttachment}
                    className={unifiedStyles.u24}
                  />
                  {uploadingAttachment && <span className={unifiedStyles.u38}>上传中...</span>}
                </div>

                <div className={unifiedStyles.u39}>
                  <label className={unifiedStyles.u8}>已上传附件</label>
                  {attachmentsLoading ? (
                    <div className={unifiedStyles.u40}><span className={[("resource-skeleton-line"), collisionStyles.u2].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div>
                  ) : attachments.length === 0 ? (
                    <div className={unifiedStyles.u40}>暂无附件</div>
                  ) : (
                    <div>
                      {attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className={unifiedStyles.u41}
                        >
                          <div className={unifiedStyles.u16}>
                            <Paperclip aria-hidden="true" size={20} />
                            <div>
                              <div className={unifiedStyles.u15}>{attachment.fileName}</div>
                              <div className={unifiedStyles.u10}>
                                {formatFileSize(attachment.fileSize)}
                              </div>
                            </div>
                          </div>
                          <Button variant="outline" size="sm"
                            type="button"
                            onClick={() => handleAttachmentDelete(attachment.id)}
                            className={unifiedStyles.u42}
                          >
                            删除
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 远程附件（从 OJ 拉取的附件） */}
                {remoteAttachments.length > 0 && (
                  <div className={unifiedStyles.u39}>
                    <label className={unifiedStyles.u8}>
                      远程附件（从 OJ 拉取）
                    </label>
                    <p className={unifiedStyles.u32}>
                      以下附件来自 OJ 平台，点击下载后保存到本系统
                    </p>
                    <div>
                      {remoteAttachments.map((attachment, index) => (
                        <div
                          key={index}
                          className={unifiedStyles.u43}
                        >
                          <div className={unifiedStyles.u16}>
                            <span className={unifiedStyles.u44}>📥</span>
                            <div>
                              <div className={unifiedStyles.u15}>{attachment.filename}</div>
                              <div className={unifiedStyles.u10}>
                                待下载
                              </div>
                            </div>
                          </div>
                          <Button variant="ghost"
                            type="button"
                            onClick={() => handleDownloadRemoteAttachment(attachment)}
                            disabled={downloadingAttachment !== null}
                          >
                            {downloadingAttachment === attachment.filename ? '下载中...' : '下载'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 提交按钮 */}
          <div className={unifiedStyles.u45}>
            <Button variant="primary"
              type="button"
              onClick={() => router.push(mode === 'edit' && problemId ? `${pathPrefix}/problems/${problemId}` : `${pathPrefix}/problems`)}
              className={unifiedStyles.u36}
            >
              取消
            </Button>
            <Button variant="ghost"
              type="submit"
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </Button>
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
