import crypto from 'crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import logger from '../../../lib/logger'
import { canModifyProblem } from '../problem.access'
import {
  TestSetSlotConflict,
  loadTestSetSlotSpec,
  replaceTestSetSlot,
  resolveConfigSpec,
} from '../problem.testset-slot.service'
import {
  normalizeCheckerFileName,
  prepareCheckerInstallation,
  prepareCheckerRemoval,
  resolveCheckerDownload,
} from '../infrastructure/problem-checker-storage'

export class ProblemJudgeRouteError extends Error {
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
  throw new ProblemJudgeRouteError(statusCode, code, message, data)
}

async function requireManageableProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canModifyProblem(user, problem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  return problem
}

export async function listProblemCheckers(user: JwtPayload, problemId: string) {
  const problem = await requireManageableProblem(user, problemId)
  return prisma.problemChecker.findMany({
    where: { problemId: problem.id },
    orderBy: { uploadedAt: 'asc' },
  })
}

export async function getProblemCheckerDownload(
  user: JwtPayload,
  problemId: string,
  requestedName: string,
) {
  const problem = await requireManageableProblem(user, problemId)
  let fileName
  try { fileName = normalizeCheckerFileName(requestedName) } catch { fail(404, 'CHECKER_NOT_FOUND', '文件不存在') }
  const file = await prisma.problemChecker.findFirst({
    where: { problemId: problem.id, fileName },
  })
  if (!file) fail(404, 'CHECKER_NOT_FOUND', '文件不存在')
  const download = resolveCheckerDownload(problem.id, fileName)
  if (!download) fail(404, 'CHECKER_NOT_FOUND', '文件不存在')
  return download
}

export async function uploadProblemChecker(input: {
  user: JwtPayload
  problemId: string
  file?: Express.Multer.File
}) {
  const problem = await requireManageableProblem(input.user, input.problemId)
  if (!input.file) fail(400, 'CHECKER_FILE_REQUIRED', '请选择文件')
  let installation
  try {
    installation = prepareCheckerInstallation(problem.id, input.file)
  } catch (error) {
    fail(
      400,
      'INVALID_CHECKER_FILE',
      error instanceof Error ? error.message : 'Checker 文件无效',
    )
  }
  const downloadUrl = `/api/problems/${encodeURIComponent(problem.id)}/checker/${encodeURIComponent(installation.fileName)}/download`
  try {
    const file = await prisma.problemChecker.upsert({
      where: {
        problemId_fileName: { problemId: problem.id, fileName: installation.fileName },
      },
      update: {
        fileSize: installation.fileSize,
        fileUrl: downloadUrl,
        language: installation.language,
      },
      create: {
        id: crypto.randomUUID(),
        problemId: problem.id,
        fileName: installation.fileName,
        fileSize: installation.fileSize,
        fileUrl: downloadUrl,
        language: installation.language,
      },
    })
    installation.commit()
    return file
  } catch (error) {
    installation.rollback()
    throw error
  }
}

export async function deleteProblemChecker(
  user: JwtPayload,
  problemId: string,
  checkerId: string,
) {
  const problem = await requireManageableProblem(user, problemId)
  const file = await prisma.problemChecker.findFirst({
    where: { id: checkerId, problemId: problem.id },
  })
  if (!file) fail(404, 'CHECKER_NOT_FOUND', '文件不存在')
  const removal = prepareCheckerRemoval(problem.id, file.fileName)
  try {
    await prisma.problemChecker.delete({ where: { id: file.id } })
    removal.commit()
  } catch (error) {
    removal.rollback()
    throw error
  }
}

export async function getProblemJudgeConfig(user: JwtPayload, problemId: string) {
  const problem = await requireManageableProblem(user, problemId)
  let config = null
  if (problem.judgeConfig) {
    try {
      const yaml = await import('js-yaml')
      config = yaml.load(problem.judgeConfig)
      logger.info('judge_config_loaded', {
        action: 'getJudgeConfig',
        metadata: { subtasksCount: (config as any)?.subtasks?.length ?? 0 },
      })
    } catch (error) {
      logger.warn('parse_judge_config_error', { error })
    }
  }
  return {
    problemType: problem.problemType,
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
    config,
  }
}

function normalizeOptionalLimit(value: unknown, fieldName: string) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(400, 'INVALID_JUDGE_LIMIT', `${fieldName}无效`)
  }
  return parsed
}

