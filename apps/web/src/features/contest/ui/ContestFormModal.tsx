'use client'

import { useState, useEffect, useRef } from 'react'
import collisionStyles from './ContestFormModal.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './ContestFormModal.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, FormDialog } from '@/components/ui/Dialogs'
import { useAuth } from '@/features/auth'
import { ProblemReferenceLink, ProblemReferenceSelector, type SelectedProblemReference } from '@/features/problem-selection'
import { assertContestProblemMembership, contestProblemDeletions, contestProblemOrders, contestProblemSnapshot } from '../model/contestSaveIntegrity'

function toLocalDatetimeString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type StepResponse<T> = { success: boolean; data?: T; message?: string }
function responseData<T>(response: StepResponse<T>, message: string): T {
  if (!response.success || response.data === undefined || response.data === null) throw new Error(response.message || message)
  return response.data
}

interface ResolvedProblem { found: boolean; canonicalProblemId: string; title: string; created: boolean }
interface ContentOption {
  key: string
  sourceType: 'canonical' | 'user' | 'contest' | 'none'
  title: string | null
  format: string
  language: string | null
  authorUsername: string | null
  fileName: string | null
  previewText: string | null
}
interface ContentOptions {
  statement: ContentOption[]
  solution: ContentOption[]
  currentSelection?: { statementOptionKey: string | null; solutionOptionKey: string | null }
}
interface ProblemRow {
  id: string
  contestProblemId?: string
  platform: string
  problemId: string
  alias: string
  points: number
  resolving: boolean
  resolved: ResolvedProblem | null
  existing?: boolean
  contentOptionsLoading?: boolean
  contentOptionsError?: string
  statementOptions?: ContentOption[]
  solutionOptions?: ContentOption[]
  statementOptionKey?: string
  solutionOptionKey?: string
  originalStatementOptionKey?: string
  originalSolutionOptionKey?: string
}
interface ContestFormInfo {
  title: string
  description?: string | null
  format: 'oi' | 'ioi' | 'icpc'
  problemIdVisible?: boolean
  solutionVisible?: boolean
  includeAdminInRanking?: boolean
  startTime: string
  endTime: string
}
interface ContestRatingConfig {
  scope?: 'NONE' | 'ORGANIZATION' | 'GLOBAL' | 'BOTH'
  weight?: number
  organizationMinParticipants?: number
  globalMinParticipants?: number
  revision?: number
  lockedAt?: string | null
  editable?: boolean
  allowedScopes?: Array<'NONE' | 'ORGANIZATION' | 'GLOBAL' | 'BOTH'>
}
interface ExistingContestProblem {
  id: string
  platform?: string | null
  platformProblemId?: string | null
  problemId: string
  problemTitle?: string | null
  alias?: string | null
  points?: number | null
}
type IdResponse = { id: string | number }
interface ContestFormModalProps {
  isOpen: boolean
  onClose: () => void
  teamId?: string
  schoolId?: string
  organizationId?: string
  contestId?: string
  onSaved?: () => void
  mode?: 'contest' | 'homework'
}

function infoSnapshot(info: ContestFormInfo): string {
  return JSON.stringify({
    title: info.title, description: info.description || '', format: info.format,
    problemIdVisible: info.problemIdVisible ?? false, solutionVisible: info.solutionVisible ?? false,
    includeAdminInRanking: info.includeAdminInRanking ?? false,
    startTime: new Date(info.startTime).toISOString(), endTime: new Date(info.endTime).toISOString(),
  })
}

let tempIdCounter = 0

/** A reopened modal or another target never inherits outstanding callbacks or save receipts. */
export function ContestFormModal(props: ContestFormModalProps) {
  const { sessionKey } = useAuth()
  if (!props.isOpen) return null
  const key = JSON.stringify([sessionKey, props.contestId, props.organizationId, props.teamId, props.schoolId, props.mode])
  return <ContestFormEditor key={key} {...props} />
}

