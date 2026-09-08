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

type StageProblem = { id: string; problemId: string; alias?: string; targetScore?: number; timeLimitSeconds?: number; allowedSubtaskIds?: number[]; Problem: { problemId: string; title: string; platform: string }; TestSetRevision: { revisionNumber: number; mode: string } }
type Stage = { id: string; name: string; description?: string; mode: string; status: string; durationSeconds?: number; advanceMode: string; problemAccessMode: string; submissionMode: string; targetScore?: number; completionThreshold?: number; Problems: StageProblem[] }
type Workspace = { session: { id: string; title: string; description?: string; sessionType: string; status: string; statusRevision: number; currentStageId?: string; Stages: Stage[]; Overlays: Array<{ id: string; type: string; payload?: any }> }; manager: boolean; participant?: { id: string }; progress: Array<{ stageProblemId: string; status: string; bestScore?: number; attemptCount: number }>; permissions: Record<string, { canView: boolean; canSubmit: boolean; canEdit: boolean; reason: string }> }
type Dashboard = { participants: Array<{ id: string; user: { username: string }; online: boolean; currentProblemId?: string; progress: Array<{ status: string }> }>; summary: { total: number; working: number; stuck: number; completed: number } }
type Roster = { revision: number; groups: Array<{ id: string; name: string }>; candidates: Array<{ userId: string; username: string; displayName: string; role: string; selected: boolean; groupId?: string }> }
type Hint = { id: string; level: number; title?: string; content?: string; opened: boolean; globallyOpenedAt?: string }

const stageDraft = (stage: Stage) => ({ ...stage, Problems: stage.Problems.map(problem => ({ ...problem })) })

