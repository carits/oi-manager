import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { getTestdataBlobStore, problemBlobKey } from '../storage/blob-store'
import { loadRevisionSpec, publishTestSetRevision, TestSetRevisionConflict, type RevisionCaseSpec, type TestSetRevisionSpec } from './problem.testset-revision.service'
import { chooseBestEviction, genericInputFeatures, leaveOneOutValues, OI_CANDIDATE_LIMITS, parseSubtaskIds, requiredReplacementGain, scoreCaseSet, semanticInputFingerprint, uniqueSubtaskCases, type SelectionMetric } from './problem.oi-candidate-policy'
import { resolveSubtaskReadiness } from './problem.subtask-readiness.service'
import { updateTerminalHackAttempt } from './problem.hack-state'
import { recordPromotedContribution } from '../contribution/application/contribution-reward.service'

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')

function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function evaluationClusters(candidate: { selectionOutcome: unknown }) {
  const outcome = jsonObject(candidate.selectionOutcome)
  const evaluation = jsonObject(outcome.evaluation)
  return Array.isArray(evaluation.clusters) ? evaluation.clusters.map((item: any) => ({ clusterId: String(item.clusterId), weight: Math.max(1, Number(item.weight || 1)), killedCaseKeys: Array.isArray(item.killedCaseKeys) ? item.killedCaseKeys.map(String) : [] })) : []
}

function featureIds(value: string | null) {
  if (!value) return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed?.features) ? parsed.features.map(String) : [] } catch { return [] }
}

async function materializeCurrentFile(problemId: string, filename: string, object: { storageKey: string; size: number; sha256: string }) {
  const root = path.resolve(TESTDATA_ROOT, problemId)
  const target = path.resolve(root, filename)
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('非法候选测试数据文件名')
  await fs.promises.mkdir(root, { recursive: true })
  await getTestdataBlobStore().materialize(problemBlobKey(problemId, object.storageKey), target)
  try {
    return await prisma.testdataFile.create({ data: { id: crypto.randomUUID(), problemId, filename, size: object.size, sha256: object.sha256 } })
  } catch (error) {
    await fs.promises.rm(target, { force: true }).catch(() => undefined)
    throw error
  }
}

type SubtaskDecision = {
  subtaskId: number
  selected: boolean
  reason: string
  retiredTestcaseId?: string
  retiredMarginalValue?: number
  baselineQuality: number
  candidateQuality: number
  qualityGain: number
  requiredGain: number
}

