'use client'

import { useState, useEffect, useRef } from 'react'
import collisionStyles from './TrainingFormModal.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './TrainingFormModal.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { DetailDialog, FormDialog } from '@/components/ui/Dialogs'
import { Tabs } from '@/components/ui/Tabs'
import { OJ_PLATFORMS_NO_ALL } from '@/lib/oj-platforms'
import { useAuth } from '@/components/AuthProvider'

function toLocalDatetimeString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

interface ResolvedProblem {
  found: boolean
  problemId: string
  title: string
  created: boolean
}

interface PickerProblem {
  id: string
  platform: string
  problemId: string
  title: string
  difficulty?: string | null
}

interface ContentOption {
  key: string
  sourceType: 'canonical' | 'user' | 'training' | 'none'
  title: string | null
  format: string
  language: string | null
  authorUsername: string | null
  fileName: string | null
  previewText: string | null
}

interface ProblemRow {
  id: string
  trainingProblemId?: string
  ojName: string
  problemCode: string
  alias: string
  points: number
  resolving: boolean
  resolved: ResolvedProblem | null
  existing?: boolean
  contentOptionsLoading?: boolean
  statementOptions?: ContentOption[]
  solutionOptions?: ContentOption[]
  statementOptionKey?: string
  solutionOptionKey?: string
  originalStatementOptionKey?: string
  originalSolutionOptionKey?: string
}

interface TrainingFormInfo {
  title: string
  description?: string | null
  format: 'oi' | 'ioi' | 'icpc'
  problemIdVisible?: boolean
  solutionVisible?: boolean
  includeAdminInRanking?: boolean
  startTime: string
  endTime: string
}

interface TrainingRatingConfig {
  scope?: 'NONE' | 'ORGANIZATION' | 'GLOBAL' | 'BOTH'
  weight?: number
  organizationMinParticipants?: number
  globalMinParticipants?: number
  revision?: number
  lockedAt?: string | null
  editable?: boolean
  allowedScopes?: Array<'NONE' | 'ORGANIZATION' | 'GLOBAL' | 'BOTH'>
}

interface ExistingTrainingProblem {
  id: string
  platform?: string | null
  platformProblemId?: string | null
  problemId: string
  problemTitle?: string | null
  alias?: string | null
  points?: number | null
}

type IdResponse = { id: string | number }
type ResolveProblemsResponse = { resolved: ResolvedProblem[] }

interface TrainingFormModalProps {
  isOpen: boolean
  onClose: () => void
  teamId?: string
  schoolId?: string
  organizationId?: string
  trainingId?: string
  onSaved?: () => void
  mode?: 'training' | 'contest' | 'homework'
}

let tempIdCounter = 0

