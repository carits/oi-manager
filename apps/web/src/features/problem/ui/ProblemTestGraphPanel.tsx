'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, Download, GripVertical, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import type {
  ProblemTestGraphPairInput,
  ProblemTestGraphSubtask,
  ProblemTestGraphWorkspace,
} from '@oi-manager/contracts'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, FormDialog } from '@/components/ui/Dialogs'
import { Input, SearchField, Select } from '@/components/ui/FormControls'
import { filenameFromContentDisposition, saveBlobDownload } from '@/lib/download'
import { useToast } from '@/components/ui/Toast'
import styles from './ProblemTestGraphPanel.unified.module.css'
import { useUnsavedChanges } from '@/components/navigation/UnsavedChangesProvider'
import {
  getProblemTestGraph,
  registerProblemTestGraphTestcases,
  saveProblemTestGraph,
  setProblemTestGraphTestcaseProtection,
} from '../api/problemTestGraphApi'
import { deleteProblemTestdata, downloadProblemTestdata, uploadProblemTestdata } from '../api/problemFilesApi'

const MAX_SUBTASKS = 15
const MAX_CASES_PER_SUBTASK = 10

type TestcaseRef = {
  testcaseId: string
  input: string
  output: string
  source: string
  score?: number | null
  time?: string | null
  memory?: string | null
}

type TestGroup = {
  id?: string
  key: string
  name: string
  kind: 'official' | 'hack_gate'
  score: number
  type: 'min' | 'max' | 'sum'
  cases: TestcaseRef[]
}

type Subtask = ProblemTestGraphSubtask
type TestdataFile = { id: string; filename: string; size: number; sha256?: string | null; uploadedAt?: string }
type TestcasePoolItem = {
  id: string
  inputFileId: string
  outputFileId: string
  input: string
  output: string
  source: string
  enabled: boolean
  isProtected: boolean
  protectionReason?: string | null
  protectedUntil?: string | null
  assignments: Array<{ subtaskId: number; groupId: string; groupKey: string; groupName: string; groupKind: string }>
}
type DetectedPair = { inputFileId: string; outputFileId: string; input: string; output: string; testcaseId: string | null }

type TestGraph = ProblemTestGraphWorkspace

type ValidationIssue = { path: string; message: string; subtaskId?: number; groupKey?: string }
function cloneSubtasks(subtasks: Subtask[]): Subtask[] {
  return JSON.parse(JSON.stringify(subtasks))
}

function graphFingerprint(fencingToken: number, subtasks: Subtask[]) {
  return JSON.stringify({ fencingToken, subtasks })
}

