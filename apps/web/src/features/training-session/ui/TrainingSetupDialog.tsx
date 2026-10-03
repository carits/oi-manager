'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/features/auth'
import { StudentPicker } from '@/features/organization-account'
import { ProblemListEditor, type SelectedProblemReference } from '@/features/problem-selection'
import {
  createTrainingSession,
  previewTrainingParticipants,
  publishTraining,
} from '../api/trainingSessionApi'
import styles from './TrainingEngine.module.css'

type ParticipantTarget = 'team' | 'organization_students' | 'custom_students'
type SubmitAction = 'publish' | 'classroom'

type Problem = {
  id: string
  platform: string
  problemId: string
  title: string
  difficulty?: string | null
  alias?: string | null
  required: boolean
}

export type TrainingSetupTeam = {
  id: string
  name: string
}

type Props = {
  isOpen: boolean
  organizationId?: string
  fixedTeamId?: string
  teams: TrainingSetupTeam[]
  onClose: () => void
  onPublished: () => void | Promise<void>
}

const localDateTime = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

const defaultTrainingTimes = () => ({
  start: localDateTime(new Date()),
  due: localDateTime(new Date(Date.now() + 7 * 24 * 3600_000)),
})

export function TrainingSetupDialog({
  isOpen,
  organizationId,
  fixedTeamId,
  teams,
  onClose,
  onPublished,
}: Props) {
  const router = useRouter()
  const toast = useToast()
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [baselineTimes, setBaselineTimes] = useState(defaultTrainingTimes)
  const [scheduledStartAt, setScheduledStartAt] = useState(baselineTimes.start)
  const [dueAt, setDueAt] = useState(baselineTimes.due)
  const [selectedTeamId, setSelectedTeamId] = useState(fixedTeamId || teams[0]?.id || '')
  const [participantTarget, setParticipantTarget] = useState<ParticipantTarget>('team')
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [selectedProblems, setSelectedProblems] = useState<Problem[]>([])
  const [problemEditorBlocked, setProblemEditorBlocked] = useState(false)
  const [participantPreview, setParticipantPreview] = useState<{ participantCount: number; targetName: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [schoolWideConfirmed, setSchoolWideConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState<SubmitAction>()

  const targetTeamId = fixedTeamId || selectedTeamId
  const useTeamScope = !organizationId || participantTarget === 'team'
  const scopeReady = useTeamScope
    ? Boolean(targetTeamId)
    : participantTarget === 'custom_students'
      ? selectedStudentIds.length > 0
      : user?.organizationRole === 'school_principal'
  const selectedTeamName = teams.find(team => team.id === targetTeamId)?.name || '当前团队'
  const requiredProblemCount = selectedProblems.filter(problem => problem.required).length
  const optionalProblemCount = selectedProblems.length - requiredProblemCount
  const timeRangeValid = Boolean(scheduledStartAt && dueAt && new Date(dueAt).getTime() > new Date(scheduledStartAt).getTime())
  const canContinueClassroomSetup = Boolean(title.trim() && scopeReady)
  const canPublishDirectly = Boolean(
    canContinueClassroomSetup
    && timeRangeValid
    && selectedProblems.length
    && !problemEditorBlocked
    && requiredProblemCount > 0
    && participantPreview?.participantCount
    && (participantTarget !== 'organization_students' || schoolWideConfirmed),
  )

  const reset = () => {
    setTitle('')
    setDescription('')
    const times = defaultTrainingTimes()
    setBaselineTimes(times)
    setScheduledStartAt(times.start)
    setDueAt(times.due)
    setSelectedTeamId(fixedTeamId || teams[0]?.id || '')
    setParticipantTarget('team')
    setSelectedStudentIds([])
    setSelectedProblems([])
    setProblemEditorBlocked(false)
    setParticipantPreview(null)
    setSchoolWideConfirmed(false)
    setSubmitting(undefined)
  }

  const close = () => {
    if (submitting) return
    reset()
    onClose()
  }

  useEffect(() => {
    if (!fixedTeamId && !selectedTeamId && teams[0]?.id) setSelectedTeamId(teams[0].id)
  }, [fixedTeamId, selectedTeamId, teams])

  useEffect(() => {
    if (!isOpen || !scopeReady) {
      setParticipantPreview(null)
      setPreviewLoading(false)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    const timer = window.setTimeout(() => {
      const payload = {
        organizationId: useTeamScope ? undefined : organizationId,
        teamId: useTeamScope ? targetTeamId : undefined,
        participantTarget,
        participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined,
      }
      void previewTrainingParticipants(payload).then(response => {
        if (cancelled) return
        setParticipantPreview(response.ok ? response.data : null)
        setPreviewLoading(false)
        if (!response.ok) toast.error(response.error.userMessage || '无法确认训练对象')
      })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [isOpen, organizationId, participantTarget, scopeReady, selectedStudentIds, targetTeamId, toast, useTeamScope])

  const create = async (action: SubmitAction) => {
    const allowed = action === 'classroom' ? canContinueClassroomSetup : canPublishDirectly
    if (!allowed || submitting) return
    setSubmitting(action)
    const response = await createTrainingSession({
      title: title.trim(),
      description: description.trim(),
      organizationId: useTeamScope ? undefined : organizationId,
      teamId: useTeamScope ? targetTeamId : undefined,
      participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined,
      scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : null,
      sessionType: 'GENERAL',
      rankingMode: 'PROGRESS_ONLY',
      peerVisibility: 'PROGRESS',
      joinMode: 'CURRENT_STAGE',
      allowHints: true,
      settings: {
        dueAt: new Date(dueAt).toISOString(),
        completionMode: 'all',
        requiredProblemCount,
        participantTarget,
        resultVisibility: 'LIVE',
      },
      stages: [{
        name: '训练任务',
        kind: 'TRAINING',
        mode: 'PRACTICE',
        accessPolicy: 'ALL_AT_ONCE',
        submissionMode: 'ENABLED',
        endPolicy: 'MANUAL',
        plannedDurationSeconds: null,
        minDurationSeconds: null,
        completionThreshold: null,
        problems: selectedProblems.map(problem => ({ problemId: problem.id, alias: problem.alias || null, allowedSubtaskIds: [], required: problem.required })),
      }],
    })
    if (!response.ok || !response.data) {
      setSubmitting(undefined)
      toast.error(response.ok ? '布置训练失败' : response.error.userMessage)
      return
    }
    const designPath = `${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${response.data.id}/design`
    if (action === 'classroom') {
      toast.success('已保留当前内容，继续编排课堂流程')
      reset()
      onClose()
      router.push(designPath)
      return
    }
    const published = await publishTraining(response.data.id, {
      expectedRevision: response.data.statusRevision ?? 0,
    })
    setSubmitting(undefined)
    if (!published.ok) {
      toast.error(`训练草稿已保存，但暂时无法发布：${published.error.userMessage || '请继续完善'}`)
      reset()
      onClose()
      router.push(designPath)
      return
    }
    toast.success('训练已发布')
    reset()
    onClose()
    await onPublished()
  }

  const replaceSelectedProblems = (references: SelectedProblemReference[]) => {
    setSelectedProblems(current => {
      const requiredById = new Map(current.map(problem => [problem.id, problem.required]))
      return references.map(({ problem, alias }) => ({
        id: problem.id,
        platform: problem.platform,
        problemId: problem.problemId,
        title: problem.title,
        difficulty: problem.difficulty,
        alias: alias || null,
        required: requiredById.get(problem.id) ?? true,
      }))
    })
    return { acceptedIds: references.map(reference => reference.problem.id) }
  }

  const audienceText = participantTarget === 'team'
    ? selectedTeamName
    : participantTarget === 'custom_students'
      ? `已选择 ${selectedStudentIds.length} 名学生`
      : '全校有效学生'
  const summaryItems = useMemo(() => [
    ['训练对象', previewLoading ? '正在确认…' : participantPreview ? `${participantPreview.targetName} · ${participantPreview.participantCount} 人` : audienceText],
    ['训练题目', selectedProblems.length ? selectedProblems.length + ' 道' : '尚未添加'],
    ['完成要求', optionalProblemCount ? `${requiredProblemCount} 道必做 · ${optionalProblemCount} 道选做` : `${requiredProblemCount} 道题全部必做`],
    ['截止时间', dueAt ? new Date(dueAt).toLocaleString('zh-CN') : '未设置'],
  ], [audienceText, dueAt, optionalProblemCount, participantPreview, previewLoading, requiredProblemCount, selectedProblems.length])

  return <FormDialog
    isOpen={isOpen}
    onClose={close}
    title="布置训练"
    description="把一组题目布置给学生；课堂阶段会在运行中根据反馈逐步安排。"
    size="wide"
    loading={Boolean(submitting)}
    dirty={Boolean(title || description || selectedProblems.length || selectedStudentIds.length || selectedTeamId !== (fixedTeamId || teams[0]?.id || '') || participantTarget !== 'team' || schoolWideConfirmed || scheduledStartAt !== baselineTimes.start || dueAt !== baselineTimes.due)}
    footer={<>
      <Button variant="secondary" onClick={close} disabled={Boolean(submitting)}>取消</Button>
      <Button variant="outline" icon={<ArrowRight size={16} />} onClick={() => void create('classroom')} loading={submitting === 'classroom'} disabled={!canContinueClassroomSetup || Boolean(submitting)}>继续课堂设置</Button>
      <Button icon={<Send size={16} />} onClick={() => void create('publish')} loading={submitting === 'publish'} disabled={!canPublishDirectly || Boolean(submitting)}>发布训练</Button>
    </>}
  >
    <div className={styles.trainingSetupLayout}>
      <div className={styles.trainingSetupMain}>
        <section className={styles.setupSection} aria-labelledby="training-setup-basic">
          <div><h3 id="training-setup-basic">基本信息</h3><p>给学生一个清楚、容易识别的训练名称。</p></div>
          <div className={styles.stack}>
            <label className={styles.field}>训练名称<Input autoFocus value={title} maxLength={200} placeholder="例如：图论专项训练" onChange={event => setTitle(event.target.value)} /></label>
            <label className={styles.field}>训练说明（可选）<Textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label>
          </div>
        </section>

        <section className={styles.setupSection} aria-labelledby="training-setup-audience">
          <div><h3 id="training-setup-audience">训练对象</h3><p>选择本次需要完成训练的学生范围。</p></div>
          <div className={styles.stack}>
            <div className={styles.compactGrid}>
              {organizationId && <label className={styles.field}>训练范围<Select value={participantTarget} onChange={event => { setParticipantTarget(event.target.value as ParticipantTarget); setSchoolWideConfirmed(false) }}><option value="team">团队（推荐）</option><option value="custom_students">自定义学生</option>{user?.organizationRole === 'school_principal' && <option value="organization_students">全校学生</option>}</Select></label>}
              {(!organizationId && !fixedTeamId || organizationId && participantTarget === 'team') && <label className={styles.field}>学员团队<Select value={selectedTeamId} onChange={event => setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}
            </div>
            {organizationId && participantTarget === 'custom_students' && <StudentPicker organizationId={organizationId} teams={teams} selectedIds={selectedStudentIds} onChange={setSelectedStudentIds} />}
            {organizationId && participantTarget === 'organization_students' && <div className={styles.message}><strong>全校学生</strong><p>仅包含当前学校的有效学生，不会加入教师或负责人。</p>{participantPreview && <Checkbox label={`我确认向全校 ${participantPreview.participantCount} 名学生发布`} checked={schoolWideConfirmed} onChange={event => setSchoolWideConfirmed(event.target.checked)} />}</div>}
            <p className={styles.muted} role="status">{previewLoading ? '正在确认训练对象…' : participantPreview ? `${participantPreview.targetName} · ${participantPreview.participantCount} 人` : scopeReady ? '暂时无法确认训练对象' : '请选择训练对象'}</p>
          </div>
        </section>

        <section className={`${styles.setupSection} ${styles.problemSetupSection}`} aria-labelledby="training-setup-problems">
          <div><h3 id="training-setup-problems">训练题目</h3><p>这里选择的题目会成为第一个阶段；后续阶段根据课堂反馈逐步准备。</p></div>
          <div className={styles.stack}>
            <ProblemListEditor
              references={selectedProblems.map(problem => ({
                problem: {
                  id: problem.id,
                  platform: problem.platform,
                  problemId: problem.problemId,
                  title: problem.title,
                  difficulty: problem.difficulty,
                },
                alias: problem.alias || undefined,
              }))}
              onReplace={replaceSelectedProblems}
              aliasLabel="别名"
              dataRequirement="training"
              onBlockingChange={setProblemEditorBlocked}
              renderTrailing={(reference) => {
                const current = selectedProblems.find(problem => problem.id === reference.problem.id)
                if (!current) return null
                return <Checkbox label={current.required ? '必做' : '选做'} checked={current.required} onChange={event => setSelectedProblems(items => items.map(item => item.id === current.id ? { ...item, required: event.target.checked } : item))} />
              }}
            />
          </div>
        </section>

        <section className={styles.setupSection} aria-labelledby="training-setup-rules">
          <div><h3 id="training-setup-rules">完成要求与时间</h3><p>学生需要完成全部必做题；选做题不影响完成状态。</p></div>
          <div className={styles.stack}>
            {requiredProblemCount === 0 && selectedProblems.length > 0 && <p className={styles.rosterWarning} role="alert">至少保留一道必做题，才能直接发布训练。</p>}
            {!timeRangeValid && <p className={styles.rosterWarning} role="alert">截止时间必须晚于开始时间。</p>}
            <div className={styles.compactGrid}>
              <label className={styles.field}>开始时间<Input type="datetime-local" value={scheduledStartAt} onChange={event => setScheduledStartAt(event.target.value)} /></label>
              <label className={styles.field}>截止时间<Input type="datetime-local" value={dueAt} min={scheduledStartAt || undefined} onChange={event => setDueAt(event.target.value)} /></label>
            </div>
          </div>
        </section>
      </div>

      <aside className={styles.trainingSetupSummary} aria-label="当前设置">
        <div><strong>当前设置</strong><p>可直接发布，也可继续设置课堂阶段。</p></div>
        <dl>{summaryItems.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className={styles.message}>
          <strong>课堂阶段按反馈逐步安排</strong>
          <p>继续课堂设置后，当前题目会作为第一个阶段；下一阶段在课堂运行时按学员情况准备。</p>
        </div>
      </aside>
    </div>
  </FormDialog>
}
