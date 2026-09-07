import crypto from 'node:crypto'
import path from 'node:path'
import yaml from 'js-yaml'
import { prisma } from '../../prisma'
import { getTestdataBlobStore, problemBlobKey } from '../storage/blob-store'
import { putReferencedBlob } from '../storage/content-blob.service'
import { EVALUATION_LIMITS, reserveEvaluationCredits, settleEvaluationCredits, usageCredits } from './problem.evaluation-budget.service'
import { loadRevisionSpec } from './problem.testset-revision.service'
import { parseSubtaskIds, resolveCorpusMode, uniqueSubtaskCases } from './problem.oi-candidate-policy'
import { maybeAutoSelectCandidate } from './problem.candidate-selector.service'

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
const STAGE_LIMIT = { l1: 24, l2: 96, holdout: 256 } as const
type EvaluationStage = keyof typeof STAGE_LIMIT

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function stageStatus(stage: EvaluationStage) {
  return stage === 'l1' ? 'EVALUATING_L1' as const : stage === 'l2' ? 'EVALUATING_L2' as const : 'EVALUATING_HOLDOUT' as const
}

async function activeClusters(problemId: string, affected: number[]) {
  const corpus = await prisma.wrongCorpusRevision.findFirst({ where: { problemId, status: 'active' }, orderBy: { revisionNumber: 'desc' } })
  if (!corpus) return { corpus: null, clusters: [] }
  const all = await prisma.wrongBehaviorCluster.findMany({ where: { problemId, corpusRevisionId: corpus.id, status: 'active' }, orderBy: [{ weight: 'desc' }, { frequency: 'desc' }, { id: 'asc' }] })
  return { corpus, clusters: all.filter(cluster => parseSubtaskIds(cluster.subtaskIds).some(id => affected.includes(id))) }
}

