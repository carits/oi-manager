'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import styles from './TrainingEngine.module.css'

type StageProblem = { id: string; problemId: string; alias?: string; targetScore?: number; timeLimitSeconds?: number; allowedSubtaskIds?: number[]; strategyIntervalSeconds?: number; maxContinuousWorkSeconds?: number; forceSwitchOnTimeout?: boolean; unlockPolicy?: { mode: 'ANY' | 'ALL'; conditions: Array<{ type: string; value?: number }> }; Problem: { problemId: string; title: string; platform: string }; TestSetRevision: { revisionNumber: number; mode: string } }
type Stage = { id: string; name: string; description?: string; mode: string; status: string; durationSeconds?: number; minDurationSeconds?: number; advanceMode: string; problemAccessMode: string; submissionMode: string; targetScore?: number; completionThreshold?: number; Problems: StageProblem[] }
type StrategyState = { intervalSeconds?: number; maxContinuousWorkSeconds?: number; forceSwitchOnTimeout: boolean; decisionDue: boolean; switchRecommended: boolean; lastDecision?: { decision: string; createdAt: string } | null }
type Workspace = { session: { id: string; title: string; description?: string; sessionType: string; status: string; statusRevision: number; currentStageId?: string; pauseMode?: string; rankingMode: string; peerVisibility: string; joinMode: string; teamId?: string; Groups: Array<{ id: string; name: string }>; Stages: Stage[]; Overlays: Array<{ id: string; type: string; targetType?: string; targetId?: string; payload?: any }> }; manager: boolean; participant?: { id: string; currentProblemId?: string }; progress: Array<{ stageProblemId: string; status: string; bestScore?: number; attemptCount: number; activeSeconds?: number; continuousActiveSeconds?: number }>; permissions: Record<string, { canView: boolean; canSubmit: boolean; canEdit: boolean; reason: string }>; strategy: Record<string, StrategyState> }
type Dashboard = { participants: Array<{ id: string; user: { id: string; username: string }; online: boolean; currentProblemId?: string; progress: Array<{ status: string }> }>; summary: { total: number; working: number; stuck: number; completed: number } }
type Roster = { revision: number; groups: Array<{ id: string; name: string }>; candidates: Array<{ userId: string; username: string; displayName: string; role: string; selected: boolean; groupId?: string }> }
type Hint = { id: string; level: number; title?: string; content?: string; opened: boolean; globallyOpenedAt?: string }
type PeerProgress = { rankingMode: string; peerVisibility: string; entries: Array<{ rank?: number; user: { id: string; username: string }; completed: number; total: number; score?: number; attempts?: number; activeSeconds?: number }> }

const stageDraft = (stage: Stage) => ({ ...stage, Problems: stage.Problems.map(problem => ({ ...problem })) })

