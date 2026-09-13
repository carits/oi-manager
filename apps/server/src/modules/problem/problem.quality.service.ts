import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import type { JwtPayload } from '@oi-manager/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { getTestdataBlobStore, problemBlobKey } from '../storage/blob-store'
import { canModifyProblem, canViewProblem, isPlatformManager } from './problem.access'
import { revisionAbsolutePath } from './problem.testset-revision.service'

export const QUALITY_RULE_VERSION = 'QUALITY_RULE_V1'
export const PROBLEM_QUALITY_RULE_VERSION = 'PROBLEM_QUALITY_RULE_V1'
let qualityStaleScanCursor: string | undefined

const RULE_CONFIG = Object.freeze({
  version: QUALITY_RULE_VERSION,
  dqsWeights: {
    correctness: 30,
    discrimination: 25,
    coverage: 15,
    diversity: 10,
    subtaskQuality: 10,
    stability: 10,
  },
  discrimination: { evaluationWeight: 0.4, holdoutWeight: 0.6 },
  confidenceThresholds: { veryLow: 25, low: 45, medium: 65, high: 85 },
  maturity: {
    proven: { submissions: 500, clusters: 10, ageDays: 14 },
    mature: { submissions: 5000, clusters: 20, ageDays: 30 },
    battleTested: { submissions: 20000, clusters: 30, hacks: 10, ageDays: 90 },
  },
})

type JsonObject = Record<string, unknown>
type PinnedCase = {
  testcaseId: string | null
  inputObjectId: string
  outputObjectId: string
  inputName: string
  outputName: string
  source: string
  subtaskId: number | null
  groupKey: string | null
  groupKind: string | null
}
type PinnedObject = { id: string; sha256: string; size: number; storageKey: string; role: 'input' | 'output' }
type PinnedCluster = { id: string; weight: number; frequency: number; partition: string; categoryId: string | null }
type PinnedFeature = { key: string; kind: string; importance: 'critical' | 'important' | 'normal'; config: JsonObject }
type PinnedKillEvidence = { clusterId: string; caseKeys: string[] }
type PinnedSubmissionEvidence = { fingerprint: string; outcome: string }
type PinnedCriticalIncident = {
  id: string
  type: string
  status: 'OPEN' | 'CONFIRMED' | 'RESOLVED'
  discoveredAt: string
  confirmedAt: string | null
}
type PinnedSolutionProfile = {
  id: string
  key: string
  name: string
  expectedClass: string
  expectedComplexity: string | null
  expectedScoreMin: number
  expectedScoreMax: number
  expectedSubtaskScores: Array<{ subtaskId: number; min: number; max: number }>
  definitionHash: string
  definitionRevision: number
  source: {
    submissionId: number
    evaluatedRevisionId: string | null
    result: string | null
    score: number | null
    subtasks: Array<{ subtaskId: number; score: number }>
  }
}

type QualityInputSnapshot = {
  problemId: string
  // Time-dependent confidence/maturity evidence must be reproducible too.
  // UTC-day precision keeps retries deterministic and repeated requests on
  // the same evidence set idempotent, while allowing a later retrospective
  // assessment to record a genuinely newer observation date.
  asOfDate: string
  revision: {
    id: string
    revisionNumber: number
    mode: string
    createdAt: string
    graphHash: string
    judgeConfigHash: string
    testdataPath: string
  }
  cases: PinnedCase[]
  objects: PinnedObject[]
  subtasks: Array<{
    id: number
    score: number
    dependencies: number[]
    groups: Array<{ key: string; kind: string; score: number; aggregation: string; caseCount: number }>
  }>
  corpus: {
    id: string
    revisionNumber: number
    corpusHash: string | null
    sampleCount: number
    clusters: PinnedCluster[]
  }
  features: PinnedFeature[]
  killEvidence: PinnedKillEvidence[]
  featureEvidence: Array<{ testcaseId: string; featureIds: string[]; fingerprint: string | null }>
  submissions: { count: number; outcomes: PinnedSubmissionEvidence[] }
  hacks: { count: number }
  criticalIncidents: PinnedCriticalIncident[]
  solutionProfiles: PinnedSolutionProfile[]
  programs: {
    standardVersionId: string | null
    standardSourceSha256: string | null
    validatorVersionId: string | null
    validatorSourceSha256: string | null
    classifierVersionId: string | null
    classifierSourceSha256: string | null
  }
  checker: {
    hash: string
    kind: string
    configured: boolean
    expectsAsset: boolean
    asset: { fileName: string; sha256: string; size: number } | null
  }
}

type QualityVerificationReport = {
  outcome: 'passed' | 'not_ready' | 'critical'
  standard: { passed: boolean; verdict: string; score: number; message?: string }
  validator: { passed: number; failed: number }
  classifier: { passed: number; failed: number; required: boolean }
  checker: { passed: boolean }
  cases: Array<{
    key: string
    validatorPassed: boolean
    classifierPassed: boolean | null
    code?: string
  }>
}

export class ProblemQualityError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new ProblemQualityError(statusCode, code, message)
}

function sha256(value: Buffer | string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]))
}

function stableHash(value: unknown) {
  return sha256(JSON.stringify(stableValue(value)))
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function parseConfig(text: string): JsonObject {
  try { return asObject(yaml.load(text)) } catch { return {} }
}

function checkerAssetName(config: JsonObject) {
  const value = config.checker
  const fileName = typeof value === 'string' ? value : typeof value === 'object' && value ? asObject(value).file : null
  if (typeof fileName !== 'string' || !fileName.trim()) return null
  const normalized = fileName.trim()
  if (path.basename(normalized) !== normalized || normalized === '.' || normalized === '..' || normalized.includes('\0')) return null
  return normalized
}

async function pinnedChecker(problemId: string, revision: { testdataPath: string }, config: JsonObject): Promise<QualityInputSnapshot['checker']> {
  const kind = String(config.checker_type ?? config.checkerType ?? 'default').toLowerCase()
  const expectsAsset = !['default', 'strict'].includes(kind)
  const fileName = checkerAssetName(config)
  let asset: QualityInputSnapshot['checker']['asset'] = null
  if (fileName) {
    try {
      const revisionRoot = await revisionAbsolutePath(problemId, revision)
      const absolute = path.resolve(revisionRoot, fileName)
      if (absolute !== revisionRoot && absolute.startsWith(`${revisionRoot}${path.sep}`)) {
        const content = await fs.promises.readFile(absolute)
        asset = { fileName, sha256: sha256(content), size: content.length }
      }
    } catch {
      // Missing custom checker assets make the snapshot NOT_READY. If an asset
      // was pinned and later disappears, calculateQualitySnapshot promotes the
      // integrity failure to the non-compensable Critical Gate instead.
    }
  }
  const configured = expectsAsset ? Boolean(asset) : true
  return { kind, expectsAsset, asset, configured, hash: stableHash({ kind, config: config.checker ?? null, asset }) }
}

function activeProgramVersion(programs: Array<{ kind: string; currentVersionId: string | null; status: string }>, versions: Array<{ id: string; compileStatus: string; lifecycleStatus: string; sourceSha256: string }>, kind: string) {
  const program = programs.find(item => item.kind === kind && item.status === 'active' && item.currentVersionId)
  const version = program?.currentVersionId ? versions.find(item => item.id === program.currentVersionId) : null
  return version && version.compileStatus === 'passed' && version.lifecycleStatus === 'active'
    ? { id: version.id, sourceSha256: version.sourceSha256 }
    : null
}

function featureIds(value: unknown): string[] {
  if (!value) return []
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return value.split(',').map(item => item.trim()).filter(Boolean) }
  }
  if (Array.isArray(parsed)) return [...new Set(parsed.map(String).filter(Boolean))]
  if (parsed && typeof parsed === 'object') {
    return [...new Set(Object.entries(parsed as JsonObject).filter(([, item]) => item !== false && item != null).map(([key]) => key))]
  }
  return []
}

function observedSubtaskScores(value: unknown): Array<{ subtaskId: number; score: number }> {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(parsed)) return []
  return parsed.map(item => {
    const record = asObject(item)
    return { subtaskId: Number(record.id ?? record.subtaskId), score: Number(record.score) }
  }).filter(item => Number.isSafeInteger(item.subtaskId) && item.subtaskId > 0 && Number.isFinite(item.score))
}

function expectedSubtaskScores(value: unknown): Array<{ subtaskId: number; min: number; max: number }> {
  if (!Array.isArray(value)) return []
  return value.map(item => {
    const record = asObject(item)
    return { subtaskId: Number(record.subtaskId), min: Number(record.min), max: Number(record.max) }
  }).filter(item => Number.isSafeInteger(item.subtaskId) && item.subtaskId > 0 && Number.isInteger(item.min) && Number.isInteger(item.max))
}

function parseKillEvidence(value: unknown) {
  const selection = asObject(value)
  const evaluation = asObject(selection.evaluation)
  const clusters = Array.isArray(evaluation.clusters) ? evaluation.clusters : []
  return clusters.map(item => {
    const record = asObject(item)
    return {
      clusterId: String(record.clusterId || ''),
      caseKeys: Array.isArray(record.killedCaseKeys) ? record.killedCaseKeys.map(String) : [],
    }
  }).filter(item => item.clusterId)
}

function importanceOf(config: unknown): PinnedFeature['importance'] {
  const value = String(asObject(config).importance || 'normal').toLowerCase()
  return value === 'critical' ? 'critical' : value === 'important' ? 'important' : 'normal'
}

async function visibleProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canViewProblem(user, problem)) fail(404, 'PROBLEM_NOT_FOUND', '题目不存在或无权访问')
  return problem
}

async function manageableProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canModifyProblem(user, problem)) fail(404, 'PROBLEM_NOT_FOUND', '题目不存在或无权管理')
  return problem
}

