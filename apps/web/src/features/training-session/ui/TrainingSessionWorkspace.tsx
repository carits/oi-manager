'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { StatusBadge } from '@/components/ui/Badge'
import { ConfirmDialog, DetailDialog, FormDialog } from '@/components/ui/Dialogs'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/features/auth'
import { persistSubmissionDraft, SubmissionCodeEditor, SubmissionIoFields, type SubmissionIoValue } from '@/features/submission'
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
  runTrainingGroupAction,
  runTrainingGroupBatch,
  saveTrainingRoster,
  saveTrainingDraft,
  sendTrainingHeartbeat,
  submitTrainingSolution,
  transitionTrainingStage,
} from '../api/trainingSessionApi'
import { testDataVersion, trainingStatusLabel } from '@/lib/humanPresentation'
import { csvCell, saveBlobDownload } from '@/lib/download'
import { arbitrateTrainingDraft, type TrainingDraftSnapshot } from '../model/trainingDraftArbitration'
import styles from './TrainingEngine.module.css'

type GroupBatchAction = 'start_all' | 'advance_all' | 'pause_all' | 'resume_all'

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
const stageRuntimeStatusLabel: Record<string, string> = {
  PENDING: '待开始',
  RUNNING: '训练中',
  PAUSED: '已暂停',
  ENDED: '已完成',
  SKIPPED: '已跳过',
}

type StageProblem = { id: string; problemId: string; alias?: string; targetScore?: number; scoreGoals?: Array<{ score: number; allowedSubtaskIds?: number[] }>; timePolicy?: { mode: string; limitSeconds?: number }; stuckPolicy?: { minActiveSeconds: number; minAttempts: number; noImprovementSeconds: number }; allowedSubtaskIds?: number[]; strategyIntervalSeconds?: number; unlockPolicy?: { mode: 'ANY' | 'ALL'; conditions: Array<{ type: string; value?: number }> }; Statements?: Array<{ type?: string; format: string; language?: string | null; content?: string | null; fileUrl?: string | null }>; Problem: { problemId: string; title: string; platform: string }; TestSetRevision: { revisionNumber: number; mode: string } }
type StageGroup = { id: string; groupId: string; name: string; mode: string; status: string; plannedDurationSeconds?: number | null; runningSince?: string | null; activeElapsedSeconds: number; startedAt?: string | null; endedAt?: string | null; endReason?: string | null; accessPolicy: string; submissionMode: string }
type Stage = { id: string; name: string; description?: string; orderIndex: number; kind: string; Groups: StageGroup[]; Problems: StageProblem[] }
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
type V2StageGroupRuntime = { id: string; stageId: string; status: string; runningSince?: string | null; activeElapsedSeconds?: number; startedAt?: string | null; endedAt?: string | null; endReason?: string | null }
type V2RuntimeGroup = { id: string; name: string; orderIndex: number; status: string; Participants?: Array<{ id?: string; userId?: string }>; StageGroups?: V2StageGroupRuntime[] }
type Workspace = { session: { Groups: V2RuntimeGroup[]; activeUnits: Array<{ groupId: string; stageId: string; status: string }>; id: string; title: string; description?: string; sessionType: string; status: string; statusRevision: number; pauseMode?: string; rankingMode: string; peerVisibility: string; joinMode: string; teamId?: string; Stages: Stage[]; Overlays: Array<{ id: string; type: string; targetType?: string; targetId?: string; payload?: { message?: string } }> }; manager: boolean; participant?: { id: string; currentProblemId?: string; activeStageId?: string | null; currentGroupId: string; requiredCount?: number; completedCount?: number }; progress: Array<{ stageProblemId: string; status: string; bestScore?: number; attemptCount: number; activeSeconds?: number; continuousActiveSeconds?: number }>; permissions: Record<string, { canSeeMetadata?: boolean; canView: boolean; canSubmit: boolean; canEdit: boolean; reason: string }>; strategy: Record<string, StrategyState> }
type Dashboard = { participants: Array<{ id: string; user: { id: string; username: string }; online: boolean; currentProblemId?: string; activeStageId?: string | null; currentGroupId?: string | null; requiredCount: number; completedCount: number; completed: boolean; progress: Array<{ status: string }> }>; summary: { total: number; working: number; stuck: number; completed: number } }
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

function StageTimeMetrics({ activeElapsedSeconds, runningSince, plannedDurationSeconds, running }: { activeElapsedSeconds: number; runningSince?: string | null; plannedDurationSeconds?: number | null; running: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running || !runningSince) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, runningSince])
  const extra = running && runningSince ? Math.max(0, Math.floor((now - new Date(runningSince).getTime()) / 1000)) : 0
  const elapsed = activeElapsedSeconds + extra
  const remaining = plannedDurationSeconds == null ? null : Math.max(0, plannedDurationSeconds - elapsed)
  return <>
    <div className={styles.metric}><strong>{formatDuration(elapsed)}</strong>已进行</div>
    {remaining != null && <div className={styles.metric}><strong>{formatDuration(remaining)}</strong>剩余</div>}
  </>
}
  type TrainingReport = {
    session: { id: string; title: string; status: string; startedAt?: string | null; endedAt?: string | null }
    timeline: Array<{ id: string; name: string; orderIndex: number; kind: string; groups: Array<{ id: string; groupId: string; groupName: string; status: string; plannedDurationSeconds?: number | null; actualDurationSeconds: number; startedAt?: string | null; endedAt?: string | null; endReason?: string | null; problemIds: string[] }>; timeAdjustments: Array<{ id: string; seconds: number; reason: string }> }>
    participants: Array<{ id: string; user: { id: string; username: string }; group: { id: string; name: string }; activeSeconds: number; progress: Array<{ stageProblemId: string; status: string; bestScore?: number | null; attemptCount?: number }> }>
    groupChanges: Array<{ id: string; participantId: string; fromGroupId?: string | null; toGroupId: string; reason: string; changedBy: string; createdAt: string }>
  }

