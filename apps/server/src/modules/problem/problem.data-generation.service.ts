import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../prisma'
import { getTestdataBlobStore, problemBlobKey } from '../storage/blob-store'
import { ingestTestdataObject, loadRevisionSpec, publishTestSetRevision, TestSetRevisionConflict, type RevisionCaseSpec } from './problem.testset-revision.service'
import { requireProgramProblem } from './problem.judge-program.service'
import yaml from 'js-yaml'
import { canModifyProblem } from './problem.access'
import { compileJudgeProgram } from './problem.judge-program.service'
import { createAdmittedCandidate } from './problem.testcase-candidate.service'
import { EVALUATION_LIMITS, releaseEvaluationCredits, reserveEvaluationCredits, settleEvaluationCredits, usageCredits } from './problem.evaluation-budget.service'
import { requireContributionReady, resolveActiveProgramVersion } from './problem.contribution-readiness.service'

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
const MAX_CASES = Number(process.env.DATA_GENERATION_MAX_CASES || 50)
const ACTIVE = ['queued', 'running', 'finalizing']
export class DataGenerationError extends Error { constructor(public statusCode: number, public code: string, message: string, public data?: unknown) { super(message) } }
function fail(statusCode: number, code: string, message: string, data?: unknown): never { throw new DataGenerationError(statusCode, code, message, data) }

async function loadVersion(problemId: string, versionId: string, expectedKind: string) {
  const version = await prisma.problemJudgeProgramVersion.findFirst({ where: { id: versionId, problemId, lifecycleStatus: { in: ['verified', 'active'] } } })
  if (!version) fail(400, 'PROGRAM_VERSION_INVALID', '评测程序版本不存在或不属于当前题目')
  const program = await prisma.problemJudgeProgram.findFirst({ where: { id: version.programId, problemId, kind: expectedKind, status: 'active' } })
  if (!program) fail(400, 'PROGRAM_KIND_INVALID', `需要 ${expectedKind} 程序版本`)
  return { version, program }
}

type GenerationCaseInput = { name: string; args: string[]; seed: string | null; inputData?: string; profile?: string; params?: Record<string, unknown> }
function normalizeCases(body: any): GenerationCaseInput[] {
  const cases = Array.isArray(body?.cases) ? body.cases : []
  if (!cases.length || cases.length > MAX_CASES) fail(400, 'GENERATION_CASES_INVALID', `每个任务需要 1～${MAX_CASES} 个参数项`)
  return cases.map((item: any, index: number) => {
    const name = String(item?.name || `case-${index + 1}`).trim()
    const args = Array.isArray(item?.args) ? item.args.map(String) : []
    const seed = item?.seed === undefined ? null : String(item.seed)
    const inputData = body?.sourceMode === 'input' ? String(item?.inputData || '') : undefined
    if (!name || name.length > 80 || args.length > 64 || args.some((arg: string) => Buffer.byteLength(arg) > 4096)) fail(400, 'GENERATION_PARAMETER_INVALID', `参数项 #${index + 1} 无效`)
    const maxInputBytes = body?.contribution === true ? EVALUATION_LIMITS.maxCandidateBytes : 1024 * 1024
    if (body?.sourceMode === 'input' && (!inputData?.trim() || Buffer.byteLength(inputData) > maxInputBytes)) fail(400, 'GENERATION_INPUT_INVALID', `输入 #${index + 1} 为空或超过 ${body?.contribution === true ? '16 MiB' : '1 MiB'}`)
    return { name, args, seed, inputData, profile: typeof item?.profile === 'string' ? item.profile : undefined, params: item?.params && typeof item.params === 'object' ? item.params : undefined }
  })
}

