'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import styles from './ProblemJudgeAssetsPanel.module.css'

type Version = { id: string; versionNumber: number; language: string; source: string; origin: string; compileStatus: string; createdAt: string }
type Program = { id: string; kind: string; name: string; language: string; currentVersionId?: string | null; versions: Version[] }
type JobCase = { id: string; name: string; status: string; failureStage?: string; message?: string; inputPreview?: string; outputPreview?: string }
type Job = { id: string; status: string; expectedLatestRevisionId?: string; promotedRevisionId?: string; createdAt: string; cases?: JobCase[] }
type Graph = { revisionId?: string; subtasks: Array<{ id: number; groups: Array<{ key: string; name: string; kind: string }> }> }
type AiUsage = { markdownStatements: Array<{ id: string; language?: string; maxReservedTokens: number }> }
type CandidatePool = { policy: { revision: number; selectorMode: string; maxHotCandidates: number; topK: number }; activeCount: number; hotBytes: number; candidates: Array<{ id: string; source: string; targetRole: string; status: string; evaluationStage: string; marginalValue: number; createdAt: string }> }
type Corpus = { revision?: { revisionNumber: number; clusterCount: number; evaluationCount: number; holdoutCount: number } | null; clusters: Array<{ id: string; weight: number; frequency: number; partition: string }>; categories: unknown[] }

const KIND_LABEL: Record<string, string> = { standard: 'STD', validator: 'Validator', classifier: 'Classifier', generator: 'Generator' }

