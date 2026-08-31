import crypto from 'crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { canModifyProblem, canViewProblem } from '../problem.access'
import {
  HACK_INPUT_LIMIT,
  HACK_SOURCE_LIMIT,
  allowedProblemLanguages,
  hasOiHackGroups,
  isHackableJudgeConfig,
  judgeConfigHash,
  parseJudgeConfig,
  resolveJudgeMode,
  serializeHackAttempt,
  validateHackCppSource,
} from '../problem.hack.service'
import { ensureInitialTestSetRevision } from '../problem.testset-revision.service'
import { transitionHackAttempt } from '../problem.hack-state'
import { resolveContributionContext } from '../problem.contribution-readiness.service'

const ACTIVE_STATUSES = ['queuing', 'judging', 'finalizing']

export class ProblemHackRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string, data?: unknown): never {
  throw new ProblemHackRouteError(statusCode, code, message, data)
}

async function requireManageableProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canModifyProblem(user, problem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  return problem
}

export async function getProblemHackConfig(user: JwtPayload, problemId: string) {
  const problem = await requireManageableProblem(user, problemId)
  const config = await prisma.problemHackConfig.findUnique({ where: { problemId: problem.id } })
  return config || {
    enabled: false,
    mode: resolveJudgeMode(parseJudgeConfig(problem.judgeConfig)),
    standardSource: '',
    standardLanguage: 'cpp17',
    validatorSource: '',
    validatorLanguage: 'cpp17',
    classifierSource: '',
    classifierLanguage: 'cpp17',
    revision: 0,
  }
}

