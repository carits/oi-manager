import crypto from 'node:crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { canModifyProblem, canViewProblem } from '../problem.access'
import { createDataGenerationJob } from '../problem.data-generation.service'
import { EVALUATION_LIMITS } from '../problem.evaluation-budget.service'
import { ACTIVE_CANDIDATE_STATUSES } from '../problem.testcase-candidate.service'
import { resolveContributionContext } from '../problem.contribution-readiness.service'

export class ProblemCandidateError extends Error { constructor(public statusCode: number, public code: string, message: string) { super(message) } }
function fail(status: number, code: string, message: string): never { throw new ProblemCandidateError(status, code, message) }
async function problemFor(user: JwtPayload, problemId: string, manager = false) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } }), canManage = Boolean(problem && canModifyProblem(user, problem))
  if (!problem || (manager ? !canManage : !canManage && (problem.status !== 'published' || !canViewProblem(user, problem)))) fail(404, 'PROBLEM_NOT_FOUND', '题目不存在或无权访问')
  return problem
}

export async function contributeCandidateData(user: JwtPayload, problemId: string, body: any) {
  await problemFor(user, problemId); const inputData = String(body?.inputData || '')
  if (!inputData.trim() || Buffer.byteLength(inputData) > EVALUATION_LIMITS.maxCandidateBytes) fail(413, 'CANDIDATE_DATA_TOO_LARGE', '候选数据为空或超过 16 MiB')
  const job = await createDataGenerationJob({ user, problemId, body: { contribution: true, sourceMode: 'input', cases: [{ name: String(body?.name || 'candidate').slice(0, 80), inputData }] } })
  return { jobId: job.id, status: job.status }
}
export async function contributeCandidateGenerator(user: JwtPayload, problemId: string, body: any) {
  await problemFor(user, problemId); const source = String(body?.source || ''), language = body?.language === 'python3' ? 'python3' : 'cpp17', manifest = body?.manifest
  if (!source.trim() || Buffer.byteLength(source) > 1024 * 1024) fail(413, 'GENERATOR_SOURCE_TOO_LARGE', 'Generator 源码为空或超过 1 MiB')
  const expectedEntry = language === 'python3' ? 'main.py' : 'main.cpp'
  if (manifest?.apiVersion !== 'oj.generator/v1' || manifest?.protocol !== 'oj.generator/v1' || manifest?.language !== language || manifest?.entry !== expectedEntry || !Array.isArray(manifest?.profiles) || !manifest.profiles.length || manifest.profiles.length > 64) fail(400, 'GENERATOR_MANIFEST_INVALID', `Generator Manifest 必须使用 oj.generator/v1、language=${language}、entry=${expectedEntry}，并提供 1～64 个 Profile`)
  const ids = manifest.profiles.map((item: any) => String(item?.id || '').trim())
  if (ids.some((id: string) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)) || new Set(ids).size !== ids.length) fail(400, 'GENERATOR_MANIFEST_INVALID', 'Generator Profile ID 无效或重复')
  const profiles = manifest.profiles.slice(0, 8).map((item: any) => ({ name: String(item.id).slice(0, 80), profile: String(item.id), params: item?.params && typeof item.params === 'object' && !Array.isArray(item.params) ? item.params : {}, args: [] }))
  const normalizedManifest = { apiVersion: 'oj.generator/v1', protocol: 'oj.generator/v1', language, entry: expectedEntry, parameterSchema: manifest?.parameterSchema && typeof manifest.parameterSchema === 'object' && !Array.isArray(manifest.parameterSchema) ? manifest.parameterSchema : {}, profiles: manifest.profiles.map((item: any) => ({ id: String(item.id), label: String(item.label || item.id).slice(0, 80), params: item?.params && typeof item.params === 'object' && !Array.isArray(item.params) ? item.params : {} })) }
  const job = await createDataGenerationJob({ user, problemId, body: { contribution: true, sourceMode: 'generator', generatorSource: source, generatorLanguage: language, generatorManifest: normalizedManifest, cases: profiles } })
  return { jobId: job.id, status: job.status }
}
export async function listMyCandidates(user: JwtPayload, problemId: string) { await problemFor(user, problemId); return prisma.testcaseCandidate.findMany({ where: { problemId, createdBy: user.userId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, source: true, targetRole: true, status: true, evaluationStage: true, currentValue: true, marginalValue: true, message: true, createdAt: true, updatedAt: true, promotedRevisionId: true } }) }