export function TrainingSessionWorkspace({ sessionId }: { sessionId: string }) {
  const toast = useToast(), router = useRouter(), pathname = usePathname()
  const { user } = useAuth()
  const [data, setData] = useState<Workspace>(), [dashboard, setDashboard] = useState<Dashboard>(), [peerProgress, setPeerProgress] = useState<PeerProgress>()
  const [selectedId, setSelectedId] = useState<string>(), [code, setCode] = useState(''), [language, setLanguage] = useState('cpp17'), [draftRevision, setDraftRevision] = useState<number>()
  const [draftState, setDraftState] = useState<'loading' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'>('loading')
  const [draftConflict, setDraftConflict] = useState<{ local: TrainingDraftSnapshot; remote: TrainingDraftSnapshot }>()
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting')
  const [loadError, setLoadError] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<number>()
  const [submissionIo, setSubmissionIo] = useState<SubmissionIoValue>({ inputFilename: null, outputFilename: null })
  const [saving, setSaving] = useState(false), [submitting, setSubmitting] = useState(false), [commandBusy, setCommandBusy] = useState(false), [rosterSaving, setRosterSaving] = useState(false)
  const [studentQuery, setStudentQuery] = useState(''), [studentFilter, setStudentFilter] = useState('all'), [studentGroupFilter, setStudentGroupFilter] = useState('all')
  const [roster, setRoster] = useState<Roster>(), [rosterOpen, setRosterOpen] = useState(false)
  const [hints, setHints] = useState<Hint[]>([]), [hintOpen, setHintOpen] = useState(false), [hintTitle, setHintTitle] = useState(''), [hintContent, setHintContent] = useState(''), [hintLevel, setHintLevel] = useState(1), [openedHint, setOpenedHint] = useState<Hint>()
  const [hintMode, setHintMode] = useState('MANUAL'), [hintTrigger, setHintTrigger] = useState('')
  const [commandTargetType, setCommandTargetType] = useState('ALL'), [commandTargetId, setCommandTargetId] = useState('')
  const [messageOpen, setMessageOpen] = useState(false), [message, setMessage] = useState(''), [messageType, setMessageType] = useState('INFO')
  const [groupChangeParticipant, setGroupChangeParticipant] = useState<Dashboard['participants'][number]>(), [groupChangeTarget, setGroupChangeTarget] = useState(''), [groupChangeReason, setGroupChangeReason] = useState('')
  const [batchAction, setBatchAction] = useState<GroupBatchAction>()
  const [groupChangeMode, setGroupChangeMode] = useState<'immediate' | 'next_stage'>('immediate'), [groupChangeStageId, setGroupChangeStageId] = useState('')
  const [transitionDialog, setTransitionDialog] = useState<{ action: 'advance' | 'skip_pending' | 'end_session'; stageId: string; outcome?: 'completed' | 'ended_early' }>(), [transitionReason, setTransitionReason] = useState('')
  const [extensionOpen, setExtensionOpen] = useState(false), [extensionMinutes, setExtensionMinutes] = useState(10), [extensionReason, setExtensionReason] = useState('')
  const [report, setReport] = useState<TrainingReport>(), [reportOpen, setReportOpen] = useState(false)
  const cursor = useRef(0), saveDraftRef = useRef<(quiet?: boolean) => Promise<number | false>>(async () => false)
  const draftRevisionRef = useRef<Record<string, number | undefined>>({})
  const draftSaveQueueRef = useRef<Promise<number | false>>(Promise.resolve(false))
  const problemRef = useRef<StageProblem>()
  const codeRef = useRef('')
  const languageRef = useRef('cpp17')
  const submissionIoRef = useRef<SubmissionIoValue>({ inputFilename: null, outputFilename: null })
  const draftDirtyRef = useRef(false)
  const remoteDraftRef = useRef<TrainingDraftSnapshot>()
  const draftLoadVersion = useRef(0)
  const workspaceLoadVersion = useRef(0)
  const commandInFlight = useRef(false), statusRevisionRef = useRef<number>(), hintLoadVersion = useRef(0)

  const load = useCallback(async () => {
    const version = ++workspaceLoadVersion.current
    setLoadError('')
    let workspace: Workspace
    try {
      workspace = await getTrainingWorkspace(sessionId) as Workspace
    } catch (error) {
      const message = error instanceof Error ? error.message : '训练加载失败'
      if (version === workspaceLoadVersion.current) setLoadError(message)
      return toast.error(message)
    }
    if (version !== workspaceLoadVersion.current) return
    setLastSyncedAt(Date.now())
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
    if (version !== workspaceLoadVersion.current) return
    if (coachResult.status === 'fulfilled' && coachResult.value) setDashboard(coachResult.value as Dashboard)
    else if (coachResult.status === 'rejected') toast.error(coachResult.reason instanceof Error ? coachResult.reason.message : '教练看板加载失败')
    if (peerResult.status === 'fulfilled') setPeerProgress(peerResult.value as PeerProgress)
    else toast.error(peerResult.reason instanceof Error ? peerResult.reason.message : '同伴进度加载失败')
  }, [sessionId, toast])
  useEffect(() => { void load() }, [load])

  const problem = useMemo(() => data?.session.Stages.flatMap(stage => stage.Problems).find(item => item.id === selectedId), [data, selectedId])
  const draftScope = `${user?.userId || 'anonymous'}:${user?.organizationId || 'personal'}`
  const editorDraftKey = problem ? `${draftScope}:training-engine:${sessionId}:${problem.id}` : ''
  problemRef.current = problem
  codeRef.current = code
  languageRef.current = language
  submissionIoRef.current = submissionIo
  const markDraftDirty = useCallback(() => {
    draftDirtyRef.current = true
    setDraftState('dirty')
  }, [])
  const handleCodeChange = useCallback((nextCode: string) => {
    codeRef.current = nextCode
    setCode(nextCode)
    markDraftDirty()
  }, [markDraftDirty])
  const handleLanguageChange = useCallback((nextLanguage: string) => {
    languageRef.current = nextLanguage
    setLanguage(nextLanguage)
    markDraftDirty()
  }, [markDraftDirty])
  const handleSubmissionIoChange = useCallback((nextIo: SubmissionIoValue) => {
    submissionIoRef.current = nextIo
    setSubmissionIo(nextIo)
    markDraftDirty()
  }, [markDraftDirty])
  const applyDraftSnapshot = useCallback((snapshot: TrainingDraftSnapshot, dirty: boolean) => {
    codeRef.current = snapshot.code
    languageRef.current = snapshot.language
    submissionIoRef.current = { inputFilename: snapshot.inputFilename, outputFilename: snapshot.outputFilename }
    setCode(snapshot.code)
    setLanguage(snapshot.language)
    setSubmissionIo({ inputFilename: snapshot.inputFilename, outputFilename: snapshot.outputFilename })
    draftDirtyRef.current = dirty
    setDraftState(dirty ? 'dirty' : 'saved')
  }, [])
  const handleLocalDraftRestore = useCallback((nextCode: string) => {
    const local: TrainingDraftSnapshot = {
      code: nextCode,
      language: languageRef.current,
      inputFilename: submissionIoRef.current.inputFilename,
      outputFilename: submissionIoRef.current.outputFilename,
    }
    codeRef.current = nextCode
    setCode(nextCode)
    draftDirtyRef.current = true
    const remote = remoteDraftRef.current
    const resolution = remote ? arbitrateTrainingDraft(local, remote, true) : undefined
    if (resolution?.type === 'conflict') {
      setDraftConflict({ local: resolution.local, remote: resolution.remote })
      setDraftState('conflict')
    } else {
      setDraftState('dirty')
    }
  }, [])
  const keepLocalDraft = useCallback(() => {
    if (!draftConflict) return
    applyDraftSnapshot(draftConflict.local, true)
    setDraftConflict(undefined)
  }, [applyDraftSnapshot, draftConflict])
  const useRemoteDraft = useCallback(() => {
    if (!draftConflict) return
    persistSubmissionDraft(editorDraftKey, draftConflict.remote.language, draftConflict.remote.code)
    applyDraftSnapshot(draftConflict.remote, false)
    setDraftConflict(undefined)
  }, [applyDraftSnapshot, draftConflict, editorDraftKey])
  const downloadDraftConflict = useCallback(() => {
    if (!draftConflict || !problem) return
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      sessionId,
      stageProblemId: problem.id,
      local: draftConflict.local,
      cloud: draftConflict.remote,
    }, null, 2)
    saveBlobDownload(new Blob([payload], { type: 'application/json;charset=utf-8' }), `training-draft-conflict-${problem.id}.json`)
  }, [draftConflict, problem, sessionId])
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
    const version = ++draftLoadVersion.current
    let cancelled = false
    setDraftState('loading')
    setDraftConflict(undefined)
    remoteDraftRef.current = undefined
    setCode('')
    setLanguage('cpp17')
    setDraftRevision(undefined)
    setSubmissionIo({ inputFilename: null, outputFilename: null })
    draftDirtyRef.current = false
    void (async () => {
      try {
        const draft = await getTrainingDraft(sessionId, problem.id) as TrainingDraft | null
        if (cancelled || version !== draftLoadVersion.current) return
        const remote: TrainingDraftSnapshot = {
          code: draft?.code || '',
          language: draft?.language || 'cpp17',
          inputFilename: draft?.inputFilename || null,
          outputFilename: draft?.outputFilename || null,
        }
        const local: TrainingDraftSnapshot = {
          code: codeRef.current,
          language: languageRef.current,
          inputFilename: submissionIoRef.current.inputFilename,
          outputFilename: submissionIoRef.current.outputFilename,
        }
        setDraftRevision(draft?.revision)
        draftRevisionRef.current[problem.id] = draft?.revision
        remoteDraftRef.current = remote
        const resolution = arbitrateTrainingDraft(local, remote, draftDirtyRef.current)
        if (resolution.type === 'conflict') {
          setDraftConflict({ local: resolution.local, remote: resolution.remote })
          setDraftState('conflict')
        } else {
          applyDraftSnapshot(resolution.draft, false)
        }
      } catch (error) {
        if (cancelled || version !== draftLoadVersion.current) return
        setDraftState('error')
        toast.error(error instanceof Error ? `服务器草稿加载失败：${error.message}` : '服务器草稿加载失败；本机草稿仍会保留')
      }
    })()
    void loadHints(problem.id)
    return () => { cancelled = true }
  }, [applyDraftSnapshot, loadHints, problem?.id, sessionId, toast])
  const saveDraft = useCallback(async (quiet = false) => {
    const targetProblem = problemRef.current
    if (!targetProblem) return false
    if (quiet && !draftDirtyRef.current) return draftRevisionRef.current[targetProblem.id] ?? 0
    const snapshot = {
      problemId: targetProblem.id,
      code: codeRef.current,
      language: languageRef.current,
      inputFilename: submissionIoRef.current.inputFilename,
      outputFilename: submissionIoRef.current.outputFilename,
    }
    const save = async () => {
      setSaving(true)
      setDraftState('saving')
      try {
        const response = await saveTrainingDraft(sessionId, snapshot.problemId, {
          code: snapshot.code,
          language: snapshot.language,
          inputFilename: snapshot.inputFilename,
          outputFilename: snapshot.outputFilename,
          expectedRevision: draftRevisionRef.current[snapshot.problemId],
          editorFocused: document.hasFocus(),
        })
        if (!response.ok) {
          draftDirtyRef.current = true
          setDraftState('error')
          if (!quiet) toast.error(response.error.message || '草稿保存失败')
          return false
        }
        const nextRevision = Number(response.data?.revision ?? draftRevisionRef.current[snapshot.problemId] ?? 0)
        draftRevisionRef.current[snapshot.problemId] = nextRevision
        if (problemRef.current?.id === snapshot.problemId) {
          const unchanged = codeRef.current === snapshot.code
            && languageRef.current === snapshot.language
            && submissionIoRef.current.inputFilename === snapshot.inputFilename
            && submissionIoRef.current.outputFilename === snapshot.outputFilename
          setDraftRevision(nextRevision)
          draftDirtyRef.current = !unchanged
          setDraftState(unchanged ? 'saved' : 'dirty')
        }
        if (!quiet) toast.success('草稿已保存')
        return nextRevision
      } catch (error) {
        draftDirtyRef.current = true
        setDraftState('error')
        if (!quiet) toast.error(error instanceof Error ? error.message : '草稿保存失败')
        return false
      } finally {
        setSaving(false)
      }
    }
    const queued = draftSaveQueueRef.current.then(save, save)
    draftSaveQueueRef.current = queued
    return queued
  }, [sessionId, toast])
  saveDraftRef.current = saveDraft
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (draftDirtyRef.current && problemRef.current) void saveDraftRef.current(true)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!selectedId) return
    const heartbeat = () => void sendTrainingHeartbeat(sessionId, { stageProblemId: selectedId, pageVisible: document.visibilityState === 'visible', editorFocused: document.hasFocus() })
    heartbeat()
    const timer = setInterval(heartbeat, 30_000)
    return () => clearInterval(timer)
  }, [selectedId, sessionId])
  useEffect(() => {
    const persistOnExit = () => {
      const currentProblem = problemRef.current
      if (!currentProblem || !draftDirtyRef.current) return
      void saveTrainingDraft(sessionId, currentProblem.id, {
        code: codeRef.current,
        language: languageRef.current,
        inputFilename: submissionIoRef.current.inputFilename,
        outputFilename: submissionIoRef.current.outputFilename,
        expectedRevision: draftRevisionRef.current[currentProblem.id],
        editorFocused: false,
      }, { keepalive: true })
    }
    window.addEventListener('pagehide', persistOnExit)
    return () => window.removeEventListener('pagehide', persistOnExit)
  }, [sessionId])
  useEffect(() => {
    setConnectionState('connecting')
    const source = new EventSource(`/api/training-sessions/${sessionId}/events?afterSeq=${cursor.current}`, { withCredentials: true })
    source.onopen = () => setConnectionState('connected')
    source.onerror = () => setConnectionState('reconnecting')
    const saveThenReload = () => {
      void saveDraftRef.current(true).then(saved => {
        if (saved !== false) void load()
      })
    }
    let reloadTimer: number | undefined
    const scheduleReload = () => {
      if (reloadTimer) window.clearTimeout(reloadTimer)
      reloadTimer = window.setTimeout(saveThenReload, 250)
    }
    source.addEventListener('training', event => { cursor.current = Number((event as MessageEvent).lastEventId || cursor.current); scheduleReload() })
    source.addEventListener('resync_required', scheduleReload)
    return () => { source.close(); if (reloadTimer) window.clearTimeout(reloadTimer) }
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
      if (response.data && 'statusRevision' in response.data && typeof response.data.statusRevision === 'number') statusRevisionRef.current = response.data.statusRevision
      await load(); await loadHints(selectedId)
      return true
    } finally {
      commandInFlight.current = false
      setCommandBusy(false)
    }
  }
  const runGroupAction = async (action: 'start' | 'advance' | 'pause' | 'resume', groupId: string) => {
    if (!data) return
    setCommandBusy(true)
    const response = await runTrainingGroupAction(sessionId, { expectedRevision: statusRevisionRef.current ?? data.session.statusRevision, action, groupId })
    setCommandBusy(false)
    if (!response.ok) return toast.error(response.error.message || '分组运行操作失败')
    await load()
  }
  const runGroupBatch = async (action: GroupBatchAction) => {
    if (!data) return false
    setCommandBusy(true)
    try {
      const response = await runTrainingGroupBatch(sessionId, { expectedRevision: statusRevisionRef.current ?? data.session.statusRevision, action })
      if (!response.ok) { toast.error(response.error.message || '批量分组操作失败'); return false }
      await load()
      return true
    } finally {
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
    const stageId = data?.participant?.activeStageId || data?.session.activeUnits[0]?.stageId
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
    try {
      const savedRevision = await saveDraftRef.current(true)
      if (savedRevision === false) {
        toast.error('提交前无法同步服务器草稿；代码仍保留，请检查网络后重试')
        return
      }
      const response = await submitTrainingSolution(sessionId, { stageProblemId: selectedId, code: codeRef.current, language: languageRef.current, inputFilename: submissionIoRef.current.inputFilename, outputFilename: submissionIoRef.current.outputFilename })
      if (!response.ok) { toast.error(response.error.message || '提交失败'); return }
      // A submission is a checkpoint, not the end of the editing session.
      // Keep the exact source and I/O settings so WA / partial-score workflows can iterate naturally.
      toast.success(`提交 #${response.data?.id} 已进入评测队列，代码已保留，可继续修改`)
    } finally {
      setSubmitting(false)
    }
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
  const exportReportCsv = () => {
    if (!report || !data) return
    const rows = [
      ['学员', '分组', '训练题目 ID', '状态', '最高分', '提交次数', '学员有效训练秒数'],
      ...report.participants.flatMap(participant => participant.progress.map(entry => [participant.user.username, participant.group.name, entry.stageProblemId, progressLabel[entry.status] || entry.status, entry.bestScore ?? 0, entry.attemptCount ?? 0, participant.activeSeconds])),
    ]
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
    const safeTitle = data.session.title.replace(/[\\/:*?"<>|]/g, '_')
    saveBlobDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeTitle}-训练报告.csv`)
  }
  const exportReportJson = () => {
    if (!report || !data) return
    const safeTitle = data.session.title.replace(/[\\/:*?"<>|]/g, '_')
    saveBlobDownload(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }), `${safeTitle}-训练报告.json`)
  }
  const submitGroupChange = async () => {
    const stageId = groupChangeParticipant?.activeStageId || data?.session.activeUnits[0]?.stageId
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

  if (!data) return <PageFrame width="workbench"><div className={styles.stack}>
    <PageHeader title="训练工作台" description={loadError ? "训练状态暂时无法读取" : "正在准备训练状态…"} />
    {loadError && <Section title="加载失败"><div role="alert" className={styles.stack}>
      <p>{loadError}</p>
      <Button variant="outline" onClick={() => void load()}>重新加载训练</Button>
    </div></Section>}
  </div></PageFrame>
  const status = data.session.status
  const activeStrategy = selectedId ? data.strategy[selectedId] : undefined
  const participantRuntimeGroup = data.participant?.currentGroupId ? (data.session.Groups || []).find(group => group.id === data.participant?.currentGroupId) : undefined
  const participantActiveUnit = participantRuntimeGroup?.StageGroups?.find(unit => ['RUNNING', 'PAUSED'].includes(unit.status))
  const activeStageId = data.participant?.activeStageId || participantActiveUnit?.stageId || data.session.activeUnits[0]?.stageId
  const currentStage = data.session.Stages.find(stage => stage.id === activeStageId)
  const pendingStages = data.session.Stages.filter(stage => stage.Groups.some(unit => unit.status === 'PENDING'))
  const nextPendingStage = pendingStages.find(stage => !currentStage || data.session.Stages.indexOf(stage) > data.session.Stages.indexOf(currentStage))
  const futureStages = pendingStages
  const groupTargetStage = groupChangeMode === 'next_stage' ? futureStages.find(stage => stage.id === groupChangeStageId) : currentStage
  const reportGroupName = (groupId?: string) => data.session.Stages.flatMap(stage => stage.Groups).find(group => group.id === groupId)?.name || (groupId ? groupId : '未分组')
  const reportParticipantName = (participantId: string) => dashboard?.participants.find(item => item.id === participantId)?.user.username || participantId
  const targetedCommandDisabled = commandBusy || ((commandTargetType === 'GROUP' || commandTargetType === 'USER') && !commandTargetId) || (commandTargetType === 'TEAM' && !data.session.teamId)
  const currentUnit = currentStage?.Groups.find(unit => unit.groupId === data.participant?.currentGroupId) || currentStage?.Groups.find(unit => ['RUNNING', 'PAUSED'].includes(unit.status))
  const runningExtraSeconds = currentUnit?.runningSince && status === 'RUNNING' ? Math.max(0, Math.floor((Date.now() - new Date(currentUnit.runningSince).getTime()) / 1000)) : 0
  const currentStageElapsed = (currentUnit?.activeElapsedSeconds || 0) + runningExtraSeconds
  const currentStageLimit = currentUnit?.plannedDurationSeconds || null
  const currentGroupName = data.participant?.currentGroupId ? currentStage?.Groups.find(group => group.groupId === data.participant?.currentGroupId)?.name : null
  const transitionStageRecord = transitionDialog ? data.session.Stages.find(stage => stage.id === transitionDialog.stageId) : undefined
  const transitionIsCurrent = Boolean(transitionStageRecord && transitionStageRecord.id === currentStage?.id)
  const transitionUnit = transitionStageRecord?.Groups.find(unit => ['RUNNING', 'PAUSED'].includes(unit.status)) || transitionStageRecord?.Groups[0]
  const transitionElapsedSeconds = transitionIsCurrent ? currentStageElapsed : transitionUnit?.activeElapsedSeconds || 0
  const transitionPlannedSeconds = transitionUnit?.plannedDurationSeconds || 0
  const transitionCompletionPercent = dashboard?.summary.total
    ? Math.round((dashboard.summary.completed / dashboard.summary.total) * 100)
    : 0
  const transitionNextStage = transitionDialog?.action === 'advance' ? nextPendingStage : undefined
  const currentProblemProgress = selectedId ? data.progress.find(item => item.stageProblemId === selectedId) : undefined
  const activeGroups = (data.session.Groups || []).filter(group => group.status === 'active')
  const groupRuntimeStatus = (group: V2RuntimeGroup) => {
    const activeUnit = group.StageGroups?.find(unit => ['RUNNING', 'PAUSED'].includes(unit.status))
    if (activeUnit) return activeUnit.status
    if (group.StageGroups?.some(unit => unit.status === 'PENDING')) return 'PENDING'
    return 'ENDED'
  }
  const batchTargetStatus: Record<GroupBatchAction, string> = {
    start_all: 'PENDING',
    advance_all: 'RUNNING',
    pause_all: 'RUNNING',
    resume_all: 'PAUSED',
  }
  const batchTargets = batchAction
    ? activeGroups.filter(group => groupRuntimeStatus(group) === batchTargetStatus[batchAction])
    : []
  const batchTargetPeople = batchTargets.reduce((total, group) => total + (group.Participants?.length || 0), 0)
  const batchTargetCount = (action: GroupBatchAction) => activeGroups.filter(group => groupRuntimeStatus(group) === batchTargetStatus[action]).length
  const batchActionTitle: Record<GroupBatchAction, string> = {
    start_all: '确认开始待训练分组',
    advance_all: '确认批量进入下一阶段',
    pause_all: '确认暂停正在训练的分组',
    resume_all: '确认恢复已暂停的分组',
  }
  const batchActionEffect: Record<GroupBatchAction, string> = {
    start_all: '这些分组将从各自的第一个待开始阶段进入训练。',
    advance_all: '这些分组将分别进入自己的下一阶段；已经处于最后阶段的分组会完成训练。',
    pause_all: '这些分组的阶段计时与推进将暂停，已有草稿、提交和进度不会丢失。',
    resume_all: '这些分组将恢复阶段计时，并继续当前阶段。',
  }
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
    <PageHeader
      title={data.session.title}
      description={data.session.description || '训练工作台'}
      actions={<div className={styles.actions}>
        <StatusBadge variant={connectionState === 'connected' ? 'success' : 'warning'}>{connectionState === 'connected' ? '实时连接正常' : connectionState === 'connecting' ? '正在建立实时连接' : '实时连接中断，正在重连'}</StatusBadge>
        {lastSyncedAt && <span className={styles.muted}>最后同步 {new Date(lastSyncedAt).toLocaleTimeString('zh-CN')}</span>}
        <Button size="sm" variant="ghost" onClick={() => void load()}>手动刷新</Button>
        <StatusBadge variant={status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : 'neutral'}>{trainingStatusLabel(status)}</StatusBadge>
      </div>}
    />
    {data.manager && <Section title="各组运行进度" description="各训练组可以独立位于不同阶段；批量操作会先展示影响范围并要求确认。" actions={<div className={styles.actions}><Button variant="secondary" disabled={commandBusy || batchTargetCount('start_all') === 0} onClick={() => setBatchAction('start_all')}>开始 {batchTargetCount('start_all')} 个待开始组</Button><Button variant="secondary" disabled={commandBusy || batchTargetCount('advance_all') === 0} onClick={() => setBatchAction('advance_all')}>推进 {batchTargetCount('advance_all')} 个训练中组</Button><Button variant="ghost" disabled={commandBusy || batchTargetCount('pause_all') === 0} onClick={() => setBatchAction('pause_all')}>暂停 {batchTargetCount('pause_all')} 个训练中组</Button><Button variant="ghost" disabled={commandBusy || batchTargetCount('resume_all') === 0} onClick={() => setBatchAction('resume_all')}>恢复 {batchTargetCount('resume_all')} 个已暂停组</Button></div>}>
      <div className={styles.grid}>{activeGroups.map(group => {
        const runtime = group.StageGroups?.find(unit => ['RUNNING', 'PAUSED'].includes(unit.status)) || group.StageGroups?.slice(-1)[0]
        const stage = data.session.Stages.find(item => item.id === runtime?.stageId)
        const runtimeStatus = runtime?.status || 'PENDING'
        return <article className={styles.card} key={group.id}><div className={styles.actions}><strong>{group.name}</strong><StatusBadge variant={runtimeStatus === 'RUNNING' ? 'success' : runtimeStatus === 'PAUSED' ? 'warning' : 'neutral'}>{stageRuntimeStatusLabel[runtimeStatus] || runtimeStatus}</StatusBadge></div><p>{stage ? stage.name : runtimeStatus === 'ENDED' ? '已完成全部阶段' : '尚未开始'} · {group.Participants?.length || 0} 人</p><p className={styles.muted}>有效训练 {formatDuration(runtime?.activeElapsedSeconds || 0)}</p><div className={styles.actions}>{!runtime?.stageId && runtimeStatus !== 'ENDED' && <Button size="sm" disabled={commandBusy} onClick={() => void runGroupAction('start', group.id)}>开始</Button>}{runtimeStatus === 'RUNNING' && <><Button size="sm" variant="secondary" disabled={commandBusy} onClick={() => void runGroupAction('advance', group.id)}>进入下一阶段</Button><Button size="sm" variant="ghost" disabled={commandBusy} onClick={() => void runGroupAction('pause', group.id)}>暂停本组</Button></>}{runtimeStatus === 'PAUSED' && <Button size="sm" disabled={commandBusy} onClick={() => void runGroupAction('resume', group.id)}>恢复本组</Button>}</div></article>
      })}</div>
    </Section>}
    {currentStage && <Section title={`当前阶段 · ${currentStage.name}`} description={currentStage.description || (data.manager ? '当前课堂阶段的实时状态' : '完成当前要求后等待教师进入下一阶段')}>
      <div className={styles.summary}>
        <StageTimeMetrics activeElapsedSeconds={currentUnit?.activeElapsedSeconds || 0} runningSince={currentUnit?.runningSince} plannedDurationSeconds={currentStageLimit} running={status === 'RUNNING'} />
        {!data.manager && <div className={styles.metric}><strong>{data.participant?.completedCount || 0}/{data.participant?.requiredCount || 0}</strong>当前要求</div>}
        {data.manager && <div className={styles.metric}><strong>{dashboard?.summary.completed || 0}/{dashboard?.summary.total || 0}</strong>学员完成</div>}
        {!data.manager && Boolean(currentGroupName) && <div className={styles.metric}><strong>{currentGroupName || '待分组'}</strong>我的分组</div>}
        {!data.manager && nextScoreGoal != null && <div className={styles.metric}><strong>{currentProblemProgress?.bestScore || 0} → {nextScoreGoal}</strong>当前目标分</div>}
      </div>
    </Section>}
    {data.session.Overlays.filter(item => item.type === 'MESSAGE').map(item => <div className={styles.message} key={item.id}>{item.payload?.message || '教练消息'}</div>)}
    {data.manager && <Section title="教练控制" description="控制会实时发送给学员；切换题目前，系统会先保存学员草稿。"><div className={styles.stack}>
      <div className={styles.targetBar}>
        <label className={styles.field}>控制对象<Select aria-label="教练控制对象" value={commandTargetType} onChange={event => { setCommandTargetType(event.target.value); setCommandTargetId('') }}><option value="ALL">全体学员</option>{Boolean(currentStage?.Groups.length) && <option value="GROUP">当前训练分组</option>}<option value="USER">指定学员</option>{data.session.teamId && <option value="TEAM">当前团队</option>}</Select></label>
        {commandTargetType === 'GROUP' && <label className={styles.field}>分组<Select aria-label="目标分组" value={commandTargetId} onChange={event => setCommandTargetId(event.target.value)}><option value="">请选择</option>{currentStage?.Groups.map(group => <option value={group.groupId} key={group.id}>{group.name}</option>)}</Select></label>}
        {commandTargetType === 'USER' && <label className={styles.field}>学员<Select aria-label="目标学员" value={commandTargetId} onChange={event => setCommandTargetId(event.target.value)}><option value="">请选择</option>{dashboard?.participants.map(item => <option value={item.user.id} key={item.user.id}>{item.user.username}</option>)}</Select></label>}
      </div>
      <div className={styles.actions}>
        {status === 'SCHEDULED' && nextPendingStage && <Button disabled={commandBusy} loading={commandBusy} onClick={() => void transitionStage('start', nextPendingStage.id)}>开始</Button>}
        {status === 'RUNNING' && <><Button variant="secondary" disabled={commandBusy} onClick={() => void command('PAUSE_SESSION', { mode: 'SOFT' }, 'ALL', '')}>暂停提交（可继续编辑）</Button><Button variant="secondary" disabled={commandBusy} onClick={() => void command('PAUSE_SESSION', { mode: 'HARD' }, 'ALL', '')}>暂停提交与编辑</Button></>}
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
      <aside className={styles.rail}>{data.session.Stages.map(stage => <section className={styles.stage} key={stage.id}><div><strong>{stage.name}</strong> {data.manager && <StatusBadge variant={stage.id === activeStageId ? 'success' : 'neutral'}>{stageModeLabel[stage.kind] || stage.kind} · {stage.Groups.map(unit => stageRuntimeStatusLabel[unit.status] || unit.status).join(' / ')}</StatusBadge>}</div>{stage.Groups.some(unit => unit.endedAt) && <small>{stage.Groups.map(unit => `${unit.name}：${Math.floor(unit.activeElapsedSeconds / 60)} 分钟${unit.endReason ? ` · ${unit.endReason}` : ''}`).join('；')}</small>}{data.manager && stage.Groups.some(unit => unit.status === 'PENDING') && ['RUNNING', 'PAUSED'].includes(status) && <Button size="sm" variant="text" onClick={() => { setTransitionDialog({ action: 'skip_pending', stageId: stage.id }); setTransitionReason('') }}>跳过此阶段</Button>}{stage.Problems.map(item => { const access = data.permissions[item.id], progress = data.progress.find(entry => entry.stageProblemId === item.id); return <Button variant="ghost" className={styles.problemButton} data-active={item.id === selectedId} disabled={!access?.canView} key={item.id} onClick={async () => { await saveDraftRef.current(true); setSelectedId(item.id) }}><span><strong>{item.alias || item.Problem.problemId} · {item.Problem.title}</strong><br /><small>{stage.id === activeStageId ? '当前要求' : '本阶段历史'} · {access?.canView ? `${progressLabel[progress?.status || 'NOT_STARTED'] || progress?.status || '未开始'}${progress?.bestScore != null ? ` · ${progress.bestScore} 分` : ''}` : '尚未开放'}{data.manager ? ' · 已固定测试数据' : ''}</small></span></Button>})}</section>)}</aside>
      <main className={styles.stack}>{problem ? <>
        <Section title={`${problem.alias || problem.Problem.problemId} · ${problem.Problem.title}`} description={data.manager ? `${problem.Problem.platform} · ${testDataVersion(problem.TestSetRevision.revisionNumber)}` : '使用训练发布时固定的数据评测'}>{problem.Statements?.find((item) => item.format === 'markdown')?.content ? <MarkdownRenderer content={problem.Statements.find((item) => item.format === 'markdown')!.content!} /> : <p className={styles.muted}>该训练发布时没有可用的 Markdown 题面快照。</p>}</Section>
        <Section title="训练代码" description="每 30 秒自动保存；切换题目、页面离开和收到教练指令前也会保存。">
          <div className={styles.stack}>
            <label className={styles.field}>语言<Select value={language} disabled={!data.permissions[problem.id]?.canEdit} onChange={event => { if (!code || window.confirm('将保留当前代码并切换语言。是否继续？')) handleLanguageChange(event.target.value) }}><option value="cpp17">C++17</option><option value="python3">Python3</option><option value="c">C</option></Select></label>
            <label className={styles.field} htmlFor="training-source-editor">代码草稿<SubmissionCodeEditor id="training-source-editor" value={code} onChange={handleCodeChange} onLocalDraftRestore={handleLocalDraftRestore} language={language} draftKey={editorDraftKey} readOnly={!data.permissions[problem.id]?.canEdit} minHeight={420} aria-describedby="training-draft-status" /></label>
            <SubmissionIoFields value={submissionIo} onChange={handleSubmissionIoChange} disabled={!data.permissions[problem.id]?.canEdit} />
            <p id="training-draft-status" className={styles.muted} aria-live="polite">
              {draftState === 'loading' ? '正在读取草稿…' : draftState === 'saving' ? '正在保存草稿…' : draftState === 'dirty' ? '有尚未同步到服务器的修改' : draftState === 'conflict' ? '检测到本地草稿与云端草稿不一致；当前编辑器保留本地内容。' : draftState === 'error' ? '草稿同步失败，本机副本仍保留；请重试保存' : `草稿已同步${draftRevision ? ` · 版本 ${draftRevision}` : ''}`}
            </p>
            {draftConflict && <section className={styles.draftConflict} role="alert" aria-label="草稿版本冲突">
              <strong>发现两个不同的草稿版本</strong>
              <p>为避免覆盖，当前编辑器继续保留本地内容。请比较后选择保留本地版本或改用云端版本；也可以先下载两个版本。</p>
              <div className={styles.draftCompare}>
                <div><strong>本地草稿</strong><pre>{draftConflict.local.code || '（空草稿）'}</pre></div>
                <div><strong>云端草稿{draftRevision ? ` · 版本 ${draftRevision}` : ''}</strong><pre>{draftConflict.remote.code || '（空草稿）'}</pre></div>
              </div>
              <div className={styles.actions}><Button onClick={keepLocalDraft}>保留本地草稿</Button><Button variant="secondary" onClick={useRemoteDraft}>使用云端草稿</Button><Button variant="ghost" onClick={downloadDraftConflict}>下载冲突副本</Button></div>
            </section>}
            <div className={styles.actions}><Button variant="secondary" loading={saving} disabled={!data.permissions[problem.id]?.canEdit || draftState === 'conflict'} onClick={() => void saveDraft()}>保存草稿</Button><Button loading={submitting} disabled={!data.permissions[problem.id]?.canSubmit || !code.trim() || draftState === 'conflict'} onClick={() => void submit()}>提交评测</Button></div>
            {!data.permissions[problem.id]?.canSubmit && <p className={styles.muted}>当前不可提交：{data.permissions[problem.id]?.reason}</p>}
          </div>
        </Section>
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
      {data.manager && <aside className={`${styles.stack} ${styles.coach}`}><Section title="实时概览"><div className={styles.summary}><div className={styles.metric}><strong>{dashboard?.summary.total || 0}</strong>学员</div><div className={styles.metric}><strong>{dashboard?.summary.working || 0}</strong>进行中</div><div className={styles.metric}><strong>{dashboard?.summary.stuck || 0}</strong>可能卡题</div><div className={styles.metric}><strong>{dashboard?.summary.completed || 0}</strong>完成</div></div></Section><Section title="学员状态" description="优先定位需要干预的学生；分组调整会保留既有提交与历史进度。"><div className={styles.stack}><div className={styles.grid}><label className={styles.field}>搜索学生<Input value={studentQuery} onChange={event => setStudentQuery(event.target.value)} placeholder="用户名" /></label><label className={styles.field}>状态<Select value={studentFilter} onChange={event => setStudentFilter(event.target.value)}><option value="all">全部</option><option value="stuck">可能卡题</option><option value="working">进行中</option><option value="completed">已完成</option><option value="offline">离线</option></Select></label>{Boolean(currentStage?.Groups.length) && <label className={styles.field}>分组<Select value={studentGroupFilter} onChange={event => setStudentGroupFilter(event.target.value)}><option value="all">全部分组</option>{currentStage?.Groups.map(group => <option value={group.groupId} key={group.id}>{group.name}</option>)}</Select></label>}</div><div className={styles.timeline}>{filteredParticipants.map(item => <div className={styles.timelineItem} key={item.id}><strong>{item.user.username}</strong><br /><span className={styles.muted}>{item.online ? '在线' : '离线'} · {item.completedCount}/{item.requiredCount} 题完成{item.currentGroupId ? ` · ${currentStage?.Groups.find(group => group.groupId === item.currentGroupId)?.name || '已分组'}` : ''}</span><div className={styles.actions}>{selectedId && <><Button variant="ghost" disabled={commandBusy} onClick={() => void command('UNLOCK_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>单独解锁</Button><Button variant="ghost" disabled={commandBusy} onClick={() => void command('SKIP_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>允许跳过</Button><Button variant="ghost" disabled={commandBusy || !item.progress.some(progress => progress.status === 'STUCK')} onClick={() => void command('CLEAR_STUCK_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>清除卡题</Button></>}{Boolean(currentStage || futureStages.length > 0) && <Button variant="ghost" disabled={commandBusy} onClick={() => { setGroupChangeParticipant(item); setGroupChangeMode(currentStage ? 'immediate' : 'next_stage'); setGroupChangeStageId(futureStages[0]?.id || ''); setGroupChangeTarget(currentStage ? item.currentGroupId || '' : ''); setGroupChangeReason('') }}>调整分组</Button>}</div></div>)}</div>{filteredParticipants.length === 0 && <p className={styles.muted}>没有符合当前筛选条件的学员。</p>}</div></Section></aside>}
    </div>
    {!data.manager && peerProgress && peerProgress.entries.length > 0 && <Section title="同学训练进度" description={`可见内容：${visibilityLabel[peerProgress.peerVisibility] || peerProgress.peerVisibility} · 排列方式：${rankingLabel[peerProgress.rankingMode] || peerProgress.rankingMode}`}><div className={styles.peerGrid}>{peerProgress.entries.map(item => <article className={styles.peerCard} key={item.user.id}>{item.rank && <span>#{item.rank}</span>}<strong>{item.user.username}</strong><span>完成 {item.completed}/{item.total}</span>{item.score !== undefined && <span>{item.score} 分</span>}{item.penaltyMinutes !== undefined && <span>罚时 {item.penaltyMinutes} 分钟</span>}{item.attempts !== undefined && <span>{item.attempts} 次提交</span>}</article>)}</div></Section>}
    <ConfirmDialog
      isOpen={Boolean(batchAction)}
      onClose={() => setBatchAction(undefined)}
      onConfirm={() => void (async () => {
        if (batchAction && await runGroupBatch(batchAction)) setBatchAction(undefined)
      })()}
      title={batchAction ? batchActionTitle[batchAction] : '确认批量操作'}
      description="批量操作只影响当前处于对应状态的活动分组。"
      message={batchAction ? `将影响 ${batchTargets.length} 个组、${batchTargetPeople} 名学员。${batchActionEffect[batchAction]}` : ''}
      confirmText="确认执行"
      loading={commandBusy}
    />
    <FormDialog isOpen={rosterOpen} onClose={() => setRosterOpen(false)} title="管理基础学员名单" description="基础名单只决定谁参加训练；分组在每个阶段中独立配置。" size="lg" loading={rosterSaving} footer={<><Button variant="secondary" onClick={() => setRosterOpen(false)} disabled={rosterSaving}>取消</Button><Button onClick={() => void saveRosterChanges()} loading={rosterSaving}>保存名单</Button></>}><div className={styles.problemPicker}>{roster?.candidates.map(item => <Checkbox key={item.userId} label={item.displayName} description={`${item.username} · ${item.role}`} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />)}</div></FormDialog>
    <FormDialog isOpen={Boolean(groupChangeParticipant)} onClose={() => setGroupChangeParticipant(undefined)} title="调整训练分组" description="可立即调整当前要求，也可预设下一阶段；既有草稿、提交和历史进度永不删除。" onSubmit={() => void submitGroupChange()} submitText="确认换组" loading={commandBusy} dirty={Boolean(groupChangeReason)}><div className={styles.stack}><p>学员：<strong>{groupChangeParticipant?.user.username}</strong></p><label className={styles.field}>生效方式<Select value={groupChangeMode} onChange={event => { const mode = event.target.value as 'immediate' | 'next_stage'; setGroupChangeMode(mode); setGroupChangeTarget(''); if (mode === 'next_stage') setGroupChangeStageId(futureStages[0]?.id || '') }}><option value="immediate" disabled={!currentStage}>立即应用到当前阶段</option><option value="next_stage" disabled={!futureStages.length}>预设下一阶段</option></Select></label>{groupChangeMode === 'next_stage' && <label className={styles.field}>目标阶段<Select value={groupChangeStageId} onChange={event => { setGroupChangeStageId(event.target.value); setGroupChangeTarget('') }}>{futureStages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</Select></label>}<label className={styles.field}>目标分组<Select value={groupChangeTarget} onChange={event => setGroupChangeTarget(event.target.value)}><option value="">请选择</option>{groupTargetStage?.Groups.map(group => <option key={group.id} value={group.groupId}>{group.name}</option>)}</Select></label><label className={styles.field}>调整原因<Textarea rows={4} maxLength={2000} value={groupChangeReason} onChange={event => setGroupChangeReason(event.target.value)} /></label></div></FormDialog>
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
    <DetailDialog isOpen={reportOpen} onClose={() => setReportOpen(false)} title="训练过程报告" description="按 Stage × Group 时间轴展示每个训练组的真实运行历史。" size="xl">
      <div className={styles.stack}>
        {report && <div className={styles.actions}><Button variant="secondary" onClick={exportReportCsv}>导出学员明细 CSV</Button><Button variant="ghost" onClick={exportReportJson}>导出完整 JSON</Button></div>}
        {report && <Section title="训练汇总"><div className={styles.summary}><div className={styles.metric}><strong>{report.timeline.length}</strong>阶段</div><div className={styles.metric}><strong>{report.participants.length}</strong>学员</div><div className={styles.metric}><strong>{report.groupChanges.length}</strong>换组记录</div></div></Section>}
        {report?.timeline.map(stage => <article className={styles.card} key={stage.id}><h3>{stage.orderIndex + 1}. {stage.name}</h3><div className={styles.timeline}>{stage.groups.map(unit => <div className={styles.timelineItem} key={unit.id}><strong>{unit.groupName} · {unit.status}</strong><br /><span>计划 {formatDuration(unit.plannedDurationSeconds)} · 实际 {formatDuration(unit.actualDurationSeconds)} · {unit.problemIds.length} 题{unit.endReason ? ` · ${unit.endReason}` : ''}</span></div>)}</div>{stage.timeAdjustments.length > 0 && <small>延时记录：{stage.timeAdjustments.map(item => `${formatDuration(item.seconds)}（${item.reason}）`).join('；')}</small>}</article>)}
        {Boolean(report?.groupChanges.length) && <Section title="换组时间线"><div className={styles.timeline}>{report?.groupChanges.map(change => <div className={styles.timelineItem} key={change.id}><strong>{reportParticipantName(change.participantId)}</strong><br /><span>{reportGroupName(change.fromGroupId || undefined)} → {reportGroupName(change.toGroupId)} · {change.reason} · {new Date(change.createdAt).toLocaleString()}</span></div>)}</div></Section>}
        <div className={styles.grid}>{report?.participants.map(item => <article className={styles.card} key={item.user.id}><h3>{item.user.username}</h3><p>{item.group.name} · 有效训练 {formatDuration(item.activeSeconds)}</p><p>{item.progress.length} 条题目进度</p></article>)}</div>
      </div>
    </DetailDialog>
  </div></PageFrame>
}