async function buildPinnedInput(problemId: string, revisionId: string, corpusRevisionId?: string | null): Promise<QualityInputSnapshot> {
  const revision = await prisma.problemTestSetRevision.findFirst({ where: { id: revisionId, problemId } })
  if (!revision) fail(404, 'TEST_SET_REVISION_NOT_FOUND', '测试集版本不存在')
  const corpus = corpusRevisionId
    ? await prisma.wrongCorpusRevision.findFirst({ where: { id: corpusRevisionId, problemId } })
    : await prisma.wrongCorpusRevision.findFirst({ where: { problemId, status: 'active' }, orderBy: { revisionNumber: 'desc' } })
  if (!corpus) fail(409, 'QUALITY_CORPUS_NOT_READY', '题目尚无可用的 Wrong Behavior Corpus 版本')

  const [acmCases, groupCases, revisionSubtasks, revisionGroups, dependencies, clusters, features, programs, candidates, submissionCount, submissions, validHackCount, criticalIncidents, solutionProfiles] = await Promise.all([
    prisma.problemTestSetRevisionCase.findMany({ where: { revisionId }, orderBy: { orderIndex: 'asc' } }),
    prisma.problemTestSetRevisionGroupCase.findMany({ where: { revisionId }, include: { Group: { include: { Subtask: true } } }, orderBy: [{ groupId: 'asc' }, { orderIndex: 'asc' }] }),
    prisma.problemTestSetRevisionSubtask.findMany({ where: { revisionId }, orderBy: { orderIndex: 'asc' } }),
    prisma.problemTestSetRevisionGroup.findMany({ where: { revisionId }, orderBy: [{ subtaskId: 'asc' }, { orderIndex: 'asc' }] }),
    prisma.problemTestSetRevisionDependency.findMany({ where: { Subtask: { revisionId } }, include: { Subtask: true, DependsOn: true } }),
    prisma.wrongBehaviorCluster.findMany({ where: { problemId, corpusRevisionId: corpus.id }, orderBy: { id: 'asc' } }),
    prisma.problemFeatureDefinition.findMany({ where: { problemId }, orderBy: [{ orderIndex: 'asc' }, { key: 'asc' }] }),
    prisma.problemJudgeProgram.findMany({ where: { problemId }, select: { kind: true, currentVersionId: true, status: true } }),
    prisma.testcaseCandidate.findMany({ where: { problemId, OR: [{ corpusRevisionId: corpus.id }, { promotedRevisionId: revisionId }, { promotedTestcaseId: { not: null } }] }, select: { promotedTestcaseId: true, featureFingerprint: true, semanticFingerprint: true, selectionOutcome: true } }),
    prisma.submission.count({ where: { problemInternalId: problemId, testSetRevisionId: revisionId, result: { notIn: ['queuing', 'judging', 'compiling', 'system_error'] } } }),
    prisma.submission.findMany({ where: { problemInternalId: problemId, testSetRevisionId: revisionId, result: { notIn: ['queuing', 'judging', 'compiling', 'system_error'] } }, orderBy: { createdAt: 'desc' }, take: 1000, select: { code: true, language: true, inputFilename: true, outputFilename: true, result: true, score: true } }),
    prisma.problemHackAttempt.count({ where: { problemId, canonicalStatus: 'promoted', finishedAt: { lte: new Date() } } }),
    prisma.testSetQualityIncident.findMany({
      where: { problemId, revisionId, severity: 'CRITICAL', status: 'CONFIRMED' },
      orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, status: true, discoveredAt: true, confirmedAt: true },
    }),
    prisma.problemSolutionProfile.findMany({
      where: { problemId, status: 'active' },
      orderBy: [{ key: 'asc' }, { id: 'asc' }],
      include: { Submission: { select: {
        id: true, testSetRevisionId: true, result: true, score: true, subtasks: true,
        CurrentJudgeRun: { select: { status: true, testSetRevisionId: true, result: true, score: true, subtasks: true } },
      } } },
    }),
  ])
  const versionIds = programs.map(item => item.currentVersionId).filter((id): id is string => Boolean(id))
  const versions = versionIds.length ? await prisma.problemJudgeProgramVersion.findMany({ where: { id: { in: versionIds }, problemId }, select: { id: true, compileStatus: true, lifecycleStatus: true, sourceSha256: true } }) : []
  const standardVersion = activeProgramVersion(programs, versions, 'standard')
  const validatorVersion = activeProgramVersion(programs, versions, 'validator')
  const classifierVersion = activeProgramVersion(programs, versions, 'classifier')

  const cases: PinnedCase[] = revision.mode === 'acm'
    ? acmCases.map(item => ({ testcaseId: item.testcaseId, inputObjectId: item.inputObjectId, outputObjectId: item.outputObjectId, inputName: item.inputName, outputName: item.outputName, source: item.source, subtaskId: null, groupKey: null, groupKind: null }))
    : groupCases.map(item => ({ testcaseId: item.testcaseId, inputObjectId: item.inputObjectId, outputObjectId: item.outputObjectId, inputName: item.inputName, outputName: item.outputName, source: item.source, subtaskId: item.Group.Subtask.subtaskId, groupKey: item.Group.key, groupKind: item.Group.kind }))
  const objectRoles = new Map<string, 'input' | 'output'>()
  for (const item of cases) {
    objectRoles.set(item.inputObjectId, 'input')
    objectRoles.set(item.outputObjectId, 'output')
  }
  const objectRows = objectRoles.size ? await prisma.testdataObject.findMany({ where: { problemId, id: { in: [...objectRoles.keys()] } }, orderBy: { id: 'asc' } }) : []
  const objects = objectRows.map(item => ({ id: item.id, sha256: item.sha256, size: item.size, storageKey: item.storageKey, role: objectRoles.get(item.id)! }))

  const killMap = new Map<string, Set<string>>()
  const featureEvidence: QualityInputSnapshot['featureEvidence'] = []
  for (const candidate of candidates) {
    if (candidate.promotedTestcaseId) featureEvidence.push({ testcaseId: candidate.promotedTestcaseId, featureIds: featureIds(candidate.featureFingerprint), fingerprint: candidate.semanticFingerprint })
    for (const evidence of parseKillEvidence(candidate.selectionOutcome)) {
      const keys = killMap.get(evidence.clusterId) || new Set<string>()
      for (const key of evidence.caseKeys) keys.add(key === 'candidate' && candidate.promotedTestcaseId ? candidate.promotedTestcaseId : key)
      killMap.set(evidence.clusterId, keys)
    }
  }

  const config = parseConfig(revision.judgeConfig)
  const checker = await pinnedChecker(problemId, revision, config)
  const subtaskById = new Map(revisionSubtasks.map(item => [item.id, item]))
  const groupsBySubtask = new Map<string, typeof revisionGroups>()
  for (const group of revisionGroups) groupsBySubtask.set(group.subtaskId, [...(groupsBySubtask.get(group.subtaskId) || []), group])
  const depsBySubtask = new Map<string, number[]>()
  for (const dependency of dependencies) depsBySubtask.set(dependency.subtaskId, [...(depsBySubtask.get(dependency.subtaskId) || []), dependency.DependsOn.subtaskId])
  const caseCount = new Map<string, number>()
  for (const item of groupCases) caseCount.set(item.groupId, (caseCount.get(item.groupId) || 0) + 1)

  return {
    problemId,
    asOfDate: new Date().toISOString().slice(0, 10),
    revision: { id: revision.id, revisionNumber: revision.revisionNumber, mode: revision.mode, createdAt: revision.createdAt.toISOString(), graphHash: revision.graphHash, judgeConfigHash: revision.judgeConfigHash, testdataPath: revision.testdataPath },
    cases,
    objects,
    subtasks: revisionSubtasks.map(subtask => ({
      id: subtask.subtaskId,
      score: subtask.score,
      dependencies: (depsBySubtask.get(subtask.id) || []).sort((a, b) => a - b),
      groups: (groupsBySubtask.get(subtask.id) || []).map(group => ({ key: group.key, kind: group.kind, score: group.score, aggregation: group.aggregation, caseCount: caseCount.get(group.id) || 0 })),
    })),
    corpus: { id: corpus.id, revisionNumber: corpus.revisionNumber, corpusHash: corpus.corpusHash, sampleCount: corpus.sampleCount, clusters: clusters.map(item => ({ id: item.id, weight: Math.max(1, item.weight), frequency: Math.max(1, item.frequency), partition: item.partition, categoryId: item.categoryId })) },
    features: features.map(item => ({ key: item.key, kind: item.kind, importance: importanceOf(item.config), config: asObject(item.config) })),
    killEvidence: [...killMap.entries()].map(([clusterId, keys]) => ({ clusterId, caseKeys: [...keys].sort() })).sort((a, b) => a.clusterId.localeCompare(b.clusterId)),
    featureEvidence: [...new Map(featureEvidence.map(item => [item.testcaseId, item])).values()].sort((a, b) => a.testcaseId.localeCompare(b.testcaseId)),
    submissions: {
      count: submissionCount,
      outcomes: submissions.map(item => ({ fingerprint: stableHash({ language: item.language, code: item.code.replace(/\r\n/g, '\n').trim(), input: item.inputFilename || 'stdin', output: item.outputFilename || 'stdout' }), outcome: `${item.result}:${item.score ?? ''}` })),
    },
    hacks: { count: validHackCount },
    criticalIncidents: criticalIncidents.map(incident => ({
      id: incident.id,
      type: incident.type,
      status: incident.status,
      discoveredAt: incident.discoveredAt.toISOString(),
      confirmedAt: incident.confirmedAt?.toISOString() || null,
    })),
    solutionProfiles: solutionProfiles.map(profile => {
      const run = profile.Submission.CurrentJudgeRun?.status === 'FINALIZED' ? profile.Submission.CurrentJudgeRun : null
      return {
        id: profile.id,
        key: profile.key,
        name: profile.name,
        expectedClass: profile.expectedClass,
        expectedComplexity: profile.expectedComplexity,
        expectedScoreMin: profile.expectedScoreMin,
        expectedScoreMax: profile.expectedScoreMax,
        expectedSubtaskScores: expectedSubtaskScores(profile.expectedSubtaskScores),
        definitionHash: profile.definitionHash,
        definitionRevision: profile.revision,
        source: {
          submissionId: profile.Submission.id,
          evaluatedRevisionId: run?.testSetRevisionId || profile.Submission.testSetRevisionId,
          result: run?.result || profile.Submission.result,
          score: run?.score ?? profile.Submission.score,
          subtasks: observedSubtaskScores(run?.subtasks || profile.Submission.subtasks),
        },
      }
    }),
    programs: {
      standardVersionId: standardVersion?.id || null,
      standardSourceSha256: standardVersion?.sourceSha256 || null,
      validatorVersionId: validatorVersion?.id || null,
      validatorSourceSha256: validatorVersion?.sourceSha256 || null,
      classifierVersionId: classifierVersion?.id || null,
      classifierSourceSha256: classifierVersion?.sourceSha256 || null,
    },
    checker,
  }
}

export async function enqueueQualityEvaluationForRevision(input: { problemId: string; revisionId: string; createdBy: string; corpusRevisionId?: string | null }) {
  const snapshot = await buildPinnedInput(input.problemId, input.revisionId, input.corpusRevisionId)
  const featureSchemaHash = stableHash(snapshot.features)
  const solutionProfileSchemaHash = stableHash(snapshot.solutionProfiles.map(profile => ({ id: profile.id, definitionHash: profile.definitionHash, definitionRevision: profile.definitionRevision })))
  const inputHash = stableHash({ rule: RULE_CONFIG, snapshot })
  // The same Revision/Corpus may be evaluated again when a Feature schema,
  // active program, rule input or evidence corpus changes. Only a byte-for-byte
  // equivalent pinned input is idempotent; older certificates remain history.
  const existingSnapshot = await prisma.testSetQualitySnapshot.findFirst({ where: { inputHash } })
  if (existingSnapshot) return { queued: false, jobId: existingSnapshot.evaluationJobId, snapshotId: existingSnapshot.id, status: 'SUCCEEDED' as const }
  const existing = await prisma.qualityEvaluationJob.findUnique({ where: { inputHash } })
  if (existing) {
    if (existing.status === 'FAILED') {
      const retried = await prisma.qualityEvaluationJob.updateMany({
        where: { id: existing.id, status: 'FAILED' },
        data: { status: 'QUEUED', attempts: 0, leaseOwner: null, leaseExpiresAt: null, fencingToken: null, startedAt: null, finishedAt: null, errorCode: null, errorMessage: null },
      })
      if (retried.count) return { queued: true, jobId: existing.id, status: 'QUEUED' as const }
    }
    return { queued: existing.status === 'QUEUED' || existing.status === 'RUNNING', jobId: existing.id, status: existing.status }
  }
  try {
    const job = await prisma.qualityEvaluationJob.create({ data: {
      id: crypto.randomUUID(),
      problemId: input.problemId,
      revisionId: input.revisionId,
      corpusRevisionId: snapshot.corpus.id,
      qualityRuleVersion: QUALITY_RULE_VERSION,
      ruleConfig: RULE_CONFIG as unknown as Prisma.InputJsonValue,
      inputSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      inputHash,
      featureSchemaHash,
      solutionProfileSchemaHash,
      standardVersionId: snapshot.programs.standardVersionId,
      validatorVersionId: snapshot.programs.validatorVersionId,
      classifierVersionId: snapshot.programs.classifierVersionId,
      checkerHash: snapshot.checker.hash,
      judgeConfigHash: snapshot.revision.judgeConfigHash,
      createdBy: input.createdBy,
    } })
    return { queued: true, jobId: job.id, status: job.status }
  } catch (error) {
    if (asObject(error).code !== 'P2002') throw error
    const raced = await prisma.qualityEvaluationJob.findUnique({ where: { inputHash } })
    if (!raced) throw error
    return { queued: raced.status === 'QUEUED' || raced.status === 'RUNNING', jobId: raced.id, status: raced.status }
  }
}

function parseQualityInput(value: Prisma.JsonValue): QualityInputSnapshot {
  return value as unknown as QualityInputSnapshot
}

