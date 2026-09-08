'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { Empty } from '@/components/ui/Empty'
import { StatusBadge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import styles from './TrainingEngine.module.css'

type Assignment = { assignmentId?: string; clientKey: string; Problem: { problemId: string; title: string } }
type Stage = { clientKey: string; name: string; Problems: Assignment[] }
type Roster = { revision: number; groups: Array<{ id: string; name: string }>; candidates: Array<{ userId: string; username: string; displayName: string; role: string; selected: boolean; groupId?: string }> }
type Hint = { id: string; level: number; title?: string; content?: string; openMode?: string; triggerSeconds?: number; triggerAttempts?: number; triggerScore?: number }

export function TrainingDesignAuxiliary({ sessionId, mode, stages, onChanged }: { sessionId: string; mode: 'roster' | 'hints'; stages: Stage[]; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [roster, setRoster] = useState<Roster>(), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false)
  const assignments = useMemo(() => stages.flatMap(stage => stage.Problems.filter(problem => problem.assignmentId).map(problem => ({ ...problem, stageName: stage.name }))), [stages])
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(''), [hints, setHints] = useState<Hint[]>([]), [hintOpen, setHintOpen] = useState(false)
  const [hintTitle, setHintTitle] = useState(''), [hintContent, setHintContent] = useState(''), [hintLevel, setHintLevel] = useState(1), [hintMode, setHintMode] = useState('MANUAL'), [hintTrigger, setHintTrigger] = useState('')

  const loadRoster = useCallback(async () => {
    setLoading(true)
    const response = await apiClient.get<Roster>(`/api/training-sessions/${sessionId}/roster`)
    setLoading(false)
    if (!response.success || !response.data) return toast.error(response.message || '学员名单加载失败')
    setRoster(response.data)
  }, [sessionId, toast])
  const loadHints = useCallback(async (assignmentId: string) => {
    if (!assignmentId) return setHints([])
    setLoading(true)
    const response = await apiClient.get<Hint[]>(`/api/training-sessions/${sessionId}/problems/${assignmentId}/hints`)
    setLoading(false)
    if (!response.success) return toast.error(response.message || '提示加载失败')
    setHints(response.data || [])
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
    const response = await apiClient.put(`/api/training-sessions/${sessionId}/roster`, { expectedRevision: roster.revision, groups: roster.groups, participants: roster.candidates.filter(item => item.selected).map(item => ({ userId: item.userId, groupId: item.groupId })) })
    setSaving(false)
    if (!response.success) return toast.error(response.message || '学员与分组保存失败')
    toast.success('学员与分组已保存'); await loadRoster(); await onChanged()
  }
  const createHint = async () => {
    if (!selectedAssignmentId || !hintContent.trim()) return
    const trigger = Number(hintTrigger) || undefined
    setSaving(true)
    const response = await apiClient.post(`/api/training-sessions/${sessionId}/hints`, { stageProblemId: selectedAssignmentId, level: hintLevel, title: hintTitle, content: hintContent, openMode: hintMode, triggerSeconds: hintMode === 'TIME' ? trigger : undefined, triggerAttempts: hintMode === 'ATTEMPT' ? trigger : undefined, triggerScore: hintMode === 'SCORE' ? trigger : undefined })
    setSaving(false)
    if (!response.success) return toast.error(response.message || '提示创建失败')
    setHintOpen(false); setHintTitle(''); setHintContent(''); setHintMode('MANUAL'); setHintTrigger(''); toast.success('分级提示已创建'); await loadHints(selectedAssignmentId)
  }

  if (mode === 'roster') return <Section title="学员与分组" description="明确训练参与范围。当前训练发布时会固定名单和分组。" actions={<Button onClick={() => void saveRoster()} loading={saving} disabled={!roster}>保存名单</Button>}>
    {loading && !roster ? <p className={styles.muted}>正在加载学员…</p> : !roster ? <Empty title="暂无可配置名单" /> : <div className={styles.stack}><div className={styles.rosterGroups}>{roster.groups.map((group, index) => <label className={styles.field} key={group.id}>分组 {index + 1}<Input value={group.name} onChange={event => setRoster(current => current ? { ...current, groups: current.groups.map(item => item.id === group.id ? { ...item, name: event.target.value } : item) } : current)} /></label>)}<Button variant="outline" onClick={() => setRoster(current => current ? { ...current, groups: [...current.groups, { id: `new-${Date.now()}`, name: `分组 ${current.groups.length + 1}` }] } : current)}>新增分组</Button></div><div className={styles.rosterList}>{roster.candidates.map(item => <div className={styles.rosterRow} key={item.userId}><Checkbox label={item.displayName} description={`${item.username} · ${item.role}`} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />{item.selected && <Select aria-label={`${item.displayName} 分组`} value={item.groupId || ''} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, groupId: event.target.value || undefined } : candidate) } : current)}><option value="">未分组</option>{roster.groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</Select>}</div>)}</div></div>}
  </Section>

  return <Section title="提示配置" description="提示必须绑定已保存的题目分配；新增或移动题目后请先保存编排。" actions={<Button onClick={() => setHintOpen(true)} disabled={!selectedAssignmentId}>新增提示</Button>}>
    {!assignments.length ? <Empty title="暂无可配置题目" description="请在“阶段与顺序”中分配题目并先保存。" /> : <div className={styles.stack}><label className={styles.field}>题目分配<Select value={selectedAssignmentId} onChange={event => { setSelectedAssignmentId(event.target.value); void loadHints(event.target.value) }}>{assignments.map(item => <option value={item.assignmentId} key={item.assignmentId}>{item.stageName} · {item.Problem.problemId} {item.Problem.title}</option>)}</Select></label>{loading ? <p className={styles.muted}>正在加载提示…</p> : hints.length ? <div className={styles.hintGrid}>{hints.map(hint => <article className={styles.card} key={hint.id}><div className={styles.actions}><StatusBadge variant="neutral">{hint.level} 级</StatusBadge><StatusBadge variant="info">{hint.openMode || 'MANUAL'}</StatusBadge></div><strong>{hint.title || '未命名提示'}</strong><p>{hint.content}</p></article>)}</div> : <Empty title="该题暂无提示" />}</div>}
    <FormDialog isOpen={hintOpen} onClose={() => setHintOpen(false)} onSubmit={() => void createHint()} title="新增分级提示" submitText="创建提示" loading={saving} dirty={Boolean(hintContent)}><div className={styles.stack}><label className={styles.field}>级别<Input type="number" min={1} max={20} value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))} /></label><label className={styles.field}>开放方式<Select value={hintMode} onChange={event => setHintMode(event.target.value)}><option value="MANUAL">教练手动</option><option value="TIME">有效训练时间</option><option value="ATTEMPT">提交次数</option><option value="SCORE">最高分数</option></Select></label>{hintMode !== 'MANUAL' && <label className={styles.field}>触发值<Input type="number" value={hintTrigger} onChange={event => setHintTrigger(event.target.value)} /></label>}<label className={styles.field}>标题<Input value={hintTitle} onChange={event => setHintTitle(event.target.value)} /></label><label className={styles.field}>内容<Textarea rows={6} value={hintContent} onChange={event => setHintContent(event.target.value)} /></label></div></FormDialog>
  </Section>
}
