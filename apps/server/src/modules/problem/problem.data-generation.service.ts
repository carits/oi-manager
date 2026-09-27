import crypto from 'crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../prisma'
import { acquireTestSetReaderTx, ensureInitialTestSetSlots, ingestTestdataObject, loadTestSetSlotSpec, releaseTestSetReader, replaceTestSetSlot, TestSetSlotFenceConflict, type SlotCaseSpec } from './problem.testset-slot.service'
import { requireProgramProblem } from './problem.judge-program.service'
import yaml from 'js-yaml'
import { canModifyProblem } from './problem.access'
import { createAdmittedCandidate } from './problem.testcase-candidate.service'
import { EVALUATION_LIMITS, releaseEvaluationCreditsInTransaction, reserveEvaluationCreditsInTransaction, settleEvaluationCreditsInTransaction, usageCredits } from './problem.evaluation-budget.service'
import { requireContributionReady, resolveActiveProgramVersion } from './problem.contribution-readiness.service'
import { resolveSubtaskReadiness } from './problem.subtask-readiness.service'
import { OI_CANDIDATE_LIMITS, uniqueSubtaskCases, validateOiFormalLimits } from './problem.oi-candidate-policy'
import { queueCandidateEvaluation } from './problem.candidate-evaluation.service'

const MAX_CASES = Number(process.env.DATA_GENERATION_MAX_CASES || 50)
const ACTIVE = ['queued', 'running', 'finalizing']
export class DataGenerationError extends Error { constructor(public statusCode: number, public code: string, message: string, public data?: unknown) { super(message) } }
function fail(statusCode: number, code: string, message: string, data?: unknown): never { throw new DataGenerationError(statusCode, code, message, data) }

