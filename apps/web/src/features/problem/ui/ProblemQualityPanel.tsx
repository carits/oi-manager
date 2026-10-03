'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input, Textarea } from '@/components/ui/FormControls'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { useToast } from '@/components/ui/Toast'
import {
  createProblemSolutionProfile,
  getProblemQualityDashboard,
  requestProblemQualityEvaluation,
  runAutomatedProblemQuality,
  submitExpertProblemQuality,
  updateProblemSolutionProfile,
} from '../api/problemQualityApi'
import { displayScore, qualityJobPresentation, qualityStatusPresentation, type QualityStatus } from '../model/problem-quality-display'
import { judgeResultLabel } from '@/lib/judge-constants'
import styles from './ProblemQualityPanel.module.css'

type EvidenceIssue = { code: string; message: string }
type QualityEvidence = {
  pinnedInputs?: Record<string, unknown>
  gates?: Record<string, boolean>
  criticalIssues?: EvidenceIssue[]
  warnings?: EvidenceIssue[]
  scoring?: {
    solutionProfileAlignment?: number | null
    evaluatedSolutionProfileCount?: number
    solutionProfileCount?: number
  }
}
type QualitySnapshot = {
  id: string
  slot: 'STABLE' | 'EVOLVING'
  graphHash: string
  qualityRuleVersion: string
  correctnessScore: number
  discriminationScore: number
  coverageScore: number
  diversityScore: number
  subtaskQualityScore: number
  stabilityScore: number
  overallScore: number | null
  confidenceScore: number
  confidenceLevel: string
  maturityLevel: string
  wrongProgramCount: number
  behaviorClusterCount: number
  evaluationClusterCount: number
  holdoutClusterCount: number
  weightedKillCoverage: number
  evaluationCoverage: number
  holdoutCoverage: number
  featureCoverage: number
  criticalFeatureCoverage: number
  realSubmissionCount: number
  validHackCount: number
  criticalIssueCount: number
  warningCount: number
  qualityStatus: QualityStatus
  createdAt: string
  isStale?: boolean
  reasons?: string[]
  evidence?: QualityEvidence
}
type QualityJob = {
  id: string
  slot: 'STABLE' | 'EVOLVING'
  graphHash: string
  corpusRevisionId: string
  qualityRuleVersion: string
  status: string
  attempts: number
  errorCode?: string | null
  errorMessage?: string | null
  queuedAt: string
  startedAt?: string | null
  finishedAt?: string | null
}
type ProblemQuality = {
  id: string
  status: string
  statementScore: number
  solutionCorrectnessScore: number
  algorithmicValueScore?: number | null
  difficultyDesignScore: number
  constraintDesignScore: number
  subtaskDesignScore: number
  editorialScore?: number | null
  originalityScore?: number | null
  automatedScore: number
  expertScore?: number | null
  overallScore?: number | null
  confidenceScore: number
  confidenceLevel: string
  automatedEvidence?: Record<string, unknown>
  expertEvidence?: Record<string, unknown>
  evaluatedAt: string
  reviewedAt?: string | null
  isStale?: boolean
  staleReasons?: string[]
}
type SolutionProfile = {
  id: string
  key: string
  name: string
  expectedClass: string
  expectedComplexity?: string | null
  expectedScoreMin: number
  expectedScoreMax: number
  expectedSubtaskScores: Array<{ subtaskId: number; min: number; max: number }>
  submissionId: number
  revision: number
  status: 'active' | 'retired'
  observed?: { evaluatedSlot?: 'STABLE' | 'EVOLVING' | null; evaluatedGraphHash?: string | null; result?: string | null; score?: number | null; subtasks: Array<{ subtaskId: number; score: number }> } | null
}
type QualityDashboard = {
  permissions: { canManage: boolean; canExpertReview: boolean }
  stableTestSet?: { graphHash: string; fencingToken: number; updatedAt: string } | null
  testSetQuality?: QualitySnapshot | null
  problemQuality?: ProblemQuality | null
  jobs?: QualityJob[]
  qualityHistory?: QualitySnapshot[]
  solutionProfiles?: SolutionProfile[]
}

