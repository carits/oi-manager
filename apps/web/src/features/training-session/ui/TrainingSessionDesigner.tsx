'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Send, Trash2 } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { Empty } from '@/components/ui/Empty'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { useUnsavedChanges } from '@/components/navigation/UnsavedChangesProvider'
import { useToast } from '@/components/ui/Toast'
import { ProblemListEditor, type SelectedProblemReference } from '@/features/problem-selection'
import { deleteTrainingNextStage, getTrainingDesign, publishTraining, putTrainingNextStage, saveTrainingDesign, validateTrainingDesign } from '../api/trainingSessionApi'
import type { Assignment, Design, Stage } from '../model/trainingDesign'
import { createTrainingDesignDraft, newTrainingDesignKey } from '../model/trainingDesign'
import styles from './TrainingEngine.module.css'

type StagePurpose = 'PRACTICE' | 'GUIDED' | 'TEACHING' | 'REVIEW'
type GroupMode = 'all' | 'current_groups'
const purposeOptions: Array<{ value: StagePurpose; label: string; description: string }> = [
  { value: 'PRACTICE', label: '自主练习', description: '学生独立完成题目，可以提交评测。' },
  { value: 'GUIDED', label: '引导练习', description: '教师引导推进，学生仍可提交评测。' },
  { value: 'TEACHING', label: '统一讲解', description: '用于课堂讲解，默认不开放提交，也可以不选题。' },
  { value: 'REVIEW', label: '复盘总结', description: '用于回顾本阶段，默认不开放提交，也可以不选题。' },
]
const purposeFromStage = (stage?: Stage | null): StagePurpose => stage?.kind === 'TEACHING' ? 'TEACHING' : stage?.kind === 'REVIEW' ? 'REVIEW' : stage?.mode === 'GUIDED' ? 'GUIDED' : 'PRACTICE'
const purposeDefaults = (purpose: StagePurpose) => ({
  kind: purpose === 'TEACHING' ? 'TEACHING' as const : purpose === 'REVIEW' ? 'REVIEW' as const : 'TRAINING' as const,
  mode: purpose === 'GUIDED' || purpose === 'TEACHING' ? 'GUIDED' as const : purpose === 'REVIEW' ? 'REVIEW' as const : 'PRACTICE' as const,
  submissionMode: purpose === 'PRACTICE' || purpose === 'GUIDED' ? 'ENABLED' as const : 'DISABLED' as const,
})
const emptyStage = (): Stage => ({
  clientKey: newTrainingDesignKey(), name: '下一阶段', description: '', kind: 'TRAINING', lifecycle: 'PENDING',
  mode: 'PRACTICE', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', endPolicy: 'MANUAL',
  plannedDurationSeconds: null, minDurationSeconds: null, completionThreshold: null, completionPolicy: null,
  rules: { groupMode: 'all' }, Problems: [],
})
const toAssignment = (reference: SelectedProblemReference, existing?: Assignment): Assignment => ({
  clientKey: existing?.clientKey || newTrainingDesignKey(), id: existing?.id, assignmentId: existing?.assignmentId,
  problemId: reference.problem.id, alias: reference.alias || null, required: existing?.required !== false,
  allowedSubtaskIds: existing?.allowedSubtaskIds || [], unlockPolicy: existing?.unlockPolicy || null,
  targetScore: existing?.targetScore ?? null, scoreGoals: existing?.scoreGoals || null,
  timePolicy: existing?.timePolicy || null, stuckPolicy: existing?.stuckPolicy || null,
  strategyIntervalSeconds: existing?.strategyIntervalSeconds ?? null, Problem: reference.problem,
  currentData: existing?.currentData || null, subtasks: existing?.subtasks || [],
})
const stageInput = (stage: Stage, purpose: StagePurpose, groupMode: GroupMode) => ({
  id: stage.id, clientKey: stage.clientKey, name: stage.name.trim(), description: stage.description?.trim() || null,
  ...purposeDefaults(purpose), accessPolicy: stage.accessPolicy || 'ALL_AT_ONCE' as const, accessScope: 'CURRENT_STAGE' as const,
  endPolicy: stage.endPolicy || 'MANUAL' as const, plannedDurationSeconds: stage.plannedDurationSeconds ?? null,
  minDurationSeconds: stage.minDurationSeconds ?? null, completionThreshold: stage.completionThreshold ?? null,
  completionPolicy: stage.completionPolicy || undefined, rules: { ...(stage.rules || {}), groupMode },
  problems: stage.Problems.map(problem => ({
    assignmentId: problem.assignmentId, clientKey: problem.clientKey, problemId: problem.problemId,
    alias: problem.alias || null, unlockPolicy: problem.unlockPolicy || undefined, targetScore: problem.targetScore ?? null,
    scoreGoals: problem.scoreGoals, timePolicy: problem.timePolicy || undefined, stuckPolicy: problem.stuckPolicy || undefined,
    allowedSubtaskIds: problem.allowedSubtaskIds, strategyIntervalSeconds: problem.strategyIntervalSeconds ?? null,
    required: problem.required !== false,
  })),
})

