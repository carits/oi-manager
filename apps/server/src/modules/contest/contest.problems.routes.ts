/**
 * Contest Problem Routes
 * 训练题目管理路由
 */

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { getAdapter, getSupportedPlatforms } from '../../oj-adapters'
import {
  canAccessContest,
  canManageContest,
  getUserTypeForContest,
  parseContestId,
  requireContestStarted,
} from './contest.helpers'
import { getContestRuntimeStatus, shouldHideContestProblemSource } from './contest.visibility'
import { buildContestProblemStatus } from './contest.problem-status'
import {
  addManagedContestProblem,
  deleteManagedContestProblem,
  reorderManagedContestProblems,
  ContestProblemManagementError,
  updateManagedContestProblem,
} from './application/contest-problem-management.service'
import {
  findContestForProblemAccess,
  getContestProblemDetailData,
  getContestProblemStatusData,
  listContestProblems,
} from './application/contest-problem-query.service'
import yaml from 'js-yaml'
import { legacySubmissionIoSuggestion } from '../judge/domain/submission-io'

function sendManagementError(error: unknown, res: any) {
  if (!(error instanceof ContestProblemManagementError)) throw error
  return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
}

const managedProblemFilePattern = /\/api\/files\/([^/?#]+)\/(?:download|public)/g

function contextualizeProblemContent(contestId: number, contestProblemId: string, content: string | null) {
  if (!content) return content
  managedProblemFilePattern.lastIndex = 0
  return content.replace(managedProblemFilePattern, (_url, fileId: string) =>
    `/api/contests/${contestId}/problems/${contestProblemId}/files/${fileId}`)
}

function contextualizeProblemFile(contestId: number, contestProblemId: string, fileUrl: string | null) {
  if (!fileUrl) return fileUrl
  managedProblemFilePattern.lastIndex = 0
  const match = managedProblemFilePattern.exec(fileUrl)
  return match?.[1]
    ? `/api/contests/${contestId}/problems/${contestProblemId}/files/${match[1]}`
    : fileUrl
}

export const contestProblemsRouter = Router()

/**
 * GET /api/contests/:id/problems
 * 获取训练题目列表
 */
contestProblemsRouter.get('/contests/:id/problems', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
    const userId = req.user!.userId

    const contest = await findContestForProblemAccess(id, true)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireContestStarted(contest, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const isAdmin = await canManageContest(userId, contest)

    const problems = await listContestProblems(id)

    const hideProblemIdentity = shouldHideContestProblemSource(contest, isAdmin)
    res.json({
      success: true,
      data: problems.map(p => {
        // 附件数量 = 原始题目附件 + 训练特定附件
        const attachmentCount = (p.Problem?._count?.ProblemAttachment ?? 0) + p._count.ContestAttachment
        const base: any = {
          id: p.id,
          points: p.points,
          hasSolution: !!p.ContestSolution,
          solutionVisible: p.ContestSolution?.visible ?? false,
          attachmentCount,
          problemSourceHidden: hideProblemIdentity,

        }

        return {
          ...base,
          orderIndex: p.orderIndex,
          difficulty: p.Problem.difficulty,
          timeLimit: p.Problem.timeLimit,
          memoryLimit: p.Problem.memoryLimit,
          ...(hideProblemIdentity ? {} : {
            alias: p.alias,
            problemId: p.Problem.id,
            problemTitle: p.Problem.title,
            platform: p.Problem.platform,
            platformProblemId: p.Problem.problemId,
          }),
        }
      }),
    })
}, '查询失败'))

/**
 * GET /api/contests/:id/problem-status
 * 获取题目列表（含当前用户提交状态和原题链接）
 * 所有团队成员可见来源信息（与题面tab隐藏来源策略不同）
 */
contestProblemsRouter.get('/contests/:id/problem-status', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
    const userId = req.user!.userId

    const contest = await findContestForProblemAccess(id)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireContestStarted(contest, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const submitScopeValue = contest.type === 'contest' ? 'contest' : 'contest'
    const { problems, submissions } = await getContestProblemStatusData(id, userId, submitScopeValue)

    // Group submissions by source problem ID so each format can expose one stable display status.
    const submissionsByProblem = new Map<string, typeof submissions>()
    for (const submission of submissions) {
      const list = submissionsByProblem.get(submission.problemId) || []
      list.push(submission)
      submissionsByProblem.set(submission.problemId, list)
    }

    // 平台名称映射（含 Carits 内部平台）
    const platformLabelMap = new Map<string, string>([
      ...getSupportedPlatforms().map(p => [p.platform, p.name] as [string, string]),
      ['carits', 'Carits'],
    ])

    // OI 赛制可见性检查
    const isAdminUser = await canManageContest(userId, contest)
    const computedStatus = getContestRuntimeStatus(contest)
    const hideOiStatus = contest.format === 'oi' && computedStatus !== 'finished' && !isAdminUser

    const hideProblemIdentity = shouldHideContestProblemSource(contest, isAdminUser)

    // 构建结果
    const result = problems.map(p => {
      const platform = p.Problem.platform
      const platformProblemId = p.Problem.problemId
      const status = buildContestProblemStatus(contest.format, submissionsByProblem.get(platformProblemId) || [])

      // 生成原题链接
      let problemUrl: string | null = null
      try {
        if (platform === 'carits') {
          problemUrl = '__carits__'
        } else if (platform) {
          const adapter = getAdapter(platform as any)
          problemUrl = adapter.getProblemUrl(platformProblemId)
        }
      } catch {
        // 平台不支持生成链接，忽略
      }

      return {
        id: p.id,
        points: p.points,
        problemSourceHidden: hideProblemIdentity,
        orderIndex: p.orderIndex,
        ...(hideProblemIdentity ? {} : {
          alias: p.alias,
          title: p.Problem.title,
          problemTitle: p.Problem.title,
        }),
        ...(hideProblemIdentity ? {} : {
          platform: platform || null,
          platformProblemId: platformProblemId || null,
          problemTableId: p.Problem.id,
          platformLabel: platformLabelMap.get(platform as any) || platform || '',
          problemUrl,
        }),
        hasSubmitted: status.hasSubmitted,
        bestScore: hideOiStatus ? null : status.bestScore,
        bestResult: hideOiStatus ? null : status.bestResult,
        latestResult: hideOiStatus ? null : status.latestResult,
        hasAccepted: status.hasAccepted,
        displayStatus: hideOiStatus ? (status.hasSubmitted ? 'submitted' : null) : status.displayStatus,
      }
    })

    res.json({ success: true, data: { problems: result } })
}, '查询失败'))