function ContestFormEditor({ isOpen, onClose, teamId, schoolId, organizationId, contestId, onSaved, mode = 'contest' }: ContestFormModalProps) {
  const toast = useToast()
  const { user } = useAuth()
  const isEdit = Boolean(contestId)
  const entityName = mode === 'contest' ? '比赛' : '作业'
  const mountedRef = useRef(false)
  const savingRef = useRef(false)
  const readyRef = useRef(false)
  const baselineProblemsRef = useRef<ExistingContestProblem[] | null>(null)
  const baselineInfoRef = useRef('')
  const selectedIdsRef = useRef(new Set<string>())
  const optionRequestsRef = useRef(new Map<string, number>())
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [format, setFormat] = useState<'oi' | 'ioi' | 'icpc'>('ioi')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [problemIdVisible, setProblemIdVisible] = useState(false)
  const [solutionVisible, setSolutionVisible] = useState(false)
  const [includeAdminInRanking, setIncludeAdminInRanking] = useState(false)
  const [ratingScope, setRatingScope] = useState<'NONE' | 'ORGANIZATION' | 'GLOBAL' | 'BOTH'>('NONE')
  const [ratingWeight, setRatingWeight] = useState('1')
  const [organizationRatingMinimum, setOrganizationRatingMinimum] = useState('5')
  const [globalRatingMinimum, setGlobalRatingMinimum] = useState('20')
  const [ratingRevision, setRatingRevision] = useState(0)
  const [ratingLocked, setRatingLocked] = useState(false)
  const [allowedRatingScopes, setAllowedRatingScopes] = useState<Array<'NONE' | 'ORGANIZATION' | 'GLOBAL' | 'BOTH'>>(['NONE'])
  const [wizardStep, setWizardStep] = useState(0)
  const [recoveryContestId, setRecoveryContestId] = useState<string | null>(null)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryBlocked, setRecoveryBlocked] = useState(false)
  const [saveReceipts, setSaveReceipts] = useState<string[]>([])
  const [originalStartTime, setOriginalStartTime] = useState<Date | null>(null)
  const [originalStartTimeStr, setOriginalStartTimeStr] = useState('')
  const [problemRows, setProblemRows] = useState<ProblemRow[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [initialSnapshot, setInitialSnapshot] = useState('')
  const [baselinePending, setBaselinePending] = useState(true)
  const [closeRequested, setCloseRequested] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; optionRequestsRef.current.clear() }
  }, [])

  useEffect(() => {
    let cancelled = false
    const current = () => !cancelled && mountedRef.current
    readyRef.current = false
    setBaselinePending(true)
    setLoadError('')
    if (!contestId) {
      baselineProblemsRef.current = []
      const now = new Date()
      let hours = now.getHours()
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (now.getMinutes() > 0 || now.getSeconds() > 0) hours += 1
      if (hours >= 22) { date.setDate(date.getDate() + 1); hours = 8 }
      date.setHours(hours, 0, 0, 0)
      setStartTime(toLocalDatetimeString(date))
      const end = new Date(date)
      end.setHours(end.getHours() + 3)
      setEndTime(toLocalDatetimeString(end))
      readyRef.current = true
      return () => { cancelled = true }
    }
    const load = async () => {
      setLoading(true)
      try {
        const [infoRes, problemsRes, ratingRes] = await Promise.all([
          apiClient.get<ContestFormInfo>(`/api/contests/${contestId}`),
          apiClient.get<ExistingContestProblem[]>(`/api/contests/${contestId}/problems`),
          mode === 'contest' ? apiClient.get<ContestRatingConfig>(`/api/contests/${contestId}/rating-config`) : Promise.resolve(null),
        ])
        if (!current()) return
        const info = responseData(infoRes, '比赛信息加载失败')
        const problems = responseData(problemsRes, '比赛题目加载失败')
        const config = ratingRes ? responseData(ratingRes, 'Rating 配置加载失败') : null
        const rows: ProblemRow[] = await Promise.all(problems.map(async problem => {
          const options = responseData(await apiClient.get<ContentOptions>(`/api/contests/${contestId}/problems/${problem.id}/content-options`), '题面和题解选项加载失败')
          const statementKey = options.currentSelection?.statementOptionKey ?? options.statement[0]?.key
          const solutionKey = options.currentSelection?.solutionOptionKey ?? options.solution.find(option => option.key !== 'none')?.key ?? 'none'
          return {
            id: `existing-${problem.id}`, contestProblemId: String(problem.id),
            platform: problem.platform || 'carits', problemId: problem.platformProblemId || problem.problemId,
            alias: problem.alias || '', points: problem.points ?? 100, resolving: false,
            resolved: { found: true, canonicalProblemId: problem.problemId, title: problem.problemTitle || '', created: false }, existing: true,
            statementOptions: options.statement, solutionOptions: options.solution,
            statementOptionKey: statementKey, solutionOptionKey: solutionKey,
            originalStatementOptionKey: statementKey, originalSolutionOptionKey: solutionKey,
          }
        }))
        if (!current()) return
        baselineProblemsRef.current = problems
        baselineInfoRef.current = infoSnapshot(info)
        selectedIdsRef.current = new Set(problems.map(problem => problem.problemId))
        setTitle(info.title)
        setDescription(info.description || '')
        setFormat(info.format)
        setProblemIdVisible(info.problemIdVisible ?? false)
        setSolutionVisible(info.solutionVisible ?? false)
        setIncludeAdminInRanking(info.includeAdminInRanking ?? false)
        const start = toLocalDatetimeString(new Date(info.startTime))
        setStartTime(start)
        setOriginalStartTimeStr(start)
        setOriginalStartTime(new Date(info.startTime))
        setEndTime(toLocalDatetimeString(new Date(info.endTime)))
        if (config) {
          setRatingScope(config.scope || 'NONE')
          setRatingWeight(String(config.weight ?? 1))
          setOrganizationRatingMinimum(String(config.organizationMinParticipants ?? 5))
          setGlobalRatingMinimum(String(config.globalMinParticipants ?? 20))
          setRatingRevision(config.revision ?? 0)
          setRatingLocked(Boolean(config.lockedAt) || config.editable === false)
          if (config.allowedScopes) setAllowedRatingScopes(config.allowedScopes)
        }
        setProblemRows(rows)
        readyRef.current = true
      } catch (error) {
        if (current()) setLoadError(error instanceof Error ? error.message : '加载失败，未开放空白表单')
      } finally {
        if (current()) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [contestId, mode, loadAttempt])

  useEffect(() => {
    if (isEdit || mode !== 'contest') return
    if (teamId) setAllowedRatingScopes(['NONE'])
    else if (organizationId) setAllowedRatingScopes(['NONE', 'ORGANIZATION'])
    else if (user && ['super_admin', 'platform_admin'].includes(user.accountRole)) setAllowedRatingScopes(['NONE', 'GLOBAL', 'BOTH'])
    else setAllowedRatingScopes(['NONE'])
  }, [isEdit, mode, organizationId, teamId, user, format])
  useEffect(() => {
    if (!allowedRatingScopes.includes(ratingScope)) setRatingScope('NONE')
  }, [allowedRatingScopes, ratingScope])

  const formSnapshot = JSON.stringify({
    title, description, format, startTime, endTime, problemIdVisible, solutionVisible, includeAdminInRanking,
    ratingScope, ratingWeight, organizationRatingMinimum, globalRatingMinimum,
    problems: problemRows.map(row => ({
      clientKey: row.id, canonicalProblemId: row.resolved?.canonicalProblemId, alias: row.alias, points: row.points,
      statementOptionKey: row.statementOptionKey || null, solutionOptionKey: row.solutionOptionKey || null,
    })),
  })
  useEffect(() => {
    if (loading || loadError || !readyRef.current || !baselinePending) return
    setInitialSnapshot(formSnapshot)
    setBaselinePending(false)
  }, [baselinePending, formSnapshot, loading, loadError])
  const formDirty = !baselinePending && Boolean(initialSnapshot) && formSnapshot !== initialSnapshot
  const requestClose = () => {
    if (savingRef.current || loading) return
    if (formDirty || recoveryBlocked) setCloseRequested(true)
    else onClose()
  }
  const updateRow = (id: string, updates: Partial<ProblemRow>) => {
    if (!savingRef.current) setProblemRows(current => current.map(row => row.id === id ? { ...row, ...updates } : row))
  }
  const loadRowOptions = async (id: string, canonicalProblemId: string) => {
    const requestId = (optionRequestsRef.current.get(id) || 0) + 1
    optionRequestsRef.current.set(id, requestId)
    const current = () => mountedRef.current && optionRequestsRef.current.get(id) === requestId
    updateRow(id, { contentOptionsLoading: true, contentOptionsError: '' })
    try {
      const options = responseData(await apiClient.get<ContentOptions>(`/api/problems/${canonicalProblemId}/content-options`), '题面选项加载失败')
      if (!current()) return
      updateRow(id, {
        contentOptionsLoading: false, statementOptions: options.statement, solutionOptions: options.solution,
        statementOptionKey: options.statement[0]?.key,
        solutionOptionKey: options.solution.find(option => option.key !== 'none')?.key || 'none',
      })
    } catch (error) {
      if (current()) updateRow(id, { contentOptionsLoading: false, contentOptionsError: error instanceof Error ? error.message : '题面选项加载失败' })
    }
  }
  const addSelectedProblems = async (references: SelectedProblemReference[]) => {
    for (const reference of references) {
      const problem = reference.problem
      if (!mountedRef.current || savingRef.current || recoveryBlocked) return
      if (selectedIdsRef.current.has(problem.id)) continue
      selectedIdsRef.current.add(problem.id)
      const id = `selected-${++tempIdCounter}`
      setProblemRows(current => [...current, {
        id, platform: problem.platform, problemId: problem.problemId, alias: reference.alias || '', points: 100, resolving: false,
        resolved: { found: true, canonicalProblemId: problem.id, title: problem.title, created: false },
        contentOptionsLoading: true, statementOptions: [], solutionOptions: [],
      }])
      await loadRowOptions(id, problem.id)
    }
  }
  const removeRow = (id: string) => {
    if (savingRef.current) return
    const row = problemRows.find(item => item.id === id)
    if (row?.resolved) selectedIdsRef.current.delete(row.resolved.canonicalProblemId)
    optionRequestsRef.current.delete(id)
    setProblemRows(current => current.filter(row => row.id !== id))
  }
  const moveRow = (index: number, delta: number) => {
    if (savingRef.current) return
    setProblemRows(current => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const rows = [...current]
      ;[rows[index], rows[target]] = [rows[target], rows[index]]
      return rows
    })
  }

  const ratingConfigurationValid = ratingScope === 'NONE' || (
    Number.isFinite(Number(ratingWeight)) && Number(ratingWeight) >= 0.1 && Number(ratingWeight) <= 1
    && Number.isInteger(Number(organizationRatingMinimum)) && Number(organizationRatingMinimum) >= 2
    && Number.isInteger(Number(globalRatingMinimum)) && Number(globalRatingMinimum) >= 2
    && allowedRatingScopes.includes(ratingScope)
  )
  const editContestStarted = Boolean(isEdit && originalStartTime && new Date() >= originalStartTime)
  const stepIssues = (step: number): string[] => {
    if (step === 0) return [
      !title.trim() ? '请填写标题' : '',
      !startTime || !endTime || !Number.isFinite(new Date(startTime).getTime()) || !Number.isFinite(new Date(endTime).getTime()) ? '请填写有效的开始与结束时间' : '',
      startTime && endTime && new Date(endTime) <= new Date(startTime) ? '结束时间必须晚于开始时间' : '',
      !isEdit && startTime && new Date(startTime) <= new Date() ? '开始时间必须晚于当前时间' : '',
      editContestStarted && startTime !== originalStartTimeStr ? '比赛已经开始，不能修改开始时间' : '',
      isEdit && !editContestStarted && startTime !== originalStartTimeStr && new Date(startTime) <= new Date() ? '修改后的开始时间必须晚于当前时间' : '',
      isEdit && endTime && new Date(endTime) <= new Date() ? '结束时间必须晚于当前时间' : '',
    ].filter(Boolean)
    if (step === 1) return mode === 'contest' && !ratingConfigurationValid ? ['请修正 Rating 范围、影响强度或最低人数'] : []
    if (step === 2) return [
      mode === 'contest' && problemRows.length === 0 ? '请至少添加一道题目' : '',
      problemRows.some(row => !row.resolved?.found) ? '仍有题目未能解析' : '',
      problemRows.some(row => row.contentOptionsLoading) ? '题面选项仍在加载' : '',
      problemRows.some(row => row.contentOptionsError) ? '题面选项加载失败，请在题目行重试' : '',
      problemRows.some(row => !row.statementOptionKey) ? '存在未指定有效题面版本的题目' : '',
      format !== 'icpc' && problemRows.some(row => !Number.isFinite(row.points) || row.points < 0) ? '题目分值无效' : '',
    ].filter(Boolean)
    return []
  }
  const contestWizard = mode === 'contest'
  const wizardSteps = ['基本信息', '赛制与 Rating', '题目', '可见性', '发布前检查']
  const canReachStep = (target: number) => target <= 0 || Array.from({ length: target }, (_, index) => stepIssues(index).length === 0).every(Boolean)
  const currentStepIssues = contestWizard ? stepIssues(wizardStep) : []
  const contestValidationIssues = [0, 1, 2, 3].flatMap(stepIssues)

  const handleSave = async () => {
    if (savingRef.current || loading || loadError || recoveryBlocked || !readyRef.current) return
    if (contestValidationIssues.length) { toast.error(contestValidationIssues[0]); return }
    const changedContent = problemRows.some(row => row.existing && (
      row.statementOptionKey !== row.originalStatementOptionKey || row.solutionOptionKey !== row.originalSolutionOptionKey
    ))
    if (editContestStarted && changedContent && !window.confirm('更换后所有参与者将看到新版本，旧版本会保留在活动快照历史中。确定继续吗？')) return

    savingRef.current = true
    setSaving(true)
    setRecoveryMessage('')
    setSaveReceipts([])
    const rows = problemRows.map(row => ({ ...row }))
    const receipts: string[] = []
    let targetId = contestId || null
    let writeAttempted = false
    let baselineConflict = false
    let complete = false
    const active = () => {
      if (!mountedRef.current) throw new Error('编辑目标已关闭，已停止后续保存步骤')
    }
    const read = async <T,>(action: () => Promise<StepResponse<T>>, message: string): Promise<T> => {
      active()
      const response = await action()
      active()
      return responseData(response, message)
    }
    const write = async <T,>(label: string, action: () => Promise<StepResponse<T>>, requireId = false): Promise<StepResponse<T>> => {
      active()
      writeAttempted = true
      const response = await action()
      active()
      if (!response.success) throw new Error(`${label}失败：${response.message || '服务器拒绝请求'}`)
      if (requireId) {
        const id = (response.data as IdResponse | undefined)?.id
        if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim()) {
          throw new Error(`${label}缺少服务端 ID，结果待确认`)
        }
      }
      receipts.push(label)
      setSaveReceipts([...receipts])
      return response
    }

    try {
      if (contestId) {
        const baseline = baselineProblemsRef.current
        if (!baseline) throw new Error('缺少编辑基线，请重新加载')
        const freshInfo = await read(() => apiClient.get<ContestFormInfo>(`/api/contests/${contestId}`), '无法核对比赛信息')
        const freshProblems = await read(() => apiClient.get<ExistingContestProblem[]>(`/api/contests/${contestId}/problems`), '无法核对比赛题目')
        if (infoSnapshot(freshInfo) !== baselineInfoRef.current || contestProblemSnapshot(freshProblems) !== contestProblemSnapshot(baseline)) {
          baselineConflict = true
          throw new Error('服务器上的比赛已被修改，未开始写入。请保留草稿并核对最新状态')
        }
        await write('更新比赛信息', () => apiClient.put(`/api/contests/${contestId}`, {
          title, description, format, problemIdVisible, solutionVisible, includeAdminInRanking,
          ...(startTime !== originalStartTimeStr ? { startTime: new Date(startTime).toISOString() } : {}),
          endTime: new Date(endTime).toISOString(),
        }))
      } else {
        const createUrl = organizationId ? `/api/organizations/${organizationId}/members/activities/contests`
          : teamId ? `/api/teams/${teamId}/contests` : '/api/platform-contests'
        const created = await write('创建比赛', () => apiClient.post<IdResponse>(createUrl, {
          title, description, format, type: mode, startTime: new Date(startTime).toISOString(), endTime: new Date(endTime).toISOString(),
          problemIdVisible, solutionVisible, includeAdminInRanking,
        }), true)
        targetId = String(responseData(created, '创建结果缺少比赛 ID').id)
      }
      const target = targetId!
      if (mode === 'contest' && (!isEdit || !ratingLocked)) {
        let revision = ratingRevision
        if (!isEdit) {
          const config = await read(() => apiClient.get<ContestRatingConfig>(`/api/contests/${target}/rating-config`), '无法读取新比赛的 Rating 配置')
          revision = config.revision ?? 0
        }
        await write('保存 Rating 配置', () => apiClient.put(`/api/contests/${target}/rating-config`, {
          scope: ratingScope, weight: Number(ratingWeight), organizationMinParticipants: Number(organizationRatingMinimum),
          globalMinParticipants: Number(globalRatingMinimum), expectedRevision: revision,
        }))
      }

      // Delete only explicit removals from the loaded baseline, never a newly fetched
      // row that another editor added after this modal was opened.
      for (const id of contestProblemDeletions(baselineProblemsRef.current || [], rows)) {
        await write(`移除题目条目 ${id}`, () => apiClient.delete(`/api/contests/${target}/problems/${id}`))
      }
      const createdIds = new Map<string, string>()
      for (const row of rows) {
        const points = format === 'icpc' ? null : row.points
        if (row.contestProblemId) {
          await write(`更新题目 ${row.problemId}`, () => apiClient.put(`/api/contests/${target}/problems/${row.contestProblemId}`, { alias: row.alias, points }))
          if (row.statementOptionKey !== row.originalStatementOptionKey || row.solutionOptionKey !== row.originalSolutionOptionKey) {
            await write(`保存题目 ${row.problemId} 的内容版本`, () => apiClient.put(`/api/contests/${target}/problems/${row.contestProblemId}/content-selection`, {
              statementOptionKey: row.statementOptionKey, solutionOptionKey: row.solutionOptionKey || 'none',
            }))
          }
        } else {
          const result = await write(`新增题目 ${row.problemId}`, () => apiClient.post<IdResponse>(`/api/contests/${target}/problems`, {
            problemId: row.resolved!.canonicalProblemId, alias: row.alias, points,
            statementOptionKey: row.statementOptionKey, solutionOptionKey: row.solutionOptionKey || 'none',
          }), true)
          const id = String(responseData(result, '新增题目缺少条目 ID').id)
          createdIds.set(row.id, id)
          // Keep the confirmed receipt on the original row even if a later step fails.
          setProblemRows(current => current.map(item => item.id === row.id ? { ...item, contestProblemId: id, existing: true } : item))
        }
      }
      const orders = contestProblemOrders(rows, createdIds)
      const beforeOrder = await read(() => apiClient.get<ExistingContestProblem[]>(`/api/contests/${target}/problems`), '无法确认排序前的题目集合')
      assertContestProblemMembership(beforeOrder, orders)
      if (orders.length) await write('保存完整题目顺序', () => apiClient.put(`/api/contests/${target}/problems/reorder`, { orders }))
      const saved = await read(() => apiClient.get<ExistingContestProblem[]>(`/api/contests/${target}/problems`), '无法回读确认保存结果')
      assertContestProblemMembership(saved, orders)
      if (JSON.stringify(saved.map(row => String(row.id))) !== JSON.stringify(orders.map(order => order.id))) {
        throw new Error('回读的题目顺序与草稿不一致，整笔保存尚未确认')
      }
      complete = true
    } catch (error) {
      if (mountedRef.current) {
        const message = error instanceof Error ? error.message : '保存失败'
        setRecoveryContestId(targetId)
        setRecoveryBlocked(writeAttempted || baselineConflict)
        setRecoveryMessage(`${message}。${writeAttempted ? '部分请求可能已经保存；当前草稿和已确认回执已保留。请先核对服务器状态，不要直接重复提交。' : '当前输入已保留。'}`)
        toast.error(message)
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
    // Parent callbacks are not part of the persistence attempt and cannot convert a
    // successfully verified save into a spurious recovery state.
    if (complete && mountedRef.current) {
      toast.success(`${entityName}${isEdit ? '更新' : '创建'}成功`)
      onClose()
      onSaved?.()
    }
  }

  const exportDraft = () => {
    const data = { version: 1, contestId: recoveryContestId || contestId || null, organizationId, teamId, schoolId, mode,
      form: JSON.parse(formSnapshot), rows: problemRows, confirmedSteps: saveReceipts, message: recoveryMessage }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `contest-draft-${recoveryContestId || contestId || 'new'}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const recoveryHref = recoveryContestId ? (organizationId ? `/org/${organizationId}/contests/${recoveryContestId}`
    : teamId ? `/personal/teams/${teamId}/contests/${recoveryContestId}`
      : `${user?.accountRole === 'super_admin' ? '/admin' : '/platform-admin'}/contests/${recoveryContestId}`) : null

  return <>
    <FormDialog isOpen={isOpen} onClose={onClose} title={`${isEdit ? '编辑' : '创建'}${entityName}`} size="xl"
      dirty={formDirty || recoveryBlocked} loading={saving || loading}
      footer={<div className={unifiedStyles.u1}>
        <Button variant="secondary" onClick={requestClose} disabled={saving || loading}>取消</Button>
        {contestWizard && wizardStep > 0 && <Button variant="secondary" onClick={() => setWizardStep(step => step - 1)} disabled={saving || loading}>上一步</Button>}
        {contestWizard && wizardStep < wizardSteps.length - 1
          ? <Button onClick={() => setWizardStep(step => step + 1)} disabled={saving || loading || Boolean(loadError) || (!recoveryBlocked && !canReachStep(wizardStep + 1))}>下一步</Button>
          : <Button onClick={() => void handleSave()} disabled={saving || loading || Boolean(loadError) || recoveryBlocked || contestValidationIssues.length > 0}>
            {saving ? '保存中...' : isEdit ? '保存修改' : `创建${entityName}`}
          </Button>}
      </div>}>
      <div className={unifiedStyles.u2}>
        {loading ? <div className={unifiedStyles.u3}><span className={['resource-skeleton-line', collisionStyles.u1].filter(Boolean).join(' ')} aria-label="内容正在准备" /></div>
          : loadError ? <section className={unifiedStyles.reviewCard} role="alert"><p>{loadError}</p><Button onClick={() => setLoadAttempt(value => value + 1)}>重新加载</Button></section>
          : <>
            {contestWizard && <div className={unifiedStyles.wizardSteps} role="tablist" aria-label="比赛创建步骤">{wizardSteps.map((label, index) => <Button key={label} size="sm" variant={index === wizardStep ? 'primary' : index < wizardStep ? 'secondary' : 'ghost'} disabled={saving || (!recoveryBlocked && !canReachStep(index))} onClick={() => setWizardStep(index)} aria-current={index === wizardStep ? 'step' : undefined}>{index + 1}. {label}</Button>)}</div>}
            {recoveryMessage && <section className={unifiedStyles.reviewCard} role="alert">
              <h3>保存未完整完成</h3><p>{recoveryMessage}</p>
              {saveReceipts.length > 0 && <details><summary>已确认完成 {saveReceipts.length} 个步骤，不代表整笔保存成功</summary><ul>{saveReceipts.map((receipt, index) => <li key={index}>{receipt}</li>)}</ul></details>}
              <Button onClick={exportDraft}>导出当前草稿</Button>
              {recoveryHref && <Button variant="secondary" onClick={() => window.open(recoveryHref, '_blank', 'noopener,noreferrer')}>新窗口核对比赛</Button>}
              {recoveryBlocked && <p>已停止直接重试。核对后请重新打开编辑器；完整事务与幂等恢复接入前，不自动重放部分完成的操作。</p>}
            </section>}
            {contestWizard && currentStepIssues.length > 0 && <section className={unifiedStyles.reviewCard} role="alert"><strong>完成本步骤后可继续</strong><ul className={unifiedStyles.reviewIssues}>{currentStepIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></section>}
            {(!contestWizard || wizardStep === 0) && <div className={unifiedStyles.u4}>
              <label className={unifiedStyles.u5}>标题 *</label>
              <Input value={title} disabled={saving} onChange={event => setTitle(event.target.value)} placeholder={`${entityName}名称`} />
            </div>}
            {contestWizard && wizardStep === 1 && <div className={unifiedStyles.u6}>
              <div><label className={unifiedStyles.u5}>赛制</label>
                <Select aria-label="比赛赛制" value={format} disabled={saving || ratingLocked} onChange={event => setFormat(event.target.value as typeof format)}>
                  <option value="ioi">IOI（即时反馈 + 部分分）</option><option value="icpc">ICPC（即时反馈 + AC / 罚时）</option><option value="oi">OI（赛中不反馈，赛后统一公布）</option>
                </Select>
              </div>
              <div><label className={unifiedStyles.u5}>Rating 范围</label>
                <Select aria-label="Rating 范围" value={ratingScope} disabled={saving || ratingLocked} onChange={event => setRatingScope(event.target.value as typeof ratingScope)}>
                  {allowedRatingScopes.includes('NONE') && <option value="NONE">不计 Rating</option>}
                  {allowedRatingScopes.includes('ORGANIZATION') && <option value="ORGANIZATION">本校 Rating</option>}
                  {allowedRatingScopes.includes('GLOBAL') && <option value="GLOBAL">全局 Rating</option>}
                  {allowedRatingScopes.includes('BOTH') && <option value="BOTH">全局 + 本校</option>}
                </Select>
                <small>{ratingLocked ? '比赛已经开始，Rating 规则已永久冻结。' : `${organizationId ? '学校比赛只影响本校 Rating。' : teamId ? '个人团队赛暂不计个人 Rating。' : ''} Rating 类型会自动跟随赛制：${format === 'icpc' ? 'ACM' : format.toUpperCase()}`}</small>
              </div>
              {ratingScope !== 'NONE' && <>
                <div><label className={unifiedStyles.u5}>Rating 权重</label><Input aria-label="Rating 权重" type="number" min="0.1" max="1" step="0.1" value={ratingWeight} disabled={saving || ratingLocked} onChange={event => setRatingWeight(event.target.value)} /><small>影响强度：标准比赛的 {Math.round((Number(ratingWeight) || 0) * 100)}%</small></div>
                <div><label className={unifiedStyles.u5}>本校 / 全局最低人数</label><div className={unifiedStyles.u1}>
                  <Input aria-label="本校 Rating 最低人数" type="number" min="2" value={organizationRatingMinimum} disabled={saving || ratingLocked} onChange={event => setOrganizationRatingMinimum(event.target.value)} />
                  <Input aria-label="全局 Rating 最低人数" type="number" min="2" value={globalRatingMinimum} disabled={saving || ratingLocked} onChange={event => setGlobalRatingMinimum(event.target.value)} />
                </div></div>
              </>}
            </div>}
            {(!contestWizard || wizardStep === 0) && <>
              <div className={unifiedStyles.u4}><label className={unifiedStyles.u5}>公告</label><Textarea value={description} disabled={saving} onChange={event => setDescription(event.target.value)} placeholder={`${entityName}说明（可选）`} rows={2} className={unifiedStyles.descriptionInput} /></div>
              <div className={unifiedStyles.u6}>
                {!contestWizard && <div><label className={unifiedStyles.u5}>赛制</label><Select aria-label="赛制" value={format} disabled={saving} onChange={event => setFormat(event.target.value as typeof format)}><option value="ioi">IOI（即时反馈+部分分）</option><option value="icpc">ICPC（即时反馈+AC/罚时）</option><option value="oi">OI（赛中不反馈，赛后统一公布）</option></Select></div>}
                <div><label className={unifiedStyles.u5}>开始时间 *</label><Input type="datetime-local" value={startTime} disabled={saving} onChange={event => setStartTime(event.target.value)} /></div>
                <div><label className={unifiedStyles.u5}>结束时间 *</label><Input type="datetime-local" value={endTime} disabled={saving} onChange={event => setEndTime(event.target.value)} /></div>
              </div>
            </>}
            {(!contestWizard || wizardStep === 3) && <div className={unifiedStyles.u6}>
              <div><label className={unifiedStyles.u5}>题目来源显示</label><Select aria-label="题目来源显示" value={problemIdVisible ? 'always' : 'after'} disabled={saving} onChange={event => setProblemIdVisible(event.target.value === 'always')}><option value="after">赛后显示</option><option value="always">始终显示</option></Select></div>
              <div><label className={unifiedStyles.u5}>题解显示</label><Select aria-label="题解显示" value={solutionVisible ? 'always' : 'after'} disabled={saving} onChange={event => setSolutionVisible(event.target.value === 'always')}><option value="after">赛后显示</option><option value="always">始终显示</option></Select></div>
              <div><label className={unifiedStyles.u5}>管理员排名</label><label className={unifiedStyles.u7}><Input type="checkbox" checked={includeAdminInRanking} disabled={saving} onChange={event => setIncludeAdminInRanking(event.target.checked)} className={unifiedStyles.u8} /><span className={unifiedStyles.u9}>包含管理员</span></label></div>
            </div>}
            {(!contestWizard || wizardStep === 2) && <div className={unifiedStyles.u10}>
              <div className={unifiedStyles.sectionHeading}><h3 className={unifiedStyles.u11}>{contestWizard ? '比赛题目' : '题目列表'}</h3></div>
              <ProblemReferenceSelector disabled={saving || recoveryBlocked} existingProblemIds={problemRows.flatMap(row => row.resolved ? [row.resolved.canonicalProblemId] : [])} onAdd={addSelectedProblems} />
              {problemRows.length > 0 ? <>
                <div className={unifiedStyles.selectedProblems} aria-label="已选比赛题目">{problemRows.map((row, index) => <div key={row.id} className={unifiedStyles.selectedProblemCard}><strong>{row.alias || String.fromCharCode(65 + index)}</strong><span>{row.resolved ? <ProblemReferenceLink problem={{ id: row.resolved.canonicalProblemId, platform: row.platform, problemId: row.problemId, title: row.resolved.title }} showIdentity={false} /> : row.problemId}</span></div>)}</div>
                <div className={unifiedStyles.u12}><TableRoot className={unifiedStyles.u13}>
                  <TableHead><TableRow className={unifiedStyles.u14}>
                    <TableHeaderCell className={unifiedStyles.u15}>排序</TableHeaderCell><TableHeaderCell className={unifiedStyles.u16}>#</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u17}>OJ</TableHeaderCell><TableHeaderCell className={unifiedStyles.u18}>题号</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u19}>题目</TableHeaderCell><TableHeaderCell className={unifiedStyles.u20}>别名</TableHeaderCell>
                    {format !== 'icpc' && <TableHeaderCell className={unifiedStyles.u21}>分值</TableHeaderCell>}<TableHeaderCell className={unifiedStyles.u22}>操作</TableHeaderCell>
                  </TableRow></TableHead>
                  <TableBody>{problemRows.map((row, index) => <TableRow key={row.id} className={`${unifiedStyles.problemRow} ${row.existing ? unifiedStyles.existingProblem : unifiedStyles.newProblem}`}>
                    <TableCell className={unifiedStyles.u23}><Button variant="secondary" size="sm" onClick={() => moveRow(index, -1)} disabled={saving || index === 0} className={unifiedStyles.moveButtonFirst} title="上移">↑</Button><Button variant="secondary" size="sm" onClick={() => moveRow(index, 1)} disabled={saving || index === problemRows.length - 1} className={unifiedStyles.moveButton} title="下移">↓</Button></TableCell>
                    <TableCell className={unifiedStyles.u24}>{index + 1}</TableCell><TableCell className={unifiedStyles.u25}>{row.platform}</TableCell><TableCell className={unifiedStyles.u25}>{row.problemId}</TableCell>
                    <TableCell className={unifiedStyles.u27}><span className={unifiedStyles.u31}>{row.resolved ? <ProblemReferenceLink problem={{ id: row.resolved.canonicalProblemId, platform: row.platform, problemId: row.problemId, title: row.resolved.title }} showIdentity={false} /> : '等待识别题目'}</span>
                      {row.contentOptionsLoading && <p>题面选项加载中…</p>}
                      {row.contentOptionsError && <p role="alert">{row.contentOptionsError} <Button size="sm" disabled={saving} onClick={() => row.resolved && void loadRowOptions(row.id, row.resolved.canonicalProblemId)}>重试加载</Button></p>}
                    </TableCell>
                    <TableCell className={unifiedStyles.u34}><Input value={row.alias} disabled={saving} onChange={event => updateRow(row.id, { alias: event.target.value })} className={unifiedStyles.u35} /></TableCell>
                    {format !== 'icpc' && <TableCell className={unifiedStyles.u34}><Input type="number" value={row.points} disabled={saving} onChange={event => updateRow(row.id, { points: Number(event.target.value) })} className={unifiedStyles.u36} /></TableCell>}
                    <TableCell className={unifiedStyles.u34}><Button variant="ghost" disabled={saving} onClick={() => removeRow(row.id)} className={unifiedStyles.u37} title="移除">✕</Button></TableCell>
                  </TableRow>)}</TableBody>
                </TableRoot></div>
              </> : <div className={unifiedStyles.u39}>还没有添加题目，请选择平台并输入题号。</div>}
            </div>}
            {contestWizard && wizardStep === 4 && <section className={unifiedStyles.reviewCard}><h3>发布前检查</h3>
              {contestValidationIssues.length > 0 ? <ul className={unifiedStyles.reviewIssues}>{contestValidationIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>比赛信息完整。确认后将保存比赛；开始前仍可编辑未冻结字段。</p>}
              <dl><div><dt>比赛</dt><dd>{title || '未填写名称'}</dd></div><div><dt>时间</dt><dd>{startTime} 至 {endTime}</dd></div><div><dt>赛制</dt><dd>{format.toUpperCase()}</dd></div>
                <div><dt>Rating</dt><dd>{ratingScope === 'NONE' ? '不计 Rating' : `${ratingScope === 'BOTH' ? '全局 + 本校' : ratingScope === 'GLOBAL' ? '全局' : '本校'} · 标准比赛的 ${Math.round((Number(ratingWeight) || 0) * 100)}%`}</dd></div>
                <div><dt>题目</dt><dd>{problemRows.length} 道，创建时固定各题当前评测数据版本</dd></div><div><dt>原题来源</dt><dd>{problemIdVisible ? '比赛期间显示' : '比赛结束后显示'}</dd></div><div><dt>题解</dt><dd>{solutionVisible ? '比赛期间显示' : '比赛结束后显示'}</dd></div>
              </dl>
            </section>}
          </>}
      </div>
    </FormDialog>
    <ConfirmDialog isOpen={closeRequested} onClose={() => setCloseRequested(false)} onConfirm={() => { setCloseRequested(false); onClose() }}
      title="放弃本地未保存的配置？" message={recoveryBlocked ? '已经确认保存的步骤不会回滚。关闭会丢弃本地剩余草稿，请先导出并核对服务器状态。' : '关闭后，本次尚未保存的配置修改将丢失。'} confirmText="放弃本地修改" danger />
  </>
}
