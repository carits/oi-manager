'use client'

import { publicErrorMessage } from '@/lib/humanErrors'

import { useAuth } from '@/features/auth'
import { normalizeOjPlatformKey } from '@/lib/oj-platforms'
import { ProblemPrimaryIdentity, type ProblemPrimaryIdentityValue } from './ProblemPrimaryIdentity'
import { readEditorBindings } from '../model/problemEditorBindings'
import { useState, useEffect, useRef } from 'react'
import collisionStyles from './ProblemForm.collision.module.css'
import unifiedStyles from './ProblemForm.unified.module.css'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
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
import type { ProblemAttachment, ProblemEditorMutation } from '@oi-manager/contracts'
import {
  deleteProblemAttachment, downloadOjProblemAttachment, fetchOjProblem,
  listProblemAttachments, uploadProblemAttachment, uploadProblemStatementPdf, uploadProblemTestdata,
} from '../api/problemFilesApi'

type OjBinding = ProblemOjBinding
interface OjAttachment { filename: string; downloadLink: string }
type Statement = ProblemContentVersion
interface ProblemFormProps {
  mode: 'create' | 'edit'
  role: 'teacher' | 'student' | 'admin'
  problemId?: string
}

const requestErrorMessage = publicErrorMessage

const problemDraftBootstraps = new Map<string, ReturnType<typeof createProblem>>()
type EditorDraft = Omit<ProblemEditorMutation, 'expectedUpdatedAt'>

/** Changing account, workspace or target must not reuse another editor's version or draft. */
export function ProblemForm(props: ProblemFormProps) {
  const { sessionKey } = useAuth()
  const pathname = usePathname()
  const prefix = currentWorkspacePrefix(pathname, props.role === 'admin' ? '/platform-admin' : '/personal')
  return <ProblemFormEditor key={`${sessionKey}:${prefix}:${props.mode}:${props.problemId || 'new'}`} {...props} />
}