const DQS_PARTS: Array<{ key: keyof QualitySnapshot; label: string; maximum: number }> = [
  { key: 'correctnessScore', label: '正确性', maximum: 30 },
  { key: 'discriminationScore', label: '区分能力', maximum: 25 },
  { key: 'coverageScore', label: '语义覆盖', maximum: 15 },
  { key: 'diversityScore', label: '数据多样性', maximum: 10 },
  { key: 'subtaskQualityScore', label: '分组设计', maximum: 10 },
  { key: 'stabilityScore', label: '稳定性', maximum: 10 },
]

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function confidenceLabel(value: string) {
  if (value === 'HIGH') return '高'
  if (value === 'MEDIUM') return '中'
  if (value === 'LOW') return '低'
  return '待确认'
}

function maturityLabel(value: string) {
  if (value === 'MATURE') return '成熟'
  if (value === 'GROWING') return '持续完善'
  if (value === 'EARLY') return '初步可用'
  return '待确认'
}

function qualityConclusion(snapshot: QualitySnapshot) {
  if (snapshot.isStale) return { title: '需要重新检查', description: '题目或测试数据已变化，当前结论不再适用。', variant: 'warning' as const }
  if (snapshot.criticalIssueCount > 0 || snapshot.overallScore === null) return { title: '暂不建议用于正式比赛', description: '数据存在必须先解决的正确性或稳定性问题。', variant: 'error' as const }
  if (snapshot.overallScore >= 85 && snapshot.confidenceScore >= 70) return { title: '数据质量良好', description: '当前版本已通过主要质量检查，可用于正式训练或比赛。', variant: 'success' as const }
  if (snapshot.overallScore >= 70) return { title: '可用，但建议继续完善', description: '数据已具备基本可用性，仍有覆盖或区分度提升空间。', variant: 'warning' as const }
  return { title: '建议补充数据后再发布', description: '当前版本的覆盖和区分能力不足，请优先处理下方提示。', variant: 'warning' as const }
}

