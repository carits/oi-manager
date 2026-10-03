'use client'

import { getLanguageLabel } from '@/lib/judge-constants'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpenCheck, FileClock, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import { DetailDialog, FormDialog } from '@/components/ui/Dialogs'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'
import {
  canEditSolutionContribution,
  isFullSolutionType,
  reviewActionsForStatus,
  SOLUTION_TYPE_LABELS,
  solutionReviewDecisionLabel,
  solutionReviewTypeLabel,
  solutionStatusLabel,
  solutionSubmissionAction,
  solutionVerificationLabel,
  type SolutionDraftLike,
  type SolutionType,
  validateSolutionDraft,
} from '../model/solution-editorial'
import styles from './SolutionEditorialPanel.module.css'
import {
  acceptSolutionContribution,
  createSolutionContribution,
  createSolutionCorrection,
  getProblemSolution,
  getSimilarityComparison,
  getSolutionContribution,
  listMySolutionContributions,
  listProblemSolutions,
  listSolutionReviewQueue,
  publishSolutionContribution,
  recordSolutionReview,
  refreshSolutionContributionVerification,
  rejectSolutionContribution,
  requestSolutionRevision,
  resubmitSolutionContribution,
  retrySolutionSimilarity,
  submitSolutionContribution,
  updateSolutionContribution,
} from '@/features/solution-review/api/solutionReviewApi'
import type {
  ProblemSolution as Solution,
  ProblemSolutionVersion as Version,
  SimilarityComparison,
  SolutionContribution as Contribution,
} from '@oi-manager/contracts'

type Draft = SolutionDraftLike & {
  summary: string; algorithmTagsText: string; approachKey: string; organizationAttributed: boolean
}

const EMPTY_DRAFT: Draft = {
  type: 'COMMUNITY_EDITORIAL', title: '', summary: '', contentMarkdown: '', algorithmTagsText: '', approachKey: '',
  complexityTime: '', complexityMemory: '', language: 'cpp', referenceCode: '', sourceType: 'ORIGINAL', sourceUrl: '', citation: '',
  licenseAccepted: false, organizationAttributed: false,
}

function tags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function latestVerification(item: Contribution) {
  return item.Revisions?.[0]?.Verification || null
}

function latestSimilarity(item: Contribution) {
  return item.Revisions?.[0]?.SimilarityCheck || null
}

function latestSimilarityJob(item: Contribution) { return item.Revisions?.[0]?.SimilarityJob || null }
const SIMILARITY_JOB_LABELS: Record<string, string> = { QUEUED: '等待检查', RUNNING: '检查中', READY: '已完成', FAILED: '检查失败' }
const similarityJobStatusLabel = (status: string) => SIMILARITY_JOB_LABELS[status] || '检查状态待确认'

function statusTone(status: string) {
  if (['PUBLISHED', 'ACCEPTED', 'TECHNICALLY_VALID', 'PASSED', 'SKIPPED'].includes(status)) return 'success'
  if (['NEEDS_REVISION', 'FAILED', 'INFRA_ERROR', 'REJECTED'].includes(status)) return 'warning'
  return undefined
}

