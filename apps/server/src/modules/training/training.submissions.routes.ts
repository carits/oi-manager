/**
 * Training Submission Routes
 * 训练提交和评测记录路由
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { logger } from '../../lib/logger'
import { parsePagination, paginatedResponse } from '../../lib/pagination'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  canAccessTraining,
  canManageTraining,
  parseTrainingId,
  requireTrainingStarted,
} from './training.helpers'
import {
  IdempotencyConflictError,
  readIdempotencyKey,
  requestFingerprint,
  runIdempotent,
} from '../../lib/idempotency'

export const trainingSubmissionsRouter = Router()

/**
 * POST /api/trainings/:id/submit
 * 提交代码
 */
trainingSubmissionsRouter.post('/trainings/:id/submit', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { trainingProblemId, language, code, submitMethod } = req.body

    if (!trainingProblemId || !language || !code) {
      return res.status(400).json({ success: false, message: '缺少必要参数' })
    }

    const method = submitMethod || 'robot'
    const idempotencyKey = readIdempotencyKey(req)
    const fingerprint = requestFingerprint({
      trainingProblemId,
      language,
      code,
      submitMethod: method,
    })

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    // Check training is ongoing
    const now = new Date()
    if (now < training.startTime || now > training.endTime) {
      return res.status(400).json({ success: false, message: '训练未在进行中' })
    }

    // Verify problem belongs to this training
    const trainingProblem = await prisma.trainingProblem.findUnique({
      where: { id: trainingProblemId },
      include: { Problem: true },
    })
    if (!trainingProblem || trainingProblem.trainingId !== id) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    // 只允许支持机器人提交的平台（carits 本地评测、hdu 机器人提交）
    const platform = trainingProblem.Problem.platform
    if (platform !== 'carits' && platform !== 'hdu') {
      return res.status(400).json({ success: false, message: `${platform} 平台暂不支持在线提交` })
    }

    let submissionResult
    try {
      submissionResult = await runIdempotent(
        `training-submit:${userId}:${id}`,
        idempotencyKey,
        fingerprint,
        () => prisma.submission.create({
          data: {
        userId,
        oj: trainingProblem.Problem.platform,
        problemId: trainingProblem.Problem.problemId,
        language,
        code,
        codeLength: Buffer.byteLength(code, 'utf8'),
        result: 'queuing',
        submitMethod: method,
        problemInternalId: trainingProblem.Problem.id,
        // 新字段：submitScope 为核心
        submitScope: training.type === 'contest' ? 'contest' : 'training',
        trainingId: id,
        trainingProblemId: trainingProblem.id,
        // 比赛提交额外设置 contestId/contestProblemId
        ...(training.type === 'contest' ? {
          contestId: id,
          contestProblemId: trainingProblem.id,
        } : {}),
        // isGlobalVisible: 训练提交全局可见，比赛提交赛中不可见（结束后自动更新）
        isGlobalVisible: training.type === 'contest' ? false : true,
          },
        }),
      )
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return res.status(409).json({
          success: false,
          code: 'IDEMPOTENCY_CONFLICT',
          message: error.message,
        })
      }
      throw error
    }
    const submission = submissionResult.value
    if (submissionResult.replayed) {
      return res.json({
        success: true,
        data: { submissionId: submission.id, replayed: true },
        message: '已返回同一次提交的结果',
      })
    }

    const problemId = trainingProblem.Problem.problemId

    // Carits 平台：本地评测（新模式：入队后由 Consumer 自动消费）
    if (platform === 'carits') {
      // 更新 ojRemoteId（Carits 平台：远程提交ID就是本地评测ID）
      await prisma.submission.update({
        where: { id: submission.id },
        data: { ojRemoteId: submission.id.toString() }
      })

      logger.info('carits_training_submission_queued', {
        action: 'training_submit',
        metadata: { submissionId: submission.id, trainingId: id }
      })
    }
    // HDU 平台：机器人提交（复用 submit.ts 的逻辑）
    else if (platform === 'hdu' && method === 'robot') {
      const { submitToHdu } = await import('../../lib/hdu-submit')

      // 查询可用 HDU 账号
      const accounts = await prisma.ojAccount.findMany({
        where: {
          platform: 'hdu',
          enabled: true,
          password: { not: null },
          passwordIV: { not: null },
          OR: [{ status: 'active' }, { status: 'unverified' }],
        },
        orderBy: { priority: 'desc' },
      })

      if (accounts.length === 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: { result: 'submit_failed', errorMessage: '没有可用的 HDU 账号' },
        })
        return res.json({ success: false, message: '没有可用的 HDU 账号' })
      }

      // 过滤冷却期/冻结账号
      const nowMs = Date.now()
      const available = accounts.filter(a => {
        if (a.consecutiveFailures >= a.maxConsecutiveFailures) return false
        if (a.lastLoginFailureAt) {
          const elapsed = nowMs - new Date(a.lastLoginFailureAt).getTime()
          if (elapsed < a.loginFailureCooldownMinutes * 60 * 1000) return false
        }
        if (a.lastSubmitAt) {
          const elapsed = nowMs - new Date(a.lastSubmitAt).getTime()
          if (elapsed < a.minSubmitIntervalSeconds * 1000) return false
        }
        return true
      })

      if (available.length === 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: { result: 'submit_failed', errorMessage: '所有 HDU 账号都在冷却中，请稍后再试' },
        })
        return res.json({ success: false, message: '所有 HDU 账号都在冷却中，请稍后再试' })
      }

      const account = available[Math.floor(Math.random() * available.length)]

      logger.info('hdu_account_selected', {
        action: 'training_submit',
        metadata: { submissionId: submission.id, selectedAccount: account.username, availableAccounts: available.length },
      })

      const result = await submitToHdu(
        {
          id: account.id,
          username: account.username,
          password: account.password!,
          passwordIV: account.passwordIV!,
          cookie: account.cookie,
          lastLoginAt: account.lastLoginAt,
          lastLoginFailureAt: account.lastLoginFailureAt,
          lastSubmitAt: account.lastSubmitAt,
          consecutiveFailures: account.consecutiveFailures,
          cookieValidMinutes: account.cookieValidMinutes,
          renewLoginThresholdMinutes: account.renewLoginThresholdMinutes,
          loginFailureCooldownMinutes: account.loginFailureCooldownMinutes,
          minSubmitIntervalSeconds: account.minSubmitIntervalSeconds,
          maxConsecutiveFailures: account.maxConsecutiveFailures,
          submitMaxRetries: account.submitMaxRetries,
        },
        problemId,
        language,
        code,
      )

      if (result.success) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: { ojAccountId: account.id, ojRemoteId: result.ojRemoteId },
        })
        logger.info('hdu_submit_success', {
          action: 'training_submit',
          metadata: { submissionId: submission.id, ojRemoteId: result.ojRemoteId },
        })
      } else {
        await prisma.submission.update({
          where: { id: submission.id },
          data: { result: 'submit_failed', errorMessage: result.message },
        })
        logger.warn('hdu_submit_failed', {
          action: 'training_submit',
          metadata: { submissionId: submission.id, message: result.message },
        })
        return res.json({ success: false, message: result.message })
      }
    }
    // 其他外部 OJ 或非机器人提交：标记为待审核
    else {
      await prisma.submission.update({
        where: { id: submission.id },
        data: { result: 'pending_review' },
      })
    }

    logger.info('training_submission_created', { action: 'trainings', metadata: { submissionId: submission.id, trainingId: id } })
    res.json({ success: true, data: { submissionId: submission.id } })
}, '提交失败'))