async function selectAcmCandidate(candidate: any, spec: TestSetRevisionSpec, policy: any, override: { userId: string; reason: string } | undefined, dryRun: boolean) {
  const existing = spec.cases || []
  const decision: SubtaskDecision = {
    subtaskId: 0,
    selected: existing.length < 100,
    reason: existing.length < 100 ? 'acm_capacity_available' : 'ACM_CASE_LIMIT_REACHED',
    baselineQuality: 0,
    candidateQuality: existing.length < 100 ? 1 : 0,
    qualityGain: existing.length < 100 ? 1 : 0,
    requiredGain: existing.length < 100 ? 1 : 50,
  }
  if (dryRun) return { promoted: false, reason: decision.selected ? 'preview_selected' : 'preview_not_selected', decisions: [decision] }
  if (!decision.selected) {
    await prisma.$transaction(async tx => {
      await tx.testcaseCandidate.update({ where: { id: candidate.id }, data: { status: 'WAITING_REPLACEMENT', evaluationStage: 'waiting_replacement', message: 'ACM 正式测试集已达到 100 点；缺少足以安全执行 101 选 100 的行为证据' } })
      if (candidate.hackAttemptId) await updateTerminalHackAttempt(tx, { id: candidate.hackAttemptId, state: 'accepted', data: { canonicalStatus: 'pending', message: '技术 Hack 有效；ACM 正式测试集已满，Candidate 等待安全替换' } })
    })
    return { promoted: false, reason: decision.reason, decisions: [decision] }
  }
  const selectionRun = await prisma.canonicalSelectionRun.create({ data: { id: crypto.randomUUID(), problemId: candidate.problemId, baseTestSetRevisionId: candidate.baseTestSetRevisionId, corpusRevisionId: candidate.corpusRevisionId, policyRevision: policy.revision, status: 'running', mode: override ? 'emergency' : 'auto', baselineQuality: 0, candidateQuality: 1, qualityDelta: 1, selectedCandidateIds: [candidate.id], publishReason: override ? `管理员紧急发布：${override.reason}` : '技术 Hack 证据有效且 ACM 正式测试集仍有容量' } })
  const claimed = await prisma.testcaseCandidate.updateMany({ where: { id: candidate.id, status: candidate.status, baseTestSetRevisionId: candidate.baseTestSetRevisionId }, data: { status: 'SELECTED', selectedAt: new Date(), evaluationStage: 'selector_promoting' } })
  if (!claimed.count) {
    await prisma.canonicalSelectionRun.update({ where: { id: selectionRun.id }, data: { status: 'cancelled', errorCode: 'CANDIDATE_ALREADY_CLAIMED', finishedAt: new Date() } })
    return { promoted: false, reason: 'already_claimed' }
  }
  const logicalStem = candidate.hackAttemptId ? `hack_${candidate.hackAttemptId}` : `candidate_${candidate.id}`
  const inputName = `${logicalStem}.in`, outputName = `${logicalStem}.out`
  const createdFiles: string[] = []
  let inputFileId: string | null = null, outputFileId: string | null = null, testcaseId: string | null = null
  try {
    const inputFile = await materializeCurrentFile(candidate.problemId, inputName, candidate.InputObject)
    inputFileId = inputFile.id; createdFiles.push(inputName)
    const outputFile = await materializeCurrentFile(candidate.problemId, outputName, candidate.OutputObject)
    outputFileId = outputFile.id; createdFiles.push(outputName)
    const testcase = await prisma.problemTestcase.create({ data: { id: crypto.randomUUID(), problemId: candidate.problemId, inputFileId, outputFileId, source: candidate.source === 'hack' ? 'hack' : 'generated', hackerId: candidate.source === 'hack' ? candidate.createdBy : null, hackAttemptId: candidate.hackAttemptId, inputSha256: candidate.inputSha256, outputSha256: candidate.outputSha256, semanticFingerprint: candidate.semanticFingerprint, protectedUntil: candidate.protectedUntil || new Date(Date.now() + (candidate.source === 'hack' ? OI_CANDIDATE_LIMITS.SUCCESSFUL_HACK_PROTECTION_DAYS : OI_CANDIDATE_LIMITS.NEW_CASE_PROTECTION_DAYS) * 24 * 60 * 60_000) } })
    testcaseId = testcase.id
    const candidateCase: RevisionCaseSpec = { testcaseId, inputName, outputName, inputObjectId: candidate.InputObject.id, outputObjectId: candidate.OutputObject.id, source: candidate.source === 'hack' ? 'hack' : 'generated', score: null }
    spec.cases = [...existing.filter(item => item.source === 'hack'), candidateCase, ...existing.filter(item => item.source !== 'hack')]
    const revision = await publishTestSetRevision({ problemId: candidate.problemId, expectedLatestRevisionId: candidate.baseTestSetRevisionId, source: candidate.source === 'hack' ? 'hack' : 'admin_edit', createdBy: candidate.createdBy, hackAttemptId: candidate.hackAttemptId, baseConfigText: candidate.Problem.LatestTestSetRevision.judgeConfig, spec, transactionHook: async (tx, next) => {
      await tx.testcaseCandidate.update({ where: { id: candidate.id }, data: { status: 'PROMOTED', promotedTestcaseId: testcaseId!, promotedRevisionId: next.id, promotedAt: new Date(), evaluationStage: 'promoted', selectionOutcome: { decisions: [decision] }, message: `已晋升到 R${next.revisionNumber}` } })
      await recordPromotedContribution(tx, { candidateId: candidate.id, promotedRevisionId: next.id, selectionMode: override ? 'emergency' : 'auto' })
      await tx.canonicalSelectionRun.update({ where: { id: selectionRun.id }, data: { status: 'promoted', promotedRevisionId: next.id, finishedAt: new Date() } })
      if (candidate.hackAttemptId) await updateTerminalHackAttempt(tx, { id: candidate.hackAttemptId, state: 'accepted', data: { canonicalStatus: 'promoted', promotedRevisionId: next.id, acceptedTestcaseId: testcaseId!, acceptedInputFile: inputName, acceptedOutputFile: outputName, message: `技术 Hack 有效；Candidate 已由 Selector 纳入 R${next.revisionNumber}` } })
      if (override) await tx.platformAuditLog.create({ data: { id: crypto.randomUUID(), actorUserId: override.userId, action: 'candidate_emergency_published', targetType: 'testcase_candidate', targetId: candidate.id, metadata: { problemId: candidate.problemId, reason: override.reason, fromRevisionId: candidate.baseTestSetRevisionId, toRevisionId: next.id, decisions: [decision] } } })
    } })
    return { promoted: true, revisionId: revision?.id, decisions: [decision] }
  } catch (error) {
    await prisma.canonicalSelectionRun.updateMany({ where: { id: selectionRun.id, status: 'running' }, data: { status: 'failed', errorCode: error instanceof TestSetRevisionConflict ? 'TEST_SET_REVISION_STALE' : 'PROMOTION_FAILED', errorMessage: String((error as Error).message).slice(0, 2000), finishedAt: new Date() } }).catch(() => undefined)
    if (testcaseId) await prisma.problemTestcase.deleteMany({ where: { id: testcaseId } }).catch(() => undefined)
    if (inputFileId || outputFileId) await prisma.testdataFile.deleteMany({ where: { id: { in: [inputFileId, outputFileId].filter((id): id is string => Boolean(id)) } } }).catch(() => undefined)
    await Promise.allSettled(createdFiles.map(name => fs.promises.rm(path.join(TESTDATA_ROOT, candidate.problemId, name), { force: true })))
    await prisma.testcaseCandidate.updateMany({ where: { id: candidate.id, status: 'SELECTED' }, data: error instanceof TestSetRevisionConflict ? { status: 'STALE', evaluationStage: 'base_revision_stale' } : { status: 'ELIGIBLE', evaluationStage: 'technical_hack_evidence', message: String((error as Error).message).slice(0, 2000) } }).catch(() => undefined)
    throw error
  }
}