export async function createDataGenerationJob(input: { user: JwtPayload; problemId: string; body: any }) {
  const contribution = input.body?.contribution === true
  const readiness = contribution ? await requireContributionReady(input.user, input.problemId) : null
  const problem = readiness?.problem || await requireProgramProblem(input.user, input.problemId)
  const manager = canModifyProblem(input.user, problem)
  const sourceMode = input.body?.sourceMode === 'input' ? 'input' : 'generator'
  const cases = normalizeCases({ ...input.body, sourceMode, contribution })
  if (contribution && cases.length > (sourceMode === 'input' ? 1 : 8)) fail(400, 'CONTRIBUTION_CASE_LIMIT', '普通贡献每次最多提交 1 个直接数据或 8 个生成参数')
  const ephemeralGenerator = contribution && sourceMode === 'generator' && typeof input.body?.generatorSource === 'string'
    ? { language: input.body?.generatorLanguage === 'python3' ? 'python3' as const : 'cpp17' as const, source: String(input.body.generatorSource), protocol: 'oj.generator/v1' as const }
    : null
  if (ephemeralGenerator) await compileJudgeProgram(ephemeralGenerator.source, ephemeralGenerator.language, '候选数据生成器', { protocol: ephemeralGenerator.protocol })
  const [standard, validator, generator] = await Promise.all([
    contribution ? Promise.resolve(readiness!.standardProgram!) : loadVersion(problem.id, String(input.body?.standardVersionId || ''), 'standard'),
    contribution ? Promise.resolve(readiness!.validatorProgram!) : loadVersion(problem.id, String(input.body?.validatorVersionId || ''), 'validator'),
    sourceMode === 'generator' && !ephemeralGenerator ? (contribution ? resolveActiveProgramVersion(problem.id, 'generator').then(value => value || fail(409, 'GENERATOR_NOT_ACTIVE', '该题尚未配置已激活的 Generator')) : loadVersion(problem.id, String(input.body?.generatorVersionId || ''), 'generator')) : null,
  ])
  const jobId = crypto.randomUUID()
  const reservedCredits = contribution ? (sourceMode === 'generator' ? 4_000 : 400) : 0
  if (reservedCredits) await reserveEvaluationCredits({ userId: input.user.userId, manager, taskType: 'candidate_generation', taskId: jobId, credits: reservedCredits, metadata: { problemId: problem.id, sourceMode } })
  const config: any = { sourceMode, cases, generator: ephemeralGenerator, mode: readiness?.mode, classifierVersionId: readiness?.classifierProgram?.version.id || null }
  try { return await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`data-generation:${problem.id}`}, 0)) IS NULL AS locked`
    const activeCount = await tx.problemDataGenerationJob.count({
      where: { problemId: problem.id, status: { in: ACTIVE } },
    })
    if (activeCount > 0) fail(409, 'GENERATION_JOB_ACTIVE', '该题已有数据生成任务正在执行')
    if (contribution) {
      const userActive = await tx.problemDataGenerationJob.count({ where: { createdBy: input.user.userId, contribution: true, status: { in: ACTIVE } } })
      if (userActive > 0) fail(409, 'CONTRIBUTION_TASK_ACTIVE', '每位用户同时只能执行一个 Candidate 贡献任务')
    }
    const job = await tx.problemDataGenerationJob.create({ data: {
      id: jobId, problemId: problem.id, createdBy: input.user.userId, baseTestSetRevisionId: problem.latestTestSetRevisionId,
      expectedLatestRevisionId: problem.latestTestSetRevisionId, generatorVersionId: generator?.version.id || null,
      standardVersionId: standard.version.id, validatorVersionId: validator.version.id, config,
      contribution, targetRole: manager && input.body?.targetRole === 'official' ? 'official' : 'hack_gate', reservedCredits,
    } })
    await tx.problemDataGenerationCase.createMany({ data: cases.map((item, orderIndex) => ({ id: crypto.randomUUID(), jobId, problemId: problem.id, orderIndex, name: item.name, args: item.args, seed: item.seed })) })
    return job
  }) } catch (error) {
    if (reservedCredits) await releaseEvaluationCredits({ taskType: 'candidate_generation', taskId: jobId, reserved: reservedCredits, reason: '任务创建失败' }).catch(() => undefined)
    throw error
  }
}

export async function listDataGenerationJobs(user: JwtPayload, problemId: string) {
  await requireProgramProblem(user, problemId)
  return prisma.problemDataGenerationJob.findMany({ where: { problemId }, orderBy: { createdAt: 'desc' }, take: 100 })
}

export async function getDataGenerationJob(user: JwtPayload, problemId: string, jobId: string) {
  await requireProgramProblem(user, problemId)
  const job = await prisma.problemDataGenerationJob.findFirst({ where: { id: jobId, problemId } })
  if (!job) fail(404, 'GENERATION_JOB_NOT_FOUND', '数据生成任务不存在')
  const cases = await prisma.problemDataGenerationCase.findMany({ where: { jobId }, orderBy: { orderIndex: 'asc' } })
  return { ...job, cases }
}

export async function cancelDataGenerationJob(user: JwtPayload, problemId: string, jobId: string) {
  await requireProgramProblem(user, problemId)
  const changed = await prisma.problemDataGenerationJob.updateMany({ where: { id: jobId, problemId, status: { in: ['queued'] } }, data: { status: 'cancelled', finishedAt: new Date() } })
  if (!changed.count) fail(409, 'GENERATION_JOB_NOT_CANCELLABLE', '任务已开始或已经结束')
  return { cancelled: true }
}

export async function claimDataGenerationJob(judgeId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('candidate-evaluation-global-lane', 0)) IS NULL AS locked`
    const contributionRunning = await tx.problemDataGenerationJob.count({ where: { contribution: true, status: { in: ['running', 'finalizing'] } } })
    if (contributionRunning >= 1) return null
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ProblemDataGenerationJob" WHERE status = 'queued' ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`
    if (!rows[0]) return null
    const fencingToken = crypto.randomUUID(), leaseExpiresAt = new Date(Date.now() + Number(process.env.DATA_GENERATION_LEASE_MS || 60 * 60_000))
    const changed = await tx.problemDataGenerationJob.updateMany({ where: { id: rows[0].id, status: 'queued' }, data: { status: 'running', judgeId, fencingToken, leaseExpiresAt, startedAt: new Date() } })
    if (!changed.count) return null
    const job = await tx.problemDataGenerationJob.findUniqueOrThrow({ where: { id: rows[0].id } })
    const classifierVersionId = typeof (job.config as any)?.classifierVersionId === 'string' ? (job.config as any).classifierVersionId : null
    const [generator, standard, validator, classifier, cases] = await Promise.all([
      job.generatorVersionId ? tx.problemJudgeProgramVersion.findUnique({ where: { id: job.generatorVersionId } }) : null,
      tx.problemJudgeProgramVersion.findUniqueOrThrow({ where: { id: job.standardVersionId } }),
      tx.problemJudgeProgramVersion.findUniqueOrThrow({ where: { id: job.validatorVersionId } }),
      classifierVersionId ? tx.problemJudgeProgramVersion.findUnique({ where: { id: classifierVersionId } }) : null,
      tx.problemDataGenerationCase.findMany({ where: { jobId: job.id }, orderBy: { orderIndex: 'asc' } }),
    ])
    const config = job.config as any
    const problem = await tx.problem.findUnique({ where: { id: job.problemId }, include: { LatestTestSetRevision: true } })
    const generatorConfig = config.generator || (generator ? { language: generator.language, source: generator.source, protocol: generator.protocol || 'legacy-args-v1' } : null)
    return { taskType: 'data_generation' as const, jobId: job.id, problemId: job.problemId, fencingToken, sourceMode: config.sourceMode, maxDataBytes: job.contribution ? EVALUATION_LIMITS.maxCandidateBytes : 1024 * 1024, problemConfig: yaml.load(problem?.LatestTestSetRevision?.judgeConfig || problem?.judgeConfig || '{}'), generator: generatorConfig, standard: { language: standard.language, source: standard.source }, validator: { language: validator.language, source: validator.source, protocol: validator.protocol }, classifier: classifier ? { language: classifier.language, source: classifier.source, protocol: classifier.protocol } : null, cases: cases.map((item, index) => ({ id: item.id, name: item.name, args: item.args, seed: item.seed, inputData: config.cases?.[index]?.inputData, profile: config.cases?.[index]?.profile, params: config.cases?.[index]?.params })) }
  })
}

