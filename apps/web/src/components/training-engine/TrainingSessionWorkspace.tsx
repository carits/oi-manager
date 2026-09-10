'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/apiClient'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { StatusBadge } from '@/components/ui/Badge'
import { DetailDialog, FormDialog } from '@/components/ui/Dialogs'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'
import { SubmissionCodeEditor, clearSubmissionDraft } from '@/components/submission/SubmissionCodeEditor'
import { SubmissionIoFields, type SubmissionIoValue } from '@/components/submission/SubmissionIoFields'
import styles from './TrainingEngine.module.css'

type StageProblem = { id: string; problemId: string; alias?: string; targetScore?: number; timeLimitSeconds?: number; allowedSubtaskIds?: number[]; strategyIntervalSeconds?: number; maxContinuousWorkSeconds?: number; forceSwitchOnTimeout?: boolean; unlockPolicy?: { mode: 'ANY' | 'ALL'; conditions: Array<{ type: string; value?: number }> }; Problem: { problemId: string; title: string; platform: string }; TestSetRevision: { revisionNumber: number; mode: string } }
type Stage = { id: string; name: string; description?: string; mode: string; status: string; durationSeconds?: number; minDurationSeconds?: number; advanceMode: string; problemAccessMode: string; submissionMode: string; targetScore?: number; completionThreshold?: number; Problems: StageProblem[] }
type StrategyState = { intervalSeconds?: number; maxContinuousWorkSeconds?: number; forceSwitchOnTimeout: boolean; decisionDue: boolean; switchRecommended: boolean; lastDecision?: { decision: string; createdAt: string } | null }
type Workspace = { session: { id: string; title: string; description?: string; sessionType: string; status: string; statusRevision: number; currentStageId?: string; pauseMode?: string; rankingMode: string; peerVisibility: string; joinMode: string; teamId?: string; Groups: Array<{ id: string; name: string }>; Stages: Stage[]; Overlays: Array<{ id: string; type: string; targetType?: string; targetId?: string; payload?: any }> }; manager: boolean; participant?: { id: string; currentProblemId?: string }; progress: Array<{ stageProblemId: string; status: string; bestScore?: number; attemptCount: number; activeSeconds?: number; continuousActiveSeconds?: number }>; permissions: Record<string, { canView: boolean; canSubmit: boolean; canEdit: boolean; reason: string }>; strategy: Record<string, StrategyState> }
type Dashboard = { participants: Array<{ id: string; user: { id: string; username: string }; online: boolean; currentProblemId?: string; progress: Array<{ status: string }> }>; summary: { total: number; working: number; stuck: number; completed: number } }
type Roster = { revision: number; groups: Array<{ id: string; name: string }>; candidates: Array<{ userId: string; username: string; displayName: string; role: string; selected: boolean; groupId?: string }> }
type Hint = { id: string; level: number; title?: string; content?: string; opened: boolean; globallyOpenedAt?: string }
type PeerProgress = { rankingMode: string; peerVisibility: string; entries: Array<{ rank?: number; user: { id: string; username: string }; completed: number; total: number; score?: number; attempts?: number; activeSeconds?: number }> }