export async function maybeAutoSelectCandidate(candidateId: string, override?: { userId: string; reason: string }, options?: { dryRun?: boolean }) {
  const dryRun = options?.dryRun === true
  const candidate = await prisma.testcaseCandidate.findUnique({ where: { id: candidateId }, include: { InputObject: true, OutputObject: true, Problem: { include: { LatestTestSetRevision: true } } } })
  const statusReady = candidate && (['ELIGIBLE', 'WAITING_REPLACEMENT'].includes(candidate.status) || (Boolean(override) || dryRun) && candidate.status === 'ELIGIBLE_NOT_SELECTED')
  const stageReady = candidate && (['evaluated', 'observed_limited', 'waiting_replacement', 'technical_hack_evidence'].includes(candidate.evaluationStage) || (Boolean(override) || dryRun) && candidate.evaluationStage === 'selector_not_selected')
  if (!candidate?.InputObject || !candidate.OutputObject || !candidate.Problem.LatestTestSetRevision || !statusReady || !stageReady) return { promoted: false, reason: 'not_ready' }
  if (candidate.targetRole !== 'hack_gate') return { promoted: false, reason: 'official_requires_group_assignment' }
  const policy = await prisma.problemCandidatePolicy.upsert({ where: { problemId: candidate.problemId }, update: {}, create: { id: crypto.randomUUID(), problemId: candidate.problemId, updatedBy: candidate.createdBy } })
  if (!override && !dryRun && policy.selectorMode !== 'auto') return { promoted: false, reason: 'observe_mode' }
  const recentPublishes = await prisma.canonicalSelectionRun.count({ where: { problemId: candidate.problemId, status: 'promoted', createdAt: { gte: new Date(Date.now() - 60 * 60_000) } } })
  if (!override && !dryRun && recentPublishes >= Math.min(3, policy.maxAutoPublishesPerHour)) return { promoted: false, reason: 'publish_rate_limited' }
  if (candidate.baseTestSetRevisionId !== candidate.Problem.latestTestSetRevisionId) {
    if (!dryRun) await prisma.testcaseCandidate.update({ where: { id: candidate.id }, data: { status: 'STALE', evaluationStage: 'base_revision_stale' } })
    return { promoted: false, reason: 'stale' }
  }
  const spec = await loadRevisionSpec(candidate.baseTestSetRevisionId!)
  if (!spec) return { promoted: false, reason: 'revision_missing' }
  if (spec.mode === 'acm') return selectAcmCandidate(candidate, spec, policy, override, dryRun)
  const affected = parseSubtaskIds(candidate.affectedSubtaskIds)
  const [readiness, clusters, featureDefinitions, testcaseRows] = await Promise.all([
    resolveSubtaskReadiness(candidate.problemId, candidate.baseTestSetRevisionId),
    prisma.wrongBehaviorCluster.findMany({ where: { problemId: candidate.problemId, corpusRevisionId: candidate.corpusRevisionId, status: 'active' } }),
    prisma.problemFeatureDefinition.findMany({ where: { problemId: candidate.problemId }, select: { key: true } }),
    prisma.problemTestcase.findMany({ where: { problemId: candidate.problemId }, select: { id: true, source: true, semanticFingerprint: true, isProtected: true, protectionReason: true, protectedUntil: true, createdAt: true, InputFile: { select: { size: true } }, OutputFile: { select: { size: true } } } }),
  ])
  const testcaseById = new Map(testcaseRows.map(item => [item.id, item]))
  const evaluated = evaluationClusters(candidate)
  const configuredFeatureUniverse = featureDefinitions.map(item => item.key)
  const inputObjectIds = [...new Set((spec.subtasks || []).flatMap(subtask => uniqueSubtaskCases(subtask).map(item => item.inputObjectId)))]
  const inputObjects = inputObjectIds.length ? await prisma.testdataObject.findMany({ where: { id: { in: inputObjectIds }, problemId: candidate.problemId } }) : []
  const inferredInputMetrics = new Map<string, { semanticFingerprint: string; features: string[] }>()
  await Promise.all(inputObjects.map(async object => {
    try {
      const content = await getTestdataBlobStore().get(problemBlobKey(candidate.problemId, object.storageKey))
      inferredInputMetrics.set(object.id, { semanticFingerprint: semanticInputFingerprint(content), features: genericInputFeatures(content) })
    } catch {
      // A missing immutable object is handled by revision integrity checks. A
      // selector preview must stay fail-closed instead of inventing features.
    }
  }))
  const decisions: SubtaskDecision[] = []
  for (const subtask of spec.subtasks || []) {
    if (!affected.includes(subtask.id)) continue
    const ready = readiness.find(item => item.subtaskId === subtask.id)
    if (!override && !ready?.autoSelection) { decisions.push({ subtaskId: subtask.id, selected: false, reason: 'WRONG_CORPUS_INSUFFICIENT_FOR_AUTO_SELECTION', baselineQuality: 0, candidateQuality: 0, qualityGain: 0, requiredGain: OI_CANDIDATE_LIMITS.MIN_REPLACEMENT_ABS_GAIN }); continue }
    const relevantClusters = clusters.filter(cluster => parseSubtaskIds(cluster.subtaskIds).includes(subtask.id)).map(cluster => ({ id: cluster.id, weight: cluster.weight }))
    const existing = uniqueSubtaskCases(subtask)
    const officialIds = new Set(subtask.groups.filter(group => group.kind === 'official').flatMap(group => group.cases.map(item => item.testcaseId || item.inputObjectId)))
    const metric = (item: RevisionCaseSpec): SelectionMetric => {
      const key = item.testcaseId || item.inputObjectId
      const row = item.testcaseId ? testcaseById.get(item.testcaseId) : null
      const inferred = inferredInputMetrics.get(item.inputObjectId)
      const semantic = row?.semanticFingerprint || inferred?.semanticFingerprint || key
      return { id: key, semanticFingerprint: semantic, killedClusters: evaluated.filter(cluster => cluster.killedCaseKeys.includes(key)).map(cluster => ({ id: cluster.clusterId, weight: cluster.weight })), features: [...(inferred?.features || []), `semantic.${semantic.slice(0, 12)}`], runtimeCost: 0, hackEvidence: row?.source === 'hack' }
    }
    const existingMetrics = existing.map(metric)
    const candidateMetric: SelectionMetric = { id: 'candidate', semanticFingerprint: candidate.semanticFingerprint, killedClusters: evaluated.filter(cluster => cluster.killedCaseKeys.includes('candidate')).map(cluster => ({ id: cluster.clusterId, weight: cluster.weight })), features: [...featureIds(candidate.featureFingerprint), ...(candidate.semanticFingerprint ? [`semantic.${candidate.semanticFingerprint.slice(0, 12)}`] : [])], runtimeCost: candidate.runtimeCost, hackEvidence: candidate.source === 'hack' }
    const featureUniverse = [...new Set([...configuredFeatureUniverse, ...existingMetrics.flatMap(item => item.features || []), ...(candidateMetric.features || [])])]
    const baselineQuality = scoreCaseSet(existingMetrics, relevantClusters, featureUniverse)
    const requiredGain = requiredReplacementGain(baselineQuality)
    const sameSemantic = candidate.semanticFingerprint ? existingMetrics.filter(item => item.semanticFingerprint === candidate.semanticFingerprint).length : 0
    if (!override && sameSemantic >= OI_CANDIDATE_LIMITS.MAX_CASES_PER_SEMANTIC_CLUSTER) {
      decisions.push({ subtaskId: subtask.id, selected: false, reason: 'CANDIDATE_SEMANTIC_CLUSTER_LIMIT', baselineQuality, candidateQuality: baselineQuality, qualityGain: 0, requiredGain })
      continue
    }
    const candidateKills = [...new Set(candidateMetric.killedClusters?.map(item => item.id) || [])].sort().join(',')
    const behavioralDuplicate = existingMetrics.find(item => [...new Set(item.killedClusters?.map(cluster => cluster.id) || [])].sort().join(',') === candidateKills)
    if (!override && candidateKills && behavioralDuplicate) {
      const row = testcaseById.get(behavioralDuplicate.id)
      const existingBytes = (row?.InputFile.size || 0) + (row?.OutputFile.size || 0)
      if (candidate.inputSize + candidate.outputSize >= existingBytes) {
        decisions.push({ subtaskId: subtask.id, selected: false, reason: 'CANDIDATE_BEHAVIORAL_DUPLICATE', baselineQuality, candidateQuality: baselineQuality, qualityGain: 0, requiredGain })
        continue
      }
    }
    if (existing.length < OI_CANDIDATE_LIMITS.MAX_CASES_PER_SUBTASK) {
      const candidateQuality = scoreCaseSet([...existingMetrics, candidateMetric], relevantClusters, featureUniverse)
      const qualityGain = candidateQuality - baselineQuality
      const admissionGain = 10
      decisions.push({ subtaskId: subtask.id, selected: Boolean(override) || qualityGain >= admissionGain, reason: override ? 'administrator_override' : qualityGain >= admissionGain ? 'capacity_available_and_gain_met' : 'CANDIDATE_NOT_SELECTED', baselineQuality, candidateQuality, qualityGain, requiredGain: admissionGain })
      continue
    }
    const pool = [...existingMetrics, candidateMetric]
    const now = Date.now()
    const removable = pool.filter(item => {
      if (item.id === 'candidate') return true
      const row = testcaseById.get(item.id)
      if (!row) return false
      if (row.isProtected || row.protectedUntil && row.protectedUntil.getTime() > now) return false
      const ageDays = (now - row.createdAt.getTime()) / (24 * 60 * 60_000)
      if (ageDays < (row.source === 'hack' ? OI_CANDIDATE_LIMITS.SUCCESSFUL_HACK_PROTECTION_DAYS : OI_CANDIDATE_LIMITS.NEW_CASE_PROTECTION_DAYS)) return false
      if (officialIds.has(item.id) && officialIds.size <= OI_CANDIDATE_LIMITS.MIN_OFFICIAL_CORE) return false
      return true
    })
    const best = chooseBestEviction({ pool, removableIds: new Set(removable.map(item => item.id)), corpus: relevantClusters, featureUniverse, preferCandidateId: 'candidate' })
    if (!best || best.removed.id === 'candidate') { decisions.push({ subtaskId: subtask.id, selected: false, reason: 'CANDIDATE_NOT_SELECTED', baselineQuality, candidateQuality: best?.quality ?? baselineQuality, qualityGain: (best?.quality ?? baselineQuality) - baselineQuality, requiredGain }); continue }
    const gain = best.quality - baselineQuality
    const retiredMarginalValue = leaveOneOutValues(existingMetrics, relevantClusters, featureUniverse).get(best.removed.id) || 0
    decisions.push({ subtaskId: subtask.id, selected: Boolean(override) || gain >= requiredGain, reason: override ? 'administrator_override' : gain >= requiredGain ? 'replaced_by_higher_marginal_value' : 'REPLACEMENT_GAIN_BELOW_THRESHOLD', retiredTestcaseId: override || gain >= requiredGain ? best.removed.id : undefined, retiredMarginalValue, baselineQuality, candidateQuality: best.quality, qualityGain: gain, requiredGain })
  }
  const selected = decisions.filter(item => item.selected)
  if (dryRun) return {
    promoted: false,
    reason: selected.length ? 'preview_selected' : 'preview_not_selected',
    decisions,
    publishRateLimited: recentPublishes >= Math.min(3, policy.maxAutoPublishesPerHour),
  }
  const hasAutomaticSubtask = affected.some(subtaskId => readiness.some(item => item.subtaskId === subtaskId && item.autoSelection))
  if (!override && !hasAutomaticSubtask) {
    // LIMITED/CLOSED corpus readiness is an observation state. Keep the
    // evaluated Candidate eligible for a future corpus rebuild instead of
    // falsely classifying it as redundant or below the selection threshold.
    return { promoted: false, reason: 'observe_limited', decisions }
  }
  const selectionRun = await prisma.canonicalSelectionRun.create({ data: { id: crypto.randomUUID(), problemId: candidate.problemId, baseTestSetRevisionId: candidate.baseTestSetRevisionId!, corpusRevisionId: candidate.corpusRevisionId, policyRevision: policy.revision, status: selected.length ? 'running' : 'not_selected', mode: override ? 'emergency' : 'auto', baselineQuality: decisions.reduce((sum, item) => sum + item.baselineQuality, 0), candidateQuality: decisions.reduce((sum, item) => sum + item.candidateQuality, 0), qualityDelta: decisions.reduce((sum, item) => sum + item.qualityGain, 0), selectedCandidateIds: selected.length ? [candidate.id] : [], publishReason: override ? `管理员强制发布：${override.reason}` : selected.length ? '按 Subtask 边际集合价值选择' : decisions.map(item => `S${item.subtaskId}:${item.reason}`).join('; '), finishedAt: selected.length ? null : new Date() } })
  if (!selected.length) {
    const waitingReplacement = (spec.subtasks || []).some(subtask => affected.includes(subtask.id) && uniqueSubtaskCases(subtask).length >= OI_CANDIDATE_LIMITS.MAX_CASES_PER_SUBTASK)
    await prisma.$transaction(async tx => {
      await tx.testcaseCandidate.update({ where: { id: candidate.id }, data: { status: waitingReplacement ? 'WAITING_REPLACEMENT' : 'ELIGIBLE_NOT_SELECTED', evaluationStage: waitingReplacement ? 'waiting_replacement' : 'selector_not_selected', message: waitingReplacement ? '正式测试点已满，Candidate 等待满足保护约束和替换门槛' : '候选数据未达到集合边际价值门槛', selectionOutcome: { ...jsonObject(candidate.selectionOutcome), decisions } as any } })
      if (candidate.hackAttemptId) await updateTerminalHackAttempt(tx, { id: candidate.hackAttemptId, state: 'accepted', data: waitingReplacement ? { canonicalStatus: 'pending', message: '技术 Hack 有效；Candidate 等待正式测试集替换窗口' } : { canonicalStatus: 'redundant', message: '技术 Hack 有效，但 Candidate 未达到正式测试集边际价值门槛' } })
    })
    return { promoted: false, reason: 'not_selected', decisions }
  }
  const claimed = await prisma.testcaseCandidate.updateMany({ where: { id: candidate.id, status: candidate.status, baseTestSetRevisionId: candidate.baseTestSetRevisionId }, data: { status: 'SELECTED', selectedAt: new Date(), evaluationStage: 'selector_promoting' } })
  if (!claimed.count) {
    await prisma.canonicalSelectionRun.update({ where: { id: selectionRun.id }, data: { status: 'cancelled', errorCode: 'CANDIDATE_ALREADY_CLAIMED', finishedAt: new Date() } })
    return { promoted: false, reason: 'already_claimed' }
  }

  const logicalStem = candidate.hackAttemptId ? `hack_${candidate.hackAttemptId}` : `candidate_${candidate.id}`
  const inputName = `${logicalStem}.in`, outputName = `${logicalStem}.out`
  const createdFiles: string[] = []
  let inputFileId: string | null = null, outputFileId: string | null = null, testcaseId: string | null = null
  try {
    const inputFile = await materializeCurrentFile(candidate.problemId, inputName, candidate.InputObject)
    inputFileId = inputFile.id; createdFiles.push(inputName)
    const outputFile = await materializeCurrentFile(candidate.problemId, outputName, candidate.OutputObject)
    outputFileId = outputFile.id; createdFiles.push(outputName)
    const testcase = await prisma.problemTestcase.create({ data: { id: crypto.randomUUID(), problemId: candidate.problemId, inputFileId, outputFileId, source: candidate.source === 'hack' ? 'hack' : 'generated', hackerId: candidate.source === 'hack' ? candidate.createdBy : null, hackAttemptId: candidate.hackAttemptId, inputSha256: candidate.inputSha256, outputSha256: candidate.outputSha256, semanticFingerprint: candidate.semanticFingerprint, protectedUntil: candidate.protectedUntil || new Date(Date.now() + (candidate.source === 'hack' ? OI_CANDIDATE_LIMITS.SUCCESSFUL_HACK_PROTECTION_DAYS : OI_CANDIDATE_LIMITS.NEW_CASE_PROTECTION_DAYS) * 24 * 60 * 60_000) } })
    testcaseId = testcase.id
    const candidateCase: RevisionCaseSpec = { testcaseId, inputName, outputName, inputObjectId: candidate.InputObject.id, outputObjectId: candidate.OutputObject.id, source: candidate.source === 'hack' ? 'hack' : 'generated', score: 100 }
    for (const decision of selected) {
      const subtask = spec.subtasks!.find(item => item.id === decision.subtaskId)!
      if (decision.retiredTestcaseId) for (const group of subtask.groups) group.cases = group.cases.filter(item => (item.testcaseId || item.inputObjectId) !== decision.retiredTestcaseId)
      const gate = subtask.groups.find(group => group.kind === 'hack_gate')!
      gate.cases = [...gate.cases, candidateCase]
    }
    const revision = await publishTestSetRevision({ problemId: candidate.problemId, expectedLatestRevisionId: candidate.baseTestSetRevisionId, source: candidate.source === 'hack' ? 'hack' : 'admin_edit', createdBy: candidate.createdBy, hackAttemptId: candidate.hackAttemptId, baseConfigText: candidate.Problem.LatestTestSetRevision.judgeConfig, spec, transactionHook: async (tx: Prisma.TransactionClient, next) => {
      await tx.testcaseCandidate.update({ where: { id: candidate.id }, data: { status: 'PROMOTED', promotedTestcaseId: testcaseId!, promotedRevisionId: next.id, promotedAt: new Date(), selectedAt: new Date(), evaluationStage: 'promoted', selectionOutcome: { ...jsonObject(candidate.selectionOutcome), decisions } as any, message: `已从 R${candidate.Problem.LatestTestSetRevision!.revisionNumber} 晋升到 R${next.revisionNumber}` } })
      await recordPromotedContribution(tx, { candidateId: candidate.id, promotedRevisionId: next.id, selectionMode: override ? 'emergency' : 'auto' })
      await tx.canonicalSelectionRun.update({ where: { id: selectionRun.id }, data: { status: 'promoted', promotedRevisionId: next.id, finishedAt: new Date() } })
      for (const decision of selected.filter(item => item.retiredTestcaseId)) await tx.testcaseMembershipRetirement.create({ data: { id: crypto.randomUUID(), problemId: candidate.problemId, testcaseId: decision.retiredTestcaseId!, subtaskId: decision.subtaskId, groupKey: '*', replacementCandidateId: candidate.id, replacementTestcaseId: testcaseId!, fromRevisionId: candidate.baseTestSetRevisionId!, toRevisionId: next.id, oldMarginalValue: decision.retiredMarginalValue || 0, newMarginalValue: decision.qualityGain, reason: decision.reason, metadata: decision as any, createdBy: candidate.createdBy } })
      if (candidate.hackAttemptId) await updateTerminalHackAttempt(tx, { id: candidate.hackAttemptId, state: 'accepted', data: { canonicalStatus: 'promoted', promotedRevisionId: next.id, acceptedTestcaseId: testcaseId!, acceptedInputFile: inputName, acceptedOutputFile: outputName, message: `技术 Hack 有效；Candidate 已由 Selector 纳入 R${next.revisionNumber}` } })
      if (override) await tx.platformAuditLog.create({ data: { id: crypto.randomUUID(), actorUserId: override.userId, action: 'candidate_emergency_published', targetType: 'testcase_candidate', targetId: candidate.id, metadata: { problemId: candidate.problemId, reason: override.reason, fromRevisionId: candidate.baseTestSetRevisionId, toRevisionId: next.id, decisions } as any } })
    } })
    return { promoted: true, revisionId: revision?.id, decisions }
  } catch (error) {
    await prisma.canonicalSelectionRun.updateMany({ where: { id: selectionRun.id, status: 'running' }, data: { status: 'failed', errorCode: error instanceof TestSetRevisionConflict ? 'TEST_SET_REVISION_STALE' : 'PROMOTION_FAILED', errorMessage: String((error as Error).message).slice(0, 2000), finishedAt: new Date() } }).catch(() => undefined)
    if (testcaseId) await prisma.problemTestcase.deleteMany({ where: { id: testcaseId } }).catch(() => undefined)
    if (inputFileId || outputFileId) await prisma.testdataFile.deleteMany({ where: { id: { in: [inputFileId, outputFileId].filter((id): id is string => Boolean(id)) } } }).catch(() => undefined)
    await Promise.allSettled(createdFiles.map(name => fs.promises.rm(path.join(TESTDATA_ROOT, candidate.problemId, name), { force: true })))
    if (error instanceof TestSetRevisionConflict) await prisma.testcaseCandidate.updateMany({ where: { id: candidate.id, status: 'SELECTED' }, data: { status: 'STALE', evaluationStage: 'base_revision_stale' } }).catch(() => undefined)
    else await prisma.testcaseCandidate.updateMany({ where: { id: candidate.id, status: 'SELECTED' }, data: { status: 'ELIGIBLE', evaluationStage: 'evaluated', message: String((error as Error).message).slice(0, 2000) } }).catch(() => undefined)
    throw error
  }
}

export async function emergencyPublishCandidate(input: { candidateId: string; userId: string; reason: string }) {
  const reason = input.reason.trim()
  if (reason.length < 10 || reason.length > 1000) throw Object.assign(new Error('紧急发布必须填写 10～1000 字原因'), { statusCode: 422, code: 'EMERGENCY_PUBLISH_REASON_REQUIRED' })
  return maybeAutoSelectCandidate(input.candidateId, { userId: input.userId, reason })
}

export async function previewCandidateSelection(candidateId: string) {
  return maybeAutoSelectCandidate(candidateId, undefined, { dryRun: true })
}
