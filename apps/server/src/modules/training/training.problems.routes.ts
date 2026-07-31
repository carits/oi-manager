/**
 * Training Problem Routes
 * 训练题目管理路由
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { getAdapter, getSupportedPlatforms } from '../../oj-adapters'
import { v4 as uuidv4 } from 'uuid'
import {
  canAccessTraining,
  canManageTraining,
  getUserTypeForTeam,
  parseTrainingId,
  populateSnapshotData,
  requireTrainingStarted,
} from './training.helpers'

export const trainingProblemsRouter = Router()

/**
 * GET /api/trainings/:id/problems
 * 获取训练题目列表
 */
trainingProblemsRouter.get('/trainings/:id/problems', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const isAdmin = await canManageTraining(userId, training)

    const problems = await prisma.trainingProblem.findMany({
      where: { trainingId: id },
      include: {
        Problem: {
          select: {
            id: true,
            title: true,
            platform: true,
            problemId: true,
            difficulty: true,
            timeLimit: true,
            memoryLimit: true,
            statementType: true,
            description: true,
            ProblemStatement: { where: { isVisible: true } },
            _count: { select: { ProblemAttachment: true } },
          },
        },
        TrainingSolution: { select: { id: true, visible: true } },
        _count: { select: { TrainingAttachment: true } },
      },
      orderBy: { orderIndex: 'asc' },
    })

    res.json({
      success: true,
      data: problems.map(p => {
        // 附件数量 = 原始题目附件 + 训练特定附件
        const attachmentCount = (p.Problem?._count?.ProblemAttachment ?? 0) + p._count.TrainingAttachment
        const base: any = {
          id: p.id,
          alias: p.alias,
          orderIndex: p.orderIndex,
          points: p.points,
          hasSolution: !!p.TrainingSolution,
          solutionVisible: p.TrainingSolution?.visible ?? false,
          attachmentCount,
        }

        // 判断题号是否可见：只由 problemIdVisible 和管理员身份控制，不自动赛后公开
        const showProblemId = isAdmin || training.problemIdVisible

        // 管理员可看到完整信息
        if (isAdmin) {
          return {
            ...base,
            problemId: p.Problem.id,
            problemTitle: p.Problem.title,
            platform: p.Problem.platform,
            platformProblemId: p.Problem.problemId,
            difficulty: p.Problem.difficulty,
            timeLimit: p.Problem.timeLimit,
            memoryLimit: p.Problem.memoryLimit,
          }
        }

        // 普通成员：根据 problemIdVisible 决定是否显示题号
        // problemTitle（题目标题）始终返回，只有 platformProblemId（来源题号）受控制
        return {
          ...base,
          platform: p.Problem.platform,
          problemTitle: p.Problem.title,
          ...(showProblemId && {
            problemId: p.Problem.id,
            platformProblemId: p.Problem.problemId,
            difficulty: p.Problem.difficulty,
            timeLimit: p.Problem.timeLimit,
            memoryLimit: p.Problem.memoryLimit,
          }),
        }
      }),
    })
}, '查询失败'))

/**
 * GET /api/trainings/:id/problem-status
 * 获取题目列表（含当前用户提交状态和原题链接）
 * 所有团队成员可见来源信息（与题面tab隐藏来源策略不同）
 */
