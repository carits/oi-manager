import crypto from 'crypto'
import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { prisma } from '../../prisma'
import { canModifyProblem, canViewProblem } from './problem.access'
import {
  HACK_INPUT_LIMIT,
  HACK_SOURCE_LIMIT,
  allowedProblemLanguages,
  isHackableJudgeConfig,
  hasOiHackGroups,
  judgeConfigHash,
  parseJudgeConfig,
  resolveJudgeMode,
  serializeHackAttempt,
  validateHackCppSource,
} from './problem.hack.service'

export const problemHackRouter = Router()

const ACTIVE_STATUSES = ['queuing', 'judging']

function canSubmitProblem(user: any, problem: any): boolean {
  return problem.status === 'published' && canViewProblem(user, problem)
}

problemHackRouter.get('/:id/hack-config', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem(req.user!, problem)) {
    return res.status(404).json({ success: false, message: '题目不存在' })
  }
  const config = await prisma.problemHackConfig.findUnique({ where: { problemId: problem.id } })
  res.json({
    success: true,
    data: config || {
      enabled: false,
      mode: resolveJudgeMode(parseJudgeConfig(problem.judgeConfig)),
      standardSource: '',
      standardLanguage: 'cpp17',
      validatorSource: '',
      validatorLanguage: 'cpp17',
      classifierSource: '',
      classifierLanguage: 'cpp17',
      revision: 0,
    },
  })
}))

problemHackRouter.put('/:id/hack-config', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem(req.user!, problem)) {
    return res.status(404).json({ success: false, message: '题目不存在' })
  }
  const enabled = req.body?.enabled === true
  const standardSource = typeof req.body?.standardSource === 'string' ? req.body.standardSource : ''
  const validatorSource = typeof req.body?.validatorSource === 'string' ? req.body.validatorSource : ''
  const classifierSource = typeof req.body?.classifierSource === 'string' ? req.body.classifierSource : ''
  const mode = resolveJudgeMode(parseJudgeConfig(problem.judgeConfig))
  if (Buffer.byteLength(standardSource, 'utf8') > HACK_SOURCE_LIMIT || Buffer.byteLength(validatorSource, 'utf8') > HACK_SOURCE_LIMIT || Buffer.byteLength(classifierSource, 'utf8') > HACK_SOURCE_LIMIT) {
    return res.status(413).json({ success: false, code: 'SOURCE_TOO_LARGE', message: 'STD、Validator 或 Classifier 源码不能超过 256 KiB' })
  }
  if (enabled) {
    if (!isHackableJudgeConfig(parseJudgeConfig(problem.judgeConfig))) {
      return res.status(409).json({ success: false, code: 'HACK_REQUIRES_BATCH', message: '只有 ACM 或 OI 本地批处理题可以启用 Hack' })
    }
    if (mode === 'oi' && !hasOiHackGroups(problem.judgeConfig)) {
      return res.status(409).json({ success: false, code: 'OI_TEST_GRAPH_REQUIRED', message: '请先完成 OI 测试图迁移并确保每个 Subtask 都有 Hack Gate' })
    }
    const testdataCount = await prisma.testdataFile.count({ where: { problemId: problem.id } })
    if (!problem.judgeConfig?.trim() || testdataCount === 0) {
      return res.status(409).json({ success: false, code: 'LOCAL_JUDGE_NOT_CONFIGURED', message: '请先配置本地评测和测试数据' })
    }
    try {
      await validateHackCppSource(standardSource, '标准程序')
      await validateHackCppSource(validatorSource, 'Validator')
      if (mode === 'oi') await validateHackCppSource(classifierSource, 'Classifier')
    } catch (error: any) {
      return res.status(422).json({ success: false, code: 'HACK_CONFIG_COMPILE_ERROR', message: error.message })
    }
  }

  const config = await prisma.problemHackConfig.upsert({
    where: { problemId: problem.id },
    create: {
      id: crypto.randomUUID(),
      problemId: problem.id,
      enabled,
      mode,
      standardSource,
      validatorSource,
      standardLanguage: 'cpp17',
      validatorLanguage: 'cpp17',
      classifierSource,
      classifierLanguage: 'cpp17',
      revision: 1,
      updatedBy: req.user!.userId,
    },
    update: {
      enabled,
      mode,
      standardSource,
      validatorSource,
      classifierSource,
      standardLanguage: 'cpp17',
      validatorLanguage: 'cpp17',
      classifierLanguage: 'cpp17',
      revision: { increment: 1 },
      updatedBy: req.user!.userId,
    },
  })
  res.json({ success: true, data: config, message: enabled ? 'Hack 已启用' : 'Hack 配置已保存' })
}))

