'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Plus, Send, Trash2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import apiClient from '@/lib/apiClient'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, DetailDialog, FormDialog } from '@/components/ui/Dialogs'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormField } from '@/components/ui/FormField'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { SubmissionCodeEditor, clearSubmissionDraft } from '@/components/submission/SubmissionCodeEditor'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import styles from './Assignment.module.css'
import { type Assignment, type AssignmentProblem, assignmentStatusMeta, formatAssignmentTime } from './types'

interface ProblemListItem { id: string; platform: string; problemId: string; title: string; difficulty?: string | null }
interface ProblemListResponse { data: ProblemListItem[]; total: number }
interface RevisionSummary { id: string; revisionNumber: number; mode: 'acm' | 'oi'; judgeConfigHash: string }
interface RevisionList { latestTestSetRevisionId: string | null; revisions: RevisionSummary[] }
interface StudentItem { userId: string | null; name: string; user?: { username: string } | null }
interface StudentList { items: StudentItem[] }
interface ValidationResult { valid: boolean; issues: Array<{ path: string; code: string; message: string }> }
interface ProgressItem { id?: string | null; assignmentProblemId: string; learningStatus: string; timelinessStatus: string; correctionStatus: string; attemptCount?: number; bestScore?: number | null; bestVerdict?: string | null; finalScore?: number | null; firstSubmissionId?: number | null; bestSubmissionId?: number | null; latestSubmissionId?: number | null; firstSubmittedAt?: string | null; lastSubmittedAt?: string | null; manualCompletionVersion?: number; manualCompletedAt?: string | null; manualCompletionReason?: string | null; manualCompletedBy?: { id: string; username: string } | null; states?: string[] }
interface ProgressRecipient { id: string; user: { id: string; username: string }; score: number; rawScore: number; adjustment: number; completedProblems: number; lateProblems: number; correctionProblems: number; progress: ProgressItem[]; cells?: ProgressItem[] }
interface ProgressPayload { recipients: ProgressRecipient[]; problems: AssignmentProblem[]; statusCounts?: Record<string, number>; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }
interface AssignmentCorrectionItem { id: string; assignmentProblemId: string; status: string; reason?: string | null; requiredScore?: number | null; dueAt?: string | null; createdAt: string }
interface AssignmentFeedbackItem { id: string; assignmentProblemId?: string | null; content: string; createdAt: string }
interface AssignmentGradeSnapshotItem { id: string; type: string; revision: number; totalScore: number; maxScore: number; createdAt: string }
interface AssignmentWorkspacePayload {
  canManage: boolean
  assignment: Assignment
  progress: ProgressItem[]
  managerProgress: ProgressPayload | null
  corrections: AssignmentCorrectionItem[]
  feedback: AssignmentFeedbackItem[]
  gradeSnapshots: AssignmentGradeSnapshotItem[]
}