trainingProblemsRouter.get('/trainings/:id/problem-status', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    // 获取所有训练题目
    const problems = await prisma.trainingProblem.findMany({
      where: { trainingId: id },
      include: {
        Problem: {
          select: {
            id: true,
            title: true,
            platform: true,
            problemId: true,
          },
        },
      },
      orderBy: { orderIndex: 'asc' },
    })

    // 获取当前用户的所有提交（使用 submitScope + trainingId）
    const submitScopeValue = training.type === 'contest' ? 'contest' : 'training'
    const submissions = await prisma.submission.findMany({
      where: { submitScope: submitScopeValue, trainingId: id, userId },
      orderBy: { createdAt: 'asc' },
    })

    // 按题目聚合最佳成绩（key 为 platform problemId）
    const bestByProblem = new Map<string, { score: number; result: string }>()
    for (const sub of submissions) {
      const existing = bestByProblem.get(sub.problemId)
      const score = sub.score ?? 0
      if (!existing || score > existing.score) {
        bestByProblem.set(sub.problemId, { score, result: sub.result })
      }
      // 如果分数相同但结果是 accepted，优先取 accepted
      if (existing && score === existing.score && sub.result === 'accepted' && existing.result !== 'accepted') {
        bestByProblem.set(sub.problemId, { score, result: sub.result })
      }
    }

    // 平台名称映射（含 Carits 内部平台）
    const platformLabelMap = new Map<string, string>([
      ...getSupportedPlatforms().map(p => [p.platform, p.name] as [string, string]),
      ['carits', 'Carits'],
    ])

    // OI 赛制可见性检查
    const isAdminUser = await canManageTraining(userId, training)
    const now = Date.now()
    const computedStatus = training.status === 'finished' ? 'finished'
      : (now >= training.startTime.getTime() && now <= training.endTime.getTime()) ? 'ongoing'
      : 'upcoming'
    const hideOiStatus = training.format === 'oi' && computedStatus !== 'finished' && !isAdminUser

    // OI 赛中是否显示平台信息：只由 problemIdVisible 和管理员身份控制，不自动赛后公开
    const showProblemId = isAdminUser || training.problemIdVisible

    // 构建结果
    const result = problems.map(p => {
      const platform = p.Problem.platform
      const platformProblemId = p.Problem.problemId
      const best = bestByProblem.get(platformProblemId)

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

      // 管理员或 problemIdVisible 可看到完整信息
      const shouldShowPlatformInfo = isAdminUser || showProblemId

      // 学生视角：不返回 problemTableId、platform、platformProblemId、problemUrl
      const isStudent = req.user!.role === 'student'
      const studentSafePlatformInfo = !isStudent && shouldShowPlatformInfo

      return {
        id: p.id,
        alias: p.alias,
        title: p.Problem.title,
        orderIndex: p.orderIndex,
        points: p.points,
        platform: studentSafePlatformInfo ? (platform || null) : null,
        platformProblemId: studentSafePlatformInfo ? (platformProblemId || null) : null,
        problemTableId: !isStudent && shouldShowPlatformInfo ? p.Problem.id : null,
        platformLabel: studentSafePlatformInfo ? (platformLabelMap.get(platform as any) || platform || '') : '',
        problemUrl: studentSafePlatformInfo ? problemUrl : null,
        hasSubmitted: Boolean(best),
        bestScore: hideOiStatus ? null : (best?.score ?? null),
        bestResult: hideOiStatus ? null : (best?.result ?? null),
      }
    })

    res.json({ success: true, data: { problems: result } })
}, '查询失败'))

/**
 * POST /api/trainings/:id/problems
 * 添加训练题目
 */
trainingProblemsRouter.post('/trainings/:id/problems', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { problemId, alias, points } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    if (!problemId) {
      return res.status(400).json({ success: false, message: '题目ID为必填' })
    }

    const aliasValue = alias || null

    // 检查题目是否存在
    const problem = await prisma.problem.findUnique({
      where: { id: problemId },
      include: { ProblemStatement: { where: { isVisible: true } } },
    })
    if (!problem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    // 获取当前最大 orderIndex
    const maxOrder = await prisma.trainingProblem.aggregate({
      where: { trainingId: id },
      _max: { orderIndex: true },
    })

    const snapshotData = populateSnapshotData(problem)

    let trainingProblem
    try {
      trainingProblem = await prisma.trainingProblem.create({
        data: {
          id: uuidv4(),
          trainingId: id,
          problemId,
          alias: aliasValue,
          points: points || null,
          orderIndex: (maxOrder._max.orderIndex ?? -1) + 1,
          ...snapshotData,
        },
      })
    } catch (e: any) {
      // 唯一约束冲突
      if (e.code === 'P2002') {
        return res.status(400).json({ success: false, message: '别名或题号已存在' })
      }
      throw e
    }

    res.json({ success: true, data: trainingProblem })
}, '添加失败'))

/**
 * PUT /api/trainings/:id/problems/reorder
 * 重排题目顺序
 */