/**
 * POST /api/contests/:id/problems
 * 添加训练题目
 */
contestProblemsRouter.post('/contests/:id/problems', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
    const userId = req.user!.userId
    const { problemId, alias, points, statementOptionKey, solutionOptionKey } = req.body

    const contest = await findContestForProblemAccess(id, true)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    if (!problemId) {
      return res.status(400).json({ success: false, message: '题目ID为必填' })
    }

    try {
      const contestProblem = await addManagedContestProblem({
        contest,
        user: req.user!,
        problemId,
        alias,
        points,
        statementOptionKey: typeof statementOptionKey === 'string' ? statementOptionKey : undefined,
        solutionOptionKey: typeof solutionOptionKey === 'string' ? solutionOptionKey : undefined,
      })
      return res.json({ success: true, data: contestProblem })
    } catch (error) {
      return sendManagementError(error, res)
    }
}, '添加失败'))

/**
 * PUT /api/contests/:id/problems/reorder
 * 重排题目顺序
 */
contestProblemsRouter.put('/contests/:id/problems/reorder', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id)
    const userId = req.user!.userId
    const { orders } = req.body as { orders: Array<{ id: string; orderIndex: number }> }

    const contest = await findContestForProblemAccess(id)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    try { await reorderManagedContestProblems(id, orders) }
    catch (error) { return sendManagementError(error, res) }

    res.json({ success: true, message: '排序已更新' })
}, '排序失败'))

/**
 * PUT /api/contests/:id/problems/:problemId
 * 更新训练题目
 */