export async function claimQualityVerificationJob(judgeId: string) {
  return prisma.$transaction(async tx => {
    await tx.qualityEvaluationJob.updateMany({
      where: { verificationStatus: 'running', verificationLeaseExpiresAt: { lte: new Date() }, verificationAttempts: { lt: 3 } },
      data: { verificationStatus: 'pending', verificationJudgeId: null, verificationFencingToken: null, verificationLeaseExpiresAt: null },
    })
    await tx.qualityEvaluationJob.updateMany({
      where: { verificationStatus: 'running', verificationLeaseExpiresAt: { lte: new Date() }, verificationAttempts: { gte: 3 } },
      data: {
        verificationStatus: 'complete', verificationJudgeId: null, verificationFencingToken: null, verificationLeaseExpiresAt: null,
        verificationReport: { outcome: 'not_ready', code: 'QUALITY_VERIFICATION_RETRY_EXHAUSTED' },
      },
    })
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "QualityEvaluationJob"
      WHERE status = 'QUEUED' AND "verificationStatus" = 'pending'
      ORDER BY "queuedAt" ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    `
    if (!rows[0]) return null
    const job = await tx.qualityEvaluationJob.findUnique({ where: { id: rows[0].id } })
    if (!job) return null
    const input = parseQualityInput(job.inputSnapshot)
    const versionIds = [job.standardVersionId, job.validatorVersionId, job.classifierVersionId].filter((id): id is string => Boolean(id))
    const versions = versionIds.length ? await tx.problemJudgeProgramVersion.findMany({
      where: { id: { in: versionIds }, problemId: job.problemId },
      select: { id: true, language: true, source: true, sourceSha256: true, protocol: true, compileStatus: true, lifecycleStatus: true },
    }) : []
    const byId = new Map(versions.map(version => [version.id, version]))
    const standard = job.standardVersionId ? byId.get(job.standardVersionId) : null
    const validator = job.validatorVersionId ? byId.get(job.validatorVersionId) : null
    const classifier = job.classifierVersionId ? byId.get(job.classifierVersionId) : null
    const validVersion = (version: typeof standard, expectedHash: string | null) => Boolean(version && version.compileStatus === 'passed' && version.lifecycleStatus === 'active' && version.sourceSha256 === expectedHash && sha256(version.source) === expectedHash)
    const prerequisitesReady = validVersion(standard, input.programs.standardSourceSha256)
      && validVersion(validator, input.programs.validatorSourceSha256)
      && (input.revision.mode !== 'oi' || validVersion(classifier, input.programs.classifierSourceSha256))
      && input.checker.configured
    if (!prerequisitesReady) {
      await tx.qualityEvaluationJob.update({
        where: { id: job.id },
        data: { verificationStatus: 'complete', verificationReport: { outcome: 'not_ready', code: 'QUALITY_VERIFICATION_PREREQUISITE_NOT_READY' } },
      })
      return null
    }
    const fencingToken = crypto.randomUUID()
    const changed = await tx.qualityEvaluationJob.updateMany({
      where: { id: job.id, status: 'QUEUED', verificationStatus: 'pending' },
      data: {
        verificationStatus: 'running', verificationJudgeId: judgeId, verificationFencingToken: fencingToken,
        verificationLeaseExpiresAt: new Date(Date.now() + 60 * 60_000), verificationAttempts: { increment: 1 },
      },
    })
    if (changed.count !== 1) return null
    const expectedSubtasksByCase = new Map<string, Set<number>>()
    const physicalCases = new Map<string, { key: string; input: string; output: string }>()
    for (const item of input.cases) {
      const key = `${item.inputObjectId}:${item.outputObjectId}`
      physicalCases.set(key, { key, input: item.inputName, output: item.outputName })
      if (item.subtaskId != null) {
        const ids = expectedSubtasksByCase.get(key) || new Set<number>()
        ids.add(item.subtaskId)
        expectedSubtasksByCase.set(key, ids)
      }
    }
    const testdataRoot = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
    return {
      taskType: 'quality_evaluation_verification' as const,
      jobId: job.id,
      problemId: job.problemId,
      fencingToken,
      testdataPath: path.join(testdataRoot, job.problemId, input.revision.testdataPath),
      problemConfig: parseConfig((await tx.problemTestSetRevision.findUniqueOrThrow({ where: { id: job.revisionId }, select: { judgeConfig: true } })).judgeConfig),
      standard: { language: standard!.language, source: standard!.source },
      validator: { language: validator!.language, source: validator!.source },
      classifier: classifier ? { language: classifier.language, source: classifier.source } : null,
      knownSubtaskIds: input.subtasks.map(item => item.id),
      cases: [...physicalCases.values()].map(item => ({ ...item, expectedSubtaskIds: [...(expectedSubtasksByCase.get(item.key) || [])].sort((a, b) => a - b) })),
    }
  })
}

export async function finalizeQualityVerificationJob(judgeId: string, payload: any) {
  const jobId = String(payload?.jobId || '')
  const fencingToken = String(payload?.fencingToken || '')
  if (!jobId || !fencingToken) return false
  if (payload?.retryable) {
    const changed = await prisma.qualityEvaluationJob.updateMany({
      where: { id: jobId, status: 'QUEUED', verificationStatus: 'running', verificationJudgeId: judgeId, verificationFencingToken: fencingToken },
      data: { verificationStatus: 'pending', verificationJudgeId: null, verificationFencingToken: null, verificationLeaseExpiresAt: null },
    })
    return changed.count === 1
  }
  const report = asObject(payload?.report)
  if (!['passed', 'not_ready', 'critical'].includes(String(report.outcome || ''))) throw new Error('QUALITY_VERIFICATION_REPORT_INVALID')
  const changed = await prisma.qualityEvaluationJob.updateMany({
    where: { id: jobId, status: 'QUEUED', verificationStatus: 'running', verificationJudgeId: judgeId, verificationFencingToken: fencingToken },
    data: {
      verificationStatus: 'complete', verificationReport: report as Prisma.InputJsonValue,
      verificationJudgeId: null, verificationFencingToken: null, verificationLeaseExpiresAt: null,
    },
  })
  return changed.count === 1
}

export async function recoverQualityVerificationJobs(judgeId: string) {
  return prisma.qualityEvaluationJob.updateMany({
    where: { status: 'QUEUED', verificationStatus: 'running', verificationJudgeId: judgeId },
    data: { verificationStatus: 'pending', verificationJudgeId: null, verificationFencingToken: null, verificationLeaseExpiresAt: null },
  })
}

export async function requestQualityEvaluation(user: JwtPayload, problemId: string, body: unknown) {
  const problem = await manageableProblem(user, problemId)
  const request = asObject(body)
  const revisionId = typeof request.revisionId === 'string' ? request.revisionId : problem.latestTestSetRevisionId
  if (!revisionId) fail(409, 'TEST_SET_REVISION_NOT_READY', '题目尚无正式测试集版本')
  return enqueueQualityEvaluationForRevision({ problemId, revisionId, createdBy: user.userId, corpusRevisionId: typeof request.corpusRevisionId === 'string' ? request.corpusRevisionId : null })
}

export async function enqueueLatestQualityAfterEvidenceChange(problemId: string, createdBy: string) {
  const [problem, corpus] = await Promise.all([
    prisma.problem.findUnique({ where: { id: problemId }, select: { latestTestSetRevisionId: true } }),
    prisma.wrongCorpusRevision.findFirst({ where: { problemId, status: 'active' }, orderBy: { revisionNumber: 'desc' }, select: { id: true } }),
  ])
  if (!problem?.latestTestSetRevisionId || !corpus) return null
  try {
    return await enqueueQualityEvaluationForRevision({
      problemId,
      revisionId: problem.latestTestSetRevisionId,
      corpusRevisionId: corpus.id,
      createdBy,
    })
  } catch (error) {
    // Updating an evidence definition is authoritative even when a quality job
    // cannot currently be queued (for example, while a Revision is being
    // published). The old certificate is still surfaced as STALE and the next
    // publication/manual request will enqueue the fixed input set.
    console.warn('[quality-evaluation] evidence change enqueue skipped', { problemId, error: (error as Error).message })
    return null
  }
}

type SolutionProfileDefinition = {
  key: string
  name: string
  expectedClass: string
  expectedComplexity: string | null
  expectedScoreMin: number
  expectedScoreMax: number
  expectedSubtaskScores: Array<{ subtaskId: number; min: number; max: number }>
  submissionId: number
  status: 'active' | 'retired'
}

function requiredText(value: unknown, field: string, maximum: number) {
  const result = String(value ?? '').trim()
  if (!result || result.length > maximum) fail(422, 'INVALID_SOLUTION_PROFILE', `${field} 必须为 1～${maximum} 个字符`)
  return result
}

function scoreValue(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) fail(422, 'INVALID_SOLUTION_PROFILE', `${field} 必须是 0～100 的整数`)
  return Number(value)
}

async function parseSolutionProfileDefinition(user: JwtPayload, problemId: string, value: unknown, existing?: { key: string; name: string; expectedClass: string; expectedComplexity: string | null; expectedScoreMin: number; expectedScoreMax: number; expectedSubtaskScores: Prisma.JsonValue | null; submissionId: number; status: string }): Promise<SolutionProfileDefinition> {
  const input = asObject(value)
  const key = requiredText(input.key ?? existing?.key, 'Profile Key', 64).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(key)) fail(422, 'INVALID_SOLUTION_PROFILE', 'Profile Key 只能包含小写字母、数字、点、下划线和连字符')
  const name = requiredText(input.name ?? existing?.name, '名称', 100)
  const expectedClass = requiredText(input.expectedClass ?? existing?.expectedClass, '预期算法类别', 100)
  const complexityValue = input.expectedComplexity === undefined ? existing?.expectedComplexity : input.expectedComplexity
  const expectedComplexity = complexityValue == null || String(complexityValue).trim() === '' ? null : requiredText(complexityValue, '预期复杂度', 200)
  const expectedScoreMin = scoreValue(input.expectedScoreMin ?? existing?.expectedScoreMin, '最低预期得分')
  const expectedScoreMax = scoreValue(input.expectedScoreMax ?? existing?.expectedScoreMax, '最高预期得分')
  if (expectedScoreMin > expectedScoreMax) fail(422, 'INVALID_SOLUTION_PROFILE', '最低预期得分不能高于最高预期得分')
  const submissionId = Number(input.submissionId ?? existing?.submissionId)
  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) fail(422, 'INVALID_SOLUTION_PROFILE', '必须选择一条本题本地提交作为 Reference Solution')
  const statusValue = String(input.status ?? existing?.status ?? 'active')
  if (statusValue !== 'active' && statusValue !== 'retired') fail(422, 'INVALID_SOLUTION_PROFILE', 'Profile 状态无效')

  const rawSubtasks = input.expectedSubtaskScores === undefined
    ? expectedSubtaskScores(existing?.expectedSubtaskScores)
    : input.expectedSubtaskScores
  if (!Array.isArray(rawSubtasks)) fail(422, 'INVALID_SOLUTION_PROFILE', 'Subtask 预期分必须是数组')
  const parsedSubtasks = rawSubtasks.map((item, index) => {
    const record = asObject(item)
    const subtaskId = Number(record.subtaskId)
    if (!Number.isSafeInteger(subtaskId) || subtaskId <= 0) fail(422, 'INVALID_SOLUTION_PROFILE', `Subtask 预期分第 ${index + 1} 项 ID 无效`)
    const min = scoreValue(record.min, `Subtask ${subtaskId} 最低分`)
    const max = scoreValue(record.max, `Subtask ${subtaskId} 最高分`)
    if (min > max) fail(422, 'INVALID_SOLUTION_PROFILE', `Subtask ${subtaskId} 最低分不能高于最高分`)
    return { subtaskId, min, max }
  })
  if (new Set(parsedSubtasks.map(item => item.subtaskId)).size !== parsedSubtasks.length) fail(422, 'INVALID_SOLUTION_PROFILE', '同一个 Subtask 只能配置一次预期分')

  const problem = await prisma.problem.findUnique({ where: { id: problemId }, select: { latestTestSetRevisionId: true } })
  const [submission, revisionSubtasks] = await Promise.all([
    prisma.submission.findFirst({
      where: {
        id: submissionId, problemInternalId: problemId, submitMethod: 'local',
        ...(!isPlatformManager(user.accountRole || user.role) ? { userId: user.userId } : {}),
      },
      select: { id: true, testSetRevisionId: true, result: true, CurrentJudgeRun: { select: { status: true, testSetRevisionId: true, result: true } } },
    }),
    problem?.latestTestSetRevisionId
      ? prisma.problemTestSetRevisionSubtask.findMany({ where: { revisionId: problem.latestTestSetRevisionId }, select: { subtaskId: true, score: true } })
      : Promise.resolve([]),
  ])
  if (!submission) fail(422, 'SOLUTION_PROFILE_SUBMISSION_INVALID', 'Reference Solution 必须是本题可追溯的本地提交')
  const unstableResults = new Set(['queuing', 'judging', 'compiling', 'system_error'])
  const run = submission.CurrentJudgeRun
  const currentRunFinalized = run?.status === 'FINALIZED' && Boolean(run.testSetRevisionId) && Boolean(run.result) && !unstableResults.has(String(run.result).toLowerCase())
  const legacyFinalized = !run && Boolean(submission.testSetRevisionId) && Boolean(submission.result) && !unstableResults.has(String(submission.result).toLowerCase())
  const evaluatedRevisionId = currentRunFinalized ? run!.testSetRevisionId : legacyFinalized ? submission.testSetRevisionId : null
  if (!evaluatedRevisionId) fail(422, 'SOLUTION_PROFILE_SUBMISSION_NOT_FINALIZED', 'Reference Solution 尚未形成固定 Revision 的终态评测')
  const validSubtaskIds = new Set(revisionSubtasks.map(item => item.subtaskId))
  if (parsedSubtasks.some(item => !validSubtaskIds.has(item.subtaskId))) fail(422, 'SOLUTION_PROFILE_SUBTASK_INVALID', '预期分包含当前正式 Revision 不存在的 Subtask')
  const subtaskFullScores = new Map(revisionSubtasks.map(item => [item.subtaskId, item.score]))
  const scoreAboveSubtaskMaximum = parsedSubtasks.find(item => item.max > (subtaskFullScores.get(item.subtaskId) ?? 0))
  if (scoreAboveSubtaskMaximum) {
    fail(
      422,
      'SOLUTION_PROFILE_SUBTASK_SCORE_INVALID',
      `Subtask ${scoreAboveSubtaskMaximum.subtaskId} 的预期分不能高于该 Subtask 满分 ${subtaskFullScores.get(scoreAboveSubtaskMaximum.subtaskId)}`,
    )
  }
  return { key, name, expectedClass, expectedComplexity, expectedScoreMin, expectedScoreMax, expectedSubtaskScores: parsedSubtasks.sort((a, b) => a.subtaskId - b.subtaskId), submissionId, status: statusValue }
}

function solutionProfileDto(profile: any) {
  const run = profile.Submission?.CurrentJudgeRun?.status === 'FINALIZED' ? profile.Submission.CurrentJudgeRun : null
  return {
    id: profile.id,
    key: profile.key,
    name: profile.name,
    expectedClass: profile.expectedClass,
    expectedComplexity: profile.expectedComplexity,
    expectedScoreMin: profile.expectedScoreMin,
    expectedScoreMax: profile.expectedScoreMax,
    expectedSubtaskScores: expectedSubtaskScores(profile.expectedSubtaskScores),
    sourceType: profile.sourceType,
    submissionId: profile.submissionId,
    definitionHash: profile.definitionHash,
    revision: profile.revision,
    status: profile.status,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    observed: profile.Submission ? {
      revisionId: run?.testSetRevisionId || profile.Submission.testSetRevisionId,
      result: run?.result || profile.Submission.result,
      score: run?.score ?? profile.Submission.score,
      subtasks: observedSubtaskScores(run?.subtasks || profile.Submission.subtasks),
    } : null,
  }
}

const solutionProfileSubmission = { select: {
  id: true, testSetRevisionId: true, result: true, score: true, subtasks: true,
  CurrentJudgeRun: { select: { status: true, testSetRevisionId: true, result: true, score: true, subtasks: true } },
} } as const

export async function listSolutionProfiles(user: JwtPayload, problemId: string) {
  await manageableProblem(user, problemId)
  const profiles = await prisma.problemSolutionProfile.findMany({ where: { problemId }, orderBy: [{ status: 'asc' }, { key: 'asc' }], include: { Submission: solutionProfileSubmission } })
  return profiles.map(solutionProfileDto)
}

export async function createSolutionProfile(user: JwtPayload, problemId: string, body: unknown) {
  await manageableProblem(user, problemId)
  const definition = await parseSolutionProfileDefinition(user, problemId, body)
  const definitionHash = stableHash(definition)
  try {
    const profile = await prisma.problemSolutionProfile.create({ data: {
      id: crypto.randomUUID(), problemId, ...definition,
      expectedSubtaskScores: definition.expectedSubtaskScores as unknown as Prisma.InputJsonValue,
      sourceType: 'submission', definitionHash, createdBy: user.userId,
    }, include: { Submission: solutionProfileSubmission } })
    await enqueueLatestQualityAfterEvidenceChange(problemId, user.userId)
    return solutionProfileDto(profile)
  } catch (error) {
    if (asObject(error).code === 'P2002') fail(409, 'SOLUTION_PROFILE_CONFLICT', 'Profile Key 或 Reference Submission 已被使用')
    throw error
  }
}

export async function updateSolutionProfile(user: JwtPayload, problemId: string, profileId: string, body: unknown) {
  await manageableProblem(user, problemId)
  const current = await prisma.problemSolutionProfile.findFirst({ where: { id: profileId, problemId } })
  if (!current) fail(404, 'SOLUTION_PROFILE_NOT_FOUND', 'Solution Profile 不存在')
  const expectedRevision = Number(asObject(body).expectedRevision)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) fail(422, 'SOLUTION_PROFILE_REVISION_REQUIRED', '必须提供当前 Profile revision')
  const definition = await parseSolutionProfileDefinition(user, problemId, body, current)
  const definitionHash = stableHash(definition)
  try {
    const changed = await prisma.problemSolutionProfile.updateMany({ where: { id: profileId, problemId, revision: expectedRevision }, data: {
      ...definition,
      expectedSubtaskScores: definition.expectedSubtaskScores as unknown as Prisma.InputJsonValue,
      definitionHash, revision: { increment: 1 },
    } })
    if (!changed.count) fail(409, 'SOLUTION_PROFILE_STALE', 'Profile 已被其他管理员修改，请重新加载')
    const profile = await prisma.problemSolutionProfile.findUniqueOrThrow({ where: { id: profileId }, include: { Submission: solutionProfileSubmission } })
    await enqueueLatestQualityAfterEvidenceChange(problemId, user.userId)
    return solutionProfileDto(profile)
  } catch (error) {
    if (error instanceof ProblemQualityError) throw error
    if (asObject(error).code === 'P2002') fail(409, 'SOLUTION_PROFILE_CONFLICT', 'Profile Key 或 Reference Submission 已被使用')
    throw error
  }
}

function clamp01(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) }
function ratio(value: number, target: number) { return clamp01(value / target) }
function rounded(value: number, maximum: number) { return Math.max(0, Math.min(maximum, Math.round(value))) }

function clusterCoverage(clusters: PinnedCluster[], killed: Map<string, Set<string>>, caseKeys: Set<string>) {
  const total = clusters.reduce((sum, item) => sum + item.weight, 0)
  const killedWeight = clusters.reduce((sum, item) => {
    const evidence = killed.get(item.id)
    return sum + (evidence && [...evidence].some(key => caseKeys.has(key)) ? item.weight : 0)
  }, 0)
  return total ? killedWeight / total : 0
}

function sizeBucket(size: number) { return size < 1024 ? 'small' : size < 64 * 1024 ? 'medium' : 'large' }

function jaccard(left: Set<string>, right: Set<string>) {
  const union = new Set([...left, ...right])
  if (!union.size) return 1
  let intersection = 0
  for (const item of left) if (right.has(item)) intersection++
  return intersection / union.size
}

async function verifyObjectIntegrity(problemId: string, objects: PinnedObject[]) {
  const issues: Array<{ code: string; objectId: string; message: string }> = []
  for (const object of objects) {
    try {
      const content = await getTestdataBlobStore().get(problemBlobKey(problemId, object.storageKey))
      if (content.length !== object.size || sha256(content) !== object.sha256) issues.push({ code: 'TESTDATA_OBJECT_HASH_MISMATCH', objectId: object.id, message: '测试数据对象大小或哈希不一致' })
    } catch {
      issues.push({ code: 'TESTDATA_OBJECT_MISSING', objectId: object.id, message: '测试数据对象不可读' })
    }
  }
  return issues
}

async function verifyCheckerIntegrity(problemId: string, revision: { testdataPath: string }, checker: QualityInputSnapshot['checker']) {
  if (!checker.asset) return [] as Array<{ code: string; objectId: string; message: string }>
  try {
    const revisionRoot = await revisionAbsolutePath(problemId, revision)
    const absolute = path.resolve(revisionRoot, checker.asset.fileName)
    if (absolute === revisionRoot || !absolute.startsWith(`${revisionRoot}${path.sep}`)) throw new Error('invalid checker path')
    const content = await fs.promises.readFile(absolute)
    if (content.length !== checker.asset.size || sha256(content) !== checker.asset.sha256) {
      return [{ code: 'CHECKER_ASSET_HASH_MISMATCH', objectId: checker.asset.fileName, message: 'Revision 中的 Checker 文件大小或哈希不一致' }]
    }
    return []
  } catch {
    return [{ code: 'CHECKER_ASSET_MISSING', objectId: checker.asset.fileName, message: 'Revision 中固定的 Checker 文件不可读' }]
  }
}

export async function calculateQualitySnapshot(job: {
  id: string
  problemId: string
  revisionId: string
  corpusRevisionId: string
  qualityRuleVersion: string
  ruleConfig: Prisma.JsonValue
  inputHash: string
  featureSchemaHash: string
  solutionProfileSchemaHash: string
  standardVersionId: string | null
  validatorVersionId: string | null
  classifierVersionId: string | null
  checkerHash: string
  judgeConfigHash: string
  inputSnapshot: Prisma.JsonValue
  verificationReport: Prisma.JsonValue | null
}) {
  const input = job.inputSnapshot as unknown as QualityInputSnapshot
  const verification = job.verificationReport as unknown as QualityVerificationReport | null
  // V1 has one executable rule implementation. A future rule revision must
  // retain its own evaluator instead of silently running queued V1 jobs with a
  // newer formula. Redundant columns are checked against the JSON snapshot so
  // corrupt/misconstructed rows fail as infrastructure errors, never as a
  // misleading quality certificate.
  if (job.qualityRuleVersion !== QUALITY_RULE_VERSION
    || stableHash(job.ruleConfig) !== stableHash(RULE_CONFIG)
    || stableHash({ rule: job.ruleConfig, snapshot: input }) !== job.inputHash
    || job.problemId !== input.problemId
    || job.revisionId !== input.revision.id
    || job.corpusRevisionId !== input.corpus.id
    || job.featureSchemaHash !== stableHash(input.features)
    || job.solutionProfileSchemaHash !== stableHash(input.solutionProfiles.map(profile => ({ id: profile.id, definitionHash: profile.definitionHash, definitionRevision: profile.definitionRevision })))
    || (job.standardVersionId ?? null) !== (input.programs.standardVersionId ?? null)
    || (job.validatorVersionId ?? null) !== (input.programs.validatorVersionId ?? null)
    || (job.classifierVersionId ?? null) !== (input.programs.classifierVersionId ?? null)
    || job.checkerHash !== input.checker.hash
    || job.judgeConfigHash !== input.revision.judgeConfigHash) {
    throw new Error('QUALITY_EVALUATION_PINNED_INPUT_MISMATCH')
  }
  const criticalIssues = await verifyObjectIntegrity(job.problemId, input.objects)
  criticalIssues.push(...await verifyCheckerIntegrity(job.problemId, input.revision, input.checker))
  if (verification?.outcome === 'critical') {
    for (const item of verification.cases || []) {
      if (item.validatorPassed && item.classifierPassed !== false) continue
      criticalIssues.push({
        code: item.code || (!item.validatorPassed ? 'VALIDATOR_REJECTED_CANONICAL_INPUT' : 'CLASSIFIER_SUBTASK_MISMATCH'),
        objectId: item.key,
        message: !item.validatorPassed ? 'Validator 拒绝正式测试点输入' : 'Classifier 结果与 Revision 的 Subtask 关系不一致',
      })
    }
    if (!verification.standard?.passed) criticalIssues.push({ code: 'STANDARD_CHECKER_SELF_TEST_FAILED', objectId: job.revisionId, message: 'STD 无法通过当前 Revision 与 Checker 的全量自检' })
    if (!verification.checker?.passed) criticalIssues.push({ code: 'CHECKER_NEGATIVE_PROBE_ACCEPTED', objectId: job.revisionId, message: 'Checker 接受了确定错误的负向探针输出' })
  }
  for (const incident of input.criticalIncidents || []) {
    criticalIssues.push({
      code: 'CONFIRMED_CRITICAL_INCIDENT',
      objectId: incident.id,
      message: `该 Revision 存在已确认的严重质量事故（${incident.type}）`,
    })
  }
  const warnings: Array<{ code: string; message: string }> = []
  const actualRevision = await prisma.problemTestSetRevision.findUnique({ where: { id: job.revisionId }, select: { judgeConfig: true, judgeConfigHash: true, graphHash: true } })
  if (!actualRevision || sha256(actualRevision.judgeConfig) !== input.revision.judgeConfigHash || actualRevision.judgeConfigHash !== input.revision.judgeConfigHash || actualRevision.graphHash !== input.revision.graphHash) {
    criticalIssues.push({ code: 'REVISION_INTEGRITY_MISMATCH', objectId: job.revisionId, message: '不可变测试集投影完整性校验失败' })
  }
  const uniqueObjects = new Set(input.objects.map(item => item.id))
  const revisionComplete = input.cases.length > 0 && uniqueObjects.size === new Set(input.cases.flatMap(item => [item.inputObjectId, item.outputObjectId])).size
  const physicalCases = [...new Map(input.cases.map(item => [`${item.inputObjectId}:${item.outputObjectId}`, item])).values()]
  const verificationReady = verification?.outcome === 'passed'
  const standardReady = Boolean(input.programs.standardVersionId) && verificationReady && verification.standard.passed
  const validatorReady = Boolean(input.programs.validatorVersionId) && verificationReady && verification.validator.failed === 0
  const classifierReady = input.revision.mode !== 'oi' || Boolean(input.programs.classifierVersionId) && verificationReady && verification.classifier.failed === 0
  const evaluationClusters = input.corpus.clusters.filter(item => item.partition === 'evaluation')
  const holdoutClusters = input.corpus.clusters.filter(item => item.partition === 'holdout')
  const corpusReady = evaluationClusters.length > 0 && holdoutClusters.length > 0
  if (!classifierReady) warnings.push({ code: 'CLASSIFIER_NOT_ACTIVE', message: 'OI Classifier 未激活，Subtask 一致性无法获得满分' })
  if (!input.features.length) warnings.push({ code: 'FEATURE_SCHEMA_EMPTY', message: '未配置 Feature Definition，语义覆盖证据不足' })
  if (!input.corpus.clusters.some(item => item.partition === 'holdout')) warnings.push({ code: 'HOLDOUT_EMPTY', message: 'Hidden Holdout 为空，区分能力置信度受限' })

  const checkerReady = input.checker.configured && verificationReady && verification.checker.passed
  const qualityStatus = criticalIssues.length ? 'CRITICAL' as const : !standardReady || !validatorReady || !checkerReady || !revisionComplete || !corpusReady ? 'NOT_READY' as const : 'READY' as const
  const generatedCases = physicalCases.filter(item => item.source === 'generated' || item.source === 'hack')
  const generatedEvidence = new Set(input.featureEvidence.map(item => item.testcaseId))
  const generatorReproducibility = generatedCases.length ? generatedCases.filter(item => item.testcaseId && generatedEvidence.has(item.testcaseId)).length / generatedCases.length : 1
  const config = actualRevision ? parseConfig(actualRevision.judgeConfig) : {}
  const configComplete = Boolean(config.mode && (config.time || config.timeLimit) && (config.memory || config.memoryLimit))
  const correctnessScore = rounded(
    (standardReady ? 6 : 0) +
    (validatorReady ? 6 : 0) +
    (checkerReady ? 5 : 0) +
    4 * generatorReproducibility +
    (classifierReady ? 4 : 0) +
    (criticalIssues.length ? 0 : revisionComplete ? 3 : 0) +
    (configComplete ? 2 : 0), 30,
  )

  const caseKeys = new Set(physicalCases.flatMap(item => [item.testcaseId, item.inputObjectId].filter((key): key is string => Boolean(key))))
  const killMap = new Map(input.killEvidence.map(item => [item.clusterId, new Set(item.caseKeys)]))
  const evaluationCoverage = clusterCoverage(evaluationClusters, killMap, caseKeys)
  const holdoutCoverage = clusterCoverage(holdoutClusters, killMap, caseKeys)
  const weightedKillCoverage = 0.4 * evaluationCoverage + 0.6 * holdoutCoverage
  const discriminationScore = rounded(25 * weightedKillCoverage, 25)

  const featureWeight = (item: PinnedFeature) => item.importance === 'critical' ? 3 : item.importance === 'important' ? 2 : 1
  const coveredFeatures = new Set(input.featureEvidence.filter(item => caseKeys.has(item.testcaseId)).flatMap(item => item.featureIds))
  const totalFeatureWeight = input.features.reduce((sum, item) => sum + featureWeight(item), 0)
  const coveredFeatureWeight = input.features.reduce((sum, item) => sum + (coveredFeatures.has(item.key) ? featureWeight(item) : 0), 0)
  const criticalFeatures = input.features.filter(item => item.importance === 'critical')
  const featureCoverage = totalFeatureWeight ? coveredFeatureWeight / totalFeatureWeight : 0
  const criticalFeatureCoverage = criticalFeatures.length ? criticalFeatures.filter(item => coveredFeatures.has(item.key)).length / criticalFeatures.length : (input.features.length ? 1 : 0)
  const subtaskCoverage = input.revision.mode === 'oi'
    ? (input.subtasks.length ? input.subtasks.filter(item => input.cases.some(testcase => testcase.subtaskId === item.id)).length / input.subtasks.length : 0)
    : (input.cases.length ? 1 : 0)
  const inputSizes = input.objects.filter(item => item.role === 'input').map(item => item.size)
  const distributionCoverage = inputSizes.length ? new Set(inputSizes.map(sizeBucket)).size / 3 : 0
  const structuralCoverage = input.features.length ? featureCoverage : 0
  const coverageScore = rounded(5 * criticalFeatureCoverage + 4 * structuralCoverage + 3 * subtaskCoverage + 3 * distributionCoverage, 15)

  const caseKillSets = physicalCases.map(item => {
    const keys = new Set([item.testcaseId, item.inputObjectId].filter((key): key is string => Boolean(key)))
    return new Set(input.corpus.clusters.filter(cluster => {
      const evidence = killMap.get(cluster.id)
      return evidence && [...evidence].some(key => keys.has(key))
    }).map(cluster => cluster.id))
  })
  let similarityTotal = 0, similarityPairs = 0
  for (let left = 0; left < caseKillSets.length; left++) for (let right = left + 1; right < caseKillSets.length; right++) {
    similarityTotal += jaccard(caseKillSets[left], caseKillSets[right]); similarityPairs++
  }
  const killDiversity = similarityPairs ? 1 - similarityTotal / similarityPairs : (caseKillSets.length ? 0.5 : 0)
  const fingerprints = input.featureEvidence.filter(item => caseKeys.has(item.testcaseId)).map(item => item.fingerprint || item.featureIds.sort().join('|')).filter(Boolean)
  const featureDiversity = physicalCases.length ? Math.min(1, new Set(fingerprints).size / physicalCases.length) : 0
  const distributionDiversity = inputSizes.length ? new Set(inputSizes.map(sizeBucket)).size / Math.min(3, inputSizes.length) : 0
  const diversityScore = rounded(10 * (0.4 * featureDiversity + 0.4 * killDiversity + 0.2 * distributionDiversity), 10)

  let subtaskQualityScore = 10
  let solutionProfileAlignment: number | null = null
  let evaluatedSolutionProfileCount = 0
  if (input.revision.mode === 'oi') {
    const ids = new Set(input.subtasks.map(item => item.id))
    const totalScoreValid = input.subtasks.reduce((sum, item) => sum + item.score, 0) === 100
    const dependenciesValid = input.subtasks.every(item => item.dependencies.every(id => ids.has(id) && id !== item.id))
    const officialValid = input.subtasks.every(item => item.groups.some(group => group.kind === 'official' && group.caseCount > 0))
    const gatesValid = input.subtasks.every(item => item.groups.filter(group => group.kind === 'hack_gate').length === 1)
    const groupScoresValid = input.subtasks.every(item => item.groups.filter(group => group.kind === 'official').reduce((sum, group) => sum + group.score, 0) === item.score)
    const structureScore = [totalScoreValid, dependenciesValid, officialValid, gatesValid, groupScoresValid].filter(Boolean).length
    const evaluatedProfiles = input.solutionProfiles.filter(profile => profile.source.evaluatedRevisionId === input.revision.id && profile.source.score != null)
    evaluatedSolutionProfileCount = evaluatedProfiles.length
    if (!input.solutionProfiles.length) {
      warnings.push({ code: 'SOLUTION_PROFILE_EMPTY', message: '未配置 Reference Solution Profile，Subtask 只能获得结构分' })
    } else if (evaluatedProfiles.length !== input.solutionProfiles.length) {
      warnings.push({ code: 'SOLUTION_PROFILE_EVIDENCE_INCOMPLETE', message: '部分 Reference Solution Profile 尚未在当前 Revision 上形成终态评分' })
    }
    if (evaluatedProfiles.length) {
      const aligned = evaluatedProfiles.filter(profile => {
        const totalScore = profile.source.score!
        if (totalScore < profile.expectedScoreMin || totalScore > profile.expectedScoreMax) return false
        const actualSubtasks = new Map(profile.source.subtasks.map(item => [item.subtaskId, item.score]))
        return profile.expectedSubtaskScores.every(expected => {
          const observed = actualSubtasks.get(expected.subtaskId)
          return observed != null && observed >= expected.min && observed <= expected.max
        })
      }).length
      solutionProfileAlignment = aligned / input.solutionProfiles.length
    } else {
      solutionProfileAlignment = 0
    }
    subtaskQualityScore = structureScore + rounded(5 * solutionProfileAlignment, 5)
  }

  const groupedOutcomes = new Map<string, Set<string>>()
  for (const item of input.submissions.outcomes) groupedOutcomes.set(item.fingerprint, new Set([...(groupedOutcomes.get(item.fingerprint) || []), item.outcome]))
  const repeated = [...groupedOutcomes.values()].filter(outcomes => outcomes.size || false)
  const comparable = [...new Map(input.submissions.outcomes.map(item => [item.fingerprint, input.submissions.outcomes.filter(other => other.fingerprint === item.fingerprint).length])).entries()].filter(([, count]) => count >= 2)
  const stableComparable = comparable.filter(([fingerprint]) => (groupedOutcomes.get(fingerprint)?.size || 0) === 1).length
  const crossJudgeStability = comparable.length ? stableComparable / comparable.length : 0.5
  if (!comparable.length) warnings.push({ code: 'STABILITY_SAMPLE_LOW', message: '没有足够的重复运行样本，稳定性置信度受限' })
  const stabilityScore = rounded((criticalIssues.length ? 0 : 3) + 4 * crossJudgeStability + 2 * (configComplete ? 1 : 0) + generatorReproducibility, 10)

  const behaviorClusterCount = input.corpus.clusters.length
  const evaluationClusterCount = evaluationClusters.length
  const holdoutClusterCount = holdoutClusters.length
  const evaluationTime = Date.parse(`${input.asOfDate}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate) || !Number.isFinite(evaluationTime)) {
    throw new Error('QUALITY_EVALUATION_AS_OF_DATE_INVALID')
  }
  const revisionAgeDays = Math.max(0, Math.floor((evaluationTime - new Date(input.revision.createdAt).getTime()) / 86_400_000))
  const confidenceScore = rounded(
    20 * ratio(input.corpus.sampleCount, 100) +
    25 * ratio(behaviorClusterCount, 30) +
    20 * ratio(holdoutClusterCount, 50) +
    15 * ratio(input.submissions.count, 5000) +
    10 * ratio(input.hacks.count, 10) +
    5 * ratio(revisionAgeDays, 90) +
    5 * crossJudgeStability, 100,
  )
  const confidenceLevel = confidenceScore < 25 ? 'VERY_LOW' as const : confidenceScore < 45 ? 'LOW' as const : confidenceScore < 65 ? 'MEDIUM' as const : confidenceScore < 85 ? 'HIGH' as const : 'VERY_HIGH' as const
  const provisionalOverall = correctnessScore + discriminationScore + coverageScore + diversityScore + subtaskQualityScore + stabilityScore
  const overallScore = qualityStatus === 'READY' ? provisionalOverall : null
  let maturityLevel: 'EXPERIMENTAL' | 'VALIDATED' | 'PROVEN' | 'MATURE' | 'BATTLE_TESTED' = 'EXPERIMENTAL'
  if (qualityStatus === 'READY' && input.submissions.count >= 20000 && input.hacks.count >= 10 && behaviorClusterCount >= 30 && revisionAgeDays >= 90) maturityLevel = 'BATTLE_TESTED'
  else if (qualityStatus === 'READY' && input.submissions.count >= 5000 && behaviorClusterCount >= 20 && revisionAgeDays >= 30) maturityLevel = 'MATURE'
  else if (qualityStatus === 'READY' && input.submissions.count >= 500 && behaviorClusterCount >= 10 && revisionAgeDays >= 14) maturityLevel = 'PROVEN'
  else if (qualityStatus === 'READY' && provisionalOverall >= 70 && confidenceScore >= 45) maturityLevel = 'VALIDATED'

  return {
    id: crypto.randomUUID(),
    problemId: job.problemId,
    revisionId: job.revisionId,
    corpusRevisionId: job.corpusRevisionId,
    evaluationJobId: job.id,
    qualityRuleVersion: job.qualityRuleVersion,
    inputHash: job.inputHash,
    correctnessScore,
    discriminationScore,
    coverageScore,
    diversityScore,
    subtaskQualityScore,
    stabilityScore,
    overallScore,
    confidenceScore,
    confidenceLevel,
    maturityLevel,
    wrongProgramCount: input.corpus.sampleCount,
    behaviorClusterCount,
    evaluationClusterCount,
    holdoutClusterCount,
    weightedKillCoverage: clamp01(weightedKillCoverage),
    evaluationCoverage: clamp01(evaluationCoverage),
    holdoutCoverage: clamp01(holdoutCoverage),
    featureCoverage: clamp01(featureCoverage),
    criticalFeatureCoverage: clamp01(criticalFeatureCoverage),
    realSubmissionCount: input.submissions.count,
    validHackCount: input.hacks.count,
    revisionAgeDays,
    criticalIssueCount: criticalIssues.length,
    warningCount: warnings.length,
    qualityStatus,
    evidence: {
      pinnedInputs: {
        revisionId: input.revision.id,
        asOfDate: input.asOfDate,
        corpusRevisionId: input.corpus.id,
        corpusHash: input.corpus.corpusHash,
        corpusEvidenceHash: stableHash(input.corpus),
        qualityRuleVersion: job.qualityRuleVersion,
        featureSchemaHash: stableHash(input.features),
        solutionProfileSchemaHash: stableHash(input.solutionProfiles.map(profile => ({ id: profile.id, definitionHash: profile.definitionHash, definitionRevision: profile.definitionRevision }))),
        solutionProfileEvidenceHash: stableHash(input.solutionProfiles.map(profile => ({ id: profile.id, source: profile.source }))),
        criticalIncidentHash: stableHash(input.criticalIncidents || []),
        standardVersionId: input.programs.standardVersionId,
        standardSourceSha256: input.programs.standardSourceSha256,
        validatorVersionId: input.programs.validatorVersionId,
        validatorSourceSha256: input.programs.validatorSourceSha256,
        classifierVersionId: input.programs.classifierVersionId,
        classifierSourceSha256: input.programs.classifierSourceSha256,
        checkerHash: input.checker.hash,
        checkerKind: input.checker.kind,
        checkerAssetFileName: input.checker.asset?.fileName || null,
        checkerAssetSha256: input.checker.asset?.sha256 || null,
        judgeConfigHash: input.revision.judgeConfigHash,
        graphHash: input.revision.graphHash,
        verificationReportHash: verification ? stableHash(verification) : null,
      },
      gates: { standardReady, validatorReady, checkerReady, revisionComplete, classifierReady, corpusReady, semanticVerification: verification?.outcome || 'missing' },
      criticalIssues,
      warnings,
      scoring: { generatorReproducibility, crossJudgeStability, distributionCoverage, subtaskCoverage, solutionProfileAlignment, evaluatedSolutionProfileCount, solutionProfileCount: input.solutionProfiles.length, provisionalOverall },
    } as Prisma.InputJsonValue,
  }
}