trainingProblemsRouter.put('/trainings/:id/problems/reorder', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { orders } = req.body as { orders: Array<{ id: string; orderIndex: number }> }

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    // 验证所有 TrainingProblem ID 都属于该训练
    const trainingProblems = await prisma.trainingProblem.findMany({
      where: { trainingId: id },
      select: { id: true, orderIndex: true }
    })
    const validIds = trainingProblems.map(tp => tp.id)
    const requestedIds = orders.map(o => o.id)
    const invalidIds = requestedIds.filter(rid => !validIds.includes(rid))

    if (invalidIds.length > 0) {
      return res.status(400).json({ success: false, message: '部分题目ID不属于该训练' })
    }

    // 使用两阶段更新避免 @@unique([trainingId, orderIndex]) 约束冲突
    // 阶段1: 先将所有 orderIndex 设为负值（避免临时冲突）
    // 阶段2: 再设为目标值
    await prisma.$transaction([
      // 阶段1: 负值
      ...orders.map(o =>
        prisma.trainingProblem.update({
          where: { id: o.id },
          data: { orderIndex: -(o.orderIndex + 1) }, // -1, -2, -3...
        })
      ),
      // 阶段2: 目标值
      ...orders.map(o =>
        prisma.trainingProblem.update({
          where: { id: o.id },
          data: { orderIndex: o.orderIndex },
        })
      ),
    ])

    res.json({ success: true, message: '排序已更新' })
}, '排序失败'))

/**
 * PUT /api/trainings/:id/problems/:problemId
 * 更新训练题目
 */
trainingProblemsRouter.put('/trainings/:id/problems/:problemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId
    const { alias, points } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    // 验证题目属于该训练
    const existingProblem = await prisma.trainingProblem.findUnique({
      where: { id: problemId },
      select: { trainingId: true },
    })
    if (!existingProblem || existingProblem.trainingId !== id) {
      return res.status(403).json({ success: false, message: '题目不属于该训练' })
    }

    const updated = await prisma.trainingProblem.update({
      where: { id: problemId },
      data: {
        ...(alias !== undefined && { alias }),
        ...(points !== undefined && { points }),
      },
    })

    res.json({ success: true, data: updated })
}, '更新失败'))

/**
 * DELETE /api/trainings/:id/problems/:problemId
 * 删除训练题目
 */
trainingProblemsRouter.delete('/trainings/:id/problems/:problemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    // 验证题目属于该训练
    const existingProblem = await prisma.trainingProblem.findUnique({
      where: { id: problemId },
      select: { trainingId: true },
    })
    if (!existingProblem || existingProblem.trainingId !== id) {
      return res.status(403).json({ success: false, message: '题目不属于该训练' })
    }

    await prisma.trainingProblem.delete({ where: { id: problemId } })

    res.json({ success: true, message: '删除成功' })
}, '删除失败'))

/**
 * GET /api/trainings/:id/problems/:problemId/detail
 * 获取训练题目详情（题面内容）
 */
trainingProblemsRouter.get('/trainings/:id/problems/:problemId/detail', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    // 验证题目属于该训练
    const trainingProblemCheck = await prisma.trainingProblem.findUnique({
      where: { id: problemId },
      select: { trainingId: true },
    })
    if (!trainingProblemCheck || trainingProblemCheck.trainingId !== id) {
      return res.status(403).json({ success: false, message: '题目不属于该训练' })
    }

    const trainingProblem = await prisma.trainingProblem.findUnique({
      where: { id: problemId },
      include: {
        Problem: {
          select: {
            id: true,
            title: true,
            description: true,
            statementType: true,
            statementPdfUrl: true,
            difficulty: true,
            timeLimit: true,
            memoryLimit: true,
            platform: true,
            problemId: true,
            ProblemStatement: { where: { isVisible: true } },
          },
        },
      },
    })

    if (!trainingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    const isAdmin = await canManageTraining(userId, training)
    const userType = await getUserTypeForTeam(userId)
    const note = await prisma.problemNote.findUnique({
      where: {
        problemId_userId_userType: {
          problemId: trainingProblem.problemId,
          userId,
          userType,
        },
      },
      select: { content: true },
    })

    // 返回题面内容（不暴露标题和来源给非管理员）
    const problem = trainingProblem.Problem
    res.json({
      success: true,
      data: {
        alias: trainingProblem.alias,
        points: trainingProblem.points,
        timeLimit: problem.timeLimit,
        memoryLimit: problem.memoryLimit,
        difficulty: problem.difficulty,
        description: problem.description,
        statementType: problem.statementType,
        statementPdfUrl: problem.statementPdfUrl,
        statements: problem.ProblemStatement,
        noteContent: note?.content ?? '',
        // 管理员额外信息
        ...(isAdmin && {
          problemTitle: problem.title,
          platform: problem.platform,
          platformProblemId: problem.problemId,
        }),
      },
    })
}, '查询失败'))