async function loadVersion(problemId: string, versionId: string, expectedKind: string) {
  const version = await prisma.problemJudgeProgramVersion.findFirst({ where: { id: versionId, problemId, compileStatus: 'passed', lifecycleStatus: 'active' } })
  if (!version) fail(409, 'PROGRAM_VERSION_NOT_ACTIVE', '正式数据任务只能使用已完成预检并显式激活的评测程序版本')
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

function secureSeed() { return BigInt(`0x${crypto.randomBytes(8).toString('hex')}`).toString(10) }

function normalizeGeneratorV1Cases(cases: GenerationCaseInput[], protocolConfig: unknown): GenerationCaseInput[] {
  const config = protocolConfig && typeof protocolConfig === 'object' ? protocolConfig as any : null
  const profiles = new Map<string, any>((Array.isArray(config?.profiles) ? config.profiles : []).map((item: any) => [String(item.id), item]))
  const schema = config?.parameterSchema && typeof config.parameterSchema === 'object' && !Array.isArray(config.parameterSchema) ? config.parameterSchema as Record<string, any> : {}
  return cases.map((item, index) => {
    const profile = String(item.profile || '')
    const profileConfig = profiles.get(profile)
    if (!profileConfig) fail(422, 'GENERATOR_PROFILE_INVALID', `参数项 #${index + 1} 使用了不存在的 Profile`)
    const merged: Record<string, unknown> = { ...(profileConfig.params || {}), ...(item.params || {}) }
    for (const key of Object.keys(merged)) if (!Object.prototype.hasOwnProperty.call(schema, key)) fail(422, 'GENERATOR_PARAMETER_INVALID', `参数 ${key} 未在 Parameter Schema 中声明`)
    for (const [key, rule] of Object.entries(schema)) {
      let value = merged[key]
      if (value === undefined && Object.prototype.hasOwnProperty.call(rule, 'default')) value = rule.default
      if (value === undefined) fail(422, 'GENERATOR_PARAMETER_REQUIRED', `参数 ${key} 缺失`)
      if (rule.type === 'integer' && (!Number.isSafeInteger(value) || typeof value !== 'number')) fail(422, 'GENERATOR_PARAMETER_INVALID', `参数 ${key} 必须是安全整数`)
      if (rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) fail(422, 'GENERATOR_PARAMETER_INVALID', `参数 ${key} 必须是有限数字`)
      if (rule.type === 'string' && typeof value !== 'string') fail(422, 'GENERATOR_PARAMETER_INVALID', `参数 ${key} 必须是字符串`)
      if (rule.type === 'boolean' && typeof value !== 'boolean') fail(422, 'GENERATOR_PARAMETER_INVALID', `参数 ${key} 必须是布尔值`)
      if (typeof value === 'number' && (typeof rule.minimum === 'number' && value < rule.minimum || typeof rule.maximum === 'number' && value > rule.maximum)) fail(422, 'GENERATOR_PARAMETER_OUT_OF_RANGE', `参数 ${key} 超出允许范围`)
      if (Array.isArray(rule.enum) && !rule.enum.some((candidate: unknown) => Object.is(candidate, value))) fail(422, 'GENERATOR_PARAMETER_INVALID', `参数 ${key} 不在允许选项中`)
      merged[key] = value
    }
    return { ...item, args: [], seed: secureSeed(), profile, params: merged }
  })
}

export async function createDataGenerationJob(input: { user: JwtPayload; problemId: string; body: any }) {
  const contribution = input.body?.contribution === true
  const readiness = contribution ? await requireContributionReady(input.user, input.problemId) : null
  const problem = readiness?.problem || await requireProgramProblem(input.user, input.problemId)
  const manager = canModifyProblem(input.user, problem)
  const sourceMode = input.body?.sourceMode === 'input' ? 'input' : 'generator'
  let cases = normalizeCases({ ...input.body, sourceMode, contribution })
  if (contribution && cases.length > (sourceMode === 'input' ? 1 : 8)) fail(400, 'CONTRIBUTION_CASE_LIMIT', '普通贡献每次最多提交 1 个直接数据或 8 个生成参数')
  const ephemeralGenerator = contribution && sourceMode === 'generator' && typeof input.body?.generatorSource === 'string'
    ? { language: input.body?.generatorLanguage === 'python3' ? 'python3' as const : 'cpp17' as const, source: String(input.body.generatorSource), protocol: 'oj.generator/v1' as const, protocolConfig: input.body?.generatorManifest }
    : null
  const [standard, validator, generator] = await Promise.all([
    contribution ? Promise.resolve(readiness!.standardProgram!) : loadVersion(problem.id, String(input.body?.standardVersionId || ''), 'standard'),
    contribution ? Promise.resolve(readiness!.validatorProgram!) : loadVersion(problem.id, String(input.body?.validatorVersionId || ''), 'validator'),
    sourceMode === 'generator' && !ephemeralGenerator ? (contribution ? resolveActiveProgramVersion(problem.id, 'generator').then(value => value || fail(409, 'GENERATOR_NOT_ACTIVE', '该题尚未配置已激活的 Generator')) : loadVersion(problem.id, String(input.body?.generatorVersionId || ''), 'generator')) : null,
  ])
  if (sourceMode === 'generator' && ephemeralGenerator) cases = normalizeGeneratorV1Cases(cases, ephemeralGenerator.protocolConfig)
  if (sourceMode === 'generator' && !ephemeralGenerator && generator?.version.protocol === 'oj.generator/v1') cases = normalizeGeneratorV1Cases(cases, generator.version.protocolConfig)
  if (sourceMode === 'generator' && !ephemeralGenerator && generator?.version.protocol !== 'oj.generator/v1' && cases.some(item => item.profile || item.params)) fail(422, 'GENERATOR_PROTOCOL_MISMATCH', '历史 Generator 只能使用旧参数协议；请新建 Generator V1')
  await ensureInitialTestSetSlots(problem.id, input.user.userId)
  const evolving = await prisma.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: problem.id, slot: 'EVOLVING' } } })
  if (!evolving) fail(409, 'EVOLVING_TEST_SET_REQUIRED', '数据生成需要 Evolving 测试数据槽')
  const jobId = crypto.randomUUID()
  const reservedCredits = contribution ? (sourceMode === 'generator' ? 4_000 : 400) : 0
  const config: any = { sourceMode, cases, generator: ephemeralGenerator, generatorManifest: ephemeralGenerator?.protocolConfig || null, mode: readiness?.mode, classifierVersionId: readiness?.classifierProgram?.version.id || null }
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`data-generation:${problem.id}`}, 0)) IS NULL AS locked`
    const activeCount = await tx.problemDataGenerationJob.count({
      where: { problemId: problem.id, status: { in: ACTIVE } },
    })
    if (activeCount > 0) fail(409, 'GENERATION_JOB_ACTIVE', '该题已有数据生成任务正在执行')
    if (contribution) {
      const userActive = await tx.problemDataGenerationJob.count({ where: { createdBy: input.user.userId, contribution: true, status: { in: ACTIVE } } })
      if (userActive > 0) fail(409, 'CONTRIBUTION_TASK_ACTIVE', '每位用户同时只能执行一个 Candidate 贡献任务')
    }
    if (reservedCredits) await reserveEvaluationCreditsInTransaction(tx, { userId: input.user.userId, manager, taskType: 'candidate_generation', taskId: jobId, credits: reservedCredits, metadata: { problemId: problem.id, sourceMode } })
    const job = await tx.problemDataGenerationJob.create({ data: {
      id: jobId, problemId: problem.id, createdBy: input.user.userId, baseTestSetGraphHash: evolving.graphHash,
      baseTestSetFencingToken: evolving.fencingToken, expectedEvolvingFence: evolving.fencingToken, generatorVersionId: generator?.version.id || null,
      standardVersionId: standard.version.id, validatorVersionId: validator.version.id, config,
      contribution, contributionOrganizationId: contribution ? input.body?.contributionOrganizationId || null : null,
      targetRole: manager && input.body?.targetRole === 'official' ? 'official' : 'hack_gate', reservedCredits,
    } })
    await tx.problemDataGenerationCase.createMany({ data: cases.map((item, orderIndex) => ({ id: crypto.randomUUID(), jobId, problemId: problem.id, orderIndex, name: item.name, args: item.args, seed: item.seed })) })
    return job
  })
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
  return prisma.$transaction(async tx => {
    const job = await tx.problemDataGenerationJob.findFirst({ where: { id: jobId, problemId } })
    if (!job || job.status !== 'queued') fail(409, 'GENERATION_JOB_NOT_CANCELLABLE', '任务已开始或已经结束')
    const changed = await tx.problemDataGenerationJob.updateMany({ where: { id: jobId, problemId, status: 'queued' }, data: { status: 'cancelled', finishedAt: new Date() } })
    if (!changed.count) fail(409, 'GENERATION_JOB_NOT_CANCELLABLE', '任务已开始或已经结束')
    if (job.reservedCredits) await releaseEvaluationCreditsInTransaction(tx, { taskType: 'candidate_generation', taskId: job.id, reserved: job.reservedCredits, reason: '用户取消排队任务' })
    return { cancelled: true }
  })
}

export async function claimDataGenerationJob(judgeId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('candidate-evaluation-global-lane', 0)) IS NULL AS locked`
    const contributionRunning = await tx.problemDataGenerationJob.count({ where: { contribution: true, status: { in: ['running', 'finalizing'] } } })
    const evaluationRunning = await tx.candidateEvaluationRun.count({ where: { status: 'running' } })
    if (contributionRunning >= 1 || evaluationRunning >= 1) return null
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ProblemDataGenerationJob" WHERE status = 'queued' ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`
    if (!rows[0]) return null
    const job = await tx.problemDataGenerationJob.findUniqueOrThrow({ where: { id: rows[0].id } })
    const classifierVersionId = typeof (job.config as any)?.classifierVersionId === 'string'
      ? (job.config as any).classifierVersionId
      : null
    const [generator, standard, validator, classifier, cases, candidateHashes, slotObjects, problem] = await Promise.all([
      job.generatorVersionId ? tx.problemJudgeProgramVersion.findUnique({ where: { id: job.generatorVersionId }, include: { Program: true } }) : null,
      tx.problemJudgeProgramVersion.findUnique({ where: { id: job.standardVersionId }, include: { Program: true } }),
      tx.problemJudgeProgramVersion.findUnique({ where: { id: job.validatorVersionId }, include: { Program: true } }),
      classifierVersionId ? tx.problemJudgeProgramVersion.findUnique({ where: { id: classifierVersionId }, include: { Program: true } }) : null,
      tx.problemDataGenerationCase.findMany({ where: { jobId: job.id }, orderBy: { orderIndex: 'asc' } }),
      tx.testcaseCandidate.findMany({ where: { problemId: job.problemId }, select: { inputSha256: true } }),
      tx.testdataObject.findMany({
        where: {
          problemId: job.problemId,
          OR: [
            { SlotCaseInputs: { some: { problemId: job.problemId, slot: 'EVOLVING' } } },
            { SlotGroupInputs: { some: { problemId: job.problemId, slot: 'EVOLVING' } } },
          ],
        },
        select: { sha256: true },
      }),
      tx.problem.findUnique({ where: { id: job.problemId } }),
    ])
    const config = job.config as any
    const isExecutable = (version: typeof standard, kind: string) => Boolean(
      version
      && version.problemId === job.problemId
      && version.compileStatus === 'passed'
      && version.lifecycleStatus === 'active'
      && version.Program.kind === kind
      && version.Program.status === 'active'
      && version.Program.currentVersionId === version.id,
    )
    const assetsValid = isExecutable(standard, 'standard')
      && isExecutable(validator, 'validator')
      && (!generator || isExecutable(generator, 'generator'))
      && (!classifierVersionId || isExecutable(classifier, 'classifier'))
    if (!problem || !assetsValid) {
      const message = !problem ? '题目已不存在' : '任务固定的评测程序版本已停用；请使用当前激活版本重新创建任务'
      await tx.problemDataGenerationJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorCode: 'PROGRAM_VERSION_NOT_ACTIVE', errorMessage: message, finishedAt: new Date() },
      })
      await tx.problemDataGenerationCase.updateMany({
        where: { jobId: job.id, status: 'queued' },
        data: { status: 'failed', failureStage: 'assets', message },
      })
      if (job.reservedCredits) {
        await releaseEvaluationCreditsInTransaction(tx, {
          taskType: 'candidate_generation',
          taskId: job.id,
          reserved: job.reservedCredits,
          reason: '固定的评测程序版本已停用',
        })
      }
      return null
    }

    const acquired = await acquireTestSetReaderTx(tx, {
      problemId: job.problemId,
      slot: 'EVOLVING',
      ownerType: 'DATA_GENERATION',
      ownerId: job.id,
    })
    const fencingToken = crypto.randomUUID()
    const leaseExpiresAt = new Date(Date.now() + Number(process.env.DATA_GENERATION_LEASE_MS || 60 * 60_000))
    const changed = await tx.problemDataGenerationJob.updateMany({
      where: { id: job.id, status: 'queued' },
      data: {
        status: 'running',
        judgeId,
        fencingToken,
        testSetReaderId: acquired.reader.id,
        baseTestSetGraphHash: acquired.slot.graphHash,
        baseTestSetFencingToken: acquired.slot.fencingToken,
        expectedEvolvingFence: acquired.slot.fencingToken,
        leaseExpiresAt,
        startedAt: new Date(),
      },
    })
    if (!changed.count) return null

    const generatorConfig = config.generator || (generator
      ? { language: generator.language, source: generator.source, protocol: generator.protocol || 'legacy-args-v1' }
      : null)
    return {
      taskType: 'data_generation' as const,
      jobId: job.id,
      problemId: job.problemId,
      fencingToken,
      sourceMode: config.sourceMode,
      maxDataBytes: job.contribution ? EVALUATION_LIMITS.maxCandidateBytes : 1024 * 1024,
      problemConfig: yaml.load(acquired.slot.judgeConfig || '{}'),
      knownInputSha256: [...new Set([
        ...candidateHashes.map(item => item.inputSha256),
        ...slotObjects.map(item => item.sha256),
      ])],
      generator: generatorConfig,
      standard: { language: standard!.language, source: standard!.source },
      validator: { language: validator!.language, source: validator!.source, protocol: validator!.protocol },
      classifier: classifier ? { language: classifier.language, source: classifier.source, protocol: classifier.protocol } : null,
      cases: cases.map((item, index) => ({
        id: item.id,
        name: item.name,
        args: item.args,
        seed: item.seed,
        inputData: config.cases?.[index]?.inputData,
        profile: config.cases?.[index]?.profile,
        params: config.cases?.[index]?.params,
      })),
    }
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
  const candidatesToEvaluate: string[] = []
  try {
    for (const result of Array.isArray(payload?.cases) ? payload.cases : []) {
      const current = await prisma.problemDataGenerationCase.findFirst({ where: { id: String(result.id), jobId: job.id } })
      if (!current) continue
      if (result.status !== 'validated') {
        await prisma.problemDataGenerationCase.update({ where: { id: current.id }, data: { status: result.failureStage === 'deduplication' ? 'duplicate' : 'failed', failureStage: result.failureStage || 'unknown', message: String(result.message || '').slice(0, 4000), generatorTimeMs: result.generatorTimeMs, validatorTimeMs: result.validatorTimeMs, standardTimeMs: result.standardTimeMs, inputSha256: result.failureStage === 'deduplication' && result.inputData ? crypto.createHash('sha256').update(String(result.inputData)).digest('hex') : null } })
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
        const subtaskReadiness = mode === 'oi' ? await resolveSubtaskReadiness(job.problemId, 'EVOLVING') : []
        const eligibleSubtask = mode !== 'oi' || subtaskReadiness.some(item => affectedSubtaskIds.includes(item.subtaskId) && item.contributionMode !== 'closed')
        const bootstrapReady = mode === 'oi' && job.targetRole === 'official' && subtaskReadiness.some(item => affectedSubtaskIds.includes(item.subtaskId) && item.bootstrapAvailable)
        const evaluationStage = mode === 'oi' && (!result.classificationStatus || result.classificationStatus !== 'classified' || !affectedSubtaskIds.length)
          ? 'awaiting_classifier'
          : bootstrapReady
            ? 'bootstrap_ready'
            : !eligibleSubtask
            ? 'awaiting_corpus'
            : 'awaiting_evaluator'
        const admitted = await createAdmittedCandidate({ problemId: job.problemId, createdBy: job.createdBy, contributionOrganizationId: job.contributionOrganizationId, source: (job.config as any)?.sourceMode === 'generator' ? 'generator' : 'direct_data', targetRole: job.targetRole as 'official' | 'hack_gate', baseSlot: 'EVOLVING', baseGraphHash: job.baseTestSetGraphHash, baseFencingToken: job.baseTestSetFencingToken, input, output, inputFileName: `candidate_${current.id}.in`, outputFileName: `candidate_${current.id}.out`, standardVersionId: job.standardVersionId, validatorVersionId: job.validatorVersionId, classifierVersionId: (job.config as any)?.classifierVersionId || null, generatorVersionId: job.generatorVersionId, affectedSubtaskIds, status: 'ADMITTED', evaluationStage, provenance: { protocol: (job.config as any)?.generator?.protocol || null, context: (job.config as any)?.cases?.[current.orderIndex] || null, standardVersionId: job.standardVersionId, validatorVersionId: job.validatorVersionId, classifierVersionId: (job.config as any)?.classifierVersionId || null, generatorVersionId: job.generatorVersionId, timings: { generatorMs: result.generatorTimeMs || 0, validatorMs: result.validatorTimeMs || 0, standardMs: result.standardTimeMs || 0 }, inputSha256: inputObject.sha256, outputSha256: outputObject.sha256 } })
        duplicateCandidate = admitted.duplicate
        candidateId = admitted.duplicate ? null : admitted.candidate.id
        if (candidateId && evaluationStage === 'awaiting_evaluator') candidatesToEvaluate.push(candidateId)
      }
      await prisma.problemDataGenerationCase.update({ where: { id: current.id }, data: {
        status: duplicateCandidate ? 'duplicate' : 'validated', inputObjectId: inputObject.id, outputObjectId: outputObject.id,
        inputSha256: inputObject.sha256, outputSha256: outputObject.sha256, inputSize: input.length, outputSize: output.length,
        inputPreview: input.toString('utf8').slice(0, 8192), outputPreview: output.toString('utf8').slice(0, 8192),
        generatorTimeMs: result.generatorTimeMs, validatorTimeMs: result.validatorTimeMs, standardTimeMs: result.standardTimeMs,
        candidateId, failureStage: duplicateCandidate ? 'deduplication' : null, message: duplicateCandidate ? '与现有候选或正式测试数据完全重复' : (result.classificationMessage || null),
      } })
    }
    const cases = await prisma.problemDataGenerationCase.findMany({ where: { jobId: job.id } })
    const actual = job.reservedCredits ? usageCredits({ executions: cases.length * 4, cpuMs: cases.reduce((sum, item) => sum + (item.generatorTimeMs || 0) + (item.validatorTimeMs || 0) + (item.standardTimeMs || 0), 0), generatedBytes: cases.reduce((sum, item) => sum + (item.inputSize || 0) + (item.outputSize || 0), 0) }) : 0
    await prisma.$transaction(async tx => {
      const changed = await tx.problemDataGenerationJob.updateMany({ where: { id: job.id, status: 'finalizing', fencingToken: job.fencingToken }, data: { status: 'completed', judgeId: null, testSetReaderId: null, leaseExpiresAt: null, finishedAt: new Date() } })
      if (!changed.count) throw new Error('数据生成任务终态已变化')
      if (job.reservedCredits) await settleEvaluationCreditsInTransaction(tx, { taskType: 'candidate_generation', taskId: job.id, reserved: job.reservedCredits, actual, metadata: { status: 'completed' } })
    })
    if (job.testSetReaderId) await releaseTestSetReader(job.testSetReaderId).catch(() => undefined)
    for (const candidateId of candidatesToEvaluate) await queueCandidateEvaluation(candidateId).catch(() => undefined)
    return { stale: false }
  } catch (error) {
    await prisma.$transaction(async tx => {
      const changed = await tx.problemDataGenerationJob.updateMany({ where: { id: job.id, status: 'finalizing', fencingToken: job.fencingToken }, data: { status: 'failed', errorCode: 'GENERATION_PERSIST_FAILED', errorMessage: String((error as Error).message).slice(0, 4000), judgeId: null, testSetReaderId: null, leaseExpiresAt: null, finishedAt: new Date() } })
      if (changed.count && job.reservedCredits) await settleEvaluationCreditsInTransaction(tx, { taskType: 'candidate_generation', taskId: job.id, reserved: job.reservedCredits, actual: Math.min(job.reservedCredits, 1), metadata: { status: 'failed' } })
    })
    if (job.testSetReaderId) await releaseTestSetReader(job.testSetReaderId).catch(() => undefined)
    throw error
  }
}

