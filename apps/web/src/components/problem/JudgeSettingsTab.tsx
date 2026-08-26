'use client'

import { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import collisionStyles from './JudgeSettingsTab.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './JudgeSettingsTab.unified.module.css'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import yaml from 'js-yaml'
import apiClient from '@/lib/apiClient'
import { filenameFromContentDisposition, saveBlobDownload } from '@/lib/download'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ProblemHackConfigPanel } from './ProblemHackConfigPanel'
import { ProblemTestGraphPanel } from './ProblemTestGraphPanel'
import { LANGUAGE_OPTIONS } from '@/lib/judge-constants'

// ==================== 类型定义 ====================

interface JudgeSettingsTabProps {
  problemId: string
  timeLimit: string
  memoryLimit: string
  onTimeLimitChange: (v: string) => void
  onMemoryLimitChange: (v: string) => void
}

export interface JudgeSettingsTabHandle {
  saveConfig: (overrideProblemId?: string) => Promise<void>
  isDirty: () => boolean
  getStagedFiles: () => File[]
}

interface TestdataFile {
  id: string
  filename: string
  size: number
  md5: string | null
  sha256?: string | null
  uploadedAt: string
}
interface CheckerFile { id: string; fileName: string; fileSize: number; fileUrl: string; uploadedAt: string }

interface TestCasePair {
  input: string
  output: string
  score?: number  // 单个测试点分数（用于 sum 类型）
}

interface SubtaskConfig {
  id: number
  score: number
  type: 'min' | 'max' | 'sum'
  if?: number[]
  time?: string
  memory?: string
  cases: TestCasePair[]
}

interface JudgeConfig {
  mode?: 'acm' | 'oi'
  type?: string
  checker_type?: string
  filename?: string
  time?: string
  memory?: string
  checker?: string | { file: string; lang?: string } | null
  interactor?: { file: string; lang?: string } | null
  manager?: { file: string; lang?: string } | null
  num_processes?: number
  subType?: string
  user_extra_files?: string[]
  judge_extra_files?: string[]
  langs?: string[]
  subtasks?: SubtaskConfig[]
}

// ==================== 常量 ====================

const PROBLEM_TYPES = [
  { value: 'default', label: '传统题' },
  { value: 'interactive', label: '交互题' },
  { value: 'communication', label: '通信题' },
  { value: 'submit_answer', label: '提交答案题' },
  { value: 'objective', label: '客观题' },
] as const

const CHECKER_INTERFACES = [
  { value: 'syzoj', label: 'SYZOJ' },
  { value: 'hustoj', label: 'HUSTOJ' },
  { value: 'lemon', label: 'Lemon' },
  { value: 'kattis', label: 'Kattis' },
  { value: 'qduoj', label: 'QDUOJ' },
]

const SUBTASK_TYPES = [
  { value: 'min', label: 'Min（取最小）' },
  { value: 'max', label: 'Max（取最大）' },
  { value: 'sum', label: 'Sum（求和）' },
] as const

// ==================== 样式常量 ====================

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.625rem',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  outline: 'none',
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.625rem',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  outline: 'none',
}

const gridRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '1rem',
}

const sectionTitle: React.CSSProperties = {
  fontSize: '0.9375rem',
  fontWeight: 600,
  color: 'var(--gray-800)',
  marginBottom: '0.75rem',
  paddingBottom: '0.5rem',
  borderBottom: '1px solid var(--border)',
}

const cardStyle: React.CSSProperties = {
  padding: '1.25rem',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  background: 'white',
  marginBottom: '1.25rem',
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 500,
  marginBottom: '0.375rem',
  color: 'var(--gray-700)',
}

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.25rem',
  background: 'var(--primary)',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.875rem',
  fontWeight: 500,
}

const btnOutline: React.CSSProperties = {
  padding: '0.375rem 0.75rem',
  background: 'white',
  color: 'var(--gray-700)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.8125rem',
}

const btnDanger: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  background: 'transparent',
  color: 'var(--error)',
  border: '1px solid var(--error)',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.75rem',
}

// ==================== 主组件 ====================

