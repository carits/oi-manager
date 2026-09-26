'use client'

import { useState, useEffect } from 'react'
import collisionStyles from './ContestFormModal.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './ContestFormModal.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, FormDialog } from '@/components/ui/Dialogs'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/features/auth'
import { QuickProblemInput, type SelectedCanonicalProblem } from '@/features/problem-selection'

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

interface ProblemRow {
  id: string
  contestProblemId?: string
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
  mode?: 'contest' | 'contest' | 'homework'
}

let tempIdCounter = 0

export function ContestFormModal({ isOpen, onClose, teamId, schoolId, organizationId, contestId, onSaved, mode = 'contest' }: ContestFormModalProps) {
  const toast = useToast()
  const { user } = useAuth()
  const isEdit = !!contestId

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
  const [recoveryContestId, setRecoveryContestId] = useState<string | null>(null)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [originalStartTime, setOriginalStartTime] = useState<Date | null>(null)
  const [originalStartTimeStr, setOriginalStartTimeStr] = useState<string>('')

  // Problem management
  const [problemRows, setProblemRows] = useState<ProblemRow[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialSnapshot, setInitialSnapshot] = useState('')
  const [baselinePending, setBaselinePending] = useState(false)
  const [closeRequested, setCloseRequested] = useState(false)

  // Reset / load data when modal opens
  useEffect(() => {
    if (!isOpen) return
    setWizardStep(0)
    setInitialSnapshot('')
    setBaselinePending(true)
    setCloseRequested(false)
    setRecoveryContestId(null)
    setRecoveryMessage('')

    if (isEdit && contestId) {
      // 编辑模式：加载已有数据
      const loadContest = async () => {
        setLoading(true)
        try {
          const infoRes = await apiClient.get<ContestFormInfo>(`/api/contests/${contestId}`)
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
            const ratingRes = await apiClient.get<ContestRatingConfig>(`/api/contests/${contestId}/rating-config`)
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

          const problemsRes = await apiClient.get<ExistingContestProblem[]>(`/api/contests/${contestId}/problems`)
          if (problemsRes.success && problemsRes.data) {
            const rows: ProblemRow[] = await Promise.all(problemsRes.data.map(async (p) => {
              const optionsRes = await apiClient.get<{
                statement: ContentOption[]
                solution: ContentOption[]
                currentSelection: { statementOptionKey: string | null; solutionOptionKey: string | null }
              }>(`/api/contests/${contestId}/problems/${p.id}/content-options`)
              const options = optionsRes.success ? optionsRes.data : null
              return {
                id: `existing-${p.id}`,
                contestProblemId: p.id,
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
      loadContest()
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
  }, [isOpen, contestId])

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

  const formSnapshot = JSON.stringify({
    title,
    description,
    format,
    startTime,
    endTime,
    problemIdVisible,
    solutionVisible,
    includeAdminInRanking,
    ratingScope,
    ratingWeight,
    organizationRatingMinimum,
    globalRatingMinimum,
    problems: problemRows.map(row => ({
      id: row.contestProblemId || row.resolved?.problemId || row.id,
      alias: row.alias,
      points: row.points,
      statementOptionKey: row.statementOptionKey || null,
      solutionOptionKey: row.solutionOptionKey || null,
    })),
  })
  useEffect(() => {
    if (!isOpen || loading || !baselinePending) return
    setInitialSnapshot(formSnapshot)
    setBaselinePending(false)
  }, [baselinePending, formSnapshot, isOpen, loading])
  const formDirty = !baselinePending && Boolean(initialSnapshot) && formSnapshot !== initialSnapshot
  const requestClose = () => {
    if (saving || loading) return
    if (formDirty) setCloseRequested(true)
    else onClose()
  }

  const updateRow = (rowId: string, updates: Partial<ProblemRow>) => {
    setProblemRows(prev => prev.map(r => r.id === rowId ? { ...r, ...updates } : r))
  }

  const addSelectedProblems = async (problems: SelectedCanonicalProblem[]) => {
    for (const problem of problems) {
      if (problemRows.some(row => row.resolved?.problemId === problem.id)) continue
      const id = `selected-${++tempIdCounter}`
      setProblemRows(current => [...current, {
        id, ojName: problem.platform, problemCode: problem.problemCode, alias: '', points: 100,
        resolving: false, resolved: { found: true, problemId: problem.id, title: problem.title, created: false },
        contentOptionsLoading: true, statementOptions: [], solutionOptions: [],
      }])
      const options = await apiClient.get<{ statement: ContentOption[]; solution: ContentOption[] }>(`/api/problems/${problem.id}/content-options`)
      updateRow(id, {
        contentOptionsLoading: false,
        statementOptions: options.success ? options.data?.statement || [] : [],
        solutionOptions: options.success ? options.data?.solution || [] : [],
        statementOptionKey: options.success ? options.data?.statement?.[0]?.key : undefined,
        solutionOptionKey: options.success ? options.data?.solution?.find(option => option.key !== 'none')?.key || 'none' : 'none',
      })
    }
  }

  const removeRow = (rowId: string) => {
    setProblemRows(prev => prev.filter(r => r.id !== rowId))
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
    let createdContestId: string | null = null
    try {
      if (isEdit && contestId) {
        // === 编辑模式 ===
        // 1. Update contest info
        const updateRes = await apiClient.put(`/api/contests/${contestId}`, {
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
          const ratingRes = await apiClient.put(`/api/contests/${contestId}/rating-config`, {
            scope: ratingScope,
            weight: Number(ratingWeight),
            organizationMinParticipants: Number(organizationRatingMinimum),
            globalMinParticipants: Number(globalRatingMinimum),
            expectedRevision: ratingRevision,
          })
          if (!ratingRes.success) throw new Error(ratingRes.message || '保存 Rating 配置失败')
        }

        // 2. Remove deleted existing problems
        const existingIds = problemRows.filter(r => r.existing).map(r => r.contestProblemId)
        const originalProblemsRes = await apiClient.get<ExistingContestProblem[]>(`/api/contests/${contestId}/problems`)
        if (originalProblemsRes.success && originalProblemsRes.data) {
          for (const orig of originalProblemsRes.data) {
            if (!existingIds.includes(orig.id)) {
              await apiClient.delete(`/api/contests/${contestId}/problems/${orig.id}`)
            }
          }
        }

        // 3. Update existing problems (alias, points and immutable content snapshots)
        for (const row of problemRows.filter(r => r.existing)) {
          await apiClient.put(`/api/contests/${contestId}/problems/${row.contestProblemId}`, {
            alias: row.alias,
            points: (format === 'ioi' || format === 'oi') ? row.points : null,
          })
          const selectionChanged =
            row.statementOptionKey !== row.originalStatementOptionKey ||
            row.solutionOptionKey !== row.originalSolutionOptionKey
          if (selectionChanged && row.statementOptionKey && row.solutionOptionKey) {
            const selectionRes = await apiClient.put(
              `/api/contests/${contestId}/problems/${row.contestProblemId}/content-selection`,
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
        const newContestProblemIds: string[] = []
        for (const row of newRows) {
          const createRes = await apiClient.post<IdResponse>(`/api/contests/${contestId}/problems`, {
            problemId: row.resolved!.problemId,
            alias: row.alias,
            points: (format === 'ioi' || format === 'oi') ? row.points : null,
            statementOptionKey: row.statementOptionKey,
            solutionOptionKey: row.solutionOptionKey || 'none',
          })
          if (createRes.success && createRes.data) {
            newContestProblemIds.push(String(createRes.data.id))
          }
        }

        // 5. Reorder
        const existingIdsInOrder = problemRows.filter(r => r.existing).map(r => r.contestProblemId!)
        const allIdsInOrder = [...existingIdsInOrder, ...newContestProblemIds]
        const orders = allIdsInOrder.map((id, i) => ({ id, orderIndex: i }))
        if (orders.length > 0) {
          await apiClient.put(`/api/contests/${contestId}/problems/reorder`, { orders })
        }

        toast.success(`${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}更新成功`)
      } else {
        const createUrl = organizationId
          ? '/api/organizations/' + organizationId + '/members/activities/contests'
          : teamId
            ? '/api/teams/' + teamId + '/contests'
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

        const newContestId = res.data.id
        createdContestId = String(newContestId)

        if (mode === 'contest') {
          const currentConfig = await apiClient.get(`/api/contests/${newContestId}/rating-config`)
          if (!currentConfig.success || !currentConfig.data) {
            throw new Error(currentConfig.message || '比赛已创建，但无法读取 Rating 配置')
          }
          const ratingRes = await apiClient.put(`/api/contests/${newContestId}/rating-config`, {
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
          await apiClient.post(`/api/contests/${newContestId}/problems`, {
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
          const problemsRes = await apiClient.get<ExistingContestProblem[]>(`/api/contests/${newContestId}/problems`)
          if (problemsRes.success && problemsRes.data) {
            const createdProblems = problemsRes.data
            const orders = createdProblems.map((p, i) => ({ id: p.id, orderIndex: i }))
            if (orders.length > 0) {
              await apiClient.put(`/api/contests/${newContestId}/problems/reorder`, { orders })
            }
          }
        }

        toast.success(mode === 'contest' ? '比赛创建成功' : schoolId ? '作业创建成功' : '训练创建成功')
      }

      onClose()
      onSaved?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : isEdit ? '更新失败' : '创建失败'
      if (!isEdit && createdContestId) {
        setRecoveryContestId(createdContestId)
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
  const editContestStarted = Boolean(isEdit && originalStartTime && new Date() >= originalStartTime)
  const stepIssues = (step: number) => {
    if (step === 0) return [
      !title.trim() ? '请填写比赛标题' : '',
      !startTime || !endTime ? '请填写完整的开始与结束时间' : '',
      startTime && endTime && new Date(endTime) <= new Date(startTime) ? '结束时间必须晚于开始时间' : '',
      !isEdit && startTime && new Date(startTime) <= new Date() ? '开始时间必须晚于当前时间' : '',
      editContestStarted && startTime !== originalStartTimeStr ? '比赛已经开始，不能修改开始时间' : '',
      isEdit && !editContestStarted && startTime !== originalStartTimeStr && new Date(startTime) <= new Date() ? '修改后的开始时间必须晚于当前时间' : '',
      isEdit && endTime && new Date(endTime) <= new Date() ? '结束时间必须晚于当前时间' : '',
    ].filter(Boolean)
    if (step === 1) return [
      !format ? '请选择赛制' : '',
      !ratingConfigurationValid ? '请修正 Rating 范围、影响强度或最低参赛人数' : '',
    ].filter(Boolean)
    if (step === 2) return [
      problemRows.length === 0 ? '请至少添加一道题目' : '',
      problemRows.some(row => !row.resolved?.found) ? '仍有题目未能解析' : '',
    ].filter(Boolean)
    return []
  }
  const canReachStep = (target: number) => target <= 0 || Array.from({ length: target }, (_, index) => stepIssues(index).length === 0).every(Boolean)
  const currentStepIssues = contestWizard ? stepIssues(wizardStep) : []
  const contestValidationIssues = contestWizard
    ? [0, 1, 2, 3].flatMap(step => stepIssues(step))
    : []

  return (
    <>
    <FormDialog
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `编辑${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}` : `创建${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}`}
      size="xl"
      dirty={formDirty}
      loading={saving || loading}
      footer={
        <div className={unifiedStyles.u1}>
          <Button variant="secondary" onClick={requestClose} disabled={saving || loading}>取消</Button>
          {contestWizard && wizardStep > 0 && <Button variant="secondary" onClick={() => setWizardStep(step => step - 1)} disabled={saving || loading}>上一步</Button>}
          {contestWizard && wizardStep < wizardSteps.length - 1 ? <Button onClick={() => setWizardStep(step => step + 1)} disabled={saving || loading || !canReachStep(wizardStep + 1)}>下一步</Button> : <Button onClick={handleSave} disabled={saving || loading || Boolean(recoveryContestId) || (contestWizard && contestValidationIssues.length > 0)}>
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
            {contestWizard && <div className={unifiedStyles.wizardSteps} role="tablist" aria-label="比赛创建步骤">{wizardSteps.map((label, index) => <Button key={label} size="sm" variant={index === wizardStep ? 'primary' : index < wizardStep ? 'secondary' : 'ghost'} disabled={!canReachStep(index) || Boolean(recoveryContestId) || saving || loading} onClick={() => setWizardStep(index)} aria-current={index === wizardStep ? 'step' : undefined}>{index + 1}. {label}</Button>)}</div>}
            {contestWizard && currentStepIssues.length > 0 && <section className={unifiedStyles.reviewCard} role="alert"><strong>完成本步骤后可继续</strong><ul className={unifiedStyles.reviewIssues}>{currentStepIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></section>}
            {recoveryContestId && <section className={unifiedStyles.reviewCard} role="alert"><h3>比赛草稿已保留</h3><p>{recoveryMessage || '后续配置未完成。为避免重复创建，请进入已经生成的草稿继续处理。'}</p><Button onClick={() => { const href = organizationId ? `/org/${organizationId}/contests/${recoveryContestId}` : teamId ? `/personal/teams/${teamId}/contests/${recoveryContestId}` : `${user?.accountRole === 'super_admin' ? '/admin' : '/platform-admin'}/contests/${recoveryContestId}`; window.location.assign(href) }}>进入比赛草稿</Button></section>}
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
              <div className={unifiedStyles.sectionHeading}><h3 className={unifiedStyles.u11}>{mode === 'contest' ? '比赛题目' : '题目列表'}</h3></div>
              <QuickProblemInput existingProblemIds={problemRows.flatMap(row => row.resolved?.problemId ? [row.resolved.problemId] : [])} onResolved={addSelectedProblems} />

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
                          <TableCell className={unifiedStyles.u25}>{row.ojName}</TableCell>
                          <TableCell className={unifiedStyles.u25}>
                            {row.problemCode}
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
                  还没有添加题目，请选择平台并输入题号。
                </div>
              )}
            </div>}
            {contestWizard && wizardStep === 4 && <section className={unifiedStyles.reviewCard}><h3>发布前检查</h3>{contestValidationIssues.length > 0 ? <ul className={unifiedStyles.reviewIssues}>{contestValidationIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>比赛信息完整。确认后将创建比赛；开始前仍可编辑未冻结字段。</p>}<dl><div><dt>比赛</dt><dd>{title || '未填写名称'}</dd></div><div><dt>时间</dt><dd>{startTime} 至 {endTime}</dd></div><div><dt>赛制</dt><dd>{format.toUpperCase()}</dd></div><div><dt>Rating</dt><dd>{ratingScope === 'NONE' ? '不计 Rating' : `${ratingScope === 'BOTH' ? '全局 + 本校' : ratingScope === 'GLOBAL' ? '全局' : '本校'} · 标准比赛的 ${Math.round((Number(ratingWeight) || 0) * 100)}%`}</dd></div><div><dt>题目</dt><dd>{problemRows.length} 道，创建时固定各题当前评测数据版本</dd></div><div><dt>原题来源</dt><dd>{problemIdVisible ? '比赛期间显示' : '比赛结束后显示'}</dd></div><div><dt>题解</dt><dd>{solutionVisible ? '比赛期间显示' : '比赛结束后显示'}</dd></div></dl></section>}
          </>
        )}
      </div>
    </FormDialog>
    <ConfirmDialog isOpen={closeRequested} onClose={() => setCloseRequested(false)} onConfirm={() => { setCloseRequested(false); onClose() }} title="放弃未保存的比赛配置？" message="关闭后，本次比赛配置修改将不会保存。" confirmText="放弃修改" danger />
    </>
  )
}
