'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Send, Trash2 } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
  { value: 'PRACTICE', label: '继续做题', description: '学生独立完成题目，可以提交评测。' },
  { value: 'GUIDED', label: '教师带着练', description: '教师引导推进，学生仍可提交评测。' },
  { value: 'TEACHING', label: '统一讲解', description: '用于课堂讲解，默认不开放提交，也可以不选题。' },
  { value: 'REVIEW', label: '复盘总结', description: '用于回顾本轮训练，默认不开放提交，也可以不选题。' },
]
const purposeFromStage = (stage?: Stage | null): StagePurpose => stage?.kind === 'TEACHING' ? 'TEACHING' : stage?.kind === 'REVIEW' ? 'REVIEW' : stage?.mode === 'GUIDED' ? 'GUIDED' : 'PRACTICE'
const purposeDefaults = (purpose: StagePurpose) => ({
  kind: purpose === 'TEACHING' ? 'TEACHING' as const : purpose === 'REVIEW' ? 'REVIEW' as const : 'TRAINING' as const,
  mode: purpose === 'GUIDED' || purpose === 'TEACHING' ? 'GUIDED' as const : purpose === 'REVIEW' ? 'REVIEW' as const : 'PRACTICE' as const,
  submissionMode: purpose === 'PRACTICE' || purpose === 'GUIDED' ? 'ENABLED' as const : 'DISABLED' as const,
})
const emptyStage = (): Stage => ({
  clientKey: newTrainingDesignKey(), name: '下一步安排', description: '', kind: 'TRAINING', lifecycle: 'PENDING',
  mode: 'PRACTICE', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', endPolicy: 'MANUAL',
  plannedDurationSeconds: 45 * 60, minDurationSeconds: null, completionThreshold: null, completionPolicy: null,
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
  const searchParams = useSearchParams()
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
      const requested = searchParams.get('action') === 'teaching' ? 'TEACHING' : searchParams.get('action') === 'review' ? 'REVIEW' : searchParams.get('action') === 'guided' ? 'GUIDED' : searchParams.get('action') === 'practice' ? 'PRACTICE' : null
      const base = pending[0] || (!['ENDED', 'ARCHIVED'].includes(loaded.session.status) ? emptyStage() : null)
      const editable = base && requested && !pending[0] ? { ...base, ...purposeDefaults(requested), name: purposeOptions.find(item => item.value === requested)?.label || base.name } : base
      setDesign(loaded)
      setStage(editable)
      setPurpose(requested && !pending[0] ? requested : purposeFromStage(editable))
      setGroupMode(editable?.rules?.groupMode === 'current_groups' ? 'current_groups' : 'all')
      setDirty(false)
    } catch {
      toast.error('课堂安排加载失败')
    } finally {
      setLoading(false)
    }
  }, [searchParams, sessionId, toast])
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
        toast.error(validation.ok ? validation.data.issues.find(issue => issue.severity === 'error')?.message || '当前安排需要调整' : validation.error.userMessage)
        return false
      }
    }
    const response = isInitialStage
      ? await saveTrainingDesign(sessionId, structure)
      : await putTrainingNextStage(sessionId, { expectedRevision: design.statusRevision, purpose, stage: input })
    setSaving(false)
    if (!response.ok) { toast.error(response.error.userMessage || '安排保存失败'); return false }
    toast.success(isInitialStage ? '第一个安排已保存' : '下一步已准备')
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
    toast.success('训练已开始，后续安排可根据课堂反馈准备')
    requestNavigation(runtimePath)
  }
  const discard = async () => {
    if (!design || !stage?.id || isInitialStage) return
    setSaving(true)
    const response = await deleteTrainingNextStage(sessionId, { expectedRevision: design.statusRevision })
    setSaving(false)
    if (!response.ok) return toast.error(response.error.userMessage || '无法删除已准备安排')
    toast.success('已丢弃准备中的安排')
    await load()
  }

  if (loading) return <PageLoadingFrame title="正在打开课堂安排" rows={5} />
  if (!design) return <PageFrame><Empty title="无法打开课堂安排" action={<Button onClick={() => router.back()}>返回</Button>} /></PageFrame>
  if (['ENDED', 'ARCHIVED'].includes(design.session.status)) return <PageFrame><Empty title="训练已经结束" description="历史课堂记录保持只读。" action={<Button onClick={() => requestNavigation(runtimePath)}>返回训练工作台</Button>} /></PageFrame>

  return <PageFrame width="workbench"><div className={styles.stack}>
    <PageHeader
      title={isInitialStage ? '完善第一个安排' : '准备下一步'}
      description={isInitialStage ? '确认开始时练什么、谁来练和大概练多久。' : '只准备紧接当前课堂的一步，后面的安排等看到学生反馈再决定。'}
      breadcrumbs={[{ label: '训练', href: runtimePath.replace(/\/[^/]+$/, '') }, { label: design.session.title }, { label: isInitialStage ? '第一个安排' : '下一步' }]}
      actions={<>
        <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => requestNavigation(runtimePath)}>返回课堂</Button>
        {!isInitialStage && stage?.id && <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => void discard()} disabled={saving}>丢弃已准备安排</Button>}
        <Button variant="secondary" onClick={() => void save()} loading={saving} disabled={!dirty || !canSave}>保存安排</Button>
        {isInitialStage && design.session.status === 'DRAFT' && <Button icon={<Send size={16} />} onClick={() => void publish()} loading={publishing} disabled={!canSave || saving}>开始训练</Button>}
      </>}
    />
    {legacyStageQueue && <section className={styles.message} role="status"><strong>旧版预设安排</strong><p>该训练仍保留多个旧安排，将按原顺序运行；收敛为一个之前不能继续新增。</p></section>}
    {!legacyStageQueue && stage && <div className={styles.trainingSetupLayout}>
      <div className={styles.trainingSetupMain}>
        <section className={styles.setupSection}>
          <div><h3>接下来做什么</h3><p>选择符合课堂语境的动作，系统会自动使用合适规则。</p></div>
          <div className={styles.stack}>
            <label className={styles.field}>课堂动作<Select value={purpose} onChange={event => {
              const next = event.target.value as StagePurpose
              setPurpose(next)
              updateStage(current => ({ ...current, ...purposeDefaults(next), name: purposeOptions.find(item => item.value === next)?.label || current.name }))
            }}>{purposeOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>
            <p className={styles.muted}>{purposeOptions.find(item => item.value === purpose)?.description}</p>
            <label className={styles.field}>预计用时（分钟）<Input type="number" min={5} max={1440} value={Math.max(5, Math.round((stage.plannedDurationSeconds || 45 * 60) / 60))} onChange={event => updateStage(current => ({ ...current, plannedDurationSeconds: Math.max(5, Math.min(1440, Number(event.target.value) || 45)) * 60 }))} /></label>
            <details className={styles.controlDisclosure}><summary>补充说明</summary><label className={styles.field}>给教师的安排说明（可选）<Textarea rows={3} value={stage.description || ''} onChange={event => updateStage(current => ({ ...current, description: event.target.value }))} /></label></details>
          </div>
        </section>
        <section className={styles.setupSection}>
          <div><h3>谁来练</h3><p>默认全班统一安排，需要时可沿用当前分组。</p></div>
          <div className={styles.stack}>
            <label className={styles.field}>参与范围<Select value={groupMode} onChange={event => { setGroupMode(event.target.value as GroupMode); setDirty(true) }}><option value="all">全班统一安排</option><option value="current_groups">按当前分组安排</option></Select></label>
            {groupMode === 'current_groups' && <div className={styles.tableWrap}><table><thead><tr><th>训练组</th><th>本次内容</th></tr></thead><tbody>{design.groups.map(group => <tr key={group.id || group.clientKey}><td>{group.name}</td><td>{stage.Problems.length ? stage.Problems.map(problem => problem.alias || problem.Problem.problemId).join('、') : purposeOptions.find(item => item.value === purpose)?.label}</td></tr>)}</tbody></table></div>}
          </div>
        </section>
        <section className={styles.setupSection}>
          <div><h3>练哪些题</h3><p>{requiresProblems ? '至少选择一道题，默认只需标记必做或选做。' : '讲解或复盘可以不选择题目。'}</p></div>
          <div className={styles.stack}>
            {!isInitialStage && <div className={styles.actions}>
              <Button variant="outline" onClick={() => reuseProblems(currentStageProblems)} disabled={!currentStageProblems.length}>沿用当前题目</Button>
              <Button variant="outline" onClick={() => reuseProblems(allTrainingProblems)} disabled={!allTrainingProblems.length}>沿用本次训练题目</Button>
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
      <aside className={styles.trainingSetupSummary} aria-label="安排摘要">
        <div><strong>{isInitialStage ? '第一个安排' : '已准备的下一步'}</strong><p>这里只显示老师真正需要确认的信息。</p></div>
        <dl>
          <div><dt>动作</dt><dd>{purposeOptions.find(item => item.value === purpose)?.label}</dd></div>
          <div><dt>对象</dt><dd>{groupMode === 'all' ? '全班' : '当前分组'}</dd></div>
          <div><dt>题目</dt><dd>{stage.Problems.length ? stage.Problems.length + ' 道' : '无题目'}</dd></div>
          <div><dt>提交</dt><dd>{purposeDefaults(purpose).submissionMode === 'ENABLED' ? '允许' : '不开放'}</dd></div>
        </dl>
        <div className={styles.message}><strong>后面的安排以后再决定</strong><p>课堂运行中可以继续训练、调整题目、统一讲解、调整分组或结束。</p></div>
      </aside>
    </div>}
  </div></PageFrame>
}