export const JudgeSettingsTab = forwardRef<JudgeSettingsTabHandle, JudgeSettingsTabProps>(
  function JudgeSettingsTab({
    problemId,
    timeLimit,
    memoryLimit,
    onTimeLimitChange,
    onMemoryLimitChange,
  }: JudgeSettingsTabProps, ref) {
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initialConfigRef = useRef<string>('')

  // ==================== 状态 ====================
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'basic' | 'data' | 'subtasks' | 'testdata' | 'hack'>('basic')
  const [testGraphDirty, setTestGraphDirty] = useState(false)
  const [yamlCollapsed, setYamlCollapsed] = useState(true)

  // 基础配置
  const [problemType, setProblemType] = useState('default')
  const [judgeMode, setJudgeMode] = useState<'acm' | 'oi'>('acm')
  const [loadedJudgeMode, setLoadedJudgeMode] = useState<'acm' | 'oi'>('acm')
  const [pendingJudgeMode, setPendingJudgeMode] = useState<'acm' | 'oi' | null>(null)
  const [transitioningMode, setTransitioningMode] = useState(false)
  const [checkerType, setCheckerType] = useState('default')
  const [ignoreTrailingSpace, setIgnoreTrailingSpace] = useState(true)
  const [fileioPrefix, setFileioPrefix] = useState('')
  const [checkerFile, setCheckerFile] = useState('')
  const [checkerLang, setCheckerLang] = useState('auto')
  const [checkerCategory, setCheckerCategory] = useState<'preset' | 'custom'>('preset')
  const [checkerPreset, setCheckerPreset] = useState('acmp')
  const [interactorFile, setInteractorFile] = useState('')
  const [interactorLang, setInteractorLang] = useState('auto')
  const [managerFile, setManagerFile] = useState('')
  const [managerLang, setManagerLang] = useState('auto')
  const [numProcesses, setNumProcesses] = useState(2)
  const [submitAnswerMulti, setSubmitAnswerMulti] = useState(false)
  const [submitAnswerFilename, setSubmitAnswerFilename] = useState('#.txt')
  const [userExtraFiles, setUserExtraFiles] = useState<string[]>([])
  const [judgeExtraFiles, setJudgeExtraFiles] = useState<string[]>([])
  const [langs, setLangs] = useState<string[]>([])

  // 子任务
  const [subtasks, setSubtasks] = useState<SubtaskConfig[]>([])
  const [unassignedCases, setUnassignedCases] = useState<TestCasePair[]>([])
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<number>>(new Set())
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ score: '', time: '', memory: '', deps: '', type: 'min' })

  // 确认弹窗状态
  const [confirmState, setConfirmState] = useState<{ message: string; action: () => Promise<void> } | null>(null)

  // 测试数据
  const [testdataFiles, setTestdataFiles] = useState<TestdataFile[]>([])
  const [testdataPairs, setTestdataPairs] = useState<TestCasePair[]>([])
  const [uploading, setUploading] = useState(false)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [checkerFiles, setCheckerFiles] = useState<CheckerFile[]>([])
  const [checkerUploading, setCheckerUploading] = useState(false)
  const checkerInputRef = useRef<HTMLInputElement>(null)

  // 创建模式暂存区
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [stagedPairs, setStagedPairs] = useState<TestCasePair[]>([])

  // 从 File[] 自动检测配对
  const detectPairs = (files: File[]): TestCasePair[] => {
    const pairs: TestCasePair[] = []
    const inFiles = files.filter(f => f.name.endsWith('.in'))
    for (const inFile of inFiles) {
      const baseName = inFile.name.replace(/\.in$/, '')
      const outFile = files.find(f => f.name === `${baseName}.out`)
      const ansFile = files.find(f => f.name === `${baseName}.ans`)
      const outputFile = outFile || ansFile
      if (outputFile) {
        pairs.push({ input: inFile.name, output: outputFile.name })
      }
    }
    return pairs
  }

  // ==================== 构建配置对象 ====================

  const buildConfig = (subtasksOverride?: SubtaskConfig[]): Record<string, any> => {
    const st = subtasksOverride ?? subtasks
    const config: Record<string, any> = { mode: judgeMode, type: problemType }

    if (problemType === 'default') {
      if (checkerType === 'strict') config.checker_type = 'strict'
      else if (checkerType === 'testlib') {
        config.checker_type = 'testlib'
        if (checkerCategory === 'preset' && checkerPreset) config.checker = checkerPreset
        else if (checkerCategory === 'custom' && checkerFile) {
          config.checker = checkerLang === 'auto' ? checkerFile : { file: checkerFile, lang: checkerLang }
        }
      } else if (checkerType === 'lemon') {
        config.checker_type = 'lemon'
        config.checker = checkerFile || 'checker.cpp'
      } else if (checkerType === 'other') {
        config.checker_type = checkerPreset || 'syzoj'
        if (checkerFile) config.checker = checkerLang === 'auto' ? checkerFile : { file: checkerFile, lang: checkerLang }
      } else {
        config.checker_type = 'default'
      }
      if (fileioPrefix) config.filename = fileioPrefix
      if (!ignoreTrailingSpace) config.ignore_trailing_space = false
    }

    if (problemType === 'interactive' && interactorFile) {
      config.interactor = interactorLang === 'auto' ? interactorFile : { file: interactorFile, lang: interactorLang }
    }

    if (problemType === 'communication') {
      if (managerFile) config.manager = managerLang === 'auto' ? managerFile : { file: managerFile, lang: managerLang }
      if (numProcesses !== 2) config.num_processes = numProcesses
    }

    if (problemType === 'submit_answer') {
      if (submitAnswerMulti) config.subType = 'multi'
      if (submitAnswerFilename && submitAnswerFilename !== '#.txt') config.filename = submitAnswerFilename
    }

    config.time = globalTime
    config.memory = globalMemory

    if (userExtraFiles.length > 0) config.user_extra_files = userExtraFiles
    if (judgeExtraFiles.length > 0) config.judge_extra_files = judgeExtraFiles
    if (langs.length > 0) config.langs = langs

    if (judgeMode === 'oi' && st.length > 0) {
      config.subtasks = st.map(s => {
        const obj: Record<string, any> = { id: s.id, score: s.score, type: s.type }
        if (s.if && s.if.length > 0) obj.if = s.if
        if (s.time) obj.time = s.time
        if (s.memory) obj.memory = s.memory
        // 包含每个测试点的分数（用于 sum 类型）
        obj.cases = s.cases.map(c => ({ input: c.input, output: c.output, ...(c.score !== undefined && { score: c.score }) }))
        return obj
      })
    }

    return config
  }

  // ==================== YAML 预览 ====================

  // 全局时间/内存从父组件的 timeLimit/memoryLimit 生成，单位是 ms/MB
  const globalTime = timeLimit ? `${timeLimit}ms` : '1000ms'
  const globalMemory = memoryLimit ? `${memoryLimit}MB` : '256MB'

  const configForYaml = useMemo((): Record<string, any> => buildConfig(), [
    problemType, checkerType, ignoreTrailingSpace, fileioPrefix,
    checkerFile, checkerLang, checkerCategory, checkerPreset,
    interactorFile, interactorLang, managerFile, managerLang,
    numProcesses, submitAnswerMulti, submitAnswerFilename,
    userExtraFiles, judgeExtraFiles, langs, judgeMode,
    globalTime, globalMemory, subtasks,
  ])

  const yamlPreview = useMemo(() => {
    try {
      return yaml.dump(configForYaml, { lineWidth: -1, noArrayIndent: true })
    } catch {
      return '# YAML 生成失败'
    }
  }, [configForYaml])

  // ==================== 数据加载 ====================

  useEffect(() => {
    if (problemId) {
      fetchJudgeConfig()
      fetchTestdata()
      fetchCheckerFiles()
    }
  }, [problemId])

  const fetchJudgeConfig = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<any>(`/api/problems/${problemId}/judge-config`)
      if (result.success && result.data) {
        const { config, problemType: pt, timeLimit: tl, memoryLimit: ml } = result.data

        if (pt) setProblemType(pt)
        const resolvedMode = config?.mode === 'oi' || (config?.mode !== 'acm' && config?.subtasks?.length) ? 'oi' : 'acm'
        setJudgeMode(resolvedMode)
        setLoadedJudgeMode(resolvedMode)

        // 同步时间/内存到父组件（ProblemForm 的表单字段）
        if (tl != null && tl > 0) onTimeLimitChange(String(tl))
        else if (!timeLimit) onTimeLimitChange('1000') // 默认 1000ms = 1s
        if (ml != null && ml > 0) onMemoryLimitChange(String(ml))
        else if (!memoryLimit) onMemoryLimitChange('256') // 默认 256MB

        if (config) {
          const ct = config.checker_type || 'default'
          // 加载 ignore_trailing_space 配置
          if (config.ignore_trailing_space === false) {
            setIgnoreTrailingSpace(false)
          } else {
            setIgnoreTrailingSpace(true)
          }
          if (ct === 'default' || ct === 'strict') {
            setCheckerType(ct)
            setIgnoreTrailingSpace(ct === 'default')
          } else if (ct === 'testlib') {
            setCheckerType('testlib')
            if (config.checker) {
              if (typeof config.checker === 'string') {
                if (config.checker.includes('.')) { setCheckerCategory('custom'); setCheckerFile(config.checker) }
                else { setCheckerCategory('preset'); setCheckerPreset(config.checker) }
              } else {
                setCheckerCategory('custom')
                setCheckerFile(config.checker.file || '')
                setCheckerLang(config.checker.lang || 'auto')
              }
            }
          } else {
            setCheckerType('other')
            setCheckerPreset(ct)
            if (config.checker) {
              if (typeof config.checker === 'string') setCheckerFile(config.checker)
              else { setCheckerFile(config.checker.file || ''); setCheckerLang(config.checker.lang || 'auto') }
            }
          }
          if (config.filename && config.type === 'default') setFileioPrefix(config.filename)
          if (config.interactor) {
            if (typeof config.interactor === 'string') setInteractorFile(config.interactor)
            else { setInteractorFile(config.interactor.file || ''); setInteractorLang(config.interactor.lang || 'auto') }
          }
          if (config.manager) {
            if (typeof config.manager === 'string') setManagerFile(config.manager)
            else { setManagerFile(config.manager.file || ''); setManagerLang(config.manager.lang || 'auto') }
          }
          if (config.num_processes) setNumProcesses(config.num_processes)
          if (config.subType === 'multi') setSubmitAnswerMulti(true)
          if (config.filename && config.type === 'submit_answer') setSubmitAnswerFilename(config.filename)
          if (config.user_extra_files) setUserExtraFiles(config.user_extra_files)
          if (config.judge_extra_files) setJudgeExtraFiles(config.judge_extra_files)
          if (config.langs) setLangs(config.langs)

          if (config.subtasks && config.subtasks.length > 0) {
            console.log('[JudgeSettings] Loaded subtasks from server:', config.subtasks.length, JSON.stringify(config.subtasks))
            const loaded = config.subtasks.map((st: any) => ({
              id: st.id || 0, score: st.score || 0, type: st.type || 'min',
              if: st.if || [], time: st.time, memory: st.memory,
              cases: (st.cases || []).map((c: any) => ({ input: c.input, output: c.output, ...(c.score !== undefined && { score: c.score }) })),
            }))
            setSubtasks(loaded)
            // 自动展开已加载的子任务，让用户看到配置已恢复
            setExpandedSubtasks(new Set(loaded.map((st: SubtaskConfig) => st.id)))
          } else {
            console.log('[JudgeSettings] No subtasks in config. config.subtasks:', config.subtasks)
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch judge config:', error)
    } finally {
      setLoading(false)
    }
  }

  // 加载完成后捕获初始配置快照（用于脏检测）
  // 此时 fetchJudgeConfig 的所有 setState 已生效
  const initialConfigCaptured = useRef(false)
  useEffect(() => {
    if (!loading && problemId && !initialConfigCaptured.current) {
      initialConfigRef.current = JSON.stringify(buildConfig())
      initialConfigCaptured.current = true
    }
  }, [loading])

  const fetchTestdata = async () => {
    try {
      const result = await apiClient.get<any>(`/api/problems/${problemId}/testdata`)
      if (result.success && result.data) {
        setTestdataFiles(result.data.files || [])
        setTestdataPairs(result.data.pairs || [])
      }
    } catch (error) {
      console.error('Failed to fetch testdata:', error)
    }
  }

  const fetchCheckerFiles = async () => {
    if (!problemId) return
    try { const result = await apiClient.get<any>(`/api/problems/${problemId}/checker`); if (result.success) setCheckerFiles(result.data || []) } catch (error) { console.error("Failed to fetch checker files:", error) }
  }

  const handleCheckerUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (!files.length || !problemId) return
    try {
      setCheckerUploading(true)
      for (const file of files) { const form = new FormData(); form.append("file", file); const result = await apiClient.postFile(`/api/problems/${problemId}/checker`, form, { timeout: 120000 }); if (!result.success) throw new Error(result.message || "上传失败") }
      await fetchCheckerFiles(); toast.success("Checker 文件已上传")
      const cpp = files.find(file => /\.(cpp|cc|cxx)$/i.test(file.name)); if (cpp) setCheckerFile(cpp.name)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Checker 上传失败") }
    finally { setCheckerUploading(false); if (checkerInputRef.current) checkerInputRef.current.value = "" }
  }

  const handleCheckerDelete = async (file: CheckerFile) => {
    setConfirmState({ message: `确定要删除 ${file.fileName} 吗？`, action: async () => { try { const result = await apiClient.delete(`/api/problems/${problemId}/checker/${file.id}`); if (result.success) { setCheckerFiles(prev => prev.filter(item => item.id !== file.id)); if (checkerFile === file.fileName) setCheckerFile(""); toast.success("Checker 文件已删除") } else toast.error(result.message || "删除失败") } catch { toast.error("删除失败") } } })
  }

  // ==================== 保存配置 ====================

  const handleSaveConfig = async (subtasksOverride?: SubtaskConfig[], overrideProblemId?: string) => {
    const pid = overrideProblemId || problemId
    if (!pid) {
      toast.warning('请先保存题目基本信息')
      return
    }
    try {
      setSaving(true)
      const config: JudgeConfig = buildConfig(subtasksOverride)

      const timeVal = timeLimit ? parseInt(timeLimit) : 1000
      const memVal = memoryLimit ? parseInt(memoryLimit) : 256

      console.log('[JudgeSettings] Saving config, subtasks count:', config.subtasks?.length ?? 0,
        'subtasks:', JSON.stringify(config.subtasks))

      const result = await apiClient.put(`/api/problems/${pid}/judge-config`, {
        problemType,
        timeLimit: timeVal,
        memoryLimit: memVal,
        config,
      })

      if (result.success) {
        toast.success('评测配置已保存')
        // 更新初始配置快照（清除脏标记）
        initialConfigRef.current = JSON.stringify(buildConfig())
      } else {
        toast.error(result.message || '保存失败')
      }
    } catch (error) {
      console.error('[JudgeSettings] Save error:', error)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const confirmModeTransition = async () => {
    if (!pendingJudgeMode || pendingJudgeMode === loadedJudgeMode) { setPendingJudgeMode(null); return }
    if (!problemId) { setJudgeMode(pendingJudgeMode); setLoadedJudgeMode(pendingJudgeMode); setPendingJudgeMode(null); return }
    setTransitioningMode(true)
    try {
      const list = await apiClient.get<{ latestTestSetRevisionId: string | null }>(`/api/problems/${problemId}/test-set-revisions`)
      if (!list.success) return toast.error(list.message || '无法读取正式测试版本')
      if (!list.data?.latestTestSetRevisionId) {
        setJudgeMode(pendingJudgeMode)
        setLoadedJudgeMode(pendingJudgeMode)
        if (pendingJudgeMode === 'acm' && checkerType === 'lemon') {
          setCheckerType('default'); setCheckerFile(''); setCheckerCategory('preset')
        }
        if (pendingJudgeMode === 'oi' && subtasks.length === 0) {
          const cases = problemId ? testdataPairs : stagedPairs
          setSubtasks([{ id: 1, score: 100, type: 'min', cases }])
          setExpandedSubtasks(new Set([1]))
        }
        setPendingJudgeMode(null)
        return
      }
      const result = await apiClient.post(`/api/problems/${problemId}/judge-mode-transition`, {
        targetMode: pendingJudgeMode,
        expectedLatestRevisionId: list.data.latestTestSetRevisionId,
      })
      if (!result.success) return toast.error(result.message || '评测模式迁移失败')
      toast.success(result.message || '评测模式迁移完成')
      setJudgeMode(pendingJudgeMode)
      setLoadedJudgeMode(pendingJudgeMode)
      setPendingJudgeMode(null)
      await fetchJudgeConfig()
    } finally { setTransitioningMode(false) }
  }

  // 脏检测：对比当前配置与初始配置
  const checkIsDirty = (): boolean => {
    if (!initialConfigRef.current) return false
    return JSON.stringify(buildConfig()) !== initialConfigRef.current
  }

  // 暴露 saveConfig / isDirty / getStagedFiles 方法给父组件（ProblemForm 的主保存按钮调用）
  useImperativeHandle(ref, () => ({
    saveConfig: (overrideProblemId?: string) => handleSaveConfig(undefined, overrideProblemId),
    isDirty: checkIsDirty,
    getStagedFiles: () => stagedFiles,
  }))

  // ==================== 测试数据操作 ====================

  const uploadTestdataFiles = async (files: File[], replace = false) => {
    const formData = new FormData()
    for (const file of files) formData.append('files', file)
    if (replace) formData.append('replace', 'true')
    return apiClient.postFile(`/api/problems/${problemId}/testdata`, formData, { timeout: 120000 })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const selectedFiles = Array.from(files)

    if (!problemId) {
      // staged files before the problem exists
      setStagedFiles(prev => {
        const updated = [...prev, ...selectedFiles]
        setStagedPairs(detectPairs(updated))
        return updated
      })
      toast.success(`\u5df2\u6682\u5b58 ${selectedFiles.length} \u4e2a\u6587\u4ef6\uff0c\u4fdd\u5b58\u9898\u76ee\u540e\u5c06\u81ea\u52a8\u4e0a\u4f20`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    try {
      setUploading(true)
      const result = await uploadTestdataFiles(selectedFiles)
      if (result.success) {
        toast.success(`\u6210\u529f\u4e0a\u4f20 ${selectedFiles.length} \u4e2a\u6587\u4ef6`)
        fetchTestdata()
      } else if (result.status === 409 && result.code === 'TESTDATA_CONFLICT') {
        const data = result.data as { conflicts?: { filename: string }[] } | undefined
        const names = data?.conflicts?.map(c => c.filename).filter(Boolean) || []
        setConfirmState({
          message: names.length
            ? `\u5b58\u5728\u540c\u540d\u6d4b\u8bd5\u6570\u636e\u6587\u4ef6\uff1a${names.slice(0, 8).join(', ')}${names.length > 8 ? ' ...' : ''}\u3002\u662f\u5426\u66ff\u6362\uff1f`
            : '\u5b58\u5728\u540c\u540d\u6d4b\u8bd5\u6570\u636e\u6587\u4ef6\uff0c\u662f\u5426\u66ff\u6362\uff1f',
          action: async () => {
            try {
              setUploading(true)
              const retry = await uploadTestdataFiles(selectedFiles, true)
              if (retry.success) { toast.success(`\u6210\u529f\u66ff\u6362\u5e76\u4e0a\u4f20 ${selectedFiles.length} \u4e2a\u6587\u4ef6`); fetchTestdata() }
              else toast.error(retry.message || '\u4e0a\u4f20\u5931\u8d25')
            } catch { toast.error('\u4e0a\u4f20\u5931\u8d25') }
            finally { setUploading(false) }
          }
        })
      } else {
        toast.error(result.message || '\u4e0a\u4f20\u5931\u8d25')
      }
    } catch { toast.error('\u4e0a\u4f20\u5931\u8d25') }
    finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDeleteFile = (fileId: string, filename: string) => {
    // 创建模式：删除暂存文件
    if (!problemId) {
      setStagedFiles(prev => {
        const updated = prev.filter(f => f.name !== filename)
        setStagedPairs(detectPairs(updated))
        return updated
      })
      toast.success('文件已移除')
      return
    }

    setConfirmState({
      message: `确定要删除 ${filename} 吗？`,
      action: async () => {
        try {
          setDeletingFile(fileId)
          const result = await apiClient.delete(`/api/problems/${problemId}/testdata/${fileId}`)
          if (result.success) { toast.success('文件已删除'); fetchTestdata() }
          else toast.error(result.message || '删除失败')
        } catch { toast.error('删除失败') }
        finally { setDeletingFile(null) }
      }
    })
  }

  // ==================== 子任务操作 ====================


  const handleDownloadAllTestdata = async () => {
    if (!problemId) return
    try {
      setDownloadingAll(true)
      const result = await apiClient.download(`/api/problems/${problemId}/testdata/export`, { timeout: 120000 })
      const filename = filenameFromContentDisposition(result.contentDisposition, 'testdata.zip')
      saveBlobDownload(result.blob, filename)
    } catch { toast.error('\u4e0b\u8f7d\u5931\u8d25') }
    finally { setDownloadingAll(false) }
  }

  const handleDownloadFile = async (file: TestdataFile) => {
    if (!problemId) return
    try {
      setDownloadingFile(file.id)
      const result = await apiClient.download(`/api/problems/${problemId}/testdata/files/${file.id}/download`, { timeout: 60000 })
      const fallback = file.filename.split('/').pop() || file.filename
      const filename = filenameFromContentDisposition(result.contentDisposition, fallback)
      saveBlobDownload(result.blob, filename)
    } catch { toast.error('\u4e0b\u8f7d\u5931\u8d25') }
    finally { setDownloadingFile(null) }
  }

  const getAssignedCases = useCallback((): Set<string> => {
    const assigned = new Set<string>()
    for (const st of subtasks) for (const c of st.cases) assigned.add(`${c.input}→${c.output}`)
    return assigned
  }, [subtasks])

  /** 更新 subtasks 状态并自动保存到后端 */
  const updateSubtasksAndSave = async (newSubtasks: SubtaskConfig[]) => {
    setSubtasks(newSubtasks)
    if (problemId) {
      await handleSaveConfig(newSubtasks)
    }
  }

  const autoConfigure = useCallback(async () => {
    const assigned = getAssignedCases()
    const allPairs = !problemId ? stagedPairs : testdataPairs
    const available = allPairs.filter(p => !assigned.has(`${p.input}→${p.output}`))
    if (available.length === 0) { toast.warning('没有可用的测试点'); return }

    const groups: Record<string, TestCasePair[]> = {}
    for (const pair of available) {
      const baseName = pair.input.replace(/\.in$/, '')
      const numMatch = baseName.match(/^(\d+)/)
      const prefix = numMatch ? numMatch[1] : baseName
      if (!groups[prefix]) groups[prefix] = []
      groups[prefix].push(pair)
    }

    const existingIds = subtasks.map(s => s.id)
    let nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1
    const newSubtasks = [...subtasks]
    const groupKeys = Object.keys(groups).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a.localeCompare(b)
    })

    for (const key of groupKeys) {
      newSubtasks.push({ id: nextId, score: Math.round(100 / groupKeys.length), type: 'min', cases: groups[key] })
      nextId++
    }
    await updateSubtasksAndSave(newSubtasks)
    toast.success(`已生成 ${groupKeys.length} 个子任务并保存`)
  }, [testdataPairs, stagedPairs, subtasks, getAssignedCases])

  const addSubtask = async () => {
    const nextId = subtasks.length > 0 ? Math.max(...subtasks.map(s => s.id)) + 1 : 1
    const newSubtasks = [...subtasks, { id: nextId, score: 0, type: 'min' as const, cases: [] }]
    setExpandedSubtasks(new Set(Array.from(expandedSubtasks).concat([nextId])))
    await updateSubtasksAndSave(newSubtasks)
  }

  const deleteSubtask = async (id: number) => {
    const target = subtasks.find(s => s.id === id)
    const newSubtasks = subtasks.filter(s => s.id !== id)
    if (target?.cases.length) setUnassignedCases([...unassignedCases, ...target.cases])
    setExpandedSubtasks(new Set(Array.from(expandedSubtasks).filter(x => x !== id)))
    await updateSubtasksAndSave(newSubtasks)
  }

  const deleteAllSubtasks = async () => {
    // 收集所有已分配的测试点
    const allAssignedCases = subtasks.flatMap(s => s.cases)
    if (allAssignedCases.length > 0) setUnassignedCases([...unassignedCases, ...allAssignedCases])
    setExpandedSubtasks(new Set())
    await updateSubtasksAndSave([])
    toast.success('已删除所有子任务')
  }

  const startEditSubtask = (st: SubtaskConfig) => {
    setEditingSubtaskId(st.id)
    setEditForm({ score: String(st.score), time: st.time || '', memory: st.memory || '', deps: (st.if || []).join(', '), type: st.type })
  }

  const saveEditSubtask = async () => {
    if (editingSubtaskId === null) return
    const newSubtasks = subtasks.map(st => st.id !== editingSubtaskId ? st : {
      ...st, score: parseInt(editForm.score) || 0,
      time: editForm.time || undefined, memory: editForm.memory || undefined,
      if: editForm.deps.split(',').map(s => s.trim()).filter(s => s && !isNaN(+s)).map(s => +s),
      type: editForm.type as 'min' | 'max' | 'sum',
    })
    setEditingSubtaskId(null)
    await updateSubtasksAndSave(newSubtasks)
  }

  const assignCasesToSubtask = async (subtaskId: number, cases: TestCasePair[]) => {
    const assigned = getAssignedCases()
    const available = cases.filter(c => !assigned.has(`${c.input}→${c.output}`))
    if (!available.length) return
    const newSubtasks = subtasks.map(st => st.id !== subtaskId ? st : { ...st, cases: [...st.cases, ...available] })
    setUnassignedCases(unassignedCases.filter(c => !available.find(a => a.input === c.input && a.output === c.output)))
    await updateSubtasksAndSave(newSubtasks)
  }

  const removeCaseFromSubtask = async (subtaskId: number, caseIndex: number) => {
    const st = subtasks.find(s => s.id === subtaskId)
    if (!st) return
    const removed = st.cases[caseIndex]
    const newSubtasks = subtasks.map(s => s.id !== subtaskId ? s : { ...s, cases: s.cases.filter((_, i) => i !== caseIndex) })
    if (removed) setUnassignedCases([...unassignedCases, removed])
    await updateSubtasksAndSave(newSubtasks)
  }

  useEffect(() => {
    const assigned = getAssignedCases()
    const allPairs = !problemId ? stagedPairs : testdataPairs
    setUnassignedCases(allPairs.filter(p => !assigned.has(`${p.input}→${p.output}`)))
  }, [testdataPairs, stagedPairs, subtasks, getAssignedCases])

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // ==================== 渲染 ====================

  if (loading) {
    return <div className={unifiedStyles.u1}><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div>
  }

  return (
    <div>
      {/* ===== 顶部: 时间/内存 + YAML 预览切换 + 保存 ===== */}
      <div className={unifiedStyles.u2}>
        <div className={unifiedStyles.u3}>
          <label className={unifiedStyles.u4}>时间限制</label>
          <Input type="number" value={timeLimit} onChange={(e) => onTimeLimitChange(e.target.value)}
            placeholder="1000" style={{ ...inputStyle, width: '100px' }} />
          <span className={unifiedStyles.u5}>ms</span>
        </div>
        <div className={unifiedStyles.u3}>
          <label className={unifiedStyles.u4}>内存限制</label>
          <Input type="number" value={memoryLimit} onChange={(e) => onMemoryLimitChange(e.target.value)}
            placeholder="256" style={{ ...inputStyle, width: '100px' }} />
          <span className={unifiedStyles.u5}>MB</span>
        </div>
        <div className={unifiedStyles.u6}>
          <Button variant="ghost" type="button" onClick={() => setYamlCollapsed(!yamlCollapsed)} style={btnOutline}>
            {yamlCollapsed ? '查看 YAML' : '收起 YAML'}
          </Button>
          <Button variant="ghost" type="button" onClick={() => handleSaveConfig()} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
            {saving ? '保存中...' : '保存评测配置'}
          </Button>
        </div>
      </div>

      {/* ===== YAML 预览（可折叠） ===== */}
      {!yamlCollapsed && (
        <div className={unifiedStyles.u7}>
          <div className={unifiedStyles.u8}>
            config.yaml
          </div>
          <pre style={{ margin: 0, padding: '1rem', fontSize: '0.8125rem', fontFamily: '"SF Mono", "Fira Code", monospace', lineHeight: 1.6, background: 'var(--gray-50)', color: 'var(--gray-800)', whiteSpace: 'pre' }}>
            {yamlPreview}
          </pre>
        </div>
      )}

      {/* ===== Tab 切换 ===== */}
      <div className={unifiedStyles.u9}>
        {([['basic', '基础配置'], ...(judgeMode === 'oi' && problemId ? [['data', '数据与分组'] as const] : []), ...(judgeMode === 'acm' ? [['testdata', '测试数据'] as const] : []), ...(problemId ? [['hack', 'Hack'] as const] : [])] as const).map(([key, label]) => (
          <Button variant="ghost" type="button" key={key} onClick={() => {
            if (activeTab === 'data' && key !== 'data' && testGraphDirty) {
              setConfirmState({ message: '数据与分组工作台存在未保存修改。离开后本次草稿会丢失，确定继续吗？', action: async () => { setTestGraphDirty(false); setActiveTab(key) } })
              return
            }
            setActiveTab(key)
          }}
            style={{
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: activeTab === key ? 600 : 400,
              color: activeTab === key ? 'var(--primary)' : 'var(--gray-500)',
              border: 'none',
              borderBottom: activeTab === key ? '2px solid var(--primary)' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              marginBottom: '-2px',
            }}
          >
            {label}
            {key === 'testdata' && (testdataFiles.length > 0 || stagedFiles.length > 0) && (
              <span className={unifiedStyles.u10}>({testdataFiles.length + stagedFiles.length})</span>
            )}
          </Button>
        ))}
      </div>

      {judgeMode === 'oi' && problemId && activeTab === 'data' && (
        <ProblemTestGraphPanel problemId={problemId} onDirtyChange={setTestGraphDirty} />
      )}

      {/* ===== 基础配置 Tab ===== */}
      {activeTab === 'basic' && (
        <div>
          {/* 评测赛制 */}
          <div style={cardStyle}>
            <div style={sectionTitle}>评测赛制</div>
            <div className={unifiedStyles.u11}>
              {([['acm', 'ACM 赛制'], ['oi', 'OI 赛制']] as const).map(([mode, label]) => (
                <Button variant="ghost" type="button" key={mode} onClick={() => {
                  if (mode !== loadedJudgeMode) { setPendingJudgeMode(mode); return }
                  setJudgeMode(mode)
                  // Lemon supports partial scores and is intentionally OI-only.
                  // Clear it when switching to ACM so an invalid combination cannot be saved.
                  if (mode === 'acm' && checkerType === 'lemon') {
                    setCheckerType('default')
                    setCheckerFile('')
                    setCheckerCategory('preset')
                  }
                  if (mode === 'oi' && subtasks.length === 0) {
                    const cases = problemId ? testdataPairs : stagedPairs
                    setSubtasks([{ id: 1, score: 100, type: 'min', cases }])
                    setExpandedSubtasks(new Set([1]))
                  }
                }} style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem', borderRadius: '6px', border: judgeMode === mode ? '2px solid var(--primary)' : '1px solid var(--border)', background: judgeMode === mode ? 'rgba(59, 130, 246, 0.08)' : 'white', color: judgeMode === mode ? 'var(--primary)' : 'var(--gray-600)', fontWeight: judgeMode === mode ? 600 : 400, cursor: 'pointer' }}>
                  {label}
                </Button>
              ))}
            </div>
            <p className={unifiedStyles.u12}>
              {judgeMode === 'acm' ? '任一测试点未通过即停止评测，最终得分为 0 或 100。' : '按子任务、依赖关系和评分方式计算部分分。'}
            </p>
          </div>

          {/* 题目类型 */}
          <div style={cardStyle}>
            <div style={sectionTitle}>题目类型</div>
            <div className={unifiedStyles.u11}>
              {PROBLEM_TYPES.map(pt => (
                <Button variant="ghost" type="button" key={pt.value} onClick={() => setProblemType(pt.value)}
                  style={{
                    padding: '0.5rem 1rem',
                    fontSize: '0.8125rem',
                    borderRadius: '6px',
                    border: problemType === pt.value ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: problemType === pt.value ? 'rgba(59, 130, 246, 0.08)' : 'white',
                    color: problemType === pt.value ? 'var(--primary)' : 'var(--gray-600)',
                    fontWeight: problemType === pt.value ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {pt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 传统题: Checker 配置 */}
          {problemType === 'default' && (
            <div style={cardStyle}>
              <div style={sectionTitle}>比较器 (Checker)</div>

              <div className={unifiedStyles.u13}>
                {[{ v: 'default', l: '默认' }, { v: 'testlib', l: 'testlib' }, ...(judgeMode === 'oi' ? [{ v: 'lemon', l: 'Lemon' }] : []), { v: 'other', l: '其他' }].map(o => (
                  <Button variant="ghost" type="button" key={o.v} onClick={() => { setCheckerType(o.v); if (o.v === 'testlib') setCheckerCategory('preset') }}
                    style={{
                      padding: '0.375rem 0.75rem', fontSize: '0.8125rem', borderRadius: '6px',
                      border: checkerType === o.v ? '2px solid var(--primary)' : '1px solid var(--border)',
                      background: checkerType === o.v ? 'rgba(59, 130, 246, 0.08)' : 'white',
                      color: checkerType === o.v ? 'var(--primary)' : 'var(--gray-600)',
                      cursor: 'pointer',
                    }}
                  >{o.l}</Button>
                ))}
              </div>

              {checkerType === 'default' && (
                <label className={unifiedStyles.u14}>
                  <Input type="checkbox" checked={ignoreTrailingSpace}
                    onChange={(e) => { setIgnoreTrailingSpace(e.target.checked); if (!e.target.checked) setCheckerType('strict') }} />
                  忽略行末空格与文件尾回车
                </label>
              )}

              {checkerType === 'testlib' && (
                <div style={gridRow}>
                  <div>
                    <label style={fieldLabel}>类型</label>
                    <Select aria-label="选择" value={checkerCategory} onChange={(e) => setCheckerCategory(e.target.value as 'preset' | 'custom')} style={selectStyle}>
                      <option value="preset">预设</option>
                      <option value="custom">自定义</option>
                    </Select>
                  </div>
                  {checkerCategory === 'preset' ? (
                    <div>
                      <label style={fieldLabel}>Checker</label>
                      <Select aria-label="选择" value={checkerPreset} onChange={(e) => setCheckerPreset(e.target.value)} style={selectStyle}>
                        <option value="acmp">acmp</option>
                        <option value="ncmp">ncmp (整数比较)</option>
                        <option value="rcmp4">rcmp4 (浮点 1e-4)</option>
                        <option value="rcmp6">rcmp6 (浮点 1e-6)</option>
                        <option value="rcmp9">rcmp9 (浮点 1e-9)</option>
                        <option value="wcmp">wcmp (token 比较)</option>
                        <option value="yesno">yesno (YES/NO)</option>
                      </Select>
                    </div>
                  ) : (
                    <div>
                      <label style={fieldLabel}>Checker 文件</label>
                      <Input type="text" value={checkerFile} onChange={(e) => setCheckerFile(e.target.value)} placeholder="如: checker.cpp" style={inputStyle} />
                    </div>
                  )}
                </div>
              )}

              {checkerType === 'other' && (
                <div style={gridRow}>
                  <div>
                    <label style={fieldLabel}>接口类型</label>
                    <Select aria-label="选择" value={checkerPreset} onChange={(e) => setCheckerPreset(e.target.value)} style={selectStyle}>
                      {CHECKER_INTERFACES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label style={fieldLabel}>Checker 文件</label>
                    <Input type="text" value={checkerFile} onChange={(e) => setCheckerFile(e.target.value)} placeholder="如: checker.cpp" style={inputStyle} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 交互题 */}
          {problemType === 'interactive' && (
            <div style={cardStyle}>
              <div style={sectionTitle}>交互器 (Interactor)</div>
              <div style={{ ...gridRow, gridTemplateColumns: '2fr 1fr' }}>
                <div>
                  <label style={fieldLabel}>Interactor 文件</label>
                  <Input type="text" value={interactorFile} onChange={(e) => setInteractorFile(e.target.value)} placeholder="如: interactor.cpp" style={inputStyle} />
                </div>
                <div>
                  <label style={fieldLabel}>语言</label>
                  <Select aria-label="选择" value={interactorLang} onChange={(e) => setInteractorLang(e.target.value)} style={selectStyle}>
                    <option value="auto">自动</option><option value="cpp">C++</option><option value="c">C</option><option value="python">Python</option>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* 通信题 */}
          {problemType === 'communication' && (
            <div style={cardStyle}>
              <div style={sectionTitle}>管理器 (Manager)</div>
              <div style={{ ...gridRow, gridTemplateColumns: '2fr 1fr' }}>
                <div>
                  <label style={fieldLabel}>Manager 文件</label>
                  <Input type="text" value={managerFile} onChange={(e) => setManagerFile(e.target.value)} placeholder="如: manager.cpp" style={inputStyle} />
                </div>
                <div>
                  <label style={fieldLabel}>语言</label>
                  <Select aria-label="选择" value={managerLang} onChange={(e) => setManagerLang(e.target.value)} style={selectStyle}>
                    <option value="auto">自动</option><option value="cpp">C++</option><option value="c">C</option><option value="python">Python</option>
                  </Select>
                </div>
              </div>
              <div className={unifiedStyles.u15}>
                <label style={fieldLabel}>进程数</label>
                <Input type="number" value={numProcesses} onChange={(e) => setNumProcesses(parseInt(e.target.value) || 2)} min={2} max={10} style={inputStyle} />
              </div>
            </div>
          )}

          {/* 提交答案题 */}
          {problemType === 'submit_answer' && (
            <div style={cardStyle}>
              <div style={sectionTitle}>提交答案题配置</div>
              <label className={unifiedStyles.u16}>
                <Input type="checkbox" checked={submitAnswerMulti} onChange={(e) => setSubmitAnswerMulti(e.target.checked)} />
                Multi-file（多文件提交）
              </label>
              {submitAnswerMulti && (
                <div className={unifiedStyles.u17}>
                  <label style={fieldLabel}>文件名模板</label>
                  <Input type="text" value={submitAnswerFilename} onChange={(e) => setSubmitAnswerFilename(e.target.value)} placeholder="#.txt" style={inputStyle} />
                </div>
              )}
            </div>
          )}

          {/* FileIO */}
          {problemType === 'default' && (
            <div style={cardStyle}>
              <div style={sectionTitle}>FileIO 配置</div>
              <div className={unifiedStyles.u18}>
                <Input type="text" value={fileioPrefix} onChange={(e) => setFileioPrefix(e.target.value)} placeholder="如: f（生成 f.in / f.out）" style={inputStyle} />
                {fileioPrefix && <span className={unifiedStyles.u19}>.in / .out</span>}
              </div>
            </div>
          )}

          {/* 额外文件 */}
          {!['submit_answer', 'objective'].includes(problemType) && (
            <div style={cardStyle}>
              <div style={sectionTitle}>额外文件</div>
              <div style={gridRow}>
                <div>
                  <label style={fieldLabel}>用户额外文件（提交时可访问）</label>
                  <Input type="text" value={userExtraFiles.join(', ')}
                    onChange={(e) => setUserExtraFiles(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="如: in.txt, data.csv（逗号分隔）" style={inputStyle} />
                </div>
                <div>
                  <label style={fieldLabel}>评测额外文件（评测时可访问）</label>
                  <Input type="text" value={judgeExtraFiles.join(', ')}
                    onChange={(e) => setJudgeExtraFiles(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="如: judge.txt（逗号分隔）" style={inputStyle} />
                </div>
              </div>
            </div>
          )}

          {/* 语言限制 */}
          {!['submit_answer', 'objective'].includes(problemType) && (
            <div style={cardStyle}>
              <div style={sectionTitle}>语言限制</div>
              <div className={unifiedStyles.u20}>
                {LANGUAGE_OPTIONS.filter(o => o.value).map(lang => (
                  <label key={lang.value} style={{
                    display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8125rem', cursor: 'pointer',
                    padding: '0.25rem 0.625rem', borderRadius: '6px',
                    border: langs.includes(lang.value) ? '1px solid var(--primary)' : '1px solid var(--border)',
                    background: langs.includes(lang.value) ? 'rgba(59, 130, 246, 0.06)' : 'transparent',
                    color: langs.includes(lang.value) ? 'var(--primary)' : 'var(--gray-600)',
                  }}>
                    <Input type="checkbox" checked={langs.includes(lang.value)}
                      onChange={(e) => e.target.checked ? setLangs([...langs, lang.value]) : setLangs(langs.filter(l => l !== lang.value))} />
                    {lang.label}
                  </label>
                ))}
              </div>
              <p className={unifiedStyles.u21}>不选择则允许所有语言</p>
            </div>
          )}
        </div>
      )}

      {/* ===== 子任务 Tab ===== */}
      {judgeMode === 'oi' && activeTab === 'subtasks' && (
        <div>
          {/* 操作栏 */}
          <div className={unifiedStyles.u22}>
            <Button variant="ghost" type="button" onClick={autoConfigure} style={btnOutline}>⚡ 自动配置</Button>
            <Button variant="ghost" type="button" onClick={addSubtask} style={btnOutline}>＋ 添加子任务</Button>
            {subtasks.length > 0 && (
              <Button variant="ghost" type="button" onClick={deleteAllSubtasks} style={btnDanger}>删除全部子任务</Button>
            )}
            <span className={unifiedStyles.u23}>
              全局 {globalTime} / {globalMemory} · {subtasks.reduce((sum, st) => sum + st.cases.length, 0)} 测试点 · {subtasks.length} 子任务
            </span>
          </div>

          {/* 未分配测试点 */}
          {unassignedCases.length > 0 && (
            <div style={cardStyle}>
              <div style={{ ...sectionTitle, color: 'var(--warning)' }}>未分配测试点 ({unassignedCases.length})</div>
              <div className={unifiedStyles.u24}>
                {unassignedCases.map((c, i) => (
                  <span key={i} className={unifiedStyles.u25}>
                    {c.input} → {c.output}
                  </span>
                ))}
                {subtasks.length > 0 && (
                  <div className={unifiedStyles.u26}>
                    <span className={unifiedStyles.u5}>全部分配到:</span>
                    <Select aria-label="选择" onChange={(e) => { const sid = parseInt(e.target.value); if (sid) assignCasesToSubtask(sid, unassignedCases); e.target.value = '' }} style={{ ...selectStyle, width: '160px' }} defaultValue="">
                      <option value="" disabled>选择子任务...</option>
                      {subtasks.map(st => <option key={st.id} value={st.id}>子任务 {st.id}</option>)}
                    </Select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 子任务列表 */}
          {subtasks.map(st => {
            const isExpanded = expandedSubtasks.has(st.id)
            const isEditing = editingSubtaskId === st.id
            return (
              <div key={st.id} style={cardStyle}>
                {/* 头部 */}
                <div className={unifiedStyles.u27}
                  onClick={() => {
                    const next = new Set(Array.from(expandedSubtasks))
                    if (next.has(st.id)) next.delete(st.id); else next.add(st.id)
                    setExpandedSubtasks(next)
                  }}>
                  <span className={unifiedStyles.u28}>{isExpanded ? '▼' : '▶'}</span>
                  <span className={unifiedStyles.u29}>子任务 {st.id}</span>
                  <span className={unifiedStyles.u30}>{st.cases.length} 测试点</span>
                  <span className={unifiedStyles.u31}>{st.score} 分</span>
                  <span className={unifiedStyles.u32}>{st.type}</span>
                  {st.if && st.if.length > 0 && (
                    <span className={unifiedStyles.u33}>依赖: {st.if.join(', ')}</span>
                  )}
                  <Button variant="ghost" type="button" onClick={(e) => { e.stopPropagation(); deleteSubtask(st.id) }}
                    style={{ ...btnDanger, marginLeft: 'auto' }}>删除</Button>
                </div>

                {/* 展开内容 */}
                {isExpanded && (
                  <div className={unifiedStyles.u34}>
                    {isEditing ? (
                      <div className={unifiedStyles.u35}>
                        <div>
                          <label style={fieldLabel}>分值</label>
                          <Input type="number" value={editForm.score} onChange={(e) => setEditForm({ ...editForm, score: e.target.value })} style={inputStyle} />
                        </div>
                        <div>
                          <label style={fieldLabel}>时间覆盖</label>
                          <Input type="text" value={editForm.time} placeholder={globalTime} onChange={(e) => setEditForm({ ...editForm, time: e.target.value })} style={inputStyle} />
                        </div>
                        <div>
                          <label style={fieldLabel}>内存覆盖</label>
                          <Input type="text" value={editForm.memory} placeholder={globalMemory} onChange={(e) => setEditForm({ ...editForm, memory: e.target.value })} style={inputStyle} />
                        </div>
                        <div>
                          <label style={fieldLabel}>评分方式</label>
                          <Select aria-label="选择" value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} style={selectStyle}>
                            {SUBTASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </Select>
                        </div>
                        <div className={unifiedStyles.u36}>
                          <label style={fieldLabel}>依赖 (子任务ID, 逗号分隔)</label>
                          <Input type="text" value={editForm.deps} onChange={(e) => setEditForm({ ...editForm, deps: e.target.value })} placeholder="如: 1, 2" style={inputStyle} />
                        </div>
                        <div className={unifiedStyles.u37}>
                          <Button variant="ghost" type="button" onClick={saveEditSubtask} style={btnPrimary}>保存</Button>
                        </div>
                      </div>
                    ) : (
                      <div className={unifiedStyles.u38}>
                        <span>⏱ {st.time || globalTime}</span>
                        <span>内存 {st.memory || globalMemory}</span>
                        <Button variant="ghost" type="button" onClick={() => startEditSubtask(st)} className={unifiedStyles.u39}>编辑</Button>
                      </div>
                    )}

                    {/* 测试点 */}
                    <div className={unifiedStyles.u24}>
                      {st.cases.map((c, ci) => (
                        <span key={ci} className={unifiedStyles.u40}>
                          {c.input} → {c.output}
                          {st.type === 'sum' && (
                            <Input
                              type="number"
                              value={c.score || 0}
                              onChange={(e) => {
                                const newScore = parseInt(e.target.value) || 0
                                const newSubtasks = subtasks.map(s => s.id === st.id ? {
                                  ...s,
                                  cases: s.cases.map((tc, ti) => ti === ci ? { ...tc, score: newScore } : tc)
                                } : s)
                                setSubtasks(newSubtasks)
                              }}
                              onBlur={() => updateSubtasksAndSave(subtasks)}
                              className={unifiedStyles.u41}
                              min={0}
                            />
                          )}
                          {c.score !== undefined && st.type !== 'sum' && (
                            <span className={unifiedStyles.u42}>({c.score}分)</span>
                          )}
                          <Button variant="ghost" type="button" onClick={() => removeCaseFromSubtask(st.id, ci)} className={unifiedStyles.u43}>✕</Button>
                        </span>
                      ))}
                      {unassignedCases.length > 0 && (
                        <Select aria-label="选择" onChange={(e) => { const inp = e.target.value; if (!inp) return; const pair = unassignedCases.find(c => c.input === inp); if (pair) assignCasesToSubtask(st.id, [pair]); e.target.value = '' }}
                          className={unifiedStyles.u44} defaultValue="">
                          <option value="">+ 添加测试点</option>
                          {unassignedCases.map((c, i) => <option key={i} value={c.input}>{c.input} → {c.output}</option>)}
                        </Select>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {subtasks.length === 0 && (
            <div className={unifiedStyles.u45}>
              <p className={unifiedStyles.u46}>暂无子任务</p>
              <p className={unifiedStyles.u47}>上传测试数据后点击「自动配置」，或手动「添加子任务」</p>
            </div>
          )}
        </div>
      )}

      {/* ===== 测试数据 Tab ===== */}
      {activeTab === 'basic' && problemId && (
        <div style={cardStyle}>
          <div style={sectionTitle}>Checker 文件</div>
          <div className={unifiedStyles.u48}>
            <label style={{ ...btnPrimary, cursor: checkerUploading ? 'not-allowed' : 'pointer' }}>
              {checkerUploading ? '上传中...' : '上传 Checker'}
              <Input ref={checkerInputRef} type="file" multiple accept=".cpp,.cc,.cxx" onChange={handleCheckerUpload} className={unifiedStyles.u49} disabled={checkerUploading} />
            </label>
            <span className={unifiedStyles.u5}>上传 Checker C++ 源文件；系统已内置 testlib.h。</span>
          </div>
          {checkerFiles.map(file => <div key={file.id} className={unifiedStyles.u50}><code>{file.fileName}</code><Button variant="ghost" type="button" onClick={() => handleCheckerDelete(file)} style={btnDanger}>删除</Button></div>)}
        </div>
      )}

      {/* ===== 测试数据 Tab ===== */}
      {activeTab === 'testdata' && (
        <div>
          <div className={unifiedStyles.u51}>
            <p className={unifiedStyles.u30}>
              支持 .in, .out, .ans, .yaml, .zip 文件。同名配对的 .in 和 .out/.ans 文件将自动识别为测试点。
              {!problemId && <span className={unifiedStyles.u52}>（创建模式：文件暂存本地，保存题目后自动上传）</span>}
            </p>
            <div className={unifiedStyles.u53}>
              {problemId && testdataFiles.length > 0 && (
                <Button variant="ghost" type="button" onClick={handleDownloadAllTestdata} disabled={downloadingAll} style={{ ...btnOutline, opacity: downloadingAll ? 0.7 : 1 }}>
                  {downloadingAll ? '\u4e0b\u8f7d\u4e2d...' : '\u4e0b\u8f7d\u6570\u636e\u5305'}
                </Button>
              )}
              <label style={{ ...btnPrimary, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
                {uploading ? '\u4e0a\u4f20\u4e2d...' : '\u4e0a\u4f20\u6587\u4ef6'}
                <Input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} accept=".in,.out,.ans,.txt,.yaml,.yml,.zip" className={unifiedStyles.u49} disabled={uploading} />
              </label>
            </div>
          </div>

          {/* 已识别测试点 */}
          {(() => {
            const pairs = !problemId ? stagedPairs : testdataPairs
            return pairs.length > 0 ? (
              <div style={{ ...cardStyle, background: 'rgba(16, 185, 129, 0.04)', borderColor: 'rgba(16, 185, 129, 0.2)' }}>
                <div style={{ ...sectionTitle, color: 'var(--success)' }}>已识别测试点 ({pairs.length})</div>
                <div className={unifiedStyles.u20}>
                  {pairs.map((pair, i) => (
                    <span key={i} className={unifiedStyles.u54}>
                      <span className={unifiedStyles.u55}>{pair.input}</span>
                      <span className={unifiedStyles.u56}>→</span>
                      <span className={unifiedStyles.u57}>{pair.output}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null
          })()}

          {/* 文件列表 */}
          {(() => {
            // 创建模式：显示暂存文件
            if (!problemId) {
              return stagedFiles.length > 0 ? (
                <div className={unifiedStyles.u58}>
                  <TableRoot className={unifiedStyles.u59}>
                    <TableHead>
                      <TableRow className={unifiedStyles.u60}>
                        <TableHeaderCell className={unifiedStyles.u61}>文件名</TableHeaderCell>
                        <TableHeaderCell className={unifiedStyles.u62}>大小</TableHeaderCell>
                        <TableHeaderCell className={unifiedStyles.u62}>状态</TableHeaderCell>
                        <TableHeaderCell className={unifiedStyles.u63}>操作</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {stagedFiles.map((file, i) => (
                        <TableRow key={i} className={unifiedStyles.u64}>
                          <TableCell className={unifiedStyles.u65}>
                            <span style={{ color: file.name.endsWith('.in') ? 'var(--primary)' : file.name.endsWith('.out') || file.name.endsWith('.ans') ? 'var(--success)' : 'var(--gray-700)' }}>
                              {file.name}
                            </span>
                          </TableCell>
                          <TableCell className={unifiedStyles.u66}>{formatFileSize(file.size)}</TableCell>
                          <TableCell className={unifiedStyles.u67}>
                            <span className={unifiedStyles.u68}>待上传</span>
                          </TableCell>
                          <TableCell className={unifiedStyles.u69}>
                            <Button variant="ghost" type="button" onClick={() => handleDeleteFile('', file.name)} style={btnDanger}>
                              删除
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </TableRoot>
                </div>
              ) : (
                <div className={unifiedStyles.u45}>
                  暂无测试数据，请上传 .in 和 .out/.ans 文件
                </div>
              )
            }

            // 编辑模式：显示已上传文件
            return testdataFiles.length > 0 ? (
              <div className={unifiedStyles.u58}>
                <TableRoot className={unifiedStyles.u59}>
                  <TableHead>
                    <TableRow className={unifiedStyles.u60}>
                      <TableHeaderCell className={unifiedStyles.u61}>文件名</TableHeaderCell>
                      <TableHeaderCell className={unifiedStyles.u62}>大小</TableHeaderCell>
                      <TableHeaderCell className={unifiedStyles.u70}>上传时间</TableHeaderCell>
                      <TableHeaderCell className={unifiedStyles.u63}>操作</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {testdataFiles.map(file => (
                      <TableRow key={file.id} className={unifiedStyles.u64}>
                        <TableCell className={unifiedStyles.u65}>
                          <span style={{ color: file.filename.endsWith('.in') ? 'var(--primary)' : file.filename.endsWith('.out') || file.filename.endsWith('.ans') ? 'var(--success)' : 'var(--gray-700)' }}>
                            {file.filename}
                          </span>
                        </TableCell>
                        <TableCell className={unifiedStyles.u66}>{formatFileSize(file.size)}</TableCell>
                        <TableCell className={unifiedStyles.u66}>{new Date(file.uploadedAt).toLocaleString('zh-CN')}</TableCell>
                        <TableCell className={unifiedStyles.u69}>
                          <div className={unifiedStyles.u71}>
                            <Button variant="ghost" type="button" onClick={() => handleDownloadFile(file)} disabled={downloadingFile === file.id}
                              style={{ ...btnOutline, padding: '0.25rem 0.5rem', fontSize: '0.75rem', opacity: downloadingFile === file.id ? 0.5 : 1 }}>
                              {downloadingFile === file.id ? '...' : '\u4e0b\u8f7d'}
                            </Button>
                            <Button variant="ghost" type="button" onClick={() => handleDeleteFile(file.id, file.filename)} disabled={deletingFile === file.id}
                              style={{ ...btnDanger, opacity: deletingFile === file.id ? 0.5 : 1 }}>
                              {deletingFile === file.id ? '...' : '\u5220\u9664'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </TableRoot>
              </div>
            ) : (
              <div className={unifiedStyles.u45}>
                暂无测试数据，请上传 .in 和 .out/.ans 文件
              </div>
            )
          })()}
        </div>
      )}

      {activeTab === 'hack' && problemId && (
        <ProblemHackConfigPanel problemId={problemId} judgeMode={judgeMode} problemType={problemType} />
      )}

      {/* ===== 确认弹窗 ===== */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null) }}
        title="确认操作"
        message={confirmState?.message || ''}
        confirmText="确认"
        danger
      />
      <ConfirmModal
        isOpen={!!pendingJudgeMode}
        onClose={() => setPendingJudgeMode(null)}
        onConfirm={confirmModeTransition}
        title={`切换为 ${pendingJudgeMode?.toUpperCase() || ''} 评测模式？`}
        message="模式切换会创建新的不可变正式测试版本，并自动关闭 Hack。已固定旧版本的比赛、训练和作业不会变化；切换后需要重新确认 Hack 配置。"
        confirmText={transitioningMode ? '迁移中…' : '确认迁移'}
        danger
      />
    </div>
  )
  }
)
