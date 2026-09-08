'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { StatusBadge } from '@/components/ui/Badge'
import { Checkbox } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { useToast } from '@/components/ui/Toast'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import styles from './TrainingEngine.module.css'

type StageProblem = { id: string; problemId: string; alias?: string; targetScore?: number; Problem: { problemId: string; title: string; platform: string }; TestSetRevision: { revisionNumber: number; mode: string } }
type Stage = { id: string; name: string; description?: string; mode: string; status: string; Problems: StageProblem[] }
type Workspace = { session: { id: string; title: string; description?: string; status: string; statusRevision: number; currentStageId?: string; Stages: Stage[]; Overlays: Array<{ id: string; type: string; payload?: any }> }; manager: boolean; participant?: { id: string }; progress: Array<{ stageProblemId: string; status: string; bestScore?: number; attemptCount: number }>; permissions: Record<string, { canView: boolean; canSubmit: boolean; canEdit: boolean; reason: string }> }
type Dashboard = { participants: Array<{ id: string; user: { username: string }; online: boolean; currentProblemId?: string; progress: Array<{ status: string }> }>; summary: { total: number; working: number; stuck: number; completed: number } }
type Roster = { revision: number; groups: Array<{ id: string; name: string }>; candidates: Array<{ userId: string; username: string; displayName: string; role: string; selected: boolean; groupId?: string }> }

