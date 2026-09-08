'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Plus, Send, Trash2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import apiClient from '@/lib/apiClient'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, FormDialog } from '@/components/ui/Dialogs'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormField } from '@/components/ui/FormField'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
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
interface ProgressItem { assignmentProblemId: string; learningStatus: string; timelinessStatus: string; correctionStatus: string; attemptCount?: number; bestScore?: number | null; bestVerdict?: string | null; finalScore?: number | null }
interface ProgressRecipient { id: string; user: { id: string; username: string }; score: number; rawScore: number; adjustment: number; completedProblems: number; lateProblems: number; correctionProblems: number; progress: ProgressItem[] }
interface ProgressPayload { recipients: ProgressRecipient[]; problems: AssignmentProblem[] }
interface AssignmentCorrectionItem { id: string; assignmentProblemId: string; status: string; reason?: string | null; dueAt?: string | null; createdAt: string }
interface AssignmentFeedbackItem { id: string; assignmentProblemId?: string | null; content: string; createdAt: string }
interface AssignmentGradeSnapshotItem { id: string; type: string; revision: number; totalScore: number; maxScore: number; createdAt: string }
interface AssignmentWorkspacePayload {
  canManage: boolean
  assignment: Assignment
  progress: ProgressItem[]
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
  const [openAt, setOpenAt] = useState(toLocalInput(assignment.openAt))
  const [dueAt, setDueAt] = useState(toLocalInput(assignment.dueAt))
  const [closeAt, setCloseAt] = useState(toLocalInput(assignment.closeAt))
  const [problemDraft, setProblemDraft] = useState(assignment.Problems)
  const [rosterDraft, setRosterDraft] = useState(() => new Set(assignment.Recipients.map(item => item.userId)))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [library, setLibrary] = useState<'school' | 'platform'>('school')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)

  useEffect(() => {
    setProblemDraft(assignment.Problems)
    setRosterDraft(new Set(assignment.Recipients.map(item => item.userId)))
  }, [assignment])

  const problemResource = useResource<ProblemListResponse>(pickerOpen ? `/api/problems?library=${library}&${library === 'platform' ? 'sourceGroup=carits&' : ''}pageSize=100` : null, { sessionKey, isEmpty: data => data.data.length === 0 })
  const studentResource = useResource<StudentList>(`/api/organizations/${organizationId}/members/students?pageSize=100`, { sessionKey, isEmpty: data => data.items.length === 0 })

  const mutate = async (endpoint: string, method: 'PATCH' | 'PUT' | 'POST', body: unknown, key: string) => {
    setSaving(key)
    const result = await apiClient.mutate<Assignment>(endpoint, method, body)
    setSaving(null)
    if (!result.ok) { toast.error(result.error.message); return null }
    onChange(result.data)
    toast.success('已保存')
    return result.data
  }

  const saveBasics = () => mutate(`/api/assignments/${assignment.id}`, 'PATCH', { expectedRevision: assignment.statusRevision, title, description, openAt, dueAt, closeAt }, 'basic')
  const saveProblems = () => mutate(`/api/assignments/${assignment.id}/problems`, 'PUT', { expectedRevision: assignment.statusRevision, problems: problemDraft.map(item => ({ id: item.id, problemId: item.problemId, testSetRevisionId: item.testSetRevisionId, category: item.category, required: item.required, maxScore: item.maxScore, targetScore: item.targetScore, weight: item.weight, completionPolicy: item.completionPolicy })) }, 'problems')
  const saveRoster = () => mutate(`/api/assignments/${assignment.id}/roster`, 'PUT', { expectedRevision: assignment.statusRevision, userIds: [...rosterDraft] }, 'roster')

  const addProblem = async (problem: ProblemListItem) => {
    if (problemDraft.some(item => item.problemId === problem.id)) return
    const result = await apiClient.get<RevisionList>(`/api/problems/${problem.id}/test-set-revisions`)
    if (!result.success || !result.data?.latestTestSetRevisionId) return toast.error(result.message || '该题没有可用的正式测试版本')
    const revision = result.data.revisions.find(item => item.id === result.data!.latestTestSetRevisionId)
    if (!revision) return toast.error('该题最新测试版本不可用')
    setProblemDraft(current => [...current, {
      id: `draft-${problem.id}`, problemId: problem.id, testSetRevisionId: revision.id, orderIndex: current.length,
      category: 'REQUIRED', required: true, maxScore: 100, targetScore: 100, weight: 100,
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
    setSaving('validate')
    const result = await apiClient.post<ValidationResult>(`/api/assignments/${assignment.id}/validate`)
    setSaving(null)
    if (!result.success || !result.data) return toast.error(result.message || '发布检查失败')
    setValidation(result.data)
    result.data.valid ? toast.success('发布检查通过') : toast.warning('请先修复发布检查中的问题')
  }

  const publish = async () => {
    setSaving('publish')
    const result = await apiClient.post<Assignment>(`/api/assignments/${assignment.id}/publish`, { expectedRevision: assignment.statusRevision })
    setSaving(null)
    setConfirmPublish(false)
    if (!result.success || !result.data) return toast.error(result.message || '发布失败')
    onChange(result.data)
    toast.success('作业已发布，题目版本和名单已冻结')
  }

  return <div className={styles.stack}>
    <p className={styles.draftNotice}>当前为草稿。题目 TestSet Revision 与学生名单将在发布后永久冻结；每个区域单独保存，避免未确认修改直接生效。</p>
    <Section title="基本信息" description={`配置版本 ${assignment.statusRevision}`} actions={<Button loading={saving === 'basic'} onClick={() => void saveBasics()}>保存基本信息</Button>}>
      <div className={styles.settingsGrid}>
        <FormField label="作业名称" required><Input value={title} onChange={event => setTitle(event.target.value)} /></FormField>
        <FormField label="开放时间" required><Input type="datetime-local" value={openAt} onChange={event => setOpenAt(event.target.value)} /></FormField>
        <FormField label="截止时间" required><Input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></FormField>
        <FormField label="关闭时间" required><Input type="datetime-local" value={closeAt} onChange={event => setCloseAt(event.target.value)} /></FormField>
        <div className={styles.full}><FormField label="作业说明"><Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></FormField></div>
      </div>
    </Section>
    <Section title="题目与固定版本" description="调整题目顺序、分值和完成目标。" actions={<><Button variant="secondary" icon={<Plus size={16} />} onClick={() => setPickerOpen(true)}>添加题目</Button><Button loading={saving === 'problems'} onClick={() => void saveProblems()}>保存题目</Button></>}>
      <div className={styles.stack}>{problemDraft.map((item, index) => <div className={styles.problemRow} key={item.id}>
        <span className={styles.problemIdentity}><strong>{index + 1}. {item.Problem.problemId} · {item.Problem.title}</strong><span>固定 R{item.TestSetRevision.revisionNumber} · {item.TestSetRevision.mode.toUpperCase()}</span></span>
        <Input aria-label={`${item.Problem.title} 满分`} type="number" min={1} max={1000} value={item.maxScore} onChange={event => setProblemDraft(current => current.map(row => row.id === item.id ? { ...row, maxScore: Number(event.target.value) } : row))} />
        <Input aria-label={`${item.Problem.title} 目标分`} type="number" min={0} max={item.maxScore} value={item.targetScore} onChange={event => setProblemDraft(current => current.map(row => row.id === item.id ? { ...row, targetScore: Number(event.target.value) } : row))} />
        <span className={styles.actions}><Button iconOnly variant="ghost" aria-label="上移题目" disabled={index === 0} onClick={() => move(index, -1)} icon={<ArrowUp size={16} />} /><Button iconOnly variant="ghost" aria-label="下移题目" disabled={index === problemDraft.length - 1} onClick={() => move(index, 1)} icon={<ArrowDown size={16} />} /><Button iconOnly variant="ghost" aria-label="移除题目" onClick={() => setProblemDraft(current => current.filter(row => row.id !== item.id))} icon={<Trash2 size={16} />} /></span>
      </div>)}{problemDraft.length === 0 && <p className={styles.muted}>尚未添加题目。</p>}</div>
    </Section>
    <Section title="学生名单" description="发布后名单形成快照，历史结果不会因成员变更漂移。" actions={<Button loading={saving === 'roster'} onClick={() => void saveRoster()}>保存名单（{rosterDraft.size}）</Button>}>
      <AsyncRegion state={studentResource.state} onRetry={studentResource.retry} emptyText="当前学校没有可分配学生" skeletonRows={4}>
        {data => <div className={styles.rosterList}>{data.items.filter(item => item.userId).map(item => <Checkbox key={item.userId!} label={item.name || item.user?.username || '未命名学生'} description={item.user?.username} checked={rosterDraft.has(item.userId!)} onChange={event => setRosterDraft(current => { const next = new Set(current); event.target.checked ? next.add(item.userId!) : next.delete(item.userId!); return next })} />)}</div>}
      </AsyncRegion>
    </Section>
    <Section title="发布检查" description="检查题目版本、时间范围和名单完整性。" actions={<><Button variant="secondary" loading={saving === 'validate'} onClick={() => void runValidation()}>运行检查</Button><Button icon={<CheckCircle2 size={16} />} onClick={() => setConfirmPublish(true)}>发布并冻结</Button></>}>
      {!validation ? <p className={styles.muted}>尚未运行发布检查。</p> : validation.valid ? <p>所有检查均已通过，可以发布。</p> : <ul className={styles.validationList}>{validation.issues.map(issue => <li key={`${issue.path}:${issue.code}`}>{issue.path}：{issue.message}</li>)}</ul>}
    </Section>
    <FormDialog isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="添加题目" description="加入时固定当前最新 TestSet Revision；发布后不跟随题库更新。" size="lg">
      <Tabs label="题库范围" value={library} onChange={setLibrary} items={[{ value: 'school', label: '校内题库' }, { value: 'platform', label: 'Carits 平台题库' }]} />
      <AsyncRegion state={problemResource.state} onRetry={problemResource.retry} emptyText="当前题库没有可用题目" skeletonRows={5}>
        {data => <div className={styles.pickerList}>{data.data.map(problem => <div className={styles.pickerItem} key={problem.id}><span className={styles.problemIdentity}><strong>{problem.problemId} · {problem.title}</strong><span>{problem.platform} · {problem.difficulty || '未标注难度'}</span></span><Button size="sm" variant="secondary" disabled={problemDraft.some(item => item.problemId === problem.id)} onClick={() => void addProblem(problem)}>{problemDraft.some(item => item.problemId === problem.id) ? '已添加' : '添加'}</Button></div>)}</div>}
      </AsyncRegion>
    </FormDialog>
    <ConfirmDialog isOpen={confirmPublish} onClose={() => setConfirmPublish(false)} onConfirm={() => void publish()} loading={saving === 'publish'} title="发布并冻结作业？" message={`发布后将固定 ${problemDraft.length} 道题和 ${rosterDraft.size} 名学生，不能再修改结构。请确认三个配置区域均已保存。`} confirmText="确认发布" />
  </div>
}

const learningLabel: Record<string, string> = { NOT_STARTED: '未开始', ATTEMPTED: '已尝试', TARGET_MET: '已达标', COMPLETED: '已完成', WAIVED: '已免除' }
const correctionLabel: Record<string, string> = { NONE: '无需订正', NEEDS_CORRECTION: '待订正', CORRECTING: '订正中', COMPLETED: '已完成', WAIVED: '已免除' }

function StudentWorkspace({ assignment, workspace, onSubmitted }: { assignment: Assignment; workspace: AssignmentWorkspacePayload; onSubmitted: () => void }) {
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
    setSelected(null); setCode(''); setInputFilename(''); setOutputFilename('')
    onSubmitted()
  }
  const canSubmit = assignment.status === 'OPEN' || (assignment.status === 'OVERDUE' && assignment.latePolicy !== 'DISALLOW')
  const progressByProblem = new Map(workspace.progress.map(item => [item.assignmentProblemId, item]))
  const problemById = new Map(assignment.Problems.map(item => [item.id, item]))
  const latestGrade = workspace.gradeSnapshots[0]
  return <>
    {latestGrade && <Section title="已发布成绩" description={`成绩快照 v${latestGrade.revision} · ${formatAssignmentTime(latestGrade.createdAt)}`}><div className={styles.gradeSummary}><strong>{latestGrade.totalScore}</strong><span>/ {latestGrade.maxScore} 分</span></div></Section>}
    <Section title="题目" description={canSubmit ? '每道题都使用作业发布时固定的测试版本。' : assignment.status === 'SCHEDULED' ? '作业尚未开放。' : '当前作业已经停止接收提交。'}><div className={styles.problemCards}>{assignment.Problems.map((item, index) => { const progress = progressByProblem.get(item.id); return <div className={styles.problemCard} key={item.id}><span className={styles.problemOrder}>{index + 1}</span><span className={styles.problemIdentity}><strong>{item.Problem.problemId} · {item.Problem.title}</strong><span>目标 {item.targetScore}/{item.maxScore} · R{item.TestSetRevision.revisionNumber}</span>{progress && <span>{learningLabel[progress.learningStatus] || progress.learningStatus} · 得分 {progress.finalScore ?? progress.bestScore ?? 0} · 提交 {progress.attemptCount ?? 0} 次{progress.correctionStatus !== 'NONE' ? ` · ${correctionLabel[progress.correctionStatus] || progress.correctionStatus}` : ''}</span>}</span><Button icon={<Send size={16} />} disabled={!canSubmit} onClick={() => setSelected(item)}>提交代码</Button></div> })}</div></Section>
    {(workspace.corrections.length > 0 || workspace.feedback.length > 0) && <Section title="订正与教师反馈" description="只显示与你本人有关的批改事实。"><div className={styles.reviewFeed}>
      {workspace.corrections.map(item => <div className={styles.reviewItem} key={item.id}><strong>订正 · {problemById.get(item.assignmentProblemId)?.Problem.problemId || '题目'}</strong><span>{correctionLabel[item.status] || item.status}{item.dueAt ? ` · 截止 ${formatAssignmentTime(item.dueAt)}` : ''}</span>{item.reason && <p>{item.reason}</p>}</div>)}
      {workspace.feedback.map(item => <div className={styles.reviewItem} key={item.id}><strong>教师反馈{item.assignmentProblemId ? ` · ${problemById.get(item.assignmentProblemId)?.Problem.problemId || '题目'}` : ''}</strong><span>{formatAssignmentTime(item.createdAt)}</span><p>{item.content}</p></div>)}
    </div></Section>}
    <FormDialog isOpen={Boolean(selected)} onClose={() => setSelected(null)} onSubmit={() => void submit()} title={selected ? `提交 ${selected.Problem.problemId} · ${selected.Problem.title}` : '提交代码'} description="本次提交将永久记录作业、题目、名单与 TestSet Revision 上下文。" submitText="提交评测" loading={sending} dirty={Boolean(code)} submitDisabled={!code.trim()} size="lg">
      <div className={styles.stack}><FormField label="语言"><Select value={language} onChange={event => setLanguage(event.target.value)}><option value="cpp17">C++17</option><option value="c11">C11</option><option value="python3">Python3</option></Select></FormField><FormField label="源码" required><Textarea className={styles.codeEditor} value={code} onChange={event => setCode(event.target.value)} spellCheck={false} /></FormField><div className={styles.settingsGrid}><FormField label="输入文件名" hint="留空表示标准输入"><Input value={inputFilename} onChange={event => setInputFilename(event.target.value)} placeholder="例如 travel.in" /></FormField><FormField label="输出文件名" hint="留空表示标准输出"><Input value={outputFilename} onChange={event => setOutputFilename(event.target.value)} placeholder="例如 travel.out" /></FormField></div></div>
    </FormDialog>
  </>
}

function ManagerWorkspace({ assignment, onChange }: { assignment: Assignment; onChange: (assignment: Assignment) => void }) {
  const { sessionKey } = useAuth()
  const toast = useToast()
  const [transitioning, setTransitioning] = useState(false)
  const [reviewing, setReviewing] = useState<ProgressRecipient | null>(null)
  const [reviewKind, setReviewKind] = useState<'feedback' | 'correction' | 'adjustment'>('feedback')
  const [reviewProblemId, setReviewProblemId] = useState('')
  const [reviewContent, setReviewContent] = useState('')
  const [delta, setDelta] = useState(0)
  const [savingReview, setSavingReview] = useState(false)
  const resource = useResource<ProgressPayload>(`/api/assignments/${assignment.id}/progress`, { sessionKey, isEmpty: data => data.recipients.length === 0, dedupingInterval: 10000 })
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
        ? { recipientId: reviewing.id, assignmentProblemId: reviewProblemId, reason: reviewContent }
        : { recipientId: reviewing.id, assignmentProblemId: reviewProblemId || null, delta, reason: reviewContent }
    const result = await apiClient.mutate(`/api/assignments/${assignment.id}/${endpoint}`, 'POST', body)
    setSavingReview(false)
    if (!result.ok) return toast.error(result.error.message)
    toast.success(reviewKind === 'feedback' ? '反馈已保存' : reviewKind === 'correction' ? '订正任务已布置' : '调分流水已追加')
    setReviewing(null); setReviewContent(''); setReviewProblemId(''); setDelta(0); void resource.retry()
  }
  return <div className={styles.stack}>
    <Section title="作业控制" description="状态变化会写入持久事件；发布成绩时生成最终成绩快照。" actions={nextAction ? <Button loading={transitioning} onClick={() => void transition(nextAction.action)}>{nextAction.label}</Button> : undefined}><p className={styles.muted}>当前状态：{assignmentStatusMeta[assignment.status].label}。题目版本和名单已冻结。</p></Section>
    <Section title="完成情况" description="成绩由评测事实、订正和不可变调分流水共同计算。"><Table data={resource.data?.recipients || []} loading={resource.state.state === 'pending'} error={resource.state.state === 'error' ? resource.state.error.message : undefined} onRetry={resource.retry} emptyText="暂无学生进度" actions={item => <Button size="sm" variant="secondary" onClick={() => setReviewing(item)}>批改与反馈</Button>} columns={[{ key: 'user.username', label: '学生', render: item => item.user.username }, { key: 'completedProblems', label: '完成题数' }, { key: 'score', label: '当前分数', render: item => <span className={styles.score}>{item.score}</span> }, { key: 'lateProblems', label: '迟交' }, { key: 'correctionProblems', label: '待订正' }]} /></Section>
    <FormDialog isOpen={Boolean(reviewing)} onClose={() => setReviewing(null)} onSubmit={() => void submitReview()} title={reviewing ? `批改 · ${reviewing.user.username}` : '批改'} description="反馈、订正和调分均保存为可审计事实。" submitText="确认保存" loading={savingReview} dirty={Boolean(reviewContent || delta)} submitDisabled={!reviewContent.trim() || (reviewKind === 'correction' && !reviewProblemId) || (reviewKind === 'adjustment' && delta === 0)} size="md">
      <div className={styles.stack}><Tabs label="批改动作" value={reviewKind} onChange={value => setReviewKind(value)} items={[{ value: 'feedback', label: '反馈' }, { value: 'correction', label: '布置订正' }, { value: 'adjustment', label: '人工调分' }]} /><FormField label={reviewKind === 'correction' ? '题目' : '关联题目（可选）'} required={reviewKind === 'correction'}><Select value={reviewProblemId} onChange={event => setReviewProblemId(event.target.value)}><option value="">{reviewKind === 'correction' ? '请选择题目' : '整份作业'}</option>{assignment.Problems.map(problem => <option value={problem.id} key={problem.id}>{problem.Problem.problemId} · {problem.Problem.title}</option>)}</Select></FormField>{reviewKind === 'adjustment' && <FormField label="调分值" required hint="负数表示扣分，冲正由独立流水完成"><Input type="number" min={-1000} max={1000} value={delta} onChange={event => setDelta(Number(event.target.value))} /></FormField>}<FormField label={reviewKind === 'feedback' ? '反馈内容' : '原因'} required><Textarea rows={5} value={reviewContent} onChange={event => setReviewContent(event.target.value)} /></FormField></div>
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
        {canManage && assignment.status === 'DRAFT' ? <DraftEditor assignment={assignment} onChange={setLocal} /> : canManage ? <ManagerWorkspace assignment={assignment} onChange={setLocal} /> : resource.data ? <StudentWorkspace assignment={assignment} workspace={resource.data} onSubmitted={() => void resource.retry()} /> : null}
      </div>}
    </AsyncRegion>
    <ConfirmDialog isOpen={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={() => void cancel()} loading={cancelling} danger title="取消这份作业？" message="取消后将立即停止提交，题目版本、名单、历史提交和评测事实仍会保留。此状态不可撤销。" confirmText="确认取消" />
  </PageFrame>
}