export async function reconcileDataGenerationWriters(limit = 100) {
  const jobs = await prisma.problemDataGenerationJob.findMany({
    where: { status: 'promotion_pending' },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })
  let completed = 0
  for (const job of jobs) {
    const writer = await prisma.problemTestSetWriter.findFirst({
      where: { problemId: job.problemId, slot: 'EVOLVING', sourceId: job.id },
      orderBy: { requestedAt: 'desc' },
    })
    if (!writer) continue
    if (writer.status === 'SUCCEEDED') {
      const slot = await prisma.problemTestSetSlot.findUnique({
        where: { problemId_slot: { problemId: job.problemId, slot: 'EVOLVING' } },
      })
      if (!slot) continue
      await prisma.$transaction(async tx => {
        await tx.problemDataGenerationJob.updateMany({
          where: { id: job.id, status: 'promotion_pending' },
          data: { status: 'promoted', promotedGraphHash: slot.graphHash },
        })
        await tx.problemDataGenerationCase.updateMany({
          where: { jobId: job.id, status: 'validated' },
          data: { status: 'promoted' },
        })
      })
      completed++
    } else if (writer.status === 'FAILED' || writer.status === 'CANCELLED') {
      await prisma.problemDataGenerationJob.updateMany({
        where: { id: job.id, status: 'promotion_pending' },
        data: { status: 'completed', errorCode: 'EVOLVING_WRITE_FAILED', errorMessage: writer.errorMessage },
      })
    }
  }
  return { checked: jobs.length, completed }
}

