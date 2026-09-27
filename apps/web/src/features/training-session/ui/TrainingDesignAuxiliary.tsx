'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { Empty } from '@/components/ui/Empty'
import { StatusBadge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { createTrainingHint, deleteTrainingHint, getTrainingGroupSuggestions, getTrainingRoster, listTrainingHints, saveTrainingRoster, updateTrainingHint } from '../api/trainingSessionApi'
import type { Assignment, Stage, TrainingGrouping } from '../model/trainingDesign'
import { isTrainingGroupingDefinitionLocked, isTrainingStageDefinitionLocked } from '../model/trainingDesign'
import { trainingHintOpenModeLabel } from '@/lib/humanPresentation'
import styles from './TrainingEngine.module.css'

type Roster = { revision: number; candidates: Array<{ userId: string; username: string; displayName: string; role: string; selected: boolean }> }
type Hint = { id: string; level: number; title?: string; content?: string; openMode?: string; triggerSeconds?: number; triggerAttempts?: number; triggerScore?: number }
type GroupSuggestion = { participantId: string; user: { id: string; username: string }; groupId: string; groupName: string; reason: string }

export function TrainingDesignAuxiliary({ sessionId, mode, stages, onStagesChange, grouping, sessionStatus, onGroupingChange, onChanged }: { sessionId: string; mode: 'roster' | 'hints'; stages: Stage[]; onStagesChange?: (updater: (current: Stage[]) => Stage[]) => void; grouping?: TrainingGrouping; sessionStatus: string; onGroupingChange?: (value: TrainingGrouping) => void; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [roster, setRoster] = useState<Roster>(), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false)
  const assignments = useMemo(() => stages.flatMap(stage => stage.Problems.filter(problem => problem.assignmentId).map(problem => ({ ...problem, stageId: stage.id, stageName: stage.name }))), [stages])
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(''), [hints, setHints] = useState<Hint[]>([]), [hintOpen, setHintOpen] = useState(false), [editingHint, setEditingHint] = useState<Hint>(), [deleteHintTarget, setDeleteHintTarget] = useState<Hint>()
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
    toast.success('训练学员已保存'); await loadRoster(); await onChanged()
  }
  const resetHintForm = () => { setHintOpen(false); setEditingHint(undefined); setHintTitle(''); setHintContent(''); setHintLevel(1); setHintMode('MANUAL'); setHintTrigger('') }
  const openHintEditor = (hint?: Hint) => {
    setEditingHint(hint)
    setHintLevel(hint?.level || 1); setHintTitle(hint?.title || ''); setHintContent(hint?.content || ''); setHintMode(hint?.openMode || 'MANUAL')
    setHintTrigger(String(hint?.openMode === 'TIME' ? hint.triggerSeconds || '' : hint?.openMode === 'ATTEMPT' ? hint.triggerAttempts || '' : hint?.openMode === 'SCORE' ? hint.triggerScore || '' : ''))
    setHintOpen(true)
  }
  const saveHint = async () => {
    if (!selectedAssignmentId || !hintContent.trim()) return
    const trigger = Number(hintTrigger) || undefined
    const body = { level: hintLevel, title: hintTitle || undefined, content: hintContent, openMode: hintMode as 'MANUAL' | 'TIME' | 'ATTEMPT' | 'SCORE', triggerSeconds: hintMode === 'TIME' ? trigger : undefined, triggerAttempts: hintMode === 'ATTEMPT' ? trigger : undefined, triggerScore: hintMode === 'SCORE' ? trigger : undefined }
    setSaving(true)
    const response = editingHint
      ? await updateTrainingHint(sessionId, editingHint.id, body)
      : await createTrainingHint(sessionId, { stageProblemId: selectedAssignmentId, ...body })
    setSaving(false)
    if (!response.ok) return toast.error(response.error.message || (editingHint ? '提示修改失败' : '提示创建失败'))
    resetHintForm(); toast.success(editingHint ? '提示已更新' : '分级提示已创建'); await loadHints(selectedAssignmentId)
  }
  const confirmDeleteHint = async () => {
    if (!deleteHintTarget) return
    setSaving(true)
    const response = await deleteTrainingHint(sessionId, deleteHintTarget.id)
    setSaving(false)
    if (!response.ok) return toast.error(response.error.message || '提示删除失败')
    setDeleteHintTarget(undefined); toast.success('提示已删除'); await loadHints(selectedAssignmentId)
  }
  const previewSuggestions = async (stageId: string) => {
    setSuggestionLoading(true)
    const result = await getTrainingGroupSuggestions(sessionId, stageId).catch(() => null)
    setSuggestionLoading(false)
    if (!result) return toast.error('分组建议生成失败')
    setSuggestions({ stageId, items: result.suggestions as GroupSuggestion[] })
  }

  const groupedStages = stages
  const groupSource = groupedStages[0]
  const trainingGroups = (grouping?.groups || []).map(group => ({ ...group, Problems: [] as Assignment[], accessPolicy: 'ALL_AT_ONCE' as const, submissionMode: 'ENABLED' as const }))
  const groupsFrozen = isTrainingGroupingDefinitionLocked(sessionStatus, stages)
  const updateAllGroupedStages = (update: (groups: typeof trainingGroups) => typeof trainingGroups) => {
    if (!grouping || !onGroupingChange) return
    onGroupingChange({ ...grouping, groups: update(trainingGroups).map(group => ({ id: group.id, clientKey: group.clientKey, name: group.name, orderIndex: group.orderIndex, status: group.status, participantIds: group.participantIds })), memberships: grouping.memberships })
  }
  const renameTrainingGroup = (groupKey: string, name: string) => updateAllGroupedStages(groups => groups.map(group => group.clientKey === groupKey ? { ...group, name } : group))
  const addTrainingGroup = () => {
    const index = trainingGroups.length + 1
    const clientKey = 'group-' + Date.now() + '-' + index
    updateAllGroupedStages(groups => [...groups, { clientKey, name: '分组 ' + index, accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', participantIds: [], Problems: [] }])
  }
  const removeTrainingGroup = (groupKey: string) => updateAllGroupedStages(groups => groups.filter(group => group.clientKey !== groupKey))
  const assignParticipant = (groupKey: string, participantId: string, checked: boolean) => {
    updateAllGroupedStages(groups => groups.map(group => checked
      ? { ...group, participantIds: group.clientKey === groupKey ? [...new Set([...group.participantIds, participantId])] : group.participantIds.filter(id => id !== participantId) }
      : group.clientKey === groupKey ? { ...group, participantIds: group.participantIds.filter(id => id !== participantId) } : group))
  }
  const applySuggestions = () => {
    if (!rawSuggestions) return
    const preview = rawSuggestions
    updateAllGroupedStages(groups => groups.map(group => ({ ...group, participantIds: preview.items.filter(item => group.id === item.groupId || group.clientKey === item.groupId).map(item => item.user.id) })))
    toast.success('分组建议已写入本地草稿，请检查后保存')
    setSuggestions(undefined)
  }

  if (mode === 'roster') return <div className={styles.stack}>
    <Section title="训练学员" description="这里维护整场训练的参加学生；新增学生默认未分组。" actions={<Button onClick={() => void saveRoster()} loading={saving} disabled={!roster}>保存名单</Button>}>
      {loading && !roster ? <p className={styles.muted}>正在加载学员…</p> : !roster ? <Empty title="暂无可配置名单" /> : <div className={styles.rosterList}>{roster.candidates.map(item => <Checkbox key={item.userId} label={item.displayName} description={item.username + ' · ' + item.role} checked={item.selected} onChange={event => setRoster(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.userId === item.userId ? { ...candidate, selected: event.target.checked } : candidate) } : current)} />)}</div>}
    </Section>
    <Section title="训练分组" description={groupsFrozen ? '已有阶段开始运行，训练分组定义只读；现场换组请前往运行工作台。' : '训练分组属于整场训练。不同阶段可以为不同分组配置不同训练方案；每名学生最多属于一个组。'} actions={<div className={styles.actions}><Button variant="secondary" onClick={addTrainingGroup} disabled={groupsFrozen}>新增分组</Button>{groupSource?.id && <Button variant="secondary" loading={suggestionLoading} onClick={() => void previewSuggestions(groupSource.id!)} disabled={groupsFrozen}>生成分组建议</Button>}</div>}>
      {Boolean(rawSuggestions?.items.length) && <div className={styles.card}><strong>建议预览（尚未应用）</strong>{rawSuggestions?.items.map(item => <p key={item.participantId}><b>{item.user.username}</b> → {item.groupName}<small className={styles.muted}>{item.reason}</small></p>)}<div className={styles.actions}><Button onClick={applySuggestions}>确认应用建议</Button><Button variant="ghost" onClick={() => setSuggestions(undefined)}>取消</Button></div></div>}
      {!trainingGroups.length ? <Empty title="还没有训练分组" description="新增分组后，学生可以按组获得不同题目。" /> : <div className={styles.grid}>{trainingGroups.map(group => <article className={styles.card} key={group.clientKey}><div className={styles.actions}><Input aria-label={group.name + '名称'} value={group.name} disabled={groupsFrozen} onChange={event => renameTrainingGroup(group.clientKey, event.target.value)} /><Button size="sm" variant="ghost" onClick={() => removeTrainingGroup(group.clientKey)} disabled={groupsFrozen}>删除</Button></div><p className={styles.muted}>{group.Problems.length} 道题 · {group.participantIds.length} 名学员</p><div className={styles.rosterList}>{roster?.candidates.filter(candidate => candidate.selected).map(candidate => <Checkbox key={candidate.userId} label={candidate.displayName} description={candidate.username} checked={group.participantIds.includes(candidate.userId)} disabled={groupsFrozen} onChange={event => assignParticipant(group.clientKey, candidate.userId, event.target.checked)} />)}</div></article>)}</div>}
    </Section>
  </div>

  const selectedAssignment = assignments.find(item => item.assignmentId === selectedAssignmentId)
  const hintsFrozen = selectedAssignment ? isTrainingStageDefinitionLocked(selectedAssignment.stageId, stages) : true
  return <Section title="提示配置" description={hintsFrozen ? '该阶段已开始，提示定义已冻结；运行时可在工作台开放或关闭已有提示。' : '提示绑定已保存的题目分配；阶段开始后定义自动冻结。'} actions={<Button onClick={() => openHintEditor()} disabled={!selectedAssignmentId || hintsFrozen}>新增提示</Button>}>
    {!assignments.length ? <Empty title="暂无可配置题目" description="请在“阶段与顺序”中分配题目并先保存。" /> : <div className={styles.stack}><label className={styles.field}>题目分配<Select value={selectedAssignmentId} onChange={event => { setSelectedAssignmentId(event.target.value); void loadHints(event.target.value) }}>{assignments.map(item => <option value={item.assignmentId} key={item.assignmentId}>{item.stageName} · {item.Problem.problemId} {item.Problem.title}</option>)}</Select></label>{loading ? <p className={styles.muted}>正在加载提示…</p> : hints.length ? <div className={styles.hintGrid}>{hints.map(hint => <article className={styles.card} key={hint.id}><div className={styles.actions}><StatusBadge variant="neutral">{hint.level} 级</StatusBadge><StatusBadge variant="info">{trainingHintOpenModeLabel(hint.openMode || 'MANUAL')}</StatusBadge>{!hintsFrozen && <><Button size="sm" variant="ghost" onClick={() => openHintEditor(hint)}>编辑</Button><Button size="sm" variant="ghost" onClick={() => setDeleteHintTarget(hint)}>删除</Button></>}</div><strong>{hint.title || '未命名提示'}</strong><p>{hint.content}</p></article>)}</div> : <Empty title="该题暂无提示" />}</div>}
    <FormDialog isOpen={hintOpen} onClose={resetHintForm} onSubmit={() => void saveHint()} title={editingHint ? '编辑分级提示' : '新增分级提示'} submitText={editingHint ? '保存修改' : '创建提示'} loading={saving} dirty={Boolean(hintContent)}><div className={styles.stack}><label className={styles.field}>级别<Input type="number" min={1} max={20} value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))} /></label><label className={styles.field}>开放方式<Select value={hintMode} onChange={event => setHintMode(event.target.value)}><option value="MANUAL">教练手动</option><option value="TIME">有效训练时间</option><option value="ATTEMPT">提交次数</option><option value="SCORE">最高分数</option></Select></label>{hintMode !== 'MANUAL' && <label className={styles.field}>触发值<Input type="number" value={hintTrigger} onChange={event => setHintTrigger(event.target.value)} /></label>}<label className={styles.field}>标题<Input value={hintTitle} onChange={event => setHintTitle(event.target.value)} /></label><label className={styles.field}>内容<Textarea rows={6} value={hintContent} onChange={event => setHintContent(event.target.value)} /></label></div></FormDialog>
    <FormDialog isOpen={Boolean(deleteHintTarget)} onClose={() => setDeleteHintTarget(undefined)} onSubmit={() => void confirmDeleteHint()} title="删除提示" description={`确认删除 ${deleteHintTarget?.level || ''} 级提示？删除后无法恢复。`} submitText="确认删除" loading={saving}><p className={styles.muted}>{deleteHintTarget?.title || '未命名提示'}</p></FormDialog>
  </Section>
}
