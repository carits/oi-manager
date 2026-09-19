/**
 * Training Submission Routes
 * 训练提交和评测记录路由
 */

import { Router } from 'express'
import { SubmissionContracts } from '@oi-manager/contracts'
import yaml from 'js-yaml'
import { authenticate, getAccountRole, getResourceScope, isAdmin, isPersonalContext } from '../../middleware/auth'
import { logger } from '../../lib/logger'
import { parsePagination, paginatedResponse } from '../../lib/pagination'
import { asyncHandler } from '../../lib/asyncHandler'
import { sendContractData } from '../../lib/api-contract'
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
import { createQueuedTrainingSubmission } from './training.submission.service'
import { getTrainingRuntimeStatus, shouldHideTrainingProblemSource } from './training.visibility'
import { createRejudgeBatch } from '../judge/application/judge-run.service'
import { normalizeSubmissionIo, SubmissionIoError } from '../judge/domain/submission-io'
import {
  getSubmissionDetail,
  SubmissionQueryError,
  type SubmissionQueryContext,
} from '../submission/application/submission-query.service'
import { findTrainingForProblemAccess } from './application/training-problem-query.service'
import {
  buildRejudgeTarget,
  countProblemTestdata,
  listRejudgeCandidates,
  listTrainingSubmissionUsers,
  loadTrainingProblemForSubmission,
  previewRejudgeTarget,
  queryTrainingSubmissions,
} from './application/training-submission-query.service'

export const trainingSubmissionsRouter = Router()

/**
 * POST /api/trainings/:id/submit
 * 提交代码
 */
trainingSubmissionsRouter.post('/trainings/:id/submit', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { trainingProblemId, language, code, submitMethod, inputFilename, outputFilename } = req.body

    if (!trainingProblemId || !language || !code) {
      return res.status(400).json({ success: false, message: '缺少必要参数' })
    }

    // Legacy robot/myAccount payloads remain accepted, but always run locally.
    const method = 'local'
    const idempotencyKey = readIdempotencyKey(req)
    const training = await findTrainingForProblemAccess(id, true)
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
    const trainingProblem = await loadTrainingProblemForSubmission(id, trainingProblemId)
    if (!trainingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    const platform = trainingProblem.Problem.platform
    const judgeConfig = trainingProblem.judgeConfigSnapshot || trainingProblem.Problem.judgeConfig
    const testdataCount = await countProblemTestdata(trainingProblem.Problem.id)
    if (!judgeConfig?.trim() || testdataCount === 0) {
      return res.status(409).json({
        success: false,
        code: 'LOCAL_JUDGE_NOT_CONFIGURED',
        message: '该题尚未配置完整的本地评测配置和测试数据，请联系比赛管理员',
      })
    }

    let submissionIo
    try {
      const config = yaml.load(judgeConfig || '{}') as any
      submissionIo = normalizeSubmissionIo({ inputFilename, outputFilename, problemType: config?.type })
    } catch (error) {
      if (error instanceof SubmissionIoError) {
        return res.status(422).json({ success: false, code: error.code, message: error.message })
      }
      throw error
    }
    const fingerprint = requestFingerprint({ trainingProblemId, language, code, submitMethod: method, ...submissionIo })

    let submissionResult
    try {
      submissionResult = await runIdempotent(
        `training-submit:${userId}:${id}`,
        idempotencyKey,
        fingerprint,
        () => createQueuedTrainingSubmission({ userId, training, trainingProblem, language, code, submitMethod: method, ...submissionIo }),
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

    logger.info('local_training_submission_queued', {
      action: 'training_submit',
      metadata: { submissionId: submission.id, trainingId: id, sourcePlatform: platform, problemId },
    })
    res.json({ success: true, data: { submissionId: submission.id }, message: '已加入本地评测队列' })
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

    const training = await findTrainingForProblemAccess(id)
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
    const queried = await queryTrainingSubmissions({
      training,
      requesterId: userId,
      isAdmin: isAdminUser,
      filters: {
        userId: filterUserId, problemId: filterProblemId, username: filterUsername,
        result: filterResult, language: filterLanguage,
      },
      pagination: { skip, pageSize: pageSizeNum },
    })
    if (queried.empty) {
      return res.json({ success: true, data: { submissions: [], page: pageNum, totalPages: 0, total: 0 } })
    }
    const { submissions, total, trainingProblems, users, memberships } = queried
    // New submissions store Problem.problemId while a small amount of legacy data
    // stores Problem.id. Resolve both to the stable TrainingProblem row.
    const trainingProblemByProblemId = new Map<string, typeof trainingProblems[number]>()
    for (const trainingProblem of trainingProblems) {
      if (trainingProblem.Problem?.problemId) trainingProblemByProblemId.set(trainingProblem.Problem.problemId, trainingProblem)
      if (trainingProblem.problemId) trainingProblemByProblemId.set(trainingProblem.problemId, trainingProblem)
    }

    const usernameMap = new Map<string, string>(users.map(u => [u.id, u.username] as [string, string]))
    const nameMap = new Map<string, string>(memberships.map((membership) => [
      membership.userId,
      (membership.memberRole === 'teacher' || membership.memberRole === 'school_principal'
        ? membership.TeacherProfile?.name
        : membership.StudentProfile?.name) || usernameMap.get(membership.userId) || '未知'
    ] as [string, string]))

    // OI 赛制：赛中非管理员隐藏评测结果
    const now = Date.now()
    const computedStatus = getTrainingRuntimeStatus(training)
    const hideOiResults = training.format === 'oi' && computedStatus !== 'finished' && !isAdminUser
    const hideProblemIdentity = shouldHideTrainingProblemSource(training, isAdminUser)
    // Contest/training remote IDs are operational identifiers. Only managers may see them.
    const hideRemoteSubmissionId = !isAdminUser

    const paginated = paginatedResponse(
      submissions.map(s => {
        const trainingProblem = trainingProblemByProblemId.get(s.problemId)
        return ({
        id: s.id,
        userId: s.userId,
        userName: nameMap.get(s.userId) || '未知',
        username: usernameMap.get(s.userId) || '未知',
        problemSourceHidden: hideProblemIdentity,
        problemAlias: trainingProblem?.alias || s.problemId,
        problemOrderIndex: trainingProblem?.orderIndex ?? 0,
        trainingProblemId: s.trainingProblemId || trainingProblem?.id || null,
        ...(hideProblemIdentity ? {} : { oj: s.oj }),
        language: s.language,
        result: hideOiResults ? 'submitted' : s.result,
        score: hideOiResults ? null : s.score,
        timeUsed: hideOiResults ? null : s.timeUsed,
        memoryUsed: hideOiResults ? null : s.memoryUsed,
        codeLength: s.codeLength,
        ojRemoteId: hideRemoteSubmissionId ? null : s.ojRemoteId,
        createdAt: s.createdAt.toISOString(),
      })}),
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
    const id = parseTrainingId(req.params.id)
    const submissionId = Number(req.params.submissionId)
    const user = req.user!
    const context: SubmissionQueryContext = {
      userId: user.userId,
      organizationRole: user.organizationRole || null,
      workspaceScope: getResourceScope(user),
      organizationId: user.organizationId || null,
      isGlobalAdmin: isAdmin(getAccountRole(user)!),
      isPersonal: isPersonalContext(user),
    }

    try {
      const detail = await getSubmissionDetail(context, submissionId, id)
      return sendContractData(res, SubmissionContracts.detail, detail)
    } catch (error) {
      if (error instanceof SubmissionQueryError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
        })
      }
      throw error
    }
}, '查询失败'))

