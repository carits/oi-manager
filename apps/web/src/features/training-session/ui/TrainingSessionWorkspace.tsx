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
import { ProblemReferenceLink, ProblemReferenceSelector, type SelectedCanonicalProblem } from '@/features/problem-selection'
import { persistSubmissionDraft, SubmissionCodeEditor, SubmissionIoFields, type SubmissionIoValue } from '@/features/submission'
import {
  appendTrainingRuntimeProblem,
  changeTrainingStageGroup,
  extendTrainingStageTime,
  getTrainingCoachDashboard,
  getTrainingDraft,
  getTrainingPeerProgress,
  getTrainingReport,
  getTrainingRoster,
  getTrainingWorkspace,
  createTrainingHint,
  joinTrainingParticipantRuntime,
  leaveTrainingParticipantRuntime,
  executeTrainingCommand,
  listTrainingHints,
  openTrainingHint,
  recordTrainingStrategy,
  saveTrainingRoster,
  saveTrainingDraft,
  splitTrainingGroup,
  mergeTrainingGroup,
  sendTrainingHeartbeat,
  submitTrainingSolution,
  transitionTrainingStage,
} from '../api/trainingSessionApi'
import { trainingProgressStatusLabel, trainingStageEndReasonLabel, trainingStageKindLabel, trainingStageStatusLabel, trainingStatusLabel } from '@/lib/humanPresentation'
import { csvCell, saveBlobDownload } from '@/lib/download'
import { arbitrateTrainingDraft, type TrainingDraftSnapshot } from '../model/trainingDraftArbitration'
import {
  TrainingAttentionPanel,
  TrainingParticipantDrawer,
  TrainingRuntimeHeader,
  type TrainingDashboardParticipant,
} from './TrainingRuntimePanels'
import styles from './TrainingEngine.module.css'


const visibilityLabel: Record<string, string> = { NONE: '仅自己', PROGRESS: '完成进度', SCORE: '成绩与进度', FULL: '详细进度' }
const rankingLabel: Record<string, string> = { OFF: '不排名', PROGRESS_ONLY: '按完成进度', SCORE: '按得分', ACM_RANKING: '按通过题数和罚时' }
type StageProblem = { id: string; problemId: string; required?: boolean; alias?: string; targetScore?: number; scoreGoals?: Array<{ score: number; allowedSubtaskIds?: number[] }>; timePolicy?: { mode: string; limitSeconds?: number }; stuckPolicy?: { minActiveSeconds: number; minAttempts: number; noImprovementSeconds: number }; allowedSubtaskIds?: number[]; strategyIntervalSeconds?: number; unlockPolicy?: { mode: 'ANY' | 'ALL'; conditions: Array<{ type: string; value?: number }> }; Statements?: Array<{ type?: string; format: string; language?: string | null; content?: string | null; fileUrl?: string | null }>; Problem: { problemId: string; title: string; platform: string } }
type StagePlan = { id: string; groupId?: string | null; name: string; isDefault: boolean; inheritsDefault: boolean; accessPolicy: string; submissionMode: string }
type Stage = { id: string; name: string; description?: string; orderIndex: number; kind: string; mode: string; lifecycle: 'PENDING' | 'RUNNING' | 'ENDED' | 'SKIPPED'; plannedDurationSeconds?: number | null; runningSince?: string | null; activeElapsedSeconds: number; startedAt?: string | null; endedAt?: string | null; endReason?: string | null; Plans: StagePlan[]; Problems: StageProblem[] }
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
type V2RuntimeGroup = { id: string; name: string; orderIndex: number; status: string; Participants?: Array<{ id?: string; userId?: string }> }
type Workspace = { session: { Groups: V2RuntimeGroup[]; settings?: { resultVisibility?: 'LIVE' | 'AFTER_END' | 'TEACHER_PUBLISHED'; resultsPublishedAt?: string | null }; currentStageId?: string | null; currentStage?: { id: string; name: string; orderIndex: number; lifecycle: string } | null; id: string; title: string; description?: string; sessionType: string; status: string; statusRevision: number; pauseMode?: string; rankingMode: string; peerVisibility: string; joinMode: string; teamId?: string; Stages: Stage[]; Overlays: Array<{ id: string; type: string; targetType?: string; targetId?: string; payload?: { message?: string } }> }; manager: boolean; participant?: { id: string; currentProblemId?: string; currentGroupId: string; requiredCount?: number; completedCount?: number; latestGroupChange?: { id: string; fromGroupName?: string | null; toGroupName: string; reason: string; appliedAt?: string | null } | null }; progress: Array<{ stageProblemId: string; status: string; bestScore?: number; attemptCount: number; activeSeconds?: number; continuousActiveSeconds?: number }>; permissions: Record<string, { canSeeMetadata?: boolean; canView: boolean; canSubmit: boolean; canEdit: boolean; reason: string; blockedByStageProblemId?: string }>; strategy: Record<string, StrategyState> }
type Dashboard = { participants: TrainingDashboardParticipant[]; summary: { total: number; working: number; stuck: number; completed: number } }
type Roster = { revision: number; candidates: Array<{ userId: string; username: string; displayName: string; role: string; selected: boolean }> }
type Hint = { id: string; level: number; title?: string; content?: string; opened: boolean; globallyOpenedAt?: string }
type PeerProgress = { rankingMode: string; peerVisibility: string; entries: Array<{ rank?: number; user: { id: string; username: string }; completed: number; total: number; score?: number; attempts?: number; penaltyMinutes?: number; activeSeconds?: number }> }
type TrainingDraft = { code?: string; language?: string; revision?: number; inputFilename?: string | null; outputFilename?: string | null }
type TrainingSubmitResult = { id: number }

const trainingResponseRevision = (value: unknown) => {
  if (!value || typeof value !== 'object') return undefined
  const direct = Reflect.get(value, 'statusRevision')
  if (typeof direct === 'number') return direct
  const session = Reflect.get(value, 'session')
  if (!session || typeof session !== 'object') return undefined
  const nested = Reflect.get(session, 'statusRevision')
  return typeof nested === 'number' ? nested : undefined
}

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
    timeline: Array<{ id: string; name: string; orderIndex: number; kind: string; lifecycle: string; plannedDurationSeconds?: number | null; actualDurationSeconds: number; startedAt?: string | null; endedAt?: string | null; endReason?: string | null; plans: Array<{ id: string; groupId?: string | null; groupName?: string | null; isDefault: boolean; inheritsDefault: boolean; problemIds: string[] }>; groupCompletions?: Array<{ groupId: string; groupName: string; participantCount: number; completedParticipants: number; requiredAssignments: number; completedAssignments: number }>; timeAdjustments: Array<{ id: string; seconds: number; reason: string }> }>
    participants: Array<{ id: string; user: { id: string; username: string }; group: { id: string; name: string }; activeSeconds: number; progress: Array<{ stageProblemId: string; status: string; bestScore?: number | null; attemptCount?: number }> }>
    groupChanges: Array<{ id: string; participantId: string; fromGroupId?: string | null; toGroupId: string; targetStageId?: string | null; effectiveMode?: string; status?: string; reason: string; changedBy: string; appliedAt?: string | null; createdAt: string }>
    rosterEvents: Array<{ id: string; type: string; targetId?: string | null; payload?: { reason?: string; historyMode?: string; groupId?: string }; createdAt: string }>
    runtimeProblems: Array<{ id: string; targetType: string; targetId?: string | null; stageProblemId?: string | null; payload?: { reason?: string; required?: boolean; targetScore?: number; platform?: string; problemId?: string; title?: string }; createdAt: string }>
    interventions: Array<{ id: string; seq: number; type: string; targetType: string; targetId?: string | null; payload?: { message?: string; messageType?: string; stageProblemId?: string; hintId?: string; mode?: string }; createdBy: string; createdAt: string }>
  }

