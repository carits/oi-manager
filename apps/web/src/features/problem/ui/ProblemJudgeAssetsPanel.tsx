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
import { judgeProgramKindLabel, judgeProgramLanguageLabel } from '../model/judge-program-display'
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

const ASSETS_TABS: Array<[AssetsTab, string]> = [
  ['programs', '评测程序'], ['import', '数据导入'], ['generate', '数据生成'], ['candidates', '生成任务'],
  ['pool', '候选测试数据'], ['corpus', '历史错误行为'], ['quality', '质量评估'], ['slots', '评测数据'],
]

const JOB_STATUS_LABELS: Record<string, string> = { queued: '排队中', running: '处理中', finalizing: '正在完成', completed: '已完成', failed: '失败', cancelled: '已取消' }
const CASE_STATUS_LABELS: Record<string, string> = { queued: '排队中', running: '处理中', generated: '已生成', validated: '检查通过', failed: '失败', rejected: '未通过' }
const PROGRAM_STATUS_LABELS: Record<string, string> = { draft: '草稿', compiled: '已编译', verified: '检查通过', active: '已启用', retired: '已停用', failed: '失败' }
const SOURCE_LABELS: Record<string, string> = { generator: '自动生成', direct_data: '直接补充', hack: '补充数据', upload: '上传数据' }
const TARGET_LABELS: Record<string, string> = { official: '正式评测数据', hack_gate: '质量保护数据' }
const CONTRIBUTION_MODE_LABELS: Record<string, string> = { closed: '暂不接收', limited: '观察中', open: '可自动评估' }

function displayLabel(labels: Record<string, string>, value: string | null | undefined, fallback = '状态待确认') {
  if (!value) return fallback
  const label = labels[value]
  return label === undefined ? fallback : label
}

function AiRuleSummary({ value }: { value: unknown }) {
  const spec = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  if (!spec) return <p className={styles.muted}>暂时没有可展示的规则内容。</p>

  const inputs = Array.isArray(spec.input) ? spec.input : []
  const assertions = Array.isArray(spec.assertions) ? spec.assertions : []
  const strictEnd = spec.strictEof === true

  return <dl className={styles.protocolCard}>
    <div><dt>输入项</dt><dd>{inputs.length} 项</dd></div>
    <div><dt>附加约束</dt><dd>{assertions.length} 条</dd></div>
    <div><dt>多余内容</dt><dd>{strictEnd ? '不允许' : '按题目规则处理'}</dd></div>
  </dl>
}