function validateGraph(subtasks: Subtask[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ids = new Set<number>()
  const add = (path: string, message: string, subtaskId?: number, groupKey?: string) => issues.push({ path, message, subtaskId, groupKey })
  if (!subtasks.length) add('subtasks', '至少需要一个 Subtask')
  if (subtasks.length > MAX_SUBTASKS) add('subtasks', `每道 OI 题最多允许 ${MAX_SUBTASKS} 个 Subtask`)
  let total = 0
  for (const subtask of subtasks) {
    if (!Number.isInteger(subtask.id) || subtask.id <= 0 || ids.has(subtask.id)) add('subtask.id', `Subtask ID ${subtask.id || '—'} 无效或重复`, subtask.id)
    ids.add(subtask.id)
    if (!Number.isInteger(subtask.score) || subtask.score < 0) add('subtask.score', `Subtask ${subtask.id} 分值无效`, subtask.id)
    total += subtask.score || 0
    const official = subtask.groups.filter(group => group.kind === 'official')
    const gates = subtask.groups.filter(group => group.kind === 'hack_gate')
    if (!official.length) add('subtask.groups', `Subtask ${subtask.id} 至少需要一个 Official Group`, subtask.id)
    if (gates.length !== 1) add('subtask.groups', `Subtask ${subtask.id} 必须恰好有一个 Hack Gate`, subtask.id)
    if (official.reduce((sum, group) => sum + Number(group.score || 0), 0) !== Number(subtask.score)) add('subtask.groups', `Subtask ${subtask.id} 的 Official Group 分值之和必须等于 ${subtask.score}`, subtask.id)
    const keys = new Set<string>()
    const uniqueCases = new Set<string>()
    for (const group of subtask.groups) {
      if (!group.key || keys.has(group.key)) add('group.key', `Subtask ${subtask.id} 存在空或重复 Group key`, subtask.id, group.key)
      keys.add(group.key)
      if (!group.name.trim()) add('group.name', 'Group 名称不能为空', subtask.id, group.key)
      if (group.kind === 'official' && !group.cases.length) add('group.cases', `${group.name || group.key} 至少需要一个 Testcase`, subtask.id, group.key)
      const caseIds = group.cases.map(item => item.testcaseId)
      caseIds.forEach(id => uniqueCases.add(id))
      if (new Set(caseIds).size !== caseIds.length) add('group.cases', `${group.name || group.key} 存在重复 Testcase`, subtask.id, group.key)
    }
    if (uniqueCases.size > MAX_CASES_PER_SUBTASK) add('subtask.groups', `Subtask ${subtask.id} 包含 ${uniqueCases.size} 个唯一正式测试点，最多允许 ${MAX_CASES_PER_SUBTASK} 个`, subtask.id)
  }
  if (total !== 100) add('subtasks.score', `Subtask 总分为 ${total}，必须为 100`)
  for (const subtask of subtasks) for (const dependency of subtask.if || []) {
    if (dependency === subtask.id) add('subtask.if', `Subtask ${subtask.id} 不能依赖自身`, subtask.id)
    else if (!ids.has(dependency)) add('subtask.if', `Subtask ${subtask.id} 依赖不存在的 Subtask ${dependency}`, subtask.id)
  }
  const byId = new Map(subtasks.map(subtask => [subtask.id, subtask]))
  const visiting = new Set<number>()
  const visited = new Set<number>()
  const visit = (id: number): boolean => {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    visiting.add(id)
    for (const dependency of byId.get(id)?.if || []) if (!visit(dependency)) return false
    visiting.delete(id)
    visited.add(id)
    return true
  }
  for (const id of ids) if (!visit(id)) { add('subtasks.if', 'Subtask 依赖不能形成环'); break }
  return issues
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function ProblemTestGraphPanel({ problemId, onDirtyChange }: { problemId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const toast = useToast()
  const uploadRef = useRef<HTMLInputElement>(null)
  const baseFingerprint = useRef('')
  const [graph, setGraph] = useState<TestGraph | null>(null)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<number | null>(null)
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [selectedTestcaseIds, setSelectedTestcaseIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [manualInputId, setManualInputId] = useState('')
  const [manualOutputId, setManualOutputId] = useState('')
  const [deleteFile, setDeleteFile] = useState<TestdataFile | null>(null)
  const [replacementFiles, setReplacementFiles] = useState<File[] | null>(null)
  const [draggedSubtask, setDraggedSubtask] = useState<number | null>(null)
  const [draggedGroup, setDraggedGroup] = useState<number | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [protectingTestcase, setProtectingTestcase] = useState<TestcasePoolItem | null>(null)
  const [protectionReason, setProtectionReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getProblemTestGraph(problemId)
      setGraph(result)
      const next = cloneSubtasks(result.subtasks || [])
      setSubtasks(next)
      baseFingerprint.current = graphFingerprint(result.fencingToken, next)
      setSelectedSubtaskId(current => next.some(item => item.id === current) ? current : next[0]?.id ?? null)
      setSelectedGroupKey(null)
      setSelectedTestcaseIds(new Set())
    } catch {
      toast.error('测试图加载失败')
    } finally {
      setLoading(false)
    }
  }, [problemId, toast])

  const refreshPool = useCallback(async () => {
    try {
      setGraph(await getProblemTestGraph(problemId))
    } catch { toast.error('测试数据刷新失败') }
  }, [problemId, toast])

  useEffect(() => { load() }, [load])
  const dirty = Boolean(graph?.migrated) && graphFingerprint(graph?.fencingToken || 0, subtasks) !== baseFingerprint.current
  useUnsavedChanges(`problem-test-graph:${problemId}`, dirty)
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  const selectedSubtask = subtasks.find(item => item.id === selectedSubtaskId) || null
  const selectedGroup = selectedSubtask?.groups.find(group => group.key === selectedGroupKey) || selectedSubtask?.groups.find(group => group.kind === 'official') || null
  useEffect(() => {
    if (!selectedSubtask) return
    if (!selectedSubtask.groups.some(group => group.key === selectedGroupKey)) setSelectedGroupKey(selectedSubtask.groups.find(group => group.kind === 'official')?.key || selectedSubtask.groups[0]?.key || null)
  }, [selectedGroupKey, selectedSubtask])

  const issues = useMemo(() => validateGraph(subtasks), [subtasks])
  const totalScore = subtasks.reduce((sum, item) => sum + Number(item.score || 0), 0)
  const visibleTestcases = useMemo(() => (graph?.testcases || []).filter(item => `${item.input} ${item.output}`.toLowerCase().includes(query.trim().toLowerCase())), [graph?.testcases, query])
  const unregisteredPairs = graph?.pairs.filter(pair => !pair.testcaseId) || []

  const updateSubtask = (id: number, updater: (subtask: Subtask) => Subtask) => setSubtasks(current => current.map(item => item.id === id ? updater(item) : item))
  const replaceGraphData = (next: TestGraph) => {
    setGraph(next)
    const draft = cloneSubtasks(next.subtasks || [])
    setSubtasks(draft)
    baseFingerprint.current = graphFingerprint(next.fencingToken, draft)
    setSelectedSubtaskId(draft[0]?.id ?? null)
    setSelectedGroupKey(null)
  }

  const save = async () => {
    if (!graph || issues.length) return
    setSaving(true)
    try {
      const result = await saveProblemTestGraph(problemId, {
        slot: graph.slot,
        expectedFencingToken: graph.fencingToken,
        subtasks,
        overrideReason: overrideReason.trim() || undefined,
      })
      if (!result.ok) {
        if (result.error.code === 'TEST_GRAPH_STALE') toast.error('测试图已被其他管理员修改；当前草稿仍保留，请导出或刷新后重新调整')
        else toast.error(result.error.message || '保存失败')
        return
      }
      replaceGraphData(result.data)
      setOverrideReason('')
      toast.success(`已更新 ${result.data.slot === 'STABLE' ? 'Stable' : 'Evolving'} 数据槽`)
    } finally { setSaving(false) }
  }

  const addSubtask = () => {
    if (subtasks.length >= MAX_SUBTASKS) return toast.error(`每道 OI 题最多允许 ${MAX_SUBTASKS} 个 Subtask`)
    const id = subtasks.length ? Math.max(...subtasks.map(item => item.id)) + 1 : 1
    const officialKey = `official-${id}-${Date.now()}`
    const next: Subtask = { id, score: 0, if: [], groups: [
      { key: officialKey, name: '官方测试组', kind: 'official', score: 0, type: 'min', cases: [] },
      { key: 'hack-gate', name: 'Hack 得分门槛', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
    ] }
    setSubtasks(current => [...current, next])
    setSelectedSubtaskId(id)
    setSelectedGroupKey(officialKey)
  }

  const copySubtask = (source: Subtask) => {
    if (subtasks.length >= MAX_SUBTASKS) return toast.error(`每道 OI 题最多允许 ${MAX_SUBTASKS} 个 Subtask`)
    const id = subtasks.length ? Math.max(...subtasks.map(item => item.id)) + 1 : 1
    const next: Subtask = {
      dbId: undefined, id, score: source.score, if: [...source.if],
      groups: source.groups.map((group, index) => group.kind === 'hack_gate'
        ? { ...group, id: undefined, key: 'hack-gate', cases: [] }
        : { ...group, id: undefined, key: `official-${id}-${index + 1}-${Date.now()}`, name: `${group.name} 副本`, cases: group.cases.map(item => ({ ...item })) }),
    }
    setSubtasks(current => [...current, next])
    setSelectedSubtaskId(id)
    setSelectedGroupKey(next.groups.find(group => group.kind === 'official')?.key || null)
  }

  const deleteSubtask = (id: number) => {
    const next = subtasks.filter(item => item.id !== id).map(item => ({ ...item, if: item.if.filter(dependency => dependency !== id) }))
    setSubtasks(next)
    setSelectedSubtaskId(next[0]?.id ?? null)
  }

  const changeSubtaskId = (oldId: number, newId: number) => {
    setSubtasks(current => current.map(item => item.id === oldId ? { ...item, id: newId } : { ...item, if: item.if.map(dependency => dependency === oldId ? newId : dependency) }))
    setSelectedSubtaskId(newId)
  }

  const addGroup = () => {
    if (!selectedSubtask) return
    const key = `official-${selectedSubtask.id}-${Date.now()}`
    updateSubtask(selectedSubtask.id, item => ({ ...item, groups: [...item.groups.filter(group => group.kind === 'official'), { key, name: '新测试组', kind: 'official', score: 0, type: 'min', cases: [] }, ...item.groups.filter(group => group.kind === 'hack_gate')] }))
    setSelectedGroupKey(key)
  }

  const updateGroup = (key: string, updater: (group: TestGroup) => TestGroup) => {
    if (!selectedSubtask) return
    updateSubtask(selectedSubtask.id, item => ({ ...item, groups: item.groups.map(group => group.key === key ? updater(group) : group) }))
  }

  const deleteGroup = (key: string) => {
    if (!selectedSubtask) return
    updateSubtask(selectedSubtask.id, item => ({ ...item, groups: item.groups.filter(group => group.key !== key) }))
    setSelectedGroupKey(selectedSubtask.groups.find(group => group.kind === 'official' && group.key !== key)?.key || null)
  }

  const assignSelected = () => {
    if (!selectedGroup || selectedGroup.kind !== 'official' || !selectedTestcaseIds.size || !selectedSubtask) return
    const additions = (graph?.testcases || []).filter(item => selectedTestcaseIds.has(item.id) && !selectedGroup.cases.some(current => current.testcaseId === item.id)).map(item => ({ testcaseId: item.id, input: item.input, output: item.output, source: item.source }))
    const currentUnique = new Set(selectedSubtask.groups.flatMap(group => group.cases.map(item => item.testcaseId)))
    const newUnique = additions.filter(item => !currentUnique.has(item.testcaseId))
    if (currentUnique.size + newUnique.length > MAX_CASES_PER_SUBTASK) return toast.error(`Subtask ${selectedSubtask.id} 最多允许 ${MAX_CASES_PER_SUBTASK} 个唯一测试点；满额后请通过 Candidate Selector 替换`)
    updateGroup(selectedGroup.key, group => ({ ...group, cases: [...group.cases, ...additions] }))
    setSelectedTestcaseIds(new Set())
  }

  const toggleProtection = async (item: TestcasePoolItem) => {
    if (!item.isProtected) { setProtectingTestcase(item); setProtectionReason(''); return }
    const reason = ''
    const result = await setProblemTestGraphTestcaseProtection(problemId, item.id, { isProtected: !item.isProtected, reason })
    if (!result.ok) return toast.error(result.error.message || '测试点保护状态更新失败')
    toast.success('保护状态已更新')
    await refreshPool()
  }
  const protectTestcase = async () => {
    if (!protectingTestcase || protectionReason.trim().length < 5) return
    const result = await setProblemTestGraphTestcaseProtection(problemId, protectingTestcase.id, { isProtected: true, reason: protectionReason.trim() })
    if (!result.ok) return toast.error(result.error.message || '测试点保护状态更新失败')
    toast.success('测试点已设为永久保护')
    setProtectingTestcase(null); setProtectionReason(''); await refreshPool()
  }

  const registerPairs = async (pairs: ProblemTestGraphPairInput[]) => {
    const result = await registerProblemTestGraphTestcases(problemId, pairs)
    if (!result.ok) return toast.error(result.error.message || '测试点注册失败')
    setGraph(result.data)
    toast.success('测试点已注册')
    setManualInputId('')
    setManualOutputId('')
  }

  const uploadFiles = async (files: File[], replace = false) => {
    return uploadProblemTestdata(problemId, files, replace)
  }

  const handleUpload = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    try {
      const result = await uploadFiles(files)
      if (result.success) { toast.success(`已上传 ${files.length} 个文件`); await refreshPool() }
      else if (result.status === 409 && result.code === 'TESTDATA_CONFLICT') setReplacementFiles(files)
      else toast.error(result.message || '上传失败')
    } finally { setUploading(false); if (uploadRef.current) uploadRef.current.value = '' }
  }

  const replaceUpload = async () => {
    if (!replacementFiles) return
    setUploading(true)
    try {
      const result = await uploadFiles(replacementFiles, true)
      if (!result.success) return toast.error(result.message || '替换失败')
      toast.success(`已替换 ${replacementFiles.length} 个文件`)
      setReplacementFiles(null)
      await refreshPool()
    } finally { setUploading(false) }
  }

  const removeFile = async () => {
    if (!deleteFile) return
    const result = await deleteProblemTestdata(problemId, deleteFile.id)
    if (!result.ok) return toast.error(result.error.message || '删除失败')
    toast.success('测试数据文件已删除')
    setDeleteFile(null)
    await refreshPool()
  }

  const downloadFile = async (file: TestdataFile) => {
    try {
      const result = await downloadProblemTestdata(problemId, file.id)
      saveBlobDownload(result.blob, filenameFromContentDisposition(result.contentDisposition, file.filename))
    } catch { toast.error('下载失败') }
  }


  if (loading) return <div className={styles.loading}>正在加载数据与分组工作台…</div>
  if (!graph) return <div className={styles.error}>测试图加载失败，请重新进入页面。</div>
  if (!graph.migrated) return <section className={styles.migrationCard}><div><h3>测试图尚未初始化</h3><p>请由运维人员运行离线迁移审计任务，页面不再提供历史数据迁移操作。</p></div>{graph.migrationIssues?.length ? <ul>{graph.migrationIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}</section>

  return <section className={styles.root}>
    <header className={styles.toolbar}>
      <div className={styles.toolbarTitle}><strong>数据与分组</strong><span>{graph.slot === 'STABLE' ? 'Stable 当前数据' : 'Evolving 当前数据'}</span><span>Graph {graph.graphHash.slice(0, 12)}</span><span>栅栏 #{graph.fencingToken}</span><span className={totalScore === 100 ? styles.scoreOk : styles.scoreError}>总分 {totalScore}/100</span><span className={issues.length ? styles.issueCount : styles.ready}>{issues.length ? `${issues.length} 个问题` : '配置有效'}</span></div>
      <div className={styles.toolbarActions}><label className={styles.uploadButton}><Upload size={16} aria-hidden="true" />{uploading ? '上传中…' : '上传数据'}<Input ref={uploadRef} type="file" multiple accept=".in,.out,.ans,.txt,.yaml,.yml,.zip" disabled={uploading} onChange={event => handleUpload(Array.from(event.target.files || []))} /></label><Button variant="outline" icon={<RefreshCw size={16} />} disabled={saving} onClick={load}>重新加载</Button><Button variant="primary" icon={<Save size={16} />} loading={saving} disabled={!dirty || issues.length > 0} onClick={save}>更新 {graph.slot === 'STABLE' ? 'Stable' : 'Evolving'}</Button></div>
    </header>
    <div className={styles.poolToolbar}><Input value={overrideReason} onChange={event => setOverrideReason(event.target.value)} placeholder="仅在 Wrong Corpus 不足且需超出 3 个基础核心点时填写强制发布原因（至少 10 字）" aria-label="强制发布原因" /></div>
    {issues.length > 0 && <div className={styles.validationBar}>{issues.slice(0, 4).map(issue => <Button variant="text" key={`${issue.path}-${issue.message}`} onClick={() => { if (issue.subtaskId) setSelectedSubtaskId(issue.subtaskId); if (issue.groupKey) setSelectedGroupKey(issue.groupKey) }}>{issue.message}</Button>)}{issues.length > 4 && <span>另有 {issues.length - 4} 个问题</span>}</div>}

    <div className={styles.workspace}>
      <section className={styles.column} aria-label="Subtask 列表">
        <div className={styles.columnHeader}><div><strong>Subtask</strong><span>{subtasks.length}/{MAX_SUBTASKS} 项</span></div><Button variant="outline" size="sm" icon={<Plus size={15} />} disabled={subtasks.length >= MAX_SUBTASKS} onClick={addSubtask}>添加</Button></div>
        <div className={styles.columnBody}>{subtasks.map((subtask, index) => <article key={`${subtask.id}-${index}`} draggable onDragStart={() => setDraggedSubtask(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggedSubtask != null) setSubtasks(current => moveItem(current, draggedSubtask, index)); setDraggedSubtask(null) }} className={`${styles.subtaskCard} ${selectedSubtaskId === subtask.id ? styles.selectedCard : ''}`} onClick={() => setSelectedSubtaskId(subtask.id)}><div className={styles.cardTitle}><GripVertical size={15} aria-hidden="true" /><strong>Subtask {subtask.id}</strong><span>{subtask.score} 分</span></div><div className={styles.cardMeta}>{subtask.groups.filter(group => group.kind === 'official').length} Groups · {new Set(subtask.groups.flatMap(group => group.cases.map(item => item.testcaseId))).size}/{MAX_CASES_PER_SUBTASK} Testcases</div><div className={styles.cardMeta}>{subtask.if.length ? `依赖 S${subtask.if.join(', S')}` : '无依赖'}</div><div className={styles.cardActions}><Button variant="text" iconOnly aria-label="上移 Subtask" disabled={index === 0} onClick={event => { event.stopPropagation(); setSubtasks(current => moveItem(current, index, index - 1)) }}><ArrowUp size={15} /></Button><Button variant="text" iconOnly aria-label="下移 Subtask" disabled={index === subtasks.length - 1} onClick={event => { event.stopPropagation(); setSubtasks(current => moveItem(current, index, index + 1)) }}><ArrowDown size={15} /></Button><Button variant="text" iconOnly aria-label="复制 Subtask" disabled={subtasks.length >= MAX_SUBTASKS} onClick={event => { event.stopPropagation(); copySubtask(subtask) }}><Copy size={15} /></Button><Button variant="text" iconOnly aria-label="删除 Subtask" onClick={event => { event.stopPropagation(); deleteSubtask(subtask.id) }}><Trash2 size={15} /></Button></div></article>)}</div>
      </section>

      <section className={styles.column} aria-label="Group 配置">
        <div className={styles.columnHeader}><div><strong>Group 配置</strong><span>{selectedSubtask ? `Subtask ${selectedSubtask.id}` : '未选择'}</span></div><Button variant="outline" size="sm" icon={<Plus size={15} />} disabled={!selectedSubtask} onClick={addGroup}>添加 Group</Button></div>
        <div className={styles.columnBody}>{selectedSubtask && <div className={styles.subtaskForm}><label>ID<Input type="number" min={1} value={selectedSubtask.id} onChange={event => changeSubtaskId(selectedSubtask.id, Number(event.target.value))} /></label><label>分值<Input type="number" min={0} value={selectedSubtask.score} onChange={event => updateSubtask(selectedSubtask.id, item => ({ ...item, score: Number(event.target.value) }))} /></label><fieldset><legend>依赖</legend><div className={styles.dependencies}>{subtasks.filter(item => item.id !== selectedSubtask.id).map(item => <label key={item.id}><Input type="checkbox" checked={selectedSubtask.if.includes(item.id)} onChange={event => updateSubtask(selectedSubtask.id, current => ({ ...current, if: event.target.checked ? [...current.if, item.id] : current.if.filter(id => id !== item.id) }))} />S{item.id}</label>)}</div></fieldset></div>}
          {selectedSubtask?.groups.map((group, index) => <article key={group.key} draggable={group.kind === 'official'} onDragStart={() => setDraggedGroup(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggedGroup != null && group.kind === 'official') updateSubtask(selectedSubtask.id, item => ({ ...item, groups: moveItem(item.groups, draggedGroup, index) })); setDraggedGroup(null) }} className={`${styles.groupCard} ${selectedGroup?.key === group.key ? styles.selectedCard : ''} ${group.kind === 'hack_gate' ? styles.hackGate : ''}`} onClick={() => setSelectedGroupKey(group.key)}><div className={styles.cardTitle}><GripVertical size={15} aria-hidden="true" /><strong>{group.kind === 'hack_gate' ? '系统 Hack Gate' : group.name}</strong><span>{group.cases.length} 点</span></div>{group.kind === 'official' ? <div className={styles.groupForm}><label>名称<Input value={group.name} onChange={event => updateGroup(group.key, current => ({ ...current, name: event.target.value }))} /></label><label>分值<Input type="number" min={0} value={group.score} onChange={event => updateGroup(group.key, current => ({ ...current, score: Number(event.target.value) }))} /></label><label>聚合<Select value={group.type} onChange={event => updateGroup(group.key, current => ({ ...current, type: event.target.value as TestGroup['type'] }))}><option value="min">Min</option><option value="max">Max</option><option value="sum">Sum</option></Select></label><div className={styles.cardActions}><Button variant="text" iconOnly aria-label="上移 Group" disabled={index === 0} onClick={event => { event.stopPropagation(); updateSubtask(selectedSubtask.id, item => ({ ...item, groups: moveItem(item.groups, index, index - 1) })) }}><ArrowUp size={15} /></Button><Button variant="text" iconOnly aria-label="下移 Group" disabled={index >= selectedSubtask.groups.length - 2} onClick={event => { event.stopPropagation(); updateSubtask(selectedSubtask.id, item => ({ ...item, groups: moveItem(item.groups, index, index + 1) })) }}><ArrowDown size={15} /></Button><Button variant="text" iconOnly aria-label="删除 Group" onClick={event => { event.stopPropagation(); deleteGroup(group.key) }}><Trash2 size={15} /></Button></div></div> : <p>由系统维护 · min 门槛 · 不占分值 · 普通保存不能修改</p>}</article>)}
          {selectedGroup?.kind === 'official' && <div className={styles.groupCases}><div className={styles.sectionLabel}><strong>当前 Group 测试点</strong><span>{selectedGroup.cases.length}</span></div>{selectedGroup.cases.map((item, index) => <div key={item.testcaseId} className={styles.groupCase}><div><strong>{item.input}</strong><span>→ {item.output}</span></div><Input aria-label={`${item.input} 单点分值`} type="number" placeholder="点分" value={item.score ?? ''} onChange={event => updateGroup(selectedGroup.key, group => ({ ...group, cases: group.cases.map((current, currentIndex) => currentIndex === index ? { ...current, score: event.target.value === '' ? null : Number(event.target.value) } : current) }))} /><Input aria-label={`${item.input} 时间覆盖`} placeholder="时间" value={item.time ?? ''} onChange={event => updateGroup(selectedGroup.key, group => ({ ...group, cases: group.cases.map((current, currentIndex) => currentIndex === index ? { ...current, time: event.target.value || null } : current) }))} /><Input aria-label={`${item.input} 内存覆盖`} placeholder="内存" value={item.memory ?? ''} onChange={event => updateGroup(selectedGroup.key, group => ({ ...group, cases: group.cases.map((current, currentIndex) => currentIndex === index ? { ...current, memory: event.target.value || null } : current) }))} /><div className={styles.caseActions}><Button variant="text" iconOnly aria-label={`上移 ${item.input}`} disabled={index === 0} onClick={() => updateGroup(selectedGroup.key, group => ({ ...group, cases: moveItem(group.cases, index, index - 1) }))}><ArrowUp size={14} /></Button><Button variant="text" iconOnly aria-label={`下移 ${item.input}`} disabled={index === selectedGroup.cases.length - 1} onClick={() => updateGroup(selectedGroup.key, group => ({ ...group, cases: moveItem(group.cases, index, index + 1) }))}><ArrowDown size={14} /></Button><Button variant="text" iconOnly aria-label={`从 Group 移除 ${item.input}`} onClick={() => updateGroup(selectedGroup.key, group => ({ ...group, cases: group.cases.filter(current => current.testcaseId !== item.testcaseId) }))}><Trash2 size={14} /></Button></div></div>)}</div>}
        </div>
      </section>

      <section className={styles.column} aria-label="Testcase 测试点池">
        <div className={styles.columnHeader}><div><strong>Testcase 池</strong><span>{graph.testcases.length} 已注册</span></div>{unregisteredPairs.length > 0 && <Button variant="outline" size="sm" onClick={() => registerPairs(unregisteredPairs)}>注册全部 ({unregisteredPairs.length})</Button>}</div>
        <div className={styles.poolToolbar}><SearchField value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索输入或答案文件" /><Button variant="primary" size="sm" disabled={!selectedTestcaseIds.size || selectedGroup?.kind !== 'official'} onClick={assignSelected}>加入当前 Group ({selectedTestcaseIds.size})</Button>{unregisteredPairs.length > 0 && <div className={styles.unregistered}><strong>待注册输入/答案对</strong>{unregisteredPairs.slice(0, 8).map(pair => <span key={`${pair.inputFileId}-${pair.outputFileId}`}>{pair.input} → {pair.output}</span>)}{unregisteredPairs.length > 8 && <small>另有 {unregisteredPairs.length - 8} 对</small>}</div>}{graph.unmatchedFiles.length > 0 && <div className={styles.unmatched}>未匹配：{graph.unmatchedFiles.map(file => file.filename).join('、')}</div>}</div>
        <div className={styles.columnBody}>{visibleTestcases.map(item => <div key={item.id} className={styles.testcaseCard}><Input type="checkbox" aria-label={`选择 ${item.input}`} checked={selectedTestcaseIds.has(item.id)} onChange={event => setSelectedTestcaseIds(current => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next })} /><div><strong>{item.input}{item.isProtected ? ' · 永久保护' : item.protectedUntil ? ' · 保护期内' : ''}</strong><span>→ {item.output}</span><small>{item.source === 'hack' ? 'Hack 数据' : item.assignments.length ? item.assignments.map(assignment => `S${assignment.subtaskId}/${assignment.groupName}`).join(' · ') : '尚未分组'}</small>{item.protectionReason && <small>{item.protectionReason}</small>}</div><Button variant="text" size="sm" onClick={() => toggleProtection(item)}>{item.isProtected ? '解除保护' : '永久保护'}</Button></div>)}</div>
        <div className={styles.registration}><div className={styles.sectionLabel}><strong>手动注册测试点</strong><span>用于无法按同名自动配对的文件</span></div><Select value={manualInputId} onChange={event => setManualInputId(event.target.value)}><option value="">选择输入文件</option>{graph.files.filter(file => file.filename.toLowerCase().endsWith('.in')).map(file => <option key={file.id} value={file.id}>{file.filename}</option>)}</Select><Select value={manualOutputId} onChange={event => setManualOutputId(event.target.value)}><option value="">选择答案文件</option>{graph.files.filter(file => /\.(out|ans)$/i.test(file.filename)).map(file => <option key={file.id} value={file.id}>{file.filename}</option>)}</Select><Button variant="outline" disabled={!manualInputId || !manualOutputId} onClick={() => registerPairs([{ inputFileId: manualInputId, outputFileId: manualOutputId }])}>注册配对</Button></div>
      </section>
    </div>

    <details className={styles.files}><summary>测试数据文件（{graph.files.length}）与未匹配文件（{graph.unmatchedFiles.length}）</summary><div className={styles.fileGrid}>{graph.files.map(file => <div key={file.id} className={styles.fileRow}><div><strong>{file.filename}</strong><span>{file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KiB`}</span></div><div><Button variant="text" iconOnly aria-label={`下载 ${file.filename}`} onClick={() => downloadFile(file)}><Download size={15} /></Button><Button variant="text" iconOnly aria-label={`删除 ${file.filename}`} onClick={() => setDeleteFile(file)}><Trash2 size={15} /></Button></div></div>)}</div></details>

    <ConfirmDialog isOpen={Boolean(replacementFiles)} onClose={() => setReplacementFiles(null)} onConfirm={replaceUpload} title="替换同名测试数据？" message="同名文件将进入当前数据槽的下一次原子替换；若该槽正在被 Judge 或活动读取，更新会排队等待 Reader 释放。" confirmText="确认替换" danger loading={uploading} />
    <ConfirmDialog isOpen={Boolean(deleteFile)} onClose={() => setDeleteFile(null)} onConfirm={removeFile} title="删除测试数据文件？" message={deleteFile ? `确定删除 ${deleteFile.filename}？已被 Official Group 或 Hack Gate 使用的文件会由服务端拒绝删除。` : ''} confirmText="删除" danger />
    <FormDialog isOpen={Boolean(protectingTestcase)} onClose={() => { setProtectingTestcase(null); setProtectionReason('') }} onSubmit={protectTestcase} title="永久保护测试点" description={protectingTestcase ? `${protectingTestcase.input} → ${protectingTestcase.output}` : ''} submitText="确认保护" dirty={Boolean(protectionReason)}><label>保护原因<Input value={protectionReason} onChange={event => setProtectionReason(event.target.value)} placeholder="至少 5 字，例如：覆盖题目唯一边界结构" /></label></FormDialog>

  </section>
}