contestProblemsRouter.put('/contests/:id/problems/:problemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId
    const { alias, points } = req.body

    const contest = await findContestForProblemAccess(id)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    let updated
    try { updated = await updateManagedContestProblem(id, problemId, { alias, points }) }
    catch (error) { return sendManagementError(error, res) }

    res.json({ success: true, data: updated })
}, '更新失败'))

/**
 * DELETE /api/contests/:id/problems/:problemId
 * 删除训练题目
 */
contestProblemsRouter.delete('/contests/:id/problems/:problemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const contest = await findContestForProblemAccess(id)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    try { await deleteManagedContestProblem(id, problemId) }
    catch (error) { return sendManagementError(error, res) }

    res.json({ success: true, message: '删除成功' })
}, '删除失败'))

/**
 * GET /api/contests/:id/problems/:problemId/detail
 * 获取训练题目详情（题面内容）
 */
contestProblemsRouter.get('/contests/:id/problems/:problemId/detail', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseContestId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const contest = await findContestForProblemAccess(id)
    if (!contest) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessContest(userId, contest)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireContestStarted(contest, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const isAdmin = await canManageContest(userId, contest)
    const userType = await getUserTypeForContest(userId, id)
    const detail = await getContestProblemDetailData(id, problemId, userId, userType)
    if (!detail) return res.status(403).json({ success: false, message: '题目不属于该训练' })
    const { contestProblem, note } = detail
    const legacyIo = legacySubmissionIoSuggestion(yaml.load(contestProblem.judgeConfig || '{}') as any)
    const hideProblemIdentity = shouldHideContestProblemSource(contest, isAdmin)
    const problem = contestProblem.Problem
    const contestStatement = contestProblem.statementMarkdown ? [{
      id: contestProblem.id + ':contest', type: 'statement', name: 'Contest statement',
      format: 'markdown', language: 'zh-CN',
      content: contextualizeProblemContent(id, contestProblem.id, contestProblem.statementMarkdown),
      fileUrl: null, isVisible: true, isDefault: true, authorUsername: 'Contest',
    }] : []
    const statementRows = contestStatement.length ? contestStatement : problem.ProblemStatement.map((statement: any) => ({
      ...statement,
      content: contextualizeProblemContent(id, contestProblem.id, statement.content),
      fileUrl: contextualizeProblemFile(id, contestProblem.id, statement.fileUrl),
    }))
    const defaultStatement = statementRows.find((item: any) => item.isDefault) || statementRows[0]
    res.json({
      success: true,
      data: {
        problemSourceHidden: hideProblemIdentity,
        orderIndex: contestProblem.orderIndex,
        points: contestProblem.points,
        timeLimit: contestProblem.timeLimit ?? problem.timeLimit,
        memoryLimit: contestProblem.memoryLimit ?? problem.memoryLimit,
        difficulty: problem.difficulty,
        description: defaultStatement?.content ?? problem.description,
        statementType: contestProblem.statementType !== 'none' ? contestProblem.statementType : problem.statementType,
        statementPdfUrl: contestProblem.statementType === 'pdf'
          ? contextualizeProblemFile(id, contestProblem.id, contestProblem.ContestResource.find((resource: any) => resource.fileType === 'statement')?.fileUrl ?? null)
          : contextualizeProblemFile(id, contestProblem.id, problem.statementPdfUrl),
        statements: statementRows,
        noteContent: note?.content ?? '',
        contentRevision: null,
        contentSource: contestProblem.statementType !== 'none' ? 'contest' : 'canonical',
        legacyIoSuggestion: legacyIo ? { inputFilename: legacyIo.inputFilename, outputFilename: legacyIo.outputFilename } : null,
        ...(isAdmin && defaultStatement?.authorUsername ? { authorUsername: defaultStatement.authorUsername } : {}),
        ...(!hideProblemIdentity && {
          alias: contestProblem.alias,
          problemTitle: contestProblem.title || problem.title,
        }),
        // 管理员额外信息
        ...(isAdmin && {
          problemTitle: contestProblem.title || problem.title,
          platform: problem.platform,
          platformProblemId: problem.problemId,
        }),
      },
    })
}, '查询失败'))