problemHackRouter.post('/:id/hacks', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canSubmitProblem(req.user!, problem)) {
    return res.status(404).json({ success: false, message: '题目不存在或当前身份不能提交该题' })
  }
  const hackConfig = await prisma.problemHackConfig.findUnique({ where: { problemId: problem.id } })
  if (!hackConfig?.enabled || !isHackableJudgeConfig(parseJudgeConfig(problem.judgeConfig))) {
    return res.status(409).json({ success: false, code: 'HACK_NOT_ENABLED', message: '该题未启用 Hack' })
  }

  const inputMode = req.body?.inputMode === 'generator' ? 'generator' : req.body?.inputMode === 'data' ? 'data' : null
  const inputData = typeof req.body?.inputData === 'string' ? req.body.inputData : null
  const generatorSource = typeof req.body?.generatorSource === 'string' ? req.body.generatorSource : null
  const generatorLanguage = typeof req.body?.generatorLanguage === 'string' ? req.body.generatorLanguage : null
  const hackSource = typeof req.body?.hackSource === 'string' ? req.body.hackSource : ''
  const hackLanguage = typeof req.body?.hackLanguage === 'string' ? req.body.hackLanguage : ''

  if (!inputMode || !hackSource.trim()) return res.status(400).json({ success: false, message: '请提供候选输入和被 Hack 程序' })
  if (Buffer.byteLength(hackSource, 'utf8') > HACK_SOURCE_LIMIT) {
    return res.status(413).json({ success: false, code: 'SOURCE_TOO_LARGE', message: '被 Hack 程序不能超过 256 KiB' })
  }
  if (inputMode === 'data') {
    if (!inputData?.trim()) return res.status(400).json({ success: false, message: '候选输入不能为空' })
    if (Buffer.byteLength(inputData, 'utf8') > HACK_INPUT_LIMIT) {
      return res.status(413).json({ success: false, code: 'INPUT_TOO_LARGE', message: '候选输入不能超过 1 MiB' })
    }
  } else {
    if (!generatorSource?.trim() || !['cpp17', 'python3'].includes(generatorLanguage || '')) {
      return res.status(400).json({ success: false, message: '请提供 C++17 或 Python3 数据生成器' })
    }
    if (Buffer.byteLength(generatorSource, 'utf8') > HACK_SOURCE_LIMIT) {
      return res.status(413).json({ success: false, code: 'SOURCE_TOO_LARGE', message: '生成器源码不能超过 256 KiB' })
    }
  }
  if (!allowedProblemLanguages(problem).includes(hackLanguage)) {
    return res.status(400).json({ success: false, code: 'LANGUAGE_NOT_ALLOWED', message: '被 Hack 程序语言不在题目允许范围内' })
  }

  const active = await prisma.problemHackAttempt.findFirst({
    where: { problemId: problem.id, userId: req.user!.userId, status: { in: ACTIVE_STATUSES } },
    select: { id: true },
  })
  if (active) return res.status(409).json({ success: false, code: 'HACK_ALREADY_ACTIVE', message: '你在这道题已有一个正在处理的 Hack' })

  let attempt
  try {
    attempt = await prisma.problemHackAttempt.create({
      data: {
        id: crypto.randomUUID(),
        problemId: problem.id,
        userId: req.user!.userId,
        status: 'queuing',
        inputMode,
        inputData: inputMode === 'data' ? inputData : null,
        generatorSource: inputMode === 'generator' ? generatorSource : null,
        generatorLanguage: inputMode === 'generator' ? generatorLanguage : null,
        hackSource,
        hackLanguage,
        hackConfigRevision: hackConfig.revision,
        judgeConfigHash: judgeConfigHash(problem.judgeConfig),
        testGraphRevision: problem.testGraphRevision,
      },
    })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, code: 'HACK_ALREADY_ACTIVE', message: '你在这道题已有一个正在处理的 Hack' })
    }
    throw error
  }
  res.status(202).json({ success: true, data: serializeHackAttempt(attempt, true), message: 'Hack 已加入独立评测队列' })
}))

