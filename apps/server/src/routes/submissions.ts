/**
 * 评测记录 API
 */

import { Router } from 'express'
import { authenticate, getResourceScope, isAdmin, isPersonalContext } from '../middleware/auth'
import { prisma } from '../prisma'
import { logger } from '../lib/logger'
import { fetchAndStoreCfCode } from '../lib/cf-code-fetcher'
import { canManageTraining } from '../modules/training/training.helpers'
import { resolveJudgePresentationConfig } from '../lib/judge-mode'

export const submissionsRouter = Router()

/**
 * GET /api/submissions
 * 获取评测记录列表
 * 管理员可看所有记录，教师/学生只能看本学校的记录
 * @query username - 用户名筛选
 * @query oj - OJ 平台筛选
 * @query problemId - 题号筛选
 * @query result - 评测结果筛选
 * @query language - 编程语言筛选
 * @query page - 页码（默认 1）
 * @query pageSize - 每页条数（默认 20）
 */
submissionsRouter.get('/', authenticate, async (req, res) => {
  try {
    const {
      username,
      oj,
      problemId,
      result,
      language,
      page = '1',
      pageSize = '20',
    } = req.query as Record<string, string>

    const user = (req as any).user
    const workspaceScope = getResourceScope(user)
    const pageNum = parseInt(page) || 1
    const pageSizeNum = Math.min(parseInt(pageSize) || 20, 100)
    const skip = (pageNum - 1) * pageSizeNum

    // 构建查询条件
    // 全局评测记录显示 isGlobalVisible 的提交
    // 包括题库提交、训练提交、已结束的比赛提交等
    // 训练/比赛模块与全局评测记录是独立功能，不产生强制关联
    const where: any = {
      isGlobalVisible: true,
      workspaceScope,
    }

    // 按角色过滤：学生只能看自己的，教师看全校，管理员看所有
    if (isPersonalContext(user) || user.role === 'student') {
      // 学生只能看到自己的提交
      where.userId = user.userId
    } else if (user.role === 'teacher' || user.role === 'school_principal') {
      if (!user.organizationId) return res.json({ success: true, data: { submissions: [], page: pageNum, totalPages: 0, total: 0 } })
      const members = await prisma.organizationMembership.findMany({ where: { organizationId: user.organizationId, status: 'active' }, select: { userId: true } })
      where.userId = { in: members.map(member => member.userId) }
    } else if (user.role === 'super_admin' || user.role === 'platform_admin') {
      const schoolProblemIds = (await prisma.problem.findMany({
        where: { libraryScope: 'school' },
        select: { id: true },
      })).map(problem => problem.id)
      if (schoolProblemIds.length > 0) {
        where.OR = [
          { problemInternalId: null },
          { problemInternalId: { notIn: schoolProblemIds } },
        ]
      }
    }

    if (username) {
      where.User = { username: { contains: username } }
    }

    if (oj) {
      where.oj = oj
    }

    if (problemId) {
      where.problemId = { contains: problemId }
    }

    if (result) {
      where.result = result
    }

    if (language) {
      where.language = language
    }

    // 查询总数
    const total = await prisma.submission.count({ where })

    // 查询列表
    const submissions = await prisma.submission.findMany({
      where,
      include: {
        User: {
          select: { username: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSizeNum,
    })

    // 批量获取关联题目的可见性信息
    // 对于有 problemInternalId 的提交，直接查询题目可见性
    const internalIds = submissions
      .map(s => s.problemInternalId)
      .filter((id): id is string => !!id)
    const problemVisibilityMap = new Map<string, string>()
    if (internalIds.length > 0) {
      const problems = await prisma.problem.findMany({
        where: { id: { in: internalIds } },
        select: { id: true, visibility: true, ownerId: true, ownerType: true },
      })
      for (const p of problems) {
        problemVisibilityMap.set(p.id, p.visibility)
      }
    }

    // 对于没有 problemInternalId 的提交（如 CF 归档），查询题库是否存在对应题目
    // 根据 oj + problemId 匹配题库中的题目
    const submissionsWithoutInternalId = submissions.filter(s => !s.problemInternalId)
    const problemLookupMap = new Map<string, string>() // key: `${oj}:${problemId}`, value: internalId
    if (submissionsWithoutInternalId.length > 0) {
      // 收集所有需要查找的 (oj, problemId) 组合
      const lookupKeys = submissionsWithoutInternalId.map(s => ({ oj: s.oj, problemId: s.problemId }))
      // 按 oj 分组查找
      const ojGroups = new Map<string, string[]>()
      for (const key of lookupKeys) {
        if (!ojGroups.has(key.oj)) ojGroups.set(key.oj, [])
        ojGroups.get(key.oj)!.push(key.problemId)
      }
      // 批量查询每个 oj 的题目
      for (const [oj, problemIds] of ojGroups) {
        const problems = await prisma.problem.findMany({
          where: {
            libraryScope: 'platform',
            platform: oj,
            problemId: { in: problemIds },
          },
          select: { id: true, problemId: true, visibility: true },
        })
        for (const p of problems) {
          problemLookupMap.set(`${oj}:${p.problemId}`, p.id)
          problemVisibilityMap.set(p.id, p.visibility)
        }
      }
    }

    // 格式化响应
    const formattedSubmissions = submissions.map(s => {
      // 如果没有 problemInternalId，尝试从题库查找
      let problemInternalId = s.problemInternalId
      if (!problemInternalId) {
        const lookupKey = `${s.oj}:${s.problemId}`
        problemInternalId = problemLookupMap.get(lookupKey) || null
      }
      return {
        id: s.id,
        userId: s.userId,
        userType: isPersonalContext(user) ? 'user' : (s.User.role === 'student' ? 'student' : (s.User.role === 'teacher' || s.User.role === 'school_principal' ? 'teacher' : 'user')),
        username: s.User.username,
        oj: s.oj,
        problemId: s.problemId,
        problemInternalId,
        problemVisibility: problemInternalId ? (problemVisibilityMap.get(problemInternalId) || null) : null,
        result: s.result,
        score: s.score,
        timeUsed: s.timeUsed,
        memoryUsed: s.memoryUsed,
        codeLength: s.codeLength,
        language: s.language,
        ojRemoteId: s.ojRemoteId,
        submittedAt: s.createdAt.toISOString(),
        // 来源字段
        submitScope: s.submitScope,
      }
    })

    res.json({
      success: true,
      data: {
        submissions: formattedSubmissions,
        page: pageNum,
        totalPages: Math.ceil(total / pageSizeNum),
        total,
      },
    })
  } catch (e: any) {
    logger.error('submissions_list_error', {
      action: 'submissions',
      metadata: { error: e.message },
    })
    res.status(500).json({
      success: false,
      message: '查询失败',
    })
  }
})

/**
 * GET /api/submissions/:id
 * 获取提交详情
 * 管理员可查看所有，教师/学生只能查看本学校的提交
 */
submissionsRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user

    const submission = await prisma.submission.findUnique({
      where: { id: parseInt(id) },
      include: {
        User: {
          select: {
            username: true,
            avatar: true,
            role: true,
          },
        },
        OjAccount: {
          select: { username: true },
        },
      },
    })

    let hasContestManagerAccess = false
    if (submission?.trainingId) {
      const training = await prisma.training.findUnique({ where: { id: submission.trainingId }, select: { id: true, teamId: true, organizationId: true, createdBy: true } })
      if (training) hasContestManagerAccess = await canManageTraining(user.userId, training)
    }
    const adminUser = isAdmin(user.role)
    if (!submission || (!adminUser && !hasContestManagerAccess && submission.workspaceScope !== getResourceScope(user))) {
      return res.status(404).json({
        success: false,
        message: '提交记录不存在',
      })
    }

    // 权限检查：学生只能看自己的，教师看本校，管理员看所有
    // 训练/比赛提交出现在全局评测记录中是正常机制，不做 submitScope 限制
    if (!adminUser && !hasContestManagerAccess && isPersonalContext(user)) {
      // 个人工作区的提交详情只对提交者可见，隐藏资源是否存在。
      if (submission.userId !== user.userId) {
        return res.status(404).json({ success: false, message: '提交记录不存在' })
      }
    } else if (user.role === 'student') {
      // 校园工作区保留既有权限契约：学生只能查看自己的提交。
      if (submission.userId !== user.userId) {
        return res.status(403).json({ success: false, message: '无权查看该提交记录' })
      }
    } else if (user.role === 'teacher' || user.role === 'school_principal') {
      if (!user.organizationId) return res.status(403).json({ success: false, message: '无权查看该提交记录' })
      const submitterMembership = await prisma.organizationMembership.findFirst({ where: { organizationId: user.organizationId, userId: submission.userId, status: 'active' }, select: { id: true } })
      if (!submitterMembership) return res.status(403).json({ success: false, message: '无权查看该提交记录' })
    }
    // super_admin 和 platform_admin 不加过滤，可以查看所有

    // 获取题目标题
    let problemTitle: string | null = null
    let problemJudgeConfig: string | null = null
    let problemAlias: string | null = null
    let problemOrderIndex: number | null = null
    let trainingProblemId: string | null = submission.trainingProblemId || null
    let contestFormat: string | null = null
    if (submission.problemInternalId) {
      const problem = await prisma.problem.findUnique({
        where: { id: submission.problemInternalId },
        select: { title: true, libraryScope: true, organizationId: true, judgeConfig: true },
      })
      if (problem?.libraryScope === 'school' && (user.role === 'super_admin' || user.role === 'platform_admin')) {
        return res.status(404).json({ success: false, message: '提交记录不存在' })
      }
      if (problem?.libraryScope === 'school' && (user.role === 'teacher' || user.role === 'school_principal') && problem.organizationId !== user.organizationId) {
        return res.status(404).json({ success: false, message: '提交记录不存在' })
      }
      problemTitle = problem?.title || null
      problemJudgeConfig = problem?.judgeConfig || null
    }
    if (submission.trainingId) {
      const training = await prisma.training.findUnique({ where: { id: submission.trainingId }, select: { format: true } })
      contestFormat = training?.format || null
      const trainingProblem = submission.trainingProblemId
        ? await prisma.trainingProblem.findFirst({
            where: { id: submission.trainingProblemId, trainingId: submission.trainingId },
            select: { id: true, alias: true, orderIndex: true, judgeConfigSnapshot: true, Problem: { select: { judgeConfig: true, title: true } } },
          })
        : await prisma.trainingProblem.findFirst({
            where: { trainingId: submission.trainingId, Problem: { problemId: submission.problemId } },
            select: { id: true, alias: true, orderIndex: true, judgeConfigSnapshot: true, Problem: { select: { judgeConfig: true, title: true } } },
          })
      if (trainingProblem) {
        trainingProblemId = trainingProblem.id
        problemAlias = trainingProblem.alias
        problemOrderIndex = trainingProblem.orderIndex
        problemJudgeConfig = trainingProblem.judgeConfigSnapshot || trainingProblem.Problem.judgeConfig || problemJudgeConfig
        problemTitle = problemTitle || trainingProblem.Problem.title || null
      }
    }
    const judgePresentation = resolveJudgePresentationConfig(problemJudgeConfig)

    // 解析提交者显示名和头像
    const submitter = submission.User
    const submitterName = submitter.username

    // 解析 cases JSON
    let cases = null
    if (submission.cases) {
      try {
        cases = JSON.parse(submission.cases)
      } catch {
        cases = null
      }
    }

    // 解析 subtasks JSON
    let subtasks = null
    if (submission.subtasks) {
      try {
        subtasks = JSON.parse(submission.subtasks)
      } catch {
        subtasks = null
      }
    }

    res.json({
      success: true,
      data: {
        id: submission.id,
        username: submitter.username,
        submitterName,
        submitterAvatar: submitter.avatar,
        oj: submission.oj,
        problemId: submission.problemId,
        problemTitle,
        result: submission.result,
        timeUsed: submission.timeUsed,
        memoryUsed: submission.memoryUsed,
        wallTimeUsed: submission.wallTimeUsed,
        timeoutReason: submission.timeoutReason,
        metricSource: submission.metricSource,
        score: submission.score,
        cases,
        subtasks,
        codeLength: submission.codeLength,
        language: submission.language,
        code: submission.code,
        submitMethod: submission.submitMethod,
        ojRemoteId: submission.ojRemoteId,
        ojAccountUsername: submission.OjAccount?.username,
        submittedAt: submission.createdAt.toISOString(),
        errorMessage: submission.errorMessage,
        judgeMode: judgePresentation.mode,
        judgeConfig: problemJudgeConfig ? { mode: judgePresentation.mode } : undefined,
        trainingId: submission.trainingId,
        trainingProblemId,
        problemAlias,
        problemOrderIndex,
        contestFormat,
      },
    })
  } catch (e: any) {
    logger.error('submission_detail_error', {
      action: 'submissions',
      metadata: { error: e.message },
    })
    res.status(500).json({
      success: false,
      message: '查询失败',
    })
  }
})

