'use client'

import { useState, useEffect, useRef } from 'react'
import collisionStyles from './ProblemForm.collision.module.css'
import unifiedStyles from './ProblemForm.unified.module.css'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { JudgeSettingsTab, JudgeSettingsTabHandle } from './JudgeSettingsTab'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { useUnsavedChanges } from '@/components/navigation/UnsavedChangesProvider'
import { ProblemContentVersions, type ProblemContentVersion } from './ProblemContentVersions'
import { ProblemPublishingSettings, type ProblemOjBinding } from './ProblemPublishingSettings'
import { ProblemAttachments } from './ProblemAttachments'
import { createProblem, getProblemEditorDetail, updateProblem } from '../api/problemEditorApi'
import type { ProblemAttachment, ProblemCreateInput } from '@oi-manager/contracts'
import {
  deleteProblemAttachment, deleteProblemStatement, downloadOjProblemAttachment, fetchOjProblem,
  listProblemAttachments, uploadProblemAttachment, uploadProblemStatementPdf, uploadProblemTestdata,
} from '../api/problemFilesApi'

type OjBinding = ProblemOjBinding

interface OjAttachment {
  filename: string
  downloadLink: string
}

const requestErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string; error?: { message?: string } } } }).response
    return response?.data?.error?.message || response?.data?.message || fallback
  }
  return fallback
}

type Statement = ProblemContentVersion

interface ProblemFormProps {
  mode: 'create' | 'edit'
  role: 'teacher' | 'student' | 'admin'
  problemId?: string
}

let problemDraftBootstrap: ReturnType<typeof createProblem> | null = null

