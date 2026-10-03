'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react'
import collisionStyles from './ProblemHackPanel.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { getLanguageLabel, judgeResultLabel } from '@/lib/judge-constants'
import styles from './ProblemHackPanel.module.css'
import { SubmissionIoFields, SubmissionCodeEditor, clearSubmissionDraft, type SubmissionIoValue } from '@/features/submission'
import { getJudgeProgramTemplate } from '@oi-manager/shared'
import type { ProblemContributionReadiness, ProblemContributionTask, ProblemHackAttempt, WorkspaceSummary } from '@oi-manager/contracts'
import { listWorkspaces } from '@/features/workspace'
import { buildContributionTimeline, candidateLifecyclePresentation, contributionStageLabel, hackCanonicalPresentation, type LifecycleTone } from '../model/problem-contribution-display'
import { contributeProblemCandidateData, contributeProblemCandidateGenerator, createProblemHackAttempt, getProblemContributionReadiness, getProblemHackAttempt, listProblemContributions, listProblemHackAttempts, retryProblemHackAttempt } from '../api/problemContributionApi'

type InputChoice = 'data' | 'cpp17' | 'python3'
type Attempt = ProblemHackAttempt
type Readiness = ProblemContributionReadiness
type ContributionTask = ProblemContributionTask
type AssetStatus = 'none' | 'draft' | 'verifying' | 'failed' | 'ready' | 'active'

