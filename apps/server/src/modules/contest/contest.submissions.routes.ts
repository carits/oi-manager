/**
 * Contest Submission Routes
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
  canAccessContest,
  canManageContest,
  parseContestId,
  requireContestStarted,
} from './contest.helpers'
import {
  IdempotencyConflictError,
  readIdempotencyKey,
  requestFingerprint,
  runIdempotent,
} from '../../lib/idempotency'
import { createQueuedContestSubmission } from './contest.submission.service'
import { getContestRuntimeStatus, shouldHideContestProblemSource } from './contest.visibility'
import { createRejudgeBatch } from '../judge/application/judge-run.service'
import { normalizeSubmissionIo, SubmissionIoError } from '../judge/domain/submission-io'
import {
  getSubmissionDetail,
  SubmissionQueryError,
  type SubmissionQueryContext,
} from '../submission/application/submission-query.service'
import { findContestForProblemAccess } from './application/contest-problem-query.service'
import {
  buildRejudgeTarget,
  countProblemTestdata,
  listRejudgeCandidates,
  listContestSubmissionUsers,
  loadContestProblemForSubmission,
  previewRejudgeTarget,
  queryContestSubmissions,
} from './application/contest-submission-query.service'

export const contestSubmissionsRouter = Router()

/**
 * POST /api/contests/:id/submit
 * 提交代码
 */
