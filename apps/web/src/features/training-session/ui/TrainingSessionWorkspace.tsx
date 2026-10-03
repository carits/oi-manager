'use client'

import type { TrainingCoachDashboard, TrainingWorkspace } from '@oi-manager/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, Focus, Layers3, Play, RefreshCw, Settings2, Users } from 'lucide-react'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select } from '@/components/ui/FormControls'
import { FormDialog, ConfirmDialog } from '@/components/ui/Dialogs'
import { StatusBadge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { publicErrorMessage } from '@/lib/humanErrors'
import { ProblemListEditor, ProblemReferenceLink, type SelectedProblemReference } from '@/features/problem-selection'
import { SubmissionCodeEditor, SubmissionIoFields, type SubmissionIoValue } from '@/features/submission'
import {
  advanceTrainingRound,
  changeTrainingGrouping,
  executeTrainingCommand,
  getTrainingCoachDashboard,
  getTrainingDraft,
  getTrainingPeerProgress,
  getTrainingWorkspace,
  putTrainingNextRound,
  replaceTrainingAssignments,
  saveTrainingDraft,
  sendTrainingHeartbeat,
  submitTrainingSolution,
  trainingEventStreamUrl,
} from '../api/trainingSessionApi'
import styles from './TrainingEngine.module.css'

type Dashboard = TrainingCoachDashboard
type Ranking = Awaited<ReturnType<typeof getTrainingPeerProgress>>
type SessionProblem = TrainingWorkspace['effectiveProblems'][number]
type CommandType = 'START_SESSION' | 'PAUSE_SESSION' | 'RESUME_SESSION' | 'EXTEND_SESSION' | 'EXTEND_ROUND' | 'FOCUS_PROBLEM' | 'END_FOCUS' | 'END_SESSION'

const statusText: Record<string, string> = {
  READY: '待开始',
  RUNNING: '进行中',
  PAUSED: '已暂停',
  ENDED: '已结束',
  ARCHIVED: '已归档',
}
const roundStatusText: Record<string, string> = { PENDING: '待开始', RUNNING: '进行中', ENDED: '已结束' }

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const remainder = value % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`
}

function RuntimeClock({ elapsed, runningSince, limit }: { elapsed: number; runningSince?: string | null; limit?: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!runningSince) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [runningSince])
  const live = elapsed + (runningSince ? Math.max(0, Math.floor((now - new Date(runningSince).getTime()) / 1000)) : 0)
  return <span>{limit ? `${formatDuration(Math.max(0, limit - live))} 剩余` : `${formatDuration(live)} 已进行`}</span>
}

function toReference(problem: SessionProblem): SelectedProblemReference {
  return {
    problem: {
      id: problem.Problem.id,
      platform: problem.Problem.platform,
      problemId: problem.Problem.problemId,
      title: problem.Problem.title,
      difficulty: problem.Problem.difficulty || undefined,
    },
    alias: problem.alias || undefined,
  }
}

function resultMessage(result: { ok: boolean; error?: { userMessage?: string } }, fallback: string) {
  return result.ok ? '' : result.error?.userMessage || fallback
}

export function TrainingSessionWorkspace({ sessionId }: { sessionId: string }) {
  const toast = useToast()
  const [data, setData] = useState<TrainingWorkspace>()
  const [dashboard, setDashboard] = useState<Dashboard>()
  const [ranking, setRanking] = useState<Ranking>()
  const [rankingGroupId, setRankingGroupId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('cpp17')
  const [draftRevision, setDraftRevision] = useState<number>()
  const [io, setIo] = useState<SubmissionIoValue>({ inputFilename: null, outputFilename: null })
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [assignmentGroupId, setAssignmentGroupId] = useState('')
  const [focusOpen, setFocusOpen] = useState(false)
  const [focusTargetType, setFocusTargetType] = useState<'ALL' | 'GROUP'>('ALL')
  const [focusGroupId, setFocusGroupId] = useState('')
  const [focusProblemId, setFocusProblemId] = useState('')
  const [groupOpen, setGroupOpen] = useState(false)
  const [movingParticipants, setMovingParticipants] = useState<string[]>([])
  const [movingTargetGroup, setMovingTargetGroup] = useState('')
  const [movingReason, setMovingReason] = useState('课堂分组调整')
  const [nextOpen, setNextOpen] = useState(false)
  const [nextName, setNextName] = useState('')
  const [nextMinutes, setNextMinutes] = useState(0)
  const [nextProblems, setNextProblems] = useState<Record<string, SelectedProblemReference[]>>({})
  const [extendOpen, setExtendOpen] = useState<'session' | 'round' | null>(null)
  const [extendMinutes, setExtendMinutes] = useState(10)
  const [endOpen, setEndOpen] = useState(false)

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setLoadError('')
    try {
      const workspace = await getTrainingWorkspace(sessionId)
      setData(workspace)
      setSelectedId(current => workspace.effectiveProblems.some(problem => problem.id === current)
        ? current
        : workspace.participant?.currentSessionProblemId || workspace.effectiveProblems[0]?.id || '')
      setAssignmentGroupId(current => current || workspace.participant?.currentGroupId || workspace.session.Groups[0]?.id || '')
      setMovingTargetGroup(current => current || workspace.session.Groups[0]?.id || '')
      const [coach, peers] = await Promise.allSettled([
        workspace.manager ? getTrainingCoachDashboard(sessionId) : Promise.resolve(undefined),
        getTrainingPeerProgress(sessionId, rankingGroupId && workspace.session.Groups.some(group => group.id === rankingGroupId) ? rankingGroupId : undefined),
      ])
      if (coach.status === 'fulfilled' && coach.value) setDashboard(coach.value)
      if (peers.status === 'fulfilled') {
        setRanking(peers.value)
        setRankingGroupId(peers.value.scope === 'group' ? peers.value.groupId || '' : '')
      }
    } catch (error) {
      setLoadError(publicErrorMessage(error, '训练加载失败'))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [rankingGroupId, sessionId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!data || data.session.status === 'ENDED' || data.session.status === 'ARCHIVED') return
    const timer = window.setInterval(() => void refresh(true), 15000)
    return () => window.clearInterval(timer)
  }, [data, refresh])

  const eventStreamEnabled = Boolean(data)
  const eventStreamOrganizationId = data?.session.organizationId
  useEffect(() => {
    if (!eventStreamEnabled || typeof EventSource === 'undefined') return
    const stream = new EventSource(trainingEventStreamUrl(sessionId, eventStreamOrganizationId))
    const refreshFromEvent = () => void refresh(true)
    stream.addEventListener('training', refreshFromEvent)
    stream.addEventListener('resync_required', refreshFromEvent)
    return () => stream.close()
  }, [eventStreamEnabled, eventStreamOrganizationId, refresh, sessionId])

  const selected = useMemo(() => data?.effectiveProblems.find(problem => problem.id === selectedId), [data, selectedId])
  const selectedPermission = selected ? data?.permissions[selected.id] : undefined
  const currentRound = data?.session.currentRound
  const pendingRound = data?.session.Rounds.find(round => round.lifecycle === 'PENDING')
  const focusCandidates = useMemo(() => {
    if (!data || !currentRound) return []
    const groupIds = focusTargetType === 'GROUP'
      ? [focusGroupId]
      : data.session.Groups.map(group => group.id)
    if (!groupIds.length || groupIds.some(groupId => !groupId)) return []
    const sets = groupIds.map(groupId => new Set(currentRound.Assignments.filter(item => item.groupId === groupId && item.active).map(item => item.sessionProblemId)))
    const common = sets[0] || new Set<string>()
    for (const id of [...common]) if (sets.slice(1).some(set => !set.has(id))) common.delete(id)
    const byId = new Map(data.session.Problems.map(problem => [problem.id, problem]))
    return currentRound.Assignments
      .filter(item => item.groupId === groupIds[0] && item.active && common.has(item.sessionProblemId))
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map(item => byId.get(item.sessionProblemId))
      .filter((problem): problem is SessionProblem => Boolean(problem))
  }, [currentRound, data, focusGroupId, focusTargetType])

  useEffect(() => {
    setFocusProblemId(current => focusCandidates.some(problem => problem.id === current) ? current : focusCandidates[0]?.id || '')
  }, [focusCandidates])

  useEffect(() => {
    if (!selected) {
      setCode('')
      setDraftRevision(undefined)
      setIo({ inputFilename: null, outputFilename: null })
      return
    }
    let active = true
    void getTrainingDraft(sessionId, selected.id).then(draft => {
      if (!active) return
      setCode(draft?.code || '')
      setLanguage(draft?.language || 'cpp17')
      setDraftRevision(draft?.revision)
      setIo({ inputFilename: draft?.inputFilename || null, outputFilename: draft?.outputFilename || null })
    }).catch(error => toast.error(publicErrorMessage(error, '代码草稿加载失败')))
    return () => { active = false }
  }, [selected, sessionId, toast])

  useEffect(() => {
    if (!selected || !data?.participant || data.session.status !== 'RUNNING') return
    const send = () => void sendTrainingHeartbeat(sessionId, {
      sessionProblemId: selected.id,
      pageVisible: document.visibilityState === 'visible',
      editorFocused: document.activeElement?.getAttribute('role') === 'textbox',
    })
    send()
    const timer = window.setInterval(send, 30000)
    return () => window.clearInterval(timer)
  }, [data?.participant, data?.session.status, selected, sessionId])

  const run = async (key: string, work: () => Promise<{ ok: boolean; error?: { userMessage?: string } }>, success: string) => {
    setBusy(key)
    try {
      const result = await work()
      const message = resultMessage(result, success)
      if (message) return toast.error(message)
      toast.success(success)
      await refresh(true)
    } catch (error) {
      toast.error(publicErrorMessage(error, success))
    } finally {
      setBusy('')
    }
  }

  const command = (type: CommandType, payload: Record<string, unknown> = {}, targetType: 'ALL' | 'GROUP' = 'ALL', targetId?: string | null) => {
    if (!data) return
    void run(type, () => executeTrainingCommand(sessionId, {
      type,
      expectedRevision: data.session.statusRevision,
      targetType,
      targetId,
      payload,
    }), type === 'END_SESSION' ? '训练已结束' : '课堂状态已更新')
  }

  const assignmentReferences = useMemo(() => {
    if (!data || !currentRound) return []
    return currentRound.Assignments
      .filter(item => item.groupId === assignmentGroupId && item.active)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(item => toReference(item.SessionProblem))
  }, [assignmentGroupId, currentRound, data])

  const replaceAssignments = async (references: readonly SelectedProblemReference[]) => {
    if (!data) return { acceptedIds: [] }
    const response = await replaceTrainingAssignments(sessionId, {
      expectedRevision: data.session.statusRevision,
      groupId: assignmentGroupId,
      problems: references.map(item => ({ problemId: item.problem.id, alias: item.alias || null })),
    })
    if (!response.ok) throw response.error
    setData(response.data)
    return { acceptedIds: references.map(item => item.problem.id) }
  }

  const openNextRound = () => {
    if (!data) return
    const existing = pendingRound
    setNextName(existing?.name || `第 ${data.session.Rounds.length + 1} 轮`)
    setNextMinutes(existing?.timeLimitSeconds ? Math.round(existing.timeLimitSeconds / 60) : 0)
    setNextProblems(Object.fromEntries(data.session.Groups.map(group => [
      group.id,
      existing
        ? existing.Assignments.filter(item => item.groupId === group.id && item.active).sort((a, b) => a.orderIndex - b.orderIndex).map(item => toReference(item.SessionProblem))
        : currentRound?.Assignments.filter(item => item.groupId === group.id && item.active).sort((a, b) => a.orderIndex - b.orderIndex).map(item => toReference(item.SessionProblem)) || [],
    ])))
    setNextOpen(true)
  }

  const saveNextRound = async () => {
    if (!data || !nextName.trim()) return
    await run('next-save', () => putTrainingNextRound(sessionId, {
      expectedRevision: data.session.statusRevision,
      name: nextName.trim(),
      timeLimitSeconds: nextMinutes > 0 ? nextMinutes * 60 : null,
      groups: data.session.Groups.map(group => ({
        groupId: group.id,
        problems: (nextProblems[group.id] || []).map(item => ({ problemId: item.problem.id, alias: item.alias || null })),
      })),
    }), '下一轮已准备')
    setNextOpen(false)
  }

  const advanceRound = async () => {
    if (!data) return
    await run('round-advance', () => advanceTrainingRound(sessionId, { expectedRevision: data.session.statusRevision }), '已进入下一轮')
  }

  const moveGroup = async () => {
    if (!data || !movingParticipants.length || !movingTargetGroup || !movingReason.trim()) return
    await run('group-change', () => changeTrainingGrouping(sessionId, {
      expectedRevision: data.session.statusRevision,
      participantIds: movingParticipants,
      toGroupId: movingTargetGroup,
      reason: movingReason.trim(),
    }), '分组已调整')
    setGroupOpen(false)
    setMovingParticipants([])
  }

  const applyFocus = () => {
    if (!focusProblemId) return
    command('FOCUS_PROBLEM', { sessionProblemId: focusProblemId }, focusTargetType, focusTargetType === 'GROUP' ? focusGroupId : null)
    setFocusOpen(false)
  }

  const saveDraft = async () => {
    if (!selected) return
    await run('draft', () => saveTrainingDraft(sessionId, selected.id, {
      code,
      language,
      inputFilename: io.inputFilename,
      outputFilename: io.outputFilename,
      expectedRevision: draftRevision,
      editorFocused: true,
    }), '草稿已保存')
    const draft = await getTrainingDraft(sessionId, selected.id)
    setDraftRevision(draft?.revision)
  }

  const submit = async () => {
    if (!selected || !code.trim()) return toast.error('请先填写代码')
    await run('submit', () => submitTrainingSolution(sessionId, {
      sessionProblemId: selected.id,
      code,
      language,
      inputFilename: io.inputFilename,
      outputFilename: io.outputFilename,
    }), '提交已进入评测')
  }

  if (loading) return <PageFrame><p role="status">正在加载训练…</p></PageFrame>
  if (!data) return <PageFrame><PageHeader title="训练加载失败" description={loadError || '暂时无法读取训练'} actions={<Button icon={<RefreshCw size={16} />} onClick={() => void refresh()}>重试</Button>} /></PageFrame>

  const sessionRunningSince = data.session.status === 'RUNNING' ? data.session.runningSince : null
  const currentGroupName = data.session.Groups.find(group => group.id === data.participant?.currentGroupId)?.name
  const progressByProblem = new Map(data.progress.map(item => [item.sessionProblemId, item]))
  const canSubmit = Boolean(selected && selectedPermission?.canSubmit && data.session.status === 'RUNNING')
  const focusActive = data.session.Overlays.some(overlay => overlay.type === 'FOCUS' && overlay.status === 'active')

  return <PageFrame>
    <PageHeader
      title={data.session.title}
      description={[data.session.sessionType, currentRound?.name, currentGroupName].filter(Boolean).join(' · ')}
      actions={<div className={styles.actions}>
        <StatusBadge variant={data.session.status === 'RUNNING' ? 'success' : data.session.status === 'PAUSED' ? 'warning' : 'neutral'}>{statusText[data.session.status] || data.session.status}</StatusBadge>
        <Button variant="outline" icon={<RefreshCw size={15} />} onClick={() => void refresh()}>刷新</Button>
      </div>}
    />

    <section className={styles.v3StatusBar} aria-label="训练状态">
      <div><Clock3 size={18} /><strong>训练时间</strong><RuntimeClock elapsed={data.session.activeElapsedSeconds} runningSince={sessionRunningSince} limit={data.session.totalDurationSeconds} /></div>
      <div><Layers3 size={18} /><strong>{currentRound?.name || '尚未开始'}</strong>{currentRound ? <><span>{roundStatusText[currentRound.lifecycle]}</span><RuntimeClock elapsed={currentRound.activeElapsedSeconds} runningSince={currentRound.runningSince} limit={currentRound.timeLimitSeconds} /></> : <span>等待老师开始</span>}</div>
      <div><Users size={18} /><strong>{data.session.participantCount || data.session.Groups.reduce((sum, group) => sum + (group.Participants?.length || 0), 0)} 人</strong><span>{data.session.Groups.length} 个分组</span></div>
    </section>

    {data.manager && <Section title="课堂控制" description="课堂中的四项主要调整都在这里完成。" actions={<div className={styles.actions}>
      {data.session.status === 'READY' && <Button icon={<Play size={16} />} loading={busy === 'START_SESSION'} onClick={() => command('START_SESSION')}>开始训练</Button>}
      {data.session.status === 'RUNNING' && <Button variant="outline" onClick={() => command('PAUSE_SESSION')}>暂停</Button>}
      {data.session.status === 'PAUSED' && <Button onClick={() => command('RESUME_SESSION')}>继续</Button>}
      {(data.session.status === 'RUNNING' || data.session.status === 'PAUSED') && <Button variant="outline" onClick={() => setExtendOpen('session')}>延长时间</Button>}
      {(data.session.status === 'RUNNING' || data.session.status === 'PAUSED') && <Button variant="danger" onClick={() => setEndOpen(true)}>结束训练</Button>}
    </div>}>
      <div className={styles.v3PrimaryActions}>
        <Button variant="outline" icon={<Settings2 size={17} />} disabled={!currentRound} onClick={() => setAssignmentOpen(true)}>题目调整</Button>
        <Button variant="outline" icon={<Focus size={17} />} disabled={!currentRound} onClick={() => { setFocusTargetType('ALL'); setFocusGroupId(data.session.Groups[0]?.id || ''); setFocusOpen(true) }}>聚焦题目</Button>
        <Button variant="outline" icon={<Users size={17} />} disabled={!dashboard?.participants.length} onClick={() => setGroupOpen(true)}>调整分组</Button>
        <Button icon={<Layers3 size={17} />} onClick={pendingRound ? () => void advanceRound() : openNextRound} loading={busy === 'round-advance'}>{pendingRound ? '下一步' : '准备下一步'}</Button>
      </div>
      {focusActive && <div className={styles.v3ActiveNotice}>当前正在聚焦题目。<Button size="sm" variant="secondary" onClick={() => command('END_FOCUS')}>结束聚焦</Button></div>}
    </Section>}

    <div className={styles.v3Workspace}>
      <aside className={styles.v3ProblemRail} aria-label="本轮题目">
        <h2>本轮题目</h2>
        {!data.effectiveProblems.length && <p className={styles.muted}>当前分组暂无题目</p>}
        {data.effectiveProblems.map((problem, index) => {
          const progress = progressByProblem.get(problem.id)
          return <button key={problem.id} type="button" className={selectedId === problem.id ? styles.v3ProblemActive : ''} onClick={() => setSelectedId(problem.id)}>
            <span>{index + 1}</span>
            <span><strong>{problem.alias || problem.titleSnapshot}</strong><small>{progress?.status === 'COMPLETED' ? '已完成' : progress?.attemptCount ? `已提交 ${progress.attemptCount} 次` : '未开始'}</small></span>
          </button>
        })}
      </aside>

      <main className={styles.v3Editor}>
        {selected ? <>
          <div className={styles.v3ProblemHeading}>
            <ProblemReferenceLink problem={selected.Problem} showIdentity />
            <span>{selected.Problem.timeLimit || '默认时限'} · {selected.Problem.memoryLimit || '默认内存'}</span>
          </div>
          <label className={styles.field}>语言<Select value={language} disabled={!selectedPermission?.canEdit} onChange={event => setLanguage(event.target.value)}><option value="cpp17">C++ 17</option><option value="cpp20">C++ 20</option><option value="python3">Python 3</option><option value="java17">Java 17</option></Select></label>
          <SubmissionCodeEditor value={code} onChange={setCode} language={language} draftKey={`training-v3:${sessionId}:${selected.id}`} readOnly={!selectedPermission?.canEdit} minHeight={420} />
          <SubmissionIoFields value={io} onChange={setIo} disabled={!selectedPermission?.canEdit} />
          <div className={styles.actions}>
            <Button variant="secondary" disabled={!selectedPermission?.canEdit} loading={busy === 'draft'} onClick={() => void saveDraft()}>保存草稿</Button>
            <Button disabled={!canSubmit || !code.trim()} loading={busy === 'submit'} onClick={() => void submit()}>提交评测</Button>
          </div>
          {!selectedPermission?.canSubmit && <p className={styles.muted}>{selectedPermission?.reason || '当前不可提交'}</p>}
        </> : <p className={styles.muted}>当前没有可作答题目。</p>}
      </main>

      <aside className={styles.v3Ranking}>
        <h2>{data.manager ? '课堂排名' : '当前排名'}</h2>
        {data.manager && ranking?.scope === 'group' && <label className={styles.field}>排名分组<Select value={rankingGroupId} onChange={event => setRankingGroupId(event.target.value)}>{data.session.Groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>}
        {ranking?.entries.map(entry => <div key={entry.user.id} className={styles.v3RankingRow}>
          <span><strong>{entry.rank}. {entry.user.displayName}</strong><small>@{entry.user.username}</small></span>
          <span>{data.session.sessionType === 'ACM' ? `${entry.completed} 题 · ${entry.penaltyMinutes || 0} 分钟` : data.session.sessionType === 'OI' ? `${entry.score || 0} 分` : `${entry.completed}/${entry.total}`}</span>
        </div>)}
        {!ranking?.entries.length && <p className={styles.muted}>暂无排名数据</p>}
      </aside>
    </div>

    <FormDialog isOpen={assignmentOpen} onClose={() => setAssignmentOpen(false)} title="题目调整" description="只影响当前轮次中选定分组的有效题目。" size="wide" footer={<Button onClick={() => setAssignmentOpen(false)}>完成</Button>}>
      <label className={styles.field}>分组<Select value={assignmentGroupId} onChange={event => setAssignmentGroupId(event.target.value)}>{data.session.Groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>
      <ProblemListEditor references={assignmentReferences} onReplace={replaceAssignments} contextKey={`assignment:${sessionId}:${currentRound?.id}:${assignmentGroupId}`} dataRequirement="training" aliasLabel="别名" />
    </FormDialog>

    <FormDialog isOpen={focusOpen} onClose={() => setFocusOpen(false)} onSubmit={applyFocus} title="聚焦题目" submitText="开始聚焦" submitDisabled={!focusProblemId || focusTargetType === 'GROUP' && !focusGroupId}>
      <div className={styles.stack}>
        <label className={styles.field}>题目<Select value={focusProblemId} onChange={event => setFocusProblemId(event.target.value)}><option value="">{focusCandidates.length ? '请选择题目' : '当前范围没有共同题目'}</option>{focusCandidates.map(problem => <option key={problem.id} value={problem.id}>{problem.alias || problem.titleSnapshot}</option>)}</Select></label>
        <label className={styles.field}>范围<Select value={focusTargetType} onChange={event => setFocusTargetType(event.target.value as 'ALL' | 'GROUP')}><option value="ALL">全部学生</option><option value="GROUP">指定分组</option></Select></label>
        {focusTargetType === 'GROUP' && <label className={styles.field}>分组<Select value={focusGroupId} onChange={event => setFocusGroupId(event.target.value)}>{data.session.Groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>}
      </div>
    </FormDialog>

    <FormDialog isOpen={groupOpen} onClose={() => setGroupOpen(false)} onSubmit={() => void moveGroup()} title="调整分组" submitText="确认调整" submitDisabled={!movingParticipants.length || !movingTargetGroup || !movingReason.trim()} loading={busy === 'group-change'}>
      <div className={styles.stack}>
        <div className={styles.v3ParticipantPicker}>{dashboard?.participants.map(participant => <Checkbox key={participant.id} label={`${participant.user.displayName} · ${data.session.Groups.find(group => group.id === participant.currentGroupId)?.name || '未分组'}`} checked={movingParticipants.includes(participant.id)} onChange={event => setMovingParticipants(current => event.target.checked ? [...current, participant.id] : current.filter(id => id !== participant.id))} />)}</div>
        <label className={styles.field}>调整到<Select value={movingTargetGroup} onChange={event => setMovingTargetGroup(event.target.value)}>{data.session.Groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>
        <label className={styles.field}>原因<Input value={movingReason} maxLength={2000} onChange={event => setMovingReason(event.target.value)} /></label>
      </div>
    </FormDialog>

    <FormDialog isOpen={nextOpen} onClose={() => setNextOpen(false)} onSubmit={() => void saveNextRound()} title="准备下一轮" description="下一轮保存后仍对学生隐藏，点击“下一步”才会切换。" size="wide" submitText="保存下一轮" submitDisabled={!nextName.trim()} loading={busy === 'next-save'}>
      <div className={styles.stack}>
        <div className={styles.compactGrid}>
          <label className={styles.field}>轮次名称<Input value={nextName} maxLength={200} onChange={event => setNextName(event.target.value)} /></label>
          <label className={styles.field}>本轮限时（分钟，0 为不限）<Input type="number" min={0} max={10080} value={nextMinutes} onChange={event => setNextMinutes(Math.max(0, Number(event.target.value) || 0))} /></label>
        </div>
        {data.session.Groups.map(group => <section key={group.id} className={styles.v3RoundGroup}>
          <h3>{group.name}</h3>
          <ProblemListEditor
            references={nextProblems[group.id] || []}
            onReplace={references => { setNextProblems(current => ({ ...current, [group.id]: [...references] })); return { acceptedIds: references.map(item => item.problem.id) } }}
            contextKey={`next:${sessionId}:${group.id}`}
            dataRequirement="training"
            aliasLabel="别名"
          />
        </section>)}
      </div>
    </FormDialog>

    <FormDialog isOpen={Boolean(extendOpen)} onClose={() => setExtendOpen(null)} onSubmit={() => {
      command(extendOpen === 'round' ? 'EXTEND_ROUND' : 'EXTEND_SESSION', { seconds: extendMinutes * 60 })
      setExtendOpen(null)
    }} title={extendOpen === 'round' ? '延长本轮时间' : '延长训练时间'} submitText="确认延长">
      <label className={styles.field}>延长分钟数<Input type="number" min={1} max={10080} value={extendMinutes} onChange={event => setExtendMinutes(Math.max(1, Number(event.target.value) || 10))} /></label>
    </FormDialog>

    <ConfirmDialog isOpen={endOpen} onClose={() => setEndOpen(false)} onConfirm={() => { setEndOpen(false); command('END_SESSION') }} title="结束训练？" message="结束后学生不能继续提交，本次训练会进入结果状态。" confirmText="结束训练" danger loading={busy === 'END_SESSION'} />
  </PageFrame>
}