export async function finalizeDataGenerationJob(judgeId: string, payload: any) {
  const job = await prisma.problemDataGenerationJob.findFirst({ where: { id: String(payload?.jobId || ''), status: 'running', judgeId, fencingToken: String(payload?.fencingToken || '') } })
  if (!job) return { stale: true }
  const claimed = await prisma.problemDataGenerationJob.updateMany({
    where: { id: job.id, status: 'running', judgeId, fencingToken: job.fencingToken },
    data: { status: 'finalizing' },
  })
  if (claimed.count !== 1) return { stale: true }
  try {
    for (const result of Array.isArray(payload?.cases) ? payload.cases : []) {
      const current = await prisma.problemDataGenerationCase.findFirst({ where: { id: String(result.id), jobId: job.id } })
      if (!current) continue
      if (result.status !== 'validated') {
        await prisma.problemDataGenerationCase.update({ where: { id: current.id }, data: { status: 'failed', failureStage: result.failureStage || 'unknown', message: String(result.message || '').slice(0, 4000), generatorTimeMs: result.generatorTimeMs, validatorTimeMs: result.validatorTimeMs, standardTimeMs: result.standardTimeMs } })
        continue
      }
      const input = Buffer.from(String(result.inputData || '')), output = Buffer.from(String(result.outputData || ''))
      const maxDataBytes = job.contribution ? EVALUATION_LIMITS.maxCandidateBytes : 1024 * 1024
      if (!input.length || input.length > maxDataBytes || output.length > maxDataBytes) throw new Error(`Judge 返回的测试数据为空或超过 ${Math.ceil(maxDataBytes / (1024 * 1024))} MiB`)
      const [inputObject, outputObject] = await Promise.all([ingestTestdataObject(job.problemId, input), ingestTestdataObject(job.problemId, output)])
      let candidateId: string | null = null, duplicateCandidate = false
      if (job.contribution) {
        const mode = (job.config as any)?.mode === 'oi' ? 'oi' : 'acm'
        const affectedSubtaskIds = Array.isArray(result.affectedSubtaskIds) ? result.affectedSubtaskIds.map(Number).filter(Number.isInteger) : []
        const corpus = await prisma.wrongCorpusRevision.findFirst({ where: { problemId: job.problemId, status: 'active' } })
        const evaluationStage = mode === 'oi' && (!result.classificationStatus || result.classificationStatus !== 'classified' || !affectedSubtaskIds.length)
          ? 'awaiting_classifier'
          : !corpus?.clusterCount
            ? 'awaiting_corpus'
            : 'awaiting_evaluator'
        const admitted = await createAdmittedCandidate({ problemId: job.problemId, createdBy: job.createdBy, source: (job.config as any)?.sourceMode === 'generator' ? 'generator' : 'direct_data', targetRole: job.targetRole as 'official' | 'hack_gate', baseTestSetRevisionId: job.baseTestSetRevisionId, input, output, inputFileName: `candidate_${current.id}.in`, outputFileName: `candidate_${current.id}.out`, standardVersionId: job.standardVersionId, validatorVersionId: job.validatorVersionId, classifierVersionId: (job.config as any)?.classifierVersionId || null, generatorVersionId: job.generatorVersionId, affectedSubtaskIds, status: 'ADMITTED', evaluationStage })
        duplicateCandidate = admitted.duplicate
        candidateId = admitted.duplicate ? null : admitted.candidate.id
      }
      await prisma.problemDataGenerationCase.update({ where: { id: current.id }, data: {
        status: duplicateCandidate ? 'duplicate' : 'validated', inputObjectId: inputObject.id, outputObjectId: outputObject.id,
        inputSha256: inputObject.sha256, outputSha256: outputObject.sha256, inputSize: input.length, outputSize: output.length,
        inputPreview: input.toString('utf8').slice(0, 8192), outputPreview: output.toString('utf8').slice(0, 8192),
        generatorTimeMs: result.generatorTimeMs, validatorTimeMs: result.validatorTimeMs, standardTimeMs: result.standardTimeMs,
        candidateId, failureStage: duplicateCandidate ? 'deduplication' : null, message: duplicateCandidate ? '与现有候选或正式测试数据完全重复' : (result.classificationMessage || null),
      } })
    }
    await prisma.problemDataGenerationJob.updateMany({ where: { id: job.id, status: 'finalizing', fencingToken: job.fencingToken }, data: { status: 'completed', judgeId: null, leaseExpiresAt: null, finishedAt: new Date() } })
    if (job.reservedCredits) {
      const cases = await prisma.problemDataGenerationCase.findMany({ where: { jobId: job.id } })
      const actual = usageCredits({ executions: cases.length * 4, cpuMs: cases.reduce((sum, item) => sum + (item.generatorTimeMs || 0) + (item.validatorTimeMs || 0) + (item.standardTimeMs || 0), 0), generatedBytes: cases.reduce((sum, item) => sum + (item.inputSize || 0) + (item.outputSize || 0), 0) })
      await settleEvaluationCredits({ taskType: 'candidate_generation', taskId: job.id, reserved: job.reservedCredits, actual, metadata: { status: 'completed' } })
    }
    return { stale: false }
  } catch (error) {
    await prisma.problemDataGenerationJob.updateMany({ where: { id: job.id, status: 'finalizing', fencingToken: job.fencingToken }, data: { status: 'failed', errorCode: 'GENERATION_PERSIST_FAILED', errorMessage: String((error as Error).message).slice(0, 4000), judgeId: null, leaseExpiresAt: null, finishedAt: new Date() } })
    if (job.reservedCredits) await settleEvaluationCredits({ taskType: 'candidate_generation', taskId: job.id, reserved: job.reservedCredits, actual: Math.min(job.reservedCredits, 1), metadata: { status: 'failed' } }).catch(() => undefined)
    throw error
  }
}