export async function claimQualityEvaluationJob(workerId: string) {
  return prisma.$transaction(async tx => {
    await tx.qualityEvaluationJob.updateMany({ where: { status: 'RUNNING', leaseExpiresAt: { lte: new Date() }, attempts: { lt: 3 } }, data: { status: 'QUEUED', leaseOwner: null, fencingToken: null, leaseExpiresAt: null, startedAt: null, errorCode: 'LEASE_EXPIRED', errorMessage: '质量评估租约过期，已重新排队' } })
    await tx.qualityEvaluationJob.updateMany({ where: { status: 'RUNNING', leaseExpiresAt: { lte: new Date() }, attempts: { gte: 3 } }, data: { status: 'FAILED', leaseOwner: null, fencingToken: null, leaseExpiresAt: null, errorCode: 'QUALITY_EVALUATION_RETRY_EXHAUSTED', errorMessage: '质量评估连续三次未完成', finishedAt: new Date() } })
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "QualityEvaluationJob" WHERE status = 'QUEUED' AND "verificationStatus" = 'complete' ORDER BY "queuedAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`
    if (!rows[0]) return null
    const fencingToken = crypto.randomUUID()
    const changed = await tx.qualityEvaluationJob.updateMany({ where: { id: rows[0].id, status: 'QUEUED', verificationStatus: 'complete' }, data: { status: 'RUNNING', leaseOwner: workerId, fencingToken, leaseExpiresAt: new Date(Date.now() + 10 * 60_000), startedAt: new Date(), attempts: { increment: 1 }, errorCode: null, errorMessage: null } })
    if (!changed.count) return null
    return tx.qualityEvaluationJob.findUnique({ where: { id: rows[0].id } })
  })
}

