'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react'
import collisionStyles from './ProblemHackPanel.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { getLanguageLabel } from '@/lib/judge-constants'
import styles from './ProblemHackPanel.module.css'
import { SubmissionIoFields, type SubmissionIoValue } from '@/components/submission/SubmissionIoFields'

type InputChoice = 'data' | 'cpp17' | 'python3'
interface Attempt { id: string; username?: string; status: string; inputMode: string; generatorLanguage?: string | null; hackLanguage: string; inputFilename?: string | null; outputFilename?: string | null; baselineResult?: string | null; baselineScore?: number | null; candidateResult?: string | null; candidateScore?: number | null; scoreDelta?: number | null; affectedSubtaskIds?: number[]; failureStage?: string | null; message?: string | null; createdAt: string; inputData?: string | null; generatorSource?: string | null; hackSource?: string | null }
type AssetStatus = 'none' | 'draft' | 'verifying' | 'failed' | 'ready' | 'active'
interface Asset { status: AssetStatus; versionId?: string; source?: 'dsl' | 'custom' }
interface Readiness { canContribute: boolean; canHack: boolean; canManage: boolean; mode: 'acm' | 'oi'; standard: Asset; validator: Asset; classifier: Asset & { requiredForHack: boolean; requiredForPromotion: boolean }; wrongCorpus: { status: 'none' | 'bootstrap' | 'ready' }; blockers: Array<{ code: string; message: string }>; warnings: Array<{ code: string; message: string }> }
interface ContributionCase { caseId: string; name: string; status: string; stage: string; candidateId?: string; candidateStatus?: string; promotedRevisionId?: string; message?: string | null }
interface ContributionTask { jobId: string; status: string; sourceMode: string; stage: string; createdAt: string; updatedAt: string; message?: string | null; cases: ContributionCase[] }

const STATUS: Record<string, string> = { queuing: '排队中', judging: '验证与评测中', accepted: '有效 Hack', rejected: '无效 Hack', system_error: '系统错误', stale: '配置已变化' }
const FAILURE_STAGE: Record<string, string> = { input: '候选输入', generator: '数据生成器', validator: 'Validator', classifier: 'Classifier', standard: '标准程序', checker: 'Checker 自检', baseline: '原始完整评测', candidate: '加入候选点后评测', persist: '测试数据入库', stale: '配置一致性检查' }
const ASSET_LABEL: Record<AssetStatus, string> = { none: '未配置', draft: '草稿', verifying: '验证中', failed: '验证失败', ready: '待激活', active: '已激活' }
const STAGE_LABEL: Record<string, string> = { received: '已接收', generator_compile: 'Generator 编译', generator_determinism: '确定性检查', validator: 'Validator 校验', standard: 'STD 生成答案', deduplication: '重复检测', classification: 'Subtask 分类', value_evaluation: '价值评估', awaiting_classifier: '等待 Classifier', awaiting_corpus: '等待评估语料', awaiting_evaluator: '等待价值评估', candidate_pool: '已进入 Candidate Pool', completed: '处理完成', failed: '处理失败', input: '输入检查', generator: 'Generator 执行', checker: 'Checker 自检' }