function safeMessage(value: string | null | undefined, manager: boolean) {
  if (!value) return null
  const cleaned = value.replace(/(?:[A-Za-z]:\\|\/)(?:[^\s:]+[\\/])+[^\s:]*/g, '[path]').slice(0, manager ? 4000 : 500)
  if (!manager && /duplicate|重复/i.test(cleaned)) return '与现有候选或正式测试数据完全重复'
  return cleaned
}

function parseAffectedSubtaskIds(value: string | null | undefined): number[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.map(Number).filter((id): id is number => Number.isSafeInteger(id) && id > 0)
      : []
  } catch {
    return []
  }
}

function serializeCandidateForManager<T extends { affectedSubtaskIds: string | null }>(candidate: T) {
  return { ...candidate, affectedSubtaskIds: parseAffectedSubtaskIds(candidate.affectedSubtaskIds) }
}

function publicContributionStage(job: any, item?: any) {
  if (item?.candidate?.evaluationStage) return item.candidate.evaluationStage
  if (item?.status === 'failed') return item.failureStage || 'failed'
  if (item?.status === 'duplicate') return 'deduplication'
  if (item?.status === 'validated') return 'candidate_pool'
  if (job.status === 'queued') return 'received'
  if (job.status === 'running') return job.config?.sourceMode === 'generator' ? 'generator_compile' : 'validator'
  if (job.status === 'finalizing') return 'deduplication'
  if (job.status === 'failed' || job.status === 'cancelled') return 'failed'
  return job.status === 'completed' ? 'completed' : 'received'
}

function serializeContribution(job: any, manager: boolean) {
  return {
    jobId: job.id,
    status: job.status,
    sourceMode: job.config?.sourceMode || 'input',
    stage: publicContributionStage(job),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    errorCode: job.errorCode,
    message: safeMessage(job.errorMessage, manager),
    cases: (job.cases || []).map((item: any) => ({
      caseId: item.id,
      name: item.name,
      status: item.status,
      stage: publicContributionStage(job, item),
      candidateId: item.candidate?.id || item.candidateId || undefined,
      candidateStatus: item.candidate?.status,
      promotedRevisionId: item.candidate?.promotedRevisionId || undefined,
      message: safeMessage(item.message || item.candidate?.message, manager),
    })),
  }
}

export async function getContributionReadiness(user: JwtPayload, problemId: string) {
  return (await resolveContributionContext(user, problemId)).public
}