problemHackRouter.get('/:id/hacks', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canViewProblem(req.user!, problem)) return res.status(404).json({ success: false, message: '题目不存在' })
  const manager = canModifyProblem(req.user!, problem)
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20))
  const where = { problemId: problem.id, ...(manager ? {} : { userId: req.user!.userId }) }
  const [attempts, total, acceptedCount] = await Promise.all([
    prisma.problemHackAttempt.findMany({
      where,
      include: { User: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.problemHackAttempt.count({ where }),
    prisma.problemHackAttempt.count({ where: { problemId: problem.id, status: 'accepted' } }),
  ])
  res.json({ success: true, data: { attempts: attempts.map(item => serializeHackAttempt(item, false)), total, page, pageSize, acceptedCount, canManage: manager } })
}))

problemHackRouter.get('/:id/hacks/:hackId', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canViewProblem(req.user!, problem)) return res.status(404).json({ success: false, message: '题目不存在' })
  const manager = canModifyProblem(req.user!, problem)
  const attempt = await prisma.problemHackAttempt.findFirst({
    where: { id: req.params.hackId, problemId: problem.id },
    include: { User: { select: { username: true } } },
  })
  if (!attempt || (!manager && attempt.userId !== req.user!.userId)) return res.status(404).json({ success: false, message: 'Hack 记录不存在' })
  res.json({ success: true, data: serializeHackAttempt(attempt, true) })
}))

problemHackRouter.post('/:id/hacks/:hackId/retry', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem(req.user!, problem)) return res.status(404).json({ success: false, message: '题目不存在' })
  const [attempt, config] = await Promise.all([
    prisma.problemHackAttempt.findFirst({ where: { id: req.params.hackId, problemId: problem.id } }),
    prisma.problemHackConfig.findUnique({ where: { problemId: problem.id } }),
  ])
  if (!attempt || attempt.status !== 'system_error' || !config?.enabled) {
    return res.status(409).json({ success: false, message: '只有系统错误的 Hack 可以重新执行' })
  }
  const active = await prisma.problemHackAttempt.findFirst({
    where: { problemId: problem.id, userId: attempt.userId, status: { in: ACTIVE_STATUSES }, id: { not: attempt.id } },
    select: { id: true },
  })
  if (active) {
    return res.status(409).json({ success: false, code: 'HACK_ALREADY_ACTIVE', message: '该用户在这道题已有一个正在处理的 Hack' })
  }
  try {
    const updated = await prisma.problemHackAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'queuing',
        hackConfigRevision: config.revision,
        judgeConfigHash: judgeConfigHash(problem.judgeConfig),
        baselineResult: null,
        candidateResult: null,
        baselineScore: null,
        candidateScore: null,
        scoreDelta: null,
        affectedSubtaskIds: null,
        acceptedTestcaseId: null,
        testGraphRevision: problem.testGraphRevision,
        failureStage: null,
        message: null,
        judgeId: null,
        judgeStarted: null,
        finishedAt: null,
      },
    })
    return res.json({ success: true, data: serializeHackAttempt(updated, true), message: 'Hack 已重新加入队列' })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, code: 'HACK_ALREADY_ACTIVE', message: '该用户在这道题已有一个正在处理的 Hack' })
    }
    throw error
  }
}))