export async function saveProblemHackConfig(input: {
  user: JwtPayload
  problemId: string
  body: any
}) {
  const problem = await requireManageableProblem(input.user, input.problemId)
  const enabled = input.body?.enabled === true
  let standardSource = typeof input.body?.standardSource === 'string'
    ? input.body.standardSource
    : ''
  let validatorSource = typeof input.body?.validatorSource === 'string'
    ? input.body.validatorSource
    : ''
  let classifierSource = typeof input.body?.classifierSource === 'string'
    ? input.body.classifierSource
    : ''
  const programVersionIds = {
    standard: typeof input.body?.standardProgramVersionId === 'string' ? input.body.standardProgramVersionId : null,
    validator: typeof input.body?.validatorProgramVersionId === 'string' ? input.body.validatorProgramVersionId : null,
    classifier: typeof input.body?.classifierProgramVersionId === 'string' ? input.body.classifierProgramVersionId : null,
  }
  for (const [kind, versionId] of Object.entries(programVersionIds)) if (versionId) {
    const version = await prisma.problemJudgeProgramVersion.findFirst({ where: { id: versionId, problemId: problem.id } })
    const program = version ? await prisma.problemJudgeProgram.findFirst({ where: { id: version.programId, problemId: problem.id, kind } }) : null
    if (!version || !program) fail(400, 'HACK_PROGRAM_VERSION_INVALID', `${kind} 程序版本无效`)
    if (kind === 'standard') standardSource = version.source
    if (kind === 'validator') validatorSource = version.source
    if (kind === 'classifier') classifierSource = version.source
  }
  const sourceLengths = [standardSource, validatorSource, classifierSource]
    .map(source => Buffer.byteLength(source, 'utf8'))
  if (sourceLengths.some(length => length > HACK_SOURCE_LIMIT)) {
    fail(
      413,
      'SOURCE_TOO_LARGE',
      'STD、Validator 或 Classifier 源码不能超过 256 KiB',
    )
  }

  let latestRevision
  try {
    latestRevision = await ensureInitialTestSetRevision(problem.id, input.user.userId)
  } catch (error) {
    fail(
      409,
      'TEST_SET_REVISION_REQUIRED',
      error instanceof Error ? error.message : '题目尚无正式测试版本',
    )
  }
  const effectiveConfig = latestRevision?.judgeConfig || problem.judgeConfig
  const parsedConfig = parseJudgeConfig(effectiveConfig)
  const mode = resolveJudgeMode(parsedConfig)
  if (enabled) {
    if (!isHackableJudgeConfig(parsedConfig)) {
      fail(409, 'HACK_REQUIRES_BATCH', '只有 ACM 或 OI 本地批处理题可以启用 Hack')
    }
    if (mode === 'oi' && !hasOiHackGroups(effectiveConfig)) {
      fail(
        409,
        'OI_TEST_GRAPH_REQUIRED',
        '请先完成 OI 测试图迁移并确保每个 Subtask 都有 Hack Gate',
      )
    }
    const testdataCount = await prisma.testdataFile.count({ where: { problemId: problem.id } })
    if (!problem.judgeConfig?.trim() || testdataCount === 0) {
      fail(
        409,
        'LOCAL_JUDGE_NOT_CONFIGURED',
        '请先配置本地评测和测试数据',
      )
    }
    try {
      await validateHackCppSource(standardSource, '标准程序')
      await validateHackCppSource(validatorSource, 'Validator')
      if (mode === 'oi') await validateHackCppSource(classifierSource, 'Classifier')
    } catch (error) {
      fail(
        422,
        'HACK_CONFIG_COMPILE_ERROR',
        error instanceof Error ? error.message : 'Hack 系统程序编译失败',
      )
    }
  }

  const requestedRevision = input.body?.expectedRevision
  try {
    const config = await prisma.$transaction(async tx => {
      const current = await tx.problemHackConfig.findUnique({
        where: { problemId: problem.id },
      })
      const expected = requestedRevision === undefined
        ? current?.revision || 0
        : Number(requestedRevision)
      if (!Number.isInteger(expected) || expected !== (current?.revision || 0)) {
        fail(
          409,
          'HACK_CONFIG_STALE',
          'Hack 配置已被其他管理员更新，请刷新后重试',
        )
      }
      const data = {
        enabled,
        mode,
        standardSource,
        validatorSource,
        classifierSource,
        standardLanguage: 'cpp17',
        validatorLanguage: 'cpp17',
        classifierLanguage: 'cpp17',
        updatedBy: input.user.userId,
        standardProgramVersionId: programVersionIds.standard,
        validatorProgramVersionId: programVersionIds.validator,
        classifierProgramVersionId: programVersionIds.classifier,
      }
      if (!current) {
        return tx.problemHackConfig.create({
          data: {
            id: crypto.randomUUID(),
            problemId: problem.id,
            ...data,
            revision: 1,
          },
        })
      }
      const updated = await tx.problemHackConfig.updateMany({
        where: { id: current.id, revision: expected },
        data: { ...data, revision: { increment: 1 } },
      })
      if (updated.count !== 1) {
        fail(
          409,
          'HACK_CONFIG_STALE',
          'Hack 配置已被其他管理员更新，请刷新后重试',
        )
      }
      return tx.problemHackConfig.findUniqueOrThrow({ where: { id: current.id } })
    })
    return { config, message: enabled ? 'Hack 已启用' : 'Hack 配置已保存' }
  } catch (error: any) {
    if (error instanceof ProblemHackRouteError) throw error
    if (error?.code === 'P2002' || error?.code === 'P2034') {
      fail(409, 'HACK_CONFIG_STALE', 'Hack 配置已被其他管理员更新，请刷新后重试')
    }
    throw error
  }
}