export function SolutionEditorialPanel({ problemId, canManage }: { problemId: string; canManage: boolean }) {
  const { user } = useAuth()
  const toast = useToast()
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [queue, setQueue] = useState<Contribution[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSolution, setSelectedSolution] = useState<Solution | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Contribution | null>(null)
  const [correctionTarget, setCorrectionTarget] = useState<{ solutionId: string; versionId: string } | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewing, setReviewing] = useState<Contribution | null>(null)
  const [reviewAction, setReviewAction] = useState<'approve' | 'request-revision' | 'reject' | null>(null)
  const [reviewType, setReviewType] = useState('CONTENT')
  const [reviewComment, setReviewComment] = useState('')
  const [publishing, setPublishing] = useState<Contribution | null>(null)
  const [visibilityPolicy, setVisibilityPolicy] = useState('PUBLIC')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [comparison, setComparison] = useState<SimilarityComparison | null>(null)
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [comparisonLoading, setComparisonLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [published, mine, pending] = await Promise.allSettled([
      listProblemSolutions(problemId),
      listMySolutionContributions(problemId),
      canManage ? listSolutionReviewQueue() : Promise.resolve([]),
    ])
    if (published.status === 'fulfilled') setSolutions(published.value)
    else toast.error(publicErrorMessage(published.reason, '读取题解失败'))
    if (mine.status === 'fulfilled') setContributions(mine.value)
    else toast.error(publicErrorMessage(mine.reason, '读取我的投稿失败'))
    if (pending.status === 'fulfilled') setQueue(pending.value.filter(item => item.problemId === problemId))
    else toast.error(publicErrorMessage(pending.reason, '读取审核队列失败'))
    setLoading(false)
  // Toast actions close over a stable provider callback. Keeping them out of
  // the resource key prevents a toast render from re-triggering all reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, problemId])

  useEffect(() => { void load() }, [load])

  const openSolution = async (item: Solution) => {
    setBusyId(item.id)
    try {
      const result = await getProblemSolution(item.id)
      setSelectedSolution(result)
      setSelectedVersion(result.CurrentVersion)
    } catch (reason) {
      toast.error(publicErrorMessage(reason, '读取题解版本失败'))
    } finally {
      setBusyId(null)
    }
  }

  const openNew = () => {
    setEditing(null); setCorrectionTarget(null)
    setDraft({ ...EMPTY_DRAFT, organizationAttributed: Boolean(user?.organizationId) })
    setEditorOpen(true)
  }

  const openEdit = (item: Contribution) => {
    setEditing(item); setCorrectionTarget(null)
    setDraft({
      type: item.type, title: item.title, summary: item.summary || '', contentMarkdown: item.contentMarkdown,
      algorithmTagsText: tags(item.algorithmTags).join(', '), approachKey: item.approachKey || '',
      complexityTime: item.complexityTime || '', complexityMemory: item.complexityMemory || '', language: item.language || 'cpp',
      referenceCode: item.referenceCode || '', sourceType: item.sourceType, sourceUrl: item.sourceUrl || '', citation: item.citation || '',
      licenseAccepted: true, organizationAttributed: Boolean(item.organizationId),
    })
    setEditorOpen(true)
  }

  const openCorrection = () => {
    if (!selectedSolution || !selectedVersion) return
    setEditing(null); setCorrectionTarget({ solutionId: selectedSolution.id, versionId: selectedVersion.id })
    setDraft({ ...EMPTY_DRAFT, type: 'CORRECTION', title: `纠正：${selectedVersion.title}`, sourceType: 'ORIGINAL', organizationAttributed: Boolean(user?.organizationId) })
    setEditorOpen(true)
  }

  const payload = useMemo(() => ({
    type: draft.type, title: draft.title.trim(), summary: draft.summary.trim() || null,
    contentMarkdown: draft.contentMarkdown, algorithmTags: draft.algorithmTagsText.split(/[,，]/).map(item => item.trim()).filter(Boolean),
    approachKey: draft.approachKey.trim().toLowerCase() || null, complexityTime: draft.complexityTime?.trim() || null,
    complexityMemory: draft.complexityMemory?.trim() || null, language: draft.language?.trim() || null,
    referenceCode: draft.referenceCode || null, sourceType: draft.sourceType, sourceUrl: draft.sourceUrl?.trim() || null,
    citation: draft.citation?.trim() || null, licenseAccepted: draft.licenseAccepted,
    organizationId: draft.organizationAttributed ? user?.organizationId : null,
    ...(correctionTarget ? { baseVersionId: correctionTarget.versionId } : {}),
  }), [correctionTarget, draft, user?.organizationId])

  const saveDraft = async () => {
    const message = validateSolutionDraft(draft)
    if (message) return toast.warning(message)
    setSaving(true)
    const result = editing
      ? await updateSolutionContribution(editing.id, payload)
      : correctionTarget
        ? await createSolutionCorrection(correctionTarget.solutionId, { ...payload, type: 'CORRECTION' })
        : await createSolutionContribution(problemId, payload)
    setSaving(false)
    if (!result.ok) return toast.error(result.error.userMessage || '保存失败')
    toast.success(editing ? '草稿已更新' : '投稿草稿已创建')
    setEditorOpen(false); await load()
  }

  const runContributionAction = async (item: Contribution, action: 'submit' | 'resubmit' | 'verification/refresh') => {
    setBusyId(item.id)
    const result = action === 'submit'
      ? await submitSolutionContribution(item.id)
      : action === 'resubmit'
        ? await resubmitSolutionContribution(item.id)
        : await refreshSolutionContributionVerification(item.id)
    setBusyId(null)
    if (!result.ok) return toast.error(result.error.userMessage || '操作失败')
    toast.success(action === 'verification/refresh' ? '验证状态已刷新' : '投稿已送审，当前版本已冻结')
    await load()
  }

  const openReview = async (item: Contribution) => {
    setBusyId(item.id)
    try {
      const result = await getSolutionContribution(item.id)
      setReviewing({ ...result, Author: item.Author })
      setReviewOpen(true)
    } catch (reason) {
      toast.error(publicErrorMessage(reason, '读取投稿失败'))
    } finally {
      setBusyId(null)
    }
  }

  const submitReview = async () => {
    if (!reviewing || !reviewAction) return
    if (reviewAction !== 'approve' && reviewComment.trim().length < 10) return toast.warning('要求修改或拒绝时，请填写至少 10 个字符的说明')
    setBusyId(reviewing.id)
    const body = { reviewType: reviewType as 'TECHNICAL' | 'CONTENT' | 'COPYRIGHT', comment: reviewComment.trim() }
    const result = reviewAction === 'approve'
      ? await recordSolutionReview(reviewing.id, { ...body, decision: 'APPROVE', comment: body.comment || null })
      : reviewAction === 'request-revision'
        ? await requestSolutionRevision(reviewing.id, body)
        : await rejectSolutionContribution(reviewing.id, body)
    setBusyId(null)
    if (!result.ok) return toast.error(result.error.userMessage || '审核操作失败')
    toast.success(reviewAction === 'approve' ? '审核已通过，可继续采纳' : reviewAction === 'reject' ? '投稿已拒绝' : '已要求作者修改')
    setReviewAction(null); setReviewComment(''); setReviewOpen(false); await load()
  }

  const accept = async (item: Contribution) => {
    setBusyId(item.id)
    const result = await acceptSolutionContribution(item.id)
    setBusyId(null)
    if (!result.ok) return toast.error(result.error.userMessage || '采纳失败')
    toast.success('投稿已采纳，发布前仍不会对读者可见'); setReviewOpen(false); await load()
  }

  const retrySimilarity = async (item: Contribution) => {
    setBusyId(item.id)
    const result = await retrySolutionSimilarity(item.id)
    setBusyId(null)
    if (!result.ok) return toast.error(result.error.userMessage || '相似度检查重试失败')
    toast.success('相似度检查已重新排队')
    setReviewOpen(false); await load()
  }

  const openComparison = async (item: Contribution) => {
    setComparisonLoading(true)
    let result: SimilarityComparison
    try {
      result = await getSimilarityComparison(item.id)
    } catch (reason) {
      setComparisonLoading(false)
      return toast.error(publicErrorMessage(reason, '读取相似片段失败'))
    }
    setComparisonLoading(false)
    setComparison(result); setComparisonOpen(true)
  }

  const publish = async () => {
    if (!publishing) return
    setBusyId(publishing.id)
    const result = await publishSolutionContribution(publishing.id, {
      visibilityPolicy: visibilityPolicy as 'PUBLIC' | 'AFTER_AC' | 'MANAGER_ONLY',
    })
    setBusyId(null)
    if (!result.ok) return toast.error(result.error.userMessage || '发布失败')
    toast.success('新题解版本已发布'); setPublishing(null); setReviewOpen(false); await load()
  }

  const currentVersion = selectedVersion || selectedSolution?.CurrentVersion

  return <div className={styles.root}>
    <section className={styles.section}>
      <div className={styles.header}><div><h3>版本化题解</h3><p>已发布内容可阅读；每次纠错发布都会保留当时发布的历史版本。</p></div><Button icon={<Plus size={16} />} onClick={openNew}>贡献题解</Button></div>
      {loading ? <div className={styles.empty}>正在读取题解…</div> : solutions.length === 0 ? <div className={styles.empty}><p>暂无已发布的版本化题解，你可以成为第一位贡献者。</p></div> : <div className={styles.grid}>{solutions.map(item => <Button variant="ghost" className={styles.card} data-selected={selectedSolution?.id === item.id} key={item.id} onClick={() => void openSolution(item)} disabled={busyId === item.id}><div className={styles.badges}><span className={styles.badge}>{SOLUTION_TYPE_LABELS[item.type]}</span>{item.primary && <span className={styles.badge} data-tone="success">主解</span>}{item.recommended && <span className={styles.badge}>推荐</span>}</div><h4>{item.title}</h4><p className={styles.meta}>作者：{item.Author?.username || '匿名贡献者'} · V{item.CurrentVersion.version} · {item.visibilityPolicy === 'PUBLIC' ? '公开' : item.visibilityPolicy === 'AFTER_AC' ? 'AC 后可见' : '仅管理员'}</p></Button>)}</div>}
      {selectedSolution && currentVersion && <div className={styles.reader}>
        <div className={styles.readerHead}><div><div className={styles.badges}><span className={styles.badge} data-tone="success">只读版本 V{currentVersion.version}</span><span className={styles.badge}>{currentVersion.sourceType === 'ORIGINAL' ? '原创' : '含引用/授权来源'}</span></div><h3>{currentVersion.title}</h3></div><div className={styles.actions}>{(selectedSolution.Versions?.length || 0) > 1 && <Select aria-label="历史版本" className={styles.versionPicker} value={currentVersion.id} onChange={event => setSelectedVersion(selectedSolution.Versions?.find(version => version.id === event.target.value) || selectedSolution.CurrentVersion)}>{selectedSolution.Versions?.map(version => <option key={version.id} value={version.id}>V{version.version} · {version.status === 'PUBLISHED' ? '当前发布版' : '历史版本'}</option>)}</Select>}<Button variant="outline" icon={<FileClock size={16} />} onClick={openCorrection}>报告纠错</Button></div></div>
        <div className={styles.facts}>{currentVersion.complexityTime && <span>时间：{currentVersion.complexityTime}</span>}{currentVersion.complexityMemory && <span>空间：{currentVersion.complexityMemory}</span>}{currentVersion.language && <span>语言：{getLanguageLabel(currentVersion.language)}</span>}{tags(currentVersion.algorithmTags).map(tag => <span key={tag}>#{tag}</span>)}</div>
        <MarkdownRenderer content={currentVersion.contentMarkdown} />
        {currentVersion.referenceCode && <pre className={styles.code}><code>{currentVersion.referenceCode}</code></pre>}
        {(currentVersion.sourceUrl || currentVersion.citation) && <div className={styles.hint}>来源：{currentVersion.sourceUrl ? <a href={currentVersion.sourceUrl} target="_blank" rel="noreferrer">{currentVersion.sourceUrl}</a> : currentVersion.citation}</div>}
      </div>}
    </section>

    <section className={styles.section}>
      <div className={styles.header}><div><h3>我的投稿</h3><p>送审会保留本次送审内容；需修改时编辑草稿后重投。</p></div><Button variant="ghost" icon={<RefreshCw size={15} />} onClick={() => void load()}>刷新</Button></div>
      {contributions.length === 0 ? <div className={styles.empty}>尚无投稿草稿</div> : <div className={styles.grid}>{contributions.map(item => {
        const verification = latestVerification(item); const submissionAction = solutionSubmissionAction(item.status)
        return <article className={styles.card} key={item.id}><div className={styles.badges}><span className={styles.badge}>{SOLUTION_TYPE_LABELS[item.type]}</span><span className={styles.badge} data-tone={statusTone(item.status)}>{solutionStatusLabel(item.status)}</span>{verification && <span className={styles.badge} data-tone={statusTone(verification.status)}>验证：{solutionVerificationLabel(verification.status)}</span>}</div><h4>{item.title}</h4><p className={styles.meta}>最近保存于 {new Date(item.updatedAt).toLocaleString()}</p>{verification?.errorMessage && <p className={styles.error}>自动检查未通过，请修改内容后重试。</p>}<div className={styles.actions}>{canEditSolutionContribution(item.status) && <Button size="sm" variant="outline" onClick={() => openEdit(item)}>编辑</Button>}{submissionAction && <Button size="sm" loading={busyId === item.id} onClick={() => void runContributionAction(item, submissionAction)}>{submissionAction === 'submit' ? '提交审核' : '重新提交'}</Button>}{['AUTO_CHECKING', 'SUBMITTED'].includes(item.status) && <Button size="sm" variant="ghost" loading={busyId === item.id} onClick={() => void runContributionAction(item, 'verification/refresh')}>刷新验证</Button>}</div></article>
      })}</div>}
    </section>

    {canManage && <section className={styles.section}>
      <div className={styles.header}><div><h3>题目审核队列</h3><p>仅显示本题待审核、待采纳或待发布的他人投稿。</p></div><ShieldCheck size={20} aria-hidden="true" /></div>
      {queue.length === 0 ? <div className={styles.empty}>当前没有待处理投稿</div> : <div className={styles.grid}>{queue.map(item => <Button variant="ghost" className={styles.card} key={item.id} onClick={() => void openReview(item)} disabled={busyId === item.id}><div className={styles.badges}><span className={styles.badge} data-tone={statusTone(item.status)}>{solutionStatusLabel(item.status)}</span><span className={styles.badge}>{SOLUTION_TYPE_LABELS[item.type]}</span></div><h4>{item.title}</h4><p className={styles.meta}>作者：{item.Author?.username || '未知'} · {new Date(item.updatedAt).toLocaleString()}</p></Button>)}</div>}
    </section>}

    <FormDialog isOpen={editorOpen} onClose={() => setEditorOpen(false)} onSubmit={() => void saveDraft()} title={editing ? '编辑投稿草稿' : correctionTarget ? '发起纠错投稿' : '贡献题解'} description="保存只创建或更新草稿；请回到“我的投稿”主动送审。" size="xl" submitText="保存草稿" loading={saving} dirty={Boolean(draft.title || draft.contentMarkdown)}>
      <div className={styles.form}><div className={styles.formGrid}>
        <label className={styles.field}>投稿类型<Select value={draft.type} disabled={Boolean(correctionTarget)} onChange={event => setDraft(value => ({ ...value, type: event.target.value as SolutionType }))}>{Object.entries(SOLUTION_TYPE_LABELS).filter(([type]) => !['CORRECTION', 'TRANSLATION'].includes(type) || type === draft.type).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
        <label className={styles.field}>标题<Input value={draft.title} maxLength={160} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></label>
        <label className={styles.field}>方案标识（可选）<Input value={draft.approachKey} placeholder="例如 two_pointers" onChange={event => setDraft(value => ({ ...value, approachKey: event.target.value.toLowerCase() }))} /></label>
        <label className={styles.field}>算法标签（逗号分隔）<Input value={draft.algorithmTagsText} placeholder="动态规划, 前缀和" onChange={event => setDraft(value => ({ ...value, algorithmTagsText: event.target.value }))} /></label>
        <label className={`${styles.field} ${styles.wide}`}>摘要（可选）<Textarea rows={2} value={draft.summary} onChange={event => setDraft(value => ({ ...value, summary: event.target.value }))} /></label>
        <div className={`${styles.field} ${styles.wide}`}>正文<MarkdownEditor value={draft.contentMarkdown} onChange={contentMarkdown => setDraft(value => ({ ...value, contentMarkdown }))} minHeight="260px" /></div>
        {isFullSolutionType(draft.type) && <><label className={styles.field}>时间复杂度<Input value={draft.complexityTime || ''} placeholder="O(n log n)" onChange={event => setDraft(value => ({ ...value, complexityTime: event.target.value }))} /></label><label className={styles.field}>空间复杂度<Input value={draft.complexityMemory || ''} placeholder="O(n)" onChange={event => setDraft(value => ({ ...value, complexityMemory: event.target.value }))} /></label><label className={styles.field}>参考代码语言<Input value={draft.language || ''} placeholder="cpp" onChange={event => setDraft(value => ({ ...value, language: event.target.value }))} /></label><label className={`${styles.field} ${styles.wide}`}>参考代码<Textarea rows={10} value={draft.referenceCode || ''} onChange={event => setDraft(value => ({ ...value, referenceCode: event.target.value }))} /></label></>}
        <label className={styles.field}>内容来源<Select value={draft.sourceType} onChange={event => setDraft(value => ({ ...value, sourceType: event.target.value as Draft['sourceType'] }))}><option value="ORIGINAL">原创</option><option value="DERIVED">派生改写</option><option value="TRANSLATED">翻译</option><option value="AUTHORIZED">已获授权</option></Select></label>
        <label className={styles.field}>来源链接（非原创）<Input type="url" value={draft.sourceUrl || ''} onChange={event => setDraft(value => ({ ...value, sourceUrl: event.target.value }))} /></label>
        <label className={`${styles.field} ${styles.wide}`}>引用或授权说明<Textarea rows={3} value={draft.citation || ''} onChange={event => setDraft(value => ({ ...value, citation: event.target.value }))} /></label>
      </div>
      {user?.organizationId && <Checkbox checked={draft.organizationAttributed} onChange={event => setDraft(value => ({ ...value, organizationAttributed: event.target.checked }))} label={`归因到当前组织：${user.organizationName || '当前学校'}`} description="发布奖励将保留这一投稿时选择的组织归因。" />}
      <Checkbox checked={draft.licenseAccepted} onChange={event => setDraft(value => ({ ...value, licenseAccepted: event.target.checked }))} label="我确认内容为原创或已取得授权，并接受当前投稿声明" />
      </div>
    </FormDialog>

    <DetailDialog isOpen={reviewOpen} onClose={() => setReviewOpen(false)} title="审核题解投稿" description={reviewing ? `${reviewing.title} · ${solutionStatusLabel(reviewing.status)}` : undefined} size="xl" footer={reviewing && <div className={styles.actions}>{latestSimilarityJob(reviewing)?.status === 'FAILED' && <Button variant="outline" onClick={() => void retrySimilarity(reviewing)} loading={busyId === reviewing.id}>重试相似度检查</Button>}{reviewActionsForStatus(reviewing.status).map(action => action === 'accept' ? <Button key={action} onClick={() => void accept(reviewing)} loading={busyId === reviewing.id}>采纳</Button> : action === 'publish' ? <Button key={action} onClick={() => setPublishing(reviewing)}>发布</Button> : <Button key={action} variant={action === 'reject' ? 'danger' : action === 'request-revision' ? 'outline' : 'primary'} disabled={latestSimilarityJob(reviewing)?.status !== 'READY'} onClick={() => { setReviewAction(action); setReviewComment('') }}>{action === 'approve' ? '审核通过' : action === 'reject' ? '拒绝' : '要求修改'}</Button>)}</div>}>
      {reviewing && <div className={styles.form}>
        <div className={styles.badges}><span className={styles.badge}>{SOLUTION_TYPE_LABELS[reviewing.type]}</span><span className={styles.badge}>作者：{reviewing.Author?.username || '未知'}</span>{latestVerification(reviewing) && <span className={styles.badge} data-tone={statusTone(latestVerification(reviewing)!.status)}>验证：{solutionVerificationLabel(latestVerification(reviewing)!.status)}</span>}{latestSimilarityJob(reviewing) && <span className={styles.badge} data-tone={statusTone(latestSimilarityJob(reviewing)!.status)}>相似度：{similarityJobStatusLabel(latestSimilarityJob(reviewing)!.status)}</span>}</div>
        {latestSimilarityJob(reviewing) && latestSimilarityJob(reviewing)!.status !== 'READY' && <div className={styles.hint}>{latestSimilarityJob(reviewing)!.status === 'FAILED' ? '相似度检查失败，必须重试成功后才能审核。' : '相似度检查正在异步执行，完成前不能提交审核结论。'}</div>}
        {latestSimilarity(reviewing) && <section className={styles.similarity} data-risk={latestSimilarity(reviewing)!.riskLevel}><div><strong>内容相似度风险：{latestSimilarity(reviewing)!.riskLevel === 'HIGH' ? '高' : latestSimilarity(reviewing)!.riskLevel === 'MEDIUM' ? '中' : '低'}</strong><p>该结果仅作为审核提示，不会自动拒绝投稿。{latestSimilarity(reviewing)!.sourceDeclared ? '投稿已声明来源。' : '投稿未声明外部来源。'}</p></div>{latestSimilarity(reviewing)!.maximumSimilarityBasisPoints !== undefined && <dl><div><dt>正文</dt><dd>{((latestSimilarity(reviewing)!.textSimilarityBasisPoints || 0) / 100).toFixed(1)}%</dd></div><div><dt>代码</dt><dd>{((latestSimilarity(reviewing)!.codeSimilarityBasisPoints || 0) / 100).toFixed(1)}%</dd></div><div><dt>最高</dt><dd>{((latestSimilarity(reviewing)!.maximumSimilarityBasisPoints || 0) / 100).toFixed(1)}%</dd></div></dl>}<Button variant="outline" loading={comparisonLoading} onClick={() => void openComparison(reviewing)}>并排查看相似片段</Button></section>}
        <MarkdownRenderer content={reviewing.Revisions?.[0]?.contentMarkdown || reviewing.contentMarkdown} />
        {(reviewing.Revisions?.[0]?.referenceCode || reviewing.referenceCode) && <pre className={styles.code}><code>{reviewing.Revisions?.[0]?.referenceCode || reviewing.referenceCode}</code></pre>}
        <div className={styles.timeline}>{reviewing.Reviews?.map(review => <div className={styles.timelineItem} key={review.id}><strong>{review.Reviewer?.username || '审核者'} · {solutionReviewTypeLabel(review.reviewType)} · {solutionReviewDecisionLabel(review.decision)}</strong>{review.comment && <p>{review.comment}</p>}</div>)}</div>
      </div>}
    </DetailDialog>

    <DetailDialog isOpen={comparisonOpen} onClose={() => setComparisonOpen(false)} title="相似内容并排对照" description={comparison?.source ? `${comparison.source.title} · V${comparison.source.version} · ${comparison.source.author?.username || '未知作者'}` : '没有可展示的匹配来源'} size="wide">
      {comparison?.matches.length ? <div className={styles.comparisonList}>{comparison.matches.map((match, index) => <section key={`${match.kind}-${index}`}><header><strong>{match.kind === 'code' ? '代码片段' : '正文段落'}</strong><span>局部相似度 {(match.similarityBasisPoints / 100).toFixed(1)}%</span></header><div><pre><mark>{match.left.text}</mark></pre><pre><mark>{match.right.text}</mark></pre></div></section>)}</div> : <div className={styles.empty}>当前匹配来源没有达到展示阈值的局部片段。</div>}
    </DetailDialog>

    <FormDialog isOpen={Boolean(reviewAction)} onClose={() => setReviewAction(null)} onSubmit={() => void submitReview()} title={reviewAction === 'approve' ? '确认审核通过' : reviewAction === 'reject' ? '拒绝投稿' : '要求作者修改'} submitText="确认" danger={reviewAction === 'reject'} loading={Boolean(reviewing && busyId === reviewing.id)}>
      <div className={styles.form}><label className={styles.field}>审核类型<Select value={reviewType} onChange={event => setReviewType(event.target.value)}><option value="CONTENT">内容</option><option value="TECHNICAL">技术</option><option value="COPYRIGHT">版权</option></Select></label><label className={styles.field}>审核意见{reviewAction !== 'approve' && '（至少 10 个字符）'}<Textarea rows={5} value={reviewComment} onChange={event => setReviewComment(event.target.value)} /></label></div>
    </FormDialog>

    <FormDialog isOpen={Boolean(publishing)} onClose={() => setPublishing(null)} onSubmit={() => void publish()} title="发布已采纳题解" description="发布将创建不可变题解版本，并按后端规则幂等奖励贡献者。" submitText="确认发布" loading={Boolean(publishing && busyId === publishing.id)}>
      <label className={styles.field}>可见范围<Select value={visibilityPolicy} onChange={event => setVisibilityPolicy(event.target.value)}><option value="PUBLIC">公开</option><option value="AFTER_AC">仅 AC 后可见</option><option value="MANAGER_ONLY">仅题目管理员</option></Select></label>
    </FormDialog>
  </div>
}
