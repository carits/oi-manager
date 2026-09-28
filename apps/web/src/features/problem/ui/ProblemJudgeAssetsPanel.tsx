'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiValidatorRequest, CandidateSelectorPreview, DataGenerationJob, DataGenerationJobDetail, ProblemCandidatePool, ProblemWrongCorpus } from '@oi-manager/contracts'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { useToast } from '@/components/ui/Toast'
import styles from './ProblemJudgeAssetsPanel.module.css'
import { JudgeProgramWizard } from './JudgeProgramWizard'
import { JudgeProgramTemplateGallery } from './JudgeProgramTemplateGallery'
import type { ProgramCatalog } from '../model/judgeProgramTemplateTypes'
import { ProblemQualityPanel } from './ProblemQualityPanel'
import { listJudgeProgramTemplates } from '../api/judgeProgramTemplateApi'
import { getProblemTestGraph } from '../api/problemTestGraphApi'
import { getProblemAiUsage } from '../api/problemDetailApi'
import { uploadProblemTestdata } from '../api/problemFilesApi'
import { compileJudgeProgramVersion, listJudgePrograms, preflightJudgeProgramVersion, updateJudgeProgram } from '../api/judgeProgramApi'
import { generateAiValidator, generateAiValidatorSpec, repairAiValidator, saveAiValidator, saveAiValidatorSpec } from '../api/problemAiValidatorApi'
import { createDataGenerationJob, getDataGenerationJob, listDataGenerationJobs, promoteDataGenerationJob } from '../api/problemDataGenerationApi'
import { emergencyPublishCandidate, getCandidatePool, getWrongCorpus, previewCandidateSelector, rebuildWrongCorpus, updateCandidatePolicy } from '../api/problemCandidatePoolApi'

type Version = { id: string; versionNumber: number; language: string; source: string; origin: string; compileStatus: string; lifecycleStatus: string; protocol: string; templateId?: string | null; createdAt: string }
type Program = { id: string; kind: string; name: string; language: string; currentVersionId?: string | null; versions: Version[] }
type Graph = { slot: 'STABLE' | 'EVOLVING'; graphHash: string; fencingToken: number; subtasks: Array<{ id: number; score?: number; dependencies?: number[]; groups: Array<{ key: string; name: string; kind: string }> }> }
type AiUsage = { markdownStatements: Array<{ id: string; language?: string; maxReservedTokens: number }> }
type AssetsTab = 'programs' | 'import' | 'generate' | 'candidates' | 'pool' | 'corpus' | 'quality' | 'slots'
type AiValidatorView = AiValidatorRequest & { dsl?: boolean }
type PromoteRequest = {
  expectedEvolvingFencingToken: number
  caseIds: string[]
  assignments?: Array<{ caseId: string; subtaskId: number; groupKey: string }>
}

const KIND_LABEL: Record<string, string> = { standard: 'STD', validator: 'Validator', classifier: 'Classifier', generator: 'Generator' }
const ASSETS_TABS: Array<[AssetsTab, string]> = [
  ['programs', '评测程序'], ['import', '数据导入'], ['generate', '数据生成'], ['candidates', '生成任务'],
  ['pool', 'Candidate Pool'], ['corpus', 'Wrong Corpus'], ['quality', '质量评估'], ['slots', 'Stable / Evolving'],
]