/**
 * GET /api/trainings/:id/submissions
 * 获取训练评测记录
 */
trainingSubmissionsRouter.get('/trainings/:id/submissions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { userId: filterUserId, problemId: filterProblemId, username: filterUsername, result: filterResult, language: filterLanguage } = req.query as Record<string, string>
    const { page: pageNum, pageSize: pageSizeNum, skip } = parsePagination(req.query, { defaultPageSize: 50, maxPageSize: 200 })

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const where: any = {
      submitScope: training.type === 'contest' ? 'contest' : 'training',
      trainingId: id,
      OR: [
        { result: 'queuing' },
        { cases: { not: null } },
      ],
    }
    if (filterUserId) where.userId = filterUserId
    if (filterProblemId) where.problemId = filterProblemId
    if (filterResult) where.result = filterResult
    if (filterLanguage) where.language = filterLanguage

    // 非管理员只能看到自己的评测记录
    const isAdminUser = await canManageTraining(userId, training)
    if (!isAdminUser) {
      if (where.userId) {
        if (where.userId !== userId) {
          return res.json({ success: true, data: { submissions: [], page: pageNum, totalPages: 0, total: 0 } })
        }
      } else {
        where.userId = userId
      }
    }

    // If username filter is provided, find matching user IDs
    let usernameFilterUserIds: string[] | null = null
    if (filterUsername && filterUsername.trim()) {
      const matchingUsers = await prisma.user.findMany({
        where: { username: { contains: filterUsername.trim() } },
        select: { id: true }
      })
      usernameFilterUserIds = matchingUsers.map(u => u.id)
      if (usernameFilterUserIds.length === 0) {
        // No matching users, return empty result
        return res.json({ success: true, data: { submissions: [], page: pageNum, totalPages: 0, total: 0 } })
      }
      // Combine with existing userId filter if present
      if (where.userId) {
        where.userId = { in: usernameFilterUserIds.filter(id => id === where.userId) }
        if (where.userId.in.length === 0) {
          return res.json({ success: true, data: { submissions: [], page: pageNum, totalPages: 0, total: 0 } })
        }
      } else {
        where.userId = { in: usernameFilterUserIds }
      }
    }

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSizeNum,
      }),
      prisma.submission.count({ where }),
    ])

    // 获取题目别名和 orderIndex（通过 problemId 关联 TrainingProblem）
    const trainingProblems = await prisma.trainingProblem.findMany({
      where: { trainingId: id },
      select: { alias: true, orderIndex: true, Problem: { select: { problemId: true } } },
    })
    const aliasMap = new Map<string, string>(
      trainingProblems.map(tp => [tp.Problem.problemId, tp.alias] as [string, string])
    )
    const orderIndexMap = new Map<string, number>(
      trainingProblems.map(tp => [tp.Problem.problemId, tp.orderIndex] as [string, number])
    )

    // Get submitter names and usernames
    const userIds = [...new Set(submissions.map(s => s.userId))]
    const [teachers, students, users] = await Promise.all([
      prisma.teacher.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      prisma.student.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }),
    ])
    const nameMap = new Map<string, string>([...teachers.map(t => [t.id, t.name] as [string, string]), ...students.map(s => [s.id, s.name] as [string, string])])
    const usernameMap = new Map<string, string>(users.map(u => [u.id, u.username] as [string, string]))

    // OI 赛制：赛中非管理员隐藏评测结果
    const now = Date.now()
    const computedStatus = training.status === 'finished' ? 'finished'
      : (training.status === 'ongoing' || now >= training.startTime.getTime() && now <= training.endTime.getTime()) ? 'ongoing'
      : 'upcoming'
    const hideOiResults = training.format === 'oi' && computedStatus !== 'finished' && !isAdminUser

    const paginated = paginatedResponse(
      submissions.map(s => ({
        id: s.id,
        userId: s.userId,
        userName: nameMap.get(s.userId) || '未知',
        username: usernameMap.get(s.userId) || '未知',
        problemAlias: aliasMap.get(s.problemId) || s.problemId,
        problemOrderIndex: orderIndexMap.get(s.problemId) ?? 0,
        trainingProblemId: s.problemId,
        oj: s.oj,
        language: s.language,
        result: hideOiResults ? 'submitted' : s.result,
        score: hideOiResults ? null : s.score,
        timeUsed: hideOiResults ? null : s.timeUsed,
        memoryUsed: hideOiResults ? null : s.memoryUsed,
        codeLength: s.codeLength,
        ojRemoteId: hideOiResults ? null : s.ojRemoteId,
        createdAt: s.createdAt.toISOString(),
      })),
      total,
      pageNum,
      pageSizeNum
    )

    res.json({
      success: true,
      data: {
        submissions: paginated.data,
        page: paginated.page,
        totalPages: paginated.totalPages,
        total: paginated.total,
      },
    })
}, '查询失败'))