function candidateStatusLabel(value: string) {
  if (['UPLOADED', 'ADMITTED', 'VALIDATING'].includes(value)) return '检查中'
  if (value === 'ELIGIBLE') return '等待采用'
  if (value === 'SELECTED' || value.startsWith('EVALUATING_')) return '质量评估中'
  if (value === 'WAITING_REPLACEMENT') return '等待替换窗口'
  if (value === 'ELIGIBLE_NOT_SELECTED') return '本次未采用'
  if (value === 'PROMOTED') return '已采用'
  if (value === 'REDUNDANT') return '与现有数据重复'
  if (value === 'REJECTED') return '未通过'
  if (value === 'FAILED') return '处理失败'
  if (value === 'STALE') return '需要重新检查'
  if (value === 'EXPIRED') return '已过期'
  return '状态待确认'
}

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
            .catch(() => ({ data: null, error: '数据与分组加载失败' }))
        : Promise.resolve({ data: null, error: null as string | null })
      const templateRequest = listJudgeProgramTemplates()
        .then(data => ({ data, error: null as string | null }))
        .catch(() => ({ data: null, error: '评测程序模板加载失败' }))
      const aiUsageRequest = getProblemAiUsage(problemId)
        .then(data => ({ data: data as AiUsage, error: null as string | null }))
        .catch(() => ({ data: null, error: 'AI 使用信息加载失败' }))

      const programRequest = listJudgePrograms(problemId)
        .then(data => ({ data: data as Program[], error: null as string | null }))
        .catch(() => ({ data: null, error: '评测程序加载失败' }))
      const jobRequest = listDataGenerationJobs(problemId)
        .then(data => ({ data, error: null as string | null }))
        .catch(() => ({ data: null, error: '生成任务加载失败' }))
      const poolRequest = getCandidatePool(problemId)
        .then(data => ({ data, error: null as string | null }))
        .catch(() => ({ data: null, error: '候选测试数据加载失败' }))
      const corpusRequest = getWrongCorpus(problemId)
        .then(data => ({ data, error: null as string | null }))
        .catch(() => ({ data: null, error: '历史错误行为加载失败' }))
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
      else failures.push('评测程序加载失败')
      if (jobResult.data) setJobs(jobResult.data)
      else failures.push('生成任务加载失败')
      if (graphResult.data) setGraph(graphResult.data)
      else if (graphResult.error) failures.push('数据与分组加载失败')
      if (aiUsageResult.data) {
        setAiUsage(aiUsageResult.data)
        setStatementId(current => current || aiUsageResult.data!.markdownStatements[0]?.id || '')
      } else failures.push('AI 使用信息加载失败')
      if (poolResult.data) setCandidatePool(poolResult.data)
      else failures.push('候选测试数据加载失败')
      if (corpusResult.data) setCorpus(corpusResult.data)
      else failures.push('历史错误行为加载失败')
      if (templateResult.data) setCatalog(templateResult.data)
      else if (templateResult.error) failures.push('评测程序模板加载失败')

      if (failures.length) toast.error(`部分评测配置加载失败：${failures.join('；')}`)
    } catch (error) {
      console.error(error)
      toast.error('评测配置加载失败，请重试。')
    }
  }, [judgeMode, problemId, toast])
  useEffect(() => { void load() }, [load])

  const versions = (programKind: string) => programs.filter(item => item.kind === programKind).flatMap(item => item.versions.filter(version => item.currentVersionId === version.id).map(version => ({ ...version, programName: item.name })))
  const currentStandard = versions('standard'), currentValidator = versions('validator'), currentGenerator = versions('generator')
  const officialGroups = useMemo(() => graph?.subtasks.flatMap(subtask => subtask.groups.filter(group => group.kind === 'official').map(group => ({ value: `${subtask.id}:${group.key}`, label: `子任务 ${subtask.id} · ${group.name}` }))) || [], [graph])

  const transitionVersion = async (program: Program, version: Version) => {
    const action = version.lifecycleStatus === 'draft' ? 'compile' : 'preflight'
    const result = action === 'compile'
      ? await compileJudgeProgramVersion(problemId, program.id, version.id)
      : await preflightJudgeProgramVersion(problemId, program.id, version.id, {})
    if (!result.ok) return toast.error(result.error.userMessage || `${action === 'compile' ? '编译' : '协议预检'}任务创建失败`)
    toast.success(action === 'compile' ? '评测程序已开始编译' : '评测程序检查已开始'); await load()
  }
  const activate = async (program: Program, version: Version) => {
    const result = await updateJudgeProgram(problemId, program.id, { currentVersionId: version.id })
    if (!result.ok) return toast.error(result.error.userMessage || '激活失败')
    toast.success('评测程序版本已激活'); await load()
  }
  const generateValidator = async (parentRequestId?: string) => {
    setSaving(true)
    try {
      const result = parentRequestId
        ? await repairAiValidator(problemId, parentRequestId)
        : await generateAiValidator(problemId, { statementId })
      if (!result.ok) return toast.error(result.error.userMessage || 'DeepSeek 输入检查程序生成失败')
      setAiRequest(result.data); toast.success(`DeepSeek 已使用 ${result.data.totalTokens ?? '实际'} Token`)
    } finally { setSaving(false) }
  }
  const saveAi = async () => {
    if (!aiRequest) return
    const result = await saveAiValidator(problemId, aiRequest.id, { name: 'AI 输入检查程序' })
    if (!result.ok) return toast.error(result.error.userMessage || 'AI 输入检查程序保存失败')
    toast.success('AI 输入检查程序已保存为新的程序版本'); await load()
  }
  const generateValidatorDsl = async () => {
    setSaving(true)
    try {
      const result = await generateAiValidatorSpec(problemId, { statementId })
      if (!result.ok) return toast.error(result.error.userMessage || 'DeepSeek 输入检查规则 生成失败')
      setAiRequest({ ...result.data, dsl: true }); toast.success(`DeepSeek 已使用 ${result.data.totalTokens ?? '实际'} Token`)
    } finally { setSaving(false) }
  }
  const saveAiDsl = async () => {
    if (!aiRequest) return
    const result = await saveAiValidatorSpec(problemId, aiRequest.id)
    if (!result.ok) return toast.error(result.error.userMessage || '输入检查规则保存失败')
    toast.success('输入检查规则已保存；启用前仍可审阅规则与测试样例'); await load()
  }
  const updateSelectorMode = async (selectorMode: 'observe' | 'auto') => {
    if (!candidatePool) return
    const result = await updateCandidatePolicy(problemId, { expectedRevision: candidatePool.policy.revision, selectorMode, maxHotCandidates: candidatePool.policy.maxHotCandidates, topK: candidatePool.policy.topK })
    if (!result.ok) return toast.error(result.error.userMessage || '策略更新失败')
    toast.success(selectorMode === 'auto' ? '已启用质量阈值自动发布' : '已切换为观察模式'); await load()
  }
  const rebuildCorpus = async () => {
    setSaving(true)
    try {
      const result = await rebuildWrongCorpus(problemId)
      if (!result.ok) return toast.error(result.error.userMessage || '历史错误行为重建失败')
      toast.success(`历史错误行为已重建（${result.data.clusters} 个行为簇）`); await load()
    } finally { setSaving(false) }
  }
  const previewSelector = async () => {
    setSaving(true)
    try {
      const result = await previewCandidateSelector(problemId)
      if (!result.ok) return toast.error(result.error.userMessage || '自动质量检查预览失败')
      setSelectorPreview(result.data)
    } finally { setSaving(false) }
  }
  const emergencyPublish = async () => {
    if (!emergencyCandidate) return
    setSaving(true)
    try {
      const result = await emergencyPublishCandidate(problemId, { candidateId: emergencyCandidate, reason: emergencyReason })
      if (!result.ok) return toast.error(result.error.userMessage || '紧急发布失败')
      toast.success('已通过安全检查，评测数据更新已排队')
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
    if (!result.ok) return toast.error(result.error.userMessage || '生成任务创建失败')
    toast.success('已加入数据生成队列'); await load(); setTab('candidates')
  }
  const uploadTestdata = async () => {
    if (!importFiles.length) return
    setSaving(true)
    try {
      const result = await uploadProblemTestdata(problemId, importFiles, replaceExisting)
      if (!result.success) return console.error('Test data upload response:', result); toast.error('测试数据上传失败')
      toast.success(`已导入 ${importFiles.length} 个文件`)
      setImportFiles([])
    } finally { setSaving(false) }
  }
  const openJob = async (job: DataGenerationJob) => {
    try { setSelectedJob(await getDataGenerationJob(problemId, job.id)) }
    catch (error) { console.error(error); toast.error('生成任务详情加载失败，请重试。') }
  }
  useEffect(() => {
    if (!selectedJob || !['queued', 'running', 'finalizing'].includes(selectedJob.status)) return
    const timer = window.setInterval(() => { void openJob(selectedJob) }, 2000)
    return () => window.clearInterval(timer)
  }, [selectedJob])
  const promote = async () => {
    if (!selectedJob) return
    const valid = selectedJob.cases?.filter(item => item.status === 'validated') || []
    if (selectedJob.expectedEvolvingFencingToken == null) return toast.error('评测数据已经变化，请重新创建生成任务。')
    const body: PromoteRequest = { expectedEvolvingFencingToken: selectedJob.expectedEvolvingFencingToken, caseIds: valid.map(item => item.id) }
    if (judgeMode === 'oi') body.assignments = valid.map(item => { const [subtaskId, groupKey] = (assignments[item.id] || '').split(':'); return { caseId: item.id, subtaskId: Number(subtaskId), groupKey } })
    const result = await promoteDataGenerationJob(problemId, selectedJob.id, body)
    if (!result.ok) return toast.error(result.error.userMessage || '候选测试点发布失败')
    toast.success(result.data.status === 'SUCCEEDED' ? '评测数据已更新' : '评测数据更新已排队'); setSelectedJob(null); await load(); setTab('slots')
  }

  return <div className={styles.panel}>
    <div className={styles.tabs}>{ASSETS_TABS.map(([value, label]) => <Button key={value} variant="ghost" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</Button>)}</div>

    {tab === 'programs' && <>
      <JudgeProgramTemplateGallery catalog={catalog} subtasks={graph?.subtasks || []} onUse={templateId => { setWizardTemplateId(templateId); setWizardOpen(true) }} />
      <div className={styles.columns}>
      <section className={styles.card}><div className={styles.program}><div><h3>评测基础设施</h3><p className={styles.muted}>标准答案程序生成答案，输入检查程序验证输入，子任务判定程序负责 OI 分组，数据生成程序只生成输入。编译通过后仍需完成运行规则检查并人工启用。</p></div><Button variant="primary" onClick={() => { setWizardTemplateId(null); setWizardOpen(true) }}>新增评测程序</Button></div>{programs.length ? programs.map(program => <div className={styles.programBlock} key={program.id}><div className={styles.program}><strong>{catalog?.capabilities[program.kind as keyof ProgramCatalog['capabilities']]?.title || `${judgeProgramKindLabel(program.kind)} · ${program.name}`}</strong><span>{program.currentVersionId ? '已启用' : '尚未启用'}</span></div>{program.versions.map(version => <div className={styles.version} key={version.id}><span>版本 {version.versionNumber} · {judgeProgramLanguageLabel(version.language)} · {displayLabel(PROGRAM_STATUS_LABELS, version.lifecycleStatus)}</span><div className={styles.actions}>{['draft', 'compiled'].includes(version.lifecycleStatus) && <Button variant="outline" onClick={() => transitionVersion(program, version)}>{version.lifecycleStatus === 'draft' ? '编译' : '运行规则检查'}</Button>}{version.lifecycleStatus === 'verified' && <Button variant="primary" onClick={() => activate(program, version)}>激活</Button>}</div></div>)}</div>) : <p className={styles.muted}>暂无评测程序</p>}</section>
      <section className={styles.card}><h3>DeepSeek 输入检查规则</h3><p className={styles.muted}>根据题面生成输入检查规则建议；不会自动启用或发布数据，保存前可以完整审阅。</p><Select aria-label="Markdown 题面" value={statementId} onChange={event => setStatementId(event.target.value)}><option value="">选择 Markdown 题面</option>{aiUsage?.markdownStatements.map((item, index) => <option key={item.id} value={item.id}>{item.language || '未标注语言'} · 版本 {index + 1} · 最多预占 {item.maxReservedTokens} Token</option>)}</Select><div className={styles.actions}><Button variant="primary" disabled={saving || !statementId} onClick={generateValidatorDsl}>{saving ? '生成中…' : '生成输入检查规则'}</Button><Button variant="outline" disabled={saving || !statementId} onClick={() => generateValidator()}>生成 C++ 备用程序</Button></div>{aiRequest && <div className={styles.aiResult}><strong>Token：{aiRequest.promptTokens || 0} + {aiRequest.completionTokens || 0} = {aiRequest.totalTokens || 0}</strong><span>程序检查：{aiRequest.compileStatus === 'passed' ? '通过' : '失败'}</span>{(aiRequest.response?.assumptions?.length ?? 0) > 0 && <p>需确认：{aiRequest.response?.assumptions?.join('；')}</p>}{aiRequest.dsl
          ? <AiRuleSummary value={aiRequest.response?.spec} />
          : <details><summary>查看生成程序</summary><Textarea rows={12} readOnly value={aiRequest.response?.validatorSource || ''} /></details>}{aiRequest.compileMessage && <details><summary>诊断信息</summary><pre>{aiRequest.compileMessage}</pre></details>}<div className={styles.actions}>{aiRequest.compileStatus === 'passed' && <Button variant="primary" onClick={aiRequest.dsl ? saveAiDsl : saveAi}>{aiRequest.dsl ? '保存规则草稿' : '保存为输入检查程序'}</Button>}{!aiRequest.dsl && (aiRequest.repairDepth ?? 0) < 2 && <Button variant="outline" onClick={() => generateValidator(aiRequest.id)}>让 AI 修复</Button>}</div></div>}</section>
      <JudgeProgramWizard open={wizardOpen} onClose={() => { setWizardOpen(false); setWizardTemplateId(null) }} initialTemplateId={wizardTemplateId} problemId={problemId} judgeMode={judgeMode} catalog={catalog} subtasks={(graph?.subtasks || []).map(item => ({ id: item.id, score: item.score, dependencies: item.dependencies }))} onChanged={load} />
    </div></>}

    {tab === 'import' && <section className={styles.card}><h3>数据导入</h3><p>上传完整 `.in/.out`、`.in/.ans` 或 ZIP。OI 数据导入后在“数据与分组”中注册并分配正式分组；仅有输入文件时可使用“输入数据补答案”。</p><Input type="file" multiple accept=".in,.out,.ans,.zip" onChange={event => setImportFiles(Array.from(event.target.files || []))} /><Checkbox label="同名文件冲突时替换" checked={replaceExisting} onChange={event => setReplaceExisting(event.target.checked)} /><Button variant="primary" disabled={saving || !importFiles.length} onClick={uploadTestdata}>{saving ? '上传中…' : `导入数据（${importFiles.length}）`}</Button></section>}
    {tab === 'generate' && <section className={styles.card}><h3>数据生成</h3><div className={styles.formRow}><Select aria-label="来源方式" value={sourceMode} onChange={event => { const mode = event.target.value as 'generator' | 'input'; setSourceMode(mode); setRows(mode === 'generator' ? 'small-1 | 1 | 10 100\nsmall-2 | 2 | 100 1000' : '[\n  {"name":"manual-1","inputData":"1 2\\n"}\n]') }}><option value="generator">参数清单生成器</option><option value="input">输入数据补答案</option></Select><Select aria-label="标准答案程序" value={standardId} onChange={event => setStandardId(event.target.value)}><option value="">选择标准答案程序</option>{currentStandard.map(item => <option key={item.id} value={item.id}>{item.programName} v{item.versionNumber}</option>)}</Select><Select aria-label="输入检查程序" value={validatorId} onChange={event => setValidatorId(event.target.value)}><option value="">选择输入检查程序</option>{currentValidator.map(item => <option key={item.id} value={item.id}>{item.programName} v{item.versionNumber}</option>)}</Select>{sourceMode === 'generator' && <Select aria-label="数据生成程序" value={generatorId} onChange={event => setGeneratorId(event.target.value)}><option value="">选择数据生成程序</option>{currentGenerator.map(item => <option key={item.id} value={item.id}>{item.programName} v{item.versionNumber}</option>)}</Select>}</div><label>{sourceMode === 'generator' ? '每行：名称 | 种子 | 参数列表' : 'JSON 数组：name + inputData'}</label><Textarea rows={10} value={rows} onChange={event => setRows(event.target.value)} /><Button variant="primary" disabled={!standardId || !validatorId || (sourceMode === 'generator' && !generatorId) || !rows.trim()} onClick={createJob}>创建生成任务</Button></section>}
    {tab === 'candidates' && <div className={styles.columns}><section className={styles.card}><h3>生成任务</h3>{jobs.map((job, index) => <Button variant="ghost" className={styles.job} key={job.id} onClick={() => openJob(job)}><strong>生成任务 {jobs.length - index}</strong><span>{displayLabel(JOB_STATUS_LABELS, job.status)} · {new Date(job.createdAt).toLocaleString('zh-CN')}</span></Button>)}</section>{selectedJob && <section className={styles.card}><h3>候选测试点</h3><TableRoot><TableHead><TableRow><TableHeaderCell>名称</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell>{judgeMode === 'oi' && <TableHeaderCell>正式分组</TableHeaderCell>}</TableRow></TableHead><TableBody>{selectedJob.cases?.map(item => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{displayLabel(CASE_STATUS_LABELS, item.status)}{item.message ? ' · 需要检查' : ''}</TableCell>{judgeMode === 'oi' && <TableCell><Select aria-label="正式分组" value={assignments[item.id] || ''} onChange={event => setAssignments(current => ({ ...current, [item.id]: event.target.value }))}><option value="">选择分组</option>{officialGroups.map(group => <option key={group.value} value={group.value}>{group.label}</option>)}</Select></TableCell>}</TableRow>)}</TableBody></TableRoot><div className={styles.preview}>{selectedJob.cases?.filter(item => item.status === 'validated').map(item => <details key={item.id}><summary>{item.name} 输入/答案预览</summary><pre>{item.inputPreview}</pre><pre>{item.outputPreview}</pre></details>)}</div>{selectedJob.status === 'completed' && <Button variant="primary" disabled={judgeMode === 'oi' && selectedJob.cases?.some(item => item.status === 'validated' && !assignments[item.id])} onClick={promote}>采用为评测数据</Button>}</section>}</div>}
    {tab === 'pool' && <section className={styles.card}>
      <h3>候选测试数据</h3>
      {candidatePool ? <>
        <p>当前共有 {candidatePool.activeCount} 条候选数据，占用 {(candidatePool.hotBytes / 1024 / 1024).toFixed(2)} MiB。</p>
        {candidatePool.subtasks.length > 0 && <TableRoot><TableHead><TableRow><TableHeaderCell>子任务</TableHeaderCell><TableHeaderCell>正式点</TableHeaderCell><TableHeaderCell>错误程序</TableHeaderCell><TableHeaderCell>行为簇</TableHeaderCell><TableHeaderCell>模式</TableHeaderCell></TableRow></TableHead><TableBody>{candidatePool.subtasks.map(item => <TableRow key={item.subtaskId}><TableCell>S{item.subtaskId}</TableCell><TableCell>{item.caseCount}/{item.caseLimit}</TableCell><TableCell>{item.wrongProgramCount}</TableCell><TableCell>{item.wrongClusterCount}</TableCell><TableCell>{displayLabel(CONTRIBUTION_MODE_LABELS, item.contributionMode)}{item.autoSelection ? ' · 可自动采用' : item.bootstrapAvailable ? ' · 可建立基础数据' : ' · 仅观察'}</TableCell></TableRow>)}</TableBody></TableRoot>}
        <div className={styles.actions}>
          <Button variant={candidatePool.policy.selectorMode === 'observe' ? 'primary' : 'outline'} onClick={() => updateSelectorMode('observe')}>观察模式</Button>
          <Button variant={candidatePool.policy.selectorMode === 'auto' ? 'primary' : 'outline'} disabled={candidatePool.subtasks.length > 0 && !candidatePool.subtasks.some(item => item.autoSelection)} onClick={() => updateSelectorMode('auto')}>质量阈值自动发布</Button>
          <Button variant="outline" loading={saving} onClick={previewSelector}>预览自动质量检查</Button>
        </div>
        {selectorPreview && <div className={styles.protocolCard}><strong>{selectorPreview.publishable ? '存在可采用的候选数据' : '当前没有候选数据达到自动采用条件'}</strong><span>共检查 {selectorPreview.candidates.length} 条候选数据。</span>{selectorPreview.candidates.map((item, index) => <details key={item.id}><summary>候选数据 {index + 1} · {candidateStatusLabel(item.status)}</summary>{item.decisions?.map(decision => <p key={decision.subtaskId}>子任务 {decision.subtaskId}：{decision.selected ? '建议采用' : '暂不采用'} · 质量提升 {decision.qualityGain.toFixed(1)} / 要求 {decision.requiredGain.toFixed(1)}</p>)}</details>)}</div>}
        <TableRoot><TableHead><TableRow><TableHeaderCell>候选数据</TableHeaderCell><TableHeaderCell>来源</TableHeaderCell><TableHeaderCell>用途</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>预计提升</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell></TableRow></TableHead><TableBody>{candidatePool.candidates.map((item, index) => <TableRow key={item.id}><TableCell>候选数据 {index + 1}</TableCell><TableCell>{displayLabel(SOURCE_LABELS, item.source, '其他来源')}</TableCell><TableCell>{displayLabel(TARGET_LABELS, item.targetRole, '用途待确认')}</TableCell><TableCell>{candidateStatusLabel(item.status)}</TableCell><TableCell>{item.marginalValue}</TableCell><TableCell>{item.targetRole === 'hack_gate' && ['ELIGIBLE', 'ELIGIBLE_NOT_SELECTED', 'WAITING_REPLACEMENT'].includes(item.status) ? <Button variant="outline" onClick={() => { setEmergencyCandidate(item.id); setEmergencyReason('') }}>紧急发布</Button> : '—'}</TableCell></TableRow>)}</TableBody></TableRoot>
        {candidatePool.retirements.length > 0 && <details><summary>历史成员替换审计（{candidatePool.retirements.length}）</summary><TableRoot><TableHead><TableRow><TableHeaderCell>子任务</TableHeaderCell><TableHeaderCell>变更</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell></TableRow></TableHead><TableBody>{candidatePool.retirements.map(item => <TableRow key={item.id}><TableCell>子任务 {item.subtaskId}</TableCell><TableCell>{item.replacementTestcaseId ? '已替换一条测试数据' : '已移除一条测试数据'}</TableCell><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell></TableRow>)}</TableBody></TableRoot></details>}
      </> : <p className={styles.muted}>正在加载候选测试数据…</p>}
      <FormDialog isOpen={Boolean(emergencyCandidate)} onClose={() => { setEmergencyCandidate(null); setEmergencyReason('') }} onSubmit={emergencyPublish} title="紧急采用候选数据" description="仅跳过自动质量门槛；仍会执行结构、数量、保护期和数据变化检查。" submitText="确认紧急采用" danger loading={saving} dirty={Boolean(emergencyReason)}><label>审计原因（10～1000 字）<Textarea rows={5} value={emergencyReason} onChange={event => setEmergencyReason(event.target.value)} /></label></FormDialog>
    </section>}
    {tab === 'corpus' && <section className={styles.card}><h3>历史错误行为</h3><p className={styles.muted}>系统只使用去标识化的错误行为帮助检查测试数据覆盖，不展示源码、用户或提交标识。</p>{corpus?.revision ? <p>{corpus.revision.clusterCount} 个代表行为 · 常规检查 {corpus.revision.evaluationCount} · 隐藏检查 {corpus.revision.holdoutCount}</p> : <p>尚未建立历史错误行为样本。</p>}<Button variant="primary" loading={saving} onClick={rebuildCorpus}>重新分析历史错误提交</Button></section>}
    {tab === 'quality' && <ProblemQualityPanel problemId={problemId} />}
    {tab === 'slots' && <section className={styles.card}><h3>当前评测数据</h3><p>候选数据、补充数据和生成任务会先完成质量检查，再安全更新正式评测数据。</p>{jobs.some(job => job.promotedGraphHash) ? <p>最近已有生成任务更新评测数据。</p> : <p>暂无由生成任务带来的数据更新。</p>}</section>}
  </div>
}