export async function processNextQualityEvaluationJob(workerId = `quality-${process.pid}`) {
  const job = await claimQualityEvaluationJob(workerId)
  if (!job?.fencingToken) return { processed: 0, succeeded: 0, failed: 0 }
  const heartbeat = setInterval(() => {
    prisma.qualityEvaluationJob.updateMany({
      where: { id: job.id, status: 'RUNNING', leaseOwner: workerId, fencingToken: job.fencingToken! },
      data: { leaseExpiresAt: new Date(Date.now() + 10 * 60_000) },
    }).catch(error => console.warn('[quality-evaluation] lease heartbeat failed', { jobId: job.id, error: (error as Error).message }))
  }, 60_000)
  heartbeat.unref?.()
  try {
    const result = await calculateQualitySnapshot(job)
    let finalized = false
    await prisma.$transaction(async tx => {
      const changed = await tx.qualityEvaluationJob.updateMany({ where: { id: job.id, status: 'RUNNING', leaseOwner: workerId, fencingToken: job.fencingToken }, data: { status: 'SUCCEEDED', leaseOwner: null, fencingToken: null, leaseExpiresAt: null, finishedAt: new Date() } })
      if (changed.count !== 1) throw new Error('QUALITY_EVALUATION_FENCING_TOKEN_STALE')
      await tx.testSetQualitySnapshot.create({ data: result })
      finalized = true
    })
    return { processed: finalized ? 1 : 0, succeeded: finalized ? 1 : 0, failed: 0 }
  } catch (error) {
    const message = String((error as Error).message).slice(0, 4000)
    const retry = job.attempts < 3
    const changed = await prisma.qualityEvaluationJob.updateMany({ where: { id: job.id, status: 'RUNNING', leaseOwner: workerId, fencingToken: job.fencingToken }, data: retry ? { status: 'QUEUED', leaseOwner: null, fencingToken: null, leaseExpiresAt: null, startedAt: null, errorCode: 'QUALITY_EVALUATION_RETRY', errorMessage: message } : { status: 'FAILED', leaseOwner: null, fencingToken: null, leaseExpiresAt: null, errorCode: 'QUALITY_EVALUATION_FAILED', errorMessage: message, finishedAt: new Date() } })
    return { processed: changed.count, succeeded: 0, failed: !retry && changed.count ? 1 : 0 }
  } finally { clearInterval(heartbeat) }
}