/**
 * GET /api/trainings/:id/submissions/:submissionId
 * 获取提交详情（返回格式与题库提交详情一致）
 */
trainingSubmissionsRouter.get('/trainings/:id/submissions/:submissionId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), submissionId = req.params.submissionId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const isAdminUser = await canManageTraining(userId, training)

    const submission = await prisma.submission.findUnique({
      where: { id: parseInt(submissionId) },
    })

    if (!submission || submission.trainingId !== id) {
      return res.status(404).json({ success: false, message: '提交不存在' })
    }

    // 过滤未经过正规评测流程的假数据
    if (submission.result !== 'queuing' && !submission.cases) {
      return res.status(404).json({ success: false, message: '提交不存在' })
    }

    // 非管理员只能查看自己的提交详情
    if (!isAdminUser && submission.userId !== userId) {
      return res.status(403).json({ success: false, message: '无权限查看他人评测记录' })
    }

    // Only show code to the submitter or admin
    const showCode = submission.userId === userId || isAdminUser

    let cases = null
    if (submission.cases) {
      try { cases = JSON.parse(submission.cases) } catch { cases = null }
    }
    let subtasks = null
    if (submission.subtasks) {
      try { subtasks = JSON.parse(submission.subtasks) } catch { subtasks = null }
    }

    // 获取题目别名
    const trainingProblem = await prisma.trainingProblem.findFirst({
      where: { trainingId: id, Problem: { problemId: submission.problemId } },
      include: { Problem: { select: { platform: true } } },
    })
    const problemAlias = trainingProblem?.alias || submission.problemId
    const ojPlatform = trainingProblem?.Problem?.platform || submission.oj || 'carits'

    // Get submitter's username
    const submitter = await prisma.user.findUnique({
      where: { id: submission.userId },
      select: { username: true }
    })

    // OI 赛制：赛中非管理员隐藏评测详情
    const nowDetail = Date.now()
    const detailStatus = training.status === 'finished' ? 'finished'
      : (training.status === 'ongoing' || nowDetail >= training.startTime.getTime() && nowDetail <= training.endTime.getTime()) ? 'ongoing'
      : 'upcoming'
    const hideOiDetail = training.format === 'oi' && detailStatus !== 'finished' && !isAdminUser

    // 返回格式与 SubmissionDetailModal 一致
    res.json({
      success: true,
      data: {
        id: submission.id,
        username: submitter?.username || '未知',
        oj: ojPlatform,
        problemId: problemAlias,
        result: hideOiDetail ? 'submitted' : submission.result,
        timeUsed: hideOiDetail ? null : submission.timeUsed,
        memoryUsed: hideOiDetail ? null : submission.memoryUsed,
        codeLength: submission.codeLength,
        language: submission.language,
        code: showCode ? submission.code : null,
        submitMethod: submission.submitMethod || 'code',
        ojRemoteId: hideOiDetail ? null : submission.ojRemoteId,
        ojAccountUsername: null,
        submittedAt: submission.createdAt.toISOString(),
        errorMessage: null,
        score: hideOiDetail ? null : submission.score,
        cases: hideOiDetail ? null : cases,
        subtasks: hideOiDetail ? null : subtasks,
        trainingProblemId: submission.problemId,
      },
    })
}, '查询失败'))

/**
 * POST /api/trainings/:id/rejudge
 * 重新评测指定训练的所有提交（仅限 carits 本地评测）
 */
trainingSubmissionsRouter.post('/trainings/:id/rejudge', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '仅团队管理员可执行重新评测' })
    }

    // 重置该训练下所有 carits 提交为 queuing
    const { count } = await prisma.submission.updateMany({
      where: {
        submitScope: training.type === 'contest' ? 'contest' : 'training',
        trainingId: id,
        oj: 'carits',
        result: { in: ['accepted', 'wa', 'tle', 're', 'mle', 'ce', 'ole', 'Accepted', 'WrongAnswer', 'TimeLimitExceeded', 'RuntimeError', 'MemoryLimitExceeded', 'CompileError', 'OutputLimitExceeded'] },
      },
      data: {
        result: 'queuing',
        score: null,
        timeUsed: null,
        memoryUsed: null,
        cases: null,
        subtasks: null,
        errorMessage: null,
      },
    })

    logger.info('training_rejudge', {
      action: 'training_rejudge',
      metadata: { trainingId: id, resetCount: count },
    })

    res.json({ success: true, data: { resetCount: count, message: `已重置 ${count} 条提交，等待重新评测` } })
}, '重新评测失败'))