contestSubmissionsRouter.post('/contests/:id/submit', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
    const userId = req.user!.userId
    const { contestProblemId, language, code, submitMethod, inputFilename, outputFilename } = req.body

    if (!contestProblemId || !language || !code) {
      return res.status(400).json({ success: false, message: '缺少必要参数' })
    }

    // Legacy robot/myAccount payloads remain accepted, but always run locally.
    const method = 'local'
    const idempotencyKey = readIdempotencyKey(req)
    const contest = await findContestForProblemAccess(id, true)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    // Check contest is ongoing
    const now = new Date()
    if (now < contest.startTime || now > contest.endTime) {
      return res.status(400).json({ success: false, message: '训练未在进行中' })
    }

    // Verify problem belongs to this contest
    const contestProblem = await loadContestProblemForSubmission(id, contestProblemId)
    if (!contestProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    const platform = contestProblem.Problem.platform
    const judgeConfig = contestProblem.judgeConfig || contestProblem.Problem.judgeConfig
    const testdataCount = await countProblemTestdata(contestProblem.Problem.id)
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
    const fingerprint = requestFingerprint({ contestProblemId, language, code, submitMethod: method, ...submissionIo })

    let submissionResult
    try {
      submissionResult = await runIdempotent(
        `contest-submit:${userId}:${id}`,
        idempotencyKey,
        fingerprint,
        () => createQueuedContestSubmission({ userId, contest, contestProblem, language, code, submitMethod: method, ...submissionIo }),
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

    const problemId = contestProblem.Problem.problemId

    logger.info('local_contest_submission_queued', {
      action: 'contest_submit',
      metadata: { submissionId: submission.id, contestId: contest.canonicalContestId, sourcePlatform: platform, problemId },
    })
    res.json({ success: true, data: { submissionId: submission.id }, message: '已加入本地评测队列' })
}, '提交失败'))

/**
 * GET /api/contests/:id/submissions
 * 获取训练评测记录
 */
contestSubmissionsRouter.get('/contests/:id/submissions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
    const userId = req.user!.userId
    const { userId: filterUserId, problemId: filterProblemId, username: filterUsername, result: filterResult, language: filterLanguage } = req.query as Record<string, string>
    const { page: pageNum, pageSize: pageSizeNum, skip } = parsePagination(req.query, { defaultPageSize: 50, maxPageSize: 200 })

    const contest = await findContestForProblemAccess(id)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireContestStarted(contest, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const isAdminUser = await canManageContest(userId, contest)
    const queried = await queryContestSubmissions({
      contest,
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
    const { submissions, total, contestProblems, users, memberships } = queried
    // New submissions store Problem.problemId while a small amount of legacy data
    // stores Problem.id. Resolve both to the stable ContestProblem row.
    const contestProblemByProblemId = new Map<string, typeof contestProblems[number]>()
    for (const contestProblem of contestProblems) {
      if (contestProblem.Problem?.problemId) contestProblemByProblemId.set(contestProblem.Problem.problemId, contestProblem)
      if (contestProblem.problemId) contestProblemByProblemId.set(contestProblem.problemId, contestProblem)
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
    const computedStatus = getContestRuntimeStatus(contest)
    const hideOiResults = contest.format === 'oi' && computedStatus !== 'finished' && !isAdminUser
    const hideProblemIdentity = shouldHideContestProblemSource(contest, isAdminUser)
    // Contest/contest remote IDs are operational identifiers. Only managers may see them.
    const hideRemoteSubmissionId = !isAdminUser

    const paginated = paginatedResponse(
      submissions.map(s => {
        const contestProblem = contestProblemByProblemId.get(s.problemId)
        return ({
        id: s.id,
        userId: s.userId,
        userName: nameMap.get(s.userId) || '未知',
        username: usernameMap.get(s.userId) || '未知',
        problemSourceHidden: hideProblemIdentity,
        problemAlias: contestProblem?.alias || s.problemId,
        problemOrderIndex: contestProblem?.orderIndex ?? 0,
        contestProblemId: s.canonicalContestProblemId || contestProblem?.id || null,
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
 * GET /api/contests/:id/submissions/:submissionId
 * 获取提交详情（返回格式与题库提交详情一致）
 */
contestSubmissionsRouter.get('/contests/:id/submissions/:submissionId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
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
 * GET /api/contests/:id/submission-users
 */
contestSubmissionsRouter.get('/contests/:id/submission-users', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
    const contest = await findContestForProblemAccess(id)
    if (!contest || !await canManageContest(req.user!.userId, contest)) return res.status(403).json({ success: false, message: '无权限' })
    const users = await listContestSubmissionUsers(id)
    res.json({ success: true, data: { users: users.map(user => ({ ...user, displayName: user.username })) } })
}, '查询用户失败'))

/**
 * GET /api/contests/:id/rejudge/preview
 */
contestSubmissionsRouter.get('/contests/:id/rejudge/preview', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
    const contest = await findContestForProblemAccess(id)
    if (!contest || !await canManageContest(req.user!.userId, contest)) return res.status(403).json({ success: false, message: '无权限' })
    const scopeType = String(req.query.scopeType || 'all')
    const where = await buildRejudgeTarget({
      contest,
      scopeType,
      contestProblemId: String(req.query.contestProblemId || ''),
      userId: String(req.query.userId || ''),
    })
    if (!where) return res.status(404).json({ success: false, message: '题目不属于当前比赛' })
    const { matchedCount, inProgressCount } = await previewRejudgeTarget(where)
    res.json({ success: true, data: { matchedCount, inProgressCount } })
}, '预览失败'))

/**
 * POST /api/contests/:id/rejudge
 * 重新评测指定训练的所有本地评测提交。
 */
contestSubmissionsRouter.post('/contests/:id/rejudge', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
    const userId = req.user!.userId

    const contest = await findContestForProblemAccess(id)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '仅比赛管理员可执行重新评测' })
    }

    const scope = req.body?.scope || { type: 'all' }
    const scopeType = scope.type
    if (!['all', 'problem', 'user_problem'].includes(scopeType)) return res.status(400).json({ success: false, message: '无效的重测范围' })
    if ((scopeType === 'problem' || scopeType === 'user_problem') && !scope.contestProblemId) return res.status(400).json({ success: false, message: '请选择题目' })
    if (scopeType === 'user_problem' && !scope.userId) return res.status(400).json({ success: false, message: '请选择用户' })
    const baseWhere = await buildRejudgeTarget({
      contest,
      scopeType,
      contestProblemId: scope.contestProblemId,
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
      contestId: contest.canonicalContestId,
      scopeType,
      scopePayload: scope,
    })
    const count = batchResult.queuedCount
    const skippedCount = batchResult.skippedCount

    logger.info('contest_rejudge', {
      action: 'contest_rejudge',
      metadata: { contestId: contest.canonicalContestId, batchId: batchResult.batch.id, scope: scopeType, resetCount: count, skippedCount },
    })

    res.json({ success: true, data: { batchId: batchResult.batch.id, scope: scopeType, resetCount: count, skippedCount, message: '已重置 ' + count + ' 条提交，' + skippedCount + ' 条正在评测中的提交已跳过' } })
}, '重新评测失败'))