export function ProblemQualityPanel({ problemId }: { problemId: string }) {
  const toast = useToast()
  const [data, setData] = useState<QualityDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [expertOpen, setExpertOpen] = useState(false)
  const [algorithmicValueScore, setAlgorithmicValueScore] = useState('')
  const [editorialScore, setEditorialScore] = useState('')
  const [originalityScore, setOriginalityScore] = useState('')
  const [comment, setComment] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileClass, setProfileClass] = useState('')
  const [profileComplexity, setProfileComplexity] = useState('')
  const [profileScoreMin, setProfileScoreMin] = useState('')
  const [profileScoreMax, setProfileScoreMax] = useState('')
  const [profileSubmissionId, setProfileSubmissionId] = useState('')

  const load = useCallback(async () => {
    try { setData(await getProblemQualityDashboard(problemId) as QualityDashboard) }
    catch (error) { toast.error(publicErrorMessage(error, '质量评估加载失败')) }
    setLoading(false)
  }, [problemId, toast])

  useEffect(() => { void load() }, [load])
  const pending = useMemo(() => data?.jobs?.some(job => ['QUEUED', 'RUNNING'].includes(job.status)) || false, [data?.jobs])
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => { void load() }, 2500)
    return () => window.clearInterval(timer)
  }, [pending, load])

  const triggerDqs = async () => {
    if (!data?.stableTestSet) return toast.error('题目尚无可用于正式评测的数据')
    setBusy(true)
    try {
      const result = await requestProblemQualityEvaluation(problemId, 'STABLE')
      if (!result.ok) return toast.error(result.error.userMessage || '质量评估入队失败')
      toast.success('质量评估已加入队列')
      await load()
    } finally { setBusy(false) }
  }

  const runPqs = async () => {
    setBusy(true)
    try {
      const result = await runAutomatedProblemQuality(problemId)
      if (!result.ok) return toast.error(result.error.userMessage || '题目质量机器评估失败')
      toast.success('题目质量机器评估已完成')
      await load()
    } finally { setBusy(false) }
  }

  const submitExpert = async () => {
    if (!data?.problemQuality) return
    setBusy(true)
    try {
      const result = await submitExpertProblemQuality(problemId, data.problemQuality.id, {
        algorithmicValueScore: Number(algorithmicValueScore),
        editorialScore: Number(editorialScore),
        originalityScore: Number(originalityScore),
        comment,
      })
      if (!result.ok) return toast.error(result.error.userMessage || '专家评估提交失败')
      toast.success('专家评估已固化')
      setExpertOpen(false)
      setAlgorithmicValueScore(''); setEditorialScore(''); setOriginalityScore(''); setComment('')
      await load()
    } finally { setBusy(false) }
  }

  const resetProfileForm = () => {
    setProfileName(''); setProfileClass(''); setProfileComplexity('')
    setProfileScoreMin(''); setProfileScoreMax(''); setProfileSubmissionId('')
  }

  const submitProfile = async () => {
    setBusy(true)
    try {
      const result = await createProblemSolutionProfile(problemId, {
        key: `profile-${Date.now().toString(36)}`,
        name: profileName,
        expectedClass: profileClass,
        expectedComplexity: profileComplexity || null,
        expectedScoreMin: Number(profileScoreMin),
        expectedScoreMax: Number(profileScoreMax),
        expectedSubtaskScores: [],
        submissionId: Number(profileSubmissionId),
      })
      if (!result.ok) return toast.error(result.error.userMessage || '参考解法档案保存失败')
      toast.success('参考解法档案已保存，并已重新进行质量评估')
      setProfileOpen(false); resetProfileForm(); await load()
    } finally { setBusy(false) }
  }

  const setProfileStatus = async (profile: SolutionProfile, status: SolutionProfile['status']) => {
    setBusy(true)
    try {
      const result = await updateProblemSolutionProfile(problemId, profile.id, profile.revision, status)
      if (!result.ok) return toast.error(result.error.userMessage || '参考解法状态更新失败')
      toast.success(status === 'active' ? '参考解法已启用' : '参考解法已停用')
      await load()
    } finally { setBusy(false) }
  }

  if (loading) return <section className={styles.card} aria-busy="true">正在加载质量评估…</section>
  if (!data) return <section className={styles.card}>暂时无法加载质量评估。<Button variant="outline" onClick={load}>重试</Button></section>

  const snapshot = data.testSetQuality
  const status = snapshot ? qualityStatusPresentation(snapshot.qualityStatus, snapshot.isStale) : null
  const conclusion = snapshot ? qualityConclusion(snapshot) : null
  const pqs = data.problemQuality
  const expertDirty = Boolean(algorithmicValueScore || editorialScore || originalityScore || comment)
  const profileDirty = Boolean(profileName || profileClass || profileComplexity || profileScoreMin || profileScoreMax || profileSubmissionId)

  return <div className={styles.panel}>
    <section className={styles.card}>
      <header className={styles.heading}>
        <div><h3>数据质量评估</h3><p>先告诉你当前数据是否适合使用，详细证据收在技术证书中。</p></div>
        <Button variant="primary" loading={busy} disabled={!data.stableTestSet || pending} onClick={triggerDqs}>{pending ? '评估进行中' : '评估当前版本'}</Button>
      </header>
      {snapshot ? <>
        <div className={styles.conclusion}>
          <div><StatusBadge variant={conclusion!.variant}>{conclusion!.title}</StatusBadge><p>{conclusion!.description}</p></div>
          <strong>{displayScore(snapshot.overallScore)} / 100</strong>
        </div>
        {(snapshot.criticalIssueCount > 0 || snapshot.warningCount > 0 || snapshot.isStale) && <div className={styles.diagnostics}>
          {snapshot.isStale && <p><strong>需重新评估：</strong>题目或评测数据已经变化。</p>}
          {snapshot.evidence?.criticalIssues?.map((item, index) => <p key={item.code || index} className={styles.critical}><strong>必须处理：</strong>发现一项影响评测正确性的问题，请检查题目和评测数据。</p>)}
          {snapshot.evidence?.warnings?.map((item, index) => <p key={item.code || index}><strong>建议：</strong>发现一项可改进的数据质量问题。</p>)}
        </div>}
        <details className={styles.technicalCertificate}><summary>查看质量指标与评估依据</summary>
        <div className={styles.summary}>
          <div className={styles.overall}><span>数据质量</span><strong>{displayScore(snapshot.overallScore)}</strong><small>/ 100</small></div>
          <div><span>状态</span><StatusBadge variant={status!.variant}>{status!.label}</StatusBadge><small>{status!.description}</small></div>
          <div><span>依据充足度</span><strong>{confidenceLabel(snapshot.confidenceLevel)} · {snapshot.confidenceScore}</strong><small>用于说明本次结论的可靠程度</small></div>
          <div><span>数据成熟度</span><strong>{maturityLabel(snapshot.maturityLevel)}</strong><small>{snapshot.realSubmissionCount} 次真实提交 · {snapshot.validHackCount} 次有效补充</small></div>
        </div>
        <div className={styles.scoreGrid}>{DQS_PARTS.map(item => <div key={item.key}><span>{item.label}</span><strong>{String(snapshot[item.key])} / {item.maximum}</strong></div>)}</div>
        <div className={styles.metrics}>
          <span>常规检查覆盖 {percent(snapshot.evaluationCoverage)}</span>
          <span>隐藏检查覆盖 {percent(snapshot.holdoutCoverage)}</span>
          <span>加权错误簇覆盖 {percent(snapshot.weightedKillCoverage)}</span>
          <span>特征覆盖 {percent(snapshot.featureCoverage)}</span>
          {snapshot.evidence?.scoring?.solutionProfileCount != null && snapshot.evidence.scoring.solutionProfileCount > 0 && <span>参考解法一致性 {snapshot.evidence.scoring.evaluatedSolutionProfileCount ?? 0}/{snapshot.evidence.scoring.solutionProfileCount} · {percent(snapshot.evidence.scoring.solutionProfileAlignment || 0)}</span>}
        </div>
        {snapshot.evidence?.pinnedInputs && <div className={styles.evidence}><strong>评估依据</strong><ul><li>测试数据：已固定</li><li>标准答案：已确认</li><li>输入检查：已确认</li></ul></div>}
        </details>
      </> : <div className={styles.empty}>尚无质量评估结果。请先完善评测数据、标准答案和输入检查。</div>}
    </section>

    <section className={styles.card}>
      <header className={styles.heading}><div><h3>题目内容质量</h3><p>自动检查与专家审核分别记录，普通用户评分不影响质量结论。</p></div><div className={styles.actions}><Button variant="outline" loading={busy} onClick={runPqs}>{pqs ? '重新检查当前内容' : '运行机器评估'}</Button>{pqs && data.permissions.canExpertReview && pqs.status !== 'EXPERT_REVIEWED' && <Button variant="primary" onClick={() => setExpertOpen(true)}>平台专家审核</Button>}</div></header>
      {pqs ? <div className={styles.pqs}>
        <div><span>机器分</span><strong>{pqs.automatedScore} / 70</strong></div>
        <div><span>专家分</span><strong>{displayScore(pqs.expertScore)} / 30</strong></div>
        <div><span>综合质量</span><strong>{displayScore(pqs.overallScore)} / 100</strong></div>
        <div><span>依据充足度</span><strong>{confidenceLabel(pqs.confidenceLevel)} · {pqs.confidenceScore}</strong>{pqs.isStale && <StatusBadge variant="warning">内容已变化</StatusBadge>}</div>
      </div> : <div className={styles.empty}>尚未评估题面、题解、难度与约束设计。</div>}
    </section>

    <section className={styles.card}>
      <header className={styles.heading}>
        <div><h3>参考解法档案</h3><p>记录代表性解法的预期表现，用于检查评测数据能否正确区分不同解法。</p></div>
        <Button variant="outline" onClick={() => setProfileOpen(true)}>新增参考解法</Button>
      </header>
      {data.solutionProfiles?.length ? <div className={styles.tableScroll}><TableRoot><TableHead><TableRow>
        <TableHeaderCell>参考解法</TableHeaderCell><TableHeaderCell>预期算法</TableHeaderCell><TableHeaderCell>预期分</TableHeaderCell><TableHeaderCell>当前结果</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell>
      </TableRow></TableHead><TableBody>{data.solutionProfiles.map(profile => <TableRow key={profile.id}>
        <TableCell><strong>{profile.name}</strong></TableCell>
        <TableCell>{profile.expectedClass}<small className={styles.blockMeta}>{profile.expectedComplexity || '未填写复杂度'}</small></TableCell>
        <TableCell>{profile.expectedScoreMin}–{profile.expectedScoreMax}</TableCell>
        <TableCell>{profile.observed?.score ?? '—'}<small className={styles.blockMeta}>{profile.observed?.result ? judgeResultLabel(profile.observed.result) : '尚无最终结果'}</small></TableCell>
        <TableCell><div className={styles.profileStatus}><StatusBadge variant={profile.status === 'active' ? 'success' : 'neutral'}>{profile.status === 'active' ? '启用' : '停用'}</StatusBadge><Button size="sm" variant="ghost" loading={busy} onClick={() => void setProfileStatus(profile, profile.status === 'active' ? 'retired' : 'active')}>{profile.status === 'active' ? '停用' : '启用'}</Button></div></TableCell>
      </TableRow>)}</TableBody></TableRoot></div> : <div className={styles.empty}>尚未配置参考解法，暂时无法验证评测数据对不同解法的区分能力。</div>}
    </section>

    <section className={styles.card}>
      <h3>评估任务</h3>
      {data.jobs?.length ? <div className={styles.tableScroll}><TableRoot><TableHead><TableRow><TableHeaderCell>任务</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>尝试</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell></TableRow></TableHead><TableBody>{data.jobs.map((job, index) => { const presentation = qualityJobPresentation(job.status); return <TableRow key={job.id}><TableCell>质量检查 {data.jobs!.length - index}</TableCell><TableCell><StatusBadge variant={presentation.variant}>{presentation.label}</StatusBadge>{job.errorMessage && <small className={styles.error}>任务执行失败，请重试。</small>}</TableCell><TableCell>{job.attempts}/3</TableCell><TableCell>{new Date(job.queuedAt).toLocaleString('zh-CN')}</TableCell></TableRow> })}</TableBody></TableRoot></div> : <div className={styles.empty}>暂无评估任务。</div>}
    </section>

    <section className={styles.card}>
      <h3>历史质量记录</h3>
      {data.qualityHistory?.length ? <div className={styles.tableScroll}><TableRoot><TableHead><TableRow><TableHeaderCell>质量评分</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>依据充足度</TableHeaderCell><TableHeaderCell>成熟度</TableHeaderCell><TableHeaderCell>评估时间</TableHeaderCell></TableRow></TableHead><TableBody>{data.qualityHistory.map(item => { const presentation = qualityStatusPresentation(item.qualityStatus, item.isStale); return <TableRow key={item.id}><TableCell>{displayScore(item.overallScore)}</TableCell><TableCell><StatusBadge variant={presentation.variant}>{presentation.label}</StatusBadge></TableCell><TableCell>{confidenceLabel(item.confidenceLevel)} · {item.confidenceScore}</TableCell><TableCell>{maturityLabel(item.maturityLevel)}</TableCell><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell></TableRow> })}</TableBody></TableRoot></div> : <div className={styles.empty}>还没有历史质量记录。</div>}
    </section>

    <FormDialog isOpen={expertOpen} onClose={() => setExpertOpen(false)} onSubmit={submitExpert} title="平台专家质量审核" description="只写入 30 分专家部分；已固化的机器分和证据不会被覆盖。" loading={busy} dirty={expertDirty} submitText="固化专家结论" submitDisabled={!algorithmicValueScore || !editorialScore || !originalityScore || comment.trim().length < 20}>
      <div className={styles.expertForm}>
        <label>算法价值（0–20）<Input type="number" min={0} max={20} value={algorithmicValueScore} onChange={event => setAlgorithmicValueScore(event.target.value)} /></label>
        <label>题解质量（0–5）<Input type="number" min={0} max={5} value={editorialScore} onChange={event => setEditorialScore(event.target.value)} /></label>
        <label>原创性 / 来源（0–5）<Input type="number" min={0} max={5} value={originalityScore} onChange={event => setOriginalityScore(event.target.value)} /></label>
        <label className={styles.comment}>专家评语（20–4000 字）<Textarea rows={6} maxLength={4000} value={comment} onChange={event => setComment(event.target.value)} /></label>
      </div>
    </FormDialog>

    <FormDialog isOpen={profileOpen} onClose={() => setProfileOpen(false)} onSubmit={submitProfile} title="新增参考解法" description="选择一条本题已有的最终提交作为参考，保存后会重新检查评测数据。" loading={busy} dirty={profileDirty} submitText="保存并重新评估" submitDisabled={!profileName.trim() || !profileClass.trim() || !profileScoreMin || !profileScoreMax || !profileSubmissionId}>
      <div className={styles.profileForm}>
        <label>名称<Input value={profileName} placeholder="O(n²) 部分解" onChange={event => setProfileName(event.target.value)} /></label>
        <label>预期算法类别<Input value={profileClass} placeholder="partial" onChange={event => setProfileClass(event.target.value)} /></label>
        <label>预期复杂度<Input value={profileComplexity} placeholder="O(n²)" onChange={event => setProfileComplexity(event.target.value)} /></label>
        <label>最低预期总分<Input type="number" min={0} max={100} value={profileScoreMin} onChange={event => setProfileScoreMin(event.target.value)} /></label>
        <label>最高预期总分<Input type="number" min={0} max={100} value={profileScoreMax} onChange={event => setProfileScoreMax(event.target.value)} /></label>
        <label>参考提交<Input type="number" min={1} value={profileSubmissionId} onChange={event => setProfileSubmissionId(event.target.value)} /></label>
      </div>
    </FormDialog>
  </div>
}