export function ProblemJudgeAssetsPanel({ problemId, judgeMode }: { problemId: string; judgeMode: 'acm' | 'oi' }) {
  const toast = useToast()
  const [tab, setTab] = useState<AssetsTab>('programs')
  const [programs, setPrograms] = useState<Program[]>([])
  const [jobs, setJobs] = useState<DataGenerationJob[]>([])
  const [selectedJob, setSelectedJob] = useState<DataGenerationJobDetail | null>(null)
  const [graph, setGraph] = useState<Graph | null>(null)
  const [saving, setSaving] = useState(false)
  const [catalog, setCatalog] = useState<ProgramCatalog | null>(null), [wizardOpen, setWizardOpen] = useState(false)
  const [wizardTemplateId, setWizardTemplateId] = useState<string | null>(null)
  const [standardId, setStandardId] = useState(''), [validatorId, setValidatorId] = useState(''), [generatorId, setGeneratorId] = useState('')
  const [sourceMode, setSourceMode] = useState<'generator' | 'input'>('generator')
  const [rows, setRows] = useState('small-1 | 1 | 10 100\nsmall-2 | 2 | 100 1000')
  const [aiRequest, setAiRequest] = useState<AiValidatorView | null>(null)
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null)
  const [statementId, setStatementId] = useState('')
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [importFiles, setImportFiles] = useState<File[]>([])
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [candidatePool, setCandidatePool] = useState<ProblemCandidatePool | null>(null)
  const [corpus, setCorpus] = useState<ProblemWrongCorpus | null>(null)
  const [selectorPreview, setSelectorPreview] = useState<CandidateSelectorPreview | null>(null)
  const [emergencyCandidate, setEmergencyCandidate] = useState<string | null>(null)
  const [emergencyReason, setEmergencyReason] = useState('')

  const load = useCallback(async () => {
    try {
      const graphRequest = judgeMode === 'oi'
        ? getProblemTestGraph(problemId)
            .then(data => ({ data: data as Graph, error: null as string | null }))
            .catch(error => ({ data: null, error: error instanceof Error ? error.message : 'Test Graph 加载失败' }))
        : Promise.resolve({ data: null, error: null as string | null })
      const templateRequest = listJudgeProgramTemplates()
        .then(data => ({ data, error: null as string | null }))
        .catch(error => ({ data: null, error: error instanceof Error ? error.message : '评测程序模板加载失败' }))
      const aiUsageRequest = getProblemAiUsage(problemId)
        .then(data => ({ data: data as AiUsage, error: null as string | null }))
        .catch(error => ({ data: null, error: error instanceof Error ? error.message : 'AI 使用信息加载失败' }))

      const programRequest = listJudgePrograms(problemId)
        .then(data => ({ data: data as Program[], error: null as string | null }))
        .catch(error => ({ data: null, error: error instanceof Error ? error.message : '评测程序加载失败' }))
      const jobRequest = listDataGenerationJobs(problemId)
        .then(data => ({ data, error: null as string | null }))
        .catch(error => ({ data: null, error: error instanceof Error ? error.message : '生成任务加载失败' }))
      const poolRequest = getCandidatePool(problemId)
        .then(data => ({ data, error: null as string | null }))
        .catch(error => ({ data: null, error: error instanceof Error ? error.message : 'Candidate Pool 加载失败' }))
      const corpusRequest = getWrongCorpus(problemId)
        .then(data => ({ data, error: null as string | null }))
        .catch(error => ({ data: null, error: error instanceof Error ? error.message : 'Wrong Corpus 加载失败' }))
      const [programResult, jobResult, graphResult, aiUsageResult, poolResult, corpusResult, templateResult] = await Promise.all([
        programRequest,
        jobRequest,
        graphRequest,
        aiUsageRequest,
        poolRequest,
        corpusRequest,
        templateRequest,
      ])

      const failures: string[] = []
      if (programResult.data) setPrograms(programResult.data)
      else failures.push(`评测程序：${programResult.error || '加载失败'}`)
      if (jobResult.data) setJobs(jobResult.data)
      else failures.push(`生成任务：${jobResult.error || '加载失败'}`)
      if (graphResult.data) setGraph(graphResult.data)
      else if (graphResult.error) failures.push(`Test Graph：${graphResult.error}`)
      if (aiUsageResult.data) {
        setAiUsage(aiUsageResult.data)
        setStatementId(current => current || aiUsageResult.data!.markdownStatements[0]?.id || '')
      } else failures.push(`AI 使用信息：${aiUsageResult.error || '加载失败'}`)
      if (poolResult.data) setCandidatePool(poolResult.data)
      else failures.push(`Candidate Pool：${poolResult.error || '加载失败'}`)
      if (corpusResult.data) setCorpus(corpusResult.data)
      else failures.push(`Wrong Corpus：${corpusResult.error || '加载失败'}`)
      if (templateResult.data) setCatalog(templateResult.data)
      else if (templateResult.error) failures.push(`评测程序模板：${templateResult.error}`)

      if (failures.length) toast.error(`部分评测配置加载失败：${failures.join('；')}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '评测配置加载失败')
    }
  }, [judgeMode, problemId, toast])
  useEffect(() => { void load() }, [load])

  const versions = (programKind: string) => programs.filter(item => item.kind === programKind).flatMap(item => item.versions.filter(version => item.currentVersionId === version.id).map(version => ({ ...version, programName: item.name })))
  const currentStandard = versions('standard'), currentValidator = versions('validator'), currentGenerator = versions('generator')
  const officialGroups = useMemo(() => graph?.subtasks.flatMap(subtask => subtask.groups.filter(group => group.kind === 'official').map(group => ({ value: `${subtask.id}:${group.key}`, label: `Subtask ${subtask.id} · ${group.name}` }))) || [], [graph])

  const transitionVersion = async (program: Program, version: Version) => {
    const action = version.lifecycleStatus === 'draft' ? 'compile' : 'preflight'
    const result = action === 'compile'
      ? await compileJudgeProgramVersion(problemId, program.id, version.id)
      : await preflightJudgeProgramVersion(problemId, program.id, version.id, {})
    if (!result.ok) return toast.error(result.error.message || `${action === 'compile' ? '编译' : '协议预检'}任务创建失败`)
    toast.success(`Judge 已开始${action === 'compile' ? '编译' : '协议预检'}`); await load()
  }
  const activate = async (program: Program, version: Version) => {
    const result = await updateJudgeProgram(problemId, program.id, { currentVersionId: version.id })
    if (!result.ok) return toast.error(result.error.message || '激活失败')
    toast.success('评测程序版本已激活'); await load()
  }
  const generateValidator = async (parentRequestId?: string) => {
    setSaving(true)
    try {
      const result = parentRequestId
        ? await repairAiValidator(problemId, parentRequestId)
        : await generateAiValidator(problemId, { statementId })
      if (!result.ok) return toast.error(result.error.message || 'DeepSeek Validator 生成失败')
      setAiRequest(result.data); toast.success(`DeepSeek 已使用 ${result.data.totalTokens ?? '实际'} Token`)
    } finally { setSaving(false) }
  }
  const saveAi = async () => {
    if (!aiRequest) return
    const result = await saveAiValidator(problemId, aiRequest.id, { name: 'AI Validator' })
    if (!result.ok) return toast.error(result.error.message || 'AI Validator 保存失败')
    toast.success('AI Validator 已保存为新的程序版本'); await load()
  }
  const generateValidatorDsl = async () => {
    setSaving(true)
    try {
      const result = await generateAiValidatorSpec(problemId, { statementId })
      if (!result.ok) return toast.error(result.error.message || 'DeepSeek Validator DSL 生成失败')
      setAiRequest({ ...result.data, dsl: true }); toast.success(`DeepSeek 已使用 ${result.data.totalTokens ?? '实际'} Token`)
    } finally { setSaving(false) }
  }
  const saveAiDsl = async () => {
    if (!aiRequest) return
    const result = await saveAiValidatorSpec(problemId, aiRequest.id)
    if (!result.ok) return toast.error(result.error.message || 'Validator DSL 保存失败')
    toast.success('Validator DSL 已保存；激活前仍可审阅规则与测试样例'); await load()
  }
  const updateSelectorMode = async (selectorMode: 'observe' | 'auto') => {
    if (!candidatePool) return
    const result = await updateCandidatePolicy(problemId, { expectedRevision: candidatePool.policy.revision, selectorMode, maxHotCandidates: candidatePool.policy.maxHotCandidates, topK: candidatePool.policy.topK })
    if (!result.ok) return toast.error(result.error.message || '策略更新失败')
    toast.success(selectorMode === 'auto' ? '已启用质量阈值自动发布' : '已切换为观察模式'); await load()
  }
  const rebuildCorpus = async () => {
    setSaving(true)
    try {
      const result = await rebuildWrongCorpus(problemId)
      if (!result.ok) return toast.error(result.error.message || 'Corpus 重建失败')
      toast.success(`Corpus R${result.data.revisionNumber} 已重建（${result.data.clusters} 个行为簇）`); await load()
    } finally { setSaving(false) }
  }
  const previewSelector = async () => {
    setSaving(true)
    try {
      const result = await previewCandidateSelector(problemId)
      if (!result.ok) return toast.error(result.error.message || 'Selector 预览失败')
      setSelectorPreview(result.data)
    } finally { setSaving(false) }
  }
  const emergencyPublish = async () => {
    if (!emergencyCandidate) return
    setSaving(true)
    try {
      const result = await emergencyPublishCandidate(problemId, { candidateId: emergencyCandidate, reason: emergencyReason })
      if (!result.ok) return toast.error(result.error.message || '紧急发布失败')
      toast.success('已通过结构、保护和栅栏校验，Evolving 更新已排队')
      setEmergencyCandidate(null); setEmergencyReason(''); setSelectorPreview(null); await load()
    } finally { setSaving(false) }
  }

  const createJob = async () => {
    let cases: Array<{ name: string; seed?: string; args: string[]; inputData?: string }>
    try {
      cases = sourceMode === 'input'
        ? (JSON.parse(rows) as Array<{ name?: string; inputData: string }>).map((item, index) => ({ name: item.name || `case-${index + 1}`, args: [], inputData: item.inputData }))
        : rows.split('\n').map(row => row.trim()).filter(Boolean).map((row, index) => { const [caseName, seed, args] = row.split('|').map(item => item.trim()); return { name: caseName || `case-${index + 1}`, seed, args: args ? args.split(/\s+/) : [] } })
    } catch { return toast.error('输入数据必须是合法 JSON 数组') }
    const result = await createDataGenerationJob(problemId, { sourceMode, generatorVersionId: sourceMode === 'generator' ? generatorId : undefined, standardVersionId: standardId, validatorVersionId: validatorId, cases })
    if (!result.ok) return toast.error(result.error.message || '生成任务创建失败')
    toast.success('已加入数据生成队列'); await load(); setTab('candidates')
  }
  const uploadTestdata = async () => {
    if (!importFiles.length) return
    setSaving(true)
    try {
      const result = await uploadProblemTestdata(problemId, importFiles, replaceExisting)
      if (!result.success) return toast.error(result.message || '测试数据上传失败')
      toast.success(`已导入 ${importFiles.length} 个文件`)
      setImportFiles([])
    } finally { setSaving(false) }
  }
  const openJob = async (job: DataGenerationJob) => {
    try { setSelectedJob(await getDataGenerationJob(problemId, job.id)) }
    catch (error) { toast.error(error instanceof Error ? error.message : '生成任务详情加载失败') }
  }
  useEffect(() => {
    if (!selectedJob || !['queued', 'running', 'finalizing'].includes(selectedJob.status)) return
    const timer = window.setInterval(() => { void openJob(selectedJob) }, 2000)
    return () => window.clearInterval(timer)
  }, [selectedJob])
  const promote = async () => {
    if (!selectedJob) return
    const valid = selectedJob.cases?.filter(item => item.status === 'validated') || []
    if (selectedJob.expectedEvolvingFencingToken == null) return toast.error('生成任务缺少 Evolving 栅栏快照，请重新创建任务')
    const body: PromoteRequest = { expectedEvolvingFencingToken: selectedJob.expectedEvolvingFencingToken, caseIds: valid.map(item => item.id) }
    if (judgeMode === 'oi') body.assignments = valid.map(item => { const [subtaskId, groupKey] = (assignments[item.id] || '').split(':'); return { caseId: item.id, subtaskId: Number(subtaskId), groupKey } })
    const result = await promoteDataGenerationJob(problemId, selectedJob.id, body)
    if (!result.ok) return toast.error(result.error.message || '候选测试点发布失败')
    toast.success(result.data.status === 'SUCCEEDED' ? 'Evolving 已原子更新' : 'Evolving 更新已进入写队列'); setSelectedJob(null); await load(); setTab('slots')
  }

  return <div className={styles.panel}>
    <div className={styles.tabs}>{ASSETS_TABS.map(([value, label]) => <Button key={value} variant="ghost" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</Button>)}</div>

    {tab === 'programs' && <>
      <JudgeProgramTemplateGallery catalog={catalog} subtasks={graph?.subtasks || []} onUse={templateId => { setWizardTemplateId(templateId); setWizardOpen(true) }} />
      <div className={styles.columns}>
      <section className={styles.card}><div className={styles.program}><div><h3>评测基础设施</h3><p className={styles.muted}>STD 生成答案，Validator 检查输入，Classifier 负责 OI 子任务分类；Generator 只生成输入。编译通过后仍需协议预检和人工激活。</p></div><Button variant="primary" onClick={() => { setWizardTemplateId(null); setWizardOpen(true) }}>新增评测程序</Button></div>{programs.length ? programs.map(program => <div className={styles.programBlock} key={program.id}><div className={styles.program}><strong>{catalog?.capabilities[program.kind as keyof ProgramCatalog['capabilities']]?.title || `${KIND_LABEL[program.kind]} · ${program.name}`}</strong><span>{program.currentVersionId ? `已激活 v${program.versions.find(version => version.id === program.currentVersionId)?.versionNumber}` : '尚未激活'}</span></div>{program.versions.map(version => <div className={styles.version} key={version.id}><span>v{version.versionNumber} · {version.language} · {version.protocol} · {version.lifecycleStatus}</span><div className={styles.actions}>{['draft', 'compiled'].includes(version.lifecycleStatus) && <Button variant="outline" onClick={() => transitionVersion(program, version)}>{version.lifecycleStatus === 'draft' ? '编译' : '运行协议预检'}</Button>}{version.lifecycleStatus === 'verified' && <Button variant="primary" onClick={() => activate(program, version)}>激活</Button>}</div></div>)}</div>) : <p className={styles.muted}>暂无评测程序</p>}</section>
      <section className={styles.card}><h3>DeepSeek Validator DSL</h3><p className={styles.muted}>默认生成受限 DSL、Feature 与 Subtask Rule 建议；不会自动启用或发布数据。复杂题仍可使用 C++ fallback。</p><Select aria-label="Markdown 题面" value={statementId} onChange={event => setStatementId(event.target.value)}><option value="">选择 Markdown 题面</option>{aiUsage?.markdownStatements.map((item, index) => <option key={item.id} value={item.id}>{item.language || '未标注语言'} · 版本 {index + 1} · 最多预占 {item.maxReservedTokens} Token</option>)}</Select><div className={styles.actions}><Button variant="primary" disabled={saving || !statementId} onClick={generateValidatorDsl}>{saving ? '生成中…' : '生成 Validator DSL'}</Button><Button variant="outline" disabled={saving || !statementId} onClick={() => generateValidator()}>生成 C++ fallback</Button></div>{aiRequest && <div className={styles.aiResult}><strong>Token：{aiRequest.promptTokens || 0} + {aiRequest.completionTokens || 0} = {aiRequest.totalTokens || 0}</strong><span>编译：{aiRequest.compileStatus === 'passed' ? '通过' : '失败'}</span>{(aiRequest.response?.assumptions?.length ?? 0) > 0 && <p>需确认：{aiRequest.response?.assumptions?.join('；')}</p>}<Textarea rows={12} readOnly value={aiRequest.dsl ? JSON.stringify(aiRequest.response?.spec || {}, null, 2) : (aiRequest.response?.validatorSource || '')} />{aiRequest.compileMessage && <pre>{aiRequest.compileMessage}</pre>}<div className={styles.actions}>{aiRequest.compileStatus === 'passed' && <Button variant="primary" onClick={aiRequest.dsl ? saveAiDsl : saveAi}>{aiRequest.dsl ? '保存 DSL 草稿' : '保存为 Validator'}</Button>}{!aiRequest.dsl && (aiRequest.repairDepth ?? 0) < 2 && <Button variant="outline" onClick={() => generateValidator(aiRequest.id)}>让 AI 修复</Button>}</div></div>}</section>
      <JudgeProgramWizard open={wizardOpen} onClose={() => { setWizardOpen(false); setWizardTemplateId(null) }} initialTemplateId={wizardTemplateId} problemId={problemId} judgeMode={judgeMode} catalog={catalog} subtasks={(graph?.subtasks || []).map(item => ({ id: item.id, score: item.score, dependencies: item.dependencies }))} onChanged={load} />
    </div></>}

    {tab === 'import' && <section className={styles.card}><h3>数据导入</h3><p>上传完整 `.in/.out`、`.in/.ans` 或 ZIP。OI 数据导入后在“数据与分组”中注册并分配 Official Group；仅输入文件应使用“输入数据补答案”，由 Validator 与 STD 生成候选答案。</p><Input type="file" multiple accept=".in,.out,.ans,.zip" onChange={event => setImportFiles(Array.from(event.target.files || []))} /><Checkbox label="同名文件冲突时替换" checked={replaceExisting} onChange={event => setReplaceExisting(event.target.checked)} /><Button variant="primary" disabled={saving || !importFiles.length} onClick={uploadTestdata}>{saving ? '上传中…' : `导入数据（${importFiles.length}）`}</Button></section>}
    {tab === 'generate' && <section className={styles.card}><h3>数据生成</h3><div className={styles.formRow}><Select aria-label="来源方式" value={sourceMode} onChange={event => { const mode = event.target.value as 'generator' | 'input'; setSourceMode(mode); setRows(mode === 'generator' ? 'small-1 | 1 | 10 100\nsmall-2 | 2 | 100 1000' : '[\n  {"name":"manual-1","inputData":"1 2\\n"}\n]') }}><option value="generator">参数清单生成器</option><option value="input">输入数据补答案</option></Select><Select aria-label="STD" value={standardId} onChange={event => setStandardId(event.target.value)}><option value="">选择 STD</option>{currentStandard.map(item => <option key={item.id} value={item.id}>{item.programName} v{item.versionNumber}</option>)}</Select><Select aria-label="Validator" value={validatorId} onChange={event => setValidatorId(event.target.value)}><option value="">选择 Validator</option>{currentValidator.map(item => <option key={item.id} value={item.id}>{item.programName} v{item.versionNumber}</option>)}</Select>{sourceMode === 'generator' && <Select aria-label="Generator" value={generatorId} onChange={event => setGeneratorId(event.target.value)}><option value="">选择 Generator</option>{currentGenerator.map(item => <option key={item.id} value={item.id}>{item.programName} v{item.versionNumber}</option>)}</Select>}</div><label>{sourceMode === 'generator' ? '每行：名称 | 种子 | 参数列表' : 'JSON 数组：name + inputData'}</label><Textarea rows={10} value={rows} onChange={event => setRows(event.target.value)} /><Button variant="primary" disabled={!standardId || !validatorId || (sourceMode === 'generator' && !generatorId) || !rows.trim()} onClick={createJob}>创建生成任务</Button></section>}
    {tab === 'candidates' && <div className={styles.columns}><section className={styles.card}><h3>生成任务</h3>{jobs.map(job => <Button variant="ghost" className={styles.job} key={job.id} onClick={() => openJob(job)}><strong>{job.id.slice(0, 8)}</strong><span>{job.status} · {new Date(job.createdAt).toLocaleString('zh-CN')}</span></Button>)}</section>{selectedJob && <section className={styles.card}><h3>候选测试点</h3><TableRoot><TableHead><TableRow><TableHeaderCell>名称</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell>{judgeMode === 'oi' && <TableHeaderCell>Official Group</TableHeaderCell>}</TableRow></TableHead><TableBody>{selectedJob.cases?.map(item => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.status}{item.message ? ` · ${item.message}` : ''}</TableCell>{judgeMode === 'oi' && <TableCell><Select aria-label="Official Group" value={assignments[item.id] || ''} onChange={event => setAssignments(current => ({ ...current, [item.id]: event.target.value }))}><option value="">选择分组</option>{officialGroups.map(group => <option key={group.value} value={group.value}>{group.label}</option>)}</Select></TableCell>}</TableRow>)}</TableBody></TableRoot><div className={styles.preview}>{selectedJob.cases?.filter(item => item.status === 'validated').map(item => <details key={item.id}><summary>{item.name} 输入/答案预览</summary><pre>{item.inputPreview}</pre><pre>{item.outputPreview}</pre></details>)}</div>{selectedJob.status === 'completed' && <Button variant="primary" disabled={judgeMode === 'oi' && selectedJob.cases?.some(item => item.status === 'validated' && !assignments[item.id])} onClick={promote}>写入 Evolving</Button>}</section>}</div>}
    {tab === 'pool' && <section className={styles.card}>
      <h3>有界 Candidate Pool</h3>
      {candidatePool ? <>
        <p>活跃 {candidatePool.activeCount} 条 · HOT {(candidatePool.hotBytes / 1024 / 1024).toFixed(2)} MiB · Top-K {candidatePool.policy.topK}</p>
        {candidatePool.subtasks.length > 0 && <TableRoot><TableHead><TableRow><TableHeaderCell>Subtask</TableHeaderCell><TableHeaderCell>正式点</TableHeaderCell><TableHeaderCell>错误程序</TableHeaderCell><TableHeaderCell>行为簇</TableHeaderCell><TableHeaderCell>模式</TableHeaderCell></TableRow></TableHead><TableBody>{candidatePool.subtasks.map(item => <TableRow key={item.subtaskId}><TableCell>S{item.subtaskId}</TableCell><TableCell>{item.caseCount}/{item.caseLimit}</TableCell><TableCell>{item.wrongProgramCount}</TableCell><TableCell>{item.wrongClusterCount}</TableCell><TableCell>{item.contributionMode.toUpperCase()}{item.autoSelection ? ' · 可自动选择' : item.bootstrapAvailable ? ' · Bootstrap' : ' · 仅观察'}</TableCell></TableRow>)}</TableBody></TableRoot>}
        <div className={styles.actions}>
          <Button variant={candidatePool.policy.selectorMode === 'observe' ? 'primary' : 'outline'} onClick={() => updateSelectorMode('observe')}>观察模式</Button>
          <Button variant={candidatePool.policy.selectorMode === 'auto' ? 'primary' : 'outline'} disabled={candidatePool.subtasks.length > 0 && !candidatePool.subtasks.some(item => item.autoSelection)} onClick={() => updateSelectorMode('auto')}>质量阈值自动发布</Button>
          <Button variant="outline" loading={saving} onClick={previewSelector}>按当前 Evolving 预览</Button>
        </div>
        {selectorPreview && <div className={styles.protocolCard}><strong>{selectorPreview.publishable ? '存在可入选 Candidate' : '当前没有 Candidate 达到自动选择条件'}</strong><span>{selectorPreview.note}</span>{selectorPreview.candidates.map(item => <details key={item.id}><summary>{item.id.slice(0, 8)} · {item.reason}</summary>{item.decisions?.map(decision => <p key={decision.subtaskId}>S{decision.subtaskId}：{decision.selected ? '入选' : '不入选'} · 增益 {decision.qualityGain.toFixed(1)} / 门槛 {decision.requiredGain.toFixed(1)} · {decision.reason}{decision.retiredTestcaseId ? ` · 替换 ${decision.retiredTestcaseId.slice(0, 8)}` : ''}</p>)}</details>)}</div>}
        <TableRoot><TableHead><TableRow><TableHeaderCell>Candidate</TableHeaderCell><TableHeaderCell>来源</TableHeaderCell><TableHeaderCell>目标</TableHeaderCell><TableHeaderCell>阶段</TableHeaderCell><TableHeaderCell>边际价值</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell></TableRow></TableHead><TableBody>{candidatePool.candidates.map(item => <TableRow key={item.id}><TableCell>{item.id.slice(0, 8)}</TableCell><TableCell>{item.source}</TableCell><TableCell>{item.targetRole}</TableCell><TableCell>{item.status} · {item.evaluationStage}</TableCell><TableCell>{item.marginalValue}</TableCell><TableCell>{item.targetRole === 'hack_gate' && ['ELIGIBLE', 'ELIGIBLE_NOT_SELECTED', 'WAITING_REPLACEMENT'].includes(item.status) ? <Button variant="outline" onClick={() => { setEmergencyCandidate(item.id); setEmergencyReason('') }}>紧急发布</Button> : '—'}</TableCell></TableRow>)}</TableBody></TableRoot>
        {candidatePool.retirements.length > 0 && <details><summary>历史成员替换审计（{candidatePool.retirements.length}）</summary><TableRoot><TableHead><TableRow><TableHeaderCell>Subtask</TableHeaderCell><TableHeaderCell>退出测试点</TableHeaderCell><TableHeaderCell>替换测试点</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell></TableRow></TableHead><TableBody>{candidatePool.retirements.map(item => <TableRow key={item.id}><TableCell>S{item.subtaskId}</TableCell><TableCell>{item.testcaseId.slice(0, 8)}</TableCell><TableCell>{item.replacementTestcaseId?.slice(0, 8) || '—'}</TableCell><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell></TableRow>)}</TableBody></TableRoot></details>}
      </> : <p className={styles.muted}>正在加载 Candidate Pool…</p>}
      <FormDialog isOpen={Boolean(emergencyCandidate)} onClose={() => { setEmergencyCandidate(null); setEmergencyReason('') }} onSubmit={emergencyPublish} title="紧急发布 Candidate" description="仅跳过 Corpus/质量门槛；不会绕过 15 个 Subtask、每 Subtask 10 点、保护期、Official Core 或数据槽栅栏。" submitText="确认紧急发布" danger loading={saving} dirty={Boolean(emergencyReason)}><label>审计原因（10～1000 字）<Textarea rows={5} value={emergencyReason} onChange={event => setEmergencyReason(event.target.value)} /></label></FormDialog>
    </section>}
    {tab === 'corpus' && <section className={styles.card}><h3>私有 Wrong Behavior Corpus</h3><p className={styles.muted}>历史本地错误提交只用于内部行为聚类；贡献者看不到源码、用户、提交 ID 或精确 Kill 列表。</p>{corpus?.revision ? <p>Corpus R{corpus.revision.revisionNumber} · {corpus.revision.clusterCount} 个代表簇 · Evaluation {corpus.revision.evaluationCount} · Hidden Holdout {corpus.revision.holdoutCount}</p> : <p>尚未建立 Corpus。</p>}<Button variant="primary" loading={saving} onClick={rebuildCorpus}>从历史本地错误提交重建</Button></section>}
    {tab === 'quality' && <ProblemQualityPanel problemId={problemId} />}
    {tab === 'slots' && <section className={styles.card}><h3>Stable / Evolving 当前数据</h3><p>Candidate、Hack 和生成任务只串行更新 Evolving。质量验证后的 Promotion 在低流量窗口原子更新 Stable；系统不保存历史版本，也不产生第三套业务数据。</p>{jobs.filter(job => job.promotedGraphHash).map(job => <p key={job.id}><code>{job.id.slice(0, 8)}</code> → Evolving <code>{job.promotedGraphHash}</code></p>)}</section>}
  </div>
}