export function TrainingSessionWorkspace({ sessionId }: { sessionId: string }) {
  const toast = useToast()
  const [data, setData] = useState<Workspace>(), [dashboard, setDashboard] = useState<Dashboard>(), [problemDetail, setProblemDetail] = useState<any>()
  const [selectedId, setSelectedId] = useState<string>(), [code, setCode] = useState(''), [language, setLanguage] = useState('cpp17'), [draftRevision, setDraftRevision] = useState<number>()
  const [saving, setSaving] = useState(false), [submitting, setSubmitting] = useState(false), [rosterSaving, setRosterSaving] = useState(false), [structureSaving, setStructureSaving] = useState(false)
  const [roster, setRoster] = useState<Roster>(), [rosterOpen, setRosterOpen] = useState(false), [structure, setStructure] = useState<Stage[]>([]), [structureOpen, setStructureOpen] = useState(false)
  const [hints, setHints] = useState<Hint[]>([]), [hintOpen, setHintOpen] = useState(false), [hintTitle, setHintTitle] = useState(''), [hintContent, setHintContent] = useState(''), [hintLevel, setHintLevel] = useState(1), [openedHint, setOpenedHint] = useState<Hint>()
  const [report, setReport] = useState<any[]>(), [reportOpen, setReportOpen] = useState(false)
  const cursor = useRef(0), saveDraftRef = useRef<(quiet?: boolean) => Promise<boolean>>(async () => false)

  const load = useCallback(async () => {
    const response = await apiClient.get<Workspace>(`/api/training-sessions/${sessionId}`)
    if (!response.success || !response.data) return toast.error(response.message || '训练加载失败')
    setData(response.data)
    setSelectedId(current => current && response.data!.permissions[current]?.canView ? current : response.data!.session.Stages.flatMap(stage => stage.Problems).find(problem => response.data!.permissions[problem.id]?.canView)?.id)
    if (response.data.manager) {
      const coach = await apiClient.get<Dashboard>(`/api/training-sessions/${sessionId}/coach-dashboard`)
      if (coach.success) setDashboard(coach.data)
    }
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
  useEffect(() => { if (!selectedId) return; const timer = setInterval(() => void apiClient.post(`/api/training-sessions/${sessionId}/heartbeat`, { stageProblemId: selectedId, pageVisible: document.visibilityState === 'visible', editorFocused: document.hasFocus() }), 30_000); return () => clearInterval(timer) }, [selectedId, sessionId])
  useEffect(() => {
    const source = new EventSource(`/api/training-sessions/${sessionId}/events?afterSeq=${cursor.current}`, { withCredentials: true })
    source.addEventListener('training', event => { cursor.current = Number((event as MessageEvent).lastEventId || cursor.current); void saveDraftRef.current(true).finally(() => load()) })
    source.addEventListener('resync_required', () => void load())
    return () => source.close()
  }, [load, sessionId])

  const command = async (type: string, payload: Record<string, unknown> = {}) => {
    if (!data) return
    await saveDraftRef.current(true)
    const response = await apiClient.post(`/api/training-sessions/${sessionId}/commands`, { type, expectedRevision: data.session.statusRevision, payload })
    if (!response.success) return toast.error(response.message || '训练指令失败')
    await load(); await loadHints(selectedId)
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
    const response = await apiClient.put(`/api/training-sessions/${sessionId}/structure`, { expectedRevision: data.session.statusRevision, title: data.session.title, description: data.session.description, stages: structure.map(stage => ({ name: stage.name, description: stage.description, mode: stage.mode, durationSeconds: stage.durationSeconds || null, advanceMode: stage.advanceMode, problemAccessMode: stage.problemAccessMode, submissionMode: stage.submissionMode, targetScore: stage.targetScore || null, completionThreshold: stage.completionThreshold || null, problems: stage.Problems.map(item => ({ problemId: item.problemId, alias: item.alias, targetScore: item.targetScore, timeLimitSeconds: item.timeLimitSeconds, allowedSubtaskIds: item.allowedSubtaskIds })) })) })
    setStructureSaving(false)
    if (!response.success) return toast.error(response.message || '阶段保存失败')
    setStructureOpen(false); await load()
  }
  const createHint = async () => {
    if (!selectedId) return
    const response = await apiClient.post(`/api/training-sessions/${sessionId}/hints`, { stageProblemId: selectedId, level: hintLevel, title: hintTitle, content: hintContent, openMode: 'MANUAL' })
    if (!response.success) return toast.error(response.message || '提示创建失败')
    setHintOpen(false); setHintTitle(''); setHintContent(''); await loadHints(selectedId)
  }
  const showReport = async () => { const response = await apiClient.get<any[]>(`/api/training-sessions/${sessionId}/report`); if (!response.success) return toast.error(response.message || '训练报告加载失败'); setReport(response.data || []); setReportOpen(true) }
  const recordStrategy = async (decision: string) => { const response = await apiClient.post(`/api/training-sessions/${sessionId}/strategy-decisions`, { stageProblemId: selectedId, decision }); if (!response.success) toast.error(response.message || '策略记录失败'); else toast.success('策略决策已记录') }

  if (!data) return <PageFrame width="workbench"><PageHeader title="训练工作台" description="正在准备训练状态…" /></PageFrame>
  const status = data.session.status
  return <PageFrame width="workbench"><div className={styles.stack}>
    <PageHeader title={data.session.title} description={data.session.description || '教练训练工作台'} actions={<div className={styles.actions}><StatusBadge variant={status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : 'neutral'}>{status}</StatusBadge></div>} />
    {data.session.Overlays.filter(item => item.type === 'MESSAGE').map(item => <div className={styles.message} key={item.id}>{item.payload?.message || '教练消息'}</div>)}
    {data.manager && <Section title="教练控制" description="命令带 revision 审计并实时推送；学员客户端先保存草稿再应用聚焦。"><div className={styles.actions}>
      {status === 'SCHEDULED' && <Button onClick={() => void command('START_SESSION')}>开始</Button>}
      {status === 'RUNNING' && <Button variant="secondary" onClick={() => void command('PAUSE_SESSION', { mode: 'HARD' })}>暂停</Button>}
      {status === 'PAUSED' && <Button onClick={() => void command('RESUME_SESSION')}>恢复</Button>}
      {status === 'RUNNING' && <Button variant="secondary" onClick={() => void command('ADVANCE_STAGE')}>下一阶段</Button>}
      {['RUNNING', 'PAUSED'].includes(status) && <Button variant="danger" onClick={() => void command('END_SESSION')}>结束训练</Button>}
      {status === 'DRAFT' && <><Button variant="secondary" onClick={openStructure}>编辑阶段</Button><Button onClick={async () => { const response = await apiClient.post(`/api/training-sessions/${sessionId}/publish`, { expectedRevision: data.session.statusRevision }); if (!response.success) toast.error(response.message || '发布失败'); else void load() }}>发布训练</Button></>}
      {selectedId && status === 'RUNNING' && <Button variant="outline" onClick={() => void command('FOCUS_PROBLEM', { stageProblemId: selectedId, mode: 'LOCKED_FOCUS' })}>全员聚焦当前题</Button>}
      <Button variant="secondary" onClick={() => void openRoster()}>管理学员</Button><Button variant="secondary" onClick={() => void showReport()}>训练报告</Button><Button variant="ghost" onClick={() => void load()}>刷新</Button>
    </div></Section>}
    <div className={styles.workspace}>
      <aside className={styles.rail}>{data.session.Stages.map(stage => <section className={styles.stage} key={stage.id}><div><strong>{stage.name}</strong> <StatusBadge variant={stage.id === data.session.currentStageId ? 'success' : 'neutral'}>{stage.mode}</StatusBadge></div>{stage.Problems.map(item => { const access = data.permissions[item.id], progress = data.progress.find(entry => entry.stageProblemId === item.id); return <Button variant="ghost" className={styles.problemButton} data-active={item.id === selectedId} disabled={!access?.canView} key={item.id} onClick={async () => { await saveDraftRef.current(true); setSelectedId(item.id) }}><span><strong>{item.alias || item.Problem.problemId} · {item.Problem.title}</strong><br /><small>{access?.canView ? `${progress?.status || '未开始'}${progress?.bestScore != null ? ` · ${progress.bestScore} 分` : ''}` : '尚未开放'} · R{item.TestSetRevision.revisionNumber}</small></span></Button>})}</section>)}</aside>
      <main className={styles.stack}>{problem ? <>
        <Section title={`${problem.alias || problem.Problem.problemId} · ${problem.Problem.title}`} description={`${problem.Problem.platform} · 固定测试版本 R${problem.TestSetRevision.revisionNumber}`}>{problemDetail?.statements?.find((item: any) => item.format === 'markdown')?.content ? <MarkdownRenderer content={problemDetail.statements.find((item: any) => item.format === 'markdown').content} /> : <p className={styles.muted}>题面尚未就绪，或当前题面不可见。</p>}</Section>
        <Section title="训练代码" description="每 30 秒自动保存；切换题目和收到教练聚焦前也会保存。"><div className={styles.stack}><label className={styles.field}>语言<Select value={language} onChange={event => setLanguage(event.target.value)}><option value="cpp17">C++17</option><option value="python3">Python3</option><option value="c">C</option></Select></label><label className={styles.field}>代码草稿<Textarea className={styles.editor} spellCheck={false} disabled={!data.permissions[problem.id]?.canEdit} value={code} onChange={event => setCode(event.target.value)} /></label><div className={styles.actions}><Button variant="secondary" loading={saving} onClick={() => void saveDraft()}>保存草稿</Button><Button loading={submitting} disabled={!data.permissions[problem.id]?.canSubmit || !code.trim()} onClick={() => void submit()}>提交评测</Button>{data.session.sessionType === 'ACM' && status === 'RUNNING' && <><Button variant="ghost" onClick={() => void recordStrategy('CONTINUE')}>继续当前题</Button><Button variant="ghost" onClick={() => void recordStrategy('SWITCH')}>记录切题</Button></>}</div>{!data.permissions[problem.id]?.canSubmit && <p className={styles.muted}>当前不可提交：{data.permissions[problem.id]?.reason}</p>}</div></Section>
        <Section title="分级提示" description="提示使用会进入训练报告。" actions={data.manager ? <Button variant="secondary" onClick={() => setHintOpen(true)}>新增提示</Button> : undefined}><div className={styles.actions}>{hints.length ? hints.map(hint => data.manager ? <Button key={hint.id} variant={hint.globallyOpenedAt ? 'secondary' : 'outline'} onClick={() => void command(hint.globallyOpenedAt ? 'CLOSE_HINT' : 'OPEN_HINT', { hintId: hint.id })}>{hint.level} 级 · {hint.title || '提示'} · {hint.globallyOpenedAt ? '已开放' : '开放'}</Button> : <Button key={hint.id} variant="outline" onClick={async () => { const response = await apiClient.post<Hint>(`/api/training-sessions/${sessionId}/hints/${hint.id}/open`, {}); if (response.success && response.data) setOpenedHint(response.data); else toast.error(response.message || '提示尚未开放') }}>{hint.opened ? '再次查看' : '打开'} {hint.level} 级提示</Button>) : <p className={styles.muted}>暂无已开放提示。</p>}</div></Section>
      </> : <Section title="请选择训练题目"><p className={styles.muted}>题目可能尚未按当前阶段开放。</p></Section>}</main>
      {data.manager && <aside className={`${styles.stack} ${styles.coach}`}><Section title="实时概览"><div className={styles.summary}><div className={styles.metric}><strong>{dashboard?.summary.total || 0}</strong>学员</div><div className={styles.metric}><strong>{dashboard?.summary.working || 0}</strong>进行中</div><div className={styles.metric}><strong>{dashboard?.summary.stuck || 0}</strong>可能卡题</div><div className={styles.metric}><strong>{dashboard?.summary.completed || 0}</strong>完成</div></div></Section><Section title="学员状态"><div className={styles.timeline}>{dashboard?.participants.map(item => <div className={styles.timelineItem} key={item.id}><strong>{item.user.username}</strong><br /><span className={styles.muted}>{item.online ? '在线' : '离线'} · {item.progress.filter(p => p.status === 'COMPLETED').length} 题完成</span></div>)}</div></Section></aside>}
    </div>
    <FormDialog isOpen={rosterOpen} onClose={() => setRosterOpen(false)} title="管理训练学员与分组" description="仅可选择当前学校或团队的有效成员。" size="lg" loading={rosterSaving} footer={<><Button variant="secondary" onClick={() => setRosterOpen(false)} disabled={rosterSaving}>取消</Button><Button onClick={() => void saveRoster()} loading={rosterSaving}>保存名单</Button></>}><div className={styles.stack}><div className={styles.actions}>{roster?.groups.map((group, index) => <Input key={group.id} aria-label={`分组 ${index + 1}`} value={group.name} onChange={event => setRoster(current => current ? { ...current, groups: current.groups.map(item => item.id === group.id ? { ...item, name: event.target.value } : item) } : current)} />)}<Button variant="secondary" onClick={() => setRoster(current => current ? { ...current, groups: [...current.groups, { id: `new-${Date.now()}`, name: `分组 ${current.groups.length + 1}` }] } : current)}>新增分组</Button></div><div className={styles.problemPicker}>{roster?.candidates.map(item => <div className={styles.actions} key={item.userId}><Checkbox label={item.displayName} description={`${item.username} · ${item.role}`} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />{item.selected && <Select aria-label={`${item.displayName} 分组`} value={item.groupId || ''} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, groupId: event.target.value || undefined } : candidate) } : current)}><option value="">未分组</option>{roster.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select>}</div>)}</div></div></FormDialog>
    <FormDialog isOpen={structureOpen} onClose={() => setStructureOpen(false)} title="编辑训练阶段" description="可视化配置模式、推进方式、时长、目标分数和题目；保存后创建新的草稿结构 revision。" size="wide" loading={structureSaving} footer={<><Button variant="secondary" onClick={() => setStructureOpen(false)}>取消</Button><Button onClick={() => void saveStructure()} loading={structureSaving}>保存阶段</Button></>}><div className={styles.stack}>{structure.map((stage, index) => <article className={styles.card} key={stage.id}><div className={styles.actions}><strong>阶段 {index + 1}</strong><Button variant="ghost" disabled={index === 0} onClick={() => setStructure(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}>上移</Button><Button variant="ghost" disabled={index === structure.length - 1} onClick={() => setStructure(current => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next })}>下移</Button><Button variant="danger" disabled={structure.length === 1} onClick={() => setStructure(current => current.filter(item => item.id !== stage.id))}>删除</Button></div><Input aria-label={`阶段 ${index + 1} 名称`} value={stage.name} onChange={event => setStructure(current => current.map(item => item.id === stage.id ? { ...item, name: event.target.value } : item))} /><div className={styles.grid}><Select aria-label={`阶段 ${index + 1} 模式`} value={stage.mode} onChange={event => setStructure(current => current.map(item => item.id === stage.id ? { ...item, mode: event.target.value } : item))}><option value="FREE">自由</option><option value="SEQUENTIAL">顺序</option><option value="FOCUS">聚焦</option><option value="SCORE_PROGRESSIVE">分数递进</option><option value="TEACHING">讲解</option><option value="REVIEW">复盘</option><option value="MOCK_CONTEST">模拟赛</option></Select><Select aria-label={`阶段 ${index + 1} 推进`} value={stage.advanceMode} onChange={event => setStructure(current => current.map(item => item.id === stage.id ? { ...item, advanceMode: event.target.value } : item))}><option value="MANUAL">教练手动</option><option value="TIME">按时间</option><option value="COMPLETION">按完成度</option><option value="HYBRID">时间或完成度</option></Select><Input aria-label={`阶段 ${index + 1} 时长秒`} type="number" min={60} placeholder="时长（秒）" value={stage.durationSeconds || ''} onChange={event => setStructure(current => current.map(item => item.id === stage.id ? { ...item, durationSeconds: Number(event.target.value) || undefined } : item))} /><Input aria-label={`阶段 ${index + 1} 目标分`} type="number" min={0} max={100} placeholder="目标分" value={stage.targetScore ?? ''} onChange={event => setStructure(current => current.map(item => item.id === stage.id ? { ...item, targetScore: Number(event.target.value) } : item))} /></div><div className={styles.problemPicker}>{stage.Problems.map(item => <p key={item.id}>{item.alias || item.Problem.problemId} · {item.Problem.title} · R{item.TestSetRevision.revisionNumber}</p>)}</div></article>)}<Button variant="secondary" onClick={() => setStructure(current => [...current, { id: `new-${Date.now()}`, name: '新阶段', mode: 'FREE', status: 'pending', advanceMode: 'MANUAL', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED', Problems: current[0]?.Problems.map(item => ({ ...item })) || [] }])}>新增阶段</Button></div></FormDialog>
    <FormDialog isOpen={hintOpen} onClose={() => setHintOpen(false)} title="新增分级提示" onSubmit={() => void createHint()} submitText="创建提示" dirty={Boolean(hintContent)}><div className={styles.stack}><label className={styles.field}>级别<Input type="number" min={1} max={20} value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))} /></label><label className={styles.field}>标题<Input value={hintTitle} onChange={event => setHintTitle(event.target.value)} /></label><label className={styles.field}>内容<Textarea rows={6} value={hintContent} onChange={event => setHintContent(event.target.value)} /></label></div></FormDialog>
    <DetailDialog isOpen={Boolean(openedHint)} onClose={() => setOpenedHint(undefined)} title={`${openedHint?.level || ''} 级提示 · ${openedHint?.title || '提示'}`} size="md"><p>{openedHint?.content}</p></DetailDialog>
    <DetailDialog isOpen={reportOpen} onClose={() => setReportOpen(false)} title="训练过程报告" description="关注过程、分数演进、提示和卡题，不默认把训练变成排行榜。" size="xl"><div className={styles.grid}>{report?.map(item => <article className={styles.card} key={item.user.id}><h3>{item.user.username}</h3><p>有效训练 {Math.floor(item.activeSeconds / 60)} 分钟</p>{item.problems.map((entry: any) => <div className={styles.timelineItem} key={entry.problemId}><strong>{entry.problemId} · {entry.title}</strong><br /><span>{entry.bestScore ?? 0} 分 · {entry.attemptCount} 次提交 · {entry.hintCount} 次提示 · {entry.status}</span></div>)}</article>)}</div></DetailDialog>
  </div></PageFrame>
}
