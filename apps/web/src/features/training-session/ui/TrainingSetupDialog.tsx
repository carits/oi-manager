'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Send, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/features/auth'
import { StudentPicker } from '@/features/organization-account'
import { QuickProblemInput, type SelectedCanonicalProblem } from '@/features/problem-selection'
import {
  createTrainingSession,
  listTrainingTemplates,
  previewTrainingParticipants,
  publishTraining,
} from '../api/trainingSessionApi'
import styles from './TrainingEngine.module.css'

type ParticipantTarget = 'team' | 'organization_students' | 'custom_students'
type TrainingPreset = 'practice' | 'oi_exam' | 'acm_exam'
type ExamResultVisibility = 'LIVE' | 'AFTER_END' | 'TEACHER_PUBLISHED'
type SubmitAction = 'publish' | 'classroom'

type TrainingTemplateOption = { key: string; name: string; description: string; source: "builtin" | "personal" | "organization" | "team"; problemCount?: number; stages: Array<{ name: string }> }

type Problem = {
  id: string
  platform: string
  problemId: string
  title: string
  difficulty?: string | null
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
  const [scheduledStartAt, setScheduledStartAt] = useState(() => localDateTime(new Date()))
  const [dueAt, setDueAt] = useState(() => localDateTime(new Date(Date.now() + 7 * 24 * 3600_000)))
  const [selectedTeamId, setSelectedTeamId] = useState(fixedTeamId || teams[0]?.id || '')
  const [participantTarget, setParticipantTarget] = useState<ParticipantTarget>('team')
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [selectedProblems, setSelectedProblems] = useState<Problem[]>([])
  const [preset, setPreset] = useState<TrainingPreset>('practice')
  const [templates, setTemplates] = useState<TrainingTemplateOption[]>([])
  const [templateKey, setTemplateKey] = useState('')
  const [examDurationMinutes, setExamDurationMinutes] = useState(120)
  const [examResultVisibility, setExamResultVisibility] = useState<ExamResultVisibility>('AFTER_END')
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
  const selectedTemplate = templates.find(template => template.key === templateKey)
  const effectiveProblemCount = templateKey ? selectedTemplate?.problemCount || 0 : selectedProblems.length
  const requiredProblemCount = templateKey
    ? effectiveProblemCount
    : selectedProblems.filter(problem => problem.required).length
  const optionalProblemCount = templateKey ? 0 : effectiveProblemCount - requiredProblemCount
  const readyToCreate = Boolean(
    title.trim()
    && dueAt
    && (selectedProblems.length || templateKey)
    && requiredProblemCount > 0
    && scopeReady
    && participantPreview?.participantCount
    && (participantTarget !== 'organization_students' || schoolWideConfirmed),
  )

  const reset = () => {
    setTitle('')
    setDescription('')
    setScheduledStartAt(localDateTime(new Date()))
    setDueAt(localDateTime(new Date(Date.now() + 7 * 24 * 3600_000)))
    setSelectedTeamId(fixedTeamId || teams[0]?.id || '')
    setParticipantTarget('team')
    setSelectedStudentIds([])
    setSelectedProblems([])
    setPreset('practice')
    setTemplateKey('')
    setExamDurationMinutes(120)
    setExamResultVisibility('AFTER_END')
    setParticipantPreview(null)
    setSchoolWideConfirmed(false)
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
    if (!isOpen) return
    let cancelled = false
    void listTrainingTemplates(useTeamScope ? { teamId: targetTeamId || undefined } : { organizationId }).then(result => {
      if (!cancelled) setTemplates(result as TrainingTemplateOption[])
    }).catch(() => { if (!cancelled) setTemplates([]) })
    return () => { cancelled = true }
  }, [isOpen, organizationId, targetTeamId, useTeamScope])

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
        if (!response.ok) toast.error(response.error.message || '无法确认训练对象')
      })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [isOpen, organizationId, participantTarget, scopeReady, selectedStudentIds, targetTeamId, toast, useTeamScope])

  const create = async (action: SubmitAction) => {
    if (!readyToCreate || submitting) return
    setSubmitting(action)
    const exam = preset !== 'practice'
    const response = await createTrainingSession({
      title: title.trim(),
      description: description.trim(),
      templateKey: templateKey || undefined,
      organizationId: useTeamScope ? undefined : organizationId,
      teamId: useTeamScope ? targetTeamId : undefined,
      participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined,
      scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : null,
      sessionType: preset === 'oi_exam' ? 'OI' : preset === 'acm_exam' ? 'ACM' : 'GENERAL',
      rankingMode: preset === 'acm_exam' ? 'ACM_RANKING' : preset === 'oi_exam' ? 'OFF' : 'PROGRESS_ONLY',
      peerVisibility: exam ? 'NONE' : 'PROGRESS',
      joinMode: exam ? 'TEACHER_ASSIGN' : 'CURRENT_STAGE',
      allowHints: !exam,
      settings: {
        dueAt: new Date(dueAt).toISOString(),
        completionMode: 'all',
        requiredProblemCount,
        participantTarget,
        preset,
        resultVisibility: exam ? examResultVisibility : 'LIVE',
      },
      stages: templateKey ? undefined : [{
        name: exam ? (preset === 'oi_exam' ? 'OI 模拟测试' : 'ACM 模拟测试') : '训练任务',
        kind: 'TRAINING',
        mode: exam ? 'EXAM' : 'PRACTICE',
        accessPolicy: 'ALL_AT_ONCE',
        submissionMode: 'ENABLED',
        endPolicy: exam ? 'TIME' : 'MANUAL',
        plannedDurationSeconds: exam ? Math.max(10, examDurationMinutes) * 60 : null,
        minDurationSeconds: null,
        completionThreshold: null,
        problems: selectedProblems.map(problem => ({ problemId: problem.id, allowedSubtaskIds: [], required: problem.required })),
      }],
    })
    if (!response.ok || !response.data) {
      setSubmitting(undefined)
      toast.error(response.ok ? '布置训练失败' : response.error.message)
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
      toast.error(`训练草稿已保存，但暂时无法发布：${published.error.message || '请继续完善'}`)
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

  const audienceText = participantTarget === 'team'
    ? selectedTeamName
    : participantTarget === 'custom_students'
      ? `已选择 ${selectedStudentIds.length} 名学生`
      : '全校有效学生'
  const summaryItems = useMemo(() => [
    ['训练类型', preset === 'oi_exam' ? 'OI 模拟测试' : preset === 'acm_exam' ? 'ACM 模拟测试' : '日常训练'],
    ['训练对象', previewLoading ? '正在确认…' : participantPreview ? `${participantPreview.targetName} · ${participantPreview.participantCount} 人` : audienceText],
    ['训练题目', templateKey ? selectedTemplate ? selectedTemplate.name + ' · ' + (selectedTemplate.problemCount || 0) + ' 道固定题目' : '模板加载中' : selectedProblems.length ? selectedProblems.length + ' 道' : '尚未添加'],
    ['完成要求', optionalProblemCount ? `${requiredProblemCount} 道必做 · ${optionalProblemCount} 道选做` : `${requiredProblemCount} 道题全部必做`],
    ...(preset === 'practice' ? [] : [['成绩公布', examResultVisibility === 'LIVE' ? '提交后立即可见' : examResultVisibility === 'AFTER_END' ? '测试结束后可见' : '由教师手动公布']]),
    ['截止时间', dueAt ? new Date(dueAt).toLocaleString('zh-CN') : '未设置'],
  ], [audienceText, dueAt, examResultVisibility, optionalProblemCount, participantPreview, preset, previewLoading, requiredProblemCount, selectedProblems.length, selectedTemplate, templateKey])

  return <FormDialog
    isOpen={isOpen}
    onClose={close}
    title="布置训练"
    description="把一组题目布置给学生；需要多阶段或分层流程时，再转为课堂训练。"
    size="wide"
    loading={Boolean(submitting)}
    dirty={Boolean(title || selectedProblems.length)}
    footer={<>
      <Button variant="secondary" onClick={close} disabled={Boolean(submitting)}>取消</Button>
      <Button variant="outline" icon={<ArrowRight size={16} />} onClick={() => void create('classroom')} loading={submitting === 'classroom'} disabled={!readyToCreate || Boolean(submitting)}>转为课堂训练</Button>
      <Button icon={<Send size={16} />} onClick={() => void create('publish')} loading={submitting === 'publish'} disabled={!readyToCreate || Boolean(submitting) || (Boolean(templateKey) && !effectiveProblemCount)}>发布训练</Button>
    </>}
  >
    <div className={styles.trainingSetupLayout}>
      <div className={styles.trainingSetupMain}>
        <section className={styles.setupSection} aria-labelledby="training-setup-basic">
          <div><h3 id="training-setup-basic">基本信息</h3><p>给学生一个清楚、容易识别的训练名称。</p></div>
          <div className={styles.stack}>
            <label className={styles.field}>训练模板（可选）<Select value={templateKey} disabled={preset !== 'practice'} onChange={event => { setTemplateKey(event.target.value); if (event.target.value) setSelectedProblems([]) }}><option value="">空白开始</option>{templates.map(template => <option key={template.key} value={template.key}>{template.name}{template.problemCount ? ' · ' + template.problemCount + ' 题' : ' · 结构骨架'}</option>)}</Select><small>{preset !== 'practice' ? '模拟测试使用固定考试预设，不叠加日常训练模板。' : selectedTemplate?.description || '教师保存的模板会连同阶段、分组方案、题目规则与提示载入。'}</small></label>
            <label className={styles.field}>使用场景<Select value={preset} onChange={event => { const nextPreset = event.target.value as TrainingPreset; setPreset(nextPreset); if (nextPreset !== 'practice') { setTemplateKey(''); setSelectedProblems(current => current.map(problem => ({ ...problem, required: true }))) } }}><option value="practice">日常训练</option><option value="oi_exam">OI 模拟测试</option><option value="acm_exam">ACM 模拟测试</option></Select><small>{preset === 'practice' ? '开放提示与同伴进度，适合日常练习。' : '关闭提示与同伴进度，按时长自动结束；成绩按所选公布规则展示。'}</small></label>
            {preset !== 'practice' && <>
              <label className={styles.field}>测试时长（分钟）<Input type="number" min={10} max={1440} value={examDurationMinutes} onChange={event => setExamDurationMinutes(Math.max(10, Number(event.target.value) || 10))} /></label>
              <label className={styles.field}>成绩公布<Select value={examResultVisibility} onChange={event => setExamResultVisibility(event.target.value as ExamResultVisibility)}><option value="LIVE">提交后立即可见</option><option value="AFTER_END">测试结束后可见</option><option value="TEACHER_PUBLISHED">由教师手动公布</option></Select><small>未公布前，学生看不到分数、提交统计、完成情况或训练报告。</small></label>
            </>}
            <label className={styles.field}>训练名称<Input autoFocus value={title} maxLength={200} placeholder="例如：图论专项训练" onChange={event => setTitle(event.target.value)} /></label>
            <label className={styles.field}>训练说明（可选）<Textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label>
          </div>
        </section>

        <section className={styles.setupSection} aria-labelledby="training-setup-audience">
          <div><h3 id="training-setup-audience">训练对象</h3><p>选择本次需要完成训练的学生范围。</p></div>
          <div className={styles.stack}>
            {organizationId && <label className={styles.field}>训练范围<Select value={participantTarget} onChange={event => { setParticipantTarget(event.target.value as ParticipantTarget); setSchoolWideConfirmed(false) }}><option value="team">团队（推荐）</option><option value="custom_students">自定义学生</option>{user?.organizationRole === 'school_principal' && <option value="organization_students">全校学生</option>}</Select></label>}
            {(!organizationId && !fixedTeamId || organizationId && participantTarget === 'team') && <label className={styles.field}>学员团队<Select value={selectedTeamId} onChange={event => setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}
            {organizationId && participantTarget === 'custom_students' && <StudentPicker organizationId={organizationId} teams={teams} selectedIds={selectedStudentIds} onChange={setSelectedStudentIds} />}
            {organizationId && participantTarget === 'organization_students' && <div className={styles.message}><strong>全校学生</strong><p>仅包含当前学校的有效学生，不会加入教师或负责人。</p>{participantPreview && <Checkbox label={`我确认向全校 ${participantPreview.participantCount} 名学生发布`} checked={schoolWideConfirmed} onChange={event => setSchoolWideConfirmed(event.target.checked)} />}</div>}
            <p className={styles.muted} role="status">{previewLoading ? '正在确认训练对象…' : participantPreview ? `${participantPreview.targetName} · ${participantPreview.participantCount} 人` : scopeReady ? '暂时无法确认训练对象' : '请选择训练对象'}</p>
          </div>
        </section>

        {!templateKey && <section className={styles.setupSection} aria-labelledby="training-setup-problems">
          <div><h3 id="training-setup-problems">训练题目</h3><p>按题号添加题库中已存在的题目。</p></div>
          <div className={styles.stack}>
            <QuickProblemInput
              existingProblemIds={selectedProblems.map(item => item.id)}
              onResolved={(problems: SelectedCanonicalProblem[]) => setSelectedProblems(current => [
                ...current,
                ...problems.map(problem => ({
                  id: problem.id,
                  platform: problem.platform,
                  problemId: problem.problemCode,
                  title: problem.title,
                  difficulty: problem.difficulty,
                  required: true,
                })),
              ])}
            />
            {selectedProblems.length > 0 && <div className={styles.setupProblemList} aria-label="已选训练题目">{selectedProblems.map((problem, index) => <div className={styles.setupProblemRow} key={problem.id}>
              <span className={styles.problemOrder}>{index + 1}</span>
              <div><strong>{problem.platform} {problem.problemId}</strong><span>{problem.title}</span></div>
              {preset === 'practice' && <Checkbox label={problem.required ? '必做' : '选做'} checked={problem.required} onChange={event => setSelectedProblems(current => current.map(item => item.id === problem.id ? { ...item, required: event.target.checked } : item))} />}
              {preset !== 'practice' && <StatusBadge variant="neutral">必做</StatusBadge>}
              <Button size="sm" variant="ghost" aria-label={`移除 ${problem.problemId}`} title={`移除 ${problem.problemId}`} icon={<X size={15} />} onClick={() => setSelectedProblems(current => current.filter(item => item.id !== problem.id))} />
            </div>)}</div>}
          </div>
        </section>}

        <section className={styles.setupSection} aria-labelledby="training-setup-rules">
          <div><h3 id="training-setup-rules">完成要求与时间</h3><p>学生需要完成全部必做题；选做题不影响完成状态。</p></div>
          <div className={styles.stack}>
            {!templateKey && requiredProblemCount === 0 && selectedProblems.length > 0 && <p className={styles.rosterWarning} role="alert">至少保留一道必做题，才能发布训练。</p>}
            <div className={styles.compactGrid}>
              <label className={styles.field}>开始时间<Input type="datetime-local" value={scheduledStartAt} onChange={event => setScheduledStartAt(event.target.value)} /></label>
              <label className={styles.field}>截止时间<Input type="datetime-local" value={dueAt} min={scheduledStartAt || undefined} onChange={event => setDueAt(event.target.value)} /></label>
            </div>
          </div>
        </section>
      </div>

      <aside className={styles.trainingSetupSummary} aria-label="发布摘要">
        <div><strong>发布摘要</strong><p>确认后会按所选场景直接发布。</p></div>
        <dl>{summaryItems.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className={styles.message}>
          <strong>需要更复杂的课堂流程？</strong>
          <p>转为课堂训练后，可继续添加阶段、分组和提示，当前内容不会丢失。</p>
        </div>
      </aside>
    </div>
  </FormDialog>
}
