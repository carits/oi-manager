'use client'

import { useEffect, useMemo, useState } from 'react'
import { Play, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/features/auth'
import { StudentPicker } from '@/features/organization-account'
import { ProblemListEditor, type SelectedProblemReference } from '@/features/problem-selection'
import { createTrainingSession, previewTrainingParticipants } from '../api/trainingSessionApi'
import styles from './TrainingEngine.module.css'

type ParticipantTarget = 'team' | 'organization_students' | 'custom_students'
type SubmitAction = 'ready' | 'start'
type SessionType = 'GENERAL' | 'OI' | 'ACM'

type Problem = {
  id: string
  platform: string
  problemId: string
  title: string
  difficulty?: string | null
  alias?: string | null
}

export type TrainingSetupTeam = { id: string; name: string }

type Props = {
  isOpen: boolean
  organizationId?: string
  fixedTeamId?: string
  teams: TrainingSetupTeam[]
  onClose: () => void
  onPublished: () => void | Promise<void>
}

export function TrainingSetupDialog({ isOpen, organizationId, fixedTeamId, teams, onClose, onPublished }: Props) {
  const router = useRouter()
  const toast = useToast()
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [sessionType, setSessionType] = useState<SessionType>('GENERAL')
  const [durationMinutes, setDurationMinutes] = useState(120)
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
  const canCreate = Boolean(
    title.trim()
    && scopeReady
    && selectedProblems.length
    && !problemEditorBlocked
    && participantPreview?.participantCount
    && durationMinutes >= 5
    && (participantTarget !== 'organization_students' || schoolWideConfirmed),
  )

  const reset = () => {
    setTitle('')
    setDescription('')
    setSessionType('GENERAL')
    setDurationMinutes(120)
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
      void previewTrainingParticipants({
        organizationId: useTeamScope ? undefined : organizationId,
        teamId: useTeamScope ? targetTeamId : undefined,
        participantTarget,
        participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined,
      }).then(response => {
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
    if (!canCreate || submitting) return
    setSubmitting(action)
    const response = await createTrainingSession({
      title: title.trim(),
      description: description.trim() || null,
      organizationId: useTeamScope ? undefined : organizationId,
      teamId: useTeamScope ? targetTeamId : undefined,
      participantTarget,
      participantUserIds: participantTarget === 'custom_students' ? selectedStudentIds : undefined,
      scheduledStartAt: null,
      sessionType,
      totalDurationSeconds: durationMinutes * 60,
      startImmediately: action === 'start',
      problems: selectedProblems.map(problem => ({ problemId: problem.id, alias: problem.alias || null })),
    })
    setSubmitting(undefined)
    if (!response.ok) {
      toast.error(response.error.userMessage || '创建训练失败')
      return
    }
    const sessionPath = `${organizationId ? `/org/${organizationId}` : '/personal'}/training-sessions/${response.data.id}`
    toast.success(action === 'start' ? '训练已创建并开始' : '训练已创建，等待开始')
    reset()
    onClose()
    await onPublished()
    router.push(sessionPath)
  }

  const replaceSelectedProblems = (references: SelectedProblemReference[]) => {
    setSelectedProblems(references.map(({ problem, alias }) => ({
      id: problem.id,
      platform: problem.platform,
      problemId: problem.problemId,
      title: problem.title,
      difficulty: problem.difficulty,
      alias: alias || null,
    })))
    return { acceptedIds: references.map(reference => reference.problem.id) }
  }

  const targetTeamName = teams.find(team => team.id === targetTeamId)?.name || '当前团队'
  const audienceText = participantTarget === 'team'
    ? targetTeamName
    : participantTarget === 'custom_students'
      ? `已选择 ${selectedStudentIds.length} 名学生`
      : '全校有效学生'
  const summaryItems = useMemo(() => [
    ['训练对象', previewLoading ? '正在确认…' : participantPreview ? `${participantPreview.targetName} · ${participantPreview.participantCount} 人` : audienceText],
    ['赛制', sessionType === 'GENERAL' ? '普通训练' : sessionType],
    ['训练题目', selectedProblems.length ? `${selectedProblems.length} 道` : '尚未添加'],
    ['总时间', `${durationMinutes} 分钟`],
  ], [audienceText, durationMinutes, participantPreview, previewLoading, selectedProblems.length, sessionType])

  return <FormDialog
    isOpen={isOpen}
    onClose={close}
    title="创建训练"
    description="设置学生、赛制、总时间和第一轮题目。"
    size="wide"
    loading={Boolean(submitting)}
    dirty={Boolean(title || description || selectedProblems.length || selectedStudentIds.length || sessionType !== 'GENERAL' || durationMinutes !== 120)}
    footer={<>
      <Button variant="secondary" onClick={close} disabled={Boolean(submitting)}>取消</Button>
      <Button variant="outline" icon={<Plus size={16} />} onClick={() => void create('ready')} loading={submitting === 'ready'} disabled={!canCreate || Boolean(submitting)}>创建</Button>
      <Button icon={<Play size={16} />} onClick={() => void create('start')} loading={submitting === 'start'} disabled={!canCreate || Boolean(submitting)}>创建并开始</Button>
    </>}
  >
    <div className={styles.trainingSetupLayout}>
      <div className={styles.trainingSetupMain}>
        <section className={styles.setupSection}>
          <div><h3>基本信息</h3><p>名称和说明会显示给参加训练的学生。</p></div>
          <div className={styles.stack}>
            <label className={styles.field}>训练名称<Input autoFocus value={title} maxLength={200} placeholder="例如：图论专项训练" onChange={event => setTitle(event.target.value)} /></label>
            <label className={styles.field}>训练说明（可选）<Textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label>
          </div>
        </section>

        <section className={styles.setupSection}>
          <div><h3>参加学生</h3><p>选择本次一起训练的学生。</p></div>
          <div className={styles.stack}>
            <div className={styles.compactGrid}>
              {organizationId && <label className={styles.field}>训练范围<Select value={participantTarget} onChange={event => { setParticipantTarget(event.target.value as ParticipantTarget); setSchoolWideConfirmed(false) }}><option value="team">团队</option><option value="custom_students">自定义学生</option>{user?.organizationRole === 'school_principal' && <option value="organization_students">全校学生</option>}</Select></label>}
              {(!organizationId && !fixedTeamId || organizationId && participantTarget === 'team') && <label className={styles.field}>学员团队<Select value={selectedTeamId} onChange={event => setSelectedTeamId(event.target.value)}><option value="">请选择可管理团队</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label>}
            </div>
            {organizationId && participantTarget === 'custom_students' && <StudentPicker organizationId={organizationId} teams={teams} selectedIds={selectedStudentIds} onChange={setSelectedStudentIds} />}
            {organizationId && participantTarget === 'organization_students' && participantPreview && <Checkbox label={`我确认向全校 ${participantPreview.participantCount} 名学生发布`} checked={schoolWideConfirmed} onChange={event => setSchoolWideConfirmed(event.target.checked)} />}
            <p className={styles.muted} role="status">{previewLoading ? '正在确认训练对象…' : participantPreview ? `${participantPreview.targetName} · ${participantPreview.participantCount} 人` : scopeReady ? '暂时无法确认训练对象' : '请选择训练对象'}</p>
          </div>
        </section>

        <section className={styles.setupSection}>
          <div><h3>赛制与时间</h3><p>三种赛制共享相同课堂流程，仅排名计算不同。</p></div>
          <div className={styles.compactGrid}>
            <label className={styles.field}>赛制<Select value={sessionType} onChange={event => setSessionType(event.target.value as SessionType)}><option value="GENERAL">普通训练</option><option value="OI">OI</option><option value="ACM">ACM</option></Select></label>
            <label className={styles.field}>训练总时间（分钟）<Input type="number" min={5} max={10080} value={durationMinutes} onChange={event => setDurationMinutes(Math.max(5, Math.min(10080, Number(event.target.value) || 120)))} /></label>
          </div>
        </section>

        <section className={`${styles.setupSection} ${styles.problemSetupSection}`}>
          <div><h3>第一轮题目</h3><p>题目加入训练后会形成稳定身份，后续移除再加入不会丢失提交与代码。</p></div>
          <ProblemListEditor
            references={selectedProblems.map(problem => ({ problem: { id: problem.id, platform: problem.platform, problemId: problem.problemId, title: problem.title, difficulty: problem.difficulty }, alias: problem.alias || undefined }))}
            onReplace={replaceSelectedProblems}
            aliasLabel="别名"
            dataRequirement="training"
            onBlockingChange={setProblemEditorBlocked}
          />
        </section>
      </div>

      <aside className={styles.trainingSetupSummary} aria-label="当前设置">
        <div><strong>本次训练</strong><p>创建后可直接开始，也可以稍后从课堂页开始。</p></div>
        <dl>{summaryItems.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </aside>
    </div>
  </FormDialog>
}