const toLocalInput = (value?: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ''

function DraftEditor({ assignment, onChange }: { assignment: Assignment; onChange: (value: Assignment) => void }) {
  const { organizationId } = useParams<{ organizationId: string }>()
  const { sessionKey } = useAuth()
  const toast = useToast()
  const [saving, setSaving] = useState<string | null>(null)
  const [title, setTitle] = useState(assignment.title)
  const [description, setDescription] = useState(assignment.description || '')
  const [learningObjectives, setLearningObjectives] = useState(assignment.learningObjectives || '')
  const [publishAt, setPublishAt] = useState(toLocalInput(assignment.publishAt))
  const [openAt, setOpenAt] = useState(toLocalInput(assignment.openAt))
  const [dueAt, setDueAt] = useState(toLocalInput(assignment.dueAt))
  const [closeAt, setCloseAt] = useState(toLocalInput(assignment.closeAt))
  const [correctionDueAt, setCorrectionDueAt] = useState(toLocalInput(assignment.correctionDueAt))
  const [rosterMode, setRosterMode] = useState(assignment.rosterMode)
  const [gradingPolicy, setGradingPolicy] = useState(assignment.gradingPolicy)
  const [baseScoreMax, setBaseScoreMax] = useState(assignment.baseScoreMax)
  const [optionalScoringPolicy, setOptionalScoringPolicy] = useState(assignment.optionalScoringPolicy)
  const [optionalBestCount, setOptionalBestCount] = useState(assignment.optionalBestCount ?? 1)
  const [optionalBonusMax, setOptionalBonusMax] = useState(assignment.optionalBonusMax)
  const [challengeScoringPolicy, setChallengeScoringPolicy] = useState(assignment.challengeScoringPolicy)
  const [challengeBonusMax, setChallengeBonusMax] = useState(assignment.challengeBonusMax)
  const [latePolicy, setLatePolicy] = useState(assignment.latePolicy)
  const [latePenaltyPercent, setLatePenaltyPercent] = useState(assignment.latePenaltyPercent ?? 0)
  const [correctionPolicy, setCorrectionPolicy] = useState(assignment.correctionPolicy)
  const [solutionReleasePolicy, setSolutionReleasePolicy] = useState(assignment.solutionReleasePolicy)
  const [problemDraft, setProblemDraft] = useState(assignment.Problems)
  const [rosterDraft, setRosterDraft] = useState(() => new Set(assignment.Recipients.map(item => item.userId)))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [library, setLibrary] = useState<'school' | 'platform'>('school')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [designStep, setDesignStep] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    setProblemDraft(assignment.Problems)
    setRosterDraft(new Set(assignment.Recipients.map(item => item.userId)))
  // Reset local drafts only when navigating to another assignment. Step saves
  // update the corresponding draft explicitly so unrelated saves cannot erase it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.id])

  const problemResource = useResource<ProblemListResponse>(pickerOpen ? `/api/problems?library=${library}&${library === 'platform' ? 'sourceGroup=carits&' : ''}pageSize=100` : null, { sessionKey, isEmpty: data => data.data.length === 0 })
  const studentResource = useResource<StudentList>(`/api/organizations/${organizationId}/members/students?pageSize=100`, { sessionKey, isEmpty: data => data.items.length === 0 })

  const mutate = async (endpoint: string, method: 'PATCH' | 'PUT' | 'POST', body: unknown, key: string) => {
    setSaving(key)
    try {
      const result = await apiClient.mutate<Assignment>(endpoint, method, body)
      if (!result.ok) { toast.error(result.error.message); return null }
      setValidation(null)
      onChange(result.data)
      toast.success('当前步骤已自动保存')
      return result.data
    } finally {
      setSaving(null)
    }
  }

  const basicPayload = () => ({
    expectedRevision: assignment.statusRevision, title, description, learningObjectives, publishAt: publishAt || null, openAt, dueAt, closeAt,
    correctionDueAt: correctionDueAt || null, rosterMode, gradingPolicy, latePolicy,
    baseScoreMax, optionalScoringPolicy, optionalBestCount: optionalScoringPolicy === 'BEST_N' ? optionalBestCount : null,
    optionalBonusMax: optionalScoringPolicy === 'NONE' ? 0 : optionalBonusMax,
    challengeScoringPolicy, challengeBonusMax: challengeScoringPolicy === 'NONE' ? 0 : challengeBonusMax,
    latePenaltyPercent: latePolicy === 'ALLOW_WITH_PENALTY' ? latePenaltyPercent : null,
    correctionPolicy, solutionReleasePolicy,
  })
  const problemRows = (items: AssignmentProblem[]) => items.map(item => ({ id: item.id, problemId: item.problemId, testSetRevisionId: item.testSetRevisionId, category: item.category, required: item.required, maxScore: item.maxScore, targetScore: item.targetScore, weight: item.weight, completionPolicy: item.completionPolicy }))
  const saveBasics = () => mutate(`/api/assignments/${assignment.id}`, 'PATCH', basicPayload(), 'basic')
  const saveProblems = async () => {
    const saved = await mutate(`/api/assignments/${assignment.id}/problems`, 'PUT', { expectedRevision: assignment.statusRevision, problems: problemRows(problemDraft) }, 'problems')
    if (saved) setProblemDraft(saved.Problems)
    return saved
  }
  const saveRoster = async () => {
    const saved = await mutate(`/api/assignments/${assignment.id}/roster`, 'PUT', { expectedRevision: assignment.statusRevision, userIds: [...rosterDraft] }, 'roster')
    if (saved) setRosterDraft(new Set(saved.Recipients.map(item => item.userId)))
    return saved
  }

  const basicsDirty = title !== assignment.title
    || description !== (assignment.description || '')
    || learningObjectives !== (assignment.learningObjectives || '')
    || publishAt !== toLocalInput(assignment.publishAt)
    || openAt !== toLocalInput(assignment.openAt)
    || dueAt !== toLocalInput(assignment.dueAt)
    || closeAt !== toLocalInput(assignment.closeAt)
    || correctionDueAt !== toLocalInput(assignment.correctionDueAt)
    || rosterMode !== assignment.rosterMode
    || gradingPolicy !== assignment.gradingPolicy
    || baseScoreMax !== assignment.baseScoreMax
    || optionalScoringPolicy !== assignment.optionalScoringPolicy
    || (optionalScoringPolicy === 'BEST_N' ? optionalBestCount : null) !== (assignment.optionalBestCount ?? null)
    || (optionalScoringPolicy === 'NONE' ? 0 : optionalBonusMax) !== assignment.optionalBonusMax
    || challengeScoringPolicy !== assignment.challengeScoringPolicy
    || (challengeScoringPolicy === 'NONE' ? 0 : challengeBonusMax) !== assignment.challengeBonusMax
    || latePolicy !== assignment.latePolicy
    || (latePolicy === 'ALLOW_WITH_PENALTY' ? latePenaltyPercent : null) !== (assignment.latePenaltyPercent ?? null)
    || correctionPolicy !== assignment.correctionPolicy
    || solutionReleasePolicy !== assignment.solutionReleasePolicy
  const problemsDirty = JSON.stringify(problemRows(problemDraft)) !== JSON.stringify(problemRows(assignment.Problems))
  const savedRoster = new Set(assignment.Recipients.map(item => item.userId))
  const rosterDirty = rosterMode === 'SNAPSHOT' && (rosterDraft.size !== savedRoster.size || [...rosterDraft].some(userId => !savedRoster.has(userId)))
  const hasUnsavedChanges = basicsDirty || problemsDirty || rosterDirty

  const validateStep = (step: number) => {
    if (step === 0) {
      if (!title.trim()) return '请填写作业名称'
      if (!openAt || !dueAt || !closeAt) return '请填写开放、截止和关闭时间'
      if (new Date(dueAt) < new Date(openAt)) return '截止时间不能早于开放时间'
      if (new Date(closeAt) < new Date(dueAt)) return '关闭时间不能早于截止时间'
      if (publishAt && new Date(publishAt) > new Date(openAt)) return '发布时间不能晚于开放时间'
    }
    if (step === 1) {
      if (!problemDraft.length) return '请至少选择一道题目'
      if (problemDraft.some(problem => problem.maxScore <= 0 || problem.targetScore < 0 || problem.targetScore > problem.maxScore || problem.weight <= 0)) return '请修正题目的满分、达标分和权重'
    }
    if (step === 2 && rosterMode === 'SNAPSHOT' && rosterDraft.size === 0) return '请至少选择一名学生'
    return null
  }

  const saveCurrentStep = async () => {
    if (designStep === 0) return basicsDirty ? saveBasics() : assignment
    if (designStep === 1) return problemsDirty ? saveProblems() : assignment
    if (designStep === 2 && rosterMode === 'SNAPSHOT') return rosterDirty ? saveRoster() : assignment
    return assignment
  }

  const changeStep = async (target: number) => {
    if (saving || target === designStep) return
    if (target < designStep) { setDesignStep(target); return }
    if (target !== designStep + 1) return
    const issue = validateStep(designStep)
    if (issue) return toast.warning(issue)
    const saved = await saveCurrentStep()
    if (saved) setDesignStep(target)
  }

  const addProblem = async (problem: ProblemListItem) => {
    if (problemDraft.some(item => item.problemId === problem.id)) return
    const result = await apiClient.get<RevisionList>(`/api/problems/${problem.id}/test-set-revisions`)
    if (!result.success || !result.data?.latestTestSetRevisionId) return toast.error(result.message || '该题没有可用的正式测试版本')
    const revision = result.data.revisions.find(item => item.id === result.data!.latestTestSetRevisionId)
    if (!revision) return toast.error('该题最新测试版本不可用')
    setProblemDraft(current => [...current, {
      id: `draft-${problem.id}`, problemId: problem.id, testSetRevisionId: revision.id, orderIndex: current.length,
      category: 'REQUIRED', required: true, maxScore: 100, judgeMaxScore: 100, targetScore: 100, weight: 100,
      completionPolicy: revision.mode === 'acm' ? 'AC' : 'TARGET_SCORE', Problem: { ...problem, allowedLanguages: null }, TestSetRevision: revision,
    }])
  }

  const move = (index: number, delta: number) => setProblemDraft(current => {
    const target = index + delta
    if (target < 0 || target >= current.length) return current
    const next = [...current]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next.map((item, orderIndex) => ({ ...item, orderIndex }))
  })

  const runValidation = async () => {
    if (hasUnsavedChanges) return toast.warning('有尚未保存的修改，请返回对应步骤并点击“下一步”完成自动保存。')
    setSaving('validate')
    const result = await apiClient.post<ValidationResult>(`/api/assignments/${assignment.id}/validate`)
    setSaving(null)
    if (!result.success || !result.data) return toast.error(result.message || '发布检查失败')
    setValidation(result.data)
    result.data.valid ? toast.success('发布检查通过') : toast.warning('请先修复发布检查中的问题')
  }

  const publish = async () => {
    if (hasUnsavedChanges) return toast.warning('有尚未保存的修改，不能发布。')
    if (!validation?.valid) return toast.warning('请先运行发布检查并修正所有问题。')
    setSaving('publish')
    const result = await apiClient.post<Assignment>(`/api/assignments/${assignment.id}/publish`, { expectedRevision: assignment.statusRevision })
    setSaving(null)
    setConfirmPublish(false)
    if (!result.success || !result.data) return toast.error(result.message || '发布失败')
    onChange(result.data)
    toast.success('作业已发布，题目版本和名单已冻结')
  }

  return <div className={styles.stack}>
    <p className={styles.draftNotice}>当前为草稿。点击“下一步”会先校验并自动保存当前步骤；题目 TestSet Revision 与学生名单将在发布后永久冻结。</p>
    <div className={styles.designSteps} role="tablist" aria-label="作业设计步骤">
      {['基本信息', '选择题目', '选择学生', '检查并发布'].map((label, index) => <Button key={label} size="sm" variant={designStep === index ? 'primary' : 'ghost'} disabled={Boolean(saving) || index > designStep + 1} onClick={() => void changeStep(index)} aria-current={designStep === index ? 'step' : undefined}>{index + 1}. {label}</Button>)}
    </div>
    {designStep === 0 && <>
    <Section title="基本信息" description={`配置版本 ${assignment.statusRevision}；进入下一步时自动保存`}>
      <div className={styles.settingsGrid}>
        <FormField label="作业名称" required><Input value={title} onChange={event => setTitle(event.target.value)} /></FormField>
        <FormField label="截止时间" required><Input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></FormField>
        <div className={styles.full}><FormField label="作业说明"><Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></FormField></div>
        <div className={styles.full}><Button variant="secondary" onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}>{advancedOpen ? '收起高级设置' : '展开高级设置'}</Button></div>
        {advancedOpen && <>
        <FormField label="发布时间" hint="留空表示发布后立即可见；不能晚于开放时间"><Input type="datetime-local" value={publishAt} onChange={event => setPublishAt(event.target.value)} /></FormField>
        <FormField label="开放时间" required><Input type="datetime-local" value={openAt} onChange={event => setOpenAt(event.target.value)} /></FormField>
        <FormField label="关闭时间" required><Input type="datetime-local" value={closeAt} onChange={event => setCloseAt(event.target.value)} /></FormField>
        <FormField label="订正截止时间" hint="留空表示不单独限制"><Input type="datetime-local" value={correctionDueAt} onChange={event => setCorrectionDueAt(event.target.value)} /></FormField>
        <FormField label="名单模式"><Select value={rosterMode} onChange={event => setRosterMode(event.target.value as Assignment['rosterMode'])}><option value="SNAPSHOT">手动名单快照</option><option value="DYNAMIC">发布时按学校/团队生成</option></Select></FormField>
        <FormField label="评分策略"><Select value={gradingPolicy} onChange={event => setGradingPolicy(event.target.value)}><option value="BEST_BEFORE_DUE">截止前最好成绩</option><option value="BEST">全部提交最好成绩</option><option value="LATEST">最后一次成绩</option><option value="FIRST_TARGET_MET">首次达标成绩</option></Select></FormField>
        <FormField label="基础成绩满分" hint="必做题按权重归一化到该分值"><Input type="number" min={1} max={1000} value={baseScoreMax} onChange={event => setBaseScoreMax(Number(event.target.value))} /></FormField>
        <FormField label="选做题计分"><Select value={optionalScoringPolicy} onChange={event => setOptionalScoringPolicy(event.target.value as Assignment['optionalScoringPolicy'])}><option value="NONE">不计入成绩</option><option value="BONUS">全部按权重计加分</option><option value="BEST_N">取完成度最高的 N 题</option></Select></FormField>
        {optionalScoringPolicy === 'BEST_N' && <FormField label="选做题计分数量" required><Input type="number" min={1} max={1000} value={optionalBestCount} onChange={event => setOptionalBestCount(Number(event.target.value))} /></FormField>}
        {optionalScoringPolicy !== 'NONE' && <FormField label="选做题加分上限" required><Input type="number" min={1} max={1000} value={optionalBonusMax} onChange={event => setOptionalBonusMax(Number(event.target.value))} /></FormField>}
        <FormField label="挑战题计分"><Select value={challengeScoringPolicy} onChange={event => setChallengeScoringPolicy(event.target.value as Assignment['challengeScoringPolicy'])}><option value="NONE">不计入成绩</option><option value="EXTRA_CREDIT">按权重计额外加分</option></Select></FormField>
        {challengeScoringPolicy === 'EXTRA_CREDIT' && <FormField label="挑战题加分上限" required><Input type="number" min={1} max={1000} value={challengeBonusMax} onChange={event => setChallengeBonusMax(Number(event.target.value))} /></FormField>}
        <FormField label="迟交策略"><Select value={latePolicy} onChange={event => setLatePolicy(event.target.value)}><option value="DISALLOW">不允许迟交</option><option value="ALLOW_MARK_LATE">允许并标记迟交</option><option value="ALLOW_NO_PENALTY">允许且不扣分</option><option value="ALLOW_WITH_PENALTY">允许并按比例扣分</option></Select></FormField>
        {latePolicy === 'ALLOW_WITH_PENALTY' && <FormField label="迟交扣分比例" required hint="0～100%"><Input type="number" min={0} max={100} value={latePenaltyPercent} onChange={event => setLatePenaltyPercent(Number(event.target.value))} /></FormField>}
        <FormField label="订正策略"><Select value={correctionPolicy} onChange={event => setCorrectionPolicy(event.target.value)}><option value="NONE">不自动要求订正</option><option value="BELOW_TARGET">未达目标分需订正</option><option value="NON_AC">未 AC 需订正</option><option value="TEACHER_ASSIGNED">仅教师指定</option></Select></FormField>
        <FormField label="题解开放"><Select value={solutionReleasePolicy} onChange={event => setSolutionReleasePolicy(event.target.value)}><option value="NEVER">不开放</option><option value="AFTER_DUE">截止后</option><option value="AFTER_CLOSE">关闭后</option><option value="AFTER_RELEASE">发布成绩后</option></Select></FormField>
        <div className={styles.full}><FormField label="学习目标"><Textarea rows={3} value={learningObjectives} onChange={event => setLearningObjectives(event.target.value)} /></FormField></div>
        </>}
      </div>
    </Section>
    </>}
    {designStep === 1 && <>
    <Section title="题目与固定版本" description="必做题构成基础成绩分母；选做与挑战题仅按上方启用的加分策略计算。Judge 原始分会按固定版本满分比例映射。" actions={<Button variant="secondary" icon={<Plus size={16} />} onClick={() => setPickerOpen(true)}>添加题目</Button>}>
      <div className={styles.stack}>{problemDraft.map((item, index) => <div className={styles.problemRow} key={item.id}>
        <span className={styles.problemIdentity}><strong>{index + 1}. {item.Problem.problemId} · {item.Problem.title}</strong><span>固定 R{item.TestSetRevision.revisionNumber} · {item.TestSetRevision.mode.toUpperCase()}</span></span>
        <div className={styles.problemControls}>
          <FormField label="类别"><Select aria-label={`${item.Problem.title} 类别`} value={item.category} onChange={event => setProblemDraft(current => current.map(row => row.id === item.id ? { ...row, category: event.target.value as AssignmentProblem['category'], required: event.target.value === 'REQUIRED' } : row))}><option value="REQUIRED">必做</option><option value="OPTIONAL">选做</option><option value="CHALLENGE">挑战</option></Select></FormField>
          <FormField label="作业满分" hint={`Judge 满分 ${item.judgeMaxScore || 100}`}><Input aria-label={`${item.Problem.title} 满分`} type="number" min={1} max={1000} value={item.maxScore} onChange={event => setProblemDraft(current => current.map(row => row.id === item.id ? { ...row, maxScore: Number(event.target.value), targetScore: Math.min(row.targetScore, Number(event.target.value)) } : row))} /></FormField>
          <FormField label="达标分"><Input aria-label={`${item.Problem.title} 目标分`} type="number" min={0} max={item.maxScore} value={item.targetScore} onChange={event => setProblemDraft(current => current.map(row => row.id === item.id ? { ...row, targetScore: Number(event.target.value) } : row))} /></FormField>
          <FormField label="权重"><Input aria-label={`${item.Problem.title} 权重`} type="number" min={1} max={10000} value={item.weight} onChange={event => setProblemDraft(current => current.map(row => row.id === item.id ? { ...row, weight: Number(event.target.value) } : row))} /></FormField>
          <FormField label="完成条件"><Select aria-label={`${item.Problem.title} 完成条件`} value={item.completionPolicy} onChange={event => setProblemDraft(current => current.map(row => row.id === item.id ? { ...row, completionPolicy: event.target.value as AssignmentProblem['completionPolicy'] } : row))}><option value="AC">必须 AC</option><option value="TARGET_SCORE">达到目标分</option><option value="ATTEMPT">有提交即可</option><option value="MANUAL">教师确认</option></Select></FormField>
        </div>
        <span className={styles.actions}><Button iconOnly variant="ghost" aria-label="上移题目" disabled={index === 0} onClick={() => move(index, -1)} icon={<ArrowUp size={16} />} /><Button iconOnly variant="ghost" aria-label="下移题目" disabled={index === problemDraft.length - 1} onClick={() => move(index, 1)} icon={<ArrowDown size={16} />} /><Button iconOnly variant="ghost" aria-label="移除题目" onClick={() => setProblemDraft(current => current.filter(row => row.id !== item.id))} icon={<Trash2 size={16} />} /></span>
      </div>)}{problemDraft.length === 0 && <p className={styles.muted}>尚未添加题目。</p>}</div>
    </Section>
    </>}
    {designStep === 2 && <>
    <Section title="学生名单" description={rosterMode === 'DYNAMIC' ? '发布时从当前学校或团队的有效学生生成一次性快照。' : `已选 ${rosterDraft.size} 人；发布后名单形成快照，历史结果不会因成员变更漂移。`}>
      {rosterMode === 'DYNAMIC' ? <p className={styles.muted}>动态名单不在草稿中勾选学生；发布事务会固定当时符合范围的学生，之后的成员变更不会改写作业。</p> : <AsyncRegion state={studentResource.state} onRetry={studentResource.retry} emptyText="当前学校没有可分配学生" skeletonRows={4}>
        {data => <div className={styles.rosterList}>{data.items.filter(item => item.userId).map(item => <Checkbox key={item.userId!} label={item.name || item.user?.username || '未命名学生'} description={item.user?.username} checked={rosterDraft.has(item.userId!)} onChange={event => setRosterDraft(current => { const next = new Set(current); event.target.checked ? next.add(item.userId!) : next.delete(item.userId!); return next })} />)}</div>}
      </AsyncRegion>}
    </Section>
    </>}
    {designStep === 3 && <>
    <Section title="发布检查" description="检查题目版本、时间范围和名单完整性。" actions={<><Button variant="secondary" loading={saving === 'validate'} onClick={() => void runValidation()}>运行检查</Button><Button icon={<CheckCircle2 size={16} />} onClick={() => setConfirmPublish(true)}>发布并冻结</Button></>}>
      {!validation ? <p className={styles.muted}>尚未运行发布检查。</p> : validation.valid ? <p>所有检查均已通过，可以发布。</p> : <ul className={styles.validationList}>{validation.issues.map(issue => <li key={`${issue.path}:${issue.code}`}>{issue.path}：{issue.message}</li>)}</ul>}
    </Section>
    </>}
    <div className={styles.designFooter}>
      <Button variant="secondary" disabled={designStep === 0 || Boolean(saving)} onClick={() => void changeStep(designStep - 1)}>上一步</Button>
      {designStep < 3 && <Button loading={Boolean(saving)} onClick={() => void changeStep(designStep + 1)}>下一步</Button>}
    </div>
    <FormDialog isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="添加题目" description="加入时固定当前最新 TestSet Revision；发布后不跟随题库更新。" size="lg">
      <Tabs label="题库范围" value={library} onChange={setLibrary} items={[{ value: 'school', label: '校内题库' }, { value: 'platform', label: 'Carits 平台题库' }]} />
      <AsyncRegion state={problemResource.state} onRetry={problemResource.retry} emptyText="当前题库没有可用题目" skeletonRows={5}>
        {data => <div className={styles.pickerList}>{data.data.map(problem => <div className={styles.pickerItem} key={problem.id}><span className={styles.problemIdentity}><strong>{problem.problemId} · {problem.title}</strong><span>{problem.platform} · {problem.difficulty || '未标注难度'}</span></span><Button size="sm" variant="secondary" disabled={problemDraft.some(item => item.problemId === problem.id)} onClick={() => void addProblem(problem)}>{problemDraft.some(item => item.problemId === problem.id) ? '已添加' : '添加'}</Button></div>)}</div>}
      </AsyncRegion>
    </FormDialog>
    <ConfirmDialog isOpen={confirmPublish} onClose={() => setConfirmPublish(false)} onConfirm={() => void publish()} loading={saving === 'publish'} title="发布并冻结作业？" message={`发布后将固定 ${problemDraft.length} 道题和${rosterMode === 'DYNAMIC' ? '发布时生成的学生名单' : ` ${rosterDraft.size} 名学生`}，不能再修改结构。请确认各配置区域均已保存。`} confirmText="确认发布" />
  </div>
}