async function loadSubmittableProblem(user: JwtPayload, problemId: string) {
  let problem = await prisma.problem.findUnique({
    where: { id: problemId },
    include: { LatestTestSetRevision: true },
  })
  if (!problem || problem.status !== 'published' || !canViewProblem(user, problem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在或当前身份不能提交该题')
  }
  if (!problem.LatestTestSetRevision) {
    try {
      await ensureInitialTestSetRevision(problem.id, user.userId)
    } catch (error) {
      fail(
        409,
        'TEST_SET_REVISION_REQUIRED',
        error instanceof Error ? error.message : '题目尚无正式测试版本',
      )
    }
    problem = await prisma.problem.findUnique({
      where: { id: problem.id },
      include: { LatestTestSetRevision: true },
    }) as typeof problem
  }
  return problem
}

export async function createProblemHackAttempt(input: {
  user: JwtPayload
  problemId: string
  body: any
}) {
  const problem = await loadSubmittableProblem(input.user, input.problemId)
  const hackConfig = await prisma.problemHackConfig.findUnique({
    where: { problemId: problem.id },
  })
  if (
    !hackConfig?.enabled
    || !problem.LatestTestSetRevision
    || !isHackableJudgeConfig(parseJudgeConfig(problem.LatestTestSetRevision.judgeConfig))
  ) {
    fail(409, 'HACK_NOT_ENABLED', '该题未启用 Hack')
  }
  const readiness = await resolveContributionContext(input.user, input.problemId)
  if (!readiness.standardProgram) fail(409, 'STD_NOT_ACTIVE', '当前题目未配置已激活的标准程序 STD')
  if (!readiness.validatorProgram) fail(409, 'VALIDATOR_NOT_ACTIVE', '当前题目未配置已激活的 Validator')
  if (readiness.mode === 'oi' && !readiness.classifierProgram) fail(409, 'CLASSIFIER_NOT_ACTIVE', 'OI / IOI Hack 需要已激活的 Classifier')
  if (hackConfig.standardProgramVersionId !== readiness.standardProgram.version.id || hackConfig.validatorProgramVersionId !== readiness.validatorProgram.version.id || (readiness.mode === 'oi' && hackConfig.classifierProgramVersionId !== readiness.classifierProgram?.version.id)) {
    fail(409, 'HACK_ASSET_SELECTION_REQUIRED', 'Hack 配置尚未固定到当前激活的评测程序版本，请由管理员重新保存 Hack 设置')
  }

  const inputMode = input.body?.inputMode === 'generator'
    ? 'generator'
    : input.body?.inputMode === 'data'
      ? 'data'
      : null
  const inputData = typeof input.body?.inputData === 'string' ? input.body.inputData : null
  const generatorSource = typeof input.body?.generatorSource === 'string'
    ? input.body.generatorSource
    : null
  const generatorLanguage = typeof input.body?.generatorLanguage === 'string'
    ? input.body.generatorLanguage
    : null
  const hackSource = typeof input.body?.hackSource === 'string' ? input.body.hackSource : ''
  const hackLanguage = typeof input.body?.hackLanguage === 'string' ? input.body.hackLanguage : ''

  if (!inputMode || !hackSource.trim()) {
    fail(400, 'HACK_INPUT_REQUIRED', '请提供候选输入和被 Hack 程序')
  }
  if (Buffer.byteLength(hackSource, 'utf8') > HACK_SOURCE_LIMIT) {
    fail(413, 'SOURCE_TOO_LARGE', '被 Hack 程序不能超过 256 KiB')
  }
  if (inputMode === 'data') {
    if (!inputData?.trim()) fail(400, 'HACK_INPUT_REQUIRED', '候选输入不能为空')
    if (Buffer.byteLength(inputData, 'utf8') > HACK_INPUT_LIMIT) {
      fail(413, 'INPUT_TOO_LARGE', '候选输入不能超过 1 MiB')
    }
  } else {
    if (!generatorSource?.trim() || !['cpp17', 'python3'].includes(generatorLanguage || '')) {
      fail(400, 'HACK_GENERATOR_REQUIRED', '请提供 C++17 或 Python3 数据生成器')
    }
    if (Buffer.byteLength(generatorSource, 'utf8') > HACK_SOURCE_LIMIT) {
      fail(413, 'SOURCE_TOO_LARGE', '生成器源码不能超过 256 KiB')
    }
  }
  if (!allowedProblemLanguages(problem).includes(hackLanguage)) {
    fail(400, 'LANGUAGE_NOT_ALLOWED', '被 Hack 程序语言不在题目允许范围内')
  }

  const active = await prisma.problemHackAttempt.findFirst({
    where: {
      problemId: problem.id,
      userId: input.user.userId,
      status: { in: ACTIVE_STATUSES },
    },
    select: { id: true },
  })
  if (active) {
    fail(409, 'HACK_ALREADY_ACTIVE', '你在这道题已有一个正在处理的 Hack')
  }

  try {
    const attempt = await prisma.problemHackAttempt.create({
      data: {
        id: crypto.randomUUID(),
        problemId: problem.id,
        userId: input.user.userId,
        status: 'queuing',
        inputMode,
        inputData: inputMode === 'data' ? inputData : null,
        generatorSource: inputMode === 'generator' ? generatorSource : null,
        generatorLanguage: inputMode === 'generator' ? generatorLanguage : null,
        hackSource,
        hackLanguage,
        hackConfigRevision: hackConfig.revision,
        judgeConfigHash: problem.LatestTestSetRevision.judgeConfigHash,
        testGraphRevision: problem.testGraphRevision,
        baseTestSetRevisionId: problem.latestTestSetRevisionId,
      },
    })
    return serializeHackAttempt(attempt, true)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      fail(409, 'HACK_ALREADY_ACTIVE', '你在这道题已有一个正在处理的 Hack')
    }
    throw error
  }
}