/**
 * POST /api/submissions/:id/refetch-code
 * 强制重新抓取 CF 提交源代码（清空已有 code 后重新抓取）
 */
submissionsRouter.post('/:id/refetch-code', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const submissionId = parseInt(id)

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        oj: true,
        ojRemoteId: true,
        problemId: true,
        userId: true,
        workspaceScope: true,
      },
    })

    if (
      !submission
      || submission.workspaceScope !== getResourceScope((req as any).user)
      || (isPersonalContext((req as any).user) && submission.userId !== (req as any).user.userId)
    ) {
      return res.status(404).json({ success: false, message: '提交记录不存在' })
    }

    if (submission.oj !== 'codeforces') {
      return res.status(400).json({ success: false, message: '仅支持 Codeforces 提交的代码抓取' })
    }

    if (!submission.ojRemoteId) {
      return res.status(400).json({ success: false, message: '缺少远程提交 ID' })
    }

    // 先清空 code
    await prisma.submission.update({
      where: { id: submissionId },
      data: { code: '', codeLength: 0 },
    })

    // 执行抓取
    const fetched = await fetchAndStoreCfCode(submissionId)

    if (fetched) {
      const updated = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { code: true, codeLength: true },
      })
      res.json({
        success: true,
        data: { code: updated?.code || '', codeLength: updated?.codeLength || 0 },
      })
    } else {
      res.json({
        success: false,
        message: '抓取源代码失败，请稍后重试',
      })
    }
  } catch (e: any) {
    logger.error('submission_refetch_code_error', {
      action: 'submissions',
      metadata: { error: e.message },
    })
    res.status(500).json({ success: false, message: '抓取失败' })
  }
})