export async function promoteDataGenerationJob(input: {
  user: JwtPayload
  problemId: string
  jobId: string
  expectedEvolvingFencingToken: number
  caseIds?: string[]
  assignments?: Array<{ caseId: string; subtaskId: number; groupKey: string }>
  overrideReason?: string
}) {
  const problem = await requireProgramProblem(input.user, input.problemId)
  await ensureInitialTestSetSlots(problem.id, input.user.userId)
  const [job, evolving] = await Promise.all([
    prisma.problemDataGenerationJob.findFirst({ where: { id: input.jobId, problemId: problem.id, status: 'completed' } }),
    prisma.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: problem.id, slot: 'EVOLVING' } } }),
  ])
  if (!job) fail(409, 'GENERATION_JOB_NOT_READY', '数据生成任务尚未完成或已经发布')
  if (job.contribution) fail(409, 'CONTRIBUTION_PROMOTION_MANAGED_BY_SELECTOR', '用户贡献数据只能由 Candidate Selector 写入 Evolving')
  if (!evolving) fail(409, 'EVOLVING_TEST_SET_REQUIRED', '题目尚无 Evolving 测试数据')
  if (evolving.fencingToken !== input.expectedEvolvingFencingToken) {
    fail(409, 'EVOLVING_FENCE_CONFLICT', 'Evolving 数据已变化，请刷新后重试')
  }

  const selected = await prisma.problemDataGenerationCase.findMany({
    where: {
      jobId: job.id,
      status: 'validated',
      ...(input.caseIds?.length ? { id: { in: input.caseIds } } : {}),
    },
    orderBy: { orderIndex: 'asc' },
  })
  if (!selected.length) fail(400, 'GENERATION_CASES_EMPTY', '没有选择可写入的候选测试点')
  const selectedHashes = selected.map(item => item.inputSha256!)
  if (new Set(selectedHashes).size !== selectedHashes.length) {
    fail(409, 'GENERATION_INPUT_DUPLICATE', '所选候选测试点中存在重复输入')
  }
  const duplicate = await prisma.testdataObject.findFirst({
    where: {
      problemId: problem.id,
      sha256: { in: selectedHashes },
      OR: [
        { SlotCaseInputs: { some: { problemId: problem.id, slot: 'EVOLVING' } } },
        { SlotGroupInputs: { some: { problemId: problem.id, slot: 'EVOLVING' } } },
      ],
    },
  })
  if (duplicate) fail(409, 'GENERATION_INPUT_DUPLICATE', '候选输入与当前 Evolving 数据重复')

  const objects = await prisma.testdataObject.findMany({
    where: {
      id: { in: selected.flatMap(item => [item.inputObjectId!, item.outputObjectId!]) },
      problemId: problem.id,
    },
  })
  const byId = new Map(objects.map(item => [item.id, item]))
  const candidateCases: Array<SlotCaseSpec & { caseId: string }> = selected.map(item => {
    const stem = `generated_${job.id.slice(0, 8)}_${String(item.orderIndex + 1).padStart(3, '0')}`
    const inputObject = byId.get(item.inputObjectId!)
    const outputObject = byId.get(item.outputObjectId!)
    if (!inputObject || !outputObject) fail(409, 'GENERATION_OBJECT_MISSING', '生成数据对象不完整')
    return {
      caseId: item.id,
      testcaseId: null,
      inputName: `${stem}.in`,
      outputName: `${stem}.out`,
      inputObjectId: inputObject.id,
      outputObjectId: outputObject.id,
      source: 'generated',
      score: null,
    }
  })

  const spec = await loadTestSetSlotSpec(problem.id, 'EVOLVING')
  if (!spec) fail(409, 'EVOLVING_TEST_SET_REQUIRED', '题目尚无 Evolving 测试数据')
  if (spec.mode === 'acm') {
    spec.cases = [...(spec.cases || []), ...candidateCases]
  } else {
    const assignments = input.assignments || []
    for (const candidate of candidateCases) {
      const links = assignments.filter(item => item.caseId === candidate.caseId)
      if (!links.length) fail(422, 'GENERATION_GROUP_REQUIRED', `${candidate.inputName} 尚未分配 Official Group`)
      for (const link of links) {
        const subtask = spec.subtasks?.find(item => item.id === Number(link.subtaskId))
        const group = subtask?.groups.find(item => item.key === link.groupKey)
        if (!group || group.kind !== 'official') {
          fail(422, 'GENERATION_GROUP_INVALID', '候选测试点只能加入当前题目的 Official Group')
        }
        group.cases.push(candidate)
      }
    }
    const limitIssues = validateOiFormalLimits(spec)
    if (limitIssues.length) fail(409, limitIssues[0].code, limitIssues[0].message, { issues: limitIssues })
    const readiness = await resolveSubtaskReadiness(problem.id, 'EVOLVING')
    const assignedSubtasks = [...new Set(assignments.map(item => Number(item.subtaskId)).filter(Number.isInteger))]
    const overrideReason = String(input.overrideReason || '').trim()
    for (const subtaskId of assignedSubtasks) {
      const state = readiness.find(item => item.subtaskId === subtaskId)
      const next = spec.subtasks?.find(item => item.id === subtaskId)
      if (!state || !next || state.contributionMode !== 'closed') continue
      const nextCount = uniqueSubtaskCases(next).length
      if (state.caseCount < OI_CANDIDATE_LIMITS.MIN_BOOTSTRAP_CASES && nextCount <= OI_CANDIDATE_LIMITS.MIN_BOOTSTRAP_CASES) continue
      if (overrideReason.length < 10) {
        fail(409, 'WRONG_CORPUS_REQUIRED', `Subtask ${subtaskId} 尚无可用于价值评估的错误程序；管理员强制写入需填写至少 10 字原因`)
      }
    }
  }

  try {
    const writer = await replaceTestSetSlot({
      problemId: problem.id,
      slot: 'EVOLVING',
      source: 'admin_edit',
      sourceId: job.id,
      requestedBy: input.user.userId,
      baseConfigText: evolving.judgeConfig,
      spec,
      expectedFencingToken: input.expectedEvolvingFencingToken,
    })
    if (writer.status === 'SUCCEEDED') {
      const current = await prisma.problemTestSetSlot.findUniqueOrThrow({
        where: { problemId_slot: { problemId: problem.id, slot: 'EVOLVING' } },
      })
      await prisma.$transaction(async tx => {
        await tx.problemDataGenerationJob.update({
          where: { id: job.id },
          data: { status: 'promoted', promotedGraphHash: current.graphHash },
        })
        await tx.problemDataGenerationCase.updateMany({
          where: { id: { in: candidateCases.map(item => item.caseId) } },
          data: { status: 'promoted' },
        })
        if (String(input.overrideReason || '').trim()) {
          await tx.platformAuditLog.create({
            data: {
              id: crypto.randomUUID(),
              actorUserId: input.user.userId,
              action: 'candidate_force_promoted',
              targetType: 'problem',
              targetId: problem.id,
              metadata: {
                reason: String(input.overrideReason).trim().slice(0, 1000),
                slot: 'EVOLVING',
                fromGraphHash: evolving.graphHash,
                toGraphHash: current.graphHash,
                caseIds: candidateCases.map(item => item.caseId),
              },
            },
          })
        }
      })
    } else {
      await prisma.problemDataGenerationJob.update({
        where: { id: job.id },
        data: { status: 'promotion_pending' },
      })
    }
    return writer
  } catch (error) {
    if (error instanceof TestSetSlotFenceConflict || (error as any)?.code === 'TEST_SET_SLOT_FENCE_CONFLICT') {
      fail(409, 'EVOLVING_FENCE_CONFLICT', 'Evolving 数据已变化，请刷新后重试')
    }
    throw error
  }
}