export async function processQualityEvaluationJobs(limit = 2) {
  let processed = 0, succeeded = 0, failed = 0
  for (let index = 0; index < Math.max(1, Math.min(limit, 10)); index++) {
    const result = await processNextQualityEvaluationJob()
    processed += result.processed; succeeded += result.succeeded; failed += result.failed
    if (!result.processed) break
  }
  return { processed, succeeded, failed }
}

/**
 * Quality evidence contains the pinned private corpus identity, program
 * versions and gate diagnostics.  Do not serialize a Prisma row and merely
 * subtract today's known-sensitive properties here: newly added evidence
 * fields would then become public by accident.  Public certificates use an
 * explicit allow-list instead.
 */
function publicSnapshot(snapshot: any) {
  if (!snapshot) return null
  return {
    id: snapshot.id,
    problemId: snapshot.problemId,
    revisionId: snapshot.revisionId,
    qualityRuleVersion: snapshot.qualityRuleVersion,
    correctnessScore: snapshot.correctnessScore,
    discriminationScore: snapshot.discriminationScore,
    coverageScore: snapshot.coverageScore,
    diversityScore: snapshot.diversityScore,
    subtaskQualityScore: snapshot.subtaskQualityScore,
    stabilityScore: snapshot.stabilityScore,
    overallScore: snapshot.overallScore,
    confidenceScore: snapshot.confidenceScore,
    confidenceLevel: snapshot.confidenceLevel,
    maturityLevel: snapshot.maturityLevel,
    // Corpus sizes, split-level coverage, feature coverage and maturity inputs
    // are evidence rather than certificate output. Keeping them out of the
    // public allow-list prevents reverse engineering Hidden Holdout or private
    // Wrong Behavior Corpus membership.
    criticalIssueCount: snapshot.criticalIssueCount,
    warningCount: snapshot.warningCount,
    qualityStatus: snapshot.qualityStatus,
    createdAt: snapshot.createdAt,
  }
}

function publicProblemQualityAssessment(assessment: any) {
  if (!assessment) return null
  return {
    id: assessment.id,
    problemId: assessment.problemId,
    ruleVersion: assessment.ruleVersion,
    status: assessment.status,
    statementScore: assessment.statementScore,
    solutionCorrectnessScore: assessment.solutionCorrectnessScore,
    algorithmicValueScore: assessment.algorithmicValueScore,
    difficultyDesignScore: assessment.difficultyDesignScore,
    constraintDesignScore: assessment.constraintDesignScore,
    subtaskDesignScore: assessment.subtaskDesignScore,
    editorialScore: assessment.editorialScore,
    originalityScore: assessment.originalityScore,
    automatedScore: assessment.automatedScore,
    expertScore: assessment.expertScore,
    overallScore: assessment.overallScore,
    confidenceScore: assessment.confidenceScore,
    confidenceLevel: assessment.confidenceLevel,
    evaluatedAt: assessment.evaluatedAt,
    reviewedAt: assessment.reviewedAt,
  }
}