export function TrainingFormModal({ isOpen, onClose, teamId, schoolId, organizationId, trainingId, onSaved, mode = 'training' }: TrainingFormModalProps) {
  const toast = useToast()
  const { user } = useAuth()
  const isEdit = !!trainingId

  // Form state
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
  const [problemPickerOpen, setProblemPickerOpen] = useState(false)
  const [problemSource, setProblemSource] = useState<'school' | 'carits' | 'external'>(organizationId ? 'school' : 'carits')
  const [problemQuery, setProblemQuery] = useState('')
  const [problemPool, setProblemPool] = useState<PickerProblem[]>([])
  const [problemPoolLoading, setProblemPoolLoading] = useState(false)
  const [problemPoolError, setProblemPoolError] = useState('')
  const [recoveryTrainingId, setRecoveryTrainingId] = useState<string | null>(null)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [originalStartTime, setOriginalStartTime] = useState<Date | null>(null)
  const [originalStartTimeStr, setOriginalStartTimeStr] = useState<string>('')

  // Problem management
  const [problemRows, setProblemRows] = useState<ProblemRow[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const resolveTimerRef = useRef<Record<string, NodeJS.Timeout>>({})

  // Reset / load data when modal opens
  useEffect(() => {
    if (!isOpen) return
    setWizardStep(0)
    setRecoveryTrainingId(null)
    setRecoveryMessage('')
    setProblemPickerOpen(false)
    setProblemQuery('')
    setProblemSource(organizationId ? 'school' : 'carits')

    if (isEdit && trainingId) {
      // 编辑模式：加载已有数据
      const loadTraining = async () => {
        setLoading(true)
        try {
          const infoRes = await apiClient.get<TrainingFormInfo>(`/api/trainings/${trainingId}`)
          if (infoRes.success && infoRes.data) {
            const t = infoRes.data
            setTitle(t.title)
            setDescription(t.description || '')
            setFormat(t.format as 'oi' | 'ioi' | 'icpc')
            setProblemIdVisible(t.problemIdVisible ?? false)
            setSolutionVisible(t.solutionVisible ?? false)
            setIncludeAdminInRanking(t.includeAdminInRanking ?? false)
            const startStr = toLocalDatetimeString(new Date(t.startTime))
            setStartTime(startStr)
            setEndTime(toLocalDatetimeString(new Date(t.endTime)))
            setOriginalStartTime(new Date(t.startTime))
            setOriginalStartTimeStr(startStr)
          }
          if (mode === 'contest') {
            const ratingRes = await apiClient.get<TrainingRatingConfig>(`/api/trainings/${trainingId}/rating-config`)
            if (ratingRes.success && ratingRes.data) {
              const config = ratingRes.data
              setRatingScope(config.scope || 'NONE')
              setRatingWeight(String(config.weight ?? 1))
              setOrganizationRatingMinimum(String(config.organizationMinParticipants ?? 5))
              setGlobalRatingMinimum(String(config.globalMinParticipants ?? 20))
              setRatingRevision(config.revision ?? 0)
              setRatingLocked(Boolean(config.lockedAt) || config.editable === false)
              if (Array.isArray(config.allowedScopes)) setAllowedRatingScopes(config.allowedScopes)
            }
          }

          const problemsRes = await apiClient.get<ExistingTrainingProblem[]>(`/api/trainings/${trainingId}/problems`)
          if (problemsRes.success && problemsRes.data) {
            const rows: ProblemRow[] = await Promise.all(problemsRes.data.map(async (p) => {
              const optionsRes = await apiClient.get<{
                statement: ContentOption[]
                solution: ContentOption[]
                currentSelection: { statementOptionKey: string | null; solutionOptionKey: string | null }
              }>(`/api/trainings/${trainingId}/problems/${p.id}/content-options`)
              const options = optionsRes.success ? optionsRes.data : null
              return {
                id: `existing-${p.id}`,
                trainingProblemId: p.id,
                ojName: p.platform || 'carits',
                problemCode: p.platformProblemId || p.problemId || '',
                alias: p.alias || '',
                points: p.points ?? 100,
                resolving: false,
                resolved: {
                  found: true,
                  problemId: p.problemId,
                  title: p.problemTitle || '',
                  created: false,
                },
                existing: true,
                statementOptions: options?.statement || [],
                solutionOptions: options?.solution || [],
                statementOptionKey: options?.currentSelection.statementOptionKey || options?.statement[0]?.key,
                solutionOptionKey: options?.currentSelection.solutionOptionKey || options?.solution.find(option => option.key !== 'none')?.key || 'none',
                originalStatementOptionKey: options?.currentSelection.statementOptionKey || options?.statement[0]?.key,
                originalSolutionOptionKey: options?.currentSelection.solutionOptionKey || options?.solution.find(option => option.key !== 'none')?.key || 'none',
              }
            }))
            setProblemRows(rows)
          }
        } catch {
          toast.error('加载失败')
        } finally {
          setLoading(false)
        }
      }
      loadTraining()
    } else {
      // 创建模式：空表单
      setTitle('')
      setDescription('')
      setFormat('ioi')
      setProblemIdVisible(false)
      setSolutionVisible(false)
      setIncludeAdminInRanking(false)
      setRatingScope('NONE')
      setRatingWeight('1')
      setOrganizationRatingMinimum('5')
      setGlobalRatingMinimum('20')
      setRatingRevision(0)
      setRatingLocked(false)
      setProblemRows([])
      setSaving(false)
      setOriginalStartTime(null)
      setOriginalStartTimeStr('')

      const now = new Date()
      let hours = now.getHours()
      const minutes = now.getMinutes()
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())

      if (minutes > 0) hours += 1
      if (hours >= 22) {
        date.setDate(date.getDate() + 1)
        hours = 8
      }
      date.setHours(hours, 0, 0, 0)

      setStartTime(toLocalDatetimeString(date))
      const end = new Date(date)
      end.setHours(end.getHours() + 3)
      setEndTime(toLocalDatetimeString(end))
    }
  }, [isOpen, trainingId])

  useEffect(() => {
    if (!isOpen || !problemPickerOpen || mode !== 'contest') return
    const timer = window.setTimeout(async () => {
      setProblemPoolLoading(true)
      setProblemPoolError('')
      const params = new URLSearchParams({ page: '1', pageSize: '30' })
      if (problemQuery.trim()) params.set('keyword', problemQuery.trim())
      if (problemSource === 'school') params.set('library', 'school')
      else {
        params.set('library', 'platform')
        params.set('sourceGroup', problemSource)
      }
      const result = await apiClient.get<{ data: PickerProblem[] }>(`/api/problems?${params}`)
      if (result.success) setProblemPool(result.data?.data || [])
      else {
        setProblemPool([])
        setProblemPoolError(result.message || '题目列表加载失败')
      }
      setProblemPoolLoading(false)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [isOpen, mode, problemPickerOpen, problemQuery, problemSource])

  useEffect(() => {
    if (!isOpen || isEdit || mode !== 'contest') return
    if (teamId && format === 'icpc') setAllowedRatingScopes(['NONE'])
    else if (organizationId) setAllowedRatingScopes(['NONE', 'ORGANIZATION'])
    else if (teamId) setAllowedRatingScopes(['NONE'])
    else if (user && ['super_admin', 'platform_admin'].includes(user.accountRole)) setAllowedRatingScopes(['NONE', 'GLOBAL', 'BOTH'])
    else setAllowedRatingScopes(['NONE'])
  }, [isOpen, isEdit, mode, organizationId, teamId, user, format])

  useEffect(() => {
    if (!allowedRatingScopes.includes(ratingScope)) setRatingScope('NONE')
  }, [allowedRatingScopes, ratingScope])

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      Object.values(resolveTimerRef.current).forEach(clearTimeout)
    }
  }, [])

  const getLastOjPlatform = () => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('lastOjPlatform') : null
    if (saved) return saved
    return 'carits'
  }

  const addProblemRow = () => {
    const row: ProblemRow = {
      id: `temp-${++tempIdCounter}`,
      ojName: getLastOjPlatform(),
      problemCode: '',
      alias: '',
      points: 100,
      resolving: false,
      resolved: null,
      statementOptions: [],
      solutionOptions: [],
      contentOptionsLoading: false,
    }
    setProblemRows(prev => [...prev, row])
  }

  const updateRow = (rowId: string, updates: Partial<ProblemRow>) => {
    setProblemRows(prev => prev.map(r => r.id === rowId ? { ...r, ...updates } : r))
    if (updates.ojName) localStorage.setItem('lastOjPlatform', updates.ojName)
  }

  const addPickedProblem = async (problem: PickerProblem) => {
    if (problemRows.some(row => row.resolved?.problemId === problem.id)) return
    const id = `picked-${++tempIdCounter}`
    setProblemRows(current => [...current, {
      id,
      ojName: problem.platform,
      problemCode: problem.problemId,
      alias: '',
      points: 100,
      resolving: false,
      resolved: { found: true, problemId: problem.id, title: problem.title, created: false },
      contentOptionsLoading: true,
      statementOptions: [],
      solutionOptions: [],
    }])
    const options = await apiClient.get<{ statement: ContentOption[]; solution: ContentOption[] }>(`/api/problems/${problem.id}/content-options`)
    if (!options.success) {
      updateRow(id, { contentOptionsLoading: false })
      return
    }
    updateRow(id, {
      contentOptionsLoading: false,
      statementOptions: options.data?.statement || [],
      solutionOptions: options.data?.solution || [],
      statementOptionKey: options.data?.statement?.[0]?.key,
      solutionOptionKey: options.data?.solution?.find(option => option.key !== 'none')?.key || 'none',
    })
  }

  const removeRow = (rowId: string) => {
    if (resolveTimerRef.current[rowId]) {
      clearTimeout(resolveTimerRef.current[rowId])
      delete resolveTimerRef.current[rowId]
    }
    setProblemRows(prev => prev.filter(r => r.id !== rowId))
  }

  const handleResolve = (row: ProblemRow) => {
    if (resolveTimerRef.current[row.id]) clearTimeout(resolveTimerRef.current[row.id])
    if (!row.problemCode.trim()) {
      updateRow(row.id, { resolved: null, resolving: false })
      return
    }
    updateRow(row.id, {
      resolving: true,
      contentOptionsLoading: true,
      statementOptions: [],
      solutionOptions: [],
      statementOptionKey: undefined,
      solutionOptionKey: undefined,
    })
    resolveTimerRef.current[row.id] = setTimeout(async () => {
      try {
        const res = await apiClient.post<ResolveProblemsResponse>(`/api/resolve-problems`, {
          items: [{ ojName: row.ojName, problemCode: row.problemCode.trim() }]
        })
        if (res.success && res.data) {
          const resolved = res.data.resolved
          if (resolved && resolved.length > 0) {
            const found = resolved[0] as ResolvedProblem
            if (!found.found) {
              updateRow(row.id, { resolved: found, resolving: false, contentOptionsLoading: false })
              return
            }
            const optionsRes = await apiClient.get<{
              statement: ContentOption[]
              solution: ContentOption[]
            }>(`/api/problems/${found.problemId}/content-options`)
            const options = optionsRes.success ? optionsRes.data : null
            updateRow(row.id, {
              resolved: found,
              resolving: false,
              contentOptionsLoading: false,
              statementOptions: options?.statement || [],
              solutionOptions: options?.solution || [],
              statementOptionKey: options?.statement[0]?.key,
              solutionOptionKey: options?.solution.find(option => option.key !== 'none')?.key || 'none',
            })
          }
        }
      } catch {
        updateRow(row.id, { resolving: false, contentOptionsLoading: false })
      }
    }, 500)
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    const rows = [...problemRows]
    const temp = rows[idx - 1]
    rows[idx - 1] = rows[idx]
    rows[idx] = temp
    setProblemRows(rows)
  }

  const moveDown = (idx: number) => {
    if (idx === problemRows.length - 1) return
    const rows = [...problemRows]
    const temp = rows[idx]
    rows[idx] = rows[idx + 1]
    rows[idx + 1] = temp
    setProblemRows(rows)
  }

  const handleSave = async () => {
    if (!title.trim()) { toast.error('请输入标题'); return }
    if (!startTime || !endTime) { toast.error('请设置开始和结束时间'); return }
    if (new Date(endTime) <= new Date(startTime)) { toast.error('结束时间必须晚于开始时间'); return }

    if (isEdit) {
      // 编辑模式验证
      const isStarted = originalStartTime ? new Date() >= originalStartTime : false
      if (isStarted && startTime !== originalStartTimeStr) {
        toast.error(`${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}已经开始，不能修改开始时间`)
        return
      }
      if (!isStarted && startTime !== originalStartTimeStr && new Date(startTime) <= new Date()) {
        toast.error('开始时间不能早于当前时间')
        return
      }
      if (new Date(endTime) <= new Date()) {
        toast.error('结束时间不能早于当前时间')
        return
      }

      const newRows = problemRows.filter(r => !r.existing && r.problemCode.trim())
      const unresolvedRows = newRows.filter(r => !r.resolved || !r.resolved.found)
      if (unresolvedRows.length > 0) {
        toast.error(`有 ${unresolvedRows.length} 道题目未找到，请检查题号`)
        return
      }
      const changedContent = problemRows.some(row => row.existing && (
        row.statementOptionKey !== row.originalStatementOptionKey ||
        row.solutionOptionKey !== row.originalSolutionOptionKey
      ))
      if (isStarted && changedContent && !window.confirm('更换后所有参与者将看到新版本，旧版本会保留在活动快照历史中。确定继续吗？')) {
        return
      }
    } else {
      // 创建模式验证
      if (new Date(startTime) <= new Date()) { toast.error('开始时间不能早于当前时间'); return }

      const unresolvedRows = problemRows.filter(r => r.problemCode.trim() && (!r.resolved || !r.resolved.found))
      if (unresolvedRows.length > 0) {
        toast.error(`有 ${unresolvedRows.length} 道题目未找到，请检查题号`)
        return
      }

      const resolvedRows = problemRows.filter(r => r.resolved?.found)
      if (resolvedRows.length === 0 && problemRows.some(r => r.problemCode.trim())) {
        toast.error('题目未能解析，请稍候重试')
        return
      }
    }

    setSaving(true)
    let createdTrainingId: string | null = null
    try {
      if (isEdit && trainingId) {
        // === 编辑模式 ===
        // 1. Update training info
        const updateRes = await apiClient.put(`/api/trainings/${trainingId}`, {
          title, description, format,
          problemIdVisible, solutionVisible, includeAdminInRanking,
          ...(startTime !== originalStartTimeStr && {
            startTime: new Date(startTime).toISOString(),
          }),
          endTime: new Date(endTime).toISOString(),
        })
        if (!updateRes.success) {
          toast.error(updateRes.message || '更新失败')
          return
        }

        if (mode === 'contest' && !ratingLocked) {
          const ratingRes = await apiClient.put(`/api/trainings/${trainingId}/rating-config`, {
            scope: ratingScope,
            weight: Number(ratingWeight),
            organizationMinParticipants: Number(organizationRatingMinimum),
            globalMinParticipants: Number(globalRatingMinimum),
            expectedRevision: ratingRevision,
          })
          if (!ratingRes.success) throw new Error(ratingRes.message || '保存 Rating 配置失败')
        }

        // 2. Remove deleted existing problems
        const existingIds = problemRows.filter(r => r.existing).map(r => r.trainingProblemId)
        const originalProblemsRes = await apiClient.get<ExistingTrainingProblem[]>(`/api/trainings/${trainingId}/problems`)
        if (originalProblemsRes.success && originalProblemsRes.data) {
          for (const orig of originalProblemsRes.data) {
            if (!existingIds.includes(orig.id)) {
              await apiClient.delete(`/api/trainings/${trainingId}/problems/${orig.id}`)
            }
          }
        }

        // 3. Update existing problems (alias, points and immutable content snapshots)
        for (const row of problemRows.filter(r => r.existing)) {
          await apiClient.put(`/api/trainings/${trainingId}/problems/${row.trainingProblemId}`, {
            alias: row.alias,
            points: (format === 'ioi' || format === 'oi') ? row.points : null,
          })
          const selectionChanged =
            row.statementOptionKey !== row.originalStatementOptionKey ||
            row.solutionOptionKey !== row.originalSolutionOptionKey
          if (selectionChanged && row.statementOptionKey && row.solutionOptionKey) {
            const selectionRes = await apiClient.put(
              `/api/trainings/${trainingId}/problems/${row.trainingProblemId}/content-selection`,
              {
                statementOptionKey: row.statementOptionKey,
                solutionOptionKey: row.solutionOptionKey,
              },
            )
            if (!selectionRes.success) throw new Error(selectionRes.message || '保存题面和题解版本失败')
          }
        }

        // 4. Add new problems
        const newRows = problemRows.filter(r => !r.existing && r.resolved?.found)
        const newTrainingProblemIds: string[] = []
        for (const row of newRows) {
          const createRes = await apiClient.post<IdResponse>(`/api/trainings/${trainingId}/problems`, {
            problemId: row.resolved!.problemId,
            alias: row.alias,
            points: (format === 'ioi' || format === 'oi') ? row.points : null,
            statementOptionKey: row.statementOptionKey,
            solutionOptionKey: row.solutionOptionKey || 'none',
          })
          if (createRes.success && createRes.data) {
            newTrainingProblemIds.push(String(createRes.data.id))
          }
        }

        // 5. Reorder
        const existingIdsInOrder = problemRows.filter(r => r.existing).map(r => r.trainingProblemId!)
        const allIdsInOrder = [...existingIdsInOrder, ...newTrainingProblemIds]
        const orders = allIdsInOrder.map((id, i) => ({ id, orderIndex: i }))
        if (orders.length > 0) {
          await apiClient.put(`/api/trainings/${trainingId}/problems/reorder`, { orders })
        }

        toast.success(`${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}更新成功`)
      } else {
        const createUrl = organizationId
          ? '/api/organizations/' + organizationId + '/members/activities/contests'
          : teamId
            ? '/api/teams/' + teamId + '/trainings'
            : '/api/platform-contests'
        const res = await apiClient.post<IdResponse>(createUrl, {
          title, description, format, type: mode,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          problemIdVisible, solutionVisible, includeAdminInRanking,
        })
        if (!res.success || !res.data) {
          toast.error(res.message || '创建失败')
          return
        }

        const newTrainingId = res.data.id
        createdTrainingId = String(newTrainingId)

        if (mode === 'contest') {
          const currentConfig = await apiClient.get(`/api/trainings/${newTrainingId}/rating-config`)
          if (!currentConfig.success || !currentConfig.data) {
            throw new Error(currentConfig.message || '比赛已创建，但无法读取 Rating 配置')
          }
          const ratingRes = await apiClient.put(`/api/trainings/${newTrainingId}/rating-config`, {
            scope: ratingScope,
            weight: Number(ratingWeight),
            organizationMinParticipants: Number(organizationRatingMinimum),
            globalMinParticipants: Number(globalRatingMinimum),
            expectedRevision: Number((currentConfig.data as { revision?: number }).revision ?? 0),
          })
          if (!ratingRes.success) throw new Error(ratingRes.message || '比赛已创建，但 Rating 配置保存失败，请立即进入编辑页面确认')
        }

        const resolvedRows = problemRows.filter(r => r.resolved?.found)
        for (const row of resolvedRows) {
          await apiClient.post(`/api/trainings/${newTrainingId}/problems`, {
            problemId: row.resolved!.problemId,
            alias: row.alias,
            points: (format === 'ioi' || format === 'oi') ? row.points : null,
            statementOptionKey: row.statementOptionKey,
            solutionOptionKey: row.solutionOptionKey || 'none',
          })
        }

        // 创建后也 reorder（确保顺序正确）
        if (resolvedRows.length > 0) {
          // 获取刚创建的题目以拿到 ID
          const problemsRes = await apiClient.get<ExistingTrainingProblem[]>(`/api/trainings/${newTrainingId}/problems`)
          if (problemsRes.success && problemsRes.data) {
            const createdProblems = problemsRes.data
            const orders = createdProblems.map((p, i) => ({ id: p.id, orderIndex: i }))
            if (orders.length > 0) {
              await apiClient.put(`/api/trainings/${newTrainingId}/problems/reorder`, { orders })
            }
          }
        }

        toast.success(mode === 'contest' ? '比赛创建成功' : schoolId ? '作业创建成功' : '训练创建成功')
      }

      onClose()
      onSaved?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : isEdit ? '更新失败' : '创建失败'
      if (!isEdit && createdTrainingId) {
        setRecoveryTrainingId(createdTrainingId)
        setRecoveryMessage(message)
        setWizardStep(4)
        toast.error('比赛草稿已经创建，但后续配置未完成，请进入草稿继续处理')
      } else {
        toast.error(message)
      }
    } finally {
      setSaving(false)
    }
  }

  const contestWizard = mode === 'contest'
  const wizardSteps = ['基本信息', '赛制与 Rating', '题目', '可见性', '发布前检查']
  const ratingConfigurationValid = ratingScope === 'NONE' || (
    Number.isFinite(Number(ratingWeight))
    && Number(ratingWeight) >= 0.1
    && Number(ratingWeight) <= 1
    && Number(organizationRatingMinimum) >= 2
    && Number(globalRatingMinimum) >= 2
    && allowedRatingScopes.includes(ratingScope)
  )
  const canAdvance = wizardStep === 0
    ? Boolean(title.trim() && startTime && endTime && new Date(endTime) > new Date(startTime))
    : wizardStep === 1
      ? Boolean(format && ratingConfigurationValid)
      : wizardStep === 2
      ? problemRows.length > 0 && problemRows.every(row => row.resolved?.found)
      : true
  const contestValidationIssues = contestWizard ? [
    !title.trim() ? '请填写比赛标题' : '',
    !startTime || !endTime ? '请填写完整的开始与结束时间' : new Date(endTime) <= new Date(startTime) ? '结束时间必须晚于开始时间' : '',
    problemRows.length === 0 ? '请至少添加一道题目' : problemRows.some(row => !row.resolved?.found) ? '仍有题目未能解析' : '',
    ratingScope !== 'NONE' && (!Number.isFinite(Number(ratingWeight)) || Number(ratingWeight) < 0.1 || Number(ratingWeight) > 1) ? 'Rating 影响强度必须在 10%～100% 之间' : '',
    ratingScope !== 'NONE' && (Number(organizationRatingMinimum) < 2 || Number(globalRatingMinimum) < 2) ? 'Rating 最低参赛人数不能小于 2' : '',
    !allowedRatingScopes.includes(ratingScope) ? '当前比赛范围不允许所选 Rating 类型' : '',
  ].filter(Boolean) : []

  return (
    <>
    <FormDialog
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `编辑${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}` : `创建${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}`}
      size="xl"
      footer={
        <div className={unifiedStyles.u1}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          {contestWizard && wizardStep > 0 && <Button variant="secondary" onClick={() => setWizardStep(step => step - 1)} disabled={saving || loading}>上一步</Button>}
          {contestWizard && wizardStep < wizardSteps.length - 1 ? <Button onClick={() => setWizardStep(step => step + 1)} disabled={saving || loading || !canAdvance}>下一步</Button> : <Button onClick={handleSave} disabled={saving || loading || Boolean(recoveryTrainingId) || (contestWizard && contestValidationIssues.length > 0)}>
            {saving ? (isEdit ? '保存中...' : '创建中...') : (isEdit ? '保存修改' : `创建${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}`)}
          </Button>}
        </div>
      }
    >
      <div className={unifiedStyles.u2}>
        {loading ? (
          <div className={unifiedStyles.u3}><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div>
        ) : (
          <>
            {contestWizard && <div className={unifiedStyles.wizardSteps} role="tablist" aria-label="比赛创建步骤">{wizardSteps.map((label, index) => <Button key={label} size="sm" variant={index === wizardStep ? 'primary' : index < wizardStep ? 'secondary' : 'ghost'} disabled={index > wizardStep + 1 || Boolean(recoveryTrainingId)} onClick={() => index <= wizardStep + 1 && setWizardStep(index)} aria-current={index === wizardStep ? 'step' : undefined}>{index + 1}. {label}</Button>)}</div>}
            {recoveryTrainingId && <section className={unifiedStyles.reviewCard} role="alert"><h3>比赛草稿已保留</h3><p>{recoveryMessage || '后续配置未完成。为避免重复创建，请进入已经生成的草稿继续处理。'}</p><Button onClick={() => { const href = organizationId ? `/org/${organizationId}/contests/${recoveryTrainingId}` : teamId ? `/personal/teams/${teamId}/contests/${recoveryTrainingId}` : `${user?.accountRole === 'super_admin' ? '/admin' : '/platform-admin'}/contests/${recoveryTrainingId}`; window.location.assign(href) }}>进入比赛草稿</Button></section>}
            {/* Basic Info */}
            {(!contestWizard || wizardStep === 0) && <div className={unifiedStyles.u4}>
              <label className={unifiedStyles.u5}>标题 *</label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={mode === 'contest' ? '比赛名称' : mode === 'homework' ? '作业名称' : '训练名称'} />
            </div>}

            {mode === 'contest' && wizardStep === 1 && (
              <div className={unifiedStyles.u6}>
                <div>
                  <label className={unifiedStyles.u5}>赛制</label>
                  <Select aria-label="比赛赛制" value={format} disabled={ratingLocked} onChange={e => setFormat(e.target.value as 'oi' | 'ioi' | 'icpc')}>
                    <option value="ioi">IOI（即时反馈 + 部分分）</option>
                    <option value="icpc">ICPC（即时反馈 + AC / 罚时）</option>
                    <option value="oi">OI（赛中不反馈，赛后统一公布）</option>
                  </Select>
                </div>
                <div>
                  <label className={unifiedStyles.u5}>Rating 范围</label>
                  <Select aria-label="Rating 范围" value={ratingScope} disabled={ratingLocked} onChange={event => setRatingScope(event.target.value as typeof ratingScope)}>
                    {allowedRatingScopes.includes('NONE') && <option value="NONE">不计 Rating</option>}
                    {allowedRatingScopes.includes('ORGANIZATION') && <option value="ORGANIZATION">本校 Rating</option>}
                    {allowedRatingScopes.includes('GLOBAL') && <option value="GLOBAL">全局 Rating</option>}
                    {allowedRatingScopes.includes('BOTH') && <option value="BOTH">全局 + 本校</option>}
                  </Select>
                  <small>{ratingLocked
                    ? '比赛已经开始，Rating 规则已永久冻结。'
                    : `${teamId && format === 'icpc' ? '团队 ACM 赛暂不计个人 Rating。' : organizationId ? '学校比赛只影响本校 Rating。' : teamId ? '个人团队赛暂不计个人 Rating。' : ''} Rating 类型会自动跟随赛制：${format === 'icpc' ? 'ACM' : format.toUpperCase()}`}</small>
                </div>
                {ratingScope !== 'NONE' && <div>
                  <label className={unifiedStyles.u5}>Rating 权重</label>
                  <Input aria-label="Rating 权重" type="number" min="0.1" max="1" step="0.1" value={ratingWeight} disabled={ratingLocked} onChange={event => setRatingWeight(event.target.value)} />
                  <small>影响强度：标准比赛的 {Math.round((Number(ratingWeight) || 0) * 100)}%</small>
                </div>}
                {ratingScope !== 'NONE' && <div>
                  <label className={unifiedStyles.u5}>本校 / 全局最低人数</label>
                  <div className={unifiedStyles.u1}>
                    <Input aria-label="本校 Rating 最低人数" type="number" min="2" value={organizationRatingMinimum} disabled={ratingLocked} onChange={event => setOrganizationRatingMinimum(event.target.value)} />
                    <Input aria-label="全局 Rating 最低人数" type="number" min="2" value={globalRatingMinimum} disabled={ratingLocked} onChange={event => setGlobalRatingMinimum(event.target.value)} />
                  </div>
                </div>}
              </div>
            )}

            {(!contestWizard || wizardStep === 0) && <div className={unifiedStyles.u4}>
              <label className={unifiedStyles.u5}>公告</label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={mode === 'contest' ? '比赛说明（可选）' : mode === 'homework' ? '作业说明（可选）' : '训练说明（可选）'} rows={2} className={unifiedStyles.descriptionInput} />
            </div>}

            {(!contestWizard || wizardStep === 0) && <div className={unifiedStyles.u6}>
              {!contestWizard && <div>
                <label className={unifiedStyles.u5}>赛制</label>
                <Select aria-label="选择" value={format} onChange={e => setFormat(e.target.value as 'oi' | 'ioi' | 'icpc')}>
                  <option value="ioi">IOI（即时反馈+部分分）</option>
                  <option value="icpc">ICPC（即时反馈+AC/罚时）</option>
                  <option value="oi">OI（赛中不反馈，赛后统一公布）</option>
                </Select>
              </div>}
              {(!contestWizard || wizardStep === 0) && <div>
                <label className={unifiedStyles.u5}>开始时间 *</label>
                <Input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </div>}
              {(!contestWizard || wizardStep === 0) && <div>
                <label className={unifiedStyles.u5}>结束时间 *</label>
                <Input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </div>}
            </div>}

            {/* 可见性设置 */}
            {(!contestWizard || wizardStep === 3) && <div className={unifiedStyles.u6}>
              <div>
                <label className={unifiedStyles.u5}>题目来源显示</label>
                <Select aria-label="选择" value={problemIdVisible ? 'always' : 'after'} onChange={e => setProblemIdVisible(e.target.value === 'always')}>
                  <option value="after">赛后显示</option>
                  <option value="always">始终显示</option>
                </Select>
              </div>
              <div>
                <label className={unifiedStyles.u5}>题解显示</label>
                <Select aria-label="选择" value={solutionVisible ? 'always' : 'after'} onChange={e => setSolutionVisible(e.target.value === 'always')}>
                  <option value="after">赛后显示</option>
                  <option value="always">始终显示</option>
                </Select>
              </div>
              <div>
                <label className={unifiedStyles.u5}>管理员排名</label>
                <label className={unifiedStyles.u7}>
                  <Input type="checkbox" checked={includeAdminInRanking} onChange={e => setIncludeAdminInRanking(e.target.checked)} className={unifiedStyles.u8} />
                  <span className={unifiedStyles.u9}>包含管理员</span>
                </label>
              </div>
            </div>}

            {/* Problems */}
            {(!contestWizard || wizardStep === 2) && <div className={unifiedStyles.u10}>
              <div className={unifiedStyles.sectionHeading}><h3 className={unifiedStyles.u11}>{mode === 'contest' ? '比赛题目' : '题目列表'}</h3><div className={unifiedStyles.headingActions}>{contestWizard && <Button onClick={() => setProblemPickerOpen(true)}>选择题目</Button>}<Button variant="secondary" onClick={addProblemRow}>{contestWizard ? '按 OJ 题号快速添加' : '添加一道题目'}</Button></div></div>

              {problemRows.length > 0 && (
                <><div className={unifiedStyles.selectedProblems} aria-label="已选比赛题目">{problemRows.map((row, index) => <div key={row.id} className={unifiedStyles.selectedProblemCard}><strong>{row.alias || String.fromCharCode(65 + index)}</strong><span>{row.resolved?.title || row.problemCode || '等待识别题目'}</span></div>)}</div><div className={unifiedStyles.u12}>
                  <TableRoot className={unifiedStyles.u13}>
                    <TableHead>
                      <TableRow className={unifiedStyles.u14}>
                        <TableHeaderCell className={unifiedStyles.u15}>排序</TableHeaderCell>
                        <TableHeaderCell className={unifiedStyles.u16}>#</TableHeaderCell>
                        <TableHeaderCell className={unifiedStyles.u17}>OJ</TableHeaderCell>
                        <TableHeaderCell className={unifiedStyles.u18}>题号</TableHeaderCell>
                        <TableHeaderCell className={unifiedStyles.u19}>题目</TableHeaderCell>
                        <TableHeaderCell className={unifiedStyles.u20}>别名</TableHeaderCell>
                        {(format === 'ioi' || format === 'oi') && <TableHeaderCell className={unifiedStyles.u21}>分值</TableHeaderCell>}
                        <TableHeaderCell className={unifiedStyles.u22}></TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {problemRows.map((row, idx) => (
                        <TableRow key={row.id} className={`${unifiedStyles.problemRow} ${row.existing ? unifiedStyles.existingProblem : unifiedStyles.newProblem}`}>
                          <TableCell className={unifiedStyles.u23}>
                            <Button variant="secondary" size="sm"
                              onClick={() => moveUp(idx)}
                              disabled={idx === 0}
                              className={unifiedStyles.moveButtonFirst}
                              title="上移"
                            >↑</Button>
                            <Button variant="secondary" size="sm"
                              onClick={() => moveDown(idx)}
                              disabled={idx === problemRows.length - 1}
                              className={unifiedStyles.moveButton}
                              title="下移"
                            >↓</Button>
                          </TableCell>
                          <TableCell className={unifiedStyles.u24}>{idx + 1}</TableCell>
                          <TableCell className={unifiedStyles.u25}>
                            <Select aria-label="选择" value={row.ojName}
                              onChange={e => {
                                updateRow(row.id, { ojName: e.target.value, resolved: row.existing ? row.resolved : null })
                                if (!row.existing) handleResolve({ ...row, ojName: e.target.value, resolved: null })
                              }}
                              className={unifiedStyles.u26}
                            >
                              {OJ_PLATFORMS_NO_ALL.map(oj => <option key={oj.value} value={oj.value}>{oj.label}</option>)}
                            </Select>
                          </TableCell>
                          <TableCell className={unifiedStyles.u25}>
                            <Input type="text" value={row.problemCode}
                              onChange={e => {
                                updateRow(row.id, { problemCode: e.target.value, resolved: row.existing ? row.resolved : null })
                                if (!row.existing) handleResolve({ ...row, problemCode: e.target.value })
                              }}
                              placeholder="输入题号"
                              disabled={row.existing}
                              className={unifiedStyles.problemIdInput}
                            />
                          </TableCell>
                          <TableCell className={unifiedStyles.u27}>
                            {row.existing ? (
                              <span><span className={unifiedStyles.u28}>✓</span><span className={unifiedStyles.u29}>{row.resolved?.title || '-'}</span></span>
                            ) : row.resolving
                              ? <span className={unifiedStyles.u30}>检索中...</span>
                              : row.resolved
                                ? row.resolved.found
                                  ? <span><span className={unifiedStyles.u28}>✓</span><span className={unifiedStyles.u31}>{row.resolved.title}</span></span>
                                  : <span><span className={unifiedStyles.u32}>⚠</span><span className={unifiedStyles.u33}>题目不存在</span></span>
                                : <span className={unifiedStyles.u30}>-</span>
                            }
                          </TableCell>
                          <TableCell className={unifiedStyles.u34}>
                            <Input
                              value={row.alias}
                              onChange={e => updateRow(row.id, { alias: e.target.value })}
                              className={unifiedStyles.u35}
                            />
                          </TableCell>
                          {(format === 'ioi' || format === 'oi') && (
                            <TableCell className={unifiedStyles.u34}>
                              <Input
                                type="number"
                                value={row.points}
                                onChange={e => updateRow(row.id, { points: parseInt(e.target.value) || 0 })}
                                className={unifiedStyles.u36}
                              />
                            </TableCell>
                          )}
                          <TableCell className={unifiedStyles.u34}>
                            <Button variant="ghost" onClick={() => removeRow(row.id)} className={unifiedStyles.u37} title="移除">✕</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </TableRoot>
                </div></>
              )}

              {problemRows.length === 0 && (
                <div className={unifiedStyles.u39}>
                  {contestWizard ? '还没有选择比赛题目，请从题库选择，或按 OJ 题号快速添加。' : '还没有添加题目。'}
                </div>
              )}
            </div>}
            {contestWizard && wizardStep === 4 && <section className={unifiedStyles.reviewCard}><h3>发布前检查</h3>{contestValidationIssues.length > 0 ? <ul className={unifiedStyles.reviewIssues}>{contestValidationIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>比赛信息完整。确认后将创建比赛；开始前仍可编辑未冻结字段。</p>}<dl><div><dt>比赛</dt><dd>{title || '未填写名称'}</dd></div><div><dt>时间</dt><dd>{startTime} 至 {endTime}</dd></div><div><dt>赛制</dt><dd>{format.toUpperCase()}</dd></div><div><dt>Rating</dt><dd>{ratingScope === 'NONE' ? '不计 Rating' : `${ratingScope === 'BOTH' ? '全局 + 本校' : ratingScope === 'GLOBAL' ? '全局' : '本校'} · 标准比赛的 ${Math.round((Number(ratingWeight) || 0) * 100)}%`}</dd></div><div><dt>题目</dt><dd>{problemRows.length} 道，创建时固定各题当前评测数据版本</dd></div><div><dt>原题来源</dt><dd>{problemIdVisible ? '比赛期间显示' : '比赛结束后显示'}</dd></div><div><dt>题解</dt><dd>{solutionVisible ? '比赛期间显示' : '比赛结束后显示'}</dd></div></dl></section>}
          </>
        )}
      </div>
    </FormDialog>
    <DetailDialog isOpen={problemPickerOpen} onClose={() => setProblemPickerOpen(false)} title="选择比赛题目" size="lg">
      <div className={unifiedStyles.picker}>
        <Tabs
          label="题库来源"
          value={problemSource}
          onChange={value => setProblemSource(value)}
          items={[
            ...(organizationId ? [{ value: 'school' as const, label: '校内题库' }] : []),
            { value: 'carits' as const, label: 'Carits 平台题库' },
            { value: 'external' as const, label: '其他题库' },
          ]}
        />
        <Input aria-label="搜索题目" value={problemQuery} onChange={event => setProblemQuery(event.target.value)} placeholder="搜索题号或标题" />
        {problemPoolLoading ? <p>正在加载题目…</p> : problemPoolError ? <p role="alert" className={unifiedStyles.pickerError}>{problemPoolError}</p> : problemPool.length === 0 ? <p>当前范围没有找到题目。</p> : <div className={unifiedStyles.pickerList}>{problemPool.map(problem => {
          const selected = problemRows.some(row => row.resolved?.problemId === problem.id)
          return <div key={problem.id} className={unifiedStyles.pickerItem}><div><strong>{problem.problemId} · {problem.title}</strong><small>{problem.platform}{problem.difficulty ? ` · ${problem.difficulty}` : ''}</small></div><Button size="sm" variant={selected ? 'secondary' : 'primary'} disabled={selected} onClick={() => void addPickedProblem(problem)}>{selected ? '已选择' : '加入比赛'}</Button></div>
        })}</div>}
      </div>
    </DetailDialog>
    </>
  )
}
