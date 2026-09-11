'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input, Textarea } from '@/components/ui/FormControls'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'
import { displayScore, qualityJobPresentation, qualityStatusPresentation, type QualityStatus } from './problem-quality-display'
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
  revisionId: string
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
  Revision?: { revisionNumber: number; source: string }
}
type QualityJob = {
  id: string
  revisionId: string
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
  observed?: { revisionId?: string | null; result?: string | null; score?: number | null; subtasks: Array<{ subtaskId: number; score: number }> } | null
}
type QualityDashboard = {
  permissions: { canManage: boolean; canExpertReview: boolean }
  latestTestSetRevisionId?: string | null
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
  { key: 'subtaskQualityScore', label: 'Subtask', maximum: 10 },
  { key: 'stabilityScore', label: '稳定性', maximum: 10 },
]

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
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
  const [profileKey, setProfileKey] = useState('')
  const [profileName, setProfileName] = useState('')
  const [profileClass, setProfileClass] = useState('')
  const [profileComplexity, setProfileComplexity] = useState('')
  const [profileScoreMin, setProfileScoreMin] = useState('')
  const [profileScoreMax, setProfileScoreMax] = useState('')
  const [profileSubmissionId, setProfileSubmissionId] = useState('')
  const [profileSubtasks, setProfileSubtasks] = useState('[]')

  const load = useCallback(async () => {
    const result = await apiClient.get<QualityDashboard>(`/api/problems/${problemId}/quality`)
    if (result.success && result.data) setData(result.data)
    else toast.error(result.message || '质量评估加载失败')
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
    if (!data?.latestTestSetRevisionId) return toast.error('题目尚无正式测试集版本')
    setBusy(true)
    try {
      const result = await apiClient.post(`/api/problems/${problemId}/quality-evaluation-jobs`, { revisionId: data.latestTestSetRevisionId })
      if (!result.success) return toast.error(result.message || '质量评估入队失败')
      toast.success('质量评估已加入队列')
      await load()
    } finally { setBusy(false) }
  }

  const runPqs = async () => {
    setBusy(true)
    try {
      const result = await apiClient.post(`/api/problems/${problemId}/problem-quality-assessments/automated`, {})
      if (!result.success) return toast.error(result.message || '题目质量机器评估失败')
      toast.success('题目质量机器评估已完成')
      await load()
    } finally { setBusy(false) }
  }

  const submitExpert = async () => {
    if (!data?.problemQuality) return
    setBusy(true)
    try {
      const result = await apiClient.post(`/api/problems/${problemId}/problem-quality-assessments/${data.problemQuality.id}/expert-review`, {
        algorithmicValueScore: Number(algorithmicValueScore),
        editorialScore: Number(editorialScore),
        originalityScore: Number(originalityScore),
        comment,
      })
      if (!result.success) return toast.error(result.message || '专家评估提交失败')
      toast.success('专家评估已固化')
      setExpertOpen(false)
      setAlgorithmicValueScore(''); setEditorialScore(''); setOriginalityScore(''); setComment('')
      await load()
    } finally { setBusy(false) }
  }

  const resetProfileForm = () => {
    setProfileKey(''); setProfileName(''); setProfileClass(''); setProfileComplexity('')
    setProfileScoreMin(''); setProfileScoreMax(''); setProfileSubmissionId(''); setProfileSubtasks('[]')
  }

  const submitProfile = async () => {
    let expectedSubtaskScores: unknown
    try {
      expectedSubtaskScores = JSON.parse(profileSubtasks)
      if (!Array.isArray(expectedSubtaskScores)) throw new Error('not-array')
    } catch {
      toast.error('Subtask 预期分必须是 JSON 数组')
      return
    }
    setBusy(true)
    try {
      const result = await apiClient.post(`/api/problems/${problemId}/solution-profiles`, {
        key: profileKey,
        name: profileName,
        expectedClass: profileClass,
        expectedComplexity: profileComplexity || null,
        expectedScoreMin: Number(profileScoreMin),
        expectedScoreMax: Number(profileScoreMax),
        expectedSubtaskScores,
        submissionId: Number(profileSubmissionId),
      })
      if (!result.success) return toast.error(result.message || 'Reference Solution Profile 保存失败')
      toast.success('Reference Solution Profile 已保存，并已触发新版质量评估')
      setProfileOpen(false); resetProfileForm(); await load()
    } finally { setBusy(false) }
  }

  const setProfileStatus = async (profile: SolutionProfile, status: SolutionProfile['status']) => {
    setBusy(true)
    try {
      const result = await apiClient.patch(`/api/problems/${problemId}/solution-profiles/${profile.id}`, { expectedRevision: profile.revision, status })
      if (!result.success) return toast.error(result.message || 'Profile 状态更新失败')
      toast.success(status === 'active' ? 'Profile 已启用' : 'Profile 已停用')
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
  const profileDirty = Boolean(profileKey || profileName || profileClass || profileComplexity || profileScoreMin || profileScoreMax || profileSubmissionId || profileSubtasks !== '[]')

  return <div className={styles.panel}>
    <section className={styles.card}>
      <header className={styles.heading}>
        <div><h3>数据质量评估</h3><p>先告诉你当前数据是否适合使用，详细证据收在技术证书中。</p></div>
        <Button variant="primary" loading={busy} disabled={!data.latestTestSetRevisionId || pending} onClick={triggerDqs}>{pending ? '评估进行中' : '评估当前版本'}</Button>
      </header>
      {snapshot ? <>
        <div className={styles.conclusion}>
          <div><StatusBadge variant={conclusion!.variant}>{conclusion!.title}</StatusBadge><p>{conclusion!.description}</p></div>
          <strong>{displayScore(snapshot.overallScore)} / 100</strong>
        </div>
        {(snapshot.criticalIssueCount > 0 || snapshot.warningCount > 0 || snapshot.isStale) && <div className={styles.diagnostics}>
          {snapshot.isStale && <p><strong>需重新评估：</strong>{snapshot.reasons?.join('、')}</p>}
          {snapshot.evidence?.criticalIssues?.map(item => <p key={`${item.code}-${item.message}`} className={styles.critical}><strong>必须处理：</strong>{item.message}</p>)}
          {snapshot.evidence?.warnings?.map(item => <p key={`${item.code}-${item.message}`}><strong>建议：</strong>{item.message}</p>)}
        </div>}
        <details className={styles.technicalCertificate}><summary>查看技术证书与评分细项</summary>
        <div className={styles.summary}>
          <div className={styles.overall}><span>DQS</span><strong>{displayScore(snapshot.overallScore)}</strong><small>/ 100</small></div>
          <div><span>状态</span><StatusBadge variant={status!.variant}>{status!.label}</StatusBadge><small>{status!.description}</small></div>
          <div><span>置信度</span><strong>{snapshot.confidenceLevel} · {snapshot.confidenceScore}</strong><small>证据充足度，不混入 DQS</small></div>
          <div><span>成熟度</span><strong>{snapshot.maturityLevel}</strong><small>{snapshot.realSubmissionCount} 次真实提交 · {snapshot.validHackCount} 次 Hack</small></div>
        </div>
        <div className={styles.scoreGrid}>{DQS_PARTS.map(item => <div key={item.key}><span>{item.label}</span><strong>{String(snapshot[item.key])} / {item.maximum}</strong></div>)}</div>
        <div className={styles.metrics}>
          <span>Evaluation {percent(snapshot.evaluationCoverage)}</span>
          <span>Hidden Holdout {percent(snapshot.holdoutCoverage)}</span>
          <span>加权错误簇覆盖 {percent(snapshot.weightedKillCoverage)}</span>
          <span>Feature {percent(snapshot.featureCoverage)}</span>
          {snapshot.evidence?.scoring?.solutionProfileCount != null && snapshot.evidence.scoring.solutionProfileCount > 0 && <span>Reference 对齐 {snapshot.evidence.scoring.evaluatedSolutionProfileCount ?? 0}/{snapshot.evidence.scoring.solutionProfileCount} · {percent(snapshot.evidence.scoring.solutionProfileAlignment || 0)}</span>}
        </div>
        {snapshot.evidence?.pinnedInputs && <details className={styles.evidence}><summary>查看固定评估输入</summary><pre>{JSON.stringify(snapshot.evidence.pinnedInputs, null, 2)}</pre></details>}
        </details>
      </> : <div className={styles.empty}>尚无 DQS 快照。需要正式 Revision、Active STD / Validator 和可用 Wrong Corpus。</div>}
    </section>

    <section className={styles.card}>
      <header className={styles.heading}><div><h3>题目质量 PQS</h3><p>机器分与专家分分开保存，普通用户评分不进入 PQS。</p></div><div className={styles.actions}><Button variant="outline" loading={busy} onClick={runPqs}>{pqs ? '重新检查当前内容' : '运行机器评估'}</Button>{pqs && data.permissions.canExpertReview && pqs.status !== 'EXPERT_REVIEWED' && <Button variant="primary" onClick={() => setExpertOpen(true)}>平台专家审核</Button>}</div></header>
      {pqs ? <div className={styles.pqs}>
        <div><span>机器分</span><strong>{pqs.automatedScore} / 70</strong></div>
        <div><span>专家分</span><strong>{displayScore(pqs.expertScore)} / 30</strong></div>
        <div><span>综合 PQS</span><strong>{displayScore(pqs.overallScore)} / 100</strong></div>
        <div><span>置信度</span><strong>{pqs.confidenceLevel} · {pqs.confidenceScore}</strong>{pqs.isStale && <StatusBadge variant="warning">内容已变化</StatusBadge>}</div>
      </div> : <div className={styles.empty}>尚未评估题面、题解、难度与约束设计。</div>}
    </section>

    <section className={styles.card}>
      <header className={styles.heading}>
        <div><h3>Reference Solution Profiles</h3><p>为 OI Subtask 记录代表算法的预期总分与单个 Subtask 分数区间；评估只读取固定 Revision 的终态提交。</p></div>
        <Button variant="outline" onClick={() => setProfileOpen(true)}>新增 Profile</Button>
      </header>
      {data.solutionProfiles?.length ? <div className={styles.tableScroll}><TableRoot><TableHead><TableRow>
        <TableHeaderCell>Profile</TableHeaderCell><TableHeaderCell>预期算法</TableHeaderCell><TableHeaderCell>预期分</TableHeaderCell><TableHeaderCell>当前证据</TableHeaderCell><TableHeaderCell>Subtask 预期</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell>
      </TableRow></TableHead><TableBody>{data.solutionProfiles.map(profile => <TableRow key={profile.id}>
        <TableCell><strong>{profile.name}</strong><small className={styles.blockMeta}>{profile.key} · v{profile.revision} · 提交 #{profile.submissionId}</small></TableCell>
        <TableCell>{profile.expectedClass}<small className={styles.blockMeta}>{profile.expectedComplexity || '未填写复杂度'}</small></TableCell>
        <TableCell>{profile.expectedScoreMin}–{profile.expectedScoreMax}</TableCell>
        <TableCell>{profile.observed?.score ?? '—'}<small className={styles.blockMeta}>{profile.observed?.result || '尚无终态'}{profile.observed?.revisionId ? ` · ${profile.observed.revisionId.slice(0, 8)}` : ''}</small></TableCell>
        <TableCell>{profile.expectedSubtaskScores.length ? profile.expectedSubtaskScores.map(item => `S${item.subtaskId}: ${item.min}–${item.max}`).join('；') : '—'}</TableCell>
        <TableCell><div className={styles.profileStatus}><StatusBadge variant={profile.status === 'active' ? 'success' : 'neutral'}>{profile.status === 'active' ? '启用' : '停用'}</StatusBadge><Button size="sm" variant="ghost" loading={busy} onClick={() => void setProfileStatus(profile, profile.status === 'active' ? 'retired' : 'active')}>{profile.status === 'active' ? '停用' : '启用'}</Button></div></TableCell>
      </TableRow>)}</TableBody></TableRoot></div> : <div className={styles.empty}>尚未配置 Reference Solution Profile。OI 数据只能获得结构分，无法验证预期 30/60/100 等得分梯度。</div>}
    </section>

    <section className={styles.card}>
      <h3>评估任务</h3>
      {data.jobs?.length ? <div className={styles.tableScroll}><TableRoot><TableHead><TableRow><TableHeaderCell>任务</TableHeaderCell><TableHeaderCell>版本</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>尝试</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell></TableRow></TableHead><TableBody>{data.jobs.map(job => { const presentation = qualityJobPresentation(job.status); return <TableRow key={job.id}><TableCell>{job.id.slice(0, 8)}</TableCell><TableCell>{job.revisionId.slice(0, 8)}</TableCell><TableCell><StatusBadge variant={presentation.variant}>{presentation.label}</StatusBadge>{job.errorMessage && <small className={styles.error}>{job.errorCode} · {job.errorMessage}</small>}</TableCell><TableCell>{job.attempts}/3</TableCell><TableCell>{new Date(job.queuedAt).toLocaleString('zh-CN')}</TableCell></TableRow> })}</TableBody></TableRoot></div> : <div className={styles.empty}>暂无评估任务。</div>}
    </section>

    <section className={styles.card}>
      <h3>历史 DQS 快照</h3>
      {data.qualityHistory?.length ? <div className={styles.tableScroll}><TableRoot><TableHead><TableRow><TableHeaderCell>Revision</TableHeaderCell><TableHeaderCell>DQS</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>置信度</TableHeaderCell><TableHeaderCell>成熟度</TableHeaderCell><TableHeaderCell>评估时间</TableHeaderCell></TableRow></TableHead><TableBody>{data.qualityHistory.map(item => { const presentation = qualityStatusPresentation(item.qualityStatus, item.isStale); return <TableRow key={item.id}><TableCell>R{item.Revision?.revisionNumber ?? item.revisionId.slice(0, 8)}</TableCell><TableCell>{displayScore(item.overallScore)}</TableCell><TableCell><StatusBadge variant={presentation.variant}>{presentation.label}</StatusBadge></TableCell><TableCell>{item.confidenceLevel} · {item.confidenceScore}</TableCell><TableCell>{item.maturityLevel}</TableCell><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell></TableRow> })}</TableBody></TableRoot></div> : <div className={styles.empty}>还没有历史质量证书。</div>}
    </section>

    <FormDialog isOpen={expertOpen} onClose={() => setExpertOpen(false)} onSubmit={submitExpert} title="平台专家质量审核" description="只写入 30 分专家部分；已固化的机器分和证据不会被覆盖。" loading={busy} dirty={expertDirty} submitText="固化专家结论" submitDisabled={!algorithmicValueScore || !editorialScore || !originalityScore || comment.trim().length < 20}>
      <div className={styles.expertForm}>
        <label>算法价值（0–20）<Input type="number" min={0} max={20} value={algorithmicValueScore} onChange={event => setAlgorithmicValueScore(event.target.value)} /></label>
        <label>题解质量（0–5）<Input type="number" min={0} max={5} value={editorialScore} onChange={event => setEditorialScore(event.target.value)} /></label>
        <label>原创性 / 来源（0–5）<Input type="number" min={0} max={5} value={originalityScore} onChange={event => setOriginalityScore(event.target.value)} /></label>
        <label className={styles.comment}>专家评语（20–4000 字）<Textarea rows={6} maxLength={4000} value={comment} onChange={event => setComment(event.target.value)} /></label>
      </div>
    </FormDialog>

    <FormDialog isOpen={profileOpen} onClose={() => setProfileOpen(false)} onSubmit={submitProfile} title="新增 Reference Solution Profile" description="选择一条本题本地终态提交作为可复现证据。保存后会以新的固定输入触发 DQS 评估。" loading={busy} dirty={profileDirty} submitText="保存并重新评估" submitDisabled={!profileKey.trim() || !profileName.trim() || !profileClass.trim() || !profileScoreMin || !profileScoreMax || !profileSubmissionId}>
      <div className={styles.profileForm}>
        <label>Profile Key<Input value={profileKey} placeholder="partial-n2" onChange={event => setProfileKey(event.target.value)} /></label>
        <label>名称<Input value={profileName} placeholder="O(n²) 部分解" onChange={event => setProfileName(event.target.value)} /></label>
        <label>预期算法类别<Input value={profileClass} placeholder="partial" onChange={event => setProfileClass(event.target.value)} /></label>
        <label>预期复杂度<Input value={profileComplexity} placeholder="O(n²)" onChange={event => setProfileComplexity(event.target.value)} /></label>
        <label>最低预期总分<Input type="number" min={0} max={100} value={profileScoreMin} onChange={event => setProfileScoreMin(event.target.value)} /></label>
        <label>最高预期总分<Input type="number" min={0} max={100} value={profileScoreMax} onChange={event => setProfileScoreMax(event.target.value)} /></label>
        <label>本地提交 ID<Input type="number" min={1} value={profileSubmissionId} onChange={event => setProfileSubmissionId(event.target.value)} /></label>
        <label className={styles.fullField}>Subtask 预期分 JSON<Textarea rows={5} value={profileSubtasks} onChange={event => setProfileSubtasks(event.target.value)} placeholder='[{"subtaskId":1,"min":30,"max":30}]' /><small>ACM 或不需要单点验证时填 []。Subtask ID 必须属于当前正式 Revision。</small></label>
      </div>
    </FormDialog>
  </div>
}