const learningLabel: Record<string, string> = { NOT_STARTED: '未开始', IN_PROGRESS: '进行中', SUBMITTED: '已提交', TARGET_MET: '已达标', COMPLETED: '已完成', EXEMPT: '已免除' }
const correctionLabel: Record<string, string> = { NONE: '无需订正', NEEDS_CORRECTION: '待订正', CORRECTING: '订正中', CORRECTED: '已订正', WAIVED: '已免除', EXPIRED: '已过期' }

function StudentWorkspace({ assignment, workspace, onSubmitted }: { assignment: Assignment; workspace: AssignmentWorkspacePayload; onSubmitted: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [selected, setSelected] = useState<AssignmentProblem | null>(null)
  const [language, setLanguage] = useState('cpp17')
  const [code, setCode] = useState('')
  const [inputFilename, setInputFilename] = useState('')
  const [outputFilename, setOutputFilename] = useState('')
  const [sending, setSending] = useState(false)
  const submit = async () => {
    if (!selected) return
    setSending(true)
    const result = await apiClient.mutate<{ id: number }>(`/api/assignments/${assignment.id}/submit`, 'POST', { assignmentProblemId: selected.id, language, code, inputFilename: inputFilename || null, outputFilename: outputFilename || null })
    setSending(false)
    if (!result.ok) return toast.error(result.error.message)
    toast.success(`提交 #${result.data.id} 已进入评测队列`)
    clearSubmissionDraft(`${user?.userId || 'account'}:assignment:${assignment.id}:${selected.id}`, language)
    setSelected(null); setCode(''); setInputFilename(''); setOutputFilename('')
    onSubmitted()
  }
  const canSubmit = assignment.status === 'OPEN' || (assignment.status === 'OVERDUE' && assignment.latePolicy !== 'DISALLOW')
  const progressByProblem = new Map(workspace.progress.map(item => [item.assignmentProblemId, item]))
  const problemById = new Map(assignment.Problems.map(item => [item.id, item]))
  const latestGrade = workspace.gradeSnapshots[0]
  const pendingCorrections = workspace.corrections.filter(item => ['NEEDS_CORRECTION', 'CORRECTING'].includes(item.status))
  const requiredProblems = assignment.Problems.filter(item => item.category === 'REQUIRED')
  const incompleteRequired = requiredProblems.filter(item => progressByProblem.get(item.id)?.learningStatus !== 'COMPLETED')
  return <>
    <Section title="下一步行动" description={`最近截止：${formatAssignmentTime(assignment.dueAt)}`}><div className={styles.nextAction}><strong>{pendingCorrections.length ? `先完成 ${pendingCorrections.length} 项订正` : incompleteRequired.length ? `继续完成 ${incompleteRequired[0].Problem.problemId} · ${incompleteRequired[0].Problem.title}` : '必做题已完成'}</strong><span>必做完成 {requiredProblems.length - incompleteRequired.length}/{requiredProblems.length} · 待订正 {pendingCorrections.length}</span></div></Section>
    {latestGrade && <Section title="已发布成绩" description={`成绩快照 v${latestGrade.revision} · ${formatAssignmentTime(latestGrade.createdAt)}`}><div className={styles.gradeSummary}><strong>{latestGrade.totalScore}</strong><span>/ {latestGrade.maxScore} 分</span></div></Section>}
    <Section title="题目" description={canSubmit ? '每道题都使用作业发布时固定的测试版本。' : assignment.status === 'SCHEDULED' ? '作业尚未开放。' : '当前作业已经停止接收提交。'}><div className={styles.problemCards}>{assignment.Problems.map((item, index) => { const progress = progressByProblem.get(item.id); return <div className={styles.problemCard} key={item.id}><span className={styles.problemOrder}>{index + 1}</span><span className={styles.problemIdentity}><strong>{item.Problem.problemId} · {item.Problem.title}</strong><span>目标 {item.targetScore}/{item.maxScore} · R{item.TestSetRevision.revisionNumber}</span>{progress && <span>{learningLabel[progress.learningStatus] || progress.learningStatus} · 得分 {progress.finalScore ?? progress.bestScore ?? 0} · 提交 {progress.attemptCount ?? 0} 次{progress.correctionStatus !== 'NONE' ? ` · ${correctionLabel[progress.correctionStatus] || progress.correctionStatus}` : ''}</span>}</span><Button icon={<Send size={16} />} disabled={!canSubmit} onClick={() => setSelected(item)}>提交代码</Button></div> })}</div></Section>
    {(workspace.corrections.length > 0 || workspace.feedback.length > 0) && <Section title="订正与教师反馈" description="只显示与你本人有关的批改事实。"><div className={styles.reviewFeed}>
      {workspace.corrections.map(item => <div className={styles.reviewItem} key={item.id}><strong>订正 · {problemById.get(item.assignmentProblemId)?.Problem.problemId || '题目'}</strong><span>{correctionLabel[item.status] || item.status}{item.requiredScore !== null && item.requiredScore !== undefined ? ` · 要求达到 ${item.requiredScore} 分` : ''}{item.dueAt ? ` · 截止 ${formatAssignmentTime(item.dueAt)}` : ''}</span>{item.reason && <p>{item.reason}</p>}</div>)}
      {workspace.feedback.map(item => <div className={styles.reviewItem} key={item.id}><strong>教师反馈{item.assignmentProblemId ? ` · ${problemById.get(item.assignmentProblemId)?.Problem.problemId || '题目'}` : ''}</strong><span>{formatAssignmentTime(item.createdAt)}</span><p>{item.content}</p></div>)}
    </div></Section>}
    <FormDialog isOpen={Boolean(selected)} onClose={() => setSelected(null)} onSubmit={() => void submit()} title={selected ? `提交 ${selected.Problem.problemId} · ${selected.Problem.title}` : '提交代码'} description="本次提交将永久记录作业、题目、名单与 TestSet Revision 上下文。" submitText="提交评测" loading={sending} dirty={Boolean(code)} submitDisabled={!code.trim()} size="lg">
      <div className={styles.stack}><FormField label="语言"><Select value={language} onChange={event => { if (!code || window.confirm('切换后会保存当前语言草稿，并加载目标语言自己的草稿。是否切换？')) setLanguage(event.target.value) }}><option value="cpp17">C++17</option><option value="c11">C11</option><option value="python3">Python3</option></Select></FormField><FormField label="源码" required><SubmissionCodeEditor value={code} onChange={setCode} language={language} draftKey={`${user?.userId || 'account'}:assignment:${assignment.id}:${selected?.id || 'none'}`} /></FormField><div className={styles.settingsGrid}><FormField label="输入文件名" hint="留空表示标准输入"><Input value={inputFilename} onChange={event => setInputFilename(event.target.value)} placeholder="例如 travel.in" /></FormField><FormField label="输出文件名" hint="留空表示标准输出"><Input value={outputFilename} onChange={event => setOutputFilename(event.target.value)} placeholder="例如 travel.out" /></FormField></div></div>
    </FormDialog>
  </>
}

function ManagerWorkspace({ assignment, progress, onChange, onRefresh }: { assignment: Assignment; progress: ProgressPayload | null; onChange: (assignment: Assignment) => void; onRefresh: () => void }) {
  const { sessionKey } = useAuth()
  const toast = useToast()
  const [transitioning, setTransitioning] = useState(false)
  const [reviewing, setReviewing] = useState<ProgressRecipient | null>(null)
  const [reviewingCell, setReviewingCell] = useState<ProgressItem | null>(null)
  const [reviewKind, setReviewKind] = useState<'feedback' | 'correction' | 'adjustment'>('feedback')
  const [reviewProblemId, setReviewProblemId] = useState('')
  const [reviewContent, setReviewContent] = useState('')
  const [correctionRequiredScore, setCorrectionRequiredScore] = useState(0)
  const [delta, setDelta] = useState(0)
  const [savingReview, setSavingReview] = useState(false)
  const [manualReason, setManualReason] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualSaving, setManualSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [problemFilter, setProblemFilter] = useState('')
  const [page, setPage] = useState(1)
  const matrixUrl = `/api/assignments/${assignment.id}/progress?page=${page}&pageSize=40&q=${encodeURIComponent(query)}&problemId=${encodeURIComponent(problemFilter)}&state=${encodeURIComponent(stateFilter)}`
  const matrix = useResource<ProgressPayload>(matrixUrl, { sessionKey, isEmpty: () => false })
  const displayed = matrix.data || progress
  const transition = async (action: string) => {
    setTransitioning(true)
    const result = await apiClient.post<Assignment>(`/api/assignments/${assignment.id}/${action}`, { expectedRevision: assignment.statusRevision })
    setTransitioning(false)
    if (!result.success || !result.data) return toast.error(result.message || '状态更新失败')
    onChange(result.data); toast.success('作业状态已更新')
  }
  const nextAction = assignment.status === 'OPEN' || assignment.status === 'OVERDUE'
    ? { action: 'close', label: '关闭作业' }
    : assignment.status === 'CLOSED'
      ? { action: 'review', label: '进入批改' }
      : assignment.status === 'REVIEWING'
        ? { action: 'release', label: '发布成绩' }
        : assignment.status === 'RELEASED'
          ? { action: 'archive', label: '归档作业' }
          : null
  const submitReview = async () => {
    if (!reviewing) return
    setSavingReview(true)
    const endpoint = reviewKind === 'feedback' ? 'feedback' : reviewKind === 'correction' ? 'corrections' : 'score-adjustments'
    const body = reviewKind === 'feedback'
      ? { recipientId: reviewing.id, assignmentProblemId: reviewProblemId || null, content: reviewContent, visibility: 'RECIPIENT' }
      : reviewKind === 'correction'
        ? { recipientId: reviewing.id, assignmentProblemId: reviewProblemId, reason: reviewContent, requiredScore: correctionRequiredScore }
        : { recipientId: reviewing.id, assignmentProblemId: reviewProblemId || null, delta, reason: reviewContent }
    const result = await apiClient.mutate(`/api/assignments/${assignment.id}/${endpoint}`, 'POST', body)
    setSavingReview(false)
    if (!result.ok) return toast.error(result.error.message)
    toast.success(reviewKind === 'feedback' ? '反馈已保存' : reviewKind === 'correction' ? '订正任务已布置' : '调分流水已追加')
    setReviewing(null); setReviewContent(''); setReviewProblemId(''); setCorrectionRequiredScore(0); setDelta(0); onRefresh()
    void matrix.retry()
  }
  const openCell = (recipient: ProgressRecipient, cell: ProgressItem) => {
    setReviewing(recipient)
    setReviewingCell(cell)
    setReviewProblemId(cell.assignmentProblemId)
    setCorrectionRequiredScore(assignment.Problems.find(problem => problem.id === cell.assignmentProblemId)?.targetScore || 0)
  }
  const closeCell = () => { setReviewing(null); setReviewingCell(null); setReviewContent(''); setManualReason('') }
  const saveManual = async () => {
    if (!reviewingCell?.id) return
    setManualSaving(true)
    const result = await apiClient.mutate<ProgressItem>(`/api/assignments/${assignment.id}/progress/${reviewingCell.id}/manual-completion`, 'POST', {
      completed: !reviewingCell.manualCompletedAt,
      reason: manualReason,
      expectedVersion: reviewingCell.manualCompletionVersion || 0,
    })
    setManualSaving(false)
    if (!result.ok) return toast.error(result.error.message)
    toast.success(reviewingCell.manualCompletedAt ? '已撤销人工完成' : '已确认完成')
    setManualOpen(false); setManualReason(''); closeCell(); onRefresh(); void matrix.retry()
  }
  const stateOptions = [
    ['', '全部状态'], ['NOT_STARTED', '未开始'], ['BELOW_TARGET', '低于目标'], ['LATE', '迟交'],
    ['NEEDS_CORRECTION', '待订正'], ['CORRECTED', '已订正'], ['MANUAL_PENDING', '待人工确认'], ['COMPLETED', '已完成'],
  ]
  const statusText = (cell: ProgressItem, problem: AssignmentProblem) => {
    if (!cell.attemptCount) return problem.completionPolicy === 'MANUAL' ? '等待学生提交' : '未开始'
    if (cell.learningStatus === 'COMPLETED') return problem.completionPolicy === 'AC' ? 'AC' : '已完成'
    if (cell.bestVerdict === 'Accepted') return 'AC'
    if (cell.finalScore !== null && cell.finalScore !== undefined) return `${cell.finalScore} 分`
    return '已提交'
  }
  const matrixProblems = problemFilter
    ? assignment.Problems.filter(problem => problem.id === problemFilter)
    : assignment.Problems
  return <div className={styles.stack}>
    <Section title="作业控制" description="状态变化会写入持久事件；发布成绩时生成最终成绩快照。" actions={nextAction ? <Button loading={transitioning} onClick={() => void transition(nextAction.action)}>{nextAction.label}</Button> : undefined}><p className={styles.muted}>当前状态：{assignmentStatusMeta[assignment.status].label}。题目版本和名单已冻结。</p></Section>
    <Section title="批改矩阵" description="按学生和题目直接定位未开始、低于目标、迟交、待订正与待人工确认。">
      <div className={styles.matrixToolbar}><Input aria-label="搜索用户名" placeholder="搜索用户名" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /><Select aria-label="筛选题目" value={problemFilter} onChange={event => { setProblemFilter(event.target.value); setPage(1) }}><option value="">全部题目</option>{assignment.Problems.map(problem => <option key={problem.id} value={problem.id}>{problem.Problem.problemId}</option>)}</Select><Select aria-label="筛选进度状态" value={stateFilter} onChange={event => { setStateFilter(event.target.value); setPage(1) }}>{stateOptions.map(([value, label]) => <option key={value} value={value}>{label}{value && displayed?.statusCounts?.[value] !== undefined ? `（${displayed.statusCounts[value]}）` : ''}</option>)}</Select></div>
      <div className={styles.matrixScroll}><Table data={displayed?.recipients || []} rowKey={recipient => recipient.id} caption="学生题目批改矩阵" columns={[
        { key: 'user.username', label: '学生', width: '160px', className: styles.matrixSticky, render: recipient => <strong>{recipient.user.username}</strong> },
        ...matrixProblems.map(problem => ({ key: problem.id, label: `${problem.Problem.problemId} · ${problem.targetScore}/${problem.maxScore}`, render: (recipient: ProgressRecipient) => { const cell = (recipient.cells || recipient.progress).find(item => item.assignmentProblemId === problem.id) || { assignmentProblemId: problem.id, learningStatus: 'NOT_STARTED', timelinessStatus: 'ON_TIME', correctionStatus: 'NONE', attemptCount: 0 }; return <Button variant="ghost" className={styles.matrixCell} onClick={() => openCell(recipient, cell)}><strong>{statusText(cell, problem)}</strong><span>{cell.timelinessStatus === 'LATE' ? '迟交' : ''}{['NEEDS_CORRECTION', 'CORRECTING'].includes(cell.correctionStatus) ? ' · 待订正' : cell.correctionStatus === 'CORRECTED' ? ' · 已订正' : ''}{cell.states?.includes('MANUAL_PENDING') ? ' · 待确认' : ''}</span></Button> } })),
        { key: 'score', label: '汇总', render: recipient => <><strong>{recipient.score} 分</strong><small>{recipient.completedProblems}/{assignment.Problems.length} 完成 · {recipient.lateProblems} 迟交 · {recipient.correctionProblems} 待订正</small></> },
      ]} /></div>
      {!displayed?.recipients.length && <p className={styles.muted}>当前筛选下没有学生进度。</p>}
      {displayed?.pagination && <Pagination currentPage={displayed.pagination.page} totalPages={displayed.pagination.totalPages} total={displayed.pagination.total} pageSize={displayed.pagination.pageSize} onPageChange={setPage} showQuickJumper={false} />}
    </Section>
    <DetailDialog isOpen={Boolean(reviewing && reviewingCell)} onClose={closeCell} title={reviewing && reviewingCell ? `批改 · ${reviewing.user.username} · ${assignment.Problems.find(problem => problem.id === reviewingCell.assignmentProblemId)?.Problem.problemId || '题目'}` : '批改详情'} description="提交、成绩、订正和人工完成均来自服务端评测事实。" size="lg" footer={<><Button variant="secondary" onClick={closeCell}>关闭</Button><Button onClick={() => { setReviewKind('feedback'); setReviewContent('') }}>添加批改动作</Button></>}>
      {reviewingCell && <div className={styles.cellDetail}><div><span>主状态</span><strong>{statusText(reviewingCell, assignment.Problems.find(problem => problem.id === reviewingCell.assignmentProblemId)!)}</strong></div><div><span>提交次数</span><strong>{reviewingCell.attemptCount || 0}</strong></div><div><span>最好成绩</span><strong>{reviewingCell.bestScore ?? '—'}</strong></div><div><span>最终成绩</span><strong>{reviewingCell.finalScore ?? '—'}</strong></div><div><span>时间状态</span><strong>{reviewingCell.timelinessStatus === 'LATE' ? '迟交' : '按时'}</strong></div><div><span>订正状态</span><strong>{correctionLabel[reviewingCell.correctionStatus] || reviewingCell.correctionStatus}</strong></div></div>}
      {reviewingCell && assignment.Problems.find(problem => problem.id === reviewingCell.assignmentProblemId)?.completionPolicy === 'MANUAL' && <div className={styles.manualAction}>{reviewingCell.attemptCount ? <Button variant={reviewingCell.manualCompletedAt ? 'danger' : 'primary'} onClick={() => setManualOpen(true)}>{reviewingCell.manualCompletedAt ? '撤销确认' : '确认完成'}</Button> : <span className={styles.muted}>等待学生首次提交后，才可人工确认完成。</span>}{reviewingCell.manualCompletedAt && <span>由 {reviewingCell.manualCompletedBy?.username || '教师'} 确认{reviewingCell.manualCompletionReason ? `：${reviewingCell.manualCompletionReason}` : ''}</span>}</div>}
      <div className={styles.reviewActions}><Tabs label="批改动作" value={reviewKind} onChange={value => setReviewKind(value)} items={[{ value: 'feedback', label: '反馈' }, { value: 'correction', label: '布置订正' }, { value: 'adjustment', label: '人工调分' }]} /><FormField label={reviewKind === 'feedback' ? '反馈内容' : '原因'} required><Textarea rows={4} value={reviewContent} onChange={event => setReviewContent(event.target.value)} /></FormField>{reviewKind === 'correction' && <FormField label="订正达标分"><Input type="number" min={0} max={assignment.Problems.find(problem => problem.id === reviewProblemId)?.maxScore || 0} value={correctionRequiredScore} onChange={event => setCorrectionRequiredScore(Number(event.target.value))} /></FormField>}{reviewKind === 'adjustment' && <FormField label="调分值"><Input type="number" min={-1000} max={1000} value={delta} onChange={event => setDelta(Number(event.target.value))} /></FormField>}<Button loading={savingReview} disabled={!reviewContent.trim() || (reviewKind === 'adjustment' && delta === 0)} onClick={() => void submitReview()}>保存批改动作</Button></div>
    </DetailDialog>
    <FormDialog isOpen={manualOpen} onClose={() => setManualOpen(false)} onSubmit={() => void saveManual()} title={reviewingCell?.manualCompletedAt ? '撤销人工完成确认' : '确认学生已完成'} description="该操作使用版本号并发校验，并写入审计事件。" submitText={reviewingCell?.manualCompletedAt ? '确认撤销' : '确认完成'} danger={Boolean(reviewingCell?.manualCompletedAt)} loading={manualSaving} dirty={Boolean(manualReason)} submitDisabled={!manualReason.trim()}>
      <FormField label="操作原因" required><Textarea rows={4} value={manualReason} onChange={event => setManualReason(event.target.value)} /></FormField>
    </FormDialog>
    <FormDialog isOpen={Boolean(reviewing && !reviewingCell)} onClose={() => setReviewing(null)} onSubmit={() => void submitReview()} title={reviewing ? `批改 · ${reviewing.user.username}` : '批改'} description="反馈、订正和调分均保存为可审计事实。" submitText="确认保存" loading={savingReview} dirty={Boolean(reviewContent || delta)} submitDisabled={!reviewContent.trim() || (reviewKind === 'correction' && !reviewProblemId) || (reviewKind === 'adjustment' && delta === 0)} size="md">
      <div className={styles.stack}><Tabs label="批改动作" value={reviewKind} onChange={value => setReviewKind(value)} items={[{ value: 'feedback', label: '反馈' }, { value: 'correction', label: '布置订正' }, { value: 'adjustment', label: '人工调分' }]} /><FormField label={reviewKind === 'correction' ? '题目' : '关联题目（可选）'} required={reviewKind === 'correction'}><Select value={reviewProblemId} onChange={event => { const value = event.target.value; setReviewProblemId(value); if (reviewKind === 'correction') setCorrectionRequiredScore(assignment.Problems.find(problem => problem.id === value)?.targetScore || 0) }}><option value="">{reviewKind === 'correction' ? '请选择题目' : '整份作业'}</option>{assignment.Problems.map(problem => <option value={problem.id} key={problem.id}>{problem.Problem.problemId} · {problem.Problem.title}</option>)}</Select></FormField>{reviewKind === 'correction' && reviewProblemId && <FormField label="订正达标分" required hint="只有订正提交达到该分数，任务才会标记为已订正"><Input type="number" min={0} max={assignment.Problems.find(problem => problem.id === reviewProblemId)?.maxScore || 0} value={correctionRequiredScore} onChange={event => setCorrectionRequiredScore(Number(event.target.value))} /></FormField>}{reviewKind === 'adjustment' && <FormField label="调分值" required hint="负数表示扣分，冲正由独立流水完成"><Input type="number" min={-1000} max={1000} value={delta} onChange={event => setDelta(Number(event.target.value))} /></FormField>}<FormField label={reviewKind === 'feedback' ? '反馈内容' : '原因'} required><Textarea rows={5} value={reviewContent} onChange={event => setReviewContent(event.target.value)} /></FormField></div>
    </FormDialog>
  </div>
}

export function AssignmentWorkspace() {
  const router = useRouter()
  const params = useParams<{ organizationId: string; assignmentId?: string; segments?: string[] }>()
  const id = params.assignmentId || params.segments?.[0] || ''
  const { sessionKey } = useAuth()
  const resource = useResource<AssignmentWorkspacePayload>(id ? `/api/assignments/${id}/workspace` : null, { sessionKey, isEmpty: () => false })
  const [local, setLocal] = useState<Assignment | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const toast = useToast()
  useEffect(() => { if (resource.data) setLocal(resource.data.assignment) }, [resource.data])
  const assignment = local || resource.data?.assignment
  const canManage = resource.data?.canManage ?? false
  const status = assignment ? assignmentStatusMeta[assignment.status] : null
  const facts = useMemo(() => assignment ? [{ label: '开放', value: formatAssignmentTime(assignment.openAt) }, { label: '截止', value: formatAssignmentTime(assignment.dueAt) }, { label: '题目', value: `${assignment.problemCount} 道` }, { label: '名单', value: `${assignment.recipientCount} 人` }] : [], [assignment])
  const canCancel = Boolean(canManage && assignment && ['DRAFT', 'SCHEDULED', 'OPEN', 'OVERDUE'].includes(assignment.status))
  const cancel = async () => {
    if (!assignment) return
    setCancelling(true)
    const result = await apiClient.post<Assignment>(`/api/assignments/${assignment.id}/cancel`, { expectedRevision: assignment.statusRevision })
    setCancelling(false)
    setConfirmCancel(false)
    if (!result.success || !result.data) return toast.error(result.message || '取消作业失败')
    setLocal(result.data)
    toast.success('作业已取消')
  }
  return <PageFrame>
    <PageHeader title={assignment?.title || '作业'} description={assignment?.description || '独立作业工作台'} actions={<><Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={() => router.push(`/org/${params.organizationId}/homeworks`)}>返回列表</Button>{canCancel && <Button variant="danger" onClick={() => setConfirmCancel(true)}>取消作业</Button>}</>} />
    <AsyncRegion state={resource.state} onRetry={resource.retry} emptyText="作业不存在" skeletonRows={6}>
      {() => assignment && <div className={styles.stack}>
        <div className={styles.summaryGrid}>{facts.map(item => <div className={styles.summaryItem} key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
        {status && <div><StatusBadge variant={status.variant}>{status.label}</StatusBadge></div>}
        {canManage && assignment.status === 'DRAFT' ? <DraftEditor assignment={assignment} onChange={setLocal} /> : canManage ? <ManagerWorkspace assignment={assignment} progress={resource.data?.managerProgress || null} onChange={setLocal} onRefresh={() => void resource.retry()} /> : resource.data ? <StudentWorkspace assignment={assignment} workspace={resource.data} onSubmitted={() => void resource.retry()} /> : null}
      </div>}
    </AsyncRegion>
    <ConfirmDialog isOpen={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={() => void cancel()} loading={cancelling} danger title="取消这份作业？" message="取消后将立即停止提交，题目版本、名单、历史提交和评测事实仍会保留。此状态不可撤销。" confirmText="确认取消" />
  </PageFrame>
}