export function TrainingSessionDesigner({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const toast = useToast()
  const [design, setDesign] = useState<Design | null>(null)
  const [stage, setStage] = useState<Stage | null>(null)
  const [purpose, setPurpose] = useState<StagePurpose>('PRACTICE')
  const [groupMode, setGroupMode] = useState<GroupMode>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [problemEditorBlocked, setProblemEditorBlocked] = useState(false)
  const [dirty, setDirty] = useState(false)
  const { requestNavigation } = useUnsavedChanges(`training-stage-design:${sessionId}`, dirty || saving, `${dirty}:${saving}`)
  const runtimePath = pathname.replace(/\/design$/, '')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = createTrainingDesignDraft(await getTrainingDesign(sessionId))
      const pending = loaded.stages.filter(item => item.lifecycle === 'PENDING')
      const editable = pending[0] || (!['ENDED', 'ARCHIVED'].includes(loaded.session.status) ? emptyStage() : null)
      setDesign(loaded)
      setStage(editable)
      setPurpose(purposeFromStage(editable))
      setGroupMode(editable?.rules?.groupMode === 'current_groups' ? 'current_groups' : 'all')
      setDirty(false)
    } catch {
      toast.error('训练阶段加载失败')
    } finally {
      setLoading(false)
    }
  }, [sessionId, toast])
  useEffect(() => { void load() }, [load])

  const updateStage = (updater: (current: Stage) => Stage) => {
    setStage(current => current ? updater(current) : current)
    setDirty(true)
  }
  const replaceProblems = (references: SelectedProblemReference[]) => {
    updateStage(current => {
      const byId = new Map(current.Problems.map(problem => [problem.problemId, problem]))
      return { ...current, Problems: references.map(reference => toAssignment(reference, byId.get(reference.problem.id))) }
    })
    return { acceptedIds: references.map(reference => reference.problem.id) }
  }
  const setRequired = (problemId: string, required: boolean) => updateStage(current => ({
    ...current, Problems: current.Problems.map(problem => problem.problemId === problemId ? { ...problem, required } : problem),
  }))
  const allTrainingProblems = useMemo(() => {
    const seen = new Map<string, Assignment>()
    for (const item of design?.stages || []) for (const problem of item.Problems) if (!seen.has(problem.problemId)) seen.set(problem.problemId, problem)
    return [...seen.values()]
  }, [design?.stages])
  const currentStageProblems = useMemo(() => design?.stages.find(item => item.lifecycle === 'RUNNING')?.Problems || [], [design?.stages])
  const pendingCount = design?.stages.filter(item => item.lifecycle === 'PENDING').length || 0
  const legacyStageQueue = pendingCount > 1
  const isInitialStage = design ? ['DRAFT', 'SCHEDULED'].includes(design.session.status) : false
  const requiresProblems = purpose === 'PRACTICE' || purpose === 'GUIDED'
  const canSave = Boolean(stage?.name.trim() && !problemEditorBlocked && (!requiresProblems || stage.Problems.length > 0) && !legacyStageQueue)

  const reuseProblems = (problems: Assignment[]) => {
    if (!problems.length) return toast.error('本次训练还没有可沿用的题目')
    updateStage(current => ({ ...current, Problems: problems.map(problem => ({
      ...problem, id: undefined, assignmentId: undefined, clientKey: newTrainingDesignKey(),
    })) }))
  }
  const save = async () => {
    if (!design || !stage || !canSave) return false
    setSaving(true)
    const input = stageInput(stage, purpose, groupMode)
    const structure = {
      expectedRevision: design.statusRevision, title: design.session.title, description: design.session.description || null,
      groups: design.groups.map(group => ({ id: group.id, clientKey: group.clientKey, name: group.name, participantIds: group.participantIds })),
      stages: [input],
    }
    if (isInitialStage) {
      const validation = await validateTrainingDesign(sessionId, structure)
      if (!validation.ok || !validation.data.valid) {
        setSaving(false)
        toast.error(validation.ok ? validation.data.issues.find(issue => issue.severity === 'error')?.message || '当前阶段设置需要调整' : validation.error.userMessage)
        return false
      }
    }
    const response = isInitialStage
      ? await saveTrainingDesign(sessionId, structure)
      : await putTrainingNextStage(sessionId, { expectedRevision: design.statusRevision, purpose, stage: input })
    setSaving(false)
    if (!response.ok) { toast.error(response.error.userMessage || '阶段保存失败'); return false }
    toast.success(isInitialStage ? '第一个阶段已保存' : '下一阶段已准备')
    await load()
    return true
  }
  const publish = async () => {
    if (!(await save())) return
    setPublishing(true)
    const latest = createTrainingDesignDraft(await getTrainingDesign(sessionId))
    const response = await publishTraining(sessionId, { expectedRevision: latest.statusRevision })
    setPublishing(false)
    if (!response.ok) return toast.error(response.error.userMessage || '发布失败')
    toast.success('训练已发布，后续阶段可在课堂中根据反馈准备')
    requestNavigation(runtimePath)
  }
  const discard = async () => {
    if (!design || !stage?.id || isInitialStage) return
    setSaving(true)
    const response = await deleteTrainingNextStage(sessionId, { expectedRevision: design.statusRevision })
    setSaving(false)
    if (!response.ok) return toast.error(response.error.userMessage || '无法删除下一阶段')
    toast.success('已丢弃准备中的下一阶段')
    await load()
  }

  if (loading) return <PageLoadingFrame title="正在打开课堂设置" rows={5} />
  if (!design) return <PageFrame><Empty title="无法打开课堂设置" action={<Button onClick={() => router.back()}>返回</Button>} /></PageFrame>
  if (['ENDED', 'ARCHIVED'].includes(design.session.status)) return <PageFrame><Empty title="训练已经结束" description="历史阶段与课堂记录保持只读。" action={<Button onClick={() => requestNavigation(runtimePath)}>返回训练工作台</Button>} /></PageFrame>

  return <PageFrame width="workbench"><div className={styles.stack}>
    <PageHeader
      title={isInitialStage ? '设置第一个阶段' : '准备下一阶段'}
      description={isInitialStage ? '先安排本次课堂的起点；后续阶段在课堂运行中根据反馈逐步准备。' : '只准备紧接当前课堂的一个阶段，不提前铺设整条流程。'}
      breadcrumbs={[{ label: '训练', href: runtimePath.replace(/\/[^/]+$/, '') }, { label: design.session.title }, { label: isInitialStage ? '课堂设置' : '下一阶段' }]}
      actions={<>
        <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => requestNavigation(runtimePath)}>返回运行工作台</Button>
        {!isInitialStage && stage?.id && <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => void discard()} disabled={saving}>丢弃下一阶段</Button>}
        <Button variant="secondary" onClick={() => void save()} loading={saving} disabled={!dirty || !canSave}>保存阶段</Button>
        {isInitialStage && design.session.status === 'DRAFT' && <Button icon={<Send size={16} />} onClick={() => void publish()} loading={publishing} disabled={!canSave || saving}>发布训练</Button>}
      </>}
    />
    {legacyStageQueue && <section className={styles.message} role="status"><strong>旧版多阶段训练</strong><p>该训练仍保留多个已准备阶段，将继续按原顺序运行；在待运行阶段收敛为一个之前，不能新增或替换未来阶段。</p></section>}
    {!legacyStageQueue && stage && <div className={styles.trainingSetupLayout}>
      <div className={styles.trainingSetupMain}>
        <section className={styles.setupSection}>
          <div><h3>阶段用途</h3><p>用途决定默认的课堂方式和是否允许学生提交。</p></div>
          <div className={styles.stack}>
            <label className={styles.field}>用途<Select value={purpose} onChange={event => {
              const next = event.target.value as StagePurpose
              setPurpose(next)
              updateStage(current => ({ ...current, ...purposeDefaults(next) }))
            }}>{purposeOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>
            <p className={styles.muted}>{purposeOptions.find(item => item.value === purpose)?.description}</p>
            <label className={styles.field}>阶段名称<Input value={stage.name} maxLength={200} onChange={event => updateStage(current => ({ ...current, name: event.target.value }))} /></label>
            <label className={styles.field}>阶段说明（可选）<Textarea rows={3} value={stage.description || ''} onChange={event => updateStage(current => ({ ...current, description: event.target.value }))} /></label>
          </div>
        </section>
        <section className={styles.setupSection}>
          <div><h3>适用范围</h3><p>可以面向全班，也可以沿用当前课堂分组。</p></div>
          <label className={styles.field}>阶段对象<Select value={groupMode} onChange={event => { setGroupMode(event.target.value as GroupMode); setDirty(true) }}><option value="all">全班统一安排</option><option value="current_groups">沿用当前分组</option></Select></label>
        </section>
        <section className={styles.setupSection}>
          <div><h3>阶段题目</h3><p>{requiresProblems ? '练习阶段至少需要一道题。' : '讲解或复盘阶段可以不选择题目。'}</p></div>
          <div className={styles.stack}>
            {!isInitialStage && <div className={styles.actions}>
              <Button variant="outline" onClick={() => reuseProblems(currentStageProblems)} disabled={!currentStageProblems.length}>沿用当前题目</Button>
              <Button variant="outline" onClick={() => reuseProblems(allTrainingProblems)} disabled={!allTrainingProblems.length}>从本次训练已有题目选择</Button>
            </div>}
            <ProblemListEditor
              references={stage.Problems.map(problem => ({ problem: problem.Problem, alias: problem.alias || undefined }))}
              onReplace={replaceProblems}
              aliasLabel="别名"
              dataRequirement="training"
              onBlockingChange={setProblemEditorBlocked}
              renderTrailing={reference => {
                const problem = stage.Problems.find(item => item.problemId === reference.problem.id)
                return problem ? <Checkbox label={problem.required === false ? '选做' : '必做'} checked={problem.required !== false} onChange={event => setRequired(problem.problemId, event.target.checked)} /> : null
              }}
            />
          </div>
        </section>
      </div>
      <aside className={styles.trainingSetupSummary} aria-label="当前阶段设置">
        <div><strong>{isInitialStage ? '第一个阶段' : '下一阶段'}</strong><p>课堂每次只准备紧接着的一步。</p></div>
        <dl>
          <div><dt>用途</dt><dd>{purposeOptions.find(item => item.value === purpose)?.label}</dd></div>
          <div><dt>对象</dt><dd>{groupMode === 'all' ? '全班' : '当前分组'}</dd></div>
          <div><dt>题目</dt><dd>{stage.Problems.length ? stage.Problems.length + ' 道' : '无题目'}</dd></div>
          <div><dt>提交</dt><dd>{purposeDefaults(purpose).submissionMode === 'ENABLED' ? '允许' : '不开放'}</dd></div>
        </dl>
        <div className={styles.message}><strong>运行一段，再决定下一段</strong><p>阶段结束时可以继续当前阶段、使用或修改已准备阶段、临时准备新阶段，或结束训练。</p></div>
      </aside>
    </div>}
  </div></PageFrame>
}