export function TrainingSessionWorkspace({ sessionId }: { sessionId: string }) {
  const toast = useToast(), [data, setData] = useState<Workspace>(), [dashboard, setDashboard] = useState<Dashboard>(), [problemDetail, setProblemDetail] = useState<any>(), [roster, setRoster] = useState<Roster>(), [rosterOpen, setRosterOpen] = useState(false), [rosterSaving, setRosterSaving] = useState(false), [selectedId, setSelectedId] = useState<string>(), [code, setCode] = useState(''), [language, setLanguage] = useState('cpp17'), [draftRevision, setDraftRevision] = useState<number>(), [saving, setSaving] = useState(false), [submitting, setSubmitting] = useState(false)
  const cursor = useRef(0)
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
  useEffect(() => {
    if (!problem) return
    void Promise.all([apiClient.get<any>(`/api/training-sessions/${sessionId}/drafts/${problem.problemId}`), apiClient.get<any>(`/api/problems/${problem.problemId}`)]).then(([draft, detail]) => { setCode(draft.data?.code || ''); setLanguage(draft.data?.language || 'cpp17'); setDraftRevision(draft.data?.revision); setProblemDetail(detail.success ? detail.data : undefined) })
  }, [problem?.problemId, sessionId])
  const saveDraft = useCallback(async (quiet = false) => {
    if (!problem) return false
    setSaving(true)
    const response = await apiClient.put<any>(`/api/training-sessions/${sessionId}/drafts/${problem.problemId}`, { code, language, expectedRevision: draftRevision, editorFocused: document.hasFocus() })
    setSaving(false)
    if (!response.success) { if (!quiet) toast.error(response.message || '草稿保存失败'); return false }
    setDraftRevision(response.data?.revision); if (!quiet) toast.success('草稿已保存'); return true
  }, [code, draftRevision, language, problem, sessionId, toast])
  useEffect(() => { const timer = setInterval(() => { if (code && problem) void saveDraft(true) }, 30_000); return () => clearInterval(timer) }, [code, problem, saveDraft])
  useEffect(() => { if (!selectedId) return; const timer = setInterval(() => void apiClient.post(`/api/training-sessions/${sessionId}/heartbeat`, { stageProblemId: selectedId, pageVisible: document.visibilityState === 'visible', editorFocused: document.hasFocus() }), 30_000); return () => clearInterval(timer) }, [selectedId, sessionId])
  useEffect(() => {
    const source = new EventSource(`/api/training-sessions/${sessionId}/events?afterSeq=${cursor.current}`, { withCredentials: true })
    source.addEventListener('training', event => { const parsed = JSON.parse((event as MessageEvent).data); cursor.current = Number((event as MessageEvent).lastEventId || cursor.current); if (parsed.type) void load() })
    source.addEventListener('resync_required', () => void load())
    return () => source.close()
  }, [load, sessionId])
  const command = async (type: string, payload: Record<string, unknown> = {}) => {
    if (!data) return
    await saveDraft(true)
    const response = await apiClient.post(`/api/training-sessions/${sessionId}/commands`, { type, expectedRevision: data.session.statusRevision, payload })
    if (!response.success) return toast.error(response.message || '训练指令失败')
    await load()
  }
  const submit = async () => {
    if (!problem || !selectedId) return
    setSubmitting(true); await saveDraft(true)
    const response = await apiClient.post<any>(`/api/training-sessions/${sessionId}/submit`, { stageProblemId: selectedId, code, language })
    setSubmitting(false)
    if (!response.success) return toast.error(response.message || '提交失败')
    toast.success(`提交 #${response.data?.id} 已进入评测队列`)
  }
  const openRoster = async () => { const response = await apiClient.get<Roster>(`/api/training-sessions/${sessionId}/roster`); if (!response.success || !response.data) return toast.error(response.message || '学员名单加载失败'); setRoster(response.data); setRosterOpen(true) }
  const saveRoster = async () => { if (!roster) return; setRosterSaving(true); const response = await apiClient.put(`/api/training-sessions/${sessionId}/roster`, { expectedRevision: roster.revision, groups: roster.groups, participants: roster.candidates.filter(item => item.selected).map(item => ({ userId: item.userId, groupId: item.groupId })) }); setRosterSaving(false); if (!response.success) return toast.error(response.message || '学员名单保存失败'); setRosterOpen(false); await load() }
  if (!data) return <PageFrame width="workbench"><PageHeader title="训练工作台" description="正在准备训练状态…" /></PageFrame>
  const status = data.session.status
  return <PageFrame width="workbench"><div className={styles.stack}>
    <PageHeader title={data.session.title} description={data.session.description || '教练训练工作台'} actions={<div className={styles.actions}><StatusBadge variant={status === 'RUNNING' ? 'success' : status === 'PAUSED' ? 'warning' : 'neutral'}>{status}</StatusBadge>{!data.participant && !data.manager && <Button onClick={() => void apiClient.post(`/api/training-sessions/${sessionId}/join`, {}).then(() => load())}>加入训练</Button>}</div>} />
    {data.session.Overlays.filter(item => item.type === 'MESSAGE').map(item => <div className={styles.message} key={item.id}>{item.payload?.message || '教练消息'}</div>)}
    {data.manager && <Section title="教练控制" description="所有命令由服务端校验状态 revision，并实时推送给学员。"><div className={styles.actions}>{status === 'SCHEDULED' && <Button onClick={() => void command('START_SESSION')}>开始</Button>}{status === 'RUNNING' && <Button variant="secondary" onClick={() => void command('PAUSE_SESSION', { mode: 'HARD' })}>暂停</Button>}{status === 'PAUSED' && <Button onClick={() => void command('RESUME_SESSION')}>恢复</Button>}{status === 'RUNNING' && <Button variant="secondary" onClick={() => void command('ADVANCE_STAGE')}>下一阶段</Button>}{['RUNNING', 'PAUSED'].includes(status) && <Button variant="danger" onClick={() => void command('END_SESSION')}>结束训练</Button>}{status === 'DRAFT' && <Button onClick={async () => { const response = await apiClient.post(`/api/training-sessions/${sessionId}/publish`, { expectedRevision: data.session.statusRevision }); if (!response.success) toast.error(response.message || '发布失败'); else void load() }}>发布训练</Button>}{selectedId && status === 'RUNNING' && <Button variant="outline" onClick={() => void command('FOCUS_PROBLEM', { stageProblemId: selectedId, mode: 'LOCKED_FOCUS' })}>全员聚焦当前题</Button>}<Button variant="secondary" onClick={() => void openRoster()}>管理学员</Button><Button variant="ghost" onClick={() => void load()}>刷新</Button></div></Section>}
    <div className={styles.workspace}>
      <aside className={styles.rail}>{data.session.Stages.map(stage => <section className={styles.stage} key={stage.id}><div><strong>{stage.name}</strong> <StatusBadge variant={stage.id === data.session.currentStageId ? 'success' : 'neutral'}>{stage.mode}</StatusBadge></div>{stage.Problems.map(item => { const access = data.permissions[item.id]; const progress = data.progress.find(entry => entry.stageProblemId === item.id); return <Button variant="ghost" className={styles.problemButton} data-active={item.id === selectedId} disabled={!access?.canView} key={item.id} onClick={async () => { await saveDraft(true); setSelectedId(item.id) }}><span><strong>{item.alias || item.Problem.problemId} · {item.Problem.title}</strong><br /><small>{access?.canView ? `${progress?.status || '未开始'}${progress?.bestScore != null ? ` · ${progress.bestScore} 分` : ''}` : '尚未开放'} · R{item.TestSetRevision.revisionNumber}</small></span></Button>})}</section>)}</aside>
      <main className={styles.stack}>{problem ? <><Section title={`${problem.alias || problem.Problem.problemId} · ${problem.Problem.title}`} description={`${problem.Problem.platform} · 固定测试版本 R${problem.TestSetRevision.revisionNumber}`}>{problemDetail?.statements?.find((item: any) => item.format === 'markdown')?.content ? <MarkdownRenderer content={problemDetail.statements.find((item: any) => item.format === 'markdown').content} /> : <p className={styles.muted}>题面尚未就绪，或当前题面不可见。</p>}</Section><Section title="训练代码" description="每 30 秒自动保存；切换题目和教练聚焦前也会保存。"><div className={styles.stack}><label className={styles.field}>语言<Select value={language} onChange={event => setLanguage(event.target.value)}><option value="cpp17">C++17</option><option value="python3">Python3</option><option value="c">C</option></Select></label><label className={styles.field}>代码草稿<Textarea className={styles.editor} spellCheck={false} value={code} onChange={event => setCode(event.target.value)} /></label><div className={styles.actions}><Button variant="secondary" loading={saving} onClick={() => void saveDraft()}>保存草稿</Button><Button loading={submitting} disabled={!data.permissions[problem.id]?.canSubmit || !code.trim()} onClick={() => void submit()}>提交评测</Button></div>{!data.permissions[problem.id]?.canSubmit && <p className={styles.muted}>当前不可提交：{data.permissions[problem.id]?.reason}</p>}</div></Section></> : <Section title="请选择训练题目"><p className={styles.muted}>题目可能尚未按当前阶段开放。</p></Section>}</main>
      {data.manager && <aside className={`${styles.stack} ${styles.coach}`}><Section title="实时概览"><div className={styles.summary}><div className={styles.metric}><strong>{dashboard?.summary.total || 0}</strong>学员</div><div className={styles.metric}><strong>{dashboard?.summary.working || 0}</strong>进行中</div><div className={styles.metric}><strong>{dashboard?.summary.stuck || 0}</strong>卡题</div><div className={styles.metric}><strong>{dashboard?.summary.completed || 0}</strong>完成</div></div></Section><Section title="学员状态"><div className={styles.timeline}>{dashboard?.participants.map(item => <div className={styles.timelineItem} key={item.id}><strong>{item.user.username}</strong><br /><span className={styles.muted}>{item.online ? '在线' : '离线'} · {item.progress.filter(p => p.status === 'COMPLETED').length} 题完成</span></div>)}</div></Section></aside>}
    </div>
    <FormDialog isOpen={rosterOpen} onClose={() => setRosterOpen(false)} title="管理训练学员" description="仅可选择当前学校或团队的有效成员。未选成员不会看到草稿训练。" size="lg" loading={rosterSaving} footer={<><Button variant="secondary" onClick={() => setRosterOpen(false)} disabled={rosterSaving}>取消</Button><Button onClick={() => void saveRoster()} loading={rosterSaving}>保存名单</Button></>}><div className={styles.problemPicker}>{roster?.candidates.map(item => <Checkbox key={item.userId} label={item.displayName} description={`${item.username} · ${item.role}`} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />)}</div></FormDialog>
  </div></PageFrame>
}