async function requireVisibleProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canViewProblem(user, problem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  return problem
}

const hackAttemptInclude = {
  User: { select: { username: true } },
  Candidate: { select: { id: true, status: true } },
  BaseTestSetRevision: { select: { revisionNumber: true } },
  PromotedRevision: { select: { revisionNumber: true } },
} as const

export async function listProblemHackAttempts(input: {
  user: JwtPayload
  problemId: string
  pageValue: unknown
  pageSizeValue: unknown
}) {
  const problem = await requireVisibleProblem(input.user, input.problemId)
  const manager = canModifyProblem(input.user, problem)
  const page = Math.max(1, Number(input.pageValue) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(input.pageSizeValue) || 20))
  const where = {
    problemId: problem.id,
    ...(manager ? {} : { userId: input.user.userId }),
  }
  const [attempts, total, acceptedCount] = await Promise.all([
    prisma.problemHackAttempt.findMany({
      where,
      include: hackAttemptInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.problemHackAttempt.count({ where }),
    prisma.problemHackAttempt.count({
      where: { problemId: problem.id, status: 'accepted' },
    }),
  ])
  return {
    attempts: attempts.map(item => serializeHackAttempt(item, false)),
    total,
    page,
    pageSize,
    acceptedCount,
    canManage: manager,
  }
}

export async function getProblemHackAttempt(
  user: JwtPayload,
  problemId: string,
  hackId: string,
) {
  const problem = await requireVisibleProblem(user, problemId)
  const manager = canModifyProblem(user, problem)
  const attempt = await prisma.problemHackAttempt.findFirst({
    where: { id: hackId, problemId: problem.id },
    include: hackAttemptInclude,
  })
  if (!attempt || (!manager && attempt.userId !== user.userId)) {
    fail(404, 'HACK_ATTEMPT_NOT_FOUND', 'Hack 记录不存在')
  }
  return serializeHackAttempt(attempt, true)
}

export async function retryProblemHackAttempt(
  user: JwtPayload,
  problemId: string,
  hackId: string,
) {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    include: { LatestTestSetRevision: true },
  })
  if (!problem || !canModifyProblem(user, problem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  const [attempt, config] = await Promise.all([
    prisma.problemHackAttempt.findFirst({ where: { id: hackId, problemId: problem.id } }),
    prisma.problemHackConfig.findUnique({ where: { problemId: problem.id } }),
  ])
  if (!attempt || attempt.status !== 'system_error' || !config?.enabled) {
    fail(409, 'HACK_RETRY_NOT_ALLOWED', '只有系统错误的 Hack 可以重新执行')
  }
  const active = await prisma.problemHackAttempt.findFirst({
    where: {
      problemId: problem.id,
      userId: attempt.userId,
      status: { in: ACTIVE_STATUSES },
      id: { not: attempt.id },
    },
    select: { id: true },
  })
  if (active) {
    fail(409, 'HACK_ALREADY_ACTIVE', '该用户在这道题已有一个正在处理的 Hack')
  }
  try {
    const transitioned = await transitionHackAttempt(prisma, {
      id: attempt.id,
      from: 'system_error',
      to: 'queuing',
      data: {
        hackConfigRevision: config.revision,
        judgeConfigHash: problem.LatestTestSetRevision?.judgeConfigHash
          || judgeConfigHash(problem.judgeConfig),
        baselineResult: null,
        candidateResult: null,
        baselineScore: null,
        candidateScore: null,
        scoreDelta: null,
        affectedSubtaskIds: null,
        acceptedTestcaseId: null,
        testGraphRevision: problem.testGraphRevision,
        baseTestSetRevisionId: problem.latestTestSetRevisionId,
        canonicalStatus: null,
        candidateTestcaseId: null,
        promotedRevisionId: null,
        promotionRetries: 0,
        failureStage: null,
        message: null,
        judgeId: null,
        judgeStarted: null,
        finishedAt: null,
      },
    })
    if (transitioned.count !== 1) {
      fail(409, 'HACK_STATE_CHANGED', 'Hack 状态已变化，请刷新后重试')
    }
    const updated = await prisma.problemHackAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    })
    return serializeHackAttempt(updated, true)
  } catch (error: any) {
    if (error instanceof ProblemHackRouteError) throw error
    if (error?.code === 'P2002') {
      fail(409, 'HACK_ALREADY_ACTIVE', '该用户在这道题已有一个正在处理的 Hack')
    }
    throw error
  }
}