async function staleness(snapshot: any) {
  if (!snapshot) return { isStale: false, reasons: [] as string[] }
  const [corpus, pinnedCorpusClusters, features, solutionProfiles, programs, criticalIncidents, revision] = await Promise.all([
    prisma.wrongCorpusRevision.findFirst({ where: { problemId: snapshot.problemId, status: 'active' }, orderBy: { revisionNumber: 'desc' }, select: { id: true, revisionNumber: true, corpusHash: true, sampleCount: true } }),
    prisma.wrongBehaviorCluster.findMany({
      where: { problemId: snapshot.problemId, corpusRevisionId: snapshot.corpusRevisionId },
      orderBy: { id: 'asc' },
      select: { id: true, weight: true, frequency: true, partition: true, categoryId: true },
    }),
    prisma.problemFeatureDefinition.findMany({ where: { problemId: snapshot.problemId }, orderBy: [{ orderIndex: 'asc' }, { key: 'asc' }] }),
    prisma.problemSolutionProfile.findMany({
      where: { problemId: snapshot.problemId, status: 'active' },
      orderBy: [{ key: 'asc' }, { id: 'asc' }],
      include: { Submission: solutionProfileSubmission },
    }),
    prisma.problemJudgeProgram.findMany({ where: { problemId: snapshot.problemId }, select: { kind: true, currentVersionId: true, status: true } }),
    prisma.testSetQualityIncident.findMany({
      where: { revisionId: snapshot.revisionId, severity: 'CRITICAL', status: 'CONFIRMED' },
      orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, status: true, discoveredAt: true, confirmedAt: true },
    }),
    prisma.problemTestSetRevision.findFirst({
      where: { id: snapshot.revisionId, problemId: snapshot.problemId },
      select: { judgeConfig: true, judgeConfigHash: true, graphHash: true, testdataPath: true },
    }),
  ])
  const versionIds = programs.map(item => item.currentVersionId).filter((id): id is string => Boolean(id))
  const versions = versionIds.length
    ? await prisma.problemJudgeProgramVersion.findMany({ where: { id: { in: versionIds }, problemId: snapshot.problemId }, select: { id: true, compileStatus: true, lifecycleStatus: true, sourceSha256: true } })
    : []
  const evidence = asObject(snapshot.evidence)
  const pinned = asObject(evidence.pinnedInputs)
  const reasons: string[] = []
  try {
    const currentInput = await buildPinnedInput(snapshot.problemId, snapshot.revisionId, snapshot.corpusRevisionId)
    if (typeof pinned.asOfDate === 'string') currentInput.asOfDate = pinned.asOfDate
    if (stableHash({ rule: RULE_CONFIG, snapshot: currentInput }) !== snapshot.inputHash) reasons.push('QUALITY_EVIDENCE_CHANGED')
  } catch {
    reasons.push('QUALITY_EVIDENCE_UNAVAILABLE')
  }
  if (!revision
    || (pinned.judgeConfigHash && pinned.judgeConfigHash !== revision.judgeConfigHash)
    || (pinned.graphHash && pinned.graphHash !== revision.graphHash)
    || (revision && sha256(revision.judgeConfig) !== revision.judgeConfigHash)) reasons.push('TEST_SET_REVISION_CHANGED')
  if (revision) {
    const currentChecker = await pinnedChecker(snapshot.problemId, revision, parseConfig(revision.judgeConfig))
    if (pinned.checkerHash && pinned.checkerHash !== currentChecker.hash) reasons.push('CHECKER_CHANGED')
  }
  if ((corpus?.id ?? null) !== snapshot.corpusRevisionId) reasons.push('WRONG_CORPUS_REVISION_CHANGED')
  const currentCorpusEvidenceHash = corpus && corpus.id === snapshot.corpusRevisionId
    ? stableHash({
      id: corpus.id,
      revisionNumber: corpus.revisionNumber,
      corpusHash: corpus.corpusHash,
      sampleCount: corpus.sampleCount,
      clusters: pinnedCorpusClusters.map(item => ({ ...item, weight: Math.max(1, item.weight), frequency: Math.max(1, item.frequency) })),
    })
    : null
  if (pinned.corpusEvidenceHash && pinned.corpusEvidenceHash !== currentCorpusEvidenceHash) reasons.push('WRONG_CORPUS_EVIDENCE_CHANGED')
  const currentFeatureHash = stableHash(features.map(item => ({ key: item.key, kind: item.kind, importance: importanceOf(item.config), config: asObject(item.config) })))
  if (pinned.featureSchemaHash && pinned.featureSchemaHash !== currentFeatureHash) reasons.push('FEATURE_SCHEMA_CHANGED')
  const currentSolutionProfileHash = stableHash(solutionProfiles.map(profile => ({ id: profile.id, definitionHash: profile.definitionHash, definitionRevision: profile.revision })))
  if (pinned.solutionProfileSchemaHash && pinned.solutionProfileSchemaHash !== currentSolutionProfileHash) reasons.push('SOLUTION_PROFILE_CHANGED')
  const currentSolutionProfileEvidenceHash = stableHash(solutionProfiles.map(profile => {
    const run = profile.Submission.CurrentJudgeRun?.status === 'FINALIZED' ? profile.Submission.CurrentJudgeRun : null
    return {
      id: profile.id,
      source: {
        submissionId: profile.Submission.id,
        evaluatedRevisionId: run?.testSetRevisionId || profile.Submission.testSetRevisionId,
        result: run?.result || profile.Submission.result,
        score: run?.score ?? profile.Submission.score,
        subtasks: observedSubtaskScores(run?.subtasks || profile.Submission.subtasks),
      },
    }
  }))
  if (pinned.solutionProfileEvidenceHash && pinned.solutionProfileEvidenceHash !== currentSolutionProfileEvidenceHash) reasons.push('SOLUTION_PROFILE_EVIDENCE_CHANGED')
  const currentPrograms = {
    standard: activeProgramVersion(programs, versions, 'standard'),
    validator: activeProgramVersion(programs, versions, 'validator'),
    classifier: activeProgramVersion(programs, versions, 'classifier'),
  }
  if ((pinned.standardVersionId ?? null) !== (currentPrograms.standard?.id ?? null)
    || (pinned.standardSourceSha256 ?? null) !== (currentPrograms.standard?.sourceSha256 ?? null)
    || (pinned.validatorVersionId ?? null) !== (currentPrograms.validator?.id ?? null)
    || (pinned.validatorSourceSha256 ?? null) !== (currentPrograms.validator?.sourceSha256 ?? null)
    || (pinned.classifierVersionId ?? null) !== (currentPrograms.classifier?.id ?? null)
    || (pinned.classifierSourceSha256 ?? null) !== (currentPrograms.classifier?.sourceSha256 ?? null)) reasons.push('JUDGE_PROGRAM_CHANGED')
  const currentCriticalIncidentHash = stableHash(criticalIncidents.map(incident => ({
    id: incident.id,
    type: incident.type,
    status: incident.status,
    discoveredAt: incident.discoveredAt.toISOString(),
    confirmedAt: incident.confirmedAt?.toISOString() || null,
  })))
  if (pinned.criticalIncidentHash
    ? pinned.criticalIncidentHash !== currentCriticalIncidentHash
    : criticalIncidents.length > 0) reasons.push('CRITICAL_INCIDENT_REPORTED')
  if (snapshot.qualityRuleVersion !== QUALITY_RULE_VERSION) reasons.push('QUALITY_RULE_CHANGED')
  return { isStale: reasons.length > 0, reasons }
}