export function TrainingSessionWorkspace({ sessionId }: { sessionId: string }) {
  const toast = useToast()
  const [data, setData] = useState<Workspace>(), [dashboard, setDashboard] = useState<Dashboard>(), [peerProgress, setPeerProgress] = useState<PeerProgress>(), [problemDetail, setProblemDetail] = useState<any>()
  const [selectedId, setSelectedId] = useState<string>(), [code, setCode] = useState(''), [language, setLanguage] = useState('cpp17'), [draftRevision, setDraftRevision] = useState<number>()
  const [saving, setSaving] = useState(false), [submitting, setSubmitting] = useState(false), [rosterSaving, setRosterSaving] = useState(false), [structureSaving, setStructureSaving] = useState(false)
  const [roster, setRoster] = useState<Roster>(), [rosterOpen, setRosterOpen] = useState(false), [structure, setStructure] = useState<Stage[]>([]), [structureOpen, setStructureOpen] = useState(false)
  const [hints, setHints] = useState<Hint[]>([]), [hintOpen, setHintOpen] = useState(false), [hintTitle, setHintTitle] = useState(''), [hintContent, setHintContent] = useState(''), [hintLevel, setHintLevel] = useState(1), [openedHint, setOpenedHint] = useState<Hint>()
  const [hintMode, setHintMode] = useState('MANUAL'), [hintTrigger, setHintTrigger] = useState('')
  const [commandTargetType, setCommandTargetType] = useState('ALL'), [commandTargetId, setCommandTargetId] = useState('')
  const [messageOpen, setMessageOpen] = useState(false), [message, setMessage] = useState(''), [messageType, setMessageType] = useState('INFO')
  const [report, setReport] = useState<any[]>(), [reportOpen, setReportOpen] = useState(false)
  const cursor = useRef(0), saveDraftRef = useRef<(quiet?: boolean) => Promise<boolean>>(async () => false)

  const load = useCallback(async () => {
    const response = await apiClient.get<Workspace>(`/api/training-sessions/${sessionId}`)
    if (!response.success || !response.data) return toast.error(response.message || '训练加载失败')
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
      setProblemDetail(detail.success ? detail.data : undefined)
    })
    void loadHints(problem.id)
  }, [draftKey, loadHints, problem?.id, problem?.problemId, sessionId])
  useEffect(() => { if (draftKey && typeof window !== 'undefined') window.localStorage.setItem(draftKey, code) }, [code, draftKey])

  const saveDraft = useCallback(async (quiet = false) => {
    if (!problem) return false
    setSaving(true)
    const response = await apiClient.put<any>(`/api/training-sessions/${sessionId}/drafts/${problem.problemId}`, { code, language, expectedRevision: draftRevision, editorFocused: document.hasFocus() })
    setSaving(false)
    if (!response.success) { if (!quiet) toast.error(response.message || '草稿保存失败'); return false }
    setDraftRevision(response.data?.revision)
    if (draftKey) window.localStorage.removeItem(draftKey)
    if (!quiet) toast.success('草稿已保存')
    return true
  }, [code, draftKey, draftRevision, language, problem, sessionId, toast])
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
      window.localStorage.setItem(draftKey, code)
      void apiClient.put(`/api/training-sessions/${sessionId}/drafts/${problem.problemId}`, { code, language, expectedRevision: draftRevision, editorFocused: false }, { keepalive: true })
    }
    window.addEventListener('pagehide', persistOnExit)
    return () => window.removeEventListener('pagehide', persistOnExit)
  }, [code, draftKey, draftRevision, language, problem, sessionId])
  useEffect(() => {
    const source = new EventSource(`/api/training-sessions/${sessionId}/events?afterSeq=${cursor.current}`, { withCredentials: true })
    source.addEventListener('training', event => { cursor.current = Number((event as MessageEvent).lastEventId || cursor.current); void saveDraftRef.current(true).finally(() => load()) })
    source.addEventListener('resync_required', () => void load())
    return () => source.close()
  }, [load, sessionId])

  const command = async (type: string, payload: Record<string, unknown> = {}, targetType = commandTargetType, targetId = commandTargetId) => {
    if (!data) return false
    await saveDraftRef.current(true)
    const response = await apiClient.post(`/api/training-sessions/${sessionId}/commands`, { type, expectedRevision: data.session.statusRevision, targetType, targetId: targetType === 'ALL' ? null : targetId, payload })
    if (!response.success) { toast.error(response.message || '训练指令失败'); return false }
    await load(); await loadHints(selectedId)
    return true
  }
  const submit = async () => {
    if (!problem || !selectedId) return
    setSubmitting(true); await saveDraftRef.current(true)
    const response = await apiClient.post<any>(`/api/training-sessions/${sessionId}/submit`, { stageProblemId: selectedId, code, language })
    setSubmitting(false)
    if (!response.success) return toast.error(response.message || '提交失败')
    toast.success(`提交 #${response.data?.id} 已进入评测队列`)
  }
  const openRoster = async () => { const response = await apiClient.get<Roster>(`/api/training-sessions/${sessionId}/roster`); if (!response.success || !response.data) return toast.error(response.message || '学员名单加载失败'); setRoster(response.data); setRosterOpen(true) }
  const saveRoster = async () => { if (!roster) return; setRosterSaving(true); const response = await apiClient.put(`/api/training-sessions/${sessionId}/roster`, { expectedRevision: roster.revision, groups: roster.groups, participants: roster.candidates.filter(item => item.selected).map(item => ({ userId: item.userId, groupId: item.groupId })) }); setRosterSaving(false); if (!response.success) return toast.error(response.message || '学员名单保存失败'); setRosterOpen(false); await load() }
  const openStructure = () => { if (!data) return; setStructure(data.session.Stages.map(stageDraft)); setStructureOpen(true) }
  const saveStructure = async () => {
    if (!data) return
    setStructureSaving(true)
    const response = await apiClient.put(`/api/training-sessions/${sessionId}/structure`, { expectedRevision: data.session.statusRevision, title: data.session.title, description: data.session.description, stages: structure.map(stage => ({ name: stage.name, description: stage.description, mode: stage.mode, durationSeconds: stage.durationSeconds || null, minDurationSeconds: stage.minDurationSeconds || null, advanceMode: stage.advanceMode, problemAccessMode: stage.problemAccessMode, submissionMode: stage.submissionMode, targetScore: stage.targetScore ?? null, completionThreshold: stage.completionThreshold || null, problems: stage.Problems.map(item => ({ problemId: item.problemId, alias: item.alias, targetScore: item.targetScore, timeLimitSeconds: item.timeLimitSeconds, allowedSubtaskIds: item.allowedSubtaskIds, unlockPolicy: item.unlockPolicy, strategyIntervalSeconds: item.strategyIntervalSeconds, maxContinuousWorkSeconds: item.maxContinuousWorkSeconds, forceSwitchOnTimeout: item.forceSwitchOnTimeout })) })) })
    setStructureSaving(false)
    if (!response.success) return toast.error(response.message || '阶段保存失败')
    setStructureOpen(false); await load()
  }
  const createHint = async () => {
    if (!selectedId) return
    const trigger = Number(hintTrigger) || undefined
    const response = await apiClient.post(`/api/training-sessions/${sessionId}/hints`, { stageProblemId: selectedId, level: hintLevel, title: hintTitle, content: hintContent, openMode: hintMode, triggerSeconds: hintMode === 'TIME' ? trigger : undefined, triggerAttempts: hintMode === 'ATTEMPT' ? trigger : undefined, triggerScore: hintMode === 'SCORE' ? trigger : undefined })
    if (!response.success) return toast.error(response.message || '提示创建失败')
    setHintOpen(false); setHintTitle(''); setHintContent(''); setHintMode('MANUAL'); setHintTrigger(''); await loadHints(selectedId)
  }
  const showReport = async () => { const response = await apiClient.get<any[]>(`/api/training-sessions/${sessionId}/report`); if (!response.success) return toast.error(response.message || '训练报告加载失败'); setReport(response.data || []); setReportOpen(true) }
  const recordStrategy = async (decision: string) => { const response = await apiClient.post(`/api/training-sessions/${sessionId}/strategy-decisions`, { stageProblemId: selectedId, decision }); if (!response.success) toast.error(response.message || '策略记录失败'); else toast.success('策略决策已记录') }
  const updateStage = (index: number, changes: Partial<Stage>) => setStructure(current => current.map((stage, position) => position === index ? { ...stage, ...changes } : stage))
  const updateStageProblem = (stageIndex: number, stageProblemId: string, changes: Partial<StageProblem>) => setStructure(current => current.map((stage, position) => position === stageIndex ? { ...stage, Problems: stage.Problems.map(item => item.id === stageProblemId ? { ...item, ...changes } : item) } : stage))
  const updateUnlockCondition = (stageIndex: number, item: StageProblem, conditionIndex: number, changes: { type?: string; value?: number }) => {
    const policy = item.unlockPolicy || { mode: 'ANY' as const, conditions: [{ type: 'AC' }] }
    updateStageProblem(stageIndex, item.id, { unlockPolicy: { ...policy, conditions: policy.conditions.map((condition, index) => index === conditionIndex ? { ...condition, ...changes } : condition) } })
  }

  if (!data) return <PageFrame width="workbench"><PageHeader title="训练工作台" description="正在准备训练状态…" /></PageFrame>
  const status = data.session.status
  const activeStrategy = selectedId ? data.strategy[selectedId] : undefined
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
        {status === 'SCHEDULED' && <Button onClick={() => void command('START_SESSION', {}, 'ALL', '')}>开始</Button>}
        {status === 'RUNNING' && <><Button variant="secondary" onClick={() => void command('PAUSE_SESSION', { mode: 'SOFT' }, 'ALL', '')}>软暂停</Button><Button variant="secondary" onClick={() => void command('PAUSE_SESSION', { mode: 'HARD' }, 'ALL', '')}>硬暂停</Button></>}
        {status === 'PAUSED' && <Button onClick={() => void command('RESUME_SESSION', {}, 'ALL', '')}>恢复</Button>}
        {status === 'RUNNING' && <><Button variant="secondary" onClick={() => void command('BACK_STAGE', {}, 'ALL', '')}>上一阶段</Button><Button variant="secondary" onClick={() => void command('ADVANCE_STAGE', {}, 'ALL', '')}>下一阶段</Button></>}
        {['RUNNING', 'PAUSED'].includes(status) && <Button variant="danger" onClick={() => void command('END_SESSION', {}, 'ALL', '')}>结束训练</Button>}
        {status === 'DRAFT' && <><Button variant="secondary" onClick={openStructure}>编辑阶段</Button><Button onClick={async () => { const response = await apiClient.post(`/api/training-sessions/${sessionId}/publish`, { expectedRevision: data.session.statusRevision }); if (!response.success) toast.error(response.message || '发布失败'); else void load() }}>发布训练</Button></>}
        {selectedId && status === 'RUNNING' && <><Button variant="outline" disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('FOCUS_PROBLEM', { stageProblemId: selectedId, mode: 'LOCKED_FOCUS' })}>聚焦当前题</Button><Button variant="outline" disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('END_FOCUS')}>结束聚焦</Button></>}
        {['RUNNING', 'PAUSED'].includes(status) && <><Button variant="outline" disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('DISABLE_SUBMISSION')}>禁止提交</Button><Button variant="outline" disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('ENABLE_SUBMISSION')}>恢复提交</Button><Button variant="outline" onClick={() => void command('EXTEND_TIME', { seconds: 600 }, 'ALL', '')}>延长 10 分钟</Button><Button variant="outline" disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => setMessageOpen(true)}>广播消息</Button><Button variant="outline" disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('CLEAR_MESSAGE')}>清除消息</Button></>}
        <Button variant="secondary" onClick={() => void openRoster()}>管理学员</Button><Button variant="secondary" onClick={() => void showReport()}>训练报告</Button><Button variant="ghost" onClick={() => void load()}>刷新</Button>
      </div>
    </div></Section>}
    <div className={styles.workspace}>
      <aside className={styles.rail}>{data.session.Stages.map(stage => <section className={styles.stage} key={stage.id}><div><strong>{stage.name}</strong> <StatusBadge variant={stage.id === data.session.currentStageId ? 'success' : 'neutral'}>{stage.mode}</StatusBadge></div>{stage.Problems.map(item => { const access = data.permissions[item.id], progress = data.progress.find(entry => entry.stageProblemId === item.id); return <Button variant="ghost" className={styles.problemButton} data-active={item.id === selectedId} disabled={!access?.canView} key={item.id} onClick={async () => { await saveDraftRef.current(true); setSelectedId(item.id) }}><span><strong>{item.alias || item.Problem.problemId} · {item.Problem.title}</strong><br /><small>{access?.canView ? `${progress?.status || '未开始'}${progress?.bestScore != null ? ` · ${progress.bestScore} 分` : ''}` : '尚未开放'} · R{item.TestSetRevision.revisionNumber}</small></span></Button>})}</section>)}</aside>
      <main className={styles.stack}>{problem ? <>
        <Section title={`${problem.alias || problem.Problem.problemId} · ${problem.Problem.title}`} description={`${problem.Problem.platform} · 固定测试版本 R${problem.TestSetRevision.revisionNumber}`}>{problemDetail?.statements?.find((item: any) => item.format === 'markdown')?.content ? <MarkdownRenderer content={problemDetail.statements.find((item: any) => item.format === 'markdown').content} /> : <p className={styles.muted}>题面尚未就绪，或当前题面不可见。</p>}</Section>
        <Section title="训练代码" description="每 30 秒自动保存；切换题目、页面离开和收到教练指令前也会保存。"><div className={styles.stack}><label className={styles.field}>语言<Select value={language} disabled={!data.permissions[problem.id]?.canEdit} onChange={event => setLanguage(event.target.value)}><option value="cpp17">C++17</option><option value="python3">Python3</option><option value="c">C</option></Select></label><label className={styles.field}>代码草稿<Textarea className={styles.editor} spellCheck={false} disabled={!data.permissions[problem.id]?.canEdit} value={code} onChange={event => setCode(event.target.value)} /></label><div className={styles.actions}><Button variant="secondary" loading={saving} disabled={!data.permissions[problem.id]?.canEdit} onClick={() => void saveDraft()}>保存草稿</Button><Button loading={submitting} disabled={!data.permissions[problem.id]?.canSubmit || !code.trim()} onClick={() => void submit()}>提交评测</Button></div>{!data.permissions[problem.id]?.canSubmit && <p className={styles.muted}>当前不可提交：{data.permissions[problem.id]?.reason}</p>}</div></Section>
        {data.session.sessionType === 'ACM' && status === 'RUNNING' && activeStrategy && (activeStrategy.decisionDue || activeStrategy.switchRecommended) && <Section title="策略检查" description={activeStrategy.switchRecommended ? activeStrategy.forceSwitchOnTimeout ? '已达到连续做题上限，请切换到其他题后再回来。' : '当前题已持续较久，建议重新评估是否切题。' : '到了本轮策略复盘时间，请记录你的决定。'}><div className={styles.actions}><Button variant="secondary" onClick={() => void recordStrategy('CONTINUE')}>继续当前题</Button><Button onClick={() => void recordStrategy('SWITCH')}>决定切题</Button></div></Section>}
        <Section title="分级提示" description="提示支持教练手动、训练时间、提交次数或分数条件开放；使用情况会进入训练报告。" actions={data.manager ? <Button variant="secondary" onClick={() => setHintOpen(true)}>新增提示</Button> : undefined}><div className={styles.actions}>{hints.length ? hints.map(hint => data.manager ? <span className={styles.actions} key={hint.id}><Button variant={hint.globallyOpenedAt ? 'secondary' : 'outline'} disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('OPEN_HINT', { hintId: hint.id })}>{hint.level} 级 · {hint.title || '提示'} · 开放</Button><Button variant="ghost" disabled={commandTargetType !== 'ALL' && !commandTargetId} onClick={() => void command('CLOSE_HINT', { hintId: hint.id })}>关闭</Button></span> : <Button key={hint.id} variant="outline" onClick={async () => { const response = await apiClient.post<Hint>(`/api/training-sessions/${sessionId}/hints/${hint.id}/open`, {}); if (response.success && response.data) setOpenedHint(response.data); else toast.error(response.message || '提示尚未开放') }}>{hint.opened ? '再次查看' : '打开'} {hint.level} 级提示</Button>) : <p className={styles.muted}>暂无已开放提示。</p>}</div></Section>
      </> : <Section title="请选择训练题目"><p className={styles.muted}>题目可能尚未按当前阶段开放。</p></Section>}</main>
      {data.manager && <aside className={`${styles.stack} ${styles.coach}`}><Section title="实时概览"><div className={styles.summary}><div className={styles.metric}><strong>{dashboard?.summary.total || 0}</strong>学员</div><div className={styles.metric}><strong>{dashboard?.summary.working || 0}</strong>进行中</div><div className={styles.metric}><strong>{dashboard?.summary.stuck || 0}</strong>可能卡题</div><div className={styles.metric}><strong>{dashboard?.summary.completed || 0}</strong>完成</div></div></Section><Section title="学员状态" description="卡题只作为提醒，教练决定是否解锁或允许跳过。"><div className={styles.timeline}>{dashboard?.participants.map(item => <div className={styles.timelineItem} key={item.id}><strong>{item.user.username}</strong><br /><span className={styles.muted}>{item.online ? '在线' : '离线'} · {item.progress.filter(p => p.status === 'COMPLETED').length} 题完成</span>{selectedId && <div className={styles.actions}><Button variant="ghost" onClick={() => void command('UNLOCK_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>单独解锁</Button><Button variant="ghost" onClick={() => void command('SKIP_FOR_USER', { stageProblemId: selectedId }, 'USER', item.user.id)}>允许跳过</Button></div>}</div>)}</div></Section></aside>}
    </div>
    {!data.manager && peerProgress && peerProgress.entries.length > 0 && <Section title="同学训练进度" description={`可见范围：${peerProgress.peerVisibility} · 展示方式：${peerProgress.rankingMode}`}><div className={styles.peerGrid}>{peerProgress.entries.map(item => <article className={styles.peerCard} key={item.user.id}>{item.rank && <span>#{item.rank}</span>}<strong>{item.user.username}</strong><span>完成 {item.completed}/{item.total}</span>{item.score !== undefined && <span>{item.score} 分</span>}{item.attempts !== undefined && <span>{item.attempts} 次提交</span>}</article>)}</div></Section>}
    <FormDialog isOpen={rosterOpen} onClose={() => setRosterOpen(false)} title="管理训练学员与分组" description="仅可选择当前学校或团队的有效成员。" size="lg" loading={rosterSaving} footer={<><Button variant="secondary" onClick={() => setRosterOpen(false)} disabled={rosterSaving}>取消</Button><Button onClick={() => void saveRoster()} loading={rosterSaving}>保存名单</Button></>}><div className={styles.stack}><div className={styles.actions}>{roster?.groups.map((group, index) => <Input key={group.id} aria-label={`分组 ${index + 1}`} value={group.name} onChange={event => setRoster(current => current ? { ...current, groups: current.groups.map(item => item.id === group.id ? { ...item, name: event.target.value } : item) } : current)} />)}<Button variant="secondary" onClick={() => setRoster(current => current ? { ...current, groups: [...current.groups, { id: `new-${Date.now()}`, name: `分组 ${current.groups.length + 1}` }] } : current)}>新增分组</Button></div><div className={styles.problemPicker}>{roster?.candidates.map(item => <div className={styles.actions} key={item.userId}><Checkbox label={item.displayName} description={`${item.username} · ${item.role}`} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />{item.selected && <Select aria-label={`${item.displayName} 分组`} value={item.groupId || ''} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, groupId: event.target.value || undefined } : candidate) } : current)}><option value="">未分组</option>{roster.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select>}</div>)}</div></div></FormDialog>
    <FormDialog isOpen={structureOpen} onClose={() => setStructureOpen(false)} title="编辑训练阶段" description="可视化配置模式、推进条件、题目解锁、Subtask 投影和策略检查；发布后结构冻结。" size="wide" loading={structureSaving} footer={<><Button variant="secondary" onClick={() => setStructureOpen(false)}>取消</Button><Button onClick={() => void saveStructure()} loading={structureSaving}>保存阶段</Button></>}>
      <div className={styles.stack}>{structure.map((stage, index) => <article className={styles.card} key={stage.id}>
        <div className={styles.actions}><strong>阶段 {index + 1}</strong><Button variant="ghost" disabled={index === 0} onClick={() => setStructure(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}>上移</Button><Button variant="ghost" disabled={index === structure.length - 1} onClick={() => setStructure(current => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next })}>下移</Button><Button variant="danger" disabled={structure.length === 1} onClick={() => setStructure(current => current.filter(item => item.id !== stage.id))}>删除</Button></div>
        <Input aria-label={`阶段 ${index + 1} 名称`} value={stage.name} onChange={event => updateStage(index, { name: event.target.value })} />
        <Textarea aria-label={`阶段 ${index + 1} 说明`} rows={2} value={stage.description || ''} onChange={event => updateStage(index, { description: event.target.value })} />
        <div className={styles.grid}>
          <label className={styles.field}>模式<Select aria-label={`阶段 ${index + 1} 模式`} value={stage.mode} onChange={event => updateStage(index, { mode: event.target.value })}><option value="FREE">自由</option><option value="SEQUENTIAL">顺序</option><option value="FOCUS">聚焦</option><option value="SCORE_PROGRESSIVE">分数递进</option><option value="TEACHING">讲解</option><option value="REVIEW">复盘</option></Select></label>
          <label className={styles.field}>推进<Select aria-label={`阶段 ${index + 1} 推进`} value={stage.advanceMode} onChange={event => updateStage(index, { advanceMode: event.target.value })}><option value="MANUAL">教练手动</option><option value="TIME">达到时长</option><option value="COMPLETION">达到完成度</option><option value="HYBRID">时长且完成度</option></Select></label>
          <label className={styles.field}>题目访问<Select value={stage.problemAccessMode} onChange={event => updateStage(index, { problemAccessMode: event.target.value })}><option value="ALL">全部训练题</option><option value="STAGE_ONLY">仅当前阶段</option><option value="SEQUENTIAL">按顺序解锁</option><option value="FOCUS_ONLY">仅聚焦题</option></Select></label>
          <label className={styles.field}>提交<Select value={stage.submissionMode} onChange={event => updateStage(index, { submissionMode: event.target.value })}><option value="ENABLED">允许提交</option><option value="DISABLED">禁止提交</option></Select></label>
          <label className={styles.field}>阶段时长（秒）<Input type="number" min={60} value={stage.durationSeconds || ''} onChange={event => updateStage(index, { durationSeconds: Number(event.target.value) || undefined })} /></label>
          <label className={styles.field}>最短时长（秒）<Input type="number" min={0} value={stage.minDurationSeconds || ''} onChange={event => updateStage(index, { minDurationSeconds: Number(event.target.value) || undefined })} /></label>
          <label className={styles.field}>完成比例（%）<Input type="number" min={1} max={100} value={stage.completionThreshold || ''} onChange={event => updateStage(index, { completionThreshold: Number(event.target.value) || undefined })} /></label>
          <label className={styles.field}>阶段目标分<Input type="number" min={0} max={100} value={stage.targetScore ?? ''} onChange={event => updateStage(index, { targetScore: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
        </div>
        <div className={styles.stack}>{stage.Problems.map(item => <section className={styles.stageProblemEditor} key={item.id}>
          <strong>{item.alias || item.Problem.problemId} · {item.Problem.title} · 固定 R{item.TestSetRevision.revisionNumber}</strong>
          <div className={styles.grid}>
            <label className={styles.field}>别名<Input value={item.alias || ''} onChange={event => updateStageProblem(index, item.id, { alias: event.target.value })} /></label>
            <label className={styles.field}>目标分<Input type="number" min={0} max={100} value={item.targetScore ?? ''} onChange={event => updateStageProblem(index, item.id, { targetScore: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
            <label className={styles.field}>单题时长（秒）<Input type="number" min={60} value={item.timeLimitSeconds || ''} onChange={event => updateStageProblem(index, item.id, { timeLimitSeconds: Number(event.target.value) || undefined })} /></label>
            {item.TestSetRevision.mode === 'oi' && <label className={styles.field}>开放 Subtask ID<Input value={(item.allowedSubtaskIds || []).join(',')} placeholder="例如 1,2" onChange={event => updateStageProblem(index, item.id, { allowedSubtaskIds: event.target.value.split(',').map(value => Number(value.trim())).filter(Number.isSafeInteger) })} /></label>}
            <label className={styles.field}>策略检查间隔（秒）<Input type="number" min={60} value={item.strategyIntervalSeconds || ''} onChange={event => updateStageProblem(index, item.id, { strategyIntervalSeconds: Number(event.target.value) || undefined })} /></label>
            <label className={styles.field}>连续做题上限（秒）<Input type="number" min={60} value={item.maxContinuousWorkSeconds || ''} onChange={event => updateStageProblem(index, item.id, { maxContinuousWorkSeconds: Number(event.target.value) || undefined })} /></label>
            <Checkbox label="到时强制换题" checked={Boolean(item.forceSwitchOnTimeout)} onChange={event => updateStageProblem(index, item.id, { forceSwitchOnTimeout: event.target.checked })} />
          </div>
          {(stage.mode === 'SEQUENTIAL' || stage.problemAccessMode === 'SEQUENTIAL') && <div className={styles.unlockEditor}><label className={styles.field}>解锁组合<Select value={item.unlockPolicy?.mode || 'ANY'} onChange={event => updateStageProblem(index, item.id, { unlockPolicy: { mode: event.target.value as 'ANY' | 'ALL', conditions: item.unlockPolicy?.conditions || [{ type: 'AC' }] } })}><option value="ANY">满足任一条件</option><option value="ALL">满足全部条件</option></Select></label>{(item.unlockPolicy?.conditions || [{ type: 'AC' }]).map((condition, conditionIndex) => <div className={styles.conditionRow} key={conditionIndex}><Select aria-label={`解锁条件 ${conditionIndex + 1}`} value={condition.type} onChange={event => updateUnlockCondition(index, item, conditionIndex, { type: event.target.value, value: ['AC', 'TEACHER'].includes(event.target.value) ? undefined : condition.value || 1 })}><option value="AC">前题 AC</option><option value="SCORE">前题达到分数</option><option value="TIME">前题有效训练秒数</option><option value="ATTEMPTS">前题提交次数</option><option value="TEACHER">教练放行</option></Select>{!['AC', 'TEACHER'].includes(condition.type) && <Input type="number" min={condition.type === 'SCORE' ? 0 : 1} max={condition.type === 'SCORE' ? 100 : undefined} value={condition.value ?? ''} onChange={event => updateUnlockCondition(index, item, conditionIndex, { value: Number(event.target.value) })} />}<Button variant="ghost" disabled={(item.unlockPolicy?.conditions.length || 1) === 1} onClick={() => { const policy = item.unlockPolicy || { mode: 'ANY' as const, conditions: [{ type: 'AC' }] }; updateStageProblem(index, item.id, { unlockPolicy: { ...policy, conditions: policy.conditions.filter((_, position) => position !== conditionIndex) } }) }}>删除条件</Button></div>)}<Button variant="ghost" onClick={() => { const policy = item.unlockPolicy || { mode: 'ANY' as const, conditions: [{ type: 'AC' }] }; updateStageProblem(index, item.id, { unlockPolicy: { ...policy, conditions: [...policy.conditions, { type: 'AC' }] } }) }}>添加解锁条件</Button></div>}
        </section>)}</div>
      </article>)}<Button variant="secondary" onClick={() => setStructure(current => [...current, { id: `new-${Date.now()}`, name: '新阶段', mode: 'FREE', status: 'pending', advanceMode: 'MANUAL', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED', Problems: current[0]?.Problems.map(item => ({ ...item, id: `new-${Date.now()}-${item.problemId}` })) || [] }])}>新增阶段</Button></div>
    </FormDialog>
    <FormDialog isOpen={messageOpen} onClose={() => setMessageOpen(false)} title="发送教练消息" description={`发送给：${commandTargetType === 'ALL' ? '全体学员' : commandTargetType === 'GROUP' ? '指定分组' : commandTargetType === 'USER' ? '指定学员' : '当前团队'}`} onSubmit={() => void command('SHOW_MESSAGE', { message, messageType }).then(success => { if (success) { setMessageOpen(false); setMessage('') } })} submitText="发送消息" dirty={Boolean(message)}><div className={styles.stack}><label className={styles.field}>消息类型<Select value={messageType} onChange={event => setMessageType(event.target.value)}><option value="INFO">信息</option><option value="WARNING">提醒</option><option value="INSTRUCTION">教学指令</option><option value="COUNTDOWN">倒计时</option></Select></label><label className={styles.field}>消息内容<Textarea rows={6} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></label></div></FormDialog>
    <FormDialog isOpen={hintOpen} onClose={() => setHintOpen(false)} title="新增分级提示" onSubmit={() => void createHint()} submitText="创建提示" dirty={Boolean(hintContent)}><div className={styles.stack}><label className={styles.field}>级别<Input type="number" min={1} max={20} value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))} /></label><label className={styles.field}>开放方式<Select value={hintMode} onChange={event => setHintMode(event.target.value)}><option value="MANUAL">教练手动</option><option value="TIME">有效训练时间</option><option value="ATTEMPT">提交次数</option><option value="SCORE">最高分数</option></Select></label>{hintMode !== 'MANUAL' && <label className={styles.field}>{hintMode === 'TIME' ? '触发秒数' : hintMode === 'ATTEMPT' ? '触发提交次数' : '触发分数'}<Input type="number" min={hintMode === 'TIME' ? 60 : hintMode === 'SCORE' ? 0 : 1} max={hintMode === 'TIME' ? 86400 : 100} value={hintTrigger} onChange={event => setHintTrigger(event.target.value)} /></label>}<label className={styles.field}>标题<Input value={hintTitle} onChange={event => setHintTitle(event.target.value)} /></label><label className={styles.field}>内容<Textarea rows={6} value={hintContent} onChange={event => setHintContent(event.target.value)} /></label></div></FormDialog>
    <DetailDialog isOpen={Boolean(openedHint)} onClose={() => setOpenedHint(undefined)} title={`${openedHint?.level || ''} 级提示 · ${openedHint?.title || '提示'}`} size="md"><p>{openedHint?.content}</p></DetailDialog>
    <DetailDialog isOpen={reportOpen} onClose={() => setReportOpen(false)} title="训练过程报告" description="关注过程、分数演进、提示和卡题，不默认把训练变成排行榜。" size="xl"><div className={styles.grid}>{report?.map(item => <article className={styles.card} key={item.user.id}><h3>{item.user.username}</h3><p>有效训练 {Math.floor(item.activeSeconds / 60)} 分钟</p>{item.problems.map((entry: any) => <div className={styles.timelineItem} key={entry.problemId}><strong>{entry.problemId} · {entry.title}</strong><br /><span>{entry.bestScore ?? 0} 分 · {entry.attemptCount} 次提交 · {entry.hintCount} 次提示 · {entry.status}</span></div>)}</article>)}</div></DetailDialog>
  </div></PageFrame>
}