export function ProblemJudgeAssetsPanel({ problemId, judgeMode }: { problemId: string; judgeMode: 'acm' | 'oi' }) {
  const toast = useToast()
  const [tab, setTab] = useState<'programs' | 'import' | 'generate' | 'candidates' | 'pool' | 'corpus' | 'revisions'>('programs')
  const [programs, setPrograms] = useState<Program[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [graph, setGraph] = useState<Graph | null>(null)
  const [saving, setSaving] = useState(false)
  const [kind, setKind] = useState('standard'), [name, setName] = useState(''), [language, setLanguage] = useState('cpp17'), [source, setSource] = useState('')
  const [standardId, setStandardId] = useState(''), [validatorId, setValidatorId] = useState(''), [generatorId, setGeneratorId] = useState('')
  const [sourceMode, setSourceMode] = useState<'generator' | 'input'>('generator')
  const [rows, setRows] = useState('small-1 | 1 | 10 100\nsmall-2 | 2 | 100 1000')
  const [aiRequest, setAiRequest] = useState<any>(null)
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null)
  const [statementId, setStatementId] = useState('')
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [importFiles, setImportFiles] = useState<File[]>([])
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [candidatePool, setCandidatePool] = useState<CandidatePool | null>(null)
  const [corpus, setCorpus] = useState<Corpus | null>(null)

  const load = useCallback(async () => {
    const [programResult, jobResult, graphResult, aiUsageResult, poolResult, corpusResult] = await Promise.all([
      apiClient.get<Program[]>(`/api/problems/${problemId}/judge-programs`),
      apiClient.get<Job[]>(`/api/problems/${problemId}/data-generation-jobs`),
      judgeMode === 'oi' ? apiClient.get<Graph>(`/api/problems/${problemId}/test-graph`) : Promise.resolve(null),
      apiClient.get<AiUsage>(`/api/problems/${problemId}/ai/usage`),
      apiClient.get<CandidatePool>(`/api/problems/${problemId}/candidate-pool`),
      apiClient.get<Corpus>(`/api/problems/${problemId}/wrong-corpus`),
    ])
    if (programResult.success && programResult.data) setPrograms(programResult.data)
    if (jobResult.success && jobResult.data) setJobs(jobResult.data)
    if (graphResult && graphResult.success && graphResult.data) setGraph(graphResult.data)
    if (aiUsageResult.success && aiUsageResult.data) {
      setAiUsage(aiUsageResult.data)
      setStatementId(current => current || aiUsageResult.data!.markdownStatements[0]?.id || '')
    }
    if (poolResult.success && poolResult.data) setCandidatePool(poolResult.data)
    if (corpusResult.success && corpusResult.data) setCorpus(corpusResult.data)
  }, [problemId, judgeMode])
  useEffect(() => { void load() }, [load])

  const versions = (programKind: string) => programs.filter(item => item.kind === programKind).flatMap(item => item.versions.filter(version => item.currentVersionId === version.id).map(version => ({ ...version, programName: item.name })))
  const currentStandard = versions('standard'), currentValidator = versions('validator'), currentGenerator = versions('generator')
  const officialGroups = useMemo(() => graph?.subtasks.flatMap(subtask => subtask.groups.filter(group => group.kind === 'official').map(group => ({ value: `${subtask.id}:${group.key}`, label: `Subtask ${subtask.id} · ${group.name}` }))) || [], [graph])

  const saveProgram = async () => {
    setSaving(true)
    try {
      const result = await apiClient.post(`/api/problems/${problemId}/judge-programs`, { kind, name: name || KIND_LABEL[kind], language, source })
      if (!result.success) return toast.error(result.message || '评测程序保存失败')
      setSource(''); setName(''); toast.success('评测程序已编译并保存'); await load()
    } finally { setSaving(false) }
  }

  const readFile = async (file?: File) => { if (file) setSource(await file.text()) }
  const generateValidator = async (parentRequestId?: string) => {
    setSaving(true)
    try {
      const result = await apiClient.post<any>(`/api/problems/${problemId}/ai/validator${parentRequestId ? `/${parentRequestId}/repair` : ''}`, parentRequestId ? {} : { statementId })
      if (!result.success || !result.data) return toast.error(result.message || 'DeepSeek Validator 生成失败')
      setAiRequest(result.data); toast.success(`DeepSeek 已使用 ${result.data.totalTokens ?? '实际'} Token`)
    } finally { setSaving(false) }
  }
  const saveAi = async () => {
    const result = await apiClient.post(`/api/problems/${problemId}/ai/validator/${aiRequest.id}/save`, { name: 'AI Validator' })
    if (!result.success) return toast.error(result.message || 'AI Validator 保存失败')
    toast.success('AI Validator 已保存为新的程序版本'); await load()
  }
  const generateValidatorDsl = async () => {
    setSaving(true)
    try {
      const result = await apiClient.post<any>(`/api/problems/${problemId}/ai/validator-spec`, { statementId })
      if (!result.success || !result.data) return toast.error(result.message || 'DeepSeek Validator DSL 生成失败')
      setAiRequest({ ...result.data, dsl: true }); toast.success(`DeepSeek 已使用 ${result.data.totalTokens ?? '实际'} Token`)
    } finally { setSaving(false) }
  }
  const saveAiDsl = async () => {
    const result = await apiClient.post(`/api/problems/${problemId}/ai/validator-spec/${aiRequest.id}/save`, {})
    if (!result.success) return toast.error(result.message || 'Validator DSL 保存失败')
    toast.success('Validator DSL 已保存；激活前仍可审阅规则与测试样例'); await load()
  }
  const updateSelectorMode = async (selectorMode: 'observe' | 'auto') => {
    if (!candidatePool) return
    const result = await apiClient.put(`/api/problems/${problemId}/candidate-policy`, { expectedRevision: candidatePool.policy.revision, selectorMode, maxHotCandidates: candidatePool.policy.maxHotCandidates, topK: candidatePool.policy.topK })
    if (!result.success) return toast.error(result.message || '策略更新失败')
    toast.success(selectorMode === 'auto' ? '已启用质量阈值自动发布' : '已切换为观察模式'); await load()
  }
  const rebuildCorpus = async () => {
    setSaving(true)
    try {
      const result = await apiClient.post(`/api/problems/${problemId}/wrong-corpus/rebuild`, {})
      if (!result.success) return toast.error(result.message || 'Corpus 重建失败')
      toast.success(result.message || 'Corpus 已重建'); await load()
    } finally { setSaving(false) }
  }

  const createJob = async () => {
    let cases: Array<{ name: string; seed?: string; args: string[]; inputData?: string }>
    try {
      cases = sourceMode === 'input'
        ? (JSON.parse(rows) as Array<{ name?: string; inputData: string }>).map((item, index) => ({ name: item.name || `case-${index + 1}`, args: [], inputData: item.inputData }))
        : rows.split('\n').map(row => row.trim()).filter(Boolean).map((row, index) => { const [caseName, seed, args] = row.split('|').map(item => item.trim()); return { name: caseName || `case-${index + 1}`, seed, args: args ? args.split(/\s+/) : [] } })
    } catch { return toast.error('输入数据必须是合法 JSON 数组') }
    const result = await apiClient.post<Job>(`/api/problems/${problemId}/data-generation-jobs`, { sourceMode, generatorVersionId: sourceMode === 'generator' ? generatorId : undefined, standardVersionId: standardId, validatorVersionId: validatorId, cases })
    if (!result.success) return toast.error(result.message || '生成任务创建失败')
    toast.success('已加入数据生成队列'); await load(); setTab('candidates')
  }
  const uploadTestdata = async () => {
    if (!importFiles.length) return
    setSaving(true)
    try {
      const body = new FormData()
      importFiles.forEach(file => body.append('files', file))
      if (replaceExisting) body.append('replace', 'true')
      const result = await apiClient.postFile(`/api/problems/${problemId}/testdata`, body, { timeout: 120000 })
      if (!result.success) return toast.error(result.message || '测试数据上传失败')
      toast.success(`已导入 ${importFiles.length} 个文件`)
      setImportFiles([])
    } finally { setSaving(false) }
  }
  const openJob = async (job: Job) => { const result = await apiClient.get<Job>(`/api/problems/${problemId}/data-generation-jobs/${job.id}`); if (result.success && result.data) setSelectedJob(result.data) }
  useEffect(() => {
    if (!selectedJob || !['queued', 'running', 'finalizing'].includes(selectedJob.status)) return
    const timer = window.setInterval(() => { void openJob(selectedJob) }, 2000)
    return () => window.clearInterval(timer)
  }, [selectedJob])
  const promote = async () => {
    if (!selectedJob) return
    const valid = selectedJob.cases?.filter(item => item.status === 'validated') || []
    const body: any = { expectedLatestRevisionId: selectedJob.expectedLatestRevisionId, caseIds: valid.map(item => item.id) }
    if (judgeMode === 'oi') body.assignments = valid.map(item => { const [subtaskId, groupKey] = (assignments[item.id] || '').split(':'); return { caseId: item.id, subtaskId: Number(subtaskId), groupKey } })
    const result = await apiClient.post(`/api/problems/${problemId}/data-generation-jobs/${selectedJob.id}/promote`, body)
    if (!result.success) return toast.error(result.message || '候选测试点发布失败')
    toast.success('已发布新的正式 TestSet Revision'); setSelectedJob(null); await load(); setTab('revisions')
  }

  return <div className={styles.panel}>
    <div className={styles.tabs}>{[
      ['programs', '评测程序'], ['import', '数据导入'], ['generate', '数据生成'], ['candidates', '生成任务'], ['pool', 'Candidate Pool'], ['corpus', 'Wrong Corpus'], ['revisions', '正式版本'],
    ].map(([value, label]) => <Button key={value} variant="ghost" aria-selected={tab === value} onClick={() => setTab(value as any)}>{label}</Button>)}</div>

    {tab === 'programs' && <div className={styles.columns}>
      <section className={styles.card}><h3>已有程序</h3>{programs.length ? programs.map(program => <div className={styles.program} key={program.id}><strong>{KIND_LABEL[program.kind]} · {program.name}</strong><span>{program.language} · 当前 v{program.versions.find(version => version.id === program.currentVersionId)?.versionNumber || '—'}</span></div>) : <p className={styles.muted}>暂无评测程序</p>}</section>
      <section className={styles.card}><h3>上传或填写程序</h3><div className={styles.formRow}><Select aria-label="程序类型" value={kind} onChange={event => { setKind(event.target.value); setLanguage(event.target.value === 'generator' ? language : 'cpp17') }}>{Object.entries(KIND_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select><Input value={name} onChange={event => setName(event.target.value)} placeholder="程序名称" /><Select aria-label="程序语言" value={language} onChange={event => setLanguage(event.target.value)}><option value="cpp17">C++17</option>{kind === 'generator' && <option value="python3">Python3</option>}</Select></div><Input type="file" accept=".cpp,.cc,.cxx,.py,.txt" onChange={event => void readFile(event.target.files?.[0])} /><Textarea rows={14} value={source} onChange={event => setSource(event.target.value)} placeholder="填写源码；保存前会在沙箱中编译" /><Button variant="primary" disabled={saving || !source.trim()} onClick={saveProgram}>{saving ? '编译中…' : '编译并保存'}</Button></section>
      <section className={styles.card}><h3>DeepSeek Validator DSL</h3><p className={styles.muted}>默认生成受限 DSL、Feature 与 Subtask Rule 建议；不会自动启用或发布数据。复杂题仍可使用 C++ fallback。</p><Select aria-label="Markdown 题面" value={statementId} onChange={event => setStatementId(event.target.value)}><option value="">选择 Markdown 题面</option>{aiUsage?.markdownStatements.map((item, index) => <option key={item.id} value={item.id}>{item.language || '未标注语言'} · 版本 {index + 1} · 最多预占 {item.maxReservedTokens} Token</option>)}</Select><div className={styles.actions}><Button variant="primary" disabled={saving || !statementId} onClick={generateValidatorDsl}>{saving ? '生成中…' : '生成 Validator DSL'}</Button><Button variant="outline" disabled={saving || !statementId} onClick={() => generateValidator()}>生成 C++ fallback</Button></div>{aiRequest && <div className={styles.aiResult}><strong>Token：{aiRequest.promptTokens || 0} + {aiRequest.completionTokens || 0} = {aiRequest.totalTokens || 0}</strong><span>编译：{aiRequest.compileStatus === 'passed' ? '通过' : '失败'}</span>{aiRequest.response?.assumptions?.length > 0 && <p>需确认：{aiRequest.response.assumptions.join('；')}</p>}<Textarea rows={12} readOnly value={aiRequest.dsl ? JSON.stringify(aiRequest.response?.spec || {}, null, 2) : (aiRequest.response?.validatorSource || '')} />{aiRequest.compileMessage && <pre>{aiRequest.compileMessage}</pre>}<div className={styles.actions}>{aiRequest.compileStatus === 'passed' && <Button variant="primary" onClick={aiRequest.dsl ? saveAiDsl : saveAi}>{aiRequest.dsl ? '保存 DSL 草稿' : '保存为 Validator'}</Button>}{!aiRequest.dsl && aiRequest.repairDepth < 2 && <Button variant="outline" onClick={() => generateValidator(aiRequest.id)}>让 AI 修复</Button>}</div></div>}</section>
    </div>}

    {tab === 'import' && <section className={styles.card}><h3>数据导入</h3><p>上传完整 `.in/.out`、`.in/.ans` 或 ZIP。OI 数据导入后在“数据与分组”中注册并分配 Official Group；仅输入文件应使用“输入数据补答案”，由 Validator 与 STD 生成候选答案。</p><Input type="file" multiple accept=".in,.out,.ans,.zip" onChange={event => setImportFiles(Array.from(event.target.files || []))} /><Checkbox label="同名文件冲突时替换" checked={replaceExisting} onChange={event => setReplaceExisting(event.target.checked)} /><Button variant="primary" disabled={saving || !importFiles.length} onClick={uploadTestdata}>{saving ? '上传中…' : `导入数据（${importFiles.length}）`}</Button></section>}
    {tab === 'generate' && <section className={styles.card}><h3>数据生成</h3><div className={styles.formRow}><Select aria-label="来源方式" value={sourceMode} onChange={event => { const mode = event.target.value as 'generator' | 'input'; setSourceMode(mode); setRows(mode === 'generator' ? 'small-1 | 1 | 10 100\nsmall-2 | 2 | 100 1000' : '[\n  {"name":"manual-1","inputData":"1 2\\n"}\n]') }}><option value="generator">参数清单生成器</option><option value="input">输入数据补答案</option></Select><Select aria-label="STD" value={standardId} onChange={event => setStandardId(event.target.value)}><option value="">选择 STD</option>{currentStandard.map(item => <option key={item.id} value={item.id}>{item.programName} v{item.versionNumber}</option>)}</Select><Select aria-label="Validator" value={validatorId} onChange={event => setValidatorId(event.target.value)}><option value="">选择 Validator</option>{currentValidator.map(item => <option key={item.id} value={item.id}>{item.programName} v{item.versionNumber}</option>)}</Select>{sourceMode === 'generator' && <Select aria-label="Generator" value={generatorId} onChange={event => setGeneratorId(event.target.value)}><option value="">选择 Generator</option>{currentGenerator.map(item => <option key={item.id} value={item.id}>{item.programName} v{item.versionNumber}</option>)}</Select>}</div><label>{sourceMode === 'generator' ? '每行：名称 | 种子 | 参数列表' : 'JSON 数组：name + inputData'}</label><Textarea rows={10} value={rows} onChange={event => setRows(event.target.value)} /><Button variant="primary" disabled={!standardId || !validatorId || (sourceMode === 'generator' && !generatorId) || !rows.trim()} onClick={createJob}>创建生成任务</Button></section>}
    {tab === 'candidates' && <div className={styles.columns}><section className={styles.card}><h3>生成任务</h3>{jobs.map(job => <Button variant="ghost" className={styles.job} key={job.id} onClick={() => openJob(job)}><strong>{job.id.slice(0, 8)}</strong><span>{job.status} · {new Date(job.createdAt).toLocaleString('zh-CN')}</span></Button>)}</section>{selectedJob && <section className={styles.card}><h3>候选测试点</h3><TableRoot><TableHead><TableRow><TableHeaderCell>名称</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell>{judgeMode === 'oi' && <TableHeaderCell>Official Group</TableHeaderCell>}</TableRow></TableHead><TableBody>{selectedJob.cases?.map(item => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.status}{item.message ? ` · ${item.message}` : ''}</TableCell>{judgeMode === 'oi' && <TableCell><Select aria-label="Official Group" value={assignments[item.id] || ''} onChange={event => setAssignments(current => ({ ...current, [item.id]: event.target.value }))}><option value="">选择分组</option>{officialGroups.map(group => <option key={group.value} value={group.value}>{group.label}</option>)}</Select></TableCell>}</TableRow>)}</TableBody></TableRoot><div className={styles.preview}>{selectedJob.cases?.filter(item => item.status === 'validated').map(item => <details key={item.id}><summary>{item.name} 输入/答案预览</summary><pre>{item.inputPreview}</pre><pre>{item.outputPreview}</pre></details>)}</div>{selectedJob.status === 'completed' && <Button variant="primary" disabled={judgeMode === 'oi' && selectedJob.cases?.some(item => item.status === 'validated' && !assignments[item.id])} onClick={promote}>发布新的正式版本</Button>}</section>}</div>}
    {tab === 'pool' && <section className={styles.card}><h3>有界 Candidate Pool</h3>{candidatePool ? <><p>活跃 {candidatePool.activeCount} 条 · HOT {(candidatePool.hotBytes / 1024 / 1024).toFixed(2)} MiB · Top-K {candidatePool.policy.topK}</p><div className={styles.actions}><Button variant={candidatePool.policy.selectorMode === 'observe' ? 'primary' : 'outline'} onClick={() => updateSelectorMode('observe')}>观察模式</Button><Button variant={candidatePool.policy.selectorMode === 'auto' ? 'primary' : 'outline'} onClick={() => updateSelectorMode('auto')}>质量阈值自动发布</Button></div><TableRoot><TableHead><TableRow><TableHeaderCell>Candidate</TableHeaderCell><TableHeaderCell>来源</TableHeaderCell><TableHeaderCell>目标</TableHeaderCell><TableHeaderCell>阶段</TableHeaderCell><TableHeaderCell>边际价值</TableHeaderCell></TableRow></TableHead><TableBody>{candidatePool.candidates.map(item => <TableRow key={item.id}><TableCell>{item.id.slice(0, 8)}</TableCell><TableCell>{item.source}</TableCell><TableCell>{item.targetRole}</TableCell><TableCell>{item.status} · {item.evaluationStage}</TableCell><TableCell>{item.marginalValue}</TableCell></TableRow>)}</TableBody></TableRoot></> : <p className={styles.muted}>正在加载 Candidate Pool…</p>}</section>}
    {tab === 'corpus' && <section className={styles.card}><h3>私有 Wrong Behavior Corpus</h3><p className={styles.muted}>历史本地错误提交只用于内部行为聚类；贡献者看不到源码、用户、提交 ID 或精确 Kill 列表。</p>{corpus?.revision ? <p>Corpus R{corpus.revision.revisionNumber} · {corpus.revision.clusterCount} 个代表簇 · Evaluation {corpus.revision.evaluationCount} · Hidden Holdout {corpus.revision.holdoutCount}</p> : <p>尚未建立 Corpus。</p>}<Button variant="primary" loading={saving} onClick={rebuildCorpus}>从历史本地错误提交重建</Button></section>}
    {tab === 'revisions' && <section className={styles.card}><h3>正式版本</h3><p>只有达到质量阈值的 Candidate 才会创建新的不可变 TestSet Revision。比赛、训练和作业继续固定原版本，不会被自动更新。</p>{jobs.filter(job => job.promotedRevisionId).map(job => <p key={job.id}><code>{job.id.slice(0, 8)}</code> → <code>{job.promotedRevisionId}</code></p>)}</section>}
  </div>
}