async function problemAssessmentStaleness(problemId: string, assessment: any) {
  if (!assessment) return { isStale: false, reasons: [] as string[] }
  const [problem, statement, solution, program, quality, submission] = await Promise.all([
    prisma.problem.findUnique({ where: { id: problemId }, select: { updatedAt: true } }),
    prisma.problemStatement.findFirst({ where: { problemId, isVisible: true }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.problemSolution.findFirst({ where: { problemId, status: 'PUBLISHED' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.problemJudgeProgram.findFirst({ where: { problemId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.testSetQualitySnapshot.findFirst({ where: { problemId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.submission.findFirst({ where: { problemInternalId: problemId, submitMethod: 'local', result: { notIn: ['queuing', 'judging', 'compiling', 'system_error'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ])
  const evaluatedAt = new Date(assessment.evaluatedAt).getTime()
  const reasons: string[] = []
  if (problem?.updatedAt && problem.updatedAt.getTime() > evaluatedAt) reasons.push('PROBLEM_CHANGED')
  if (statement?.updatedAt && statement.updatedAt.getTime() > evaluatedAt) reasons.push('STATEMENT_CHANGED')
  if (solution?.updatedAt && solution.updatedAt.getTime() > evaluatedAt) reasons.push('SOLUTION_CHANGED')
  if (program?.updatedAt && program.updatedAt.getTime() > evaluatedAt) reasons.push('JUDGE_DESIGN_CHANGED')
  if (quality?.createdAt && quality.createdAt.getTime() > evaluatedAt) reasons.push('DATA_QUALITY_EVIDENCE_CHANGED')
  if (submission?.createdAt && submission.createdAt.getTime() > evaluatedAt) reasons.push('SUBMISSION_DISTRIBUTION_CHANGED')
  return { isStale: reasons.length > 0, reasons }
}

export async function enqueueStaleQualityEvaluations(limit = 10) {
  const take = Math.max(1, Math.min(limit, 50))
  let problems = await prisma.problem.findMany({
    where: { latestTestSetRevisionId: { not: null } },
    orderBy: { id: 'asc' },
    take,
    ...(qualityStaleScanCursor ? { cursor: { id: qualityStaleScanCursor }, skip: 1 } : {}),
    select: { id: true, ownerId: true, latestTestSetRevisionId: true },
  })
  if (!problems.length && qualityStaleScanCursor) {
    qualityStaleScanCursor = undefined
    problems = await prisma.problem.findMany({
      where: { latestTestSetRevisionId: { not: null } },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, ownerId: true, latestTestSetRevisionId: true },
    })
  }
  qualityStaleScanCursor = problems.at(-1)?.id
  let queued = 0
  for (const problem of problems) {
    if (!problem.latestTestSetRevisionId) continue
    const snapshot = await prisma.testSetQualitySnapshot.findFirst({
      where: { revisionId: problem.latestTestSetRevisionId },
      orderBy: { createdAt: 'desc' },
      include: { EvaluationJob: { select: { createdBy: true } } },
    })
    if (snapshot && !(await staleness(snapshot)).isStale) continue
    try {
      const result = await enqueueQualityEvaluationForRevision({
        problemId: problem.id,
        revisionId: problem.latestTestSetRevisionId,
        createdBy: snapshot?.EvaluationJob.createdBy || problem.ownerId,
      })
      if (result.queued) queued++
    } catch (error) {
      if (!(error instanceof ProblemQualityError && error.code === 'QUALITY_CORPUS_NOT_READY')) {
        console.warn('[quality-evaluation] stale scan enqueue skipped', { problemId: problem.id, error: (error as Error).message })
      }
    }
  }
  return { scanned: problems.length, queued }
}

export async function getProblemQuality(user: JwtPayload, problemId: string) {
  const problem = await visibleProblem(user, problemId)
  const manager = canModifyProblem(user, problem)
  const [assessment, snapshot, jobs, historyRows, profileRows] = await Promise.all([
    prisma.problemQualityAssessment.findFirst({ where: { problemId }, orderBy: { evaluatedAt: 'desc' } }),
    problem.latestTestSetRevisionId ? prisma.testSetQualitySnapshot.findFirst({ where: { revisionId: problem.latestTestSetRevisionId }, orderBy: { createdAt: 'desc' } }) : null,
    manager ? prisma.qualityEvaluationJob.findMany({
      where: { problemId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, revisionId: true, corpusRevisionId: true, qualityRuleVersion: true,
        status: true, attempts: true, errorCode: true, errorMessage: true,
        queuedAt: true, startedAt: true, finishedAt: true,
      },
    }) : Promise.resolve([]),
    manager ? prisma.testSetQualitySnapshot.findMany({
      where: { problemId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { Revision: { select: { revisionNumber: true, source: true } } },
    }) : Promise.resolve([]),
    manager ? prisma.problemSolutionProfile.findMany({
      where: { problemId },
      orderBy: [{ status: 'asc' }, { key: 'asc' }],
      include: { Submission: solutionProfileSubmission },
    }) : Promise.resolve([]),
  ])
  const stale = await staleness(snapshot)
  const assessmentStale = await problemAssessmentStaleness(problemId, assessment)
  const qualityHistory = manager
    ? await Promise.all(historyRows.map(async item => ({ ...item, ...await staleness(item) })))
    : []
  return {
    permissions: { canManage: manager, canExpertReview: isPlatformManager(user.accountRole || user.role) },
    latestTestSetRevisionId: problem.latestTestSetRevisionId,
    testSetQuality: snapshot ? { ...(manager ? snapshot : publicSnapshot(snapshot)), isStale: stale.isStale, ...(manager ? { reasons: stale.reasons } : {}) } : null,
    problemQuality: assessment ? {
      ...(manager ? assessment : publicProblemQualityAssessment(assessment)),
      isStale: assessmentStale.isStale,
      ...(manager ? { staleReasons: assessmentStale.reasons } : {}),
    } : null,
    ...(manager ? { jobs, qualityHistory, solutionProfiles: profileRows.map(solutionProfileDto) } : {}),
  }
}

export async function getRevisionQuality(user: JwtPayload, problemId: string, revisionId: string) {
  const problem = await visibleProblem(user, problemId)
  const revision = await prisma.problemTestSetRevision.findFirst({ where: { id: revisionId, problemId }, select: { id: true } })
  if (!revision) fail(404, 'TEST_SET_REVISION_NOT_FOUND', '测试集版本不存在')
  const snapshot = await prisma.testSetQualitySnapshot.findFirst({ where: { revisionId }, orderBy: { createdAt: 'desc' } })
  if (!snapshot) return null
  const manager = canModifyProblem(user, problem)
  const stale = await staleness(snapshot)
  return { ...(manager ? snapshot : publicSnapshot(snapshot)), isStale: stale.isStale, ...(manager ? { reasons: stale.reasons } : {}) }
}

export async function listQualityJobs(user: JwtPayload, problemId: string) {
  await manageableProblem(user, problemId)
  return prisma.qualityEvaluationJob.findMany({ where: { problemId }, orderBy: { createdAt: 'desc' }, take: 100, include: { Snapshot: true } })
}

export async function getQualityJob(user: JwtPayload, problemId: string, jobId: string) {
  await manageableProblem(user, problemId)
  const job = await prisma.qualityEvaluationJob.findFirst({ where: { id: jobId, problemId }, include: { Snapshot: true } })
  if (!job) fail(404, 'QUALITY_EVALUATION_JOB_NOT_FOUND', '质量评估任务不存在')
  return job
}

function textContains(content: string, patterns: RegExp[]) { return patterns.some(pattern => pattern.test(content)) }

export async function runAutomatedProblemQualityAssessment(user: JwtPayload, problemId: string) {
  const problem = await manageableProblem(user, problemId)
  const [statements, solutions, programs, latestQuality, submissionCount, resultGroups, latestRevision] = await Promise.all([
    prisma.problemStatement.findMany({ where: { problemId, isVisible: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.problemSolution.findMany({ where: { problemId, status: 'PUBLISHED' }, include: { CurrentVersion: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.problemJudgeProgram.findMany({ where: { problemId, status: 'active' }, select: { kind: true, currentVersionId: true } }),
    problem.latestTestSetRevisionId ? prisma.testSetQualitySnapshot.findFirst({ where: { revisionId: problem.latestTestSetRevisionId }, orderBy: { createdAt: 'desc' } }) : null,
    prisma.submission.count({ where: { problemInternalId: problemId, submitMethod: 'local', result: { notIn: ['queuing', 'judging', 'compiling', 'system_error'] } } }),
    prisma.submission.groupBy({ by: ['result'], where: { problemInternalId: problemId, submitMethod: 'local', result: { notIn: ['queuing', 'judging', 'compiling', 'system_error'] } }, _count: { _all: true } }),
    problem.latestTestSetRevisionId ? prisma.problemTestSetRevision.findUnique({ where: { id: problem.latestTestSetRevisionId }, include: { Subtasks: { include: { Groups: { include: { Cases: true } } } } } }) : null,
  ])
  const versionIds = programs.map(item => item.currentVersionId).filter((id): id is string => Boolean(id))
  const versions = versionIds.length ? await prisma.problemJudgeProgramVersion.findMany({ where: { id: { in: versionIds }, lifecycleStatus: 'active', compileStatus: 'passed' }, select: { id: true } }) : []
  const activeIds = new Set(versions.map(item => item.id))
  const standardReady = programs.some(item => item.kind === 'standard' && item.currentVersionId && activeIds.has(item.currentVersionId))
  const validatorReady = programs.some(item => item.kind === 'validator' && item.currentVersionId && activeIds.has(item.currentVersionId))
  const statement = statements.find(item => item.format === 'markdown' && item.content?.trim()) || statements.find(item => item.content?.trim())
  const statementText = `${problem.title}\n${problem.description || ''}\n${statement?.content || ''}`
  const statementScore = rounded(
    (problem.title.trim().length >= 3 ? 4 : 0) +
    (statementText.length >= 200 ? 4 : statementText.length >= 80 ? 2 : 0) +
    (textContains(statementText, [/\binput\b/i, /输入/]) ? 3 : 0) +
    (textContains(statementText, [/\boutput\b/i, /输出/]) ? 3 : 0) +
    (textContains(statementText, [/\bsample\b/i, /样例/]) ? 3 : 0) +
    (textContains(statementText, [/-?\d+\s*(?:<=|\u2264|<)/, /范围/, /约束/]) ? 3 : 0), 20,
  )
  const publishedSolution = solutions.find(item => item.CurrentVersion?.contentMarkdown?.trim())
  const solutionCorrectnessScore = rounded((standardReady ? 8 : 0) + (latestQuality?.qualityStatus === 'READY' && latestQuality.correctnessScore >= 26 ? 6 : 0) + (publishedSolution ? 4 : 0) + (publishedSolution?.CurrentVersion?.referenceCode ? 2 : 0), 20)
  const distinctOutcomes = resultGroups.length
  const difficultyDesignScore = rounded((problem.difficulty ? 3 : 0) + 4 * ratio(submissionCount, 50) + (distinctOutcomes >= 2 ? 4 : 0) + (submissionCount >= 20 && distinctOutcomes >= 3 ? 4 : 0), 15)
  const constraintDesignScore = rounded((validatorReady ? 4 : 0) + (problem.timeLimit ? 2 : 0) + (problem.memoryLimit ? 2 : 0) + (textContains(statementText, [/-?\d+\s*(?:<=|\u2264|<)/, /范围/, /约束/]) ? 2 : 0), 10)
  const subtaskDesignScore = latestRevision?.mode !== 'oi' ? 5 : rounded(5 * ([
    latestRevision.Subtasks.reduce((sum, item) => sum + item.score, 0) === 100,
    latestRevision.Subtasks.every(item => item.Groups.some(group => group.kind === 'official' && group.Cases.length > 0)),
    latestRevision.Subtasks.every(item => item.Groups.filter(group => group.kind === 'hack_gate').length === 1),
  ].filter(Boolean).length / 3), 5)
  const automatedScore = statementScore + solutionCorrectnessScore + difficultyDesignScore + constraintDesignScore + subtaskDesignScore
  const confidenceScore = rounded(20 * ratio(statements.length, 1) + 20 * (standardReady ? 1 : 0) + 20 * (validatorReady ? 1 : 0) + 20 * ratio(submissionCount, 500) + 20 * (latestQuality ? Math.max(0.25, latestQuality.confidenceScore / 100) : 0), 100)
  const confidenceLevel = confidenceScore < 25 ? 'VERY_LOW' as const : confidenceScore < 45 ? 'LOW' as const : confidenceScore < 65 ? 'MEDIUM' as const : confidenceScore < 85 ? 'HIGH' as const : 'VERY_HIGH' as const
  const subjectVersionHash = stableHash({
    problem: { title: problem.title, description: problem.description, difficulty: problem.difficulty, timeLimit: problem.timeLimit, memoryLimit: problem.memoryLimit, latestTestSetRevisionId: problem.latestTestSetRevisionId },
    statements: statements.map(item => ({ id: item.id, type: item.type, format: item.format, language: item.language, content: item.content, fileUrl: item.fileUrl, updatedAt: item.updatedAt.toISOString() })),
    solutions: solutions.map(item => ({ id: item.id, currentVersionId: item.currentVersionId, updatedAt: item.updatedAt.toISOString() })),
    programs: programs.map(item => ({ kind: item.kind, currentVersionId: item.currentVersionId })),
    latestQualitySnapshotId: latestQuality?.id || null,
    submissionEvidence: {
      count: submissionCount,
      outcomes: resultGroups.map(item => ({ result: item.result, count: item._count._all })).sort((left, right) => String(left.result).localeCompare(String(right.result))),
    },
  })
  const existing = await prisma.problemQualityAssessment.findUnique({ where: { problemId_ruleVersion_subjectVersionHash: { problemId, ruleVersion: PROBLEM_QUALITY_RULE_VERSION, subjectVersionHash } } })
  if (existing) return existing
  return prisma.problemQualityAssessment.create({ data: {
    id: crypto.randomUUID(), problemId, ruleVersion: PROBLEM_QUALITY_RULE_VERSION, subjectVersionHash,
    statementScore, solutionCorrectnessScore, difficultyDesignScore, constraintDesignScore, subtaskDesignScore,
    automatedScore, confidenceScore, confidenceLevel, createdBy: user.userId,
    automatedEvidence: { statementIds: statements.map(item => item.id), standardReady, validatorReady, latestQualitySnapshotId: latestQuality?.id || null, submissionCount, distinctOutcomes, publishedSolutionId: publishedSolution?.id || null } as Prisma.InputJsonValue,
  } })
}

function integerScore(value: unknown, name: string, maximum: number) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) fail(422, 'INVALID_EXPERT_QUALITY_REVIEW', `${name} 必须是 0～${maximum} 的整数`)
  return Number(value)
}

export async function submitExpertProblemQualityReview(user: JwtPayload, problemId: string, assessmentId: string, body: unknown) {
  if (!isPlatformManager(user.accountRole || user.role)) fail(403, 'PLATFORM_QUALITY_EXPERT_REQUIRED', '仅平台质量审核员可提交专家评估')
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem) fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  const assessment = await prisma.problemQualityAssessment.findFirst({ where: { id: assessmentId, problemId } })
  if (!assessment) fail(404, 'PROBLEM_QUALITY_ASSESSMENT_NOT_FOUND', '题目质量评估不存在')
  if (assessment.status === 'EXPERT_REVIEWED') fail(409, 'PROBLEM_QUALITY_ALREADY_REVIEWED', '该内容版本已完成专家评估，不可覆盖历史结论')
  if ((await problemAssessmentStaleness(problemId, assessment)).isStale) fail(409, 'PROBLEM_QUALITY_ASSESSMENT_STALE', '自动评估依据已变化，请重新运行自动评估后再提交专家结论')
  const input = asObject(body)
  const algorithmicValueScore = integerScore(input.algorithmicValueScore, '算法价值', 20)
  const editorialScore = integerScore(input.editorialScore, '题解质量', 5)
  const originalityScore = integerScore(input.originalityScore, '原创性/来源', 5)
  const comment = String(input.comment || '').trim()
  if (comment.length < 20 || comment.length > 4000) fail(422, 'EXPERT_REVIEW_COMMENT_REQUIRED', '专家评语必须为 20～4000 字')
  const expertScore = algorithmicValueScore + editorialScore + originalityScore
  const changed = await prisma.problemQualityAssessment.updateMany({ where: { id: assessment.id, status: 'AUTOMATED_READY' }, data: {
    algorithmicValueScore, editorialScore, originalityScore, expertScore,
    overallScore: assessment.automatedScore + expertScore,
    status: 'EXPERT_REVIEWED', reviewedBy: user.userId, reviewedAt: new Date(),
    expertEvidence: { comment, checklist: asObject(input.checklist) } as Prisma.InputJsonValue,
  } })
  if (!changed.count) fail(409, 'PROBLEM_QUALITY_ALREADY_REVIEWED', '该内容版本已被其他审核员处理')
  return prisma.problemQualityAssessment.findUniqueOrThrow({ where: { id: assessment.id } })
}

export async function listProblemQualityAssessments(user: JwtPayload, problemId: string) {
  const problem = await visibleProblem(user, problemId)
  const manager = canModifyProblem(user, problem) || isPlatformManager(user.accountRole || user.role)
  const rows = await prisma.problemQualityAssessment.findMany({ where: { problemId }, orderBy: { evaluatedAt: 'desc' }, take: 100 })
  return manager ? rows : rows.map(publicProblemQualityAssessment)
}