function ProblemFormEditor({ mode, role, problemId }: ProblemFormProps) {
  const { user, sessionKey } = useAuth()
  const editorVersionRef = useRef('')
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const contextRef = useRef('')
  const loadRequestRef = useRef(0)
  const attachmentRequestRef = useRef(0)
  const manualSaveRef = useRef(false)
  const fingerprintRef = useRef('')
  const [primaryIdentity, setPrimaryIdentity] = useState<ProblemPrimaryIdentityValue>({ platform: '', problemId: '' })
  const [identityDraft, setIdentityDraft] = useState<ProblemPrimaryIdentityValue>({ platform: '', problemId: '' })
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [identityEditable, setIdentityEditable] = useState(false)
  const [stableReady, setStableReady] = useState(false)
  const [editorError, setEditorError] = useState('')
  const [bindingsError, setBindingsError] = useState('')
  const [loadError, setLoadError] = useState('')
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
  const [attachments, setAttachments] = useState<ProblemAttachment[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [deleteAttachmentConfirm, setDeleteAttachmentConfirm] = useState<{ isOpen: boolean; attachmentId: string | null }>({ isOpen: false, attachmentId: null })
  const [showJudgeConfigConfirm, setShowJudgeConfigConfirm] = useState(false)
  const [pendingSaveData, setPendingSaveData] = useState<{ createdId: string } | null>(null)
  const pathPrefix = currentWorkspacePrefix(pathname, role === 'admin' ? '/platform-admin' : '/personal')
  const editorContext = `${sessionKey}:${pathPrefix}:${problemId || 'new'}`

  useEffect(() => {
    // Setup must restore this after Strict Mode's cleanup/setup cycle.
    contextRef.current = editorContext
    return () => {
      contextRef.current = ''
      loadRequestRef.current++
      attachmentRequestRef.current++
    }
  }, [editorContext])

  // Materialize a private draft before uploading assets. Share only the request
  // for this exact authenticated editor, not a process-wide anonymous draft.
  useEffect(() => {
    if (mode !== 'create' || !user) return
    let cancelled = false
    const context = editorContext
    const bootstrap = async () => {
      const request = problemDraftBootstraps.get(context) || createProblem({ platform: 'carits', title: '未命名题目', status: 'draft', statements: [], solutions: [] })
      problemDraftBootstraps.set(context, request)
      try {
        const result = await request
        if (cancelled || contextRef.current !== context) return
        if (!result.ok || !result.data.id) {
          setLoadError(result.ok ? '无法创建题目草稿，请返回题库后重试' : result.error.userMessage)
          setLoading(false)
          return
        }
        router.replace(`${pathPrefix}/problems/${result.data.id}/edit?new=1`)
      } catch (error) {
        if (cancelled || contextRef.current !== context) return
        setLoadError(requestErrorMessage(error, '创建结果待确认，请先返回题库核对草稿，避免重复创建'))
        setLoading(false)
      } finally {
        window.setTimeout(() => {
          if (problemDraftBootstraps.get(context) === request) problemDraftBootstraps.delete(context)
        }, 1000)
      }
    }
    void bootstrap()
    return () => { cancelled = true }
  }, [mode, pathPrefix, router, editorContext, user?.userId])

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

  const [form, setForm] = useState<{
    title: string; platform: string; difficulty: string; timeLimit: string; memoryLimit: string
    visibility: string; status: 'draft' | 'published' | 'archived'
  }>({ title: '', platform: '', difficulty: '', timeLimit: '1000', memoryLimit: '256', visibility: 'private', status: 'draft' })
  const [statements, setStatements] = useState<Statement[]>([])
  const [solutions, setSolutions] = useState<Statement[]>([])
  const [ojBindings, setOjBindings] = useState<OjBinding[]>([])

  const buildProblemPayload = (): EditorDraft => {
    const data: EditorDraft = {
      title: form.title.trim() || '未命名题目',
      difficulty: form.difficulty || null,
      timeLimit: form.timeLimit ? Number(form.timeLimit) : null,
      memoryLimit: form.memoryLimit ? Number(form.memoryLimit) : null,
      status: form.status,
      statements: statements.map(s => ({ id: s.id, format: s.format, language: s.language, content: s.content, fileUrl: s.fileUrl, isVisible: s.isVisible })),
      solutions: solutions.map(s => ({ id: s.id, format: s.format, language: s.language, content: s.content, fileUrl: s.fileUrl, isVisible: s.isVisible })),
    }
    if (role === 'admin') data.visibility = form.visibility
    // Omission preserves unreadable historical data. [] is reserved for an
    // intentionally empty, successfully loaded binding editor.
    if (!bindingsError) {
      data.ojBindings = ojBindings.filter(binding => binding.platform || binding.problemId.trim()).map(binding => ({
        ...binding, platform: normalizeOjPlatformKey(binding.platform) || binding.platform, problemId: binding.problemId.trim(),
      }))
    }
    if (editingIdentity && (identityDraft.platform !== primaryIdentity.platform || identityDraft.problemId.trim() !== primaryIdentity.problemId)) {
      data.platform = identityDraft.platform
      data.problemId = identityDraft.problemId.trim()
    }
    return data
  }

  const isAutoSaveDraft = mode === 'edit' && searchParams.get('new') === '1'
  const currentFingerprint = JSON.stringify(buildProblemPayload())
  fingerprintRef.current = currentFingerprint
  const formDirty = savedFingerprintRef.current !== null && savedFingerprintRef.current !== currentFingerprint
  const { requestNavigation } = useUnsavedChanges(`problem-draft:${problemId || 'new'}`, formDirty || saving || autoSaveStatus === 'saving', `${currentFingerprint}\u0000${autoSaveStatus}`)
  useEffect(() => {
    if (loading || loadError || isAutoSaveDraft || mode !== 'edit' || loadedProblemIdRef.current !== problemId || fingerprintProblemIdRef.current === problemId) return
    savedFingerprintRef.current = currentFingerprint
    fingerprintProblemIdRef.current = problemId || null
    setAutoSaveStatus('saved')
  }, [currentFingerprint, isAutoSaveDraft, loading, loadError, mode, problemId])

  const [fetchingFromOj, setFetchingFromOj] = useState(false)
  const [remoteAttachments, setRemoteAttachments] = useState<OjAttachment[]>([])
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null)

  useEffect(() => {
    if (mode === 'edit' && problemId) {
      void fetchProblem()
      void fetchAttachments()
    }
    // Fetch functions intentionally belong to the keyed editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, problemId, editorContext])

  const persistEditorDraft = (draft: EditorDraft) => {
    const context = editorContext
    const fingerprint = JSON.stringify(draft)
    const task = saveQueueRef.current.catch(() => undefined).then(async () => {
      if (contextRef.current !== context || !problemId || !editorVersionRef.current || loadedProblemIdRef.current !== problemId) {
        throw new Error('编辑上下文已改变或题目未加载，请重新打开题目')
      }
      setAutoSaveStatus('saving')
      const result = await updateProblem(problemId, { ...draft, expectedUpdatedAt: editorVersionRef.current })
      if (contextRef.current !== context) return result
      if (!result.ok) {
        setAutoSaveStatus('failed')
        setEditorError(result.error.userMessage || '保存失败，草稿已保留')
        return result
      }
      editorVersionRef.current = result.data.updatedAt
      savedFingerprintRef.current = fingerprint
      if (draft.platform !== undefined && fingerprintRef.current === fingerprint) {
        const identity = { platform: result.data.platform, problemId: result.data.problemId }
        setPrimaryIdentity(identity)
        setIdentityDraft(identity)
        setEditingIdentity(false)
        const { platform: _platform, problemId: _number, ...content } = draft
        savedFingerprintRef.current = JSON.stringify(content)
      }
      if (draft.status === 'published' || draft.status === 'archived') setIdentityEditable(false)
      setEditorError('')
      setAutoSaveStatus(fingerprintRef.current === fingerprint ? 'saved' : 'dirty')
      return result
    })
    saveQueueRef.current = task
    return task
  }

  useEffect(() => {
    if (loading || loadError || saving || !isAutoSaveDraft || !problemId || loadedProblemIdRef.current !== problemId || editingIdentity || editorError) return
    if (savedFingerprintRef.current === null) {
      savedFingerprintRef.current = currentFingerprint
      setAutoSaveStatus('saved')
      return
    }
    if (savedFingerprintRef.current === currentFingerprint) return
    setAutoSaveStatus('dirty')
    const draft = buildProblemPayload()
    const timer = window.setTimeout(() => {
      if (manualSaveRef.current || contextRef.current !== editorContext) return
      void persistEditorDraft(draft).catch(error => {
        if (contextRef.current !== editorContext) return
        setAutoSaveStatus('failed')
        setEditorError(requestErrorMessage(error, '保存失败，草稿已保留'))
      })
    }, 800)
    return () => window.clearTimeout(timer)
    // Payload is represented by its fingerprint; identity changes require an explicit save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFingerprint, isAutoSaveDraft, loading, loadError, saving, problemId, editorContext, editingIdentity, editorError])

  const fetchProblem = async () => {
    const context = editorContext
    const requestId = ++loadRequestRef.current
    const current = () => contextRef.current === context && loadRequestRef.current === requestId
    try {
      setLoading(true)
      setLoadError('')
      const p = await getProblemEditorDetail(problemId || '')
      if (!current()) return
      if (!p.permissions.canEdit) {
        setLoadError('你没有权限编辑这道题')
        router.replace(`${pathPrefix}/problems/${problemId}`)
        return
      }
      editorVersionRef.current = p.updatedAt
      const identity = { platform: p.platform, problemId: p.problemId }
      setPrimaryIdentity(identity)
      setIdentityDraft(identity)
      setEditingIdentity(false)
      setIdentityEditable(p.permissions.canEditIdentity)
      setStableReady(p.readiness.stable)
      setForm({
        title: p.title, platform: p.platform || '', difficulty: p.difficulty || '',
        timeLimit: p.timeLimit?.toString() ?? '1000', memoryLimit: p.memoryLimit?.toString() ?? '256',
        visibility: p.visibility || 'private', status: p.status,
      })
      const bindings = readEditorBindings(p.ojBindings)
      setBindingsError(bindings.ok ? '' : bindings.message)
      setOjBindings(bindings.ok ? bindings.bindings : [])
      const normalizeContent = (item: (typeof p.statements)[number]): Statement => ({
        id: item.id, format: item.format, language: item.language,
        content: item.content ?? null, fileUrl: item.fileUrl ?? null, isVisible: item.isVisible ?? true,
      })
      setStatements(p.statements.map(normalizeContent))
      setSolutions(p.solutions.map(normalizeContent))
      loadedProblemIdRef.current = problemId || null
    } catch (error) {
      if (current()) setLoadError(requestErrorMessage(error, '题目加载失败，未开放空白编辑器；请重试'))
    } finally {
      if (current()) setLoading(false)
    }
  }

  const fetchAttachments = async () => {
    if (!problemId) return
    const context = editorContext
    const requestId = ++attachmentRequestRef.current
    const current = () => contextRef.current === context && attachmentRequestRef.current === requestId
    try {
      setAttachmentsLoading(true)
      const result = await listProblemAttachments(problemId)
      if (current()) setAttachments(result)
    } catch (error) {
      if (current()) toast.error(requestErrorMessage(error, '附件加载失败'))
    } finally {
      if (current()) setAttachmentsLoading(false)
    }
  }

  const handleChange = (field: string, value: string | boolean) => setForm(prev => ({ ...prev, [field]: value }))
  const addStatement = (format: 'markdown' | 'pdf', language: 'zh' | 'en' | null) => {
    setStatements(prev => prev.some(s => s.format === format && s.language === language) ? prev : [
      ...prev, { format, language, content: null, fileUrl: null, isVisible: true },
    ])
  }
  const addSolution = (format: 'markdown' | 'pdf', language: 'zh' | 'en' | null) => {
    setSolutions(prev => prev.some(s => s.format === format && s.language === language) ? prev : [
      ...prev, { format, language, content: null, fileUrl: null, isVisible: true },
    ])
  }
  const updateStatement = (index: number, updates: Partial<Statement>) => {
    setStatements(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item))
  }
  const updateSolution = (index: number, updates: Partial<Statement>) => {
    setSolutions(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item))
  }
  const removeStatement = (index: number) => setStatements(current => current.filter((_, i) => i !== index))
  const removeSolution = (index: number) => setSolutions(current => current.filter((_, i) => i !== index))

  const uploadPdf = async (type: 'statement' | 'solution', index: number, file: File) => {
    if (!problemId) return
    const context = editorContext
    const target = (type === 'statement' ? statements : solutions)[index]
    if (!target) return
    try {
      const result = await uploadProblemStatementPdf(problemId, type, file)
      if (contextRef.current !== context) return
      if (!result.success || !result.data) throw new Error('PDF 上传失败')
      const uploaded = result.data
      const apply = (items: Statement[]) => items.map(item => item === target
        ? { ...item, fileUrl: uploaded.fileUrl, id: uploaded.id } : item)
      // Never attach a late upload to the different row now occupying this index.
      if (type === 'statement') setStatements(apply)
      else setSolutions(apply)
    } catch (error) {
      if (contextRef.current === context) toast.error(requestErrorMessage(error, '上传失败'))
    }
  }

  const addOjBinding = () => {
    if (!bindingsError) setOjBindings(current => current.length < 3 ? [...current, { platform: '', problemId: '' }] : current)
  }
  const removeOjBinding = (index: number) => {
    if (!bindingsError) setOjBindings(current => current.filter((_, i) => i !== index))
  }
  const updateOjBinding = (index: number, field: 'platform' | 'problemId', value: string) => {
    if (!bindingsError) setOjBindings(current => current.map((binding, i) => i === index ? { ...binding, [field]: value } : binding))
  }

  // Explicit management import remains separate from local problem-number lookup.
  const handleFetchFromOj = async (index: number) => {
    if (bindingsError) return
    const binding = ojBindings[index]
    if (!binding?.platform || !binding.problemId.trim()) { toast.warning('请先选择平台并输入题号'); return }
    const context = editorContext
    try {
      setFetchingFromOj(true)
      const problem = await fetchOjProblem(binding.platform, binding.problemId.trim())
      if (contextRef.current !== context) return
      setForm(prev => ({
        ...prev, title: problem.title || prev.title,
        timeLimit: problem.timeLimit ? String(problem.timeLimit) : prev.timeLimit,
        memoryLimit: problem.memoryLimit ? String(problem.memoryLimit) : prev.memoryLimit,
        difficulty: problem.difficulty || prev.difficulty,
      }))
      if (problem.description) {
        setStatements(prev => prev.some(s => s.format === 'markdown' && s.language === 'zh') ? prev : [
          ...prev, { format: 'markdown', language: 'zh', content: problem.description ?? null, fileUrl: null, isVisible: true },
        ])
      }
      if (problem.attachments && problem.attachments.length > 0) {
        setRemoteAttachments(problem.attachments)
        toast.success(`已拉取题目：${problem.title}\n发现 ${problem.attachments.length} 个附件，请在附件标签页下载`)
      } else toast.success(`已拉取题目：${problem.title}`)
    } catch (error) {
      if (contextRef.current === context) toast.error(requestErrorMessage(error, '拉取失败'))
    } finally {
      if (contextRef.current === context) setFetchingFromOj(false)
    }
  }

  const handleDownloadRemoteAttachment = async (attachment: OjAttachment) => {
    if (!problemId) { toast.warning('请先保存题目后再下载附件'); return }
    const context = editorContext
    try {
      setDownloadingAttachment(attachment.filename)
      const result = await downloadOjProblemAttachment({ problemId, url: attachment.downloadLink, filename: attachment.filename })
      if (contextRef.current !== context) return
      if (result.ok) {
        setRemoteAttachments(prev => prev.filter(a => a.filename !== attachment.filename))
        void fetchAttachments()
        toast.success(`附件 "${attachment.filename}" 下载成功`)
      } else toast.error(result.error.userMessage || '下载失败')
    } catch (error) {
      if (contextRef.current === context) toast.error(requestErrorMessage(error, '下载失败'))
    } finally {
      if (contextRef.current === context) setDownloadingAttachment(null)
    }
  }

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file || !problemId) return
    const context = editorContext
    try {
      setUploadingAttachment(true)
      const result = await uploadProblemAttachment(problemId, file)
      if (contextRef.current !== context) return
      if (result.success) void fetchAttachments()
      else console.error('Attachment upload response:', result); toast.error('上传失败')
    } catch (error) {
      if (contextRef.current === context) toast.error(requestErrorMessage(error, '上传失败'))
    } finally {
      input.value = ''
      if (contextRef.current === context) setUploadingAttachment(false)
    }
  }

  const handleAttachmentDelete = (attachmentId: string) => setDeleteAttachmentConfirm({ isOpen: true, attachmentId })
  const confirmDeleteAttachment = async () => {
    const attachmentId = deleteAttachmentConfirm.attachmentId
    if (!attachmentId || !problemId) return
    const context = editorContext
    setDeleteAttachmentConfirm({ isOpen: false, attachmentId: null })
    try {
      await deleteProblemAttachment(problemId, attachmentId)
      if (contextRef.current === context) void fetchAttachments()
    } catch (error) {
      if (contextRef.current === context) toast.error(requestErrorMessage(error, '删除失败'))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (manualSaveRef.current || loading || loadError) return
    if (!form.title.trim()) { toast.warning('请输入题目标题'); return }
    manualSaveRef.current = true
    const context = editorContext
    try {
      setSaving(true)
      const data = buildProblemPayload()
      if (mode === 'create' || !problemId) throw new Error('草稿尚未创建完成')
      if (!bindingsError && ojBindings.some(binding => Boolean(binding.platform) !== Boolean(binding.problemId.trim()))) {
        throw new Error('附加来源必须同时填写平台和题号')
      }
      const savedFingerprint = JSON.stringify(data)
      const result = await persistEditorDraft(data)
      if (contextRef.current !== context) return
      if (!result.ok) { toast.error(result.error.userMessage || '保存失败，草稿已保留'); return }
      if (fingerprintRef.current !== savedFingerprint && fingerprintRef.current !== savedFingerprintRef.current) {
        toast.success('当前版本已保存，后续修改仍在草稿中')
        return
      }
      fingerprintProblemIdRef.current = problemId
      setAutoSaveStatus('saved')
      const createdId = result.data.id || problemId
      if (!loadedProblemIdRef.current) {
        const stagedFiles = judgeSettingsRef.current?.getStagedFiles?.()
        if (stagedFiles && stagedFiles.length > 0) await uploadProblemTestdata(createdId, stagedFiles)
        await judgeSettingsRef.current?.saveConfig?.(createdId)
        if (contextRef.current === context) router.push(`${pathPrefix}/problems/${createdId}/edit?tab=judge_settings`)
      } else if (judgeSettingsRef.current?.isDirty()) {
        setPendingSaveData({ createdId })
        setShowJudgeConfigConfirm(true)
      } else router.push(`${pathPrefix}/problems/${createdId}`)
    } catch (error) {
      if (contextRef.current !== context) return
      setAutoSaveStatus('failed')
      setEditorError(requestErrorMessage(error, '保存失败，草稿已保留'))
      toast.error(requestErrorMessage(error, '保存失败，草稿已保留'))
    } finally {
      manualSaveRef.current = false
      if (contextRef.current === context) setSaving(false)
    }
  }

  const handleConfirmSaveJudgeConfig = async () => {
    const context = editorContext
    try {
      await judgeSettingsRef.current?.saveConfig()
    } catch (error) {
      if (contextRef.current === context) toast.error(requestErrorMessage(error, '评测配置保存失败，题目内容已保存；配置草稿仍保留'))
      return
    }
    if (contextRef.current !== context) return
    setShowJudgeConfigConfirm(false)
    if (pendingSaveData) router.push(`${pathPrefix}/problems/${pendingSaveData.createdId}`)
    setPendingSaveData(null)
  }
  const handleCancelSaveJudgeConfig = () => {
    setShowJudgeConfigConfirm(false)
    if (pendingSaveData) router.push(`${pathPrefix}/problems/${pendingSaveData.createdId}`)
    setPendingSaveData(null)
  }

  if (loading) return <div className={unifiedStyles.u1}>
    <span className={['resource-skeleton-line', collisionStyles.u1].filter(Boolean).join(' ')} aria-label="内容正在准备" />
  </div>
  if (loadError) return <div className={unifiedStyles.u2}>
    <p role="alert">{loadError}</p>
    {mode === 'edit' && <Button type="button" onClick={() => void fetchProblem()}>重新加载</Button>}
    <Button type="button" variant="ghost" onClick={() => router.push(`${pathPrefix}/problems`)}>返回题库</Button>
  </div>

  return (
    <div className={unifiedStyles.u2}>
      <div className={unifiedStyles.u3}>
        <Button variant="ghost" onClick={() => requestNavigation(mode === 'edit' && problemId ? `${pathPrefix}/problems/${problemId}` : `${pathPrefix}/problems`)} className={unifiedStyles.u4}>← 返回</Button>
        <form onSubmit={handleSubmit}>
          <div className={unifiedStyles.u5}>
            <h2 className={unifiedStyles.u6}>{mode === 'create' ? '正在创建题目草稿' : isAutoSaveDraft ? '题目草稿' : '编辑题目'}</h2>
            <p aria-live="polite" className={unifiedStyles.u8}>
              {saving || autoSaveStatus === 'saving' ? '正在保存…' : autoSaveStatus === 'failed' ? '保存失败，草稿已保留，请使用页面底部的保存按钮重试' : formDirty ? '有更改待保存' : '当前版本已保存'}
            </p>
            {editorError && <p role="alert" className={unifiedStyles.u32}>{editorError}</p>}
            {bindingsError && activeTab !== 'settings' && <p role="alert" className={unifiedStyles.u32}>{bindingsError}</p>}
            <ProblemPrimaryIdentity current={primaryIdentity} value={identityDraft} editing={editingIdentity}
              editable={identityEditable} disabled={saving || autoSaveStatus === 'saving'} stable={stableReady}
              published={form.status === 'published'} onEditing={setEditingIdentity} onChange={setIdentityDraft} />
            <div className={unifiedStyles.u7}>
              <div>
                <label className={unifiedStyles.u8}>标题 *</label>
                <Input type="text" value={form.title} onChange={(e) => handleChange('title', e.target.value)} className={unifiedStyles.u9} placeholder="请输入题目标题" />
              </div>
              <div>
                <label className={unifiedStyles.u8}>难度</label>
                <Select aria-label="选择难度" value={form.difficulty} onChange={(e) => handleChange('difficulty', e.target.value)} className={unifiedStyles.u9}>
                  <option value="">请选择</option><option value="简单">简单</option><option value="中等">中等</option><option value="困难">困难</option>
                </Select>
              </div>
              <div>
                <label className={unifiedStyles.u8}>时间限制</label>
                <Input type="number" value={form.timeLimit} onChange={(e) => handleChange('timeLimit', e.target.value)} className={unifiedStyles.u9} placeholder="1000" />
                <span className={unifiedStyles.u10}>ms</span>
              </div>
              <div>
                <label className={unifiedStyles.u8}>空间限制</label>
                <Input type="number" value={form.memoryLimit} onChange={(e) => handleChange('memoryLimit', e.target.value)} className={unifiedStyles.u9} placeholder="256" />
                <span className={unifiedStyles.u10}>MB</span>
              </div>
            </div>
          </div>
          <div className={unifiedStyles.u11}>
            <Button variant="ghost" type="button" onClick={() => handleTabChange('statement')} className={unifiedStyles.tabButton} aria-selected={activeTab === 'statement'}>题面</Button>
            <Button variant="ghost" type="button" onClick={() => handleTabChange('solution')} className={unifiedStyles.tabButton} aria-selected={activeTab === 'solution'}>题解</Button>
            <Button variant="ghost" type="button" onClick={() => handleTabChange('judge_settings')} className={unifiedStyles.tabButton} aria-selected={activeTab === 'judge_settings'}>评测设置</Button>
            <Button variant="ghost" type="button" onClick={() => handleTabChange('settings')} className={unifiedStyles.tabButton} aria-selected={activeTab === 'settings'}>发布设置</Button>
            {mode === 'edit' && <Button variant="ghost" type="button" onClick={() => handleTabChange('attachments')} className={`${unifiedStyles.tabButton} ${unifiedStyles.attachmentTab}`} aria-selected={activeTab === 'attachments'}>
              附件{attachments.length > 0 && <span className={unifiedStyles.u12}>{attachments.length}</span>}
            </Button>}
          </div>
          <div className={unifiedStyles.u5}>
            {activeTab === 'statement' && <ProblemContentVersions kind="statement" items={statements} mode={mode} problemId={problemId} editMode={editMode}
              onEditModeChange={setEditMode} onUpdate={updateStatement} onRemove={removeStatement} onAdd={addStatement} onUploadPdf={(index, file) => void uploadPdf('statement', index, file)} />}
            {activeTab === 'solution' && <ProblemContentVersions kind="solution" items={solutions} mode={mode} problemId={problemId} editMode={editMode}
              onEditModeChange={setEditMode} onUpdate={updateSolution} onRemove={removeSolution} onAdd={addSolution} onUploadPdf={(index, file) => void uploadPdf('solution', index, file)} />}
            {activeTab === 'judge_settings' && <JudgeSettingsTab ref={judgeSettingsRef} problemId={problemId || ''} timeLimit={form.timeLimit} memoryLimit={form.memoryLimit}
              onTimeLimitChange={(v) => handleChange('timeLimit', v)} onMemoryLimitChange={(v) => handleChange('memoryLimit', v)} />}
            {activeTab === 'settings' && <ProblemPublishingSettings role={role} status={form.status} bindings={ojBindings} bindingsError={bindingsError} fetching={fetchingFromOj}
              onStatusChange={(value) => handleChange('status', value)} onBindingChange={updateOjBinding} onFetch={(index) => void handleFetchFromOj(index)} onRemove={removeOjBinding} onAdd={addOjBinding} />}
            {activeTab === 'attachments' && <ProblemAttachments attachments={attachments} remoteAttachments={remoteAttachments} loading={attachmentsLoading}
              uploading={uploadingAttachment} downloadingFilename={downloadingAttachment} onUpload={handleAttachmentUpload} onDelete={handleAttachmentDelete}
              onDownloadRemote={(attachment) => void handleDownloadRemoteAttachment(attachment)} />}
          </div>
          <div className={unifiedStyles.u45}>
            <Button variant="primary" type="button" onClick={() => requestNavigation(mode === 'edit' && problemId ? `${pathPrefix}/problems/${problemId}` : `${pathPrefix}/problems`)} className={unifiedStyles.u36}>取消</Button>
            <Button variant="ghost" type="submit" disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </form>
      </div>
      <ConfirmModal isOpen={deleteAttachmentConfirm.isOpen} onClose={() => setDeleteAttachmentConfirm({ isOpen: false, attachmentId: null })}
        onConfirm={confirmDeleteAttachment} title="删除附件" message="确定要删除这个附件吗？" confirmText="删除" danger />
      <ConfirmModal isOpen={showJudgeConfigConfirm} onClose={handleCancelSaveJudgeConfig} onConfirm={handleConfirmSaveJudgeConfig}
        title="保存评测配置" message="检测到评测配置有修改，是否同时保存评测配置？" confirmText="保存评测配置" cancelText="跳过" />
    </div>
  )
}
