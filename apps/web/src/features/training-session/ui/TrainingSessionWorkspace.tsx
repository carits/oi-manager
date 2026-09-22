'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { StatusBadge } from '@/components/ui/Badge'
import { DetailDialog, FormDialog } from '@/components/ui/Dialogs'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'
import { SubmissionCodeEditor, SubmissionIoFields, type SubmissionIoValue } from '@/features/submission'
import {
  changeTrainingStageGroup,
  extendTrainingStageTime,
  getTrainingCoachDashboard,
  getTrainingDraft,
  getTrainingPeerProgress,
  getTrainingReport,
  getTrainingRoster,
  getTrainingWorkspace,
  createTrainingHint,
  executeTrainingCommand,
  listTrainingHints,
  openTrainingHint,
  recordTrainingStrategy,
  saveTrainingRoster,
  saveTrainingDraft,
  sendTrainingHeartbeat,
  submitTrainingSolution,
  transitionTrainingStage,
} from '../api/trainingSessionApi'
import { testDataVersion, trainingStatusLabel } from '@/lib/humanPresentation'
import { saveBlobDownload } from '@/lib/download'

const stageModeLabel: Record<string, string> = {
  TRAINING: '训练',
  TEACHING: '统一讲解',
  REVIEW: '复盘',
}
const progressLabel: Record<string, string> = {
  NOT_STARTED: '未开始', WORKING: '进行中', STUCK: '可能卡题', COMPLETED: '已完成', SKIPPED: '已跳过', PAUSED: '已暂停', LOCKED: '尚未开放',
}
const visibilityLabel: Record<string, string> = { NONE: '仅自己', PROGRESS: '完成进度', SCORE: '成绩与进度', FULL: '详细进度' }
const rankingLabel: Record<string, string> = { OFF: '不排名', PROGRESS_ONLY: '按完成进度', SCORE: '按得分', ACM_RANKING: '按通过题数和罚时' }
import styles from './TrainingEngine.module.css'

type StageProblem = { id: string; problemId: string; alias?: string; targetScore?: number; scoreGoals?: Array<{ score: number; allowedSubtaskIds?: number[] }>; timePolicy?: { mode: string; limitSeconds?: number }; stuckPolicy?: { minActiveSeconds: number; minAttempts: number; noImprovementSeconds: number }; allowedSubtaskIds?: number[]; strategyIntervalSeconds?: number; unlockPolicy?: { mode: 'ANY' | 'ALL'; conditions: Array<{ type: string; value?: number }> }; Statements?: Array<{ type?: string; format: string; language?: string | null; content?: string | null; fileUrl?: string | null }>; Problem: { problemId: string; title: string; platform: string }; TestSetRevision: { revisionNumber: number; mode: string } }
type StageGroup = { id: string; name: string; participantIds?: string[] }
type Stage = { id: string; name: string; description?: string; kind: string; audienceMode: string; lifecycle: string; plannedDurationSeconds?: number; runningSince?: string; activeElapsedSeconds: number; effectiveDurationSeconds?: number; minDurationSeconds?: number; endPolicy: string; accessPolicy: string; accessScope?: string; submissionMode: string; defaultTargetScore?: number; completionThreshold?: number; endedAt?: string; endReason?: string; endNote?: string; Groups: StageGroup[]; Problems: StageProblem[] }
type StrategyState = {
  intervalSeconds?: number
  timePolicy: { type?: string; mode?: string; action?: string; limitSeconds?: number }
  timeLimitReached: boolean
  timeAction?: 'REMIND' | 'RECOMMEND_SWITCH' | 'LOCK_SUBMISSION' | 'FORCE_SWITCH' | null
  remind?: boolean
  decisionDue: boolean
  switchRecommended: boolean
  switchRequired?: boolean
  nextScoreTarget?: number | null
  scorePolicy?: { type?: string; targets?: number[]; completionScore?: number }
  lastDecision?: { decision: string; createdAt: string } | null
}
type Workspace = { session: { id: string; title: string; description?: string; sessionType: string; status: string; statusRevision: number; currentStageId?: string; pauseMode?: string; rankingMode: string; peerVisibility: string; joinMode: string; teamId?: string; Stages: Stage[]; Overlays: Array<{ id: string; type: string; targetType?: string; targetId?: string; payload?: { message?: string } }> }; manager: boolean; participant?: { id: string; currentProblemId?: string; currentStageId?: string; currentGroupId?: string | null; requiredCount?: number; completedCount?: number }; progress: Array<{ stageProblemId: string; status: string; bestScore?: number; attemptCount: number; activeSeconds?: number; continuousActiveSeconds?: number }>; permissions: Record<string, { canSeeMetadata?: boolean; canView: boolean; canSubmit: boolean; canEdit: boolean; reason: string }>; strategy: Record<string, StrategyState> }
type Dashboard = { participants: Array<{ id: string; user: { id: string; username: string }; online: boolean; currentProblemId?: string; currentGroupId?: string | null; requiredCount: number; completedCount: number; completed: boolean; progress: Array<{ status: string }> }>; summary: { total: number; working: number; stuck: number; completed: number } }
type Roster = { revision: number; candidates: Array<{ userId: string; username: string; displayName: string; role: string; selected: boolean }> }
type Hint = { id: string; level: number; title?: string; content?: string; opened: boolean; globallyOpenedAt?: string }
type PeerProgress = { rankingMode: string; peerVisibility: string; entries: Array<{ rank?: number; user: { id: string; username: string }; completed: number; total: number; score?: number; attempts?: number; penaltyMinutes?: number; activeSeconds?: number }> }
type TrainingDraft = { code?: string; language?: string; revision?: number; inputFilename?: string | null; outputFilename?: string | null }
type TrainingSubmitResult = { id: number }

const formatDuration = (seconds?: number | null) => {
  const value = Math.max(0, Math.floor(seconds || 0))
  const minutes = Math.floor(value / 60)
  const remainder = value % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}
  type TrainingReport = {
    sessionSummary: { id: string; title: string; status: string; startedAt?: string; endedAt?: string; actualDurationSeconds: number; stageCount: number; participantCount: number }
    timeline: Array<{ id: string; name: string; kind: string; lifecycle: string; plannedDurationSeconds?: number; runtimeExtensionSeconds: number; extensionSeconds: number; effectiveDurationSeconds: number; actualDurationSeconds: number; activeElapsedSeconds: number; endReason?: string; endNote?: string; snapshotHash?: string }>
    groupSummaries: Array<{ stageId: string; stageName: string; groupId: string; groupName: string; initialParticipantCount: number; finalParticipantCount: number; problemCount: number }>
    groupChanges: Array<{ stageId: string; participantId: string; fromGroupId?: string; toGroupId: string; effectiveMode: string; reason: string; changedBy: string; requestedAt?: string; effectiveAt?: string }>
    problemSummaries: Array<{ stageId: string; stageName: string; stageProblemId: string; problemId: string; title: string; requiredCount: number; satisfiedCount: number; retiredCount: number; notStartedCount: number; stuckCount: number; attemptCount: number; hintCount: number; averageBestScore?: number | null }>
    stuckHistory: Array<{ seq: number; type: 'DETECTED' | 'CLEARED'; participantId?: string | null; stageProblemId?: string | null; reason?: string | null; at: string }>
    participants: Array<{ id: string; user: { id: string; username: string }; activeSeconds: number; summary: { requiredCount: number; satisfiedCount: number; retiredCount: number; stuckCount: number; attemptCount: number; hintCount: number }; problems: Array<{ stageProblemId: string; stageId: string; stageName: string; problemId: string; title: string; bestScore?: number | null; attemptCount: number; hintCount: number; status: string; requirementState: 'REQUIRED' | 'SATISFIED' | 'BYPASSED' | 'RETIRED' }> }>
  }