const STATUS: Record<string, string> = { queuing: '排队中', judging: '验证与评测中', accepted: '有效 Hack', rejected: '无效 Hack', system_error: '系统错误', stale: '配置已变化' }
const FAILURE_STAGE: Record<string, string> = { input: '候选输入', generator: '数据生成器', validator: '输入校验', classifier: '子任务分类', standard: '标准答案生成', checker: '答案检查', baseline: '原始完整评测', candidate: '加入候选点后评测', persist: '测试数据入库', stale: '配置一致性检查' }
const ASSET_LABEL: Record<AssetStatus, string> = { none: '未配置', draft: '草稿', verifying: '验证中', failed: '验证失败', ready: '待激活', active: '已激活' }
const CORPUS_LABEL: Record<Readiness['wrongCorpus']['mode'], string> = { closed: '未开放价值评估', limited: '观察模式', open: '已开放自动评估' }
const CONTRIBUTION_MODE_LABEL: Record<'closed' | 'limited' | 'open', string> = { closed: '暂停接收', limited: '观察模式', open: '自动评估' }
const READINESS_MESSAGE: Record<string, string> = {
  CONTRIBUTION_NOT_AVAILABLE: '当前题目尚未发布，暂不能贡献数据。',
  STD_NOT_ACTIVE: '当前题目尚未准备好标准答案程序。',
  VALIDATOR_NOT_ACTIVE: '当前题目尚未准备好输入检查规则。',
  WRONG_CORPUS_REQUIRED: '系统仍在准备质量评估依据，请稍后再试。',
  CLASSIFIER_NOT_ACTIVE: '子任务判定尚未准备好，候选数据将等待进一步检查。',
  WRONG_CORPUS_NOT_READY: '质量评估依据仍在准备，候选数据暂不会自动采用。',
  WRONG_CORPUS_INSUFFICIENT_FOR_AUTO_SELECTION: '部分子任务仍在观察阶段，候选数据暂不会自动采用。',
  HACK_ASSET_SELECTION_REQUIRED: '评测配置已有变化，请由管理员重新确认反例设置。',
}
const readinessMessage = (code: string) => READINESS_MESSAGE[code] || '当前条件尚未满足，请稍后重试。'
export function ProblemHackPanel({ problemId, acceptedCount, languages, mode, hackEnabled, onConfigureAssets }: { problemId: string; acceptedCount: number; languages: string[]; mode: 'acm' | 'oi'; hackEnabled: boolean; onConfigureAssets?: () => void }) {
  const toast = useToast()
  const [choice, setChoice] = useState<InputChoice>('data'), [candidate, setCandidate] = useState(''), [hackSource, setHackSource] = useState(''), [hackLanguage, setHackLanguage] = useState(languages[0] || '')
  const [hackIo, setHackIo] = useState<SubmissionIoValue>({ inputFilename: null, outputFilename: null })
  const [contributionOrganizationId, setContributionOrganizationId] = useState('')
  const [organizationWorkspaces, setOrganizationWorkspaces] = useState<WorkspaceSummary[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([]), [contributions, setContributions] = useState<ContributionTask[]>([]), [readiness, setReadiness] = useState<Readiness | null>(null)
  const [canManage, setCanManage] = useState(false), [totalAccepted, setTotalAccepted] = useState(acceptedCount), [loading, setLoading] = useState(true), [submitting, setSubmitting] = useState(false)
  const [hackLoadError, setHackLoadError] = useState(''), [readinessLoadError, setReadinessLoadError] = useState(''), [contributionLoadError, setContributionLoadError] = useState(''), [workspaceLoadError, setWorkspaceLoadError] = useState('')
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null), [attemptDetails, setAttemptDetails] = useState<Record<string, Attempt>>({}), [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setHackLoadError(''); setReadinessLoadError(''); setContributionLoadError(''); setWorkspaceLoadError('')
    const [hackResult, readinessResult, contributionResult, workspaceResult] = await Promise.allSettled([
      listProblemHackAttempts(problemId, { page: 1, pageSize: 50 }),
      getProblemContributionReadiness(problemId),
      listProblemContributions(problemId),
      listWorkspaces(),
    ])
    if (hackResult.status === 'fulfilled') {
      setAttempts(hackResult.value.attempts)
      setCanManage(hackResult.value.canManage)
      setTotalAccepted(hackResult.value.acceptedCount)
    } else {
      setAttempts([])
      setHackLoadError(publicErrorMessage(hackResult.reason, 'Hack 记录加载失败'))
    }
    if (readinessResult.status === 'fulfilled') {
      setReadiness(readinessResult.value)
      setCanManage(readinessResult.value.canManage)
    } else {
      setReadiness(null)
      setReadinessLoadError(publicErrorMessage(readinessResult.reason, '贡献就绪状态加载失败'))
    }
    if (contributionResult.status === 'fulfilled') {
      setContributions(contributionResult.value)
    } else {
      setContributions([])
      setContributionLoadError(publicErrorMessage(contributionResult.reason, '贡献任务加载失败'))
    }
    const workspaces = workspaceResult.status === 'fulfilled' ? workspaceResult.value.workspaces : []
    setOrganizationWorkspaces(workspaces.filter(item => item.type === 'organization'))
    if (workspaceResult.status === 'rejected') setWorkspaceLoadError('学校列表暂时无法加载')
    setLoading(false)
  }, [problemId])
  useEffect(() => { setLoading(true); void load() }, [load])
  const hasActive = useMemo(() => attempts.some(item => item.status === 'queuing' || item.status === 'judging'), [attempts])
  const hasActiveContribution = useMemo(() => contributions.some(item => ['queued', 'running', 'finalizing'].includes(item.status)), [contributions])
  useEffect(() => { if (!hasActive && !hasActiveContribution) return; const timer = window.setInterval(load, 2000); return () => window.clearInterval(timer) }, [hasActive, hasActiveContribution, load])

  const readFile = async (file: File | undefined, setter: (value: string) => void, limit: number) => { if (!file) return; if (file.size > limit) return toast.error(`文件不能超过 ${limit >= 16 * 1024 * 1024 ? '16 MiB' : limit >= 1024 * 1024 ? '1 MiB' : '256 KiB'}`); setter(await file.text()) }
  const contribute = async () => {
    if (!candidate.trim()) return toast.error('请填写候选输入或数据生成器源码')
    setSubmitting(true)
    try {
      const attribution = contributionOrganizationId ? { contributionOrganizationId } : {}
      const result = choice === 'data'
        ? await contributeProblemCandidateData(problemId, { name: '用户贡献', inputData: candidate, ...attribution })
        : await contributeProblemCandidateGenerator(problemId, { language: choice, source: candidate, ...attribution, manifest: { apiVersion: 'oj.generator/v1', protocol: 'oj.generator/v1', language: choice, entry: choice === 'python3' ? 'main.py' : 'main.cpp', parameterSchema: {}, profiles: [{ id: 'default', label: '默认', params: {} }] } })
      if (!result.ok) return toast.error(result.error.userMessage)
      toast.success('贡献任务已提交，系统正在检查'); setCandidate(''); await load()
    } finally { setSubmitting(false) }
  }
  const submit = async () => {
    if (!candidate.trim() || !hackSource.trim()) return toast.error('请完整填写候选输入和被 Hack 程序')
    setSubmitting(true)
    try {
      const result = await createProblemHackAttempt(problemId, { inputMode: choice === 'data' ? 'data' : 'generator', inputData: choice === 'data' ? candidate : undefined, generatorSource: choice === 'data' ? undefined : candidate, generatorLanguage: choice === 'data' ? undefined : choice, hackSource, hackLanguage, inputFilename: hackIo.inputFilename || null, outputFilename: hackIo.outputFilename || null, contributionOrganizationId: contributionOrganizationId || null })
      if (!result.ok) return toast.error(result.error.userMessage)
      toast.success('Hack 已加入独立评测队列'); clearSubmissionDraft(`hack:${problemId}`, hackLanguage); setCandidate(''); setHackSource(''); setHackIo({ inputFilename: null, outputFilename: null }); await load()
    } finally { setSubmitting(false) }
  }
  const retry = async (id: string) => { const result = await retryProblemHackAttempt(problemId, id); if (!result.ok) return toast.error(result.error.userMessage); toast.success('已重新加入队列'); await load() }
  const toggleDetails = async (attempt: Attempt) => {
    if (expandedAttemptId === attempt.id) return setExpandedAttemptId(null)
    setExpandedAttemptId(attempt.id); if (attemptDetails[attempt.id]) return; setLoadingDetailId(attempt.id)
    try { const detail = await getProblemHackAttempt(problemId, attempt.id); setAttemptDetails(current => ({ ...current, [attempt.id]: detail })) } catch (error) { toast.error(publicErrorMessage(error, 'Hack 详情加载失败')) } finally { setLoadingDetailId(current => current === attempt.id ? null : current) }
  }
  const icon = (status: AssetStatus | 'good' | 'bad') => status === 'active' || status === 'good' ? <CheckCircle2 size={17} /> : status === 'failed' || status === 'none' || status === 'bad' ? <XCircle size={17} /> : <Circle size={17} />
  const tone = (status: AssetStatus | 'good' | 'bad') => status === 'active' || status === 'good' ? styles.ok : status === 'failed' || status === 'none' || status === 'bad' ? styles.bad : styles.pending
  const disabledReason = readinessLoadError || (!readiness && loading ? '正在确认题目贡献条件' : '') || (readiness?.blockers[0] ? readinessMessage(readiness.blockers[0].code) : '') || (!candidate.trim() ? '请输入或上传候选测试数据' : '')
  const lifecycleClass = (toneValue: LifecycleTone) => toneValue === 'success' ? styles.ok : toneValue === 'error' ? styles.bad : toneValue === 'warning' || toneValue === 'pending' ? styles.pending : styles.neutral

  return <div className={styles.root}>
    <div className={styles.hero}><div><h2 className={styles.title}>{hackEnabled ? `题目级 ${mode === 'oi' ? 'OI / IOI' : 'ACM'} 反例与数据贡献` : '贡献候选测试数据'}</h2><p className={styles.description}>提交的数据不会直接修改正式测试集。系统会依次检查输入是否合法、生成标准答案、排除重复数据，并完成分类和价值评估；数据生成器还会在隔离环境中检查结果是否稳定。</p></div>{hackEnabled && <span className={styles.count}>有效反例 {totalAccepted} 个</span>}</div>

    {!readiness && <section className={readinessLoadError ? styles.blocked : styles.readiness} aria-label="题目贡献状态" role={readinessLoadError ? 'alert' : undefined}>{readinessLoadError ? <XCircle size={24} aria-hidden="true" /> : <Circle size={24} aria-hidden="true" />}<div><h3>{readinessLoadError ? '题目贡献状态暂时不可用' : '正在确认题目贡献条件'}</h3><p>{readinessLoadError || '请稍候，在就绪状态返回前不会开放提交。'}</p>{readinessLoadError && <Button size="sm" variant="outline" loading={loading} onClick={() => void load()}>重新加载</Button>}</div></section>}
    {readiness && <section className={styles.readiness} aria-label="题目贡献状态"><div className={styles.readinessTitle}><strong>题目贡献状态</strong><span>{readiness.canContribute ? '前置条件已满足' : '当前暂不可贡献'}</span></div><div className={styles.readinessGrid}>{[
      { name: '标准答案程序', status: readiness.standard.status, text: readiness.standard.status === 'active' ? '正常' : ASSET_LABEL[readiness.standard.status] },
      { name: '输入校验', status: readiness.validator.status, text: readiness.validator.status === 'active' ? '正常' : ASSET_LABEL[readiness.validator.status] },
      { name: '子任务分类', status: readiness.mode === 'acm' ? 'good' as const : readiness.classifier.status, text: readiness.mode === 'acm' ? 'ACM 不需要' : ASSET_LABEL[readiness.classifier.status] },
      { name: '评估语料', status: readiness.wrongCorpus.mode === 'open' ? 'active' as const : readiness.wrongCorpus.mode === 'closed' ? 'bad' as const : 'ready' as const, text: CORPUS_LABEL[readiness.wrongCorpus.mode] },
      { name: '数据贡献', status: readiness.canContribute ? 'good' as const : 'bad' as const, text: readiness.canContribute ? '开放' : '关闭' },
    ].map(item => <div className={styles.readinessItem} key={item.name}><span className={tone(item.status)}>{icon(item.status)}</span><strong>{item.name}</strong><span>{item.text}</span></div>)}</div>{readiness.canManage && readiness.subtasks?.length ? <div className={styles.readinessGrid}>{readiness.subtasks.map(item => <div className={styles.readinessItem} key={item.subtaskId}><strong>子任务 {item.subtaskId}</strong><span>正式测试点 {item.caseCount}/{item.caseLimit}</span><span>错误程序 {item.wrongProgramCount} · 行为类型 {item.wrongClusterCount}</span><span>{CONTRIBUTION_MODE_LABEL[item.contributionMode] || '处理方式待确认'}{item.autoSelection ? ' · 自动选择' : item.bootstrapAvailable ? ' · 可建立核心点' : ' · 等待条件'}</span></div>)}</div> : null}</section>}

    {readiness && (!readiness.canContribute && !readiness.canHack ? <section className={styles.blocked}><XCircle size={24} aria-hidden="true" /><div><h3>当前暂不可贡献测试数据</h3>{readiness.blockers.map(item => <p key={item.code}>{readinessMessage(item.code)}</p>)}<p>题目需要先准备好标准答案程序和输入校验规则。</p>{readiness.canManage && onConfigureAssets && <div className={styles.configureActions}><Button variant="primary" onClick={onConfigureAssets}>AI 生成输入校验规则</Button><Button variant="outline" onClick={onConfigureAssets}>手动配置评测资产</Button></div>}</div></section> : <div className={styles.form}>
      <section className={styles.preparedTools} aria-label="系统已准备的评测工具"><div><strong>输入校验已准备</strong><span>系统会自动判断数据是否合法，你只需提供测试输入。</span></div><div><strong>标准答案程序已准备</strong><span>系统会自动生成正确答案，你不需要上传答案文件。</span></div>{readiness?.mode === 'oi' && <div><strong>子任务分类由系统处理</strong><span>系统会判断数据满足的全部子任务，你不需要自行选择。</span></div>}</section>
      {readiness?.warnings.map(item => <div className={styles.notice} key={item.code}><AlertTriangle size={18} aria-hidden="true" /><span>{readinessMessage(item.code)}</span></div>)}
      {workspaceLoadError && <div className={styles.notice} role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{workspaceLoadError}；仍可以选择“个人贡献”提交。</span></div>}
      {organizationWorkspaces.length > 0 && <div className={styles.attribution}><label htmlFor={`contribution-organization-${problemId}`}><strong>贡献归属（可选）</strong><span>默认为个人贡献；选择学校只用于贡献记录归属，暂不发放学校匹配奖励。</span></label><Select id={`contribution-organization-${problemId}`} value={contributionOrganizationId} onChange={event => setContributionOrganizationId(event.target.value)}><option value="">个人贡献</option>{organizationWorkspaces.map(item => <option key={item.organizationId} value={item.organizationId}>{item.organizationName || '未命名学校'}</option>)}</Select></div>}
      {readiness && !readiness.canContribute && readiness.canHack && <div className={styles.notice}><AlertTriangle size={18} aria-hidden="true" /><span>普通数据贡献暂未开放，但 Hack 自带真实错误证据，仍可按技术判定流程提交。</span></div>}
      <div className={styles.modeGrid} role="radiogroup" aria-label="候选输入方式">{([['data', '直接数据', '填写或上传完整输入数据'], ['cpp17', 'C++17 生成器', '系统会检查生成参数与输出内容'], ['python3', 'Python3 生成器（推荐）', '系统会检查生成参数与输出内容']] as const).map(([value, title, hint]) => <Button variant="ghost" key={value} type="button" role="radio" aria-checked={choice === value} className={`${styles.mode} ${choice === value ? styles.modeActive : ''}`} onClick={() => { setChoice(value); setCandidate(value === 'data' ? '' : (getJudgeProgramTemplate(`generator-${value}-v1`)?.source || '')) }}><span className={styles.modeTitle}>{title}</span><span className={styles.modeHint}>{hint}</span></Button>)}</div>
      <div className={styles.field}><div className={styles.labelRow}><span className={styles.label}>{choice === 'data' ? '候选输入数据' : `${choice === 'cpp17' ? 'C++17' : 'Python3'} 数据生成器`}</span><label className={styles.upload}>上传文件<Input type="file" accept={choice === 'data' ? '.in,.txt,text/plain' : choice === 'cpp17' ? '.cpp,.cc,.cxx,text/plain' : '.py,text/plain'} onChange={event => readFile(event.target.files?.[0], setCandidate, choice === 'data' ? 16 * 1024 * 1024 : 256 * 1024)} /></label></div><Textarea className={styles.textarea} spellCheck={false} value={candidate} onChange={event => setCandidate(event.target.value)} placeholder={choice === 'data' ? '填写完整输入数据…' : '填写生成器源码，程序应输出一组完整测试输入…'} /></div>
      {choice !== 'data' && <div className={styles.generatorProtocol}><strong>数据生成器规则</strong><span>程序会收到随机种子和本次数据参数，并且只能输出一份完整测试输入。</span><span>同一组参数会运行两次；两次结果不同的数据生成器将被拒绝。管理员可在评测资产页查看完整协议。</span></div>}
      <div className={styles.pipeline}><strong>提交后将执行</strong><span>{choice === 'data' ? '输入校验 → 生成标准答案 → 答案检查 → 去重 → 分类 → 价值评估' : '编译 → 隔离运行 → 稳定性检查 → 输入校验 → 生成标准答案 → 答案检查 → 去重 → 分类 → 价值评估'}</span></div>
      {hackEnabled && <><div className={styles.twoColumns}><div className={styles.field}><span className={styles.label}>被 Hack 程序语言</span><Select className={styles.select} value={hackLanguage} disabled={languages.length === 0} onChange={event => setHackLanguage(event.target.value)}>{languages.length === 0 ? <option value="">题目没有可用的本地语言</option> : languages.map(language => <option key={language} value={language}>{getLanguageLabel(language)}</option>)}</Select></div><div className={styles.warning}>技术 Hack 有效只代表候选数据能改变结果；系统还会评估它是否值得加入正式数据，既有活动和历史成绩不会变化。</div></div><div className={styles.field}><div className={styles.labelRow}><span className={styles.label}>用于证明的被 Hack 程序</span><label className={styles.upload}>上传源码<Input type="file" accept=".c,.cc,.cpp,.cxx,.py,text/plain" onChange={event => readFile(event.target.files?.[0], setHackSource, 256 * 1024)} /></label></div><SubmissionCodeEditor value={hackSource} onChange={setHackSource} language={hackLanguage} draftKey={`hack:${problemId}`} minHeight={300} /></div><SubmissionIoFields value={hackIo} onChange={setHackIo} /></>}
      <div className={styles.submitArea}><div className={disabledReason ? styles.disabledReason : styles.readyReason}>{disabledReason || '✓ 已满足提交条件'}</div><div className={styles.submitRow}><Button variant="outline" disabled={submitting || !readiness?.canContribute || !candidate.trim()} onClick={contribute}>{submitting ? '正在提交…' : readiness?.canContribute ? hackEnabled ? '仅贡献候选数据' : '贡献候选数据' : '暂不可贡献'}</Button>{hackEnabled && <Button variant="ghost" className={styles.submit} disabled={submitting || hasActive || !readiness?.canHack || !candidate.trim() || !hackSource.trim() || !hackLanguage || hackIo.inputFilename === '' || hackIo.outputFilename === ''} onClick={submit}>{hasActive ? '已有 Hack 正在处理' : !readiness?.canHack ? '当前不可 Hack' : submitting ? '正在提交…' : '发起 Hack'}</Button>}</div></div>
    </div>)}

    <section className={styles.contributions}>
      <h3 className={styles.historyTitle}>{canManage ? '本题贡献任务' : '我的贡献任务'}</h3>
      {contributionLoadError ? <div className={styles.loadError} role="alert"><span>{contributionLoadError}</span><Button size="sm" variant="outline" loading={loading} onClick={() => void load()}>重新加载</Button></div> : loading ? <div className={styles.empty}>正在加载…</div> : contributions.length === 0 ? <div className={styles.empty}>暂无贡献任务</div> : <div className={styles.taskList}>
        {contributions.map((task, taskIndex) => {
          const currentStage = task.cases[0]?.stage || task.stage
          const primaryCandidate = task.cases.find(item => item.candidateStatus)
          const lifecycle = candidateLifecyclePresentation(primaryCandidate?.candidateStatus, currentStage)
          return <article className={styles.task} key={task.jobId}>
            <div className={styles.taskHeader}><strong>贡献任务 {contributions.length - taskIndex}</strong><span>{new Date(task.createdAt).toLocaleString('zh-CN')}</span></div>
            <div className={styles.taskMeta}><span>贡献归属：{task.contributionOrganizationName || '个人贡献'}</span><span>来源：{task.sourceMode === 'generator' ? '数据生成器' : '直接数据'}</span></div>
            <div className={styles.taskStage}><span className={lifecycleClass(lifecycle.tone)}>{lifecycle.tone === 'success' ? <CheckCircle2 size={17} /> : lifecycle.tone === 'error' ? <XCircle size={17} /> : <Circle size={17} />}</span><strong>{lifecycle.label}</strong><span>{contributionStageLabel(currentStage)}</span>{task.message && <span>处理未完成，请稍后重试。</span>}</div>
            <ol className={styles.timeline}>{buildContributionTimeline({ sourceMode: task.sourceMode, status: task.status, stage: currentStage }).map(item => <li key={item.stage} className={item.state === 'done' ? styles.timelineDone : item.state === 'failed' ? styles.timelineFailed : item.state === 'current' ? styles.timelineCurrent : ''}><span>{item.state === 'done' ? '✓' : item.state === 'failed' ? '×' : '○'}</span>{item.label}</li>)}</ol>
            {task.cases.length > 0 && <div className={styles.caseList}>{task.cases.map(item => {
              const itemLifecycle = candidateLifecyclePresentation(item.candidateStatus, item.stage)
              return <div className={styles.caseItem} key={item.caseId}><span>{item.name}</span><span>{contributionStageLabel(item.stage)}</span>{item.candidateId && <span>候选数据</span>}<span className={lifecycleClass(itemLifecycle.tone)}>{itemLifecycle.label}</span>{item.message && <span className={styles.caseMessage}>该数据处理未完成。</span>}</div>
            })}</div>}
          </article>
        })}
      </div>}
    </section>

    {hackEnabled && <section className={styles.history}>
      <h3 className={styles.historyTitle}>{canManage ? '本题全部 Hack 记录' : '我的 Hack 记录'}</h3>
      {hackLoadError ? <div className={styles.loadError} role="alert"><span>{hackLoadError}</span><Button size="sm" variant="outline" loading={loading} onClick={() => void load()}>重新加载</Button></div> : loading ? <div className={styles.empty}>正在加载…</div> : attempts.length === 0 ? <div className={styles.empty}>暂无 Hack 记录</div> : <div className={styles.tableWrap}>
        <TableRoot className={styles.table}>
          <TableHead><TableRow><TableHeaderCell>时间</TableHeaderCell>{canManage && <TableHeaderCell>用户</TableHeaderCell>}<TableHeaderCell>贡献归属</TableHeaderCell><TableHeaderCell>输入方式</TableHeaderCell><TableHeaderCell>程序语言</TableHeaderCell><TableHeaderCell>Hack 程序</TableHeaderCell><TableHeaderCell>前后 Verdict</TableHeaderCell><TableHeaderCell>技术 / 正式状态</TableHeaderCell><TableHeaderCell>失败阶段</TableHeaderCell><TableHeaderCell>说明</TableHeaderCell></TableRow></TableHead>
          <TableBody>{attempts.map(item => {
            const detail = attemptDetails[item.id]
            const comparison = mode === 'oi' && item.baselineScore != null ? `${item.baselineScore} → ${item.candidateScore ?? '—'}${item.scoreDelta ? `（-${item.scoreDelta}）` : ''}${item.affectedSubtaskIds?.length ? ` · S${item.affectedSubtaskIds.join(', S')}` : ''}` : item.baselineResult ? `${judgeResultLabel(item.baselineResult)} → ${judgeResultLabel(item.candidateResult)}` : '—'
            const canonical = hackCanonicalPresentation({ technicalStatus: item.status, canonicalStatus: item.canonicalStatus, candidateStatus: item.testcaseCandidateStatus, promotedGraphHash: item.promotedGraphHash })
            return <Fragment key={item.id}>
              <TableRow>
                <TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell>
                {canManage && <TableCell>{item.username || '-'}</TableCell>}
                <TableCell>{item.contributionOrganizationName || '个人贡献'}</TableCell>
                <TableCell>{item.inputMode === 'data' ? '直接数据' : getLanguageLabel(item.generatorLanguage)}</TableCell>
                <TableCell>{getLanguageLabel(item.hackLanguage)}</TableCell>
                <TableCell><div className={styles.actions}><Button variant="ghost" className={styles.retry} disabled={loadingDetailId === item.id} onClick={() => toggleDetails(item)}>{loadingDetailId === item.id ? '读取中…' : expandedAttemptId === item.id ? '收起程序' : '查看程序'}</Button>{canManage && item.status === 'system_error' && <Button variant="ghost" className={styles.retry} onClick={() => retry(item.id)}>重新执行</Button>}</div></TableCell>
                <TableCell>{comparison}</TableCell>
                <TableCell><div className={styles.lifecycle}><span className={`${styles.status} ${item.status === 'accepted' ? styles.accepted : item.status === 'rejected' ? styles.rejected : item.status === 'system_error' || item.status === 'stale' ? styles.error : ''}`}>{STATUS[item.status] || `状态待确认`}</span><small className={lifecycleClass(canonical.tone)}>{canonical.label}</small>{item.baseGraphHash && <small>判定基于当前评测数据</small>}</div></TableCell>
                <TableCell>{item.failureStage ? FAILURE_STAGE[item.failureStage] || '处理阶段待确认' : '—'}</TableCell>
                <TableCell>{item.message ? '处理未完成，请重试。' : '—'}</TableCell>
              </TableRow>
              {expandedAttemptId === item.id && <TableRow><TableCell colSpan={canManage ? 10 : 9} className={styles.detailCell}>{detail ? <div className={styles.detailGrid}><section><strong>{detail.inputMode === 'data' ? '候选输入' : `${detail.generatorLanguage} 生成器`}</strong><div className={styles.programIo}>贡献归属：{detail.contributionOrganizationName || '个人贡献'}</div><pre>{detail.inputMode === 'data' ? detail.inputData : detail.generatorSource}</pre></section><section><strong>被 Hack 程序（{getLanguageLabel(detail.hackLanguage)}）</strong><div className={styles.programIo}>输入：{detail.inputFilename || '标准输入'} · 输出：{detail.outputFilename || '标准输出'}</div><pre>{detail.hackSource}</pre></section></div> : <div className={styles.detailLoading}><span className={[('resource-skeleton-line'), collisionStyles.u1].filter(Boolean).join(' ')} aria-label="Hack 详情正在准备" /></div>}</TableCell></TableRow>}
            </Fragment>
          })}</TableBody>
        </TableRoot>
      </div>}
    </section>}
  </div>
}