export function TrainingSessionWorkspace({ sessionId }: { sessionId: string }) {
  const toast = useToast(), router = useRouter(), pathname = usePathname()
  const [data, setData] = useState<Workspace>(), [dashboard, setDashboard] = useState<Dashboard>(), [peerProgress, setPeerProgress] = useState<PeerProgress>(), [problemDetail, setProblemDetail] = useState<any>()
  const [selectedId, setSelectedId] = useState<string>(), [code, setCode] = useState(''), [language, setLanguage] = useState('cpp17'), [draftRevision, setDraftRevision] = useState<number>()
  const [submissionIo, setSubmissionIo] = useState<SubmissionIoValue>({ inputFilename: null, outputFilename: null })
  const [saving, setSaving] = useState(false), [submitting, setSubmitting] = useState(false), [commandBusy, setCommandBusy] = useState(false), [rosterSaving, setRosterSaving] = useState(false)
  const [roster, setRoster] = useState<Roster>(), [rosterOpen, setRosterOpen] = useState(false)
  const [hints, setHints] = useState<Hint[]>([]), [hintOpen, setHintOpen] = useState(false), [hintTitle, setHintTitle] = useState(''), [hintContent, setHintContent] = useState(''), [hintLevel, setHintLevel] = useState(1), [openedHint, setOpenedHint] = useState<Hint>()
  const [hintMode, setHintMode] = useState('MANUAL'), [hintTrigger, setHintTrigger] = useState('')
  const [commandTargetType, setCommandTargetType] = useState('ALL'), [commandTargetId, setCommandTargetId] = useState('')
  const [messageOpen, setMessageOpen] = useState(false), [message, setMessage] = useState(''), [messageType, setMessageType] = useState('INFO')
  const [report, setReport] = useState<any[]>(), [reportOpen, setReportOpen] = useState(false)
  const cursor = useRef(0), saveDraftRef = useRef<(quiet?: boolean) => Promise<number | false>>(async () => false)
  const commandInFlight = useRef(false), statusRevisionRef = useRef<number>()

  const load = useCallback(async () => {
    const response = await apiClient.get<Workspace>(`/api/training-sessions/${sessionId}`)
    if (!response.success || !response.data) return toast.error(response.message || '训练加载失败')
    statusRevisionRef.current = response.data.session.statusRevision
    setData(response.data)
    setSelectedId(current => {
      const directed = response.data!.participant?.currentProblemId
      if (directed && response.data!.permissions[directed]?.canView && directed !== current) return directed
      return current && response.data!.permissions[current]?.canView ? current : response.data!.session.Stages.flatMap(stage => stage.Problems).find(problem => response.data!.permissions[problem.id]?.canView)?.id
    })
    if (response.data.manager) {
      const coach = await apiClient.get<Dashboard>(`/api/training-sessions/${sessionId}/coach-dashboard`)
      if (coach.success) setDashboard(coach.data)
    }
    const peers = await apiClient.get<PeerProgress>(`/api/training-sessions/${sessionId}/peer-progress`)
    if (peers.success) setPeerProgress(peers.data)
  }, [sessionId, toast])
  useEffect(() => { void load() }, [load])

  const problem = useMemo(() => data?.session.Stages.flatMap(stage => stage.Problems).find(item => item.id === selectedId), [data, selectedId])
  const draftKey = problem ? `training-draft:${sessionId}:${problem.problemId}` : ''
  const editorDraftKey = problem ? `training-engine:${sessionId}:${problem.id}` : ''
  const loadHints = useCallback(async (id?: string) => {
    if (!id) return setHints([])
    const response = await apiClient.get<Hint[]>(`/api/training-sessions/${sessionId}/problems/${id}/hints`)
    if (response.success) setHints(response.data || [])
  }, [sessionId])
  useEffect(() => {
    if (!problem) return
    void Promise.all([
      apiClient.get<any>(`/api/training-sessions/${sessionId}/drafts/${problem.problemId}`),
      apiClient.get<any>(`/api/problems/${problem.problemId}`),
    ]).then(([draft, detail]) => {
      const local = typeof window !== 'undefined' ? window.localStorage.getItem(draftKey) : null
      setCode(draft.data?.code || local || ''); setLanguage(draft.data?.language || 'cpp17'); setDraftRevision(draft.data?.revision)
      setSubmissionIo({ inputFilename: draft.data?.inputFilename || null, outputFilename: draft.data?.outputFilename || null })
      if (local) window.localStorage.removeItem(draftKey)
      setProblemDetail(detail.success ? detail.data : undefined)
    })
    void loadHints(problem.id)
  }, [draftKey, loadHints, problem?.id, problem?.problemId, sessionId])
  const saveDraft = useCallback(async (quiet = false) => {
    if (!problem) return false
    setSaving(true)
    const response = await apiClient.put<any>(`/api/training-sessions/${sessionId}/drafts/${problem.problemId}`, { code, language, inputFilename: submissionIo.inputFilename, outputFilename: submissionIo.outputFilename, expectedRevision: draftRevision, editorFocused: document.hasFocus() })
    setSaving(false)
    if (!response.success) { if (!quiet) toast.error(response.message || '草稿保存失败'); return false }
    setDraftRevision(response.data?.revision)
    if (draftKey) window.localStorage.removeItem(draftKey)
    if (!quiet) toast.success('草稿已保存')
    return Number(response.data?.revision ?? draftRevision ?? 0)
  }, [code, draftKey, draftRevision, language, problem, sessionId, submissionIo.inputFilename, submissionIo.outputFilename, toast])
  saveDraftRef.current = saveDraft
  useEffect(() => { const timer = setInterval(() => { if (code && problem) void saveDraftRef.current(true) }, 30_000); return () => clearInterval(timer) }, [code, problem])
  useEffect(() => {
    if (!selectedId) return
    const heartbeat = () => void apiClient.post(`/api/training-sessions/${sessionId}/heartbeat`, { stageProblemId: selectedId, pageVisible: document.visibilityState === 'visible', editorFocused: document.hasFocus() })
    heartbeat()
    const timer = setInterval(heartbeat, 30_000)
    return () => clearInterval(timer)
  }, [selectedId, sessionId])
  useEffect(() => {
    if (!problem || !draftKey) return
    const persistOnExit = () => {
      void apiClient.put(`/api/training-sessions/${sessionId}/drafts/${problem.problemId}`, { code, language, inputFilename: submissionIo.inputFilename, outputFilename: submissionIo.outputFilename, expectedRevision: draftRevision, editorFocused: false }, { keepalive: true })
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
    commandInFlight.current = true
    setCommandBusy(true)
    try {
      await saveDraftRef.current(true)
      const response = await apiClient.post<Workspace['session']>(`/api/training-sessions/${sessionId}/commands`, { type, expectedRevision: statusRevisionRef.current ?? data.session.statusRevision, targetType, targetId: targetType === 'ALL' ? null : targetId, payload })
      if (!response.success) { toast.error(response.message || '训练指令失败'); return false }
      if (typeof response.data?.statusRevision === 'number') statusRevisionRef.current = response.data.statusRevision
      await load(); await loadHints(selectedId)
      return true
    } finally {
      commandInFlight.current = false
      setCommandBusy(false)
    }
  }
  const submit = async () => {
    if (!problem || !selectedId) return
    setSubmitting(true)
    const savedRevision = await saveDraftRef.current(true)
    if (savedRevision === false) { setSubmitting(false); return }
    const response = await apiClient.post<any>(`/api/training-sessions/${sessionId}/submit`, { stageProblemId: selectedId, code, language, inputFilename: submissionIo.inputFilename, outputFilename: submissionIo.outputFilename })
    if (!response.success) { setSubmitting(false); return toast.error(response.message || '提交失败') }
    const cleared = await apiClient.put<any>(`/api/training-sessions/${sessionId}/drafts/${problem.problemId}`, { code: '', language, inputFilename: null, outputFilename: null, expectedRevision: savedRevision, editorFocused: false })
    if (cleared.success) setDraftRevision(cleared.data?.revision)
    else toast.warning('提交已成功，但云端草稿未能清空；请刷新后确认')
    clearSubmissionDraft(editorDraftKey, language)
    setCode('')
    setSubmissionIo({ inputFilename: null, outputFilename: null })
    setSubmitting(false)
    toast.success(`提交 #${response.data?.id} 已进入评测队列`)
  }
  const openRoster = async () => { const response = await apiClient.get<Roster>(`/api/training-sessions/${sessionId}/roster`); if (!response.success || !response.data) return toast.error(response.message || '学员名单加载失败'); setRoster(response.data); setRosterOpen(true) }
  const saveRoster = async () => { if (!roster) return; setRosterSaving(true); const response = await apiClient.put(`/api/training-sessions/${sessionId}/roster`, { expectedRevision: roster.revision, groups: roster.groups, participants: roster.candidates.filter(item => item.selected).map(item => ({ userId: item.userId, groupId: item.groupId })) }); setRosterSaving(false); if (!response.success) return toast.error(response.message || '学员名单保存失败'); setRosterOpen(false); await load() }
  const createHint = async () => {
    if (!selectedId) return
    const trigger = Number(hintTrigger) || undefined
    const response = await apiClient.post(`/api/training-sessions/${sessionId}/hints`, { stageProblemId: selectedId, level: hintLevel, title: hintTitle, content: hintContent, openMode: hintMode, triggerSeconds: hintMode === 'TIME' ? trigger : undefined, triggerAttempts: hintMode === 'ATTEMPT' ? trigger : undefined, triggerScore: hintMode === 'SCORE' ? trigger : undefined })
    if (!response.success) return toast.error(response.message || '提示创建失败')
    setHintOpen(false); setHintTitle(''); setHintContent(''); setHintMode('MANUAL'); setHintTrigger(''); await loadHints(selectedId)
  }
  const showReport = async () => { const response = await apiClient.get<any[]>(`/api/training-sessions/${sessionId}/report`); if (!response.success) return toast.error(response.message || '训练报告加载失败'); setReport(response.data || []); setReportOpen(true) }
  const recordStrategy = async (decision: string) => { const response = await apiClient.post(`/api/training-sessions/${sessionId}/strategy-decisions`, { stageProblemId: selectedId, decision }); if (!response.success) toast.error(response.message || '策略记录失败'); else toast.success('策略决策已记录') }

  if (!data) return <PageFrame width="workbench"><PageHeader title="训练工作台" description="正在准备训练状态…" /></PageFrame>
  const status = data.session.status
  const activeStrategy = selectedId ? data.strategy[selectedId] : undefined
  const targetedCommandDisabled = commandBusy || (commandTargetType !== 'ALL' && !commandTargetId)
  return <PageFrame width="workbench"><div className={styles.stack}>
    <PageHeader title={data.session.title} description={data.session.description || '教练训练工作台'} actions={<div className={styles.actions}><StatusBadge variant={status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : 'neutral'}>{status}</StatusBadge></div>} />
    {data.session.Overlays.filter(item => item.type === 'MESSAGE').map(item => <div className={styles.message} key={item.id}>{item.payload?.message || '教练消息'}</div>)}
    {data.manager && <Section title="教练控制" description="命令带 revision 审计并实时推送；学员客户端先保存草稿再应用聚焦。"><div className={styles.stack}>
      <div className={styles.targetBar}>
        <label className={styles.field}>控制对象<Select aria-label="教练控制对象" value={commandTargetType} onChange={event => { setCommandTargetType(event.target.value); setCommandTargetId('') }}><option value="ALL">全体学员</option>{data.session.Groups.length > 0 && <option value="GROUP">指定分组</option>}<option value="USER">指定学员</option>{data.session.teamId && <option value="TEAM">当前团队</option>}</Select></label>
        {commandTargetType === 'GROUP' && <label className={styles.field}>分组<Select aria-label="目标分组" value={commandTargetId} onChange={event => setCommandTargetId(event.target.value)}><option value="">请选择</option>{data.session.Groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</Select></label>}
        {commandTargetType === 'USER' && <label className={styles.field}>学员<Select aria-label="目标学员" value={commandTargetId} onChange={event => setCommandTargetId(event.target.value)}><option value="">请选择</option>{dashboard?.participants.map(item => <option value={item.user.id} key={item.user.id}>{item.user.username}</option>)}</Select></label>}
      </div>
      <div className={styles.actions}>
        {status === 'SCHEDULED' && <Button disabled={commandBusy} loading={commandBusy} onClick={() => void command('START_SESSION', {}, 'ALL', '')}>开始</Button>}
        {status === 'RUNNING' && <><Button variant="secondary" disabled={commandBusy} onClick={() => void command('PAUSE_SESSION', { mode: 'SOFT' }, 'ALL', '')}>软暂停</Button><Button variant="secondary" disabled={commandBusy} onClick={() => void command('PAUSE_SESSION', { mode: 'HARD' }, 'ALL', '')}>硬暂停</Button></>}
        {status === 'PAUSED' && <Button disabled={commandBusy} loading={commandBusy} onClick={() => void command('RESUME_SESSION', {}, 'ALL', '')}>恢复</Button>}
        {status === 'RUNNING' && <><Button variant="secondary" disabled={commandBusy} onClick={() => void command('BACK_STAGE', {}, 'ALL', '')}>上一阶段</Button><Button variant="secondary" disabled={commandBusy} onClick={() => void command('ADVANCE_STAGE', {}, 'ALL', '')}>下一阶段</Button></>}
        {['RUNNING', 'PAUSED'].includes(status) && <Button variant="danger" disabled={commandBusy} onClick={() => void command('END_SESSION', {}, 'ALL', '')}>结束训练</Button>}
        {status === 'DRAFT' && <Button onClick={() => router.push(`${pathname}/design`)}>打开训练设计器</Button>}
        {selectedId && status === 'RUNNING' && <><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('FOCUS_PROBLEM', { stageProblemId: selectedId, mode: 'LOCKED_FOCUS' })}>聚焦当前题</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('END_FOCUS')}>结束聚焦</Button></>}
        {['RUNNING', 'PAUSED'].includes(status) && <><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('DISABLE_SUBMISSION')}>禁止提交</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('ENABLE_SUBMISSION')}>恢复提交</Button><Button variant="outline" disabled={commandBusy} onClick={() => void command('EXTEND_TIME', { seconds: 600 }, 'ALL', '')}>延长 10 分钟</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => setMessageOpen(true)}>广播消息</Button><Button variant="outline" disabled={targetedCommandDisabled} onClick={() => void command('CLEAR_MESSAGE')}>清除消息</Button></>}
        <Button variant="secondary" onClick={() => void openRoster()}>管理学员</Button><Button variant="secondary" onClick={() => void showReport()}>训练报告</Button><Button variant="ghost" onClick={() => void load()}>刷新</Button>
      </div>
    </div></Section>}
    <div className={styles.workspace}>
      <aside className={styles.rail}>{data.session.Stages.map(stage => <section className={styles.stage} key={stage.id}><div><strong>{stage.name}</strong> <StatusBadge variant={stage.id === data.session.currentStageId ? 'success' : 'neutral'}>{stage.mode}</StatusBadge></div>{stage.Problems.map(item => { const access = data.permissions[item.id], progress = data.progress.find(entry => entry.stageProblemId === item.id); return <Button variant="ghost" className={styles.problemButton} data-active={item.id === selectedId} disabled={!access?.canView} key={item.id} onClick={async () => { await saveDraftRef.current(true); setSelectedId(item.id) }}><span><strong>{item.alias || item.Problem.problemId} · {item.Problem.title}</strong><br /><small>{access?.canView ? `${progress?.status || '未开始'}${progress?.bestScore != null ? ` · ${progress.bestScore} 分` : ''}` : '尚未开放'} · R{item.TestSetRevision.revisionNumber}</small></span></Button>})}</section>)}</aside>
      <main className={styles.stack}>{problem ? <>
        <Section title={`${problem.alias || problem.Problem.problemId} · ${problem.Problem.title}`} description={`${problem.Problem.platform} · 固定测试版本 R${problem.TestSetRevision.revisionNumber}`}>{problemDetail?.statements?.find((item: any) => item.format === 'markdown')?.content ? <MarkdownRenderer content={problemDetail.statements.find((item: any) => item.format === 'markdown').content} /> : <p className={styles.muted}>题面尚未就绪，或当前题面不可见。</p>}</Section>
        <Section title="训练代码" description="每 30 秒自动保存；切换题目、页面离开和收到教练指令前也会保存。"><div className={styles.stack}><label className={styles.field}>语言<Select value={language} disabled={!data.permissions[problem.id]?.canEdit} onChange={event => { if (!code || window.confirm('切换后会保存当前语言草稿，并加载目标语言自己的草稿。是否切换？')) setLanguage(event.target.value) }}><option value="cpp17">C++17</option><option value="python3">Python3</option><option value="c">C</option></Select></label><label className={styles.field}>代码草稿<SubmissionCodeEditor value={code} onChange={setCode} language={language} draftKey={editorDraftKey} readOnly={!data.permissions[problem.id]?.canEdit} minHeight={420} /></label><SubmissionIoFields value={submissionIo} onChange={setSubmissionIo} disabled={!data.permissions[problem.id]?.canEdit} /><div className={styles.actions}><Button variant="secondary" loading={saving} disabled={!data.permissions[problem.id]?.canEdit} onClick={() => void saveDraft()}>保存草稿</Button><Button loading={submitting} disabled={!data.permissions[problem.id]?.canSubmit || !code.trim()} onClick={() => void submit()}>提交评测</Button></div>{!data.permissions[problem.id]?.canSubmit && <p className={styles.muted}>当前不可提交：{data.permissions[problem.id]?.reason}</p>}</div></Section>
        {data.session.sessionType === 'ACM' && status === 'RUNNING' && activeStrategy && (activeStrategy.decisionDue || activeStrategy.switchRecommended) && <Section title="策略检查" description={activeStrategy.switchRecommended ? activeStrategy.forceSwitchOnTimeout ? '已达到连续做题上限，请切换到其他题后再回来。' : '当前题已持续较久，建议重新评估是否切题。' : '到了本轮策略复盘时间，请记录你的决定。'}><div className={styles.actions}><Button variant="secondary" onClick={() => void recordStrategy('CONTINUE')}>继续当前题</Button><Button onClick={() => void recordStrategy('SWITCH')}>决定切题</Button></div></Section>}
        <Section title="分级提示" description="提示支持教练手动、训练时间、提交次数或分数条件开放；使用情况会进入训练报告。" actions={data.manager ? <Button variant="secondary" onClick={() => setHintOpen(true)}>新增提示</Button> : undefined}><div className={styles.actions}>{hints.length ? hints.map(hint => data.manager ? <span className={styles.actions} key={hint.id}><Button variant={hint.globallyOpenedAt ? 'secondary' : 'outline'} disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('OPEN_HINT', { hintId: hint.id })}>{hint.level} 级 · {hint.title || '提示'} · 开放</Button><Button variant="ghost" disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('CLOSE_HINT', { hintId: hint.id })}>关闭</Button></span> : <Button key={hint.id} variant="outline" onClick={async () => { const response = await apiClient.post<Hint>(`/api/training-sessions/${sessionId}/hints/${hint.id}/open`, {}); if (response.success && response.data) setOpenedHint(response.data); else toast.error(response.message || '提示尚未开放') }}>{hint.opened ? '再次查看' : '打开'} {hint.level} 级提示</Button>) : <p className={styles.muted}>暂无已开放提示。</p>}</div></Section>
      </> : <Section title="请选择训练题目"><p className={styles.muted}>题目可能尚未按当前阶段开放。</p></Section>}</main>
      {data.manager && <aside className={`${styles.stack} ${styles.coach}`}><Section title="实时概览"><div className={styles.summary}><div className={styles.metric}><strong>{dashboard?.summary.total || 0}</strong>学员</div><div className={styles.metric}><strong>{dashboard?.summary.working || 0}</strong>进行中</div><div className={styles.metric}><strong>{dashboard?.summary.stuck || 0}</strong>可能卡题</div><div className={styles.metric}><strong>{dashboard?.summary.completed || 0}</strong>完成</div></div></Section><Section title="学员状态" description="卡题只作为提醒，教练决定是否解锁或允许跳过。"><div className={styles.timeline}>{dashboard?.participants.map(item => <div className={styles.timelineItem} key={item.id}><strong>{item.user.username}</strong><br /><span className={styles.muted}>{item.online ? '在线' : '离线'} · {item.progress.filter(p => p.status === 'COMPLETED').length} 题完成</span>{selectedId && <div className={styles.actions}><Button variant="ghost" disabled={commandBusy} onClick={() => void command('UNLOCK_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>单独解锁</Button><Button variant="ghost" disabled={commandBusy} onClick={() => void command('SKIP_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>允许跳过</Button></div>}</div>)}</div></Section></aside>}
    </div>
    {!data.manager && peerProgress && peerProgress.entries.length > 0 && <Section title="同学训练进度" description={`可见范围：${peerProgress.peerVisibility} · 展示方式：${peerProgress.rankingMode}`}><div className={styles.peerGrid}>{peerProgress.entries.map(item => <article className={styles.peerCard} key={item.user.id}>{item.rank && <span>#{item.rank}</span>}<strong>{item.user.username}</strong><span>完成 {item.completed}/{item.total}</span>{item.score !== undefined && <span>{item.score} 分</span>}{item.attempts !== undefined && <span>{item.attempts} 次提交</span>}</article>)}</div></Section>}
    <FormDialog isOpen={rosterOpen} onClose={() => setRosterOpen(false)} title="管理训练学员与分组" description="仅可选择当前学校或团队的有效成员。" size="lg" loading={rosterSaving} footer={<><Button variant="secondary" onClick={() => setRosterOpen(false)} disabled={rosterSaving}>取消</Button><Button onClick={() => void saveRoster()} loading={rosterSaving}>保存名单</Button></>}><div className={styles.stack}><div className={styles.actions}>{roster?.groups.map((group, index) => <Input key={group.id} aria-label={`分组 ${index + 1}`} value={group.name} onChange={event => setRoster(current => current ? { ...current, groups: current.groups.map(item => item.id === group.id ? { ...item, name: event.target.value } : item) } : current)} />)}<Button variant="secondary" onClick={() => setRoster(current => current ? { ...current, groups: [...current.groups, { id: `new-${Date.now()}`, name: `分组 ${current.groups.length + 1}` }] } : current)}>新增分组</Button></div><div className={styles.problemPicker}>{roster?.candidates.map(item => <div className={styles.actions} key={item.userId}><Checkbox label={item.displayName} description={`${item.username} · ${item.role}`} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />{item.selected && <Select aria-label={`${item.displayName} 分组`} value={item.groupId || ''} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, groupId: event.target.value || undefined } : candidate) } : current)}><option value="">未分组</option>{roster.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select>}</div>)}</div></div></FormDialog>
    <FormDialog isOpen={messageOpen} onClose={() => setMessageOpen(false)} title="发送教练消息" description={`发送给：${commandTargetType === 'ALL' ? '全体学员' : commandTargetType === 'GROUP' ? '指定分组' : commandTargetType === 'USER' ? '指定学员' : '当前团队'}`} onSubmit={() => void command('SHOW_MESSAGE', { message, messageType }).then(success => { if (success) { setMessageOpen(false); setMessage('') } })} submitText="发送消息" dirty={Boolean(message)}><div className={styles.stack}><label className={styles.field}>消息类型<Select value={messageType} onChange={event => setMessageType(event.target.value)}><option value="INFO">信息</option><option value="WARNING">提醒</option><option value="INSTRUCTION">教学指令</option><option value="COUNTDOWN">倒计时</option></Select></label><label className={styles.field}>消息内容<Textarea rows={6} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></label></div></FormDialog>
    <FormDialog isOpen={hintOpen} onClose={() => setHintOpen(false)} title="新增分级提示" onSubmit={() => void createHint()} submitText="创建提示" dirty={Boolean(hintContent)}><div className={styles.stack}><label className={styles.field}>级别<Input type="number" min={1} max={20} value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))} /></label><label className={styles.field}>开放方式<Select value={hintMode} onChange={event => setHintMode(event.target.value)}><option value="MANUAL">教练手动</option><option value="TIME">有效训练时间</option><option value="ATTEMPT">提交次数</option><option value="SCORE">最高分数</option></Select></label>{hintMode !== 'MANUAL' && <label className={styles.field}>{hintMode === 'TIME' ? '触发秒数' : hintMode === 'ATTEMPT' ? '触发提交次数' : '触发分数'}<Input type="number" min={hintMode === 'TIME' ? 60 : hintMode === 'SCORE' ? 0 : 1} max={hintMode === 'TIME' ? 86400 : 100} value={hintTrigger} onChange={event => setHintTrigger(event.target.value)} /></label>}<label className={styles.field}>标题<Input value={hintTitle} onChange={event => setHintTitle(event.target.value)} /></label><label className={styles.field}>内容<Textarea rows={6} value={hintContent} onChange={event => setHintContent(event.target.value)} /></label></div></FormDialog>
    <DetailDialog isOpen={Boolean(openedHint)} onClose={() => setOpenedHint(undefined)} title={`${openedHint?.level || ''} 级提示 · ${openedHint?.title || '提示'}`} size="md"><p>{openedHint?.content}</p></DetailDialog>
    <DetailDialog isOpen={reportOpen} onClose={() => setReportOpen(false)} title="训练过程报告" description="关注过程、分数演进、提示和卡题，不默认把训练变成排行榜。" size="xl"><div className={styles.grid}>{report?.map(item => <article className={styles.card} key={item.user.id}><h3>{item.user.username}</h3><p>有效训练 {Math.floor(item.activeSeconds / 60)} 分钟</p>{item.problems.map((entry: any) => <div className={styles.timelineItem} key={entry.problemId}><strong>{entry.problemId} · {entry.title}</strong><br /><span>{entry.bestScore ?? 0} 分 · {entry.attemptCount} 次提交 · {entry.hintCount} 次提示 · {entry.status}</span></div>)}</article>)}</div></DetailDialog>
  </div></PageFrame>
}