async function materializeCurrentFile(problemId: string, name: string, object: { id: string; storageKey: string; size: number; sha256: string }) {
  const root = path.resolve(TESTDATA_ROOT, problemId), target = path.resolve(root, name)
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('非法测试数据文件名')
  await fs.promises.mkdir(root, { recursive: true })
  await getTestdataBlobStore().materialize(problemBlobKey(problemId, object.storageKey), target)
  return prisma.testdataFile.create({ data: { id: crypto.randomUUID(), problemId, filename: name, size: object.size, sha256: object.sha256 } })
}

export async function promoteDataGenerationJob(input: { user: JwtPayload; problemId: string; jobId: string; expectedLatestRevisionId: string; caseIds?: string[]; assignments?: Array<{ caseId: string; subtaskId: number; groupKey: string }> }) {
  const problem = await requireProgramProblem(input.user, input.problemId)
  const job = await prisma.problemDataGenerationJob.findFirst({ where: { id: input.jobId, problemId: problem.id, status: 'completed' } })
  if (!job) fail(409, 'GENERATION_JOB_NOT_READY', '数据生成任务尚未完成或已经发布')
  if (problem.latestTestSetRevisionId !== input.expectedLatestRevisionId) fail(409, 'TEST_SET_REVISION_STALE', '题目正式测试版本已变化')
  const selected = await prisma.problemDataGenerationCase.findMany({ where: { jobId: job.id, status: 'validated', ...(input.caseIds?.length ? { id: { in: input.caseIds } } : {}) }, orderBy: { orderIndex: 'asc' } })
  if (!selected.length) fail(400, 'GENERATION_CASES_EMPTY', '没有选择可发布的候选测试点')
  const selectedHashes = selected.map(item => item.inputSha256!)
  if (new Set(selectedHashes).size !== selectedHashes.length) {
    fail(409, 'GENERATION_INPUT_DUPLICATE', '所选候选测试点中存在重复输入')
  }
  const duplicate = await prisma.testdataObject.findFirst({ where: { problemId: problem.id, sha256: { in: selected.map(item => item.inputSha256!) }, OR: [{ AcmInputs: { some: { revisionId: problem.latestTestSetRevisionId! } } }, { GroupInputs: { some: { revisionId: problem.latestTestSetRevisionId! } } }] } })
  if (duplicate) fail(409, 'GENERATION_INPUT_DUPLICATE', '候选输入与当前正式版本中的测试点重复')
  const objects = await prisma.testdataObject.findMany({ where: { id: { in: selected.flatMap(item => [item.inputObjectId!, item.outputObjectId!]) }, problemId: problem.id } })
  const byId = new Map(objects.map(item => [item.id, item])); const createdFiles: string[] = []; const createdFileIds: string[] = []; const createdTestcaseIds: string[] = []
  try {
    const candidateCases: Array<RevisionCaseSpec & { caseId: string; testcaseId: string }> = []
    for (const item of selected) {
      const stem = `generated_${job.id.slice(0, 8)}_${String(item.orderIndex + 1).padStart(3, '0')}`
      const inputName = `${stem}.in`, outputName = `${stem}.out`, inputObject = byId.get(item.inputObjectId!)!, outputObject = byId.get(item.outputObjectId!)!
      const [inputFile, outputFile] = await Promise.all([materializeCurrentFile(problem.id, inputName, inputObject), materializeCurrentFile(problem.id, outputName, outputObject)])
      createdFiles.push(inputName, outputName); createdFileIds.push(inputFile.id, outputFile.id)
      const testcase = await prisma.problemTestcase.create({ data: { id: crypto.randomUUID(), problemId: problem.id, inputFileId: inputFile.id, outputFileId: outputFile.id, source: 'generated', inputSha256: inputObject.sha256, outputSha256: outputObject.sha256, orderIndex: item.orderIndex } })
      createdTestcaseIds.push(testcase.id)
      candidateCases.push({ caseId: item.id, testcaseId: testcase.id, inputName, outputName, inputObjectId: inputObject.id, outputObjectId: outputObject.id, source: 'generated' as const, score: null })
    }
    const spec = await loadRevisionSpec(problem.latestTestSetRevisionId!)
    if (!spec) throw new Error('当前正式测试版本不存在')
    if (spec.mode === 'acm') spec.cases = [...(spec.cases || []), ...candidateCases]
    else {
      const assignments = input.assignments || []
      for (const candidate of candidateCases) {
        const links = assignments.filter(item => item.caseId === candidate.caseId)
        if (!links.length) fail(422, 'GENERATION_GROUP_REQUIRED', `${candidate.inputName} 尚未分配 Official Group`)
        for (const link of links) {
          const subtask = spec.subtasks?.find(item => item.id === Number(link.subtaskId)); const group = subtask?.groups.find(item => item.key === link.groupKey)
          if (!group || group.kind !== 'official') fail(422, 'GENERATION_GROUP_INVALID', '候选测试点只能加入当前题目的 Official Group')
          group.cases.push(candidate)
        }
      }
    }
    const revision = await publishTestSetRevision({ problemId: problem.id, expectedLatestRevisionId: input.expectedLatestRevisionId, source: 'admin_edit', createdBy: input.user.userId, baseConfigText: problem.judgeConfig, spec, transactionHook: async (tx, next) => {
      await tx.problemDataGenerationJob.update({ where: { id: job.id }, data: { status: 'promoted', promotedRevisionId: next.id } })
      for (const candidate of candidateCases) await tx.problemDataGenerationCase.update({ where: { id: candidate.caseId }, data: { status: 'promoted', promotedTestcaseId: candidate.testcaseId } })
    } })
    return revision
  } catch (error) {
    await prisma.problemTestcase.deleteMany({ where: { id: { in: createdTestcaseIds } } }).catch(() => undefined)
    await prisma.testdataFile.deleteMany({ where: { id: { in: createdFileIds } } }).catch(() => undefined)
    await Promise.allSettled(createdFiles.map(name => fs.promises.rm(path.join(TESTDATA_ROOT, problem.id, name), { force: true })))
    if (error instanceof TestSetRevisionConflict) fail(409, 'TEST_SET_REVISION_STALE', '题目正式测试版本已变化')
    throw error
  }
}