/**
 * GET /api/trainings/:id/submission-users
 */
trainingSubmissionsRouter.get('/trainings/:id/submission-users', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const training = await findTrainingForProblemAccess(id)
    if (!training || !await canManageTraining(req.user!.userId, training)) return res.status(403).json({ success: false, message: '无权限' })
    const users = await listTrainingSubmissionUsers(id)
    res.json({ success: true, data: { users: users.map(user => ({ ...user, displayName: user.username })) } })
}, '查询用户失败'))

/**
 * GET /api/trainings/:id/rejudge/preview
 */
trainingSubmissionsRouter.get('/trainings/:id/rejudge/preview', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const training = await findTrainingForProblemAccess(id)
    if (!training || !await canManageTraining(req.user!.userId, training)) return res.status(403).json({ success: false, message: '无权限' })
    const scopeType = String(req.query.scopeType || 'all')
    const where = await buildRejudgeTarget({
      training,
      scopeType,
      trainingProblemId: String(req.query.trainingProblemId || ''),
      userId: String(req.query.userId || ''),
    })
    if (!where) return res.status(404).json({ success: false, message: '题目不属于当前比赛' })
    const { matchedCount, inProgressCount } = await previewRejudgeTarget(where)
    res.json({ success: true, data: { matchedCount, inProgressCount } })
}, '预览失败'))

/**
 * POST /api/trainings/:id/rejudge
 * 重新评测指定训练的所有本地评测提交。
 */
trainingSubmissionsRouter.post('/trainings/:id/rejudge', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await findTrainingForProblemAccess(id)
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '仅比赛管理员可执行重新评测' })
    }

    const scope = req.body?.scope || { type: 'all' }
    const scopeType = scope.type
    if (!['all', 'problem', 'user_problem'].includes(scopeType)) return res.status(400).json({ success: false, message: '无效的重测范围' })
    if ((scopeType === 'problem' || scopeType === 'user_problem') && !scope.trainingProblemId) return res.status(400).json({ success: false, message: '请选择题目' })
    if (scopeType === 'user_problem' && !scope.userId) return res.status(400).json({ success: false, message: '请选择用户' })
    const baseWhere = await buildRejudgeTarget({
      training,
      scopeType,
      trainingProblemId: scope.trainingProblemId,
      userId: scope.userId,
    })
    if (!baseWhere) return res.status(404).json({ success: false, message: '题目不属于当前比赛' })
    // Snapshot the target IDs before mutating them. Running the count and update
    // in Promise.all lets the count observe rows just changed to queuing by this
    // same request, producing impossible summaries such as reset=3, skipped=3.
    const candidates = await listRejudgeCandidates(baseWhere)
    const batchResult = await createRejudgeBatch({
      submissionIds: candidates.map(item => item.id),
      requestedBy: userId,
      trainingId: id,
      scopeType,
      scopePayload: scope,
    })
    const count = batchResult.queuedCount
    const skippedCount = batchResult.skippedCount

    logger.info('training_rejudge', {
      action: 'training_rejudge',
      metadata: { trainingId: id, batchId: batchResult.batch.id, scope: scopeType, resetCount: count, skippedCount },
    })

    res.json({ success: true, data: { batchId: batchResult.batch.id, scope: scopeType, resetCount: count, skippedCount, message: '已重置 ' + count + ' 条提交，' + skippedCount + ' 条正在评测中的提交已跳过' } })
}, '重新评测失败'))