export function ProblemHackPanel({ problemId, acceptedCount, languages, mode, hackEnabled, onConfigureAssets }: { problemId: string; acceptedCount: number; languages: string[]; mode: 'acm' | 'oi'; hackEnabled: boolean; onConfigureAssets?: () => void }) {
  const toast = useToast()
  const [choice, setChoice] = useState<InputChoice>('data'), [candidate, setCandidate] = useState(''), [hackSource, setHackSource] = useState(''), [hackLanguage, setHackLanguage] = useState(languages[0] || '')
  const [hackIo, setHackIo] = useState<SubmissionIoValue>({ inputFilename: null, outputFilename: null })
  const [attempts, setAttempts] = useState<Attempt[]>([]), [contributions, setContributions] = useState<ContributionTask[]>([]), [readiness, setReadiness] = useState<Readiness | null>(null)
  const [canManage, setCanManage] = useState(false), [totalAccepted, setTotalAccepted] = useState(acceptedCount), [loading, setLoading] = useState(true), [submitting, setSubmitting] = useState(false)
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null), [attemptDetails, setAttemptDetails] = useState<Record<string, Attempt>>({}), [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [hackResult, readinessResult, contributionResult] = await Promise.all([
      apiClient.get<{ attempts: Attempt[]; acceptedCount: number; canManage: boolean }>(`/api/problems/${problemId}/hacks?pageSize=50`),
      apiClient.get<Readiness>(`/api/problems/${problemId}/contribution-readiness`),
      apiClient.get<ContributionTask[]>(`/api/problems/${problemId}/contributions/mine`),
    ])
    if (hackResult.success && hackResult.data) { setAttempts(hackResult.data.attempts); setCanManage(hackResult.data.canManage); setTotalAccepted(hackResult.data.acceptedCount) }
    if (readinessResult.success && readinessResult.data) { setReadiness(readinessResult.data); setCanManage(readinessResult.data.canManage) }
    if (contributionResult.success && contributionResult.data) setContributions(contributionResult.data)
    setLoading(false)
  }, [problemId])
  useEffect(() => { load() }, [load])
  const hasActive = useMemo(() => attempts.some(item => item.status === 'queuing' || item.status === 'judging'), [attempts])
  const hasActiveContribution = useMemo(() => contributions.some(item => ['queued', 'running', 'finalizing'].includes(item.status)), [contributions])
  useEffect(() => { if (!hasActive && !hasActiveContribution) return; const timer = window.setInterval(load, 2000); return () => window.clearInterval(timer) }, [hasActive, hasActiveContribution, load])

  const readFile = async (file: File | undefined, setter: (value: string) => void, limit: number) => { if (!file) return; if (file.size > limit) return toast.error(`文件不能超过 ${limit >= 16 * 1024 * 1024 ? '16 MiB' : limit >= 1024 * 1024 ? '1 MiB' : '256 KiB'}`); setter(await file.text()) }
  const contribute = async () => {
    if (!candidate.trim()) return toast.error('请填写候选输入或 Generator 源码')
    setSubmitting(true)
    try {
      const result = choice === 'data' ? await apiClient.post<{ jobId: string }>(`/api/problems/${problemId}/candidates/data`, { name: '用户贡献', inputData: candidate }) : await apiClient.post<{ jobId: string }>(`/api/problems/${problemId}/candidates/generator`, { language: choice, source: candidate, manifest: { apiVersion: 'oj.generator/v1', protocol: 'json-stdin-v1', profiles: [{ id: 'default', params: {} }] } })
      if (!result.success) return toast.error(result.message || 'Candidate 提交失败')
      toast.success(`贡献任务 #${result.data?.jobId.slice(0, 8) || '—'} 已进入隔离队列`); setCandidate(''); await load()
    } finally { setSubmitting(false) }
  }
  const submit = async () => {
    if (!candidate.trim() || !hackSource.trim()) return toast.error('请完整填写候选输入和被 Hack 程序')
    setSubmitting(true)
    try {
      const result = await apiClient.post<Attempt>(`/api/problems/${problemId}/hacks`, { inputMode: choice === 'data' ? 'data' : 'generator', inputData: choice === 'data' ? candidate : undefined, generatorSource: choice === 'data' ? undefined : candidate, generatorLanguage: choice === 'data' ? undefined : choice, hackSource, hackLanguage, inputFilename: hackIo.inputFilename || null, outputFilename: hackIo.outputFilename || null })
      if (!result.success) return toast.error(result.message || 'Hack 提交失败')
      toast.success('Hack 已加入独立评测队列'); setCandidate(''); setHackSource(''); setHackIo({ inputFilename: null, outputFilename: null }); await load()
    } finally { setSubmitting(false) }
  }
  const retry = async (id: string) => { const result = await apiClient.post(`/api/problems/${problemId}/hacks/${id}/retry`); if (!result.success) return toast.error(result.message || '重新执行失败'); toast.success('已重新加入队列'); await load() }
  const toggleDetails = async (attempt: Attempt) => {
    if (expandedAttemptId === attempt.id) return setExpandedAttemptId(null)
    setExpandedAttemptId(attempt.id); if (attemptDetails[attempt.id]) return; setLoadingDetailId(attempt.id)
    try { const result = await apiClient.get<Attempt>(`/api/problems/${problemId}/hacks/${attempt.id}`); if (!result.success || !result.data) return toast.error(result.message || 'Hack 详情加载失败'); setAttemptDetails(current => ({ ...current, [attempt.id]: result.data! })) } finally { setLoadingDetailId(current => current === attempt.id ? null : current) }
  }
  const icon = (status: AssetStatus | 'good' | 'bad') => status === 'active' || status === 'good' ? <CheckCircle2 size={17} /> : status === 'failed' || status === 'none' || status === 'bad' ? <XCircle size={17} /> : <Circle size={17} />
  const tone = (status: AssetStatus | 'good' | 'bad') => status === 'active' || status === 'good' ? styles.ok : status === 'failed' || status === 'none' || status === 'bad' ? styles.bad : styles.pending
  const disabledReason = readiness?.blockers[0]?.message || (!candidate.trim() ? '请输入或上传候选测试数据' : '')
  const taskTimeline = (task: ContributionTask) => {
    const current = task.cases[0]?.stage || task.stage
    const steps = task.sourceMode === 'generator'
      ? ['received', 'generator_compile', 'generator_determinism', 'validator', 'standard', 'deduplication', 'classification', 'value_evaluation', 'candidate_pool']
      : ['received', 'validator', 'standard', 'deduplication', 'classification', 'value_evaluation', 'candidate_pool']
    const normalized = current === 'awaiting_classifier' ? 'classification' : current === 'awaiting_corpus' || current === 'awaiting_evaluator' ? 'value_evaluation' : current === 'completed' ? 'candidate_pool' : current
    const currentIndex = Math.max(0, steps.indexOf(normalized))
    return steps.map((stage, index) => ({ stage, state: task.status === 'failed' && index === currentIndex ? 'failed' : index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending' }))
  }

  return <div className={styles.root}>
    <div className={styles.hero}><div><h2 className={styles.title}>{hackEnabled ? `题目级 ${mode === 'oi' ? 'OI / IOI' : 'ACM'} Hack 与数据贡献` : '贡献候选测试数据'}</h2><p className={styles.description}>提交的数据不会直接修改正式测试集。候选数据将依次经过 Validator 校验、STD 验证、重复检测、分类与价值评估；Generator 还会在受限沙箱中进行确定性检查。</p></div>{hackEnabled && <span className={styles.count}>技术有效 Hack {totalAccepted} 个</span>}</div>

    {readiness && <section className={styles.readiness} aria-label="题目贡献状态"><div className={styles.readinessTitle}><strong>题目贡献状态</strong><span>{readiness.canContribute ? '前置条件已满足' : '当前暂不可贡献'}</span></div><div className={styles.readinessGrid}>{[
      { name: 'STD', status: readiness.standard.status, text: readiness.standard.status === 'active' ? '正常' : ASSET_LABEL[readiness.standard.status] },
      { name: 'Validator', status: readiness.validator.status, text: readiness.validator.status === 'active' ? `正常${readiness.validator.source === 'dsl' ? ' · DSL' : ''}` : ASSET_LABEL[readiness.validator.status] },
      { name: 'Classifier', status: readiness.mode === 'acm' ? 'ready' as const : readiness.classifier.status, text: readiness.mode === 'acm' ? 'ACM 不需要' : ASSET_LABEL[readiness.classifier.status] },
      { name: 'Wrong Corpus', status: readiness.wrongCorpus.status === 'ready' ? 'active' as const : 'ready' as const, text: readiness.wrongCorpus.status === 'ready' ? '已就绪' : readiness.wrongCorpus.status === 'bootstrap' ? '基础语料' : '未建立' },
      { name: '数据贡献', status: readiness.canContribute ? 'good' as const : 'bad' as const, text: readiness.canContribute ? '开放' : '关闭' },
    ].map(item => <div className={styles.readinessItem} key={item.name}><span className={tone(item.status)}>{icon(item.status)}</span><strong>{item.name}</strong><span>{item.text}</span></div>)}</div></section>}

    {readiness && !readiness.canContribute ? <section className={styles.blocked}><XCircle size={24} aria-hidden="true" /><div><h3>当前暂不可贡献测试数据</h3>{readiness.blockers.map(item => <p key={item.code}>{item.message}</p>)}<p>STD 用于生成标准答案，Validator 用于确认候选输入满足题目格式与约束。</p>{readiness.canManage && onConfigureAssets && <div className={styles.configureActions}><Button variant="primary" onClick={onConfigureAssets}>AI 生成 Validator</Button><Button variant="outline" onClick={onConfigureAssets}>手动配置评测资产</Button></div>}</div></section> : <div className={styles.form}>
      {readiness?.warnings.map(item => <div className={styles.notice} key={item.code}><AlertTriangle size={18} aria-hidden="true" /><span>{item.message}</span></div>)}
      <div className={styles.modeGrid} role="radiogroup" aria-label="候选输入方式">{([['data', '直接数据', '填写或上传完整输入数据'], ['cpp17', 'C++17 生成器', '程序标准输出作为候选输入'], ['python3', 'Python3 生成器', '程序标准输出作为候选输入']] as const).map(([value, title, hint]) => <Button variant="ghost" key={value} type="button" role="radio" aria-checked={choice === value} className={`${styles.mode} ${choice === value ? styles.modeActive : ''}`} onClick={() => { setChoice(value); setCandidate('') }}><span className={styles.modeTitle}>{title}</span><span className={styles.modeHint}>{hint}</span></Button>)}</div>
      <div className={styles.field}><div className={styles.labelRow}><span className={styles.label}>{choice === 'data' ? '候选输入数据' : `${choice === 'cpp17' ? 'C++17' : 'Python3'} 数据生成器`}</span><label className={styles.upload}>上传文件<Input type="file" accept={choice === 'data' ? '.in,.txt,text/plain' : choice === 'cpp17' ? '.cpp,.cc,.cxx,text/plain' : '.py,text/plain'} onChange={event => readFile(event.target.files?.[0], setCandidate, choice === 'data' ? 16 * 1024 * 1024 : 256 * 1024)} /></label></div><Textarea className={styles.textarea} spellCheck={false} value={candidate} onChange={event => setCandidate(event.target.value)} placeholder={choice === 'data' ? '填写完整输入数据…' : '填写生成器源码，程序应将一组完整输入输出到 stdout…'} /></div>
      <div className={styles.pipeline}><strong>提交后将执行</strong><span>{choice === 'data' ? 'Validator → STD → 去重 → 分类 → 价值评估' : '编译 → 沙箱运行 → 确定性检查 → Validator → STD → 去重 → 分类 → 价值评估'}</span></div>
      {hackEnabled && <><div className={styles.twoColumns}><div className={styles.field}><span className={styles.label}>被 Hack 程序语言</span><Select className={styles.select} value={hackLanguage} disabled={languages.length === 0} onChange={event => setHackLanguage(event.target.value)}>{languages.length === 0 ? <option value="">题目没有可用的本地语言</option> : languages.map(language => <option key={language} value={language}>{getLanguageLabel(language)}</option>)}</Select></div><div className={styles.warning}>技术 Hack 有效只代表候选点能改变结果；数据仍需经过 Candidate Pool，既有活动和历史成绩不会变化。</div></div><div className={styles.field}><div className={styles.labelRow}><span className={styles.label}>用于证明的被 Hack 程序</span><label className={styles.upload}>上传源码<Input type="file" accept=".c,.cc,.cpp,.cxx,.py,text/plain" onChange={event => readFile(event.target.files?.[0], setHackSource, 256 * 1024)} /></label></div><Textarea className={styles.textarea} spellCheck={false} value={hackSource} onChange={event => setHackSource(event.target.value)} placeholder={mode === 'oi' ? '填写加入候选数据后总分会下降的证明程序…' : '填写在加入候选数据前后会产生不同最终 Verdict 的程序…'} /></div><SubmissionIoFields value={hackIo} onChange={setHackIo} /></>}
      <div className={styles.submitArea}><div className={disabledReason ? styles.disabledReason : styles.readyReason}>{disabledReason || '✓ 已满足提交条件'}</div><div className={styles.submitRow}><Button variant="outline" disabled={submitting || !readiness?.canContribute || !candidate.trim()} onClick={contribute}>{submitting ? '正在提交…' : readiness?.canContribute ? hackEnabled ? '仅贡献 Candidate' : '贡献 Candidate' : '暂不可贡献'}</Button>{hackEnabled && <Button variant="ghost" className={styles.submit} disabled={submitting || hasActive || !readiness?.canHack || !candidate.trim() || !hackSource.trim() || !hackLanguage || hackIo.inputFilename === '' || hackIo.outputFilename === ''} onClick={submit}>{hasActive ? '已有 Hack 正在处理' : !readiness?.canHack ? '当前不可 Hack' : submitting ? '正在提交…' : '发起 Hack'}</Button>}</div></div>
    </div>}

    <section className={styles.contributions}><h3 className={styles.historyTitle}>{canManage ? '本题贡献任务' : '我的贡献任务'}</h3>{loading ? <div className={styles.empty}>正在加载…</div> : contributions.length === 0 ? <div className={styles.empty}>暂无贡献任务</div> : <div className={styles.taskList}>{contributions.map(task => <article className={styles.task} key={task.jobId}><div className={styles.taskHeader}><strong>贡献任务 #{task.jobId.slice(0, 8)}</strong><span>{new Date(task.createdAt).toLocaleString('zh-CN')}</span></div><div className={styles.taskStage}><span className={task.status === 'failed' ? styles.bad : ['completed', 'promoted'].includes(task.status) ? styles.ok : styles.pending}>{task.status === 'failed' ? <XCircle size={17} /> : ['completed', 'promoted'].includes(task.status) ? <CheckCircle2 size={17} /> : <Circle size={17} />}</span><strong>{STAGE_LABEL[task.cases[0]?.stage || task.stage] || task.cases[0]?.stage || task.stage}</strong>{task.message && <span>{task.message}</span>}</div><ol className={styles.timeline}>{taskTimeline(task).map(item => <li key={item.stage} className={item.state === 'done' ? styles.timelineDone : item.state === 'failed' ? styles.timelineFailed : item.state === 'current' ? styles.timelineCurrent : ''}><span>{item.state === 'done' ? '✓' : item.state === 'failed' ? '×' : '○'}</span>{STAGE_LABEL[item.stage] || item.stage}</li>)}</ol>{task.cases.length > 0 && <div className={styles.caseList}>{task.cases.map(item => <div className={styles.caseItem} key={item.caseId}><span>{item.name}</span><span>{STAGE_LABEL[item.stage] || item.stage}</span>{item.candidateId && <span>Candidate #{item.candidateId.slice(0, 8)}</span>}{item.promotedRevisionId && <span>已纳入正式版本</span>}{item.message && <span className={styles.caseMessage}>{item.message}</span>}</div>)}</div>}</article>)}</div>}</section>

    {hackEnabled && <section className={styles.history}><h3 className={styles.historyTitle}>{canManage ? '本题全部 Hack 记录' : '我的 Hack 记录'}</h3>{loading ? <div className={styles.empty}>正在加载…</div> : attempts.length === 0 ? <div className={styles.empty}>暂无 Hack 记录</div> : <div className={styles.tableWrap}><TableRoot className={styles.table}><TableHead><TableRow><TableHeaderCell>时间</TableHeaderCell>{canManage && <TableHeaderCell>用户</TableHeaderCell>}<TableHeaderCell>输入方式</TableHeaderCell><TableHeaderCell>程序语言</TableHeaderCell><TableHeaderCell>Hack 程序</TableHeaderCell><TableHeaderCell>前后 Verdict</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>失败阶段</TableHeaderCell><TableHeaderCell>说明</TableHeaderCell></TableRow></TableHead><TableBody>{attempts.map(item => { const detail = attemptDetails[item.id]; const comparison = mode === 'oi' && item.baselineScore != null ? `${item.baselineScore} → ${item.candidateScore ?? '—'}${item.scoreDelta ? `（-${item.scoreDelta}）` : ''}${item.affectedSubtaskIds?.length ? ` · S${item.affectedSubtaskIds.join(', S')}` : ''}` : item.baselineResult ? `${item.baselineResult} → ${item.candidateResult || '—'}` : '—'; return <Fragment key={item.id}><TableRow><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell>{canManage && <TableCell>{item.username || '-'}</TableCell>}<TableCell>{item.inputMode === 'data' ? '直接数据' : item.generatorLanguage}</TableCell><TableCell>{getLanguageLabel(item.hackLanguage)}</TableCell><TableCell><div className={styles.actions}><Button variant="ghost" className={styles.retry} disabled={loadingDetailId === item.id} onClick={() => toggleDetails(item)}>{loadingDetailId === item.id ? '读取中…' : expandedAttemptId === item.id ? '收起程序' : '查看程序'}</Button>{canManage && item.status === 'system_error' && <Button variant="ghost" className={styles.retry} onClick={() => retry(item.id)}>重新执行</Button>}</div></TableCell><TableCell>{comparison}</TableCell><TableCell><span className={`${styles.status} ${item.status === 'accepted' ? styles.accepted : item.status === 'rejected' ? styles.rejected : item.status === 'system_error' || item.status === 'stale' ? styles.error : ''}`}>{STATUS[item.status] || item.status}</span></TableCell><TableCell>{item.failureStage ? FAILURE_STAGE[item.failureStage] || item.failureStage : '—'}</TableCell><TableCell title={item.message || ''}>{item.message || '—'}</TableCell></TableRow>{expandedAttemptId === item.id && <TableRow><TableCell colSpan={canManage ? 9 : 8} className={styles.detailCell}>{detail ? <div className={styles.detailGrid}><section><strong>{detail.inputMode === 'data' ? '候选输入' : `${detail.generatorLanguage} 生成器`}</strong><pre>{detail.inputMode === 'data' ? detail.inputData : detail.generatorSource}</pre></section><section><strong>被 Hack 程序（{getLanguageLabel(detail.hackLanguage)}）</strong><div className={styles.programIo}>输入：{detail.inputFilename || 'stdin'} · 输出：{detail.outputFilename || 'stdout'}</div><pre>{detail.hackSource}</pre></section></div> : <div className={styles.detailLoading}><span className={[('resource-skeleton-line'), collisionStyles.u1].filter(Boolean).join(' ')} aria-label="Hack 详情正在准备" /></div>}</TableCell></TableRow>}</Fragment> })}</TableBody></TableRoot></div>}</section>}
  </div>
}
