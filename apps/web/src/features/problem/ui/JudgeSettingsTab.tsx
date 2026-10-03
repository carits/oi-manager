'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
import collisionStyles from './JudgeSettingsTab.collision.module.css'
import unifiedStyles from './JudgeSettingsTab.unified.module.css'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import yaml from 'js-yaml'
import { filenameFromContentDisposition, saveBlobDownload } from '@/lib/download'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ProblemHackConfigPanel } from './ProblemHackConfigPanel'
import { ProblemTestGraphPanel } from './ProblemTestGraphPanel'
import { LANGUAGE_OPTIONS } from '@/lib/judge-constants'
import { ProblemJudgeAssetsPanel } from './ProblemJudgeAssetsPanel'
import { JudgeTestdataPanel } from './JudgeTestdataPanel'
import {
  getProblemJudgeSettings,
  deleteProblemChecker,
  listProblemCheckers,
  listProblemTestdata,
  listProblemTestSetSlots,
  saveProblemJudgeSettings,
  transitionProblemJudgeMode,
  uploadProblemChecker,
} from '../api/problemJudgeSettingsApi'
import {
  deleteProblemTestdata,
  downloadProblemTestdata,
  downloadProblemTestdataExport,
  uploadProblemTestdata,
} from '../api/problemFilesApi'
import {
  CHECKER_INTERFACES,
  PROBLEM_TYPES,
  type CheckerFile,
  type JudgeConfig,
  type SubtaskConfig,
  type TestCasePair,
  type TestdataFile,
} from '../model/judgeSettingsTypes'

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
  const [activeTab, setActiveTab] = useState<'basic' | 'data' | 'testdata' | 'assets' | 'hack'>('basic')
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

  const buildConfig = (subtasksOverride?: SubtaskConfig[]): JudgeConfig => {
    const st = subtasksOverride ?? subtasks
    const config: JudgeConfig = { mode: judgeMode, type: problemType }

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
        const obj: SubtaskConfig = { id: s.id, score: s.score, type: s.type, cases: [] }
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

  const configForYaml = useMemo((): JudgeConfig => buildConfig(), [
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
      const data = await getProblemJudgeSettings(problemId)
      if (data) {
        const { config, problemType: pt, timeLimit: tl, memoryLimit: ml } = data

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
            const loaded = config.subtasks.map((st) => ({
              id: st.id || 0, score: st.score || 0, type: st.type || 'min',
              if: st.if || [], time: st.time, memory: st.memory,
              cases: (st.cases || []).map((c) => ({ input: c.input, output: c.output, ...(c.score !== undefined && { score: c.score }) })),
            }))
            setSubtasks(loaded)
            // 自动展开已加载的子任务，让用户看到配置已恢复
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
      const data = await listProblemTestdata(problemId)
      setTestdataFiles(data.files)
      setTestdataPairs(data.pairs)
    } catch (error) {
      console.error('Failed to fetch testdata:', error)
    }
  }

  const fetchCheckerFiles = async () => {
    if (!problemId) return
    try { setCheckerFiles(await listProblemCheckers(problemId)) } catch (error) { console.error("Failed to fetch checker files:", error) }
  }

  const handleCheckerUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (!files.length || !problemId) return
    try {
      setCheckerUploading(true)
      for (const file of files) { const result = await uploadProblemChecker(problemId, file); if (!result.success) throw new Error(result.message || "上传失败") }
      await fetchCheckerFiles(); toast.success("Checker 文件已上传")
      const cpp = files.find(file => /\.(cpp|cc|cxx)$/i.test(file.name)); if (cpp) setCheckerFile(cpp.name)
    } catch (error) { toast.error(publicErrorMessage(error, "Checker 上传失败")) }
    finally { setCheckerUploading(false); if (checkerInputRef.current) checkerInputRef.current.value = "" }
  }

  const handleCheckerDelete = async (file: CheckerFile) => {
    setConfirmState({ message: `确定要删除 ${file.fileName} 吗？`, action: async () => { try { const result = await deleteProblemChecker(problemId, file.id); if (result.ok) { setCheckerFiles(prev => prev.filter(item => item.id !== file.id)); if (checkerFile === file.fileName) setCheckerFile(""); toast.success("Checker 文件已删除") } else toast.error(result.error.userMessage || "删除失败") } catch { toast.error("删除失败") } } })
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

      const result = await saveProblemJudgeSettings(pid, {
        problemType,
        timeLimit: timeVal,
        memoryLimit: memVal,
        config,
      })

      if (result.ok) {
        toast.success('评测配置已保存')
        // 更新初始配置快照（清除脏标记）
        initialConfigRef.current = JSON.stringify(buildConfig())
      } else {
        toast.error(result.error.userMessage || '保存失败')
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
      const slotState = await listProblemTestSetSlots(problemId)
      const targetSlot = slotState.slots.find(item => item.slot === 'STABLE')
        || slotState.slots.find(item => item.slot === 'EVOLVING')
      if (!targetSlot) return toast.error('题目尚无可迁移的评测数据')
      const result = await transitionProblemJudgeMode(problemId, {
        targetMode: pendingJudgeMode,
        slot: targetSlot.slot,
        expectedFencingToken: targetSlot.fencingToken,
      })
      if (!result.ok) return toast.error(result.error.userMessage || '评测模式迁移失败')
      toast.success('评测模式迁移完成，Hack 已关闭并需要重新确认')
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
    return uploadProblemTestdata(problemId, files, replace)
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
              else console.error('Test data retry response:', retry); toast.error('\u4e0a\u4f20\u5931\u8d25')
            } catch { toast.error('\u4e0a\u4f20\u5931\u8d25') }
            finally { setUploading(false) }
          }
        })
      } else {
        console.error('Test data upload response:', result); toast.error('\u4e0a\u4f20\u5931\u8d25')
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
          const result = await deleteProblemTestdata(problemId, fileId)
          if (result.ok) { toast.success('文件已删除'); fetchTestdata() }
          else toast.error(result.error.userMessage || '删除失败')
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
      const result = await downloadProblemTestdataExport(problemId)
      const filename = filenameFromContentDisposition(result.contentDisposition, 'testdata.zip')
      saveBlobDownload(result.blob, filename)
    } catch { toast.error('\u4e0b\u8f7d\u5931\u8d25') }
    finally { setDownloadingAll(false) }
  }

  const handleDownloadFile = async (file: TestdataFile) => {
    if (!problemId) return
    try {
      setDownloadingFile(file.id)
      const result = await downloadProblemTestdata(problemId, file.id)
      const fallback = file.filename.split('/').pop() || file.filename
      const filename = filenameFromContentDisposition(result.contentDisposition, fallback)
      saveBlobDownload(result.blob, filename)
    } catch { toast.error('\u4e0b\u8f7d\u5931\u8d25') }
    finally { setDownloadingFile(null) }
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
            placeholder="1000" className={unifiedStyles.limitInput} />
          <span className={unifiedStyles.u5}>ms</span>
        </div>
        <div className={unifiedStyles.u3}>
          <label className={unifiedStyles.u4}>内存限制</label>
          <Input type="number" value={memoryLimit} onChange={(e) => onMemoryLimitChange(e.target.value)}
            placeholder="256" className={unifiedStyles.limitInput} />
          <span className={unifiedStyles.u5}>MB</span>
        </div>
        <div className={unifiedStyles.u6}>
          <Button variant="outline" size="sm" type="button" onClick={() => setYamlCollapsed(!yamlCollapsed)}>
            {yamlCollapsed ? '查看 YAML' : '收起 YAML'}
          </Button>
          <Button variant="primary" type="button" onClick={() => handleSaveConfig()} disabled={saving}>
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
          <pre className={unifiedStyles.yamlPreview}>
            {yamlPreview}
          </pre>
        </div>
      )}

      {/* ===== Tab 切换 ===== */}
      <div className={unifiedStyles.u9}>
        {([['basic', '基础配置'], ...(judgeMode === 'oi' && problemId ? [['data', '数据与分组'] as const] : []), ...(judgeMode === 'acm' ? [['testdata', '测试数据'] as const] : []), ...(problemId ? [['assets', '评测资产与生成'] as const, ['hack', 'Hack'] as const] : [])] as const).map(([key, label]) => (
          <Button variant="ghost" type="button" key={key} onClick={() => {
            if (activeTab === 'data' && key !== 'data' && testGraphDirty) {
              setConfirmState({ message: '数据与分组工作台存在未保存修改。离开后本次草稿会丢失，确定继续吗？', action: async () => { setTestGraphDirty(false); setActiveTab(key) } })
              return
            }
            setActiveTab(key)
          }}
            className={unifiedStyles.tabButton} aria-selected={activeTab === key}
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
          <div className={unifiedStyles.settingsCard}>
            <div className={unifiedStyles.sectionHeading}>评测赛制</div>
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
                  }
                }} className={unifiedStyles.optionButton} aria-selected={judgeMode === mode}>
                  {label}
                </Button>
              ))}
            </div>
            <p className={unifiedStyles.u12}>
              {judgeMode === 'acm' ? '任一测试点未通过即停止评测，最终得分为 0 或 100。' : '按子任务、依赖关系和评分方式计算部分分。'}
            </p>
          </div>

          {/* 题目类型 */}
          <div className={unifiedStyles.settingsCard}>
            <div className={unifiedStyles.sectionHeading}>题目类型</div>
            <div className={unifiedStyles.u11}>
              {PROBLEM_TYPES.map(pt => (
                <Button variant="ghost" type="button" key={pt.value} onClick={() => setProblemType(pt.value)}
                  className={unifiedStyles.optionButton} aria-selected={problemType === pt.value}
                >
                  {pt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 传统题: Checker 配置 */}
          {problemType === 'default' && (
            <div className={unifiedStyles.settingsCard}>
              <div className={unifiedStyles.sectionHeading}>比较器 (Checker)</div>

              <div className={unifiedStyles.u13}>
                {[{ v: 'default', l: '默认' }, { v: 'testlib', l: 'testlib' }, ...(judgeMode === 'oi' ? [{ v: 'lemon', l: 'Lemon' }] : []), { v: 'other', l: '其他' }].map(o => (
                  <Button variant="ghost" type="button" key={o.v} onClick={() => { setCheckerType(o.v); if (o.v === 'testlib') setCheckerCategory('preset') }}
                    className={`${unifiedStyles.optionButton} ${unifiedStyles.optionButtonSmall}`} aria-selected={checkerType === o.v}
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
                <div className={unifiedStyles.settingsGrid}>
                  <div>
                    <label className={unifiedStyles.fieldLabel}>类型</label>
                    <Select aria-label="选择" value={checkerCategory} onChange={(e) => setCheckerCategory(e.target.value as 'preset' | 'custom')}>
                      <option value="preset">预设</option>
                      <option value="custom">自定义</option>
                    </Select>
                  </div>
                  {checkerCategory === 'preset' ? (
                    <div>
                      <label className={unifiedStyles.fieldLabel}>Checker</label>
                      <Select aria-label="选择" value={checkerPreset} onChange={(e) => setCheckerPreset(e.target.value)}>
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
                      <label className={unifiedStyles.fieldLabel}>Checker 文件</label>
                      <Input type="text" value={checkerFile} onChange={(e) => setCheckerFile(e.target.value)} placeholder="如: checker.cpp" />
                    </div>
                  )}
                </div>
              )}

              {checkerType === 'other' && (
                <div className={unifiedStyles.settingsGrid}>
                  <div>
                    <label className={unifiedStyles.fieldLabel}>接口类型</label>
                    <Select aria-label="选择" value={checkerPreset} onChange={(e) => setCheckerPreset(e.target.value)}>
                      {CHECKER_INTERFACES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className={unifiedStyles.fieldLabel}>Checker 文件</label>
                    <Input type="text" value={checkerFile} onChange={(e) => setCheckerFile(e.target.value)} placeholder="如: checker.cpp" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 交互题 */}
          {problemType === 'interactive' && (
            <div className={unifiedStyles.settingsCard}>
              <div className={unifiedStyles.sectionHeading}>交互器 (Interactor)</div>
              <div className={`${unifiedStyles.settingsGrid} ${unifiedStyles.twoToOneGrid}`}>
                <div>
                  <label className={unifiedStyles.fieldLabel}>Interactor 文件</label>
                  <Input type="text" value={interactorFile} onChange={(e) => setInteractorFile(e.target.value)} placeholder="如: interactor.cpp" />
                </div>
                <div>
                  <label className={unifiedStyles.fieldLabel}>语言</label>
                  <Select aria-label="选择" value={interactorLang} onChange={(e) => setInteractorLang(e.target.value)}>
                    <option value="auto">自动</option><option value="cpp">C++</option><option value="c">C</option><option value="python">Python</option>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* 通信题 */}
          {problemType === 'communication' && (
            <div className={unifiedStyles.settingsCard}>
              <div className={unifiedStyles.sectionHeading}>管理器 (Manager)</div>
              <div className={`${unifiedStyles.settingsGrid} ${unifiedStyles.twoToOneGrid}`}>
                <div>
                  <label className={unifiedStyles.fieldLabel}>Manager 文件</label>
                  <Input type="text" value={managerFile} onChange={(e) => setManagerFile(e.target.value)} placeholder="如: manager.cpp" />
                </div>
                <div>
                  <label className={unifiedStyles.fieldLabel}>语言</label>
                  <Select aria-label="选择" value={managerLang} onChange={(e) => setManagerLang(e.target.value)}>
                    <option value="auto">自动</option><option value="cpp">C++</option><option value="c">C</option><option value="python">Python</option>
                  </Select>
                </div>
              </div>
              <div className={unifiedStyles.u15}>
                <label className={unifiedStyles.fieldLabel}>进程数</label>
                <Input type="number" value={numProcesses} onChange={(e) => setNumProcesses(parseInt(e.target.value) || 2)} min={2} max={10} />
              </div>
            </div>
          )}

          {/* 提交答案题 */}
          {problemType === 'submit_answer' && (
            <div className={unifiedStyles.settingsCard}>
              <div className={unifiedStyles.sectionHeading}>提交答案题配置</div>
              <label className={unifiedStyles.u16}>
                <Input type="checkbox" checked={submitAnswerMulti} onChange={(e) => setSubmitAnswerMulti(e.target.checked)} />
                Multi-file（多文件提交）
              </label>
              {submitAnswerMulti && (
                <div className={unifiedStyles.u17}>
                  <label className={unifiedStyles.fieldLabel}>文件名模板</label>
                  <Input type="text" value={submitAnswerFilename} onChange={(e) => setSubmitAnswerFilename(e.target.value)} placeholder="#.txt" />
                </div>
              )}
            </div>
          )}

          {/* FileIO */}
          {problemType === 'default' && (
            <div className={unifiedStyles.settingsCard}>
              <div className={unifiedStyles.sectionHeading}>提交级文件 IO</div>
              <div className={unifiedStyles.u18}>{fileioPrefix
                ? <span>旧配置 <strong>{fileioPrefix}.in / {fileioPrefix}.out</strong> 仅用于历史迁移和提交框预填；新评测由每次提交自行选择。</span>
                : <span>文件名由每次提交单独配置；题目和测试版本只保存标准 input / answer。</span>}
              </div>
            </div>
          )}

          {/* 额外文件 */}
          {!['submit_answer', 'objective'].includes(problemType) && (
            <div className={unifiedStyles.settingsCard}>
              <div className={unifiedStyles.sectionHeading}>额外文件</div>
              <div className={unifiedStyles.settingsGrid}>
                <div>
                  <label className={unifiedStyles.fieldLabel}>用户额外文件（提交时可访问）</label>
                  <Input type="text" value={userExtraFiles.join(', ')}
                    onChange={(e) => setUserExtraFiles(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="如: in.txt, data.csv（逗号分隔）" />
                </div>
                <div>
                  <label className={unifiedStyles.fieldLabel}>评测额外文件（评测时可访问）</label>
                  <Input type="text" value={judgeExtraFiles.join(', ')}
                    onChange={(e) => setJudgeExtraFiles(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="如: judge.txt（逗号分隔）" />
                </div>
              </div>
            </div>
          )}

          {/* 语言限制 */}
          {!['submit_answer', 'objective'].includes(problemType) && (
            <div className={unifiedStyles.settingsCard}>
              <div className={unifiedStyles.sectionHeading}>语言限制</div>
              <div className={unifiedStyles.u20}>
                {LANGUAGE_OPTIONS.filter(o => o.value).map(lang => (
                  <label key={lang.value} className={unifiedStyles.languageOption} data-selected={langs.includes(lang.value)}>
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

      {/* ===== 测试数据 Tab ===== */}
      {activeTab === 'basic' && problemId && (
        <div className={unifiedStyles.settingsCard}>
          <div className={unifiedStyles.sectionHeading}>Checker 文件</div>
          <div className={unifiedStyles.u48}>
            <label className={unifiedStyles.uploadButton} data-disabled={checkerUploading}>
              {checkerUploading ? '上传中...' : '上传 Checker'}
              <Input ref={checkerInputRef} type="file" multiple accept=".cpp,.cc,.cxx" onChange={handleCheckerUpload} className={unifiedStyles.u49} disabled={checkerUploading} />
            </label>
            <span className={unifiedStyles.u5}>上传 Checker C++ 源文件；系统已内置 testlib.h。</span>
          </div>
          {checkerFiles.map(file => <div key={file.id} className={unifiedStyles.u50}><code>{file.fileName}</code><Button variant="danger" size="sm" type="button" onClick={() => handleCheckerDelete(file)}>删除</Button></div>)}
        </div>
      )}

      {/* ===== 测试数据 Tab ===== */}
      {activeTab === 'testdata' && (
        <JudgeTestdataPanel
          problemId={problemId}
          stagedFiles={stagedFiles}
          stagedPairs={stagedPairs}
          testdataFiles={testdataFiles}
          testdataPairs={testdataPairs}
          uploading={uploading}
          deletingFile={deletingFile}
          downloadingFile={downloadingFile}
          downloadingAll={downloadingAll}
          fileInputRef={fileInputRef}
          onUpload={handleFileUpload}
          onDownloadAll={() => void handleDownloadAllTestdata()}
          onDownload={(file) => void handleDownloadFile(file)}
          onDelete={(id, filename) => void handleDeleteFile(id, filename)}
        />
      )}

      {activeTab === 'hack' && problemId && (
        <ProblemHackConfigPanel problemId={problemId} judgeMode={judgeMode} problemType={problemType} />
      )}
      {activeTab === 'assets' && problemId && <ProblemJudgeAssetsPanel problemId={problemId} judgeMode={judgeMode} />}

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
