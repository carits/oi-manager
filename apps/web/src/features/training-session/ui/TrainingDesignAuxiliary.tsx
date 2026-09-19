'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { Empty } from '@/components/ui/Empty'
import { StatusBadge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { createTrainingHint, getTrainingGroupSuggestions, getTrainingRoster, listTrainingHints, saveTrainingRoster } from '../api/trainingSessionApi'
import type { Assignment, Stage } from '../model/trainingDesign'
import styles from './TrainingEngine.module.css'

type Roster = { revision: number; candidates: Array<{ userId: string; username: string; displayName: string; role: string; selected: boolean }> }
type Hint = { id: string; level: number; title?: string; content?: string; openMode?: string; triggerSeconds?: number; triggerAttempts?: number; triggerScore?: number }
type GroupSuggestion = { participantId: string; user: { id: string; username: string }; groupId: string; groupName: string; reason: string }

export function TrainingDesignAuxiliary({ sessionId, mode, stages, onStagesChange, onChanged }: { sessionId: string; mode: 'roster' | 'hints'; stages: Stage[]; onStagesChange?: (updater: (current: Stage[]) => Stage[]) => void; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [roster, setRoster] = useState<Roster>(), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false)
  const assignments = useMemo(() => stages.flatMap(stage => [...stage.Problems, ...(stage.Groups || []).flatMap(group => group.Problems)].filter(problem => problem.assignmentId).map(problem => ({ ...problem, stageName: stage.name }))), [stages])
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(''), [hints, setHints] = useState<Hint[]>([]), [hintOpen, setHintOpen] = useState(false)
  const [hintTitle, setHintTitle] = useState(''), [hintContent, setHintContent] = useState(''), [hintLevel, setHintLevel] = useState(1), [hintMode, setHintMode] = useState('MANUAL'), [hintTrigger, setHintTrigger] = useState('')
  const [rawSuggestions, setSuggestions] = useState<{ stageId: string; items: GroupSuggestion[] }>(), [suggestionLoading, setSuggestionLoading] = useState(false)
  const suggestions = rawSuggestions || { stageId: '', items: [] as GroupSuggestion[] }

  const loadRoster = useCallback(async () => {
    setLoading(true)
    const response = await getTrainingRoster(sessionId).catch(() => null)
    setLoading(false)
    if (!response) return toast.error('学员名单加载失败')
    setRoster(response as Roster)
  }, [sessionId, toast])
  const loadHints = useCallback(async (assignmentId: string) => {
    if (!assignmentId) return setHints([])
    setLoading(true)
    const response = await listTrainingHints(sessionId, assignmentId).catch(() => null)
    setLoading(false)
    if (!response) return toast.error('提示加载失败')
    setHints(response as Hint[])
  }, [sessionId, toast])
  useEffect(() => { if (mode === 'roster') void loadRoster() }, [loadRoster, mode])
  useEffect(() => {
    if (mode !== 'hints') return
    const selected = assignments.some(item => item.assignmentId === selectedAssignmentId) ? selectedAssignmentId : assignments[0]?.assignmentId || ''
    setSelectedAssignmentId(selected)
    void loadHints(selected)
  }, [assignments, loadHints, mode, selectedAssignmentId])

  const saveRoster = async () => {
    if (!roster) return
    setSaving(true)
    const response = await saveTrainingRoster(sessionId, { expectedRevision: roster.revision, participants: roster.candidates.filter(item => item.selected).map(item => ({ userId: item.userId })) })
    setSaving(false)
    if (!response.ok) return toast.error(response.error.message || '学员名单保存失败')
    toast.success('基础学员名单已保存'); await loadRoster(); await onChanged()
  }
  const createHint = async () => {
    if (!selectedAssignmentId || !hintContent.trim()) return
    const trigger = Number(hintTrigger) || undefined
    setSaving(true)
    const response = await createTrainingHint(sessionId, { stageProblemId: selectedAssignmentId, level: hintLevel, title: hintTitle || undefined, content: hintContent, openMode: hintMode as 'MANUAL' | 'TIME' | 'ATTEMPT' | 'SCORE', triggerSeconds: hintMode === 'TIME' ? trigger : undefined, triggerAttempts: hintMode === 'ATTEMPT' ? trigger : undefined, triggerScore: hintMode === 'SCORE' ? trigger : undefined })
    setSaving(false)
    if (!response.ok) return toast.error(response.error.message || '提示创建失败')
    setHintOpen(false); setHintTitle(''); setHintContent(''); setHintMode('MANUAL'); setHintTrigger(''); toast.success('分级提示已创建'); await loadHints(selectedAssignmentId)
  }
  const previewSuggestions = async (stageId: string) => {
    setSuggestionLoading(true)
    const result = await getTrainingGroupSuggestions(sessionId, stageId).catch(() => null)
    setSuggestionLoading(false)
    if (!result) return toast.error('分组建议生成失败')
    setSuggestions({ stageId, items: result.suggestions as GroupSuggestion[] })
  }
  const applySuggestions = () => {
    const preview = suggestions
    if (!preview) return
    onStagesChange?.(current => current.map(stage => stage.id !== preview.stageId ? stage : {
      ...stage,
      Groups: stage.Groups.map(group => ({ ...group, participantIds: preview.items.filter(item => item.groupId === group.id).map(item => item.user.id) })),
    }))
    toast.success('分组建议已写入本地草稿，请检查后保存')
    setSuggestions(undefined)
  }

  if (mode === 'roster') return <div className={styles.stack}><Section title="基础学员名单" description="这里只决定谁参加训练；每个 Stage 的分组在下方独立配置。" actions={<Button onClick={() => void saveRoster()} loading={saving} disabled={!roster}>保存名单</Button>}>
    {loading && !roster ? <p className={styles.muted}>正在加载学员…</p> : !roster ? <Empty title="暂无可配置名单" /> : <div className={styles.rosterList}>{roster.candidates.map(item => <Checkbox key={item.userId} label={item.displayName} description={`${item.username} · ${item.role}`} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />)}</div>}
  </Section>{stages.filter(stage => stage.audienceMode === 'GROUPED').map(stage => { const frozen = Boolean(stage.lifecycle && stage.lifecycle !== 'PENDING'); const stageSuggestions = suggestions?.stageId === stage.id ? suggestions.items : []; return <Section key={stage.clientKey} title={`${stage.name} · Stage 分组`} description={frozen ? '该 Stage 已开始，分组定义只读；现场换组请前往运行工作台。' : '每名学员在这个 Stage 只能属于一个组；系统只生成可解释建议，必须由教师确认。'} actions={!frozen && stage.id ? <Button variant="secondary" loading={suggestionLoading} onClick={() => void previewSuggestions(stage.id!)}>生成分组建议</Button> : undefined}><div className={styles.stack}>{Boolean(stageSuggestions.length) && <div className={styles.card}><strong>建议预览（尚未应用）</strong>{stageSuggestions.map(item => <p key={item.participantId}><b>{item.user.username}</b> → {item.groupName}<small className={styles.muted}>{item.reason}</small></p>)}<div className={styles.actions}><Button onClick={applySuggestions}>确认应用建议</Button><Button variant="ghost" onClick={() => setSuggestions(undefined)}>取消</Button></div></div>}<div className={styles.grid}>{stage.Groups.map(group => <article className={styles.card} key={group.clientKey}><strong>{group.name}</strong><p className={styles.muted}>{group.Problems.length} 道题 · {group.participantIds.length} 名学员</p><div className={styles.rosterList}>{roster?.candidates.filter(candidate => candidate.selected).map(candidate => <Checkbox key={candidate.userId} label={candidate.displayName} description={candidate.username} checked={group.participantIds.includes(candidate.userId)} disabled={frozen} onChange={event => onStagesChange?.(current => current.map(item => item.clientKey !== stage.clientKey ? item : { ...item, Groups: item.Groups.map(currentGroup => ({ ...currentGroup, participantIds: currentGroup.clientKey === group.clientKey && event.target.checked ? [...new Set([...currentGroup.participantIds, candidate.userId])] : currentGroup.participantIds.filter(id => id !== candidate.userId) })) }))} />)}</div></article>)}</div></div></Section> })}</div>

  return <Section title="提示配置" description="提示必须绑定已保存的题目分配；新增或移动题目后请先保存编排。" actions={<Button onClick={() => setHintOpen(true)} disabled={!selectedAssignmentId}>新增提示</Button>}>
    {!assignments.length ? <Empty title="暂无可配置题目" description="请在“阶段与顺序”中分配题目并先保存。" /> : <div className={styles.stack}><label className={styles.field}>题目分配<Select value={selectedAssignmentId} onChange={event => { setSelectedAssignmentId(event.target.value); void loadHints(event.target.value) }}>{assignments.map(item => <option value={item.assignmentId} key={item.assignmentId}>{item.stageName} · {item.Problem.problemId} {item.Problem.title}</option>)}</Select></label>{loading ? <p className={styles.muted}>正在加载提示…</p> : hints.length ? <div className={styles.hintGrid}>{hints.map(hint => <article className={styles.card} key={hint.id}><div className={styles.actions}><StatusBadge variant="neutral">{hint.level} 级</StatusBadge><StatusBadge variant="info">{hint.openMode || 'MANUAL'}</StatusBadge></div><strong>{hint.title || '未命名提示'}</strong><p>{hint.content}</p></article>)}</div> : <Empty title="该题暂无提示" />}</div>}
    <FormDialog isOpen={hintOpen} onClose={() => setHintOpen(false)} onSubmit={() => void createHint()} title="新增分级提示" submitText="创建提示" loading={saving} dirty={Boolean(hintContent)}><div className={styles.stack}><label className={styles.field}>级别<Input type="number" min={1} max={20} value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))} /></label><label className={styles.field}>开放方式<Select value={hintMode} onChange={event => setHintMode(event.target.value)}><option value="MANUAL">教练手动</option><option value="TIME">有效训练时间</option><option value="ATTEMPT">提交次数</option><option value="SCORE">最高分数</option></Select></label>{hintMode !== 'MANUAL' && <label className={styles.field}>触发值<Input type="number" value={hintTrigger} onChange={event => setHintTrigger(event.target.value)} /></label>}<label className={styles.field}>标题<Input value={hintTitle} onChange={event => setHintTitle(event.target.value)} /></label><label className={styles.field}>内容<Textarea rows={6} value={hintContent} onChange={event => setHintContent(event.target.value)} /></label></div></FormDialog>
  </Section>
}