export async function queueCandidateEvaluation(candidateId: string) {
  const candidate = await prisma.testcaseCandidate.findUnique({ where: { id: candidateId } })
  if (!candidate || !candidate.baseTestSetRevisionId) return { queued: false, reason: 'candidate_missing' }
  const affected = parseSubtaskIds(candidate.affectedSubtaskIds)
  if (!affected.length) return { queued: false, reason: 'not_oi_candidate' }
  const { corpus, clusters } = await activeClusters(candidate.problemId, affected)
  if (!corpus || !clusters.length) {
    await prisma.testcaseCandidate.update({ where: { id: candidate.id }, data: { evaluationStage: 'awaiting_corpus' } })
    return { queued: false, reason: 'corpus_missing' }
  }
  const runId = crypto.randomUUID()
  const [problem, creator] = await Promise.all([
    prisma.problem.findUnique({ where: { id: candidate.problemId } }),
    prisma.user.findUnique({ where: { id: candidate.createdBy }, select: { role: true } }),
  ])
  const principalMembership = problem?.organizationId ? await prisma.organizationMembership.findFirst({ where: { organizationId: problem.organizationId, userId: candidate.createdBy, status: 'active', memberRole: 'school_principal' }, select: { id: true } }) : null
  const manager = Boolean(problem && (['platform_admin', 'super_admin'].includes(creator?.role || '') || problem.ownerId === candidate.createdBy || principalMembership))
  const budgetCredits = candidate.source === 'generator' ? EVALUATION_LIMITS.generator.executions : EVALUATION_LIMITS.direct.executions
  const created = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`candidate-evaluation:${candidate.problemId}`}, 0)) IS NULL AS locked`
    const active = await tx.candidateEvaluationRun.count({ where: { candidateId, status: { in: ['reserving', 'queued', 'running'] } } })
    if (active) return false
    await tx.candidateEvaluationRun.create({ data: { id: runId, candidateId, problemId: candidate.problemId, corpusRevisionId: corpus.id, stage: 'l1', status: 'reserving', budgetTaskId: runId, budgetCredits } })
    return true
  })
  if (!created) return { queued: false, reason: 'already_queued', runId: null }
  let reserved = false
  try {
    await reserveEvaluationCredits({ userId: candidate.createdBy, manager, taskType: 'candidate_evaluation', taskId: runId, credits: budgetCredits, metadata: { problemId: candidate.problemId, candidateId } })
    reserved = true
    const queued = await prisma.$transaction(async tx => {
      const changed = await tx.candidateEvaluationRun.updateMany({ where: { id: runId, status: 'reserving' }, data: { status: 'queued' } })
      if (!changed.count) return false
      await tx.testcaseCandidate.update({ where: { id: candidateId }, data: { status: 'EVALUATING_L1', evaluationStage: 'queued_l1', corpusRevisionId: corpus.id } })
      return true
    })
    if (!queued) throw new Error('候选评估预算已预占，但任务未能进入队列')
    return { queued: true, runId }
  } catch (error) {
    await prisma.candidateEvaluationRun.deleteMany({ where: { id: runId, status: 'reserving' } }).catch(() => undefined)
    if (reserved) await settleEvaluationCredits({ taskType: 'candidate_evaluation', taskId: runId, reserved: budgetCredits, actual: 0, metadata: { reason: 'queue_failed' } }).catch(() => undefined)
    throw error
  }
}

export async function queueAwaitingCandidateEvaluations(problemId: string) {
  const candidates = await prisma.testcaseCandidate.findMany({ where: { problemId, status: { in: ['ADMITTED', 'ELIGIBLE', 'WAITING_REPLACEMENT'] }, evaluationStage: { in: ['awaiting_corpus', 'awaiting_evaluator'] } }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true } })
  let queued = 0
  for (const candidate of candidates) if ((await queueCandidateEvaluation(candidate.id).catch(() => ({ queued: false }))).queued) queued++
  return { scanned: candidates.length, queued }
}

async function readSampleSource(sample: { sourceObjectId: string | null; submissionId: number | null }) {
  if (sample.sourceObjectId) {
    const blob = await prisma.blobObject.findUnique({ where: { id: sample.sourceObjectId } })
    if (blob) return (await getTestdataBlobStore().get(blob.storageKey)).toString('utf8')
  }
  if (sample.submissionId) return (await prisma.submission.findUnique({ where: { id: sample.submissionId }, select: { code: true } }))?.code || null
  return null
}

function selectStageClusters<T extends { partition: string }>(clusters: T[], stage: EvaluationStage) {
  const evaluation = clusters.filter(item => item.partition === 'evaluation')
  if (stage === 'l1') return evaluation.slice(0, STAGE_LIMIT.l1)
  if (stage === 'l2') return evaluation.slice(STAGE_LIMIT.l1, STAGE_LIMIT.l2)
  return clusters.filter(item => item.partition === 'holdout').slice(0, STAGE_LIMIT.holdout)
}

export async function claimCandidateEvaluationRun(judgeId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('candidate-evaluation-global-lane', 0)) IS NULL AS locked`
    await tx.candidateEvaluationRun.updateMany({ where: { status: 'running', leaseExpiresAt: { lte: new Date() } }, data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null, message: '评估租约过期，已安全重新排队' } })
    const running = await tx.candidateEvaluationRun.count({ where: { status: 'running' } })
    const generationRunning = await tx.problemDataGenerationJob.count({ where: { contribution: true, status: { in: ['running', 'finalizing'] } } })
    if (running || generationRunning) return null
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "CandidateEvaluationRun" WHERE status = 'queued' ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`
    if (!rows[0]) return null
    const run = await tx.candidateEvaluationRun.findUnique({ where: { id: rows[0].id } })
    if (!run) return null
    const candidate = await tx.testcaseCandidate.findUnique({ where: { id: run.candidateId }, include: { InputObject: true, OutputObject: true, BaseTestSetRevision: true } })
    if (!candidate?.InputObject || !candidate.OutputObject || !candidate.BaseTestSetRevision || candidate.baseTestSetRevisionId !== (await tx.problem.findUnique({ where: { id: run.problemId }, select: { latestTestSetRevisionId: true } }))?.latestTestSetRevisionId) {
      await tx.candidateEvaluationRun.update({ where: { id: run.id }, data: { status: 'failed', message: 'Candidate 基础测试版本已变化', finishedAt: new Date() } })
      if (candidate) await tx.testcaseCandidate.update({ where: { id: candidate.id }, data: { status: 'STALE', evaluationStage: 'base_revision_stale' } })
      return null
    }
    const affected = parseSubtaskIds(candidate.affectedSubtaskIds)
    const clusters = await tx.wrongBehaviorCluster.findMany({ where: { problemId: run.problemId, corpusRevisionId: run.corpusRevisionId, status: 'active' }, orderBy: [{ weight: 'desc' }, { frequency: 'desc' }, { id: 'asc' }] })
    const selectedClusters = selectStageClusters(clusters.filter(cluster => parseSubtaskIds(cluster.subtaskIds).some(id => affected.includes(id))), run.stage as EvaluationStage)
    const samples = await tx.wrongSolutionSample.findMany({ where: { id: { in: selectedClusters.map(item => item.representativeSampleId) }, status: 'active' } })
    const spec = await loadRevisionSpec(candidate.baseTestSetRevisionId!)
    if (!spec || spec.mode !== 'oi') return null
    const caseMap = new Map<string, { key: string; input: string; output: string }>()
    for (const subtask of spec.subtasks || []) if (affected.includes(subtask.id)) for (const item of uniqueSubtaskCases(subtask)) {
      const key = item.testcaseId || item.inputObjectId
      caseMap.set(key, { key, input: item.inputName, output: item.outputName })
    }
    const caseCount = caseMap.size + 1
    const budgetTaskId = run.budgetTaskId || run.id
    const previousUsage = await tx.candidateEvaluationRun.aggregate({ where: { budgetTaskId }, _sum: { executionCount: true, cpuMilliseconds: true } })
    const remaining = Math.max(0, run.budgetCredits - (previousUsage._sum.executionCount || 0))
    const cpuBudget = candidate.source === 'generator' ? EVALUATION_LIMITS.generator.cpuMs : EVALUATION_LIMITS.direct.cpuMs
    const remainingCpu = Math.max(0, cpuBudget - (previousUsage._sum.cpuMilliseconds || 0))
    const hasHoldout = clusters.some(item => item.partition === 'holdout')
    const sampleSlots = Math.floor(remaining / Math.max(1, caseCount))
    const allowedSlots = run.stage !== 'holdout' && hasHoldout ? Math.max(0, sampleSlots - 1) : sampleSlots
    const allowedSamples = selectedClusters.slice(0, allowedSlots)
    const allowedIds = new Set(allowedSamples.map(item => item.representativeSampleId))
    const fencingToken = crypto.randomUUID()
    const changed = await tx.candidateEvaluationRun.updateMany({ where: { id: run.id, status: 'queued' }, data: { status: 'running', judgeId, fencingToken, leaseExpiresAt: new Date(Date.now() + 30 * 60_000), startedAt: new Date(), attempts: { increment: 1 } } })
    if (!changed.count) return null
    const taskSamples = []
    for (const sample of samples.filter(item => allowedIds.has(item.id))) {
      const cluster = allowedSamples.find(item => item.representativeSampleId === sample.id)!
      const source = await readSampleSource(sample)
      if (source) taskSamples.push({ sampleId: sample.id, clusterId: cluster.id, weight: cluster.weight, language: sample.language, source, inputFilename: sample.inputFilename, outputFilename: sample.outputFilename })
    }
    const [input, output] = await Promise.all([
      getTestdataBlobStore().get(problemBlobKey(run.problemId, candidate.InputObject.storageKey)),
      getTestdataBlobStore().get(problemBlobKey(run.problemId, candidate.OutputObject.storageKey)),
    ])
    return {
      taskType: 'candidate_evaluation' as const,
      runId: run.id,
      candidateId: candidate.id,
      problemId: run.problemId,
      fencingToken,
      stage: run.stage as EvaluationStage,
      testdataPath: path.join(TESTDATA_ROOT, run.problemId, candidate.BaseTestSetRevision.testdataPath),
      problemConfig: yaml.load(candidate.BaseTestSetRevision.judgeConfig || '{}'),
      candidateInputBase64: input.toString('base64'),
      candidateOutputBase64: output.toString('base64'),
      maxExecutionCount: remaining,
      maxCpuMilliseconds: remainingCpu,
      cases: [...caseMap.values()],
      samples: taskSamples,
    }
  }, { timeout: 30_000 })
}

export async function finalizeCandidateEvaluationRun(judgeId: string, payload: any) {
  const run = await prisma.candidateEvaluationRun.findFirst({ where: { id: String(payload?.runId || ''), status: 'running', judgeId, fencingToken: String(payload?.fencingToken || '') } })
  if (!run) return { stale: true }
  const candidate = await prisma.testcaseCandidate.findUnique({ where: { id: run.candidateId } })
  if (!candidate) return { stale: true }
  if (payload?.retryable) {
    if (run.attempts < 3) {
      await prisma.candidateEvaluationRun.updateMany({ where: { id: run.id, status: 'running', judgeId, fencingToken: run.fencingToken }, data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null, executionCount: { increment: Math.max(0, Number(payload?.executionCount || 0)) }, cpuMilliseconds: { increment: Math.max(0, Number(payload?.cpuMilliseconds || 0)) }, message: String(payload?.message || 'Judge 基础设施暂时不可用，等待重试').slice(0, 2000) } })
      return { stale: false, retrying: true }
    }
    const budgetTaskId = run.budgetTaskId || run.id
    await prisma.$transaction(async tx => {
      await tx.candidateEvaluationRun.updateMany({ where: { id: run.id, status: 'running', judgeId, fencingToken: run.fencingToken }, data: { status: 'failed', judgeId: null, fencingToken: null, leaseExpiresAt: null, executionCount: { increment: Math.max(0, Number(payload?.executionCount || 0)) }, cpuMilliseconds: { increment: Math.max(0, Number(payload?.cpuMilliseconds || 0)) }, message: String(payload?.message || 'Judge 基础设施连续失败').slice(0, 2000), finishedAt: new Date() } })
      await tx.testcaseCandidate.updateMany({ where: { id: candidate.id }, data: { status: 'FAILED', evaluationStage: 'evaluation_system_error', message: '候选评估因 Judge 基础设施连续失败而终止，可由管理员重新排队' } })
    })
    const failedUsage = await prisma.candidateEvaluationRun.aggregate({ where: { budgetTaskId }, _sum: { executionCount: true, cpuMilliseconds: true, generatedBytes: true } })
    await settleEvaluationCredits({ taskType: 'candidate_evaluation', taskId: budgetTaskId, reserved: run.budgetCredits, actual: usageCredits({ executions: failedUsage._sum.executionCount || 0, cpuMs: failedUsage._sum.cpuMilliseconds || 0, generatedBytes: Number(failedUsage._sum.generatedBytes || 0) }), metadata: { status: 'system_error' } }).catch(() => undefined)
    return { stale: false, retrying: false }
  }
  const prior = objectValue(candidate.selectionOutcome)
  const evaluation = objectValue(prior.evaluation)
  const clusterResults = [...(Array.isArray(evaluation.clusters) ? evaluation.clusters : []), ...(Array.isArray(payload?.clusters) ? payload.clusters : [])]
  const compact = [...new Map(clusterResults.map((item: any) => [String(item.clusterId), { clusterId: String(item.clusterId), weight: Math.max(1, Number(item.weight || 1)), killedCaseKeys: [...new Set(Array.isArray(item.killedCaseKeys) ? item.killedCaseKeys.map(String) : [])] }])).values()]
  const killBlob = await putReferencedBlob({ content: Buffer.from(JSON.stringify(compact)), ownerType: 'testcase_candidate', ownerId: candidate.id, role: 'kill_vector', contentType: 'application/json' })
  const affected = parseSubtaskIds(candidate.affectedSubtaskIds)
  const { clusters } = await activeClusters(candidate.problemId, affected)
  const nextStage: EvaluationStage | null = run.stage === 'l1' && clusters.filter(item => item.partition === 'evaluation').length > STAGE_LIMIT.l1
    ? 'l2'
    : run.stage !== 'holdout' && clusters.some(item => item.partition === 'holdout')
      ? 'holdout'
      : null
  const holdoutIds = new Set(clusters.filter(item => item.partition === 'holdout').map(item => item.id))
  const holdoutComplete = holdoutIds.size === 0 || compact.some(item => holdoutIds.has(item.clusterId))
  const executed = Math.max(0, Number(payload?.executionCount || 0))
  const cpu = Math.max(0, Number(payload?.cpuMilliseconds || 0))
  let finalized = false
  await prisma.$transaction(async tx => {
    const completed = await tx.candidateEvaluationRun.updateMany({ where: { id: run.id, status: 'running', judgeId, fencingToken: run.fencingToken }, data: { status: 'succeeded', executionCount: { increment: executed }, cpuMilliseconds: { increment: cpu }, value: 0, message: String(payload?.message || '').slice(0, 2000) || null, judgeId: null, fencingToken: null, leaseExpiresAt: null, finishedAt: new Date() } })
    if (!completed.count) return
    finalized = true
    if (nextStage) {
      await tx.candidateEvaluationRun.create({ data: { id: crypto.randomUUID(), candidateId: candidate.id, problemId: candidate.problemId, corpusRevisionId: run.corpusRevisionId, stage: nextStage, budgetTaskId: run.budgetTaskId || run.id, budgetCredits: run.budgetCredits } })
      await tx.testcaseCandidate.update({ where: { id: candidate.id }, data: { status: stageStatus(nextStage), evaluationStage: `queued_${nextStage}`, killVectorObjectId: killBlob.id, selectionOutcome: { ...prior, evaluation: { clusters: compact, unstableSampleIds: [...new Set([...(Array.isArray(evaluation.unstableSampleIds) ? evaluation.unstableSampleIds.map(String) : []), ...(Array.isArray(payload?.unstableSampleIds) ? payload.unstableSampleIds.map(String) : [])])] } } as any } })
      return
    }
    if (!holdoutComplete) {
      await tx.testcaseCandidate.update({ where: { id: candidate.id }, data: { status: 'ADMITTED', evaluationStage: 'awaiting_evaluation_budget', killVectorObjectId: killBlob.id, message: '本轮硬预算不足以完成 Hidden Holdout，Candidate 不得自动晋升', selectionOutcome: { ...prior, evaluation: { clusters: compact, holdoutComplete: false, unstableSampleIds: [...new Set([...(Array.isArray(evaluation.unstableSampleIds) ? evaluation.unstableSampleIds.map(String) : []), ...(Array.isArray(payload?.unstableSampleIds) ? payload.unstableSampleIds.map(String) : [])])] } } as any } })
      return
    }
    const totalWeight = clusters.reduce((sum, item) => sum + Math.max(1, item.weight), 0)
    const killedWeight = compact.filter(item => item.killedCaseKeys.includes('candidate')).reduce((sum, item) => sum + item.weight, 0)
    const hackBonus = candidate.source === 'hack' ? 100 : 0
    const value = Math.max(0, Math.min(1000, (totalWeight ? 500 * killedWeight / totalWeight : 0) + hackBonus - Math.min(50, cpu / 1000)))
    const modes = affected.map(id => {
      const relevantSamples = clusters.filter(item => parseSubtaskIds(item.subtaskIds).includes(id))
      const programs = relevantSamples.reduce((sum, item) => sum + Math.max(1, item.frequency), 0)
      return resolveCorpusMode(programs, relevantSamples.length)
    })
    const status = value > 0 ? 'ELIGIBLE' as const : 'ELIGIBLE_NOT_SELECTED' as const
    await tx.testcaseCandidate.update({ where: { id: candidate.id }, data: { status, evaluationStage: value > 0 ? (modes.includes('open') ? 'evaluated' : 'observed_limited') : 'no_marginal_value', currentValue: value, marginalValue: value, runtimeCost: Math.min(50, cpu / 1000), killVectorObjectId: killBlob.id, selectionOutcome: { ...prior, evaluation: { clusters: compact, value, modes, unstableSampleIds: [...new Set([...(Array.isArray(evaluation.unstableSampleIds) ? evaluation.unstableSampleIds.map(String) : []), ...(Array.isArray(payload?.unstableSampleIds) ? payload.unstableSampleIds.map(String) : [])])] } } as any } })
  })
  if (!finalized) return { stale: true }
  if (nextStage) return { stale: false, nextStage }
  const budgetTaskId = run.budgetTaskId || run.id
  const usage = await prisma.candidateEvaluationRun.aggregate({ where: { budgetTaskId, status: 'succeeded' }, _sum: { executionCount: true, cpuMilliseconds: true, generatedBytes: true } })
  await settleEvaluationCredits({ taskType: 'candidate_evaluation', taskId: budgetTaskId, reserved: run.budgetCredits, actual: usageCredits({ executions: usage._sum.executionCount || 0, cpuMs: usage._sum.cpuMilliseconds || 0, generatedBytes: Number(usage._sum.generatedBytes || 0) }), metadata: { status: 'completed' } }).catch(() => undefined)
  if (holdoutComplete) await maybeAutoSelectCandidate(candidate.id).catch(() => undefined)
  return { stale: false }
}

export async function recoverCandidateEvaluationRuns(judgeId: string) {
  const runs = await prisma.candidateEvaluationRun.findMany({ where: { judgeId, status: 'running' }, select: { id: true } })
  if (runs.length) await prisma.candidateEvaluationRun.updateMany({ where: { id: { in: runs.map(item => item.id) }, judgeId, status: 'running' }, data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null } })
  return runs.length
}