export function TrainingSessionWorkspace({ sessionId }: { sessionId: string }) {
  const toast = useToast(), router = useRouter(), pathname = usePathname()
  const organizationId = useMemo(() => pathname.match(/^\/org\/([^/]+)/)?.[1], [pathname])
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
  const [studentQuery, setStudentQuery] = useState(''), [studentFilter, setStudentFilter] = useState('all'), [studentGroupFilter, setStudentGroupFilter] = useState('all'), [studentProblemFilter, setStudentProblemFilter] = useState('all')
  const [studentSort, setStudentSort] = useState<'name' | 'score' | 'attempts' | 'time' | 'status'>('status'), [batchHintId, setBatchHintId] = useState('')
  const [roster, setRoster] = useState<Roster>(), [rosterOpen, setRosterOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false), [joinUserId, setJoinUserId] = useState(''), [joinGroupId, setJoinGroupId] = useState(''), [joinHistoryMode, setJoinHistoryMode] = useState<'absent' | 'makeup'>('absent'), [joinReason, setJoinReason] = useState('')
  const [leaveParticipant, setLeaveParticipant] = useState<Dashboard['participants'][number]>(), [leaveReason, setLeaveReason] = useState('')
  const [hints, setHints] = useState<Hint[]>([]), [hintOpen, setHintOpen] = useState(false), [hintTitle, setHintTitle] = useState(''), [hintContent, setHintContent] = useState(''), [hintLevel, setHintLevel] = useState(1), [openedHint, setOpenedHint] = useState<Hint>()
  const [hintMode, setHintMode] = useState('MANUAL'), [hintTrigger, setHintTrigger] = useState('')
  const [commandTargetType, setCommandTargetType] = useState('ALL'), [commandTargetId, setCommandTargetId] = useState('')
  const [messageOpen, setMessageOpen] = useState(false), [message, setMessage] = useState(''), [messageType, setMessageType] = useState('INFO')
  const [groupChangeParticipantIds, setGroupChangeParticipantIds] = useState<string[]>([]), [groupChangeTarget, setGroupChangeTarget] = useState(''), [groupChangeReason, setGroupChangeReason] = useState('')
  const [groupChangeMode, setGroupChangeMode] = useState<'immediate' | 'next_stage'>('immediate'), [groupChangeStageId, setGroupChangeStageId] = useState('')
  const [splitSourceGroupId, setSplitSourceGroupId] = useState(''), [splitName, setSplitName] = useState(''), [splitParticipantIds, setSplitParticipantIds] = useState<string[]>([]), [splitReason, setSplitReason] = useState('')
  const [splitMode, setSplitMode] = useState<'immediate' | 'next_stage'>('immediate'), [splitStageId, setSplitStageId] = useState('')
  const [mergeSourceGroupId, setMergeSourceGroupId] = useState(''), [mergeTargetGroupId, setMergeTargetGroupId] = useState(''), [mergeReason, setMergeReason] = useState('')
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>()
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([])
  const [transitionDialog, setTransitionDialog] = useState<{ action: 'advance' | 'skip_pending' | 'end_session'; stageId: string; outcome?: 'completed' | 'ended_early' }>(), [transitionReason, setTransitionReason] = useState('')
  const [extensionOpen, setExtensionOpen] = useState(false), [extensionMinutes, setExtensionMinutes] = useState(10), [extensionReason, setExtensionReason] = useState('')
  const [runtimeProblemOpen, setRuntimeProblemOpen] = useState(false), [runtimeProblems, setRuntimeProblems] = useState<SelectedCanonicalProblem[]>([]), [runtimeProblemTargetType, setRuntimeProblemTargetType] = useState<'ALL' | 'GROUP' | 'USER'>('ALL'), [runtimeProblemTargetId, setRuntimeProblemTargetId] = useState(''), [runtimeProblemRequired, setRuntimeProblemRequired] = useState(true), [runtimeProblemTargetScore, setRuntimeProblemTargetScore] = useState(100), [runtimeProblemReason, setRuntimeProblemReason] = useState('')
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
    if (!selectedId || data?.manager) return
    const heartbeat = () => void sendTrainingHeartbeat(sessionId, { stageProblemId: selectedId, pageVisible: document.visibilityState === 'visible', editorFocused: document.hasFocus() })
    heartbeat()
    const timer = setInterval(heartbeat, 30_000)
    return () => clearInterval(timer)
  }, [data?.manager, selectedId, sessionId])
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
    const query = new URLSearchParams({
      afterSeq: String(cursor.current),
      ...(organizationId ? { organizationId } : {}),
    })
    const source = new EventSource(`/api/training-sessions/${sessionId}/events?${query}`, { withCredentials: true })
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
  }, [load, organizationId, sessionId])

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
      const responseRevision = trainingResponseRevision(response.data)
      if (typeof responseRevision === 'number') statusRevisionRef.current = responseRevision
      await load(); await loadHints(selectedId)
      return true
    } finally {
      commandInFlight.current = false
      setCommandBusy(false)
    }
  }
  const batchCommand = async (type: string, payload: Record<string, unknown> = {}) => {
    if (!data || commandInFlight.current || selectedParticipantIds.length === 0) return false
    commandInFlight.current = true
    setCommandBusy(true)
    try {
      await saveDraftRef.current(true)
      let completed = 0
      for (const participantId of selectedParticipantIds) {
        const participant = dashboard?.participants.find(item => item.id === participantId)
        const targetId = participant?.user.id
        const stageProblemId = participant?.currentProblemId || payload.stageProblemId
        if (!targetId || ((type === 'UNLOCK_FOR_USER' || type === 'SKIP_FOR_USER') && !stageProblemId)) continue
        const response = await executeTrainingCommand(sessionId, {
          type: type as 'PAUSE_SESSION',
          expectedRevision: statusRevisionRef.current ?? data.session.statusRevision,
          targetType: 'USER',
          targetId,
          payload: { ...payload, ...(type === 'UNLOCK_FOR_USER' || type === 'SKIP_FOR_USER' ? { stageProblemId } : {}) },
        })
        if (!response.ok) {
          toast.error('已处理 ' + completed + ' 人，' + participant.user.username + ' 操作失败：' + (response.error.message || '请求失败'))
          return false
        }
        const responseRevision = trainingResponseRevision(response.data)
        if (typeof responseRevision === 'number') statusRevisionRef.current = responseRevision
        completed += 1
      }
      if (completed === 0) { toast.error('所选学员当前没有可执行该操作的题目'); return false }
      await load()
      await loadHints(selectedId)
      setSelectedParticipantIds([])
      toast.success('已向 ' + completed + ' 名学员执行操作')
      return true
    } finally {
      commandInFlight.current = false
      setCommandBusy(false)
    }
  }
  const submitCoachMessage = async () => {
    const success = selectedParticipantIds.length
      ? await batchCommand('SHOW_MESSAGE', { message, messageType })
      : await command('SHOW_MESSAGE', { message, messageType })
    if (success) { setMessageOpen(false); setMessage('') }
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
  const openRuntimeJoin = async () => {
    const response = await getTrainingRoster(sessionId).catch(() => null)
    if (!response) return toast.error('可加入学员加载失败')
    const nextRoster = response as Roster
    setRoster(nextRoster)
    setJoinUserId('')
    setJoinGroupId(data?.session.Groups.find(group => group.status === 'active')?.id || '')
    setJoinHistoryMode('absent')
    setJoinReason('')
    setJoinOpen(true)
  }
  const submitRuntimeJoin = async () => {
    if (!data || !joinUserId || !joinGroupId || !joinReason.trim()) return
    setRosterSaving(true)
    const response = await joinTrainingParticipantRuntime(sessionId, {
      expectedRevision: statusRevisionRef.current ?? data.session.statusRevision,
      userId: joinUserId,
      groupId: joinGroupId,
      historyMode: joinHistoryMode,
      reason: joinReason.trim(),
    })
    setRosterSaving(false)
    if (!response.ok) return toast.error(response.error.message || '加入训练失败')
    toast.success('学员已加入当前阶段；历史阶段处理方式已记录')
    setJoinOpen(false)
    await load()
  }
  const submitRuntimeLeave = async () => {
    if (!data || !leaveParticipant || !leaveReason.trim()) return
    setRosterSaving(true)
    const response = await leaveTrainingParticipantRuntime(sessionId, leaveParticipant.id, {
      expectedRevision: statusRevisionRef.current ?? data.session.statusRevision,
      reason: leaveReason.trim(),
    })
    setRosterSaving(false)
    if (!response.ok) return toast.error(response.error.message || '退出训练失败')
    toast.success('已记录中途退出；该学员的提交和进度仍然保留')
    setLeaveParticipant(undefined)
    setLeaveReason('')
    setSelectedParticipantId(undefined)
    await load()
  }
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
      ...report.participants.flatMap(participant => participant.progress.map(entry => [participant.user.username, participant.group.name, entry.stageProblemId, trainingProgressStatusLabel(entry.status), entry.bestScore ?? 0, entry.attemptCount ?? 0, participant.activeSeconds])),
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
    const stageId = groupChangeMode === 'next_stage' ? groupChangeStageId : data?.session.currentStageId
    if (!data || !stageId || !groupChangeParticipantIds.length || !groupChangeTarget || !groupChangeReason.trim()) return
    setCommandBusy(true)
    const response = await changeTrainingStageGroup(sessionId, stageId, { expectedRevision: statusRevisionRef.current ?? data.session.statusRevision, participantIds: groupChangeParticipantIds, toGroupId: groupChangeTarget, effectiveMode: groupChangeMode, ...(groupChangeMode === 'next_stage' ? { targetStageId: groupChangeStageId } : {}), reason: groupChangeReason.trim() })
    setCommandBusy(false)
    if (!response.ok) return toast.error(response.error.message || '调整分组失败')
    toast.success('已调整 ' + groupChangeParticipantIds.length + ' 名学员的训练分组')
    setGroupChangeParticipantIds([]); setSelectedParticipantIds([]); setGroupChangeTarget(''); setGroupChangeReason(''); setGroupChangeMode('immediate'); setGroupChangeStageId(''); await load()
  }
  const submitSplitGroup = async () => {
    if (!data || !splitSourceGroupId || !splitName.trim() || !splitReason.trim() || (splitMode === 'next_stage' && !splitStageId)) return
    const sourceParticipants = (dashboard?.participants || []).filter(item => item.currentGroupId === splitSourceGroupId)
    if (!splitParticipantIds.length) return toast.error('请至少选择一名学员')
    if (splitParticipantIds.length >= sourceParticipants.length) return toast.error('来源分组必须至少保留一名学员')
    setCommandBusy(true)
    const response = await splitTrainingGroup(sessionId, {
      expectedRevision: statusRevisionRef.current ?? data.session.statusRevision,
      sourceGroupId: splitSourceGroupId,
      name: splitName.trim(),
      participantIds: splitParticipantIds,
      effectiveMode: splitMode,
      ...(splitMode === 'next_stage' ? { targetStageId: splitStageId } : {}),
      reason: splitReason.trim(),
    })
    setCommandBusy(false)
    if (!response.ok) return toast.error(response.error.message || '拆组失败')
    toast.success(splitMode === 'next_stage' ? '新分组已建立，将在目标阶段开始时生效' : '新分组已建立，所有学员仍处于当前阶段')
    setSplitSourceGroupId(''); setSplitName(''); setSplitParticipantIds([]); setSplitReason(''); setSplitMode('immediate'); setSplitStageId('')
    await load()
  }
  const submitMergeGroup = async () => {
    if (!data || !mergeSourceGroupId || !mergeTargetGroupId || !mergeReason.trim()) return
    setCommandBusy(true)
    const response = await mergeTrainingGroup(sessionId, {
      expectedRevision: statusRevisionRef.current ?? data.session.statusRevision,
      sourceGroupId: mergeSourceGroupId,
      targetGroupId: mergeTargetGroupId,
      reason: mergeReason.trim(),
    })
    setCommandBusy(false)
    if (!response.ok) return toast.error(response.error.message || '合组失败')
    toast.success('分组已合并，历史进度和提交均已保留')
    setMergeSourceGroupId(''); setMergeTargetGroupId(''); setMergeReason('')
    await load()
  }
  const submitRuntimeProblems = async () => {
    if (!data || !currentStage || !runtimeProblems.length || !runtimeProblemReason.trim()) return
    if (runtimeProblemTargetType !== 'ALL' && !runtimeProblemTargetId) return toast.error('请选择临时加题对象')
    setCommandBusy(true)
    let expectedRevision = statusRevisionRef.current ?? data.session.statusRevision
    for (const selected of runtimeProblems) {
      const target = runtimeProblemTargetType === 'ALL'
        ? { targetType: 'ALL' as const }
        : runtimeProblemTargetType === 'GROUP'
          ? { targetType: 'GROUP' as const, targetId: runtimeProblemTargetId }
          : { targetType: 'USER' as const, targetId: runtimeProblemTargetId }
      const response = await appendTrainingRuntimeProblem(sessionId, currentStage.id, {
        expectedRevision,
        ...target,
        problemId: selected.id,
        required: runtimeProblemRequired,
        targetScore: runtimeProblemTargetScore,
        reason: runtimeProblemReason.trim(),
      })
      if (!response.ok) {
        setCommandBusy(false)
        toast.error(response.error.message || '追加训练题失败')
        await load()
        return
      }
      expectedRevision = response.data.session.statusRevision
    }
    setCommandBusy(false)
    toast.success('临时训练题已追加，原始阶段快照保持不变')
    setRuntimeProblemOpen(false)
    setRuntimeProblems([])
    setRuntimeProblemTargetType('ALL')
    setRuntimeProblemTargetId('')
    setRuntimeProblemRequired(true)
    setRuntimeProblemTargetScore(100)
    setRuntimeProblemReason('')
    await load()
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
  const activeStageId = data.session.currentStageId || undefined
  const currentStage = data.session.Stages.find(stage => stage.id === activeStageId)
  const examActive = currentStage?.mode === 'EXAM'
  const resultVisibility = data.session.settings?.resultVisibility || (examActive ? 'AFTER_END' : 'LIVE')
  const resultsPublished = resultVisibility !== 'TEACHER_PUBLISHED' || Boolean(data.session.settings?.resultsPublishedAt)
  const examTitle = data.session.sessionType === 'ACM' ? 'ACM 模拟赛' : data.session.sessionType === 'OI' ? 'OI 模拟测试' : '模拟测试'
  const pendingStages = data.session.Stages.filter(stage => stage.lifecycle === 'PENDING')
  const nextPendingStage = pendingStages.find(stage => !currentStage || data.session.Stages.indexOf(stage) > data.session.Stages.indexOf(currentStage))
  const futureStages = pendingStages
  const groupTargetStage = groupChangeMode === 'next_stage' ? futureStages.find(stage => stage.id === groupChangeStageId) : currentStage
  const reportGroupName = (groupId?: string) => data.session.Groups.find(group => group.id === groupId)?.name || (groupId ? groupId : '未分组')
  const reportStageName = (stageId?: string | null) => report?.timeline.find(stage => stage.id === stageId)?.name || '未记录阶段'
  const reportParticipantName = (participantId: string) => dashboard?.participants.find(item => item.id === participantId)?.user.username || participantId
  const reportUserName = (userId?: string | null) => report?.participants.find(item => item.user.id === userId)?.user.username || userId || '未知学员'
  const targetedCommandDisabled = commandBusy || ((commandTargetType === 'GROUP' || commandTargetType === 'USER') && !commandTargetId) || (commandTargetType === 'TEAM' && !data.session.teamId)
  const runningExtraSeconds = currentStage?.runningSince && status === 'RUNNING' ? Math.max(0, Math.floor((Date.now() - new Date(currentStage.runningSince).getTime()) / 1000)) : 0
  const currentStageElapsed = (currentStage?.activeElapsedSeconds || 0) + runningExtraSeconds
  const currentStageLimit = currentStage?.plannedDurationSeconds || null
  const currentGroupName = data.participant?.currentGroupId ? data.session.Groups.find(group => group.id === data.participant?.currentGroupId)?.name : null
  const transitionStageRecord = transitionDialog ? data.session.Stages.find(stage => stage.id === transitionDialog.stageId) : undefined
  const transitionPlannedSeconds = transitionStageRecord?.plannedDurationSeconds || 0
  const transitionElapsedSeconds = (transitionStageRecord?.activeElapsedSeconds || 0) + (transitionStageRecord?.runningSince && transitionStageRecord.lifecycle === 'RUNNING' ? Math.max(0, Math.floor((Date.now() - new Date(transitionStageRecord.runningSince).getTime()) / 1000)) : 0)
  const transitionIsCurrent = transitionStageRecord?.id === data.session.currentStageId
  const transitionCompletionPercent = dashboard?.summary.total
    ? Math.round((dashboard.summary.completed / dashboard.summary.total) * 100)
    : 0
  const transitionNextStage = transitionDialog?.action === 'advance' ? nextPendingStage : undefined
  const currentProblemProgress = selectedId ? data.progress.find(item => item.stageProblemId === selectedId) : undefined
  const scoreGoals = problem?.scoreGoals?.map(goal => goal.score).sort((a, b) => a - b) || []
  const nextScoreGoal = activeStrategy?.nextScoreTarget ?? scoreGoals.find(score => score > (currentProblemProgress?.bestScore || 0))
  const participantMetrics = (item: TrainingDashboardParticipant) => {
    const current = item.progress.find(progress => progress.stageProblemId === item.currentProblemId)
    return {
      current,
      score: current?.bestScore ?? 0,
      attempts: current?.attemptCount ?? 0,
      time: current?.activeSeconds ?? item.activeSeconds ?? 0,
      stuck: item.progress.some(progress => progress.status === 'STUCK'),
    }
  }
  const filteredParticipants = (dashboard?.participants || []).filter(item => {
    const queryMatch = !studentQuery.trim() || item.user.username.toLowerCase().includes(studentQuery.trim().toLowerCase())
    const metrics = participantMetrics(item)
    const statusMatch = studentFilter === 'all'
      || studentFilter === 'stuck' && metrics.stuck
      || studentFilter === 'completed' && item.completed
      || studentFilter === 'working' && !item.completed && item.progress.some(progress => progress.status === 'WORKING')
      || studentFilter === 'offline' && !item.online
    const groupMatch = studentGroupFilter === 'all' || item.currentGroupId === studentGroupFilter
    const problemMatch = studentProblemFilter === 'all' || item.currentProblemId === studentProblemFilter
    return queryMatch && statusMatch && groupMatch && problemMatch
  }).sort((left, right) => {
    const leftMetrics = participantMetrics(left)
    const rightMetrics = participantMetrics(right)
    if (studentSort === 'score') return rightMetrics.score - leftMetrics.score || left.user.username.localeCompare(right.user.username)
    if (studentSort === 'attempts') return rightMetrics.attempts - leftMetrics.attempts || left.user.username.localeCompare(right.user.username)
    if (studentSort === 'time') return rightMetrics.time - leftMetrics.time || left.user.username.localeCompare(right.user.username)
    if (studentSort === 'status') return Number(rightMetrics.stuck) - Number(leftMetrics.stuck) || Number(!right.online) - Number(!left.online) || Number(right.completed) - Number(left.completed) || left.user.username.localeCompare(right.user.username)
    return left.user.username.localeCompare(right.user.username)
  })
  const problemNames = Object.fromEntries(data.session.Stages.flatMap(stage => stage.Problems.map(item => [item.id, `${item.alias || item.Problem.problemId} · ${item.Problem.title}`])))
  const attentionParticipants = [...(dashboard?.participants || [])]
    .filter(item => !item.online || item.progress.some(progress => progress.status === 'STUCK'))
    .sort((left, right) => Number(right.progress.some(progress => progress.status === 'STUCK')) - Number(left.progress.some(progress => progress.status === 'STUCK')))
  const selectedParticipant = dashboard?.participants.find(item => item.id === selectedParticipantId)
  const selectedParticipantStage = currentStage
  const selectedParticipantGroup = selectedParticipant?.currentGroupId ? data.session.Groups.find(group => group.id === selectedParticipant.currentGroupId) : undefined
  const currentStageIndex = currentStage ? data.session.Stages.findIndex(stage => stage.id === currentStage.id) : 0
  const offlineCount = dashboard?.participants.filter(item => !item.online).length || 0
  const openGroupChange = (item: TrainingDashboardParticipant) => {
    setGroupChangeParticipantIds([item.id])
    setGroupChangeMode(currentStage ? 'immediate' : 'next_stage')
    setGroupChangeStageId(futureStages[0]?.id || '')
    setGroupChangeTarget(currentStage ? item.currentGroupId || '' : '')
    setGroupChangeReason('')
  }
  const openBatchGroupChange = () => {
    if (!selectedParticipantIds.length) return
    setGroupChangeParticipantIds(selectedParticipantIds)
    setGroupChangeMode(currentStage ? 'immediate' : 'next_stage')
    setGroupChangeStageId(futureStages[0]?.id || '')
    setGroupChangeTarget('')
    setGroupChangeReason('')
  }
  const interventionLabel: Record<string, string> = {
    FOCUS_PROBLEM: '聚焦题目', END_FOCUS: '结束聚焦', LOCK_PROBLEM: '锁定题目', UNLOCK_PROBLEM: '开放题目',
    ENABLE_SUBMISSION: '恢复提交', DISABLE_SUBMISSION: '禁止提交', OPEN_HINT: '开放提示', CLOSE_HINT: '关闭提示',
    UNLOCK_FOR_USER: '单独解锁', SKIP_FOR_USER: '允许跳题', CLEAR_STUCK_FOR_USER: '清除卡题状态',
    SHOW_MESSAGE: '发送消息', CLEAR_MESSAGE: '清除消息', PAUSE_SESSION: '暂停训练', RESUME_SESSION: '恢复训练',
    PUBLISH_RESULTS: '公布测试成绩',
  }
  const renderRailProblem = (stage: Stage, item: StageProblem, requirementLabel: string) => {
    const access = data.permissions[item.id]
    const progress = data.progress.find(entry => entry.stageProblemId === item.id)
    const blockingProblem = access?.blockedByStageProblemId
      ? stage.Problems.find(problem => problem.id === access.blockedByStageProblemId)
      : undefined
    const lockedLabel = access?.reason === 'SEQUENTIAL_LOCK'
      ? blockingProblem ? `完成 ${blockingProblem.alias || blockingProblem.Problem.problemId} 后开放` : '完成前一道题后开放'
      : access?.reason === 'FOCUS_REQUIRED' || access?.reason === 'FOCUS_LOCK'
        ? '等待教师开放'
        : access?.reason === 'PROBLEM_LOCKED'
          ? '题目暂时锁定'
          : '尚未开放'
    const progressLabel = examActive && !data.manager && stage.id === activeStageId
      ? resultVisibility === 'TEACHER_PUBLISHED' ? resultsPublished ? trainingProgressStatusLabel(progress?.status || 'NOT_STARTED') + (progress?.bestScore != null ? ' · ' + progress.bestScore + ' 分' : '') : '等待教师公布' : resultVisibility === 'LIVE' ? trainingProgressStatusLabel(progress?.status || 'NOT_STARTED') + (progress?.bestScore != null ? ' · ' + progress.bestScore + ' 分' : '') : '结果结束后公布'
      : access?.canView
        ? trainingProgressStatusLabel(progress?.status || 'NOT_STARTED') + (progress?.bestScore != null ? ' · ' + progress.bestScore + ' 分' : '')
        : lockedLabel
    return <Button variant="ghost" className={styles.problemButton} data-active={item.id === selectedId} disabled={!access?.canView} key={item.id} onClick={async () => { await saveDraftRef.current(true); setSelectedId(item.id) }}><span><strong>{item.alias || item.Problem.problemId} · {item.Problem.title}</strong><br /><small>{stage.id === activeStageId ? requirementLabel : '本阶段历史'} · {progressLabel}{data.manager ? ' · 动态 Evolving' : ''}</small></span></Button>
  }
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
    {data.manager && <>
      <TrainingRuntimeHeader
        status={status}
        stageName={currentStage?.name}
        stageIndex={currentStageIndex}
        stageCount={data.session.Stages.length}
        activeElapsedSeconds={currentStage?.activeElapsedSeconds || 0}
        runningSince={currentStage?.runningSince}
        plannedDurationSeconds={currentStageLimit}
        completed={dashboard?.summary.completed || 0}
        total={dashboard?.summary.total || 0}
        stuck={dashboard?.summary.stuck || 0}
        offline={offlineCount}
        hasNextStage={Boolean(nextPendingStage)}
        busy={commandBusy}
        onStart={() => { if (nextPendingStage) void transitionStage('start', nextPendingStage.id) }}
        onPause={() => void command('PAUSE_SESSION', { mode: 'SOFT' }, 'ALL', '')}
        onResume={() => void command('RESUME_SESSION', {}, 'ALL', '')}
        onAdvance={() => {
          if (!currentStage) return
          setTransitionDialog({ action: nextPendingStage ? 'advance' : 'end_session', stageId: currentStage.id, outcome: 'completed' })
          setTransitionReason('')
        }}
      />
      <div className={styles.runtimeOverviewGrid}>
        <TrainingAttentionPanel
          participants={attentionParticipants}
          problemNames={problemNames}
          onOpen={item => setSelectedParticipantId(item.id)}
          onOpenAll={() => document.getElementById('training-participants')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
        <Section title="当前分组" description="所有分组共享同一个阶段时间轴；分组只决定本阶段适用的题目与规则。">
          <div className={styles.runtimeGroupList}>{data.session.Groups.filter(group => group.status === 'active').map(group => {
            const groupParticipants = dashboard?.participants.filter(item => item.currentGroupId === group.id) || []
            const groupCompleted = groupParticipants.filter(item => item.completed).length
            const groupAttention = groupParticipants.filter(item => !item.online || item.progress.some(progress => progress.status === 'STUCK')).length
            const plan = currentStage?.Plans.find(item => item.groupId === group.id) || currentStage?.Plans.find(item => item.isDefault)
            return <article className={styles.runtimeGroupCard} key={group.id}>
              <div><strong>{group.name}</strong><StatusBadge variant={currentStage ? 'success' : 'neutral'}>{currentStage ? '跟随当前阶段' : '等待开始'}</StatusBadge></div>
              <p>{currentStage?.name || '尚未开始'} · {plan?.name || '默认计划'}</p>
              <span>{groupCompleted} / {groupParticipants.length} 完成{groupAttention ? ' · ' + groupAttention + ' 人需要关注' : ''}</span>
              {!['ENDED', 'ARCHIVED'].includes(status) && <div className={styles.actions}>
                {groupParticipants.length > 1 && <Button size="sm" variant="outline" onClick={() => {
                  setSplitSourceGroupId(group.id)
                  setSplitName(group.name + ' · 新组')
                  setSplitParticipantIds([])
                  setSplitReason('')
                }}>拆组</Button>}
                {data.session.Groups.filter(item => item.status === 'active' && item.id !== group.id).length > 0 && <Button size="sm" variant="ghost" onClick={() => {
                  setMergeSourceGroupId(group.id)
                  setMergeTargetGroupId('')
                  setMergeReason('')
                }}>合并到…</Button>}
              </div>}
            </article>
          })}</div>
        </Section>
      </div>
      <section className={styles.classroomControlBar} aria-label="课堂控制">
        <details className={styles.controlDisclosure}>
          <summary>课堂工具</summary>
          <div className={styles.stack}>
            <div className={styles.targetBar}>
              <label className={styles.field}>控制对象<Select aria-label="教练控制对象" value={commandTargetType} onChange={event => { setCommandTargetType(event.target.value); setCommandTargetId('') }}><option value="ALL">全体学员</option>{Boolean(data.session.Groups.length) && <option value="GROUP">当前训练分组</option>}<option value="USER">指定学员</option>{data.session.teamId && <option value="TEAM">当前团队</option>}</Select></label>
              {commandTargetType === 'GROUP' && <label className={styles.field}>分组<Select aria-label="目标分组" value={commandTargetId} onChange={event => setCommandTargetId(event.target.value)}><option value="">请选择</option>{data.session.Groups.filter(group => group.status === 'active').map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</Select></label>}
              {commandTargetType === 'USER' && <label className={styles.field}>学员<Select aria-label="目标学员" value={commandTargetId} onChange={event => setCommandTargetId(event.target.value)}><option value="">请选择</option>{dashboard?.participants.map(item => <option value={item.user.id} key={item.user.id}>{item.user.username}</option>)}</Select></label>}
            </div>
            <div className={styles.actions}>
              {selectedId && status === 'RUNNING' && <><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('FOCUS_PROBLEM', { stageProblemId: selectedId, mode: 'LOCKED_FOCUS' })}>聚焦当前题</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('END_FOCUS')}>结束聚焦</Button></>}
              {status === 'RUNNING' && <><Button variant="outline" disabled={commandBusy} onClick={() => void command('PAUSE_SESSION', { mode: 'SOFT' }, 'ALL', '')}>暂停提交（可继续编辑）</Button><Button variant="outline" disabled={commandBusy} onClick={() => void command('PAUSE_SESSION', { mode: 'HARD' }, 'ALL', '')}>暂停提交与编辑</Button></>}
              {['RUNNING', 'PAUSED'].includes(status) && <><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('DISABLE_SUBMISSION')}>禁止提交</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('ENABLE_SUBMISSION')}>恢复提交</Button><Button variant="outline" disabled={commandBusy} onClick={() => { setExtensionOpen(true); setExtensionMinutes(10); setExtensionReason('') }}>延长阶段</Button><Button variant="outline" disabled={commandBusy} onClick={() => { setRuntimeProblemOpen(true); setRuntimeProblems([]); setRuntimeProblemTargetType('ALL'); setRuntimeProblemTargetId(''); setRuntimeProblemRequired(true); setRuntimeProblemTargetScore(100); setRuntimeProblemReason('') }}>追加训练题</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => { setSelectedParticipantIds([]); setMessageOpen(true) }}>发送消息</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('CLEAR_MESSAGE')}>清除消息</Button></>}
              {resultVisibility === 'TEACHER_PUBLISHED' && !resultsPublished && ['RUNNING', 'PAUSED', 'ENDED'].includes(status) && <Button disabled={commandBusy} onClick={() => void command('PUBLISH_RESULTS', {}, 'ALL', '')}>公布测试成绩</Button>}
              {resultVisibility === 'TEACHER_PUBLISHED' && resultsPublished && <StatusBadge variant="success">成绩已公布</StatusBadge>}
            </div>
          </div>
        </details>
        <details className={styles.controlDisclosure}>
          <summary>课堂管理</summary>
          <div className={styles.actions}>
            {(status === 'DRAFT' || pendingStages.length > 0) && <Button onClick={() => router.push(`${pathname}/design`)}>{status === 'DRAFT' ? '打开训练设计器' : '调整未来阶段'}</Button>}
            {currentStage && ['RUNNING', 'PAUSED'].includes(status) && <Button variant="secondary" onClick={() => router.push(`${pathname}/design?copyStage=${encodeURIComponent(currentStage.id)}`)}>复制当前阶段为未来阶段</Button>}
            {['DRAFT', 'SCHEDULED'].includes(status)
              ? <Button variant="secondary" onClick={() => void openRoster()}>管理发布名单</Button>
              : ['RUNNING', 'PAUSED'].includes(status) && <Button variant="secondary" onClick={() => void openRuntimeJoin()}>加入学员</Button>}
            <Button variant="secondary" onClick={() => void showReport()}>训练报告</Button>
            <Button variant="ghost" onClick={() => void load()}>刷新</Button>
          </div>
        </details>
        {['RUNNING', 'PAUSED'].includes(status) && currentStage && <details className={`${styles.controlDisclosure} ${styles.dangerDisclosure}`}>
          <summary>更多操作</summary>
          <div className={styles.actions}>
            <Button variant="outline" disabled={commandBusy} onClick={() => { setTransitionDialog({ action: nextPendingStage ? 'advance' : 'end_session', stageId: currentStage.id, outcome: 'ended_early' }); setTransitionReason('') }}>提前结束当前阶段</Button>
            {nextPendingStage && <Button variant="outline" disabled={commandBusy} onClick={() => { setTransitionDialog({ action: 'skip_pending', stageId: nextPendingStage.id }); setTransitionReason('') }}>跳过未来阶段</Button>}
            <Button variant="danger" disabled={commandBusy} onClick={() => { setTransitionDialog({ action: 'end_session', stageId: currentStage.id, outcome: 'ended_early' }); setTransitionReason('') }}>结束整场训练</Button>
          </div>
        </details>}
      </section>
    </>}
    {!data.manager && currentStage && <section className={styles.studentMission} aria-label="我的当前训练目标">
      <div className={styles.studentMissionHeader}>
        <div><span>{examActive ? examTitle : '阶段 ' + (currentStageIndex + 1) + ' / ' + data.session.Stages.length}</span><h2>{currentStage.name}</h2></div>
        <StatusBadge variant={status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : 'neutral'}>{trainingStatusLabel(status)}</StatusBadge>
      </div>
      <div className={styles.studentMissionMetrics}>
        <StageTimeMetrics activeElapsedSeconds={currentStage?.activeElapsedSeconds || 0} runningSince={currentStage?.runningSince} plannedDurationSeconds={currentStageLimit} running={status === 'RUNNING'} />
        {examActive ? <div className={styles.metric}><strong>结束后公布</strong>成绩与完成情况</div> : <>
          <div className={styles.metric}><strong>{data.participant?.completedCount || 0} / {data.participant?.requiredCount || 0}</strong>当前要求</div>
          <div className={styles.metric}><strong>{Math.max(0, (data.participant?.requiredCount || 0) - (data.participant?.completedCount || 0))}</strong>还需完成</div>
        </>}
      </div>
      {examActive && <div className={styles.card} role="status">
        <strong>{examTitle}进行中</strong>
        <p className={styles.muted}>题目同时开放；训练提示不可用；同伴进度不可见。{resultVisibility === 'LIVE' ? '成绩提交后立即展示。' : resultVisibility === 'TEACHER_PUBLISHED' ? resultsPublished ? '教师已公布成绩。' : '成绩将在教师公布后展示。' : '成绩将在考试结束后展示。'}</p>
      </div>}
      {data.participant?.latestGroupChange && <div className={styles.card} role="status" aria-live="polite">
        <strong>训练安排已调整</strong>
        <p className={styles.muted}>{data.participant.latestGroupChange.fromGroupName ? data.participant.latestGroupChange.fromGroupName + ' → ' : ''}{data.participant.latestGroupChange.toGroupName} · {data.participant.latestGroupChange.reason}</p>
      </div>}
      {problem && <div className={styles.studentContinue}>
        <div><span>继续</span><strong>{problem.alias || problem.Problem.problemId} · {problem.Problem.title}</strong><small>{examActive ? '已提交记录将在结束后公布' : currentProblemProgress?.bestScore != null ? '当前最高分：' + currentProblemProgress.bestScore + (nextScoreGoal != null ? ' · 目标：' + nextScoreGoal : '') : trainingProgressStatusLabel(currentProblemProgress?.status || 'NOT_STARTED')}</small></div>
        <Button onClick={() => document.getElementById('training-problem-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>继续做题</Button>
      </div>}
    </section>}
    <div className={styles.workspace}>
      <aside className={styles.rail}>{data.session.Stages.map(stage => <section className={styles.stage} key={stage.id}>
        <div><strong>{stage.name}</strong> {data.manager && <StatusBadge variant={stage.id === activeStageId ? 'success' : 'neutral'}>{trainingStageKindLabel(stage.kind)} · {trainingStageStatusLabel(stage.lifecycle)}</StatusBadge>}</div>
        {stage.endedAt && <small>{Math.floor(stage.activeElapsedSeconds / 60)} 分钟{stage.endReason ? ' · ' + trainingStageEndReasonLabel(stage.endReason) : ''}</small>}
        {data.manager && stage.lifecycle === 'PENDING' && ['RUNNING', 'PAUSED'].includes(status) && <Button size="sm" variant="text" onClick={() => { setTransitionDialog({ action: 'skip_pending', stageId: stage.id }); setTransitionReason('') }}>跳过此阶段</Button>}
        {stage.Problems.filter(item => data.manager || data.permissions[item.id]?.canSeeMetadata).some(item => item.required !== false) && <small className={styles.problemGroupLabel}>必做题</small>}
        {stage.Problems.filter(item => data.manager || data.permissions[item.id]?.canSeeMetadata).filter(item => item.required !== false).map(item => renderRailProblem(stage, item, '当前必做'))}
        {stage.Problems.filter(item => data.manager || data.permissions[item.id]?.canSeeMetadata).some(item => item.required === false) && <small className={styles.problemGroupLabel}>选做题</small>}
        {stage.Problems.filter(item => data.manager || data.permissions[item.id]?.canSeeMetadata).filter(item => item.required === false).map(item => renderRailProblem(stage, item, '当前选做'))}
      </section>)}</aside>
      <main id="training-problem-workspace" className={styles.stack}>{problem ? <>
        <Section title={`${problem.alias || problem.Problem.problemId} · ${problem.Problem.title}`} description={data.manager ? `${problem.Problem.platform} · 提交时使用当前 Evolving（缺失时回退 Stable）` : '提交时使用当前训练数据评测'}>{problem.Statements?.find((item) => item.format === 'markdown')?.content ? <MarkdownRenderer content={problem.Statements.find((item) => item.format === 'markdown')!.content!} /> : <p className={styles.muted}>该训练发布时没有可用的 Markdown 题面快照。</p>}</Section>
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
      {data.manager && <aside id="training-participants" className={`${styles.stack} ${styles.coach}`}>
        <Section title="全部学员" description="筛选后点击学员查看详情和课堂干预操作。">
          <div className={styles.stack}>
            <div className={styles.participantFilters}>
              <label className={styles.field}>搜索学生<Input value={studentQuery} onChange={event => setStudentQuery(event.target.value)} placeholder="用户名" /></label>
              <label className={styles.field}>状态<Select value={studentFilter} onChange={event => setStudentFilter(event.target.value)}><option value="all">全部</option><option value="stuck">可能卡题</option><option value="working">进行中</option><option value="completed">已完成</option><option value="offline">离线</option></Select></label>
              {Boolean(data.session.Groups.length) && <label className={styles.field}>分组<Select value={studentGroupFilter} onChange={event => setStudentGroupFilter(event.target.value)}><option value="all">全部分组</option>{data.session.Groups.filter(group => group.status === 'active').map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</Select></label>}
              <label className={styles.field}>当前题<Select value={studentProblemFilter} onChange={event => setStudentProblemFilter(event.target.value)}><option value="all">全部题目</option>{currentStage?.Problems.map(item => <option value={item.id} key={item.id}>{item.alias || item.Problem.problemId} · {item.Problem.title}</option>)}</Select></label>
              <label className={styles.field}>排序<Select value={studentSort} onChange={event => setStudentSort(event.target.value as typeof studentSort)}><option value="status">优先需要关注</option><option value="name">按用户名</option><option value="score">按当前题分数</option><option value="attempts">按提交次数</option><option value="time">按有效用时</option></Select></label>
            </div>
            <div className={styles.actions} role="toolbar" aria-label="批量课堂操作">
              <label className={styles.checkboxLabel}>
                <Input
                  type="checkbox"
                  checked={filteredParticipants.length > 0 && filteredParticipants.every(item => selectedParticipantIds.includes(item.id))}
                  onChange={event => setSelectedParticipantIds(current => event.target.checked
                    ? [...new Set([...current, ...filteredParticipants.map(item => item.id)])]
                    : current.filter(id => !filteredParticipants.some(item => item.id === id)))}
                />
                全选当前筛选（{filteredParticipants.length}）
              </label>
              <Button size="sm" variant="outline" disabled={commandBusy || selectedParticipantIds.length === 0} onClick={() => void batchCommand('UNLOCK_FOR_USER')}>批量解锁当前题</Button>
              <Button size="sm" variant="outline" disabled={commandBusy || selectedParticipantIds.length === 0} onClick={() => void batchCommand('SKIP_FOR_USER')}>批量允许跳过</Button>
              <Button size="sm" variant="outline" disabled={commandBusy || selectedParticipantIds.length === 0} onClick={openBatchGroupChange}>批量调整分组</Button>
              <Select aria-label="批量提示" value={batchHintId} onChange={event => setBatchHintId(event.target.value)} disabled={!hints.length}>
                <option value="">选择提示</option>
                {hints.map(hint => <option key={hint.id} value={hint.id}>{hint.level} 级 · {hint.title || '提示'}</option>)}
              </Select>
              <Button size="sm" variant="outline" disabled={commandBusy || selectedParticipantIds.length === 0 || !batchHintId} onClick={() => void batchCommand('OPEN_HINT', { hintId: batchHintId })}>批量开放提示</Button>
              <Button size="sm" variant="secondary" disabled={commandBusy || selectedParticipantIds.length === 0} onClick={() => { setMessageOpen(true); setMessage('') }}>批量发送消息</Button>
              {selectedParticipantIds.length > 0 && <span className={styles.muted}>已选 {selectedParticipantIds.length} 人</span>}
            </div>
            <div className={styles.participantTableWrap}>
              <div className={styles.participantTable} role="table" aria-label="课堂学员状态">
                <div className={styles.participantTableHeader} role="row">
                  <span /><span>学生</span><span>分组</span><span>当前题</span><span>分数</span><span>提交</span><span>用时</span><span>状态</span>
                </div>
                {filteredParticipants.map(item => {
                  const metrics = participantMetrics(item)
                  const groupName = item.currentGroupId ? data.session.Groups.find(group => group.id === item.currentGroupId)?.name || '已分组' : '未分组'
                  const statusLabel = metrics.stuck ? '卡题' : !item.online ? '离线' : item.completed ? '已完成' : metrics.current ? trainingProgressStatusLabel(metrics.current.status) : '未开始'
                  return <div className={styles.participantTableRow} role="row" key={item.id}>
                    <Input type="checkbox" aria-label={'选择 ' + item.user.username} checked={selectedParticipantIds.includes(item.id)} onChange={event => setSelectedParticipantIds(current => event.target.checked ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))} />
                    <Button variant="ghost" type="button" onClick={() => setSelectedParticipantId(item.id)}><strong>{item.user.username}</strong><small>{item.online ? '在线' : '离线'} · {item.completedCount}/{item.requiredCount} 完成</small></Button>
                    <span>{groupName}</span>
                    <span title={item.currentProblemId ? problemNames[item.currentProblemId] : undefined}>{item.currentProblemId ? problemNames[item.currentProblemId] || '训练题' : '—'}</span>
                    <span>{metrics.current?.bestScore ?? '—'}</span>
                    <span>{metrics.attempts}</span>
                    <span>{formatDuration(metrics.time)}</span>
                    <StatusBadge variant={metrics.stuck ? 'warning' : item.completed ? 'success' : 'neutral'}>{statusLabel}</StatusBadge>
                  </div>
                })}
              </div>
            </div>
            {filteredParticipants.length === 0 && <p className={styles.muted}>没有符合当前筛选条件的学员。</p>}
          </div>
        </Section>
      </aside>}

    </div>
    {!data.manager && peerProgress && peerProgress.entries.length > 0 && <Section title="同学训练进度" description={`可见内容：${visibilityLabel[peerProgress.peerVisibility] || peerProgress.peerVisibility} · 排列方式：${rankingLabel[peerProgress.rankingMode] || peerProgress.rankingMode}`}><div className={styles.peerGrid}>{peerProgress.entries.map(item => <article className={styles.peerCard} key={item.user.id}>{item.rank && <span>#{item.rank}</span>}<strong>{item.user.username}</strong><span>完成 {item.completed}/{item.total}</span>{item.score !== undefined && <span>{item.score} 分</span>}{item.penaltyMinutes !== undefined && <span>罚时 {item.penaltyMinutes} 分钟</span>}{item.attempts !== undefined && <span>{item.attempts} 次提交</span>}</article>)}</div></Section>}
    <TrainingParticipantDrawer
      participant={selectedParticipant}
      stageName={selectedParticipantStage?.name}
      groupName={selectedParticipantGroup?.name}
      problemName={selectedParticipant?.currentProblemId ? problemNames[selectedParticipant.currentProblemId] : undefined}
      busy={commandBusy}
      onClose={() => setSelectedParticipantId(undefined)}
      onViewProblem={() => {
        if (!selectedParticipant?.currentProblemId) return
        void saveDraftRef.current(true).then(saved => {
          if (saved === false) return
          setSelectedId(selectedParticipant.currentProblemId)
          setSelectedParticipantId(undefined)
          window.requestAnimationFrame(() => document.getElementById('training-problem-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
        })
      }}
      onUnlock={() => {
        if (selectedParticipant?.currentProblemId) void command('UNLOCK_FOR_USER', { stageProblemId: selectedParticipant.currentProblemId }, 'USER', selectedParticipant.user.id)
      }}
      onSkip={() => {
        if (selectedParticipant?.currentProblemId) void command('SKIP_FOR_USER', { stageProblemId: selectedParticipant.currentProblemId }, 'USER', selectedParticipant.user.id)
      }}
      onClearStuck={() => {
        const stuckProblem = selectedParticipant?.progress.find(item => item.status === 'STUCK')?.stageProblemId || selectedParticipant?.currentProblemId
        if (stuckProblem && selectedParticipant) void command('CLEAR_STUCK_FOR_USER', { stageProblemId: stuckProblem }, 'USER', selectedParticipant.user.id)
      }}
      onMessage={() => {
        if (!selectedParticipant) return
        setCommandTargetType('USER')
        setCommandTargetId(selectedParticipant.user.id)
        setSelectedParticipantIds([])
        setSelectedParticipantId(undefined)
        setMessageOpen(true)
      }}
      onChangeGroup={() => {
        if (!selectedParticipant) return
        openGroupChange(selectedParticipant)
        setSelectedParticipantId(undefined)
      }}
      onLeave={() => {
        if (!selectedParticipant) return
        setLeaveParticipant(selectedParticipant)
        setLeaveReason('')
      }}
    />
    <FormDialog
      isOpen={joinOpen}
      onClose={() => setJoinOpen(false)}
      title="中途加入训练"
      description="运行中的加入是课堂事件，不会改写发布前名单；加入后从当前全局阶段开始。"
      onSubmit={() => void submitRuntimeJoin()}
      submitText="确认加入"
      loading={rosterSaving}
      dirty={Boolean(joinUserId || joinReason)}
    >
      <div className={styles.stack}>
        <label className={styles.field}>学员<Select value={joinUserId} onChange={event => setJoinUserId(event.target.value)}><option value="">请选择尚未参加的学员</option>{roster?.candidates.filter(item => !item.selected).map(item => <option key={item.userId} value={item.userId}>{item.displayName}（{item.username}）</option>)}</Select></label>
        <label className={styles.field}>加入分组<Select value={joinGroupId} onChange={event => setJoinGroupId(event.target.value)}>{data.session.Groups.filter(group => group.status === 'active').map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>
        <label className={styles.field}>历史阶段处理<Select value={joinHistoryMode} onChange={event => setJoinHistoryMode(event.target.value as 'absent' | 'makeup')}><option value="absent">标记为未参加，不要求补做</option><option value="makeup">保留补做要求记录</option></Select></label>
        <label className={styles.field}>加入原因<Textarea rows={4} maxLength={2000} value={joinReason} onChange={event => setJoinReason(event.target.value)} /></label>
      </div>
    </FormDialog>
    <FormDialog
      isOpen={Boolean(leaveParticipant)}
      onClose={() => { setLeaveParticipant(undefined); setLeaveReason('') }}
      title="记录中途退出"
      description="退出后不再参与当前训练；已有草稿、提交、成绩和报告记录全部保留。"
      onSubmit={() => void submitRuntimeLeave()}
      submitText="确认退出"
      loading={rosterSaving}
      dirty={Boolean(leaveReason)}
    >
      <div className={styles.stack}>
        <p>学员：<strong>{leaveParticipant?.user.username}</strong></p>
        <label className={styles.field}>退出原因<Textarea rows={5} maxLength={2000} value={leaveReason} onChange={event => setLeaveReason(event.target.value)} /></label>
      </div>
    </FormDialog>
    <FormDialog isOpen={rosterOpen} onClose={() => setRosterOpen(false)} title="管理训练学员" description="这里决定谁参加训练；不同阶段的分组方案在训练设计中配置。" size="lg" loading={rosterSaving} footer={<><Button variant="secondary" onClick={() => setRosterOpen(false)} disabled={rosterSaving}>取消</Button><Button onClick={() => void saveRosterChanges()} loading={rosterSaving}>保存名单</Button></>}><div className={styles.problemPicker}>{roster?.candidates.map(item => <Checkbox key={item.userId} label={item.displayName} description={`${item.username} · ${item.role}`} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />)}</div></FormDialog>
    <FormDialog
      isOpen={Boolean(splitSourceGroupId)}
      onClose={() => { setSplitSourceGroupId(''); setSplitName(''); setSplitParticipantIds([]); setSplitReason(''); setSplitMode('immediate'); setSplitStageId('') }}
      title="拆分训练组"
      description="从当前分组选择部分学员建立新组。当前阶段不会改变，既有草稿、提交和进度全部保留。"
      onSubmit={() => void submitSplitGroup()}
      submitText="确认拆组"
      loading={commandBusy}
      dirty={Boolean(splitName || splitParticipantIds.length || splitReason)}
      size="lg"
    >
      <div className={styles.stack}>
        <p>来源分组：<strong>{data.session.Groups.find(group => group.id === splitSourceGroupId)?.name}</strong></p>
        <label className={styles.field}>新分组名称<Input maxLength={100} value={splitName} onChange={event => setSplitName(event.target.value)} /></label>
        <fieldset className={styles.field}>
          <legend>选择移入新组的学员</legend>
          <div className={styles.problemPicker}>
            {(dashboard?.participants || []).filter(item => item.currentGroupId === splitSourceGroupId).map(item => <Checkbox
              key={item.id}
              label={item.user.username}
              description={item.completed ? '已完成当前要求' : item.online ? '训练中' : '当前离线'}
              checked={splitParticipantIds.includes(item.id)}
              onChange={event => setSplitParticipantIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}
            />)}
          </div>
        </fieldset>
        <p className={styles.muted}>已选择 {splitParticipantIds.length} 人；来源组必须至少保留 1 人。</p>
        <label className={styles.field}>生效时间<Select value={splitMode} onChange={event => { setSplitMode(event.target.value as 'immediate' | 'next_stage'); setSplitStageId('') }}><option value="immediate">立即生效</option><option value="next_stage">下一阶段生效</option></Select></label>
        {splitMode === 'next_stage' && <label className={styles.field}>目标阶段<Select value={splitStageId} onChange={event => setSplitStageId(event.target.value)}><option value="">请选择尚未开始的阶段</option>{futureStages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</Select></label>}
        <label className={styles.field}>拆组原因<Textarea rows={4} maxLength={2000} value={splitReason} onChange={event => setSplitReason(event.target.value)} /></label>
      </div>
    </FormDialog>
    <FormDialog
      isOpen={Boolean(mergeSourceGroupId)}
      onClose={() => { setMergeSourceGroupId(''); setMergeTargetGroupId(''); setMergeReason('') }}
      title="合并训练组"
      description="来源组全部学员会进入目标组；来源组归档，所有历史进度和提交继续保留。"
      onSubmit={() => void submitMergeGroup()}
      submitText="确认合并"
      loading={commandBusy}
      dirty={Boolean(mergeTargetGroupId || mergeReason)}
    >
      <div className={styles.stack}>
        <p>来源分组：<strong>{data.session.Groups.find(group => group.id === mergeSourceGroupId)?.name}</strong></p>
        <label className={styles.field}>合并到<Select value={mergeTargetGroupId} onChange={event => setMergeTargetGroupId(event.target.value)}><option value="">请选择目标分组</option>{data.session.Groups.filter(group => group.status === 'active' && group.id !== mergeSourceGroupId).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>
        <label className={styles.field}>合组原因<Textarea rows={4} maxLength={2000} value={mergeReason} onChange={event => setMergeReason(event.target.value)} /></label>
      </div>
    </FormDialog>
    <FormDialog
      isOpen={groupChangeParticipantIds.length > 0}
      onClose={() => setGroupChangeParticipantIds([])}
      title="调整训练分组"
      description="可立即调整当前要求，也可预设下一阶段；既有草稿、提交和历史进度永不删除。"
      onSubmit={() => void submitGroupChange()}
      submitText="确认换组"
      loading={commandBusy}
      dirty={Boolean(groupChangeReason)}
    >
      <div className={styles.stack}>
        <p>学员：<strong>{groupChangeParticipantIds.length === 1 ? dashboard?.participants.find(item => item.id === groupChangeParticipantIds[0])?.user.username : '已选择 ' + groupChangeParticipantIds.length + ' 人'}</strong></p>
        <label className={styles.field}>生效方式<Select value={groupChangeMode} onChange={event => { const mode = event.target.value as 'immediate' | 'next_stage'; setGroupChangeMode(mode); setGroupChangeTarget(''); if (mode === 'next_stage') setGroupChangeStageId(futureStages[0]?.id || '') }}><option value="immediate" disabled={!currentStage}>立即应用到当前阶段</option><option value="next_stage" disabled={!futureStages.length}>预设下一阶段</option></Select></label>
        {groupChangeMode === 'next_stage' && <label className={styles.field}>目标阶段<Select value={groupChangeStageId} onChange={event => { setGroupChangeStageId(event.target.value); setGroupChangeTarget('') }}>{futureStages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</Select></label>}
        <label className={styles.field}>目标分组<Select value={groupChangeTarget} onChange={event => setGroupChangeTarget(event.target.value)}><option value="">请选择</option>{data.session.Groups.filter(group => group.status === 'active').map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>
        <label className={styles.field}>调整原因<Textarea rows={4} maxLength={2000} value={groupChangeReason} onChange={event => setGroupChangeReason(event.target.value)} /></label>
      </div>
    </FormDialog>
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
    <FormDialog
      isOpen={runtimeProblemOpen}
      onClose={() => setRuntimeProblemOpen(false)}
      title="追加训练题"
      description="临时题只影响当前全局阶段和指定对象，不修改阶段启动时的不可变设计快照，并会写入训练报告。"
      onSubmit={() => void submitRuntimeProblems()}
      submitText="确认追加"
      loading={commandBusy}
      dirty={Boolean(runtimeProblems.length || runtimeProblemReason)}
      size="lg"
    >
      <div className={styles.stack}>
        <label className={styles.field}>目标对象<Select value={runtimeProblemTargetType} onChange={event => { setRuntimeProblemTargetType(event.target.value as 'ALL' | 'GROUP' | 'USER'); setRuntimeProblemTargetId('') }}><option value="ALL">全体学员</option><option value="GROUP">指定分组</option><option value="USER">指定学员</option></Select></label>
        {runtimeProblemTargetType === 'GROUP' && <label className={styles.field}>目标分组<Select value={runtimeProblemTargetId} onChange={event => setRuntimeProblemTargetId(event.target.value)}><option value="">请选择</option>{data.session.Groups.filter(group => group.status === 'active').map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>}
        {runtimeProblemTargetType === 'USER' && <label className={styles.field}>目标学员<Select value={runtimeProblemTargetId} onChange={event => setRuntimeProblemTargetId(event.target.value)}><option value="">请选择</option>{dashboard?.participants.map(item => <option key={item.user.id} value={item.user.id}>{item.user.username}</option>)}</Select></label>}
        <ProblemReferenceSelector
          existingProblemIds={runtimeProblems.map(item => item.id)}
          onAdd={problems => setRuntimeProblems(current => [...current, ...problems])}
          label="按平台和题号追加"
          requireStable={false}
        />
        {runtimeProblems.length > 0 && <div className={styles.timeline}>{runtimeProblems.map(item => <div className={styles.timelineItem} key={item.id}><div><ProblemReferenceLink problem={item} /></div><Button size="sm" variant="ghost" onClick={() => setRuntimeProblems(current => current.filter(problem => problem.id !== item.id))}>移除</Button></div>)}</div>}
        <Checkbox label="作为必做题" description="取消后作为选做题，不计入当前完成要求。" checked={runtimeProblemRequired} onChange={event => setRuntimeProblemRequired(event.target.checked)} />
        <label className={styles.field}>目标分<Input type="number" min={0} max={100} value={runtimeProblemTargetScore} onChange={event => setRuntimeProblemTargetScore(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /></label>
        <label className={styles.field}>加题原因<Textarea rows={4} maxLength={2000} value={runtimeProblemReason} onChange={event => setRuntimeProblemReason(event.target.value)} /></label>
      </div>
    </FormDialog>
    <FormDialog isOpen={extensionOpen} onClose={() => setExtensionOpen(false)} title="延长当前阶段" description="延时作为运行记录追加，不会覆盖原计划时长。" onSubmit={() => void extendCurrentStage()} submitText="确认延长" loading={commandBusy} dirty={Boolean(extensionReason)}><div className={styles.stack}><label className={styles.field}>延长分钟数<Input type="number" min={1} max={1440} value={extensionMinutes} onChange={event => setExtensionMinutes(Number(event.target.value))} /></label><label className={styles.field}>原因<Textarea rows={4} maxLength={2000} value={extensionReason} onChange={event => setExtensionReason(event.target.value)} /></label></div></FormDialog>
    <FormDialog isOpen={messageOpen} onClose={() => setMessageOpen(false)} title="发送教练消息" description={selectedParticipantIds.length ? '发送给已选的 ' + selectedParticipantIds.length + ' 名学员' : '发送给：' + (commandTargetType === 'ALL' ? '全体学员' : commandTargetType === 'GROUP' ? '指定分组' : commandTargetType === 'USER' ? '指定学员' : '当前团队')} onSubmit={() => void submitCoachMessage()} submitText="发送消息" dirty={Boolean(message)}><div className={styles.stack}><label className={styles.field}>消息类型<Select value={messageType} onChange={event => setMessageType(event.target.value)}><option value="INFO">信息</option><option value="WARNING">提醒</option><option value="INSTRUCTION">教学指令</option><option value="COUNTDOWN">倒计时</option></Select></label><label className={styles.field}>消息内容<Textarea rows={6} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></label></div></FormDialog>
    <FormDialog isOpen={hintOpen} onClose={() => setHintOpen(false)} title="新增分级提示" onSubmit={() => void createHint()} submitText="创建提示" dirty={Boolean(hintContent)}><div className={styles.stack}><label className={styles.field}>级别<Input type="number" min={1} max={20} value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))} /></label><label className={styles.field}>开放方式<Select value={hintMode} onChange={event => setHintMode(event.target.value)}><option value="MANUAL">教练手动</option><option value="TIME">有效训练时间</option><option value="ATTEMPT">提交次数</option><option value="SCORE">最高分数</option></Select></label>{hintMode !== 'MANUAL' && <label className={styles.field}>{hintMode === 'TIME' ? '触发秒数' : hintMode === 'ATTEMPT' ? '触发提交次数' : '触发分数'}<Input type="number" min={hintMode === 'TIME' ? 60 : hintMode === 'SCORE' ? 0 : 1} max={hintMode === 'TIME' ? 86400 : 100} value={hintTrigger} onChange={event => setHintTrigger(event.target.value)} /></label>}<label className={styles.field}>标题<Input value={hintTitle} onChange={event => setHintTitle(event.target.value)} /></label><label className={styles.field}>内容<Textarea rows={6} value={hintContent} onChange={event => setHintContent(event.target.value)} /></label></div></FormDialog>
    <DetailDialog isOpen={Boolean(openedHint)} onClose={() => setOpenedHint(undefined)} title={`${openedHint?.level || ''} 级提示 · ${openedHint?.title || '提示'}`} size="md"><p>{openedHint?.content}</p></DetailDialog>
    <DetailDialog isOpen={reportOpen} onClose={() => setReportOpen(false)} title="训练过程报告" description="按阶段和训练组展示真实运行历史。" size="xl">
      <div className={styles.stack}>
        {report && <div className={styles.actions}><Button variant="secondary" onClick={exportReportCsv}>导出学员明细 CSV</Button><Button variant="ghost" onClick={exportReportJson}>导出完整 JSON</Button></div>}
        {report && <Section title="训练汇总"><div className={styles.summary}><div className={styles.metric}><strong>{report.timeline.length}</strong>阶段</div><div className={styles.metric}><strong>{report.participants.length}</strong>学员</div><div className={styles.metric}><strong>{report.groupChanges.length}</strong>换组记录</div></div></Section>}
        {report?.timeline.map(stage => <article className={styles.card} key={stage.id}><h3>{stage.orderIndex + 1}. {stage.name}</h3><p>状态：{trainingStageStatusLabel(stage.lifecycle)} · 计划 {formatDuration(stage.plannedDurationSeconds)} · 实际 {formatDuration(stage.actualDurationSeconds)}{stage.endReason ? ' · ' + trainingStageEndReasonLabel(stage.endReason) : ''}</p><div className={styles.timeline}>{stage.plans.map(plan => <div className={styles.timelineItem} key={plan.id}><strong>{plan.groupName || '全班默认'}{plan.isDefault ? ' · 默认计划' : plan.inheritsDefault ? ' · 继承默认' : ' · 独立覆盖'}</strong><br /><span>{plan.problemIds.length} 题</span></div>)}</div>{Boolean(stage.groupCompletions?.length) && <div className={styles.timeline}>{stage.groupCompletions?.map(group => <div className={styles.timelineItem} key={group.groupId}><strong>{group.groupName} · {group.completedParticipants}/{group.participantCount} 人完成</strong><br /><span>计划要求完成 {group.completedAssignments}/{group.requiredAssignments} 项</span></div>)}</div>}{stage.timeAdjustments.length > 0 && <small>延时记录：{stage.timeAdjustments.map(item => formatDuration(item.seconds) + '（' + item.reason + '）').join('；')}</small>}</article>)}
        {Boolean(report?.runtimeProblems.length) && <Section title="临时追加题目"><div className={styles.timeline}>{report?.runtimeProblems.map(item => <div className={styles.timelineItem} key={item.id}><strong>{item.payload?.platform || '题库'} · {item.payload?.problemId || item.stageProblemId} · {item.payload?.title || '训练题'}</strong><br /><span>{item.targetType === 'ALL' ? '全体学员' : item.targetType === 'GROUP' ? '指定分组' : '指定学员'} · {item.payload?.required === false ? '选做' : '必做'} · 目标 {item.payload?.targetScore ?? 100} 分 · {item.payload?.reason || '未记录原因'}</span></div>)}</div></Section>}
        {Boolean(report?.rosterEvents.length) && <Section title="中途加入与退出"><div className={styles.timeline}>{report?.rosterEvents.map(event => <div className={styles.timelineItem} key={event.id}><strong>{event.type.endsWith('.joined') ? '加入训练' : '退出训练'} · {reportUserName(event.targetId)}</strong><br /><span>{event.payload?.reason || '未记录原因'} · {new Date(event.createdAt).toLocaleString()}</span></div>)}</div></Section>}
        {Boolean(report?.groupChanges.length) && <Section title="换组时间线"><div className={styles.timeline}>{report?.groupChanges.map(change => <div className={styles.timelineItem} key={change.id}><strong>{reportParticipantName(change.participantId)}</strong><br /><span>{reportStageName(change.targetStageId)} · {reportGroupName(change.fromGroupId || undefined)} → {reportGroupName(change.toGroupId)} · {change.reason} · {new Date(change.appliedAt || change.createdAt).toLocaleString()}</span></div>)}</div></Section>}
        {Boolean(report?.interventions.length) && <Section title="课堂干预时间线"><div className={styles.timeline}>{report?.interventions.map(item => <div className={styles.timelineItem} key={item.id}><strong>{interventionLabel[item.type] || item.type}</strong><br /><span>{item.targetType === 'ALL' ? '全体学员' : item.targetType === 'GROUP' ? reportGroupName(item.targetId || undefined) : item.targetType === 'USER' ? reportUserName(item.targetId) : '当前团队'}{item.payload?.stageProblemId ? ' · ' + (problemNames[item.payload.stageProblemId] || item.payload.stageProblemId) : ''}{item.payload?.message ? ' · ' + item.payload.message : ''} · {new Date(item.createdAt).toLocaleString()}</span></div>)}</div></Section>}
        <div className={styles.grid}>{report?.participants.map(item => <article className={styles.card} key={item.user.id}><h3>{item.user.username}</h3><p>{item.group.name} · 有效训练 {formatDuration(item.activeSeconds)}</p><p>{item.progress.length} 条题目进度</p></article>)}</div>
      </div>
    </DetailDialog>
  </div></PageFrame>
}