export function TrainingSessionWorkspace({ sessionId }: { sessionId: string }) {
  const toast = useToast(), router = useRouter(), pathname = usePathname()
  const [data, setData] = useState<Workspace>(), [dashboard, setDashboard] = useState<Dashboard>(), [peerProgress, setPeerProgress] = useState<PeerProgress>()
  const [selectedId, setSelectedId] = useState<string>(), [code, setCode] = useState(''), [language, setLanguage] = useState('cpp17'), [draftRevision, setDraftRevision] = useState<number>()
  const [submissionIo, setSubmissionIo] = useState<SubmissionIoValue>({ inputFilename: null, outputFilename: null })
  const [saving, setSaving] = useState(false), [submitting, setSubmitting] = useState(false), [commandBusy, setCommandBusy] = useState(false), [rosterSaving, setRosterSaving] = useState(false)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [studentQuery, setStudentQuery] = useState(''), [studentFilter, setStudentFilter] = useState('all'), [studentGroupFilter, setStudentGroupFilter] = useState('all')
  const [roster, setRoster] = useState<Roster>(), [rosterOpen, setRosterOpen] = useState(false)
  const [hints, setHints] = useState<Hint[]>([]), [hintOpen, setHintOpen] = useState(false), [hintTitle, setHintTitle] = useState(''), [hintContent, setHintContent] = useState(''), [hintLevel, setHintLevel] = useState(1), [openedHint, setOpenedHint] = useState<Hint>()
  const [hintMode, setHintMode] = useState('MANUAL'), [hintTrigger, setHintTrigger] = useState('')
  const [commandTargetType, setCommandTargetType] = useState('ALL'), [commandTargetId, setCommandTargetId] = useState('')
  const [messageOpen, setMessageOpen] = useState(false), [message, setMessage] = useState(''), [messageType, setMessageType] = useState('INFO')
  const [groupChangeParticipant, setGroupChangeParticipant] = useState<Dashboard['participants'][number]>(), [groupChangeTarget, setGroupChangeTarget] = useState(''), [groupChangeReason, setGroupChangeReason] = useState('')
  const [groupChangeMode, setGroupChangeMode] = useState<'immediate' | 'next_stage'>('immediate'), [groupChangeStageId, setGroupChangeStageId] = useState('')
  const [transitionDialog, setTransitionDialog] = useState<{ action: 'advance' | 'skip_pending' | 'end_session'; stageId: string; outcome?: 'completed' | 'ended_early' }>(), [transitionReason, setTransitionReason] = useState('')
  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const [extensionOpen, setExtensionOpen] = useState(false), [extensionMinutes, setExtensionMinutes] = useState(10), [extensionReason, setExtensionReason] = useState('')
  const [report, setReport] = useState<TrainingReport>(), [reportOpen, setReportOpen] = useState(false)
  const cursor = useRef(0), saveDraftRef = useRef<(quiet?: boolean) => Promise<number | false>>(async () => false)
  const commandInFlight = useRef(false), statusRevisionRef = useRef<number>(), hintLoadVersion = useRef(0)

  const load = useCallback(async () => {
    let workspace: Workspace
    try {
      workspace = await getTrainingWorkspace(sessionId) as Workspace
    } catch (error) {
      return toast.error(error instanceof Error ? error.message : '训练加载失败')
    }
    statusRevisionRef.current = workspace.session.statusRevision
    setData(workspace)
    setSelectedId(current => {
      const directed = workspace.participant?.currentProblemId
      if (directed && workspace.permissions[directed]?.canView && directed !== current) return directed
      return current && workspace.permissions[current]?.canView
        ? current
        : workspace.session.Stages.flatMap(stage => stage.Problems).find(problem => workspace.permissions[problem.id]?.canView)?.id
    })
    const [coachResult, peerResult] = await Promise.allSettled([
      workspace.manager ? getTrainingCoachDashboard(sessionId) : Promise.resolve(null),
      getTrainingPeerProgress(sessionId),
    ])
    if (coachResult.status === 'fulfilled' && coachResult.value) setDashboard(coachResult.value as Dashboard)
    else if (coachResult.status === 'rejected') toast.error(coachResult.reason instanceof Error ? coachResult.reason.message : '教练看板加载失败')
    if (peerResult.status === 'fulfilled') setPeerProgress(peerResult.value as PeerProgress)
    else toast.error(peerResult.reason instanceof Error ? peerResult.reason.message : '同伴进度加载失败')
  }, [sessionId, toast])
  useEffect(() => { void load() }, [load])

  const problem = useMemo(() => data?.session.Stages.flatMap(stage => stage.Problems).find(item => item.id === selectedId), [data, selectedId])
  const draftKey = problem ? `training-draft:${sessionId}:${problem.id}` : ''
  const editorDraftKey = problem ? `training-engine:${sessionId}:${problem.id}` : ''
  const loadHints = useCallback(async (id?: string) => {
    const version = ++hintLoadVersion.current
    if (!id) { setHints([]); return }
    setHints([])
    try {
      const response = await listTrainingHints(sessionId, id)
      if (version === hintLoadVersion.current) setHints(response as Hint[])
    } catch (error) {
      if (version === hintLoadVersion.current) toast.error(error instanceof Error ? error.message : '提示加载失败')
    }
  }, [sessionId, toast])
  useEffect(() => {
    if (!problem) return
    let cancelled = false
    void (async () => {
      const local = typeof window !== 'undefined' ? window.localStorage.getItem(draftKey) : null
      try {
        const draft = await getTrainingDraft(sessionId, problem.id) as TrainingDraft | null
        if (cancelled) return
        setCode(draft?.code || local || '')
        setLanguage(draft?.language || 'cpp17')
        setDraftRevision(draft?.revision)
        setSubmissionIo({ inputFilename: draft?.inputFilename || null, outputFilename: draft?.outputFilename || null })
        if (local) window.localStorage.removeItem(draftKey)
      } catch (error) {
        if (cancelled) return
        setCode(local || '')
        setLanguage('cpp17')
        setDraftRevision(undefined)
        setSubmissionIo({ inputFilename: null, outputFilename: null })
        toast.error(error instanceof Error ? `服务器草稿加载失败：${error.message}` : '服务器草稿加载失败；已仅使用本地草稿')
      }
    })()
    void loadHints(problem.id)
    return () => { cancelled = true }
  }, [draftKey, loadHints, problem?.id, problem?.problemId, sessionId, toast])
  const saveDraft = useCallback(async (quiet = false) => {
    if (!problem) return false
    setSaving(true)
    const response = await saveTrainingDraft(sessionId, problem.id, { code, language, inputFilename: submissionIo.inputFilename, outputFilename: submissionIo.outputFilename, expectedRevision: draftRevision, editorFocused: document.hasFocus() })
    setSaving(false)
    if (!response.ok) { if (!quiet) toast.error(response.error.message || '草稿保存失败'); return false }
    setDraftRevision(response.data?.revision)
    if (draftKey) window.localStorage.removeItem(draftKey)
    if (!quiet) toast.success('草稿已保存')
    return Number(response.data?.revision ?? draftRevision ?? 0)
  }, [code, draftKey, draftRevision, language, problem, sessionId, submissionIo.inputFilename, submissionIo.outputFilename, toast])
  saveDraftRef.current = saveDraft
  useEffect(() => { const timer = setInterval(() => { if (code && problem) void saveDraftRef.current(true) }, 30_000); return () => clearInterval(timer) }, [code, problem])
  useEffect(() => {
    if (!selectedId) return
    const heartbeat = () => void sendTrainingHeartbeat(sessionId, { stageProblemId: selectedId, pageVisible: document.visibilityState === 'visible', editorFocused: document.hasFocus() })
    heartbeat()
    const timer = setInterval(heartbeat, 30_000)
    return () => clearInterval(timer)
  }, [selectedId, sessionId])
  useEffect(() => {
    if (!problem || !draftKey) return
    const persistOnExit = () => {
      void saveTrainingDraft(sessionId, problem.id, { code, language, inputFilename: submissionIo.inputFilename, outputFilename: submissionIo.outputFilename, expectedRevision: draftRevision, editorFocused: false }, { keepalive: true })
    }
    window.addEventListener('pagehide', persistOnExit)
    return () => window.removeEventListener('pagehide', persistOnExit)
  }, [code, draftKey, draftRevision, language, problem, sessionId, submissionIo.inputFilename, submissionIo.outputFilename])
  useEffect(() => {
    const source = new EventSource(`/api/training-sessions/${sessionId}/events?afterSeq=${cursor.current}`, { withCredentials: true })
    source.addEventListener('training', event => { cursor.current = Number((event as MessageEvent).lastEventId || cursor.current); void saveDraftRef.current(true).finally(() => load()) })
    source.addEventListener('resync_required', () => void load())
    return () => source.close()
  }, [load, sessionId])

  const command = async (type: string, payload: Record<string, unknown> = {}, targetType = commandTargetType, targetId = commandTargetId) => {
    if (!data || commandInFlight.current) return false
    const resolvedTargetId = targetType === 'ALL' ? null : targetType === 'TEAM' ? data.session.teamId || null : targetId || null
    if (targetType !== 'ALL' && !resolvedTargetId) {
      toast.error(targetType === 'TEAM' ? '当前训练没有可用的团队上下文' : '请选择教练控制对象')
      return false
    }
    commandInFlight.current = true
    setCommandBusy(true)
    try {
      await saveDraftRef.current(true)
      const response = await executeTrainingCommand(sessionId, { type: type as 'PAUSE_SESSION', expectedRevision: statusRevisionRef.current ?? data.session.statusRevision, targetType: targetType as 'ALL', targetId: resolvedTargetId, payload })
      if (!response.ok) { toast.error(response.error.message || '训练指令失败'); return false }
      if (typeof response.data?.statusRevision === 'number') statusRevisionRef.current = response.data.statusRevision
      await load(); await loadHints(selectedId)
      return true
    } finally {
      commandInFlight.current = false
      setCommandBusy(false)
    }
  }
  const transitionStage = async (action: 'start' | 'advance' | 'skip_pending' | 'end_session', stageId: string, extra: Record<string, unknown> = {}) => {
    if (!data) return false
    setCommandBusy(true)
    const response = await transitionTrainingStage(sessionId, { expectedRevision: statusRevisionRef.current ?? data.session.statusRevision, action, stageId, ...extra })
    setCommandBusy(false)
    if (!response.ok) { toast.error(response.error.message || '阶段转换失败'); return false }
    await load()
    return true
  }
  const extendCurrentStage = async () => {
    const stageId = data?.session.currentStageId
    if (!data || !stageId || extensionMinutes < 1 || !extensionReason.trim()) return
    setCommandBusy(true)
    const response = await extendTrainingStageTime(sessionId, stageId, { expectedRevision: statusRevisionRef.current ?? data.session.statusRevision, seconds: Math.round(extensionMinutes * 60), reason: extensionReason.trim() })
    setCommandBusy(false)
    if (!response.ok) return toast.error(response.error.message || '延长阶段失败')
    setExtensionOpen(false); setExtensionMinutes(10); setExtensionReason('')
    await load()
  }
  const submit = async () => {
    if (!problem || !selectedId) return
    setSubmitting(true)
    const savedRevision = await saveDraftRef.current(true)
    if (savedRevision === false) { setSubmitting(false); return }
    const response = await submitTrainingSolution(sessionId, { stageProblemId: selectedId, code, language, inputFilename: submissionIo.inputFilename, outputFilename: submissionIo.outputFilename })
    if (!response.ok) { setSubmitting(false); return toast.error(response.error.message || '提交失败') }
    // A submission is a checkpoint, not the end of the editing session.
    // Keep the exact source and I/O settings so WA / partial-score workflows can iterate naturally.
    setSubmitting(false)
    toast.success(`提交 #${response.data?.id} 已进入评测队列，代码已保留，可继续修改`)
  }
  const openRoster = async () => { const response = await getTrainingRoster(sessionId).catch(() => null); if (!response) return toast.error('学员名单加载失败'); setRoster(response as Roster); setRosterOpen(true) }
  const saveRosterChanges = async () => { if (!roster) return; setRosterSaving(true); const response = await saveTrainingRoster(sessionId, { expectedRevision: roster.revision, participants: roster.candidates.filter(item => item.selected).map(item => ({ userId: item.userId })) }); setRosterSaving(false); if (!response.ok) return toast.error(response.error.message || '学员名单保存失败'); setRosterOpen(false); await load() }
  const createHint = async () => {
    if (!selectedId) return
    const trigger = Number(hintTrigger) || undefined
    const response = await createTrainingHint(sessionId, { stageProblemId: selectedId, level: hintLevel, title: hintTitle || undefined, content: hintContent, openMode: hintMode as 'MANUAL' | 'TIME' | 'ATTEMPT' | 'SCORE', triggerSeconds: hintMode === 'TIME' ? trigger : undefined, triggerAttempts: hintMode === 'ATTEMPT' ? trigger : undefined, triggerScore: hintMode === 'SCORE' ? trigger : undefined })
    if (!response.ok) return toast.error(response.error.message || '提示创建失败')
    setHintOpen(false); setHintTitle(''); setHintContent(''); setHintMode('MANUAL'); setHintTrigger(''); await loadHints(selectedId)
  }
  const showReport = async () => { const response = await getTrainingReport(sessionId).catch(() => null); if (!response) return toast.error('训练报告加载失败'); setReport(response as TrainingReport); setReportOpen(true) }
  const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const exportReportCsv = () => {
    if (!report) return
    const rows = [
      ['学员', '题号', '题目', '要求类型', '状态', '最高分', '提交次数', '提示次数', '学员有效训练秒数'],
      ...report.participants.flatMap(participant => participant.problems.map(entry => [
        participant.user.username,
        entry.problemId,
        entry.title,
        entry.requirementState === 'REQUIRED' ? '当前要求' : entry.requirementState === 'SATISFIED' ? '已满足要求' : entry.requirementState === 'BYPASSED' ? '教师已跳过' : '已退出当前要求',
        progressLabel[entry.status] || entry.status,
        entry.bestScore ?? 0,
        entry.attemptCount,
        entry.hintCount,
        participant.activeSeconds,
      ])),
    ]
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
    const safeTitle = data.session.title.replace(/[\\/:*?"<>|]/g, '_')
    saveBlobDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeTitle}-训练报告.csv`)
  }
  const exportReportJson = () => {
    if (!report) return
    const safeTitle = data.session.title.replace(/[\\/:*?"<>|]/g, '_')
    saveBlobDownload(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }), `${safeTitle}-训练报告.json`)
  }
  const submitGroupChange = async () => {
    const stageId = data?.session.currentStageId
    if (!data || !stageId || !groupChangeParticipant || !groupChangeTarget || !groupChangeReason.trim()) return
    setCommandBusy(true)
    const response = await changeTrainingStageGroup(sessionId, stageId, { expectedRevision: statusRevisionRef.current ?? data.session.statusRevision, participantId: groupChangeParticipant.id, toGroupId: groupChangeTarget, effectiveMode: groupChangeMode, ...(groupChangeMode === 'next_stage' ? { targetStageId: groupChangeStageId } : {}), reason: groupChangeReason.trim() })
    setCommandBusy(false)
    if (!response.ok) return toast.error(response.error.message || '调整分组失败')
    setGroupChangeParticipant(undefined); setGroupChangeTarget(''); setGroupChangeReason(''); setGroupChangeMode('immediate'); setGroupChangeStageId(''); await load()
  }
  const submitTransition = async () => {
    if (!transitionDialog) return
    const requiresReason = transitionDialog.action === 'skip_pending' || transitionDialog.outcome === 'ended_early'
    if (requiresReason && !transitionReason.trim()) return
    if (await transitionStage(transitionDialog.action, transitionDialog.stageId, {
      ...(transitionDialog.outcome ? { outcome: transitionDialog.outcome } : {}),
      ...(transitionReason.trim() ? { reason: transitionReason.trim() } : {}),
    })) {
      setTransitionDialog(undefined); setTransitionReason('')
    }
  }
  const recordStrategy = async (decision: string) => { const response = await recordTrainingStrategy(sessionId, { stageProblemId: selectedId, decision }); if (!response.ok) toast.error(response.error.message || '策略记录失败'); else toast.success('策略决策已记录') }

  if (!data) return <PageFrame width="workbench"><PageHeader title="训练工作台" description="正在准备训练状态…" /></PageFrame>
  const status = data.session.status
  const activeStrategy = selectedId ? data.strategy[selectedId] : undefined
  const currentStage = data.session.Stages.find(stage => stage.id === data.session.currentStageId)
  const pendingStages = data.session.Stages.filter(stage => stage.lifecycle === 'PENDING')
  const nextPendingStage = pendingStages.find(stage => !currentStage || data.session.Stages.indexOf(stage) > data.session.Stages.indexOf(currentStage))
  const futureGroupedStages = pendingStages.filter(stage => stage.audienceMode === 'GROUPED')
  const groupTargetStage = groupChangeMode === 'next_stage' ? futureGroupedStages.find(stage => stage.id === groupChangeStageId) : currentStage
  const reportStageName = (stageId: string) => data.session.Stages.find(stage => stage.id === stageId)?.name || stageId
  const reportGroupName = (groupId?: string) => data.session.Stages.flatMap(stage => stage.Groups).find(group => group.id === groupId)?.name || (groupId ? groupId : '未分组')
  const reportParticipantName = (participantId: string) => dashboard?.participants.find(item => item.id === participantId)?.user.username || participantId
  const targetedCommandDisabled = commandBusy || ((commandTargetType === 'GROUP' || commandTargetType === 'USER') && !commandTargetId) || (commandTargetType === 'TEAM' && !data.session.teamId)
  const runningExtraSeconds = currentStage?.runningSince && status === 'RUNNING'
    ? Math.max(0, Math.floor((clockNow - new Date(currentStage.runningSince).getTime()) / 1000))
    : 0
  const currentStageElapsed = (currentStage?.activeElapsedSeconds || 0) + runningExtraSeconds
  const currentStageLimit = currentStage?.effectiveDurationSeconds || currentStage?.plannedDurationSeconds || null
  const currentStageRemaining = currentStageLimit == null ? null : Math.max(0, currentStageLimit - currentStageElapsed)
  const currentGroupName = data.participant?.currentGroupId ? currentStage?.Groups.find(group => group.id === data.participant?.currentGroupId)?.name : null
  const transitionStageRecord = transitionDialog ? data.session.Stages.find(stage => stage.id === transitionDialog.stageId) : undefined
  const transitionIsCurrent = Boolean(transitionStageRecord && transitionStageRecord.id === currentStage?.id)
  const transitionElapsedSeconds = transitionIsCurrent ? currentStageElapsed : transitionStageRecord?.activeElapsedSeconds || 0
  const transitionPlannedSeconds = transitionStageRecord?.plannedDurationSeconds || 0
  const transitionCompletionPercent = dashboard?.summary.total
    ? Math.round((dashboard.summary.completed / dashboard.summary.total) * 100)
    : 0
  const transitionNextStage = transitionDialog?.action === 'advance' ? nextPendingStage : undefined
  const currentProblemProgress = selectedId ? data.progress.find(item => item.stageProblemId === selectedId) : undefined
  const scoreGoals = problem?.scoreGoals?.map(goal => goal.score).sort((a, b) => a - b) || []
  const nextScoreGoal = activeStrategy?.nextScoreTarget ?? scoreGoals.find(score => score > (currentProblemProgress?.bestScore || 0))
  const filteredParticipants = (dashboard?.participants || []).filter(item => {
    const queryMatch = !studentQuery.trim() || item.user.username.toLowerCase().includes(studentQuery.trim().toLowerCase())
    const statusMatch = studentFilter === 'all'
      || studentFilter === 'stuck' && item.progress.some(progress => progress.status === 'STUCK')
      || studentFilter === 'completed' && item.completed
      || studentFilter === 'working' && !item.completed && item.progress.some(progress => progress.status === 'WORKING')
      || studentFilter === 'offline' && !item.online
    const groupMatch = studentGroupFilter === 'all' || item.currentGroupId === studentGroupFilter
    return queryMatch && statusMatch && groupMatch
  })
  return <PageFrame width="workbench"><div className={styles.stack}>
    <PageHeader title={data.session.title} description={data.session.description || '训练工作台'} actions={<div className={styles.actions}><StatusBadge variant={status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : 'neutral'}>{trainingStatusLabel(status)}</StatusBadge></div>} />
    {currentStage && <Section title={`当前阶段 · ${currentStage.name}`} description={currentStage.description || (data.manager ? '当前课堂阶段的实时状态' : '完成当前要求后等待教师进入下一阶段')}>
      <div className={styles.summary}>
        <div className={styles.metric}><strong>{formatDuration(currentStageElapsed)}</strong>已进行</div>
        {currentStageRemaining != null && <div className={styles.metric}><strong>{formatDuration(currentStageRemaining)}</strong>剩余</div>}
        {!data.manager && <div className={styles.metric}><strong>{data.participant?.completedCount || 0}/{data.participant?.requiredCount || 0}</strong>当前要求</div>}
        {data.manager && <div className={styles.metric}><strong>{dashboard?.summary.completed || 0}/{dashboard?.summary.total || 0}</strong>学员完成</div>}
        {!data.manager && currentStage.audienceMode === 'GROUPED' && <div className={styles.metric}><strong>{currentGroupName || '待分组'}</strong>我的分组</div>}
        {!data.manager && nextScoreGoal != null && <div className={styles.metric}><strong>{currentProblemProgress?.bestScore || 0} → {nextScoreGoal}</strong>当前目标分</div>}
      </div>
    </Section>}
    {data.session.Overlays.filter(item => item.type === 'MESSAGE').map(item => <div className={styles.message} key={item.id}>{item.payload?.message || '教练消息'}</div>)}
    {data.manager && <Section title="教练控制" description="控制会实时发送给学员；切换题目前，系统会先保存学员草稿。"><div className={styles.stack}>
      <div className={styles.targetBar}>
        <label className={styles.field}>控制对象<Select aria-label="教练控制对象" value={commandTargetType} onChange={event => { setCommandTargetType(event.target.value); setCommandTargetId('') }}><option value="ALL">全体学员</option>{Boolean(currentStage?.Groups.length) && <option value="GROUP">当前阶段分组</option>}<option value="USER">指定学员</option>{data.session.teamId && <option value="TEAM">当前团队</option>}</Select></label>
        {commandTargetType === 'GROUP' && <label className={styles.field}>分组<Select aria-label="目标分组" value={commandTargetId} onChange={event => setCommandTargetId(event.target.value)}><option value="">请选择</option>{currentStage?.Groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</Select></label>}
        {commandTargetType === 'USER' && <label className={styles.field}>学员<Select aria-label="目标学员" value={commandTargetId} onChange={event => setCommandTargetId(event.target.value)}><option value="">请选择</option>{dashboard?.participants.map(item => <option value={item.user.id} key={item.user.id}>{item.user.username}</option>)}</Select></label>}
      </div>
      <div className={styles.actions}>
        {status === 'SCHEDULED' && currentStage && <Button disabled={commandBusy} loading={commandBusy} onClick={() => void transitionStage('start', currentStage.id)}>开始</Button>}
        {status === 'RUNNING' && <><Button variant="secondary" disabled={commandBusy} onClick={() => void command('PAUSE_SESSION', { mode: 'SOFT' }, 'ALL', '')}>软暂停</Button><Button variant="secondary" disabled={commandBusy} onClick={() => void command('PAUSE_SESSION', { mode: 'HARD' }, 'ALL', '')}>硬暂停</Button></>}
        {status === 'PAUSED' && <Button disabled={commandBusy} loading={commandBusy} onClick={() => void command('RESUME_SESSION', {}, 'ALL', '')}>恢复</Button>}
        {['RUNNING', 'PAUSED'].includes(status) && currentStage && <><Button variant="secondary" disabled={commandBusy} onClick={() => { setTransitionDialog({ action: nextPendingStage ? 'advance' : 'end_session', stageId: currentStage.id, outcome: 'completed' }); setTransitionReason('') }}>{nextPendingStage ? '完成并进入下一阶段' : '完成并结束训练'}</Button><Button variant="outline" disabled={commandBusy} onClick={() => { setTransitionDialog({ action: nextPendingStage ? 'advance' : 'end_session', stageId: currentStage.id, outcome: 'ended_early' }); setTransitionReason('') }}>提前结束当前阶段</Button><Button variant="danger" disabled={commandBusy} onClick={() => { setTransitionDialog({ action: 'end_session', stageId: currentStage.id, outcome: 'ended_early' }); setTransitionReason('') }}>结束整场训练</Button></>}
        {(status === 'DRAFT' || pendingStages.length > 0) && <Button onClick={() => router.push(`${pathname}/design`)}>{status === 'DRAFT' ? '打开训练设计器' : '调整未来阶段'}</Button>}
        {currentStage && ['RUNNING', 'PAUSED'].includes(status) && <Button variant="secondary" onClick={() => router.push(`${pathname}/design?copyStage=${encodeURIComponent(currentStage.id)}`)}>复制当前阶段为未来阶段</Button>}
        {selectedId && status === 'RUNNING' && <><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('FOCUS_PROBLEM', { stageProblemId: selectedId, mode: 'LOCKED_FOCUS' })}>聚焦当前题</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('END_FOCUS')}>结束聚焦</Button></>}
        {['RUNNING', 'PAUSED'].includes(status) && <><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('DISABLE_SUBMISSION')}>禁止提交</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('ENABLE_SUBMISSION')}>恢复提交</Button><Button variant="outline" disabled={commandBusy} onClick={() => { setExtensionOpen(true); setExtensionMinutes(10); setExtensionReason('') }}>延长阶段</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => setMessageOpen(true)}>广播消息</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('CLEAR_MESSAGE')}>清除消息</Button></>}
        <Button variant="secondary" onClick={() => void openRoster()}>管理学员</Button><Button variant="secondary" onClick={() => void showReport()}>训练报告</Button><Button variant="ghost" onClick={() => void load()}>刷新</Button>
      </div>
    </div></Section>}
    <div className={styles.workspace}>
      <aside className={styles.rail}>{data.session.Stages.map(stage => <section className={styles.stage} key={stage.id}><div><strong>{stage.name}</strong> {data.manager && <StatusBadge variant={stage.id === data.session.currentStageId ? 'success' : 'neutral'}>{stageModeLabel[stage.kind] || stage.kind} · {stage.lifecycle}</StatusBadge>}</div>{stage.endedAt && <small>实际 {Math.floor(stage.activeElapsedSeconds / 60)} 分钟{stage.endReason ? ` · ${stage.endReason}` : ''}{stage.endNote ? ` · ${stage.endNote}` : ''}</small>}{data.manager && stage.lifecycle === 'PENDING' && ['RUNNING', 'PAUSED'].includes(status) && <Button size="sm" variant="text" onClick={() => { setTransitionDialog({ action: 'skip_pending', stageId: stage.id }); setTransitionReason('') }}>跳过此阶段</Button>}{stage.Problems.map(item => { const access = data.permissions[item.id], progress = data.progress.find(entry => entry.stageProblemId === item.id); return <Button variant="ghost" className={styles.problemButton} data-active={item.id === selectedId} disabled={!access?.canView} key={item.id} onClick={async () => { await saveDraftRef.current(true); setSelectedId(item.id) }}><span><strong>{item.alias || item.Problem.problemId} · {item.Problem.title}</strong><br /><small>{stage.id === data.session.currentStageId ? '当前要求' : '本阶段历史'} · {access?.canView ? `${progressLabel[progress?.status || 'NOT_STARTED'] || progress?.status || '未开始'}${progress?.bestScore != null ? ` · ${progress.bestScore} 分` : ''}` : '尚未开放'}{data.manager ? ' · 已固定测试数据' : ''}</small></span></Button>})}</section>)}</aside>
      <main className={styles.stack}>{problem ? <>
        <Section title={`${problem.alias || problem.Problem.problemId} · ${problem.Problem.title}`} description={data.manager ? `${problem.Problem.platform} · ${testDataVersion(problem.TestSetRevision.revisionNumber)}` : '使用训练发布时固定的数据评测'}>{problem.Statements?.find((item) => item.format === 'markdown')?.content ? <MarkdownRenderer content={problem.Statements.find((item) => item.format === 'markdown')!.content!} /> : <p className={styles.muted}>该训练发布时没有可用的 Markdown 题面快照。</p>}</Section>
        <Section title="训练代码" description="每 30 秒自动保存；切换题目、页面离开和收到教练指令前也会保存。"><div className={styles.stack}><label className={styles.field}>语言<Select value={language} disabled={!data.permissions[problem.id]?.canEdit} onChange={event => { if (!code || window.confirm('切换后会保存当前语言草稿，并加载目标语言自己的草稿。是否切换？')) setLanguage(event.target.value) }}><option value="cpp17">C++17</option><option value="python3">Python3</option><option value="c">C</option></Select></label><label className={styles.field}>代码草稿<SubmissionCodeEditor value={code} onChange={setCode} language={language} draftKey={editorDraftKey} readOnly={!data.permissions[problem.id]?.canEdit} minHeight={420} /></label><SubmissionIoFields value={submissionIo} onChange={setSubmissionIo} disabled={!data.permissions[problem.id]?.canEdit} /><div className={styles.actions}><Button variant="secondary" loading={saving} disabled={!data.permissions[problem.id]?.canEdit} onClick={() => void saveDraft()}>保存草稿</Button><Button loading={submitting} disabled={!data.permissions[problem.id]?.canSubmit || !code.trim()} onClick={() => void submit()}>提交评测</Button></div>{!data.permissions[problem.id]?.canSubmit && <p className={styles.muted}>当前不可提交：{data.permissions[problem.id]?.reason}</p>}</div></Section>
        {status === 'RUNNING' && activeStrategy?.timeLimitReached && activeStrategy.timeAction && <Section
          title={activeStrategy.timeAction === 'REMIND' ? '单题时间提醒' : activeStrategy.timeAction === 'RECOMMEND_SWITCH' ? '建议切题' : activeStrategy.timeAction === 'LOCK_SUBMISSION' ? '单题提交已锁定' : '必须切题'}
          description={activeStrategy.timeAction === 'REMIND'
            ? '已达到本题提醒时间；可以继续，但建议确认当前策略。'
            : activeStrategy.timeAction === 'RECOMMEND_SWITCH'
              ? '当前题持续时间已达到教师设定阈值，建议评估是否切换。'
              : activeStrategy.timeAction === 'LOCK_SUBMISSION'
                ? '已达到本题硬性时限，代码与历史进度保留，但不能继续提交。'
                : '已达到强制切题阈值，请先切换到其他开放题目。'}
        ><p className={styles.muted}>时间策略只改变 Runtime 权限与提示，不会修改阶段计划时长或删除已有进度。</p></Section>}
        {data.session.sessionType === 'ACM' && status === 'RUNNING' && activeStrategy && (activeStrategy.decisionDue || activeStrategy.switchRecommended || activeStrategy.switchRequired) && <Section title="策略检查" description={activeStrategy.switchRequired ? '当前策略要求切题；记录切题决定后选择其他开放题目。' : activeStrategy.switchRecommended ? '当前题已持续较久，建议重新评估是否切题。' : '到了本轮策略复盘时间，请记录你的决定。'}><div className={styles.actions}><Button variant="secondary" disabled={activeStrategy.switchRequired} onClick={() => void recordStrategy('CONTINUE')}>继续当前题</Button><Button onClick={() => void recordStrategy('SWITCH')}>决定切题</Button></div></Section>}
        <Section title="分级提示" description="提示支持教练手动、训练时间、提交次数或分数条件开放；使用情况会进入训练报告。" actions={data.manager ? <Button variant="secondary" onClick={() => setHintOpen(true)}>新增提示</Button> : undefined}><div className={styles.actions}>{hints.length ? hints.map(hint => data.manager ? <span className={styles.actions} key={hint.id}><Button variant={hint.globallyOpenedAt ? 'secondary' : 'outline'} disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('OPEN_HINT', { hintId: hint.id })}>{hint.level} 级 · {hint.title || '提示'} · 开放</Button><Button variant="ghost" disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('CLOSE_HINT', { hintId: hint.id })}>关闭</Button></span> : <Button key={hint.id} variant="outline" onClick={async () => { const response = await openTrainingHint(sessionId, hint.id); if (response.ok && response.data) setOpenedHint(response.data as Hint); else toast.error(response.ok ? '提示尚未开放' : response.error.message) }}>{hint.opened ? '再次查看' : '打开'} {hint.level} 级提示</Button>) : <p className={styles.muted}>暂无已开放提示。</p>}</div></Section>
      </> : <Section title="请选择训练题目"><p className={styles.muted}>题目可能尚未按当前阶段开放。</p></Section>}</main>
      {data.manager && <aside className={`${styles.stack} ${styles.coach}`}><Section title="实时概览"><div className={styles.summary}><div className={styles.metric}><strong>{dashboard?.summary.total || 0}</strong>学员</div><div className={styles.metric}><strong>{dashboard?.summary.working || 0}</strong>进行中</div><div className={styles.metric}><strong>{dashboard?.summary.stuck || 0}</strong>可能卡题</div><div className={styles.metric}><strong>{dashboard?.summary.completed || 0}</strong>完成</div></div></Section><Section title="学员状态" description="优先定位需要干预的学生；分组调整会保留既有提交与历史进度。"><div className={styles.stack}><div className={styles.grid}><label className={styles.field}>搜索学生<Input value={studentQuery} onChange={event => setStudentQuery(event.target.value)} placeholder="用户名" /></label><label className={styles.field}>状态<Select value={studentFilter} onChange={event => setStudentFilter(event.target.value)}><option value="all">全部</option><option value="stuck">可能卡题</option><option value="working">进行中</option><option value="completed">已完成</option><option value="offline">离线</option></Select></label>{Boolean(currentStage?.Groups.length) && <label className={styles.field}>分组<Select value={studentGroupFilter} onChange={event => setStudentGroupFilter(event.target.value)}><option value="all">全部分组</option>{currentStage?.Groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</Select></label>}</div><div className={styles.timeline}>{filteredParticipants.map(item => <div className={styles.timelineItem} key={item.id}><strong>{item.user.username}</strong><br /><span className={styles.muted}>{item.online ? '在线' : '离线'} · {item.completedCount}/{item.requiredCount} 题完成{item.currentGroupId ? ` · ${currentStage?.Groups.find(group => group.id === item.currentGroupId)?.name || '已分组'}` : ''}</span><div className={styles.actions}>{selectedId && <><Button variant="ghost" disabled={commandBusy} onClick={() => void command('UNLOCK_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>单独解锁</Button><Button variant="ghost" disabled={commandBusy} onClick={() => void command('SKIP_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>允许跳过</Button><Button variant="ghost" disabled={commandBusy || !item.progress.some(progress => progress.status === 'STUCK')} onClick={() => void command('CLEAR_STUCK_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>清除卡题</Button></>}{(currentStage?.audienceMode === 'GROUPED' || futureGroupedStages.length > 0) && <Button variant="ghost" disabled={commandBusy} onClick={() => { setGroupChangeParticipant(item); setGroupChangeMode(currentStage?.audienceMode === 'GROUPED' ? 'immediate' : 'next_stage'); setGroupChangeStageId(futureGroupedStages[0]?.id || ''); setGroupChangeTarget(currentStage?.audienceMode === 'GROUPED' ? item.currentGroupId || '' : ''); setGroupChangeReason('') }}>调整分组</Button>}</div></div>)}</div>{filteredParticipants.length === 0 && <p className={styles.muted}>没有符合当前筛选条件的学员。</p>}</div></Section></aside>}
    </div>
    {!data.manager && peerProgress && peerProgress.entries.length > 0 && <Section title="同学训练进度" description={`可见内容：${visibilityLabel[peerProgress.peerVisibility] || peerProgress.peerVisibility} · 排列方式：${rankingLabel[peerProgress.rankingMode] || peerProgress.rankingMode}`}><div className={styles.peerGrid}>{peerProgress.entries.map(item => <article className={styles.peerCard} key={item.user.id}>{item.rank && <span>#{item.rank}</span>}<strong>{item.user.username}</strong><span>完成 {item.completed}/{item.total}</span>{item.score !== undefined && <span>{item.score} 分</span>}{item.penaltyMinutes !== undefined && <span>罚时 {item.penaltyMinutes} 分钟</span>}{item.attempts !== undefined && <span>{item.attempts} 次提交</span>}</article>)}</div></Section>}
    <FormDialog isOpen={rosterOpen} onClose={() => setRosterOpen(false)} title="管理基础学员名单" description="基础名单只决定谁参加训练；分组在每个阶段中独立配置。" size="lg" loading={rosterSaving} footer={<><Button variant="secondary" onClick={() => setRosterOpen(false)} disabled={rosterSaving}>取消</Button><Button onClick={() => void saveRosterChanges()} loading={rosterSaving}>保存名单</Button></>}><div className={styles.problemPicker}>{roster?.candidates.map(item => <Checkbox key={item.userId} label={item.displayName} description={`${item.username} · ${item.role}`} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />)}</div></FormDialog>
    <FormDialog isOpen={Boolean(groupChangeParticipant)} onClose={() => setGroupChangeParticipant(undefined)} title="调整阶段分组" description="可立即调整当前要求，也可预设下一阶段；既有草稿、提交和历史进度永不删除。" onSubmit={() => void submitGroupChange()} submitText="确认换组" loading={commandBusy} dirty={Boolean(groupChangeReason)}><div className={styles.stack}><p>学员：<strong>{groupChangeParticipant?.user.username}</strong></p><label className={styles.field}>生效方式<Select value={groupChangeMode} onChange={event => { const mode = event.target.value as 'immediate' | 'next_stage'; setGroupChangeMode(mode); setGroupChangeTarget(''); if (mode === 'next_stage') setGroupChangeStageId(futureGroupedStages[0]?.id || '') }}><option value="immediate" disabled={currentStage?.audienceMode !== 'GROUPED'}>立即应用到当前阶段</option><option value="next_stage" disabled={!futureGroupedStages.length}>预设下一阶段</option></Select></label>{groupChangeMode === 'next_stage' && <label className={styles.field}>目标阶段<Select value={groupChangeStageId} onChange={event => { setGroupChangeStageId(event.target.value); setGroupChangeTarget('') }}>{futureGroupedStages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</Select></label>}<label className={styles.field}>目标分组<Select value={groupChangeTarget} onChange={event => setGroupChangeTarget(event.target.value)}><option value="">请选择</option>{groupTargetStage?.Groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label><label className={styles.field}>调整原因<Textarea rows={4} maxLength={2000} value={groupChangeReason} onChange={event => setGroupChangeReason(event.target.value)} /></label></div></FormDialog>
    <FormDialog
      isOpen={Boolean(transitionDialog)}
      onClose={() => { setTransitionDialog(undefined); setTransitionReason('') }}
      title={transitionDialog?.action === 'skip_pending'
        ? '跳过未来阶段'
        : transitionDialog?.outcome === 'completed'
          ? transitionDialog?.action === 'end_session' ? '确认完成并结束训练' : '确认完成当前阶段'
          : transitionDialog?.action === 'end_session' ? '提前结束训练' : '提前结束当前阶段'}
      description="阶段结束会写入不可变课堂时间线；已运行阶段不能回滚或重新编辑。"
      onSubmit={() => void submitTransition()}
      submitText={transitionDialog?.action === 'skip_pending' ? '确认跳过' : transitionDialog?.outcome === 'completed' ? '确认完成' : '确认提前结束'}
      loading={commandBusy}
      dirty={Boolean(transitionReason)}
    >
      <div className={styles.stack}>
        {transitionStageRecord && <div className={styles.card}>
          <strong>{transitionStageRecord.name}</strong>
          <div className={styles.summary}>
            <div className={styles.metric}><strong>{transitionPlannedSeconds ? formatDuration(transitionPlannedSeconds) : '未设置'}</strong>计划时长</div>
            <div className={styles.metric}><strong>{formatDuration(transitionElapsedSeconds)}</strong>实际用时</div>
            {transitionIsCurrent && <div className={styles.metric}><strong>{transitionCompletionPercent}%</strong>学员完成率</div>}
            {transitionNextStage && <div className={styles.metric}><strong>{transitionNextStage.name}</strong>下一阶段</div>}
          </div>
        </div>}
        {transitionDialog?.action !== 'skip_pending' && <label className={styles.field}>
          结束方式
          <Select
            value={transitionDialog?.outcome || 'completed'}
            onChange={event => setTransitionDialog(current => current ? { ...current, outcome: event.target.value as 'completed' | 'ended_early' } : current)}
          >
            <option value="completed">正常完成</option>
            <option value="ended_early">提前结束</option>
          </Select>
        </label>}
        <label className={styles.field}>
          {transitionDialog?.action === 'skip_pending' || transitionDialog?.outcome === 'ended_early' ? '原因（必填）' : '备注（可选）'}
          <Textarea rows={5} maxLength={2000} value={transitionReason} onChange={event => setTransitionReason(event.target.value)} />
        </label>
      </div>
    </FormDialog>
    <FormDialog isOpen={extensionOpen} onClose={() => setExtensionOpen(false)} title="延长当前阶段" description="延时作为运行记录追加，不会覆盖原计划时长。" onSubmit={() => void extendCurrentStage()} submitText="确认延长" loading={commandBusy} dirty={Boolean(extensionReason)}><div className={styles.stack}><label className={styles.field}>延长分钟数<Input type="number" min={1} max={1440} value={extensionMinutes} onChange={event => setExtensionMinutes(Number(event.target.value))} /></label><label className={styles.field}>原因<Textarea rows={4} maxLength={2000} value={extensionReason} onChange={event => setExtensionReason(event.target.value)} /></label></div></FormDialog>
    <FormDialog isOpen={messageOpen} onClose={() => setMessageOpen(false)} title="发送教练消息" description={`发送给：${commandTargetType === 'ALL' ? '全体学员' : commandTargetType === 'GROUP' ? '指定分组' : commandTargetType === 'USER' ? '指定学员' : '当前团队'}`} onSubmit={() => void command('SHOW_MESSAGE', { message, messageType }).then(success => { if (success) { setMessageOpen(false); setMessage('') } })} submitText="发送消息" dirty={Boolean(message)}><div className={styles.stack}><label className={styles.field}>消息类型<Select value={messageType} onChange={event => setMessageType(event.target.value)}><option value="INFO">信息</option><option value="WARNING">提醒</option><option value="INSTRUCTION">教学指令</option><option value="COUNTDOWN">倒计时</option></Select></label><label className={styles.field}>消息内容<Textarea rows={6} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></label></div></FormDialog>
    <FormDialog isOpen={hintOpen} onClose={() => setHintOpen(false)} title="新增分级提示" onSubmit={() => void createHint()} submitText="创建提示" dirty={Boolean(hintContent)}><div className={styles.stack}><label className={styles.field}>级别<Input type="number" min={1} max={20} value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))} /></label><label className={styles.field}>开放方式<Select value={hintMode} onChange={event => setHintMode(event.target.value)}><option value="MANUAL">教练手动</option><option value="TIME">有效训练时间</option><option value="ATTEMPT">提交次数</option><option value="SCORE">最高分数</option></Select></label>{hintMode !== 'MANUAL' && <label className={styles.field}>{hintMode === 'TIME' ? '触发秒数' : hintMode === 'ATTEMPT' ? '触发提交次数' : '触发分数'}<Input type="number" min={hintMode === 'TIME' ? 60 : hintMode === 'SCORE' ? 0 : 1} max={hintMode === 'TIME' ? 86400 : 100} value={hintTrigger} onChange={event => setHintTrigger(event.target.value)} /></label>}<label className={styles.field}>标题<Input value={hintTitle} onChange={event => setHintTitle(event.target.value)} /></label><label className={styles.field}>内容<Textarea rows={6} value={hintContent} onChange={event => setHintContent(event.target.value)} /></label></div></FormDialog>
    <DetailDialog isOpen={Boolean(openedHint)} onClose={() => setOpenedHint(undefined)} title={`${openedHint?.level || ''} 级提示 · ${openedHint?.title || '提示'}`} size="md"><p>{openedHint?.content}</p></DetailDialog>
    <DetailDialog isOpen={reportOpen} onClose={() => setReportOpen(false)} title="训练过程报告" description="按阶段时间轴还原当时要求、实际用时、分组变化和课堂干预。" size="xl"><div className={styles.stack}>{report && <div className={styles.actions}><Button variant="secondary" onClick={exportReportCsv}>导出学员明细 CSV</Button><Button variant="ghost" onClick={exportReportJson}>导出完整 JSON</Button></div>}{report?.sessionSummary && <Section title="训练汇总"><div className={styles.summary}><div className={styles.metric}><strong>{report.sessionSummary.stageCount}</strong>阶段</div><div className={styles.metric}><strong>{report.sessionSummary.participantCount}</strong>学员</div><div className={styles.metric}><strong>{formatDuration(report.sessionSummary.actualDurationSeconds)}</strong>实际训练</div></div></Section>}{report?.timeline.map(stage => <article className={styles.card} key={stage.id}><h3>{stage.name} · {stage.lifecycle}</h3><p>计划 {Math.floor((stage.plannedDurationSeconds || 0) / 60)} 分钟 · 运行时延长 {Math.floor(stage.runtimeExtensionSeconds / 60)} 分钟 · 实际 {Math.floor(stage.actualDurationSeconds / 60)} 分钟</p>{stage.endReason && <p>{stage.endReason}{stage.endNote ? ` · ${stage.endNote}` : ''}</p>}{stage.snapshotHash && <small>配置快照 {stage.snapshotHash.slice(0, 12)}</small>}</article>)}{Boolean(report?.groupSummaries.length) && <Section title="阶段分组汇总" description="初始人数来自阶段运行快照，最终人数反映实际换组后的分组结果。"><div className={styles.timeline}>{report?.groupSummaries.map(group => <div className={styles.timelineItem} key={`${group.stageId}-${group.groupId}`}><strong>{group.stageName} · {group.groupName}</strong><br /><span>初始 {group.initialParticipantCount} 人 → 最终 {group.finalParticipantCount} 人 · {group.problemCount} 道题</span></div>)}</div></Section>}{Boolean(report?.problemSummaries.length) && <Section title="题目汇总"><div className={styles.timeline}>{report?.problemSummaries.map(item => <div className={styles.timelineItem} key={item.stageProblemId}><strong>{item.stageName} · {item.problemId} · {item.title}</strong><br /><span>满足 {item.satisfiedCount}/{item.requiredCount} · 未开始 {item.notStartedCount} · 退出要求 {item.retiredCount} · 卡题 {item.stuckCount} · 提交 {item.attemptCount} · 提示 {item.hintCount}{item.averageBestScore != null ? ` · 平均最高分 ${item.averageBestScore}` : ''}</span></div>)}</div></Section>}{Boolean(report?.stuckHistory.length) && <Section title="卡题历史"><div className={styles.timeline}>{report?.stuckHistory.map(item => <div className={styles.timelineItem} key={item.seq}><strong>{item.type === 'DETECTED' ? '检测到卡题' : '解除卡题'}</strong><br /><span>{item.participantId ? reportParticipantName(item.participantId) : '学员'}{item.reason ? ` · ${item.reason}` : ''} · {new Date(item.at).toLocaleString()}</span></div>)}</div></Section>}{Boolean(report?.groupChanges.length) && <Section title="换组时间线" description="记录提出时间、实际生效时间、原组、目标组和原因。"><div className={styles.timeline}>{report?.groupChanges.map((change, index) => <div className={styles.timelineItem} key={`${change.participantId}-${change.requestedAt || index}`}><strong>{reportParticipantName(change.participantId)} · {reportStageName(change.stageId)}</strong><br /><span>{reportGroupName(change.fromGroupId)} → {reportGroupName(change.toGroupId)} · {change.effectiveMode === 'NEXT_STAGE' ? '下一阶段生效' : '立即生效'} · {change.reason}</span><br /><small>提出：{change.requestedAt ? new Date(change.requestedAt).toLocaleString() : '未知'}{change.effectiveAt ? ` · 生效：${new Date(change.effectiveAt).toLocaleString()}` : ' · 尚未生效'}</small></div>)}</div></Section>}<div className={styles.grid}>{report?.participants.map(item => <article className={styles.card} key={item.user.id}><h3>{item.user.username}</h3><p>有效训练 {Math.floor(item.activeSeconds / 60)} 分钟</p>{item.problems.map((entry) => <div className={styles.timelineItem} key={entry.problemId}><strong>{entry.problemId} · {entry.title}</strong><br /><span>{entry.requirementState === 'REQUIRED' ? '当前要求' : entry.requirementState === 'SATISFIED' ? '已满足要求' : entry.requirementState === 'BYPASSED' ? '教师已跳过' : '已退出当前要求'} · {entry.bestScore ?? 0} 分 · {entry.attemptCount} 次提交 · {entry.hintCount} 次提示 · {progressLabel[entry.status] || entry.status}</span></div>)}</article>)}</div></div></DetailDialog>
  </div></PageFrame>
}