export function ProblemForm({ mode, role, problemId }: ProblemFormProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'failed'>('idle')
  const savedFingerprintRef = useRef<string | null>(null)
  const loadedProblemIdRef = useRef<string | null>(null)
  const fingerprintProblemIdRef = useRef<string | null>(null)
  const judgeSettingsRef = useRef<JudgeSettingsTabHandle>(null)
  const [loading, setLoading] = useState(true)
  type TabType = 'statement' | 'solution' | 'judge_settings' | 'settings' | 'attachments'
  const VALID_TABS: TabType[] = ['statement', 'solution', 'judge_settings', 'settings', 'attachments']
  const [activeTab, setActiveTab] = useState<TabType>(
    VALID_TABS.includes(searchParams.get('tab') as TabType) ? (searchParams.get('tab') as TabType) : 'statement'
  )
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('edit')

  // 附件状态
  const [attachments, setAttachments] = useState<ProblemAttachment[]>([])
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
      const request = problemDraftBootstrap ||= createProblem({ title: '未命名题目', status: 'draft', statements: [], solutions: [] })
      const result = await request
      window.setTimeout(() => { if (problemDraftBootstrap === request) problemDraftBootstrap = null }, 1000)
      if (!result.ok || !result.data.id) {
        setLoading(false); toast.error(result.ok ? '无法创建题目草稿，请重试' : result.error.message)
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
  const [form, setForm] = useState<{
    title: string
    platform: string
    difficulty: string
    timeLimit: string
    memoryLimit: string
    visibility: string
    status: 'draft' | 'published' | 'archived'
  }>({
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

  const buildProblemPayload = (): ProblemCreateInput => {
    const data: ProblemCreateInput = {
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
  const formDirty = savedFingerprintRef.current !== null && savedFingerprintRef.current !== currentFingerprint
  const { requestNavigation } = useUnsavedChanges(`problem-draft:${problemId || 'new'}`, formDirty || autoSaveStatus === 'saving')
  useEffect(() => {
    if (loading || isAutoSaveDraft || mode !== 'edit' || loadedProblemIdRef.current !== problemId || fingerprintProblemIdRef.current === problemId) return
    savedFingerprintRef.current = currentFingerprint
    fingerprintProblemIdRef.current = problemId || null
  }, [currentFingerprint, isAutoSaveDraft, loading, mode, problemId])

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
      const result = await updateProblem(problemId, buildProblemPayload())
      if (result.ok) {
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
      const p = await getProblemEditorDetail(problemId || '')
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
          setOjBindings(typeof p.ojBindings === 'string' ? JSON.parse(p.ojBindings) : p.ojBindings)
        }
        // 加载多版本数据
        const normalizeContent = (item: (typeof p.statements)[number]): Statement => ({
          id: item.id,
          format: item.format,
          language: item.language,
          content: item.content ?? null,
          fileUrl: item.fileUrl ?? null,
          isVisible: item.isVisible ?? true,
        })
        setStatements((p.statements || []).map(normalizeContent))
        setSolutions((p.solutions || []).map(normalizeContent))
        loadedProblemIdRef.current = problemId || null
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
      setAttachments(await listProblemAttachments(problemId))
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
        await deleteProblemStatement(problemId, stmt.id)
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
        await deleteProblemStatement(problemId, sol.id)
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
      const result = await uploadProblemStatementPdf(problemId, type, file)
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
      const problem = await fetchOjProblem(binding.platform, binding.problemId.trim())

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
              updated[idx] = { ...updated[idx], content: problem.description ?? null }
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
    } catch (error: unknown) {
      console.error('Failed to fetch from OJ:', error)
      toast.error(requestErrorMessage(error, '拉取失败'))
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
      const result = await downloadOjProblemAttachment({
        problemId,
        url: attachment.downloadLink,
        filename: attachment.filename,
      })

      if (result.ok) {
        setRemoteAttachments(prev => prev.filter(a => a.filename !== attachment.filename))
        fetchAttachments()
        toast.success(`附件 "${attachment.filename}" 下载成功`)
      } else {
        toast.error(result.error.message || '下载失败')
      }
    } catch (error: unknown) {
      console.error('Failed to download attachment:', error)
      toast.error(requestErrorMessage(error, '下载失败'))
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
      const result = await uploadProblemAttachment(problemId, file)

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
      await deleteProblemAttachment(problemId!, attachmentId)
      fetchAttachments()
    } catch (error) {
      console.error('Failed to delete attachment:', error)
      toast.error('删除失败')
    }
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
        result = await createProblem(data)
      } else {
        result = await updateProblem(problemId || '', data)
      }

      if (result.ok) {
        savedFingerprintRef.current = JSON.stringify(data)
        fingerprintProblemIdRef.current = problemId || result.data.id || null
        setAutoSaveStatus('saved')
        const createdId = result.data.id || problemId

        // 创建模式：上传暂存的评测数据 + 保存评测配置
        if (mode === 'create') {
          const stagedFiles = judgeSettingsRef.current?.getStagedFiles?.()
          if (stagedFiles && stagedFiles.length > 0) {
            try {
              await uploadProblemTestdata(createdId!, stagedFiles)
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
          setPendingSaveData({ createdId: createdId! })
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
          onClick={() => requestNavigation(mode === 'edit' && problemId ? `${pathPrefix}/problems/${problemId}` : `${pathPrefix}/problems`)}
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
              <ProblemContentVersions
                kind="statement"
                items={statements}
                mode={mode}
                problemId={problemId}
                editMode={editMode}
                onEditModeChange={setEditMode}
                onUpdate={updateStatement}
                onRemove={(index) => void removeStatement(index)}
                onAdd={addStatement}
                onUploadPdf={(index, file) => void uploadPdf('statement', index, file)}
              />
            )}

            {activeTab === 'solution' && (
              <ProblemContentVersions
                kind="solution"
                items={solutions}
                mode={mode}
                problemId={problemId}
                editMode={editMode}
                onEditModeChange={setEditMode}
                onUpdate={updateSolution}
                onRemove={(index) => void removeSolution(index)}
                onAdd={addSolution}
                onUploadPdf={(index, file) => void uploadPdf('solution', index, file)}
              />
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
              <ProblemPublishingSettings
                role={role}
                status={form.status}
                bindings={ojBindings}
                fetching={fetchingFromOj}
                onStatusChange={(value) => handleChange('status', value)}
                onBindingChange={updateOjBinding}
                onFetch={(index) => void handleFetchFromOj(index)}
                onRemove={removeOjBinding}
                onAdd={addOjBinding}
              />
            )}


            {activeTab === 'attachments' && (
              <ProblemAttachments
                attachments={attachments}
                remoteAttachments={remoteAttachments}
                loading={attachmentsLoading}
                uploading={uploadingAttachment}
                downloadingFilename={downloadingAttachment}
                onUpload={handleAttachmentUpload}
                onDelete={handleAttachmentDelete}
                onDownloadRemote={(attachment) => void handleDownloadRemoteAttachment(attachment)}
              />
            )}

          </div>

          {/* 提交按钮 */}
          <div className={unifiedStyles.u45}>
            <Button variant="primary"
              type="button"
              onClick={() => requestNavigation(mode === 'edit' && problemId ? `${pathPrefix}/problems/${problemId}` : `${pathPrefix}/problems`)}
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