export async function listMyContributions(user: JwtPayload, problemId: string) {
  const context = await resolveContributionContext(user, problemId)
  const jobs = await prisma.problemDataGenerationJob.findMany({
    where: { problemId, contribution: true, ...(context.canManage ? {} : { createdBy: user.userId }) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  const cases = jobs.length ? await prisma.problemDataGenerationCase.findMany({ where: { jobId: { in: jobs.map(job => job.id) } }, orderBy: [{ jobId: 'asc' }, { orderIndex: 'asc' }] }) : []
  const casesByJob = new Map<string, typeof cases>()
  for (const item of cases) casesByJob.set(item.jobId, [...(casesByJob.get(item.jobId) || []), item])
  const candidateIds = cases.map(item => item.candidateId).filter((id): id is string => Boolean(id))
  const candidates = candidateIds.length ? await prisma.testcaseCandidate.findMany({ where: { id: { in: candidateIds } }, select: { id: true, status: true, evaluationStage: true, message: true, promotedRevisionId: true } }) : []
  const byId = new Map(candidates.map(item => [item.id, item]))
  return jobs.map(job => serializeContribution({ ...job, cases: (casesByJob.get(job.id) || []).map(item => ({ ...item, candidate: item.candidateId ? byId.get(item.candidateId) : null })) }, context.canManage))
}

export async function getContribution(user: JwtPayload, problemId: string, jobId: string) {
  const context = await resolveContributionContext(user, problemId)
  const job = await prisma.problemDataGenerationJob.findFirst({
    where: { id: jobId, problemId, contribution: true, ...(context.canManage ? {} : { createdBy: user.userId }) },
  })
  if (!job) fail(404, 'CONTRIBUTION_NOT_FOUND', '贡献任务不存在')
  const cases = await prisma.problemDataGenerationCase.findMany({ where: { jobId: job.id }, orderBy: { orderIndex: 'asc' } })
  const candidateIds = cases.map(item => item.candidateId).filter((id): id is string => Boolean(id))
  const candidates = candidateIds.length ? await prisma.testcaseCandidate.findMany({ where: { id: { in: candidateIds } }, select: { id: true, status: true, evaluationStage: true, message: true, promotedRevisionId: true } }) : []
  const byId = new Map(candidates.map(item => [item.id, item]))
  return serializeContribution({ ...job, cases: cases.map(item => ({ ...item, candidate: item.candidateId ? byId.get(item.candidateId) : null })) }, context.canManage)
}
export async function getCandidateDetail(user: JwtPayload, problemId: string, candidateId: string) {
  const problem = await problemFor(user, problemId), manager = canModifyProblem(user, problem), data = await prisma.testcaseCandidate.findFirst({ where: { id: candidateId, problemId, ...(manager ? {} : { createdBy: user.userId }) } })
  if (!data) fail(404, 'CANDIDATE_NOT_FOUND', '候选数据不存在')
  return manager ? serializeCandidateForManager(data) : { ...data, killVectorObjectId: undefined, featureFingerprint: undefined, affectedSubtaskIds: undefined }
}
export async function cancelCandidate(user: JwtPayload, problemId: string, candidateId: string) {
  await problemFor(user, problemId); const changed = await prisma.testcaseCandidate.updateMany({ where: { id: candidateId, problemId, createdBy: user.userId, status: { in: ['UPLOADED', 'ADMITTED'] } }, data: { status: 'REJECTED', evaluationStage: 'cancelled', message: '用户取消' } })
  if (!changed.count) fail(409, 'CANDIDATE_NOT_CANCELLABLE', '候选数据已开始评估或已结束'); return { cancelled: true }
}
export async function getCandidatePool(user: JwtPayload, problemId: string) {
  await problemFor(user, problemId, true)
  const [policy, candidates, activeCount, hot] = await Promise.all([prisma.problemCandidatePolicy.upsert({ where: { problemId }, update: {}, create: { id: crypto.randomUUID(), problemId, updatedBy: user.userId } }), prisma.testcaseCandidate.findMany({ where: { problemId }, orderBy: [{ status: 'asc' }, { marginalValue: 'desc' }, { createdAt: 'desc' }], take: 500 }), prisma.testcaseCandidate.count({ where: { problemId, status: { in: ACTIVE_CANDIDATE_STATUSES } } }), prisma.testcaseCandidate.aggregate({ where: { problemId, status: { in: ACTIVE_CANDIDATE_STATUSES } }, _sum: { inputSize: true, outputSize: true } })])
  return { policy: { ...policy, maxHotBytes: policy.maxHotBytes.toString() }, activeCount, hotBytes: Number(hot._sum.inputSize || 0) + Number(hot._sum.outputSize || 0), candidates: candidates.map(serializeCandidateForManager) }
}
export async function updateCandidatePolicy(user: JwtPayload, problemId: string, body: any) {
  await problemFor(user, problemId, true); const current = await prisma.problemCandidatePolicy.upsert({ where: { problemId }, update: {}, create: { id: crypto.randomUUID(), problemId, updatedBy: user.userId } }), expected = Number(body?.expectedRevision)
  if (!Number.isInteger(expected) || expected !== current.revision) fail(409, 'CANDIDATE_POLICY_STALE', 'Candidate 策略已被其他管理员更新')
  const selectorMode = body?.selectorMode === 'auto' ? 'auto' : 'observe', maxHotCandidates = Math.min(Math.max(Number(body?.maxHotCandidates || current.maxHotCandidates), 100), EVALUATION_LIMITS.maxHotCandidates), topK = Math.min(Math.max(Number(body?.topK || current.topK), 10), EVALUATION_LIMITS.maxTopK)
  const changed = await prisma.problemCandidatePolicy.updateMany({ where: { id: current.id, revision: expected }, data: { selectorMode, maxHotCandidates, topK, updatedBy: user.userId, revision: { increment: 1 } } })
  if (!changed.count) fail(409, 'CANDIDATE_POLICY_STALE', 'Candidate 策略已被其他管理员更新'); return prisma.problemCandidatePolicy.findUniqueOrThrow({ where: { id: current.id } })
}
export async function listSelectorRuns(user: JwtPayload, problemId: string) { await problemFor(user, problemId, true); return prisma.canonicalSelectionRun.findMany({ where: { problemId }, orderBy: { createdAt: 'desc' }, take: 100 }) }
export async function previewSelector(user: JwtPayload, problemId: string) {
  await problemFor(user, problemId, true)
  const [policy, candidates] = await Promise.all([prisma.problemCandidatePolicy.upsert({ where: { problemId }, update: {}, create: { id: crypto.randomUUID(), problemId, updatedBy: user.userId } }), prisma.testcaseCandidate.findMany({ where: { problemId, status: 'ELIGIBLE' }, orderBy: [{ marginalValue: 'desc' }, { inputSize: 'asc' }], take: EVALUATION_LIMITS.maxTopK })])
  const selected: typeof candidates = [], seenSemantic = new Set<string>()
  for (const candidate of candidates) { if (candidate.semanticFingerprint && seenSemantic.has(candidate.semanticFingerprint)) continue; if (candidate.semanticFingerprint) seenSemantic.add(candidate.semanticFingerprint); if (candidate.marginalValue <= 0 && !candidate.isProtected) continue; selected.push(candidate); if (selected.length >= (candidate.targetRole === 'official' ? policy.maxCanonicalCases : policy.topK)) break }
  return { mode: 'preview', policyRevision: policy.revision, selected: selected.map(item => ({ id: item.id, source: item.source, targetRole: item.targetRole, marginalValue: item.marginalValue, inputSize: item.inputSize })), qualityDelta: selected.reduce((sum, item) => sum + item.marginalValue, 0) / 100_000, publishable: selected.some(item => item.marginalValue >= 1000) }
}
export async function listFeatureDefinitions(user: JwtPayload, problemId: string) { await problemFor(user, problemId, true); return prisma.problemFeatureDefinition.findMany({ where: { problemId }, orderBy: { orderIndex: 'asc' } }) }
export async function updateFeatureDefinitions(user: JwtPayload, problemId: string, body: any) {
  await problemFor(user, problemId, true); const features = Array.isArray(body?.features) ? body.features : []
  if (features.length > EVALUATION_LIMITS.maxFeatures) fail(422, 'FEATURE_LIMIT', '每题最多定义 128 个 Feature')
  const keys = features.map((item: any) => String(item?.key || ''))
  if (keys.some((key: string) => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) || new Set(keys).size !== keys.length) fail(422, 'FEATURE_INVALID', 'Feature key 无效或重复')
  await prisma.$transaction(async tx => { await tx.problemFeatureDefinition.deleteMany({ where: { problemId } }); if (features.length) await tx.problemFeatureDefinition.createMany({ data: features.map((item: any, orderIndex: number) => ({ id: crypto.randomUUID(), problemId, key: keys[orderIndex], name: String(item?.name || keys[orderIndex]).slice(0, 80), kind: String(item?.kind || 'declarative'), config: item?.config || {}, orderIndex })) }) }); return listFeatureDefinitions(user, problemId)
}
export async function listSubtaskRules(user: JwtPayload, problemId: string) { await problemFor(user, problemId, true); return prisma.problemSubtaskRule.findMany({ where: { problemId }, orderBy: { subtaskId: 'asc' } }) }
export async function updateSubtaskRules(user: JwtPayload, problemId: string, body: any) {
  await problemFor(user, problemId, true); const rules = Array.isArray(body?.rules) ? body.rules : []
  if (rules.length > EVALUATION_LIMITS.maxSubtasks) fail(422, 'SUBTASK_RULE_LIMIT', '每题最多定义 64 条 Subtask Rule')
  const ids = rules.map((item: any) => Number(item?.subtaskId)); if (ids.some((id: number) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) fail(422, 'SUBTASK_RULE_INVALID', 'Subtask ID 无效或重复')
  await prisma.$transaction(async tx => { await tx.problemSubtaskRule.deleteMany({ where: { problemId } }); if (rules.length) await tx.problemSubtaskRule.createMany({ data: rules.map((item: any, index: number) => ({ id: crypto.randomUUID(), problemId, subtaskId: ids[index], rule: item?.rule || {} })) }) }); return listSubtaskRules(user, problemId)
}