function inferExistingMode(problem: any, yaml: typeof import('js-yaml')): 'acm' | 'oi' {
  const stable = problem.TestSetSlots?.find((item: any) => item.slot === 'STABLE')
  if (stable?.mode === 'oi') return 'oi'
  if (stable?.mode === 'acm') return 'acm'
  try {
    const parsed = problem.judgeConfig ? yaml.load(problem.judgeConfig) as any : {}
    return parsed?.mode === 'oi'
      || (parsed?.mode !== 'acm' && Array.isArray(parsed?.subtasks) && parsed.subtasks.length)
      ? 'oi'
      : 'acm'
  } catch {
    return 'acm'
  }
}

export async function saveProblemJudgeConfig(input: {
  user: JwtPayload
  problemId: string
  body: any
}) {
  const existingProblem = await prisma.problem.findUnique({
    where: { id: input.problemId },
    include: { TestSetSlots: { select: { slot: true, mode: true, fencingToken: true } } },
  })
  if (!existingProblem || !canModifyProblem(input.user, existingProblem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }

  const problemType = input.body?.problemType
  const timeLimit = normalizeOptionalLimit(input.body?.timeLimit, '时间限制')
  const memoryLimit = normalizeOptionalLimit(input.body?.memoryLimit, '内存限制')
  const config = input.body?.config
  let requestedMode: 'acm' | 'oi' | null = null
  let problem

  if (config) {
    const mode = config.mode
      || (Array.isArray(config.subtasks) && config.subtasks.length > 0 ? 'oi' : 'acm')
    if (mode !== 'acm' && mode !== 'oi') fail(400, 'INVALID_JUDGE_MODE', '无效的评测模式，必须是 acm 或 oi')
    const checkerType = String(config.checker_type || 'default').toLowerCase()
    if (mode === 'acm' && checkerType === 'lemon') {
      fail(400, 'ACM_LEMON_NOT_SUPPORTED', 'ACM 赛制不支持 Lemon checker，请使用 testlib 或其他判定型 checker')
    }
    const yaml = await import('js-yaml')
    const normalized = { ...config, mode }
    requestedMode = mode
    const stable = existingProblem.TestSetSlots.find(item => item.slot === 'STABLE')
    const currentMode = inferExistingMode(existingProblem, yaml)
    if (stable && currentMode !== mode) {
      fail(409, 'JUDGE_MODE_TRANSITION_REQUIRED', 'ACM/OI 模式切换必须使用显式状态迁移操作', {
        currentMode,
        targetMode: mode,
        slot: 'STABLE',
        fencingToken: stable.fencingToken,
      })
    }
    const baseConfig = yaml.dump(normalized, { lineWidth: -1 })
    const spec = stable
      ? await loadTestSetSlotSpec(existingProblem.id, 'STABLE')
      : await resolveConfigSpec(existingProblem.id, baseConfig)
    if (!spec) fail(409, 'TEST_SET_SLOT_REQUIRED', '无法读取当前 Stable 测试数据')
    try {
      await replaceTestSetSlot({
        problemId: existingProblem.id,
        slot: 'STABLE',
        expectedFencingToken: stable?.fencingToken,
        source: stable ? 'admin_edit' : 'initial',
        requestedBy: input.user.userId,
        baseConfigText: baseConfig,
        spec,
      })
    } catch (error: any) {
      if (error instanceof TestSetSlotConflict || error?.code === 'TEST_SET_SLOT_STALE') {
        fail(409, 'TEST_SET_SLOT_STALE', error.message)
      }
      throw error
    }
    problem = await prisma.problem.update({
      where: { id: existingProblem.id },
      data: {
        ...(problemType ? { problemType } : {}),
        ...(timeLimit !== undefined ? { timeLimit } : {}),
        ...(memoryLimit !== undefined ? { memoryLimit } : {}),
      },
    })
  } else {
    if (existingProblem.TestSetSlots.length) {
      fail(409, 'TEST_SET_SLOT_REQUIRED', '存在 Stable/Evolving 数据时不能清空 Judge Config')
    }
    problem = await prisma.problem.update({
      where: { id: existingProblem.id },
      data: {
        ...(problemType ? { problemType } : {}),
        ...(timeLimit !== undefined ? { timeLimit } : {}),
        ...(memoryLimit !== undefined ? { memoryLimit } : {}),
        judgeConfig: null,
      },
    })
  }

  logger.audit('judge_config_updated', {
    userId: input.user.userId,
    action: 'update_judge_config',
    target: existingProblem.id,
    metadata: { problemType, timeLimit, memoryLimit, mode: requestedMode },
  })
  return problem
}
