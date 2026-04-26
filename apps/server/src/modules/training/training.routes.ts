/**
 * Training Module - Routes Layer
 * 训练模块路由层
 *
 * 权限规则：
 * - 团队管理员 (owner/admin)：可创建、编辑、删除训练，管理题目/题解/附件
 * - 团队成员：可查看训练、提交代码、查看排名
 * - 排名只统计学生成员（非管理员角色）
 */

import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { logger } from '../../lib/logger'
import type { AuthRequest } from '../../middleware/auth'
import { getAdapter } from '../../oj-adapters'
import { getSupportedPlatforms } from '../../oj-adapters'
import { v4 as uuidv4 } from 'uuid'
import {
  getParticipantNames,
  getTeamMember,
  isTeamAdmin,
  isTeamMember,
  getUserTypeForTeam,
  parseTrainingId,
} from './training.helpers'

export const trainingsRouter = Router()

async function requireTrainingStarted(
  training: { status: string; startTime: Date; endTime: Date },
  userId: string,
  teamId: string,
): Promise<string | null> {
  let status = training.status
  if (status !== 'finished') {
    const now = new Date()
    if (now < training.startTime) status = 'upcoming'
    else if (now <= training.endTime) status = 'ongoing'
    else status = 'finished'
  }
  if (status !== 'upcoming') return null
  if (await isTeamAdmin(userId, teamId)) return null
  return '训练尚未开始'
}

// ========== 训练 CRUD ==========

/**
 * GET /api/teams/:teamId/trainings
 * 获取团队训练列表
 */
trainingsRouter.get('/teams/:teamId/trainings', authenticate, async (req: AuthRequest, res) => {
  try {
    const { teamId } = req.params
    const userId = req.user!.userId

    if (!await isTeamMember(userId, teamId)) {
      return res.status(403).json({ success: false, message: '无权限查看该团队训练' })
    }

    const trainings = await prisma.training.findMany({
      where: { teamId },
      include: {
        _count: { select: { TrainingProblem: true } },
        TrainingProblem: { select: { id: true } },
      },
      orderBy: { startTime: 'desc' },
    })

    // 统计每个训练的实际参与人数（提交过代码的去重用户）
    const trainingIds = trainings.map(t => t.id)
    const participantCounts = new Map<number, number>()
    if (trainingIds.length > 0) {
      const rows = await prisma.$queryRaw<Array<{ sourceId: string; count: bigint }>>`
        SELECT "sourceId", COUNT(DISTINCT "userId")::int as count
        FROM "Submission"
        WHERE "sourceId" IN (${Prisma.join(trainingIds.map(id => `training-${id}`))})
        GROUP BY "sourceId"
      `
      for (const row of rows) {
        const id = parseInt(row.sourceId.replace('training-', ''))
        participantCounts.set(id, Number(row.count))
      }
    }

    res.json({
      success: true,
      data: trainings.map(t => {
        const now = new Date()
        let computedStatus = t.status
        if (t.status !== 'finished') {
          if (now < t.startTime) computedStatus = 'upcoming'
          else if (now >= t.startTime && now <= t.endTime) computedStatus = 'ongoing'
          else computedStatus = 'finished'
        }
        return {
          id: t.id,
          title: t.title,
          description: t.description,
          format: t.format,
          startTime: t.startTime.toISOString(),
          endTime: t.endTime.toISOString(),
          status: computedStatus,
          createdBy: t.createdBy,
          problemCount: t._count.TrainingProblem,
          participantCount: participantCounts.get(t.id) || 0,
          createdAt: t.createdAt.toISOString(),
        }
      }),
    })
  } catch (e: any) {
    logger.error('trainings_list_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/**
 * POST /api/teams/:teamId/trainings
 * 创建训练
 */
trainingsRouter.post('/teams/:teamId/trainings', authenticate, async (req: AuthRequest, res) => {
  try {
    const { teamId } = req.params
    const userId = req.user!.userId
    const { title, description, format, startTime, endTime, problemIdVisible, solutionVisible, includeAdminInRanking } = req.body

    if (!await isTeamAdmin(userId, teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以创建训练' })
    }

    if (!title || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: '标题、开始时间、结束时间为必填' })
    }

    if (new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
    }

    if (new Date(startTime) <= new Date()) {
      return res.status(400).json({ success: false, message: '开始时间不能早于当前时间' })
    }

    const training = await prisma.training.create({
      data: {
        teamId,
        title,
        description: description || null,
        format: format || 'ioi',
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        status: 'upcoming',
        createdBy: userId,
        problemIdVisible: problemIdVisible ?? false,
        solutionVisible: solutionVisible ?? false,
        includeAdminInRanking: includeAdminInRanking ?? false,
        updatedAt: new Date(),
      },
    })

    logger.info('training_created', { action: 'trainings', metadata: { trainingId: training.id, teamId } })
    res.json({ success: true, data: training })
  } catch (e: any) {
    logger.error('training_create_error', { action: 'trainings', metadata: { error: e.message, stack: e.stack } })
    res.status(500).json({ success: false, message: '创建失败: ' + e.message })
  }
})

/**
 * GET /api/trainings/:id
 * 获取训练详情
 */
trainingsRouter.get('/trainings/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({
      where: { id },
      include: {
        _count: { select: { TrainingParticipant: true, TrainingProblem: true } },
      },
    })

    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限查看该训练' })
    }

    // 计算当前状态
    const now = new Date()
    let computedStatus = training.status
    if (training.status !== 'finished') {
      if (now < training.startTime) computedStatus = 'upcoming'
      else if (now >= training.startTime && now <= training.endTime) computedStatus = 'ongoing'
      else computedStatus = 'finished'

      // 自动更新状态
      if (computedStatus !== training.status) {
        await prisma.training.update({ where: { id }, data: { status: computedStatus } })
      }
    }

    const isAdmin = await isTeamAdmin(userId, training.teamId)

    res.json({
      success: true,
      data: {
        id: training.id,
        teamId: training.teamId,
        title: training.title,
        description: training.description,
        format: training.format,
        startTime: training.startTime.toISOString(),
        endTime: training.endTime.toISOString(),
        status: computedStatus,
        createdBy: training.createdBy,
        problemIdVisible: training.problemIdVisible,
        solutionVisible: training.solutionVisible,
        includeAdminInRanking: training.includeAdminInRanking,
        problemCount: training._count.TrainingProblem,
        participantCount: training._count.TrainingParticipant,
        isAdmin,
        createdAt: training.createdAt.toISOString(),
      },
    })
  } catch (e: any) {
    logger.error('training_detail_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/**
 * PUT /api/trainings/:id
 * 更新训练信息
 */
trainingsRouter.put('/trainings/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { title, description, format, startTime, endTime, problemIdVisible, solutionVisible, includeAdminInRanking } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以编辑训练' })
    }

    const now = new Date()
    const isStarted = now >= training.startTime

    // 已开始的训练不能修改开始时间
    // 前端只在用户实际修改了开始时间时才发送 startTime 字段
    // 如果 startTime 未发送（undefined），说明用户没改，直接跳过
    if (startTime !== undefined && isStarted) {
      return res.status(400).json({ success: false, message: '训练已经开始，不能修改开始时间' })
    }

    // 未开始训练修改开始时间，新时间不能在过去
    if (!isStarted && startTime && new Date(startTime) <= now) {
      return res.status(400).json({ success: false, message: '开始时间不能早于当前时间' })
    }

    const newStartTime = startTime ? new Date(startTime) : training.startTime
    const newEndTime = endTime ? new Date(endTime) : training.endTime

    if (newEndTime <= newStartTime) {
      return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
    }

    // 结束时间不能早于当前时间
    if (newEndTime <= now) {
      return res.status(400).json({ success: false, message: '结束时间不能早于当前时间' })
    }

    const updated = await prisma.training.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(format !== undefined && { format }),
        ...(startTime !== undefined && { startTime: newStartTime }),
        ...(endTime !== undefined && { endTime: newEndTime }),
        ...(problemIdVisible !== undefined && { problemIdVisible }),
        ...(solutionVisible !== undefined && { solutionVisible }),
        ...(includeAdminInRanking !== undefined && { includeAdminInRanking }),
      },
    })

    logger.info('training_updated', { action: 'trainings', metadata: { trainingId: id } })
    res.json({ success: true, data: updated })
  } catch (e: any) {
    logger.error('training_update_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

/**
 * PUT /api/trainings/:id/end-time
 * 单独更新结束时间（ongoing 时使用）
 */
trainingsRouter.put('/trainings/:id/end-time', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { endTime } = req.body

    if (!endTime) {
      return res.status(400).json({ success: false, message: '结束时间为必填' })
    }

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以修改结束时间' })
    }

    const newEndTime = new Date(endTime)
    if (newEndTime <= new Date()) {
      return res.status(400).json({ success: false, message: '结束时间不能早于当前时间' })
    }

    if (newEndTime <= training.startTime) {
      return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
    }

    const updated = await prisma.training.update({
      where: { id },
      data: { endTime: newEndTime },
    })

    res.json({ success: true, data: updated })
  } catch (e: any) {
    logger.error('training_end_time_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

/**
 * DELETE /api/trainings/:id
 * 删除训练
 */
trainingsRouter.delete('/trainings/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    // 只有创建者、团队管理员或 owner 可删除
    const isCreator = training.createdBy === userId
    const isAdmin = await isTeamAdmin(userId, training.teamId)
    if (!isCreator && !isAdmin) {
      return res.status(403).json({ success: false, message: '只有创建者或团队管理员可以删除训练' })
    }

    await prisma.training.delete({ where: { id } })

    logger.info('training_deleted', { action: 'trainings', metadata: { trainingId: id } })
    res.json({ success: true, message: '删除成功' })
  } catch (e: any) {
    logger.error('training_delete_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '删除失败' })
  }
})

// ========== 训练题目管理 ==========

/**
 * GET /api/trainings/:id/problems
 * 获取训练题目列表
 */
trainingsRouter.get('/trainings/:id/problems', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const isAdmin = await isTeamAdmin(userId, training.teamId)

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

        // 判断题号是否可见：problemIdVisible=true 或 训练已结束
        const showProblemId = training.problemIdVisible || training.status === 'finished' || new Date() > training.endTime

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
  } catch (e: any) {
    logger.error('training_problems_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/**
 * GET /api/trainings/:id/problem-status
 * 获取题目列表（含当前用户提交状态和原题链接）
 * 所有团队成员可见来源信息（与题面tab隐藏来源策略不同）
 */
trainingsRouter.get('/trainings/:id/problem-status', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
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

    // 获取当前用户的所有提交（统一 Submission 表）
    const submissions = await prisma.submission.findMany({
      where: { submitSource: 'training', sourceId: `training-${id}`, userId },
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

    // 构建结果
    const result = problems.map(p => {
      const platform = p.Problem.platform
      const platformProblemId = p.Problem.problemId
      const best = bestByProblem.get(platformProblemId)

      // 生成原题链接
      let problemUrl: string | null = null
      try {
        if (platform === 'carits') {
          // Carits 平台：标记为内部平台，前端构造本地链接
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
        alias: p.alias,
        title: p.Problem.title,
        orderIndex: p.orderIndex,
        points: p.points,
        platform: platform || null,
        platformProblemId: platformProblemId || null,
        problemTableId: p.Problem.id,
        platformLabel: platformLabelMap.get(platform as any) || platform || '',
        problemUrl,
        bestScore: best?.score ?? null,
        bestResult: best?.result ?? null,
      }
    })

    res.json({ success: true, data: { problems: result } })
  } catch (e: any) {
    logger.error('training_problem_status_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/**
 * POST /api/trainings/:id/problems
 * 添加训练题目
 */
trainingsRouter.post('/trainings/:id/problems', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { problemId, alias, points } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    if (!problemId) {
      return res.status(400).json({ success: false, message: '题目ID为必填' })
    }

    const aliasValue = alias || null

    // 检查题目是否存在
    const problem = await prisma.problem.findUnique({ where: { id: problemId } })
    if (!problem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    // 获取当前最大 orderIndex
    const maxOrder = await prisma.trainingProblem.aggregate({
      where: { trainingId: id },
      _max: { orderIndex: true },
    })

    const trainingProblem = await prisma.trainingProblem.create({
      data: {
        id: uuidv4(),
        trainingId: id,
        problemId,
        alias: aliasValue,
        points: points || null,
        orderIndex: (maxOrder._max.orderIndex ?? -1) + 1,
      },
    })

    logger.info('training_problem_added', { action: 'trainings', metadata: { trainingId: id, problemId } })
    res.json({ success: true, data: trainingProblem })
  } catch (e: any) {
    // 唯一约束冲突
    if (e.code === 'P2002') {
      return res.status(400).json({ success: false, message: '别名或题号已存在' })
    }
    logger.error('training_problem_add_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '添加失败' })
  }
})

/**
 * PUT /api/trainings/:id/problems/reorder
 * 重排题目顺序
 */
trainingsRouter.put('/trainings/:id/problems/reorder', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { orders } = req.body as { orders: Array<{ id: string; orderIndex: number }> }

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
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
  } catch (e: any) {
    logger.error('training_problem_reorder_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '排序失败' })
  }
})

/**
 * PUT /api/trainings/:id/problems/:problemId
 * 更新训练题目
 */
trainingsRouter.put('/trainings/:id/problems/:problemId', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId
    const { alias, points } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    const updated = await prisma.trainingProblem.update({
      where: { id: problemId },
      data: {
        ...(alias !== undefined && { alias }),
        ...(points !== undefined && { points }),
      },
    })

    res.json({ success: true, data: updated })
  } catch (e: any) {
    logger.error('training_problem_update_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

/**
 * DELETE /api/trainings/:id/problems/:problemId
 * 删除训练题目
 */
trainingsRouter.delete('/trainings/:id/problems/:problemId', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    await prisma.trainingProblem.delete({ where: { id: problemId } })

    res.json({ success: true, message: '删除成功' })
  } catch (e: any) {
    logger.error('training_problem_delete_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '删除失败' })
  }
})

// ========== 获取题目详情（用于训练中展示题面） ==========

/**
 * GET /api/trainings/:id/problems/:problemId/detail
 * 获取训练题目详情（题面内容）
 */
trainingsRouter.get('/trainings/:id/problems/:problemId/detail', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
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

    const isAdmin = await isTeamAdmin(userId, training.teamId)

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
        // 管理员额外信息
        ...(isAdmin && {
          problemTitle: problem.title,
          platform: problem.platform,
          platformProblemId: problem.problemId,
        }),
      },
    })
  } catch (e: any) {
    logger.error('training_problem_detail_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

// ========== 训练思路（ProblemNote 集成） ==========

/**
 * GET /api/trainings/:id/problems/:problemId/note
 */
trainingsRouter.get('/trainings/:id/problems/:problemId/note', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const trainingProblem = await prisma.trainingProblem.findUnique({ where: { id: problemId } })
    if (!trainingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    const userType = await getUserTypeForTeam(userId)

    // 复用 ProblemNote
    const note = await prisma.problemNote.findUnique({
      where: {
        problemId_userId_userType: {
          problemId: trainingProblem.problemId,
          userId,
          userType,
        },
      },
    })

    res.json({ success: true, data: note || { content: '' } })
  } catch (e: any) {
    logger.error('training_note_get_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/**
 * PUT /api/trainings/:id/problems/:problemId/note
 */
trainingsRouter.put('/trainings/:id/problems/:problemId/note', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId
    const { content } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const trainingProblem = await prisma.trainingProblem.findUnique({ where: { id: problemId } })
    if (!trainingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    const userType = await getUserTypeForTeam(userId)

    const note = await prisma.problemNote.upsert({
      where: {
        problemId_userId_userType: {
          problemId: trainingProblem.problemId,
          userId,
          userType,
        },
      },
      create: {
        problemId: trainingProblem.problemId,
        userId,
        userType,
        content: content || '',
      },
      update: {
        content: content || '',
      },
    })

    res.json({ success: true, data: note })
  } catch (e: any) {
    logger.error('training_note_save_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '保存失败' })
  }
})

// ========== 训练提交 ==========

/**
 * POST /api/trainings/:id/submit
 * 提交代码
 */
trainingsRouter.post('/trainings/:id/submit', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { trainingProblemId, language, code, submitMethod } = req.body

    if (!trainingProblemId || !language || !code) {
      return res.status(400).json({ success: false, message: '缺少必要参数' })
    }

    const method = submitMethod || 'robot'

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
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

    const submission = await prisma.submission.create({
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
        // 来源字段
        submitSource: 'training',
        sourceId: `training-${id}`,
        isGlobalVisible: true,
      },
    })

    const problemId = trainingProblem.Problem.problemId

    // Carits 平台：本地评测
    if (platform === 'carits') {
      const { dispatchJudgeTask } = await import('../../ws/judge')
      const path = await import('path')

      const problemWithConfig = await prisma.problem.findUnique({
        where: { id: trainingProblem.Problem.id },
        select: { judgeConfig: true },
      })
      let problemConfig: any = {}
      if (problemWithConfig?.judgeConfig) {
        try {
          const yaml = await import('js-yaml')
          problemConfig = yaml.load(problemWithConfig.judgeConfig) || {}
        } catch (e) { /* ignore parse errors */ }
      }

      const testdataPath = path.join(process.cwd(), 'testdata', trainingProblem.Problem.id)

      // 分发评测任务（不阻塞，后台执行）
      dispatchJudgeTask({
        submissionId: String(submission.id),
        problemId: trainingProblem.Problem.id,
        code,
        language,
        testdataPath,
        problemConfig,
      }).catch(async (error: any) => {
        console.error('Failed to dispatch judge task:', error)
        // 更新提交状态为失败
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            result: 'submit_failed',
            errorMessage: error.message || '评测服务不可用'
          }
        })
      })

      // Carits 平台：远程提交ID就是本地评测ID
      await prisma.submission.update({
        where: { id: submission.id },
        data: { ojRemoteId: submission.id.toString() }
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
  } catch (e: any) {
    const errorDetail = e instanceof Error
      ? { name: e.name, message: e.message, meta: (e as any).meta, stack: e.stack?.slice(0, 500) }
      : { value: String(e), json: (() => { try { return JSON.parse(JSON.stringify(e)) } catch { return undefined } })() }
    logger.error('training_submit_error', { action: 'trainings', metadata: { error: errorDetail } })
    res.status(500).json({ success: false, message: `提交失败: ${e instanceof Error ? e.message : String(e)}` })
  }
})

/**
 * GET /api/trainings/:id/submissions
 * 获取训练评测记录
 */
trainingsRouter.get('/trainings/:id/submissions', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { page = '1', pageSize = '50', userId: filterUserId, problemId: filterProblemId, username: filterUsername, result: filterResult, language: filterLanguage } = req.query as Record<string, string>

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const pageNum = parseInt(page) || 1
    const pageSizeNum = Math.min(parseInt(pageSize) || 50, 200)

    const where: any = {
      submitSource: 'training',
      sourceId: `training-${id}`,
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
    const isAdminUser = await isTeamAdmin(userId, training.teamId)
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
        skip: (pageNum - 1) * pageSizeNum,
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
      prisma.teacher.findMany({ where: { userId: { in: userIds } }, select: { userId: true, name: true } }),
      prisma.student.findMany({ where: { userId: { in: userIds } }, select: { userId: true, name: true } }),
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }),
    ])
    const nameMap = new Map<string, string>([...teachers.map(t => [t.userId, t.name] as [string, string]), ...students.map(s => [s.userId, s.name] as [string, string])])
    const usernameMap = new Map<string, string>(users.map(u => [u.id, u.username] as [string, string]))

    res.json({
      success: true,
      data: {
        submissions: submissions.map(s => ({
          id: s.id,
          userId: s.userId,
          userName: nameMap.get(s.userId) || '未知',
          username: usernameMap.get(s.userId) || '未知',
          problemAlias: aliasMap.get(s.problemId) || s.problemId,
          problemOrderIndex: orderIndexMap.get(s.problemId) ?? 0,
          trainingProblemId: s.problemId,  // 使用 problemId
          oj: s.oj,
          language: s.language,
          result: s.result,
          score: s.score,
          timeUsed: s.timeUsed,
          memoryUsed: s.memoryUsed,
          codeLength: s.codeLength,
          ojRemoteId: s.ojRemoteId,
          createdAt: s.createdAt.toISOString(),
        })),
        page: pageNum,
        totalPages: Math.ceil(total / pageSizeNum),
        total,
      },
    })
  } catch (e: any) {
    logger.error('training_submissions_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/**
 * GET /api/trainings/:id/submissions/:submissionId
 * 获取提交详情（返回格式与题库提交详情一致）
 */
trainingsRouter.get('/trainings/:id/submissions/:submissionId', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id), submissionId = req.params.submissionId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const isAdminUser = await isTeamAdmin(userId, training.teamId)

    const submission = await prisma.submission.findUnique({
      where: { id: parseInt(submissionId) },
    })

    if (!submission || submission.sourceId !== `training-${id}`) {
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

    // 返回格式与 SubmissionDetailModal 一致
    res.json({
      success: true,
      data: {
        id: submission.id,
        username: submitter?.username || '未知',
        oj: ojPlatform,
        problemId: problemAlias, // 使用题号别名
        result: submission.result,
        timeUsed: submission.timeUsed,
        memoryUsed: submission.memoryUsed,
        codeLength: submission.codeLength,
        language: submission.language,
        code: showCode ? submission.code : null,
        submitMethod: submission.submitMethod || 'code',
        ojRemoteId: submission.ojRemoteId,
        ojAccountUsername: null,
        submittedAt: submission.createdAt.toISOString(),
        errorMessage: null,
        // 训练特有的额外字段
        score: submission.score,
        cases,
        subtasks,
        trainingProblemId: submission.problemId,
      },
    })
  } catch (e: any) {
    logger.error('training_submission_detail_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

// ========== 训练排名 ==========

/**
 * GET /api/trainings/:id/ranking
 * 获取排名数据
 */
trainingsRouter.get('/trainings/:id/ranking', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({
      where: { id },
      include: {
        TrainingProblem: { orderBy: { orderIndex: 'asc' }, select: { id: true, problemId: true, alias: true, points: true, orderIndex: true, Problem: { select: { problemId: true } } } },
      },
    })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    // Get admin user IDs to exclude from ranking (unless includeAdminInRanking is true)
    // TeamMember.userId stores Teacher.id/Student.id, but Submission.userId stores User.id
    // So we need to convert via Teacher/Student lookup
    let adminUserIds: string[] = []
    if (!training.includeAdminInRanking) {
      const adminMembers = await prisma.teamMember.findMany({
        where: {
          teamId: training.teamId,
          status: 'active',
          role: { in: ['owner', 'admin'] },
        },
        select: { userId: true, userType: true },
      })
      for (const m of adminMembers) {
        if (m.userType === 'teacher') {
          const teacher = await prisma.teacher.findUnique({ where: { id: m.userId }, select: { userId: true } })
          if (teacher) adminUserIds.push(teacher.userId)
        } else if (m.userType === 'student') {
          const student = await prisma.student.findUnique({ where: { id: m.userId }, select: { userId: true } })
          if (student) adminUserIds.push(student.userId)
        }
      }
    }

    const problems = training.TrainingProblem
    const trainingStartTime = training.startTime

    if (training.format === 'ioi') {
      // IOI: SQL aggregation for max score per (userId, problemId)
      // Exclude admin submissions
      const adminFilter = adminUserIds.length > 0
        ? Prisma.sql`AND "userId" NOT IN (${Prisma.join(adminUserIds)})`
        : Prisma.empty

      const aggregated: Array<{
        userId: string
        problemId: string
        maxScore: number
        lastSubmitAt: Date
      }> = await prisma.$queryRaw`
        SELECT
          "userId",
          "problemId",
          MAX(score) as "maxScore",
          MAX("createdAt") as "lastSubmitAt"
        FROM "Submission"
        WHERE "submitSource" = 'training'
          AND "sourceId" = CONCAT('training-', ${id}::text)
          AND "cases" IS NOT NULL
          AND score = (
            SELECT MAX(s2.score) FROM "Submission" s2
            WHERE s2."userId" = "Submission"."userId"
              AND s2."problemId" = "Submission"."problemId"
              AND s2."submitSource" = 'training'
              AND s2."sourceId" = CONCAT('training-', ${id}::text)
              AND s2."cases" IS NOT NULL
          )
          ${adminFilter}
        GROUP BY "userId", "problemId"
      `

      // Build per-user aggregation in JS from the much smaller result set
      const userScores = new Map<string, Map<string, { maxScore: number; lastSubmitAt: Date }>>()
      for (const row of aggregated) {
        if (!userScores.has(row.userId)) userScores.set(row.userId, new Map())
        const score = Number(row.maxScore) || 0
        userScores.get(row.userId)!.set(row.problemId, { maxScore: score, lastSubmitAt: new Date(row.lastSubmitAt) })
      }

      // Get participant names (single query instead of 3)
      const participantIds = [...userScores.keys()]
      const nameMap = await getParticipantNames(participantIds)

      const ranking = Array.from(userScores.entries()).map(([uid, problemScores]) => {
        let totalScore = 0
        const problemDetails: Record<string, { score: number; alias: string }> = {}
        let lastSubmitAt = new Date(0)

        for (const p of problems) {
          // Submission.problemId 存储的是 Problem.problemId（外部 ID），而非 Problem.id（UUID）
          // 所以需要用 p.Problem.problemId 来匹配
          const externalProblemId = p.Problem.problemId
          const ps = problemScores.get(externalProblemId)
          const score = ps?.maxScore ?? 0
          totalScore += score
          problemDetails[p.id] = { score, alias: p.alias ?? '' }
          if (ps && ps.lastSubmitAt > lastSubmitAt) lastSubmitAt = ps.lastSubmitAt
        }

        return {
          userId: uid,
          name: nameMap.get(uid)?.name || '未知',
          username: nameMap.get(uid)?.username || '',
          totalScore,
          lastSubmitAt: lastSubmitAt.toISOString(),
          problems: problemDetails,
        }
      })

      ranking.sort((a, b) => b.totalScore - a.totalScore || new Date(a.lastSubmitAt).getTime() - new Date(b.lastSubmitAt).getTime())
      res.json({ success: true, data: { format: 'ioi', problems: problems.map(p => ({ id: p.id, alias: p.alias, points: p.points, orderIndex: p.orderIndex })), ranking } })
    } else {
      // ICPC: Need per-submission data for penalty calculation (can't fully aggregate in SQL)
      // But we still filter admins at DB level and merge name queries
      const adminFilterWhere = adminUserIds.length > 0
        ? { NOT: { userId: { in: adminUserIds } } }
        : {}

      const submissions = await prisma.submission.findMany({
        where: {
          submitSource: 'training',
          sourceId: `training-${id}`,
          ...adminFilterWhere,
          OR: [
            { result: 'queuing' },
            { cases: { not: null } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, problemId: true, score: true, result: true, createdAt: true },
      })

      const userStats = new Map<string, Map<string, { solved: boolean; penalty: number; attempts: number }>>()

      for (const sub of submissions) {
        if (!userStats.has(sub.userId)) userStats.set(sub.userId, new Map())
        const problemStats = userStats.get(sub.userId)!
        if (!problemStats.has(sub.problemId)) {
          problemStats.set(sub.problemId, { solved: false, penalty: 0, attempts: 0 })
        }
        const stat = problemStats.get(sub.problemId)!

        if (stat.solved) continue

        stat.attempts++
        // Submission.problemId stores Problem.problemId (external ID like '1005'), not Problem.id (UUID)
        if (sub.result === 'accepted' || (sub.score ?? 0) >= (problems.find(p => p.Problem.problemId === sub.problemId)?.points ?? 100)) {
          stat.solved = true
          const timeDiff = (sub.createdAt.getTime() - trainingStartTime.getTime()) / 60000
          stat.penalty = timeDiff + (stat.attempts - 1) * 20
        }
      }

      const participantIds = [...userStats.keys()]
      const nameMap = await getParticipantNames(participantIds)

      const ranking = Array.from(userStats.entries()).map(([uid, problemStats]) => {
        let solvedCount = 0
        let totalPenalty = 0
        const problemDetails: Record<string, { solved: boolean; penalty: number; attempts: number; alias: string }> = {}

        for (const p of problems) {
          // Submission.problemId = Problem.problemId (external ID), TrainingProblem.problemId = Problem.id (UUID)
          // Must use p.Problem.problemId to match submission keys
          const ps = problemStats.get(p.Problem.problemId)
          const solved = ps?.solved ?? false
          const penalty = ps?.penalty ?? 0
          const attempts = ps?.attempts ?? 0
          if (solved) {
            solvedCount++
            totalPenalty += penalty
          }
          problemDetails[p.id] = { solved, penalty, attempts, alias: p.alias ?? '' }
        }

        return {
          userId: uid,
          name: nameMap.get(uid)?.name || '未知',
          username: nameMap.get(uid)?.username || '',
          solvedCount,
          totalPenalty: Math.round(totalPenalty),
          problems: problemDetails,
        }
      })

      ranking.sort((a, b) => b.solvedCount - a.solvedCount || a.totalPenalty - b.totalPenalty)
      res.json({ success: true, data: { format: 'icpc', problems: problems.map(p => ({ id: p.id, alias: p.alias, points: p.points, orderIndex: p.orderIndex })), ranking } })
    }
  } catch (e: any) {
    logger.error('training_ranking_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

// ========== 训练题解 ==========

/**
 * GET /api/trainings/:id/problems/:problemId/solution
 * 获取训练题目的题解（只读，同步原题目题解，所有人可见）
 */
trainingsRouter.get('/trainings/:id/problems/:problemId/solution', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    // 检查题解可见性：solutionVisible=true 或 训练已结束
    const showSolution = training.solutionVisible || training.status === 'finished' || new Date() > training.endTime
    if (!showSolution) {
      // 非管理员且题解不可见，返回提示信息
      const isAdmin = await isTeamAdmin(userId, training.teamId)
      if (!isAdmin) {
        return res.json({ success: true, data: null, message: '题解将在比赛结束后显示' })
      }
    }

    // 查询训练题目关联的原题目
    const trainingProblem = await prisma.trainingProblem.findUnique({
      where: { id: problemId },
      include: { Problem: true }
    })

    if (!trainingProblem) {
      return res.json({ success: true, data: null })
    }

    const problem = trainingProblem.Problem

    // 1. 检查 Problem 表的 solutionMarkdown (旧版本存储方式)
    if (problem.solutionType !== 'none' && problem.solutionMarkdown) {
      return res.json({
        success: true,
        data: {
          content: problem.solutionMarkdown,
          solutionType: problem.solutionType,
          solutionPdfUrl: problem.solutionPdfUrl,
          source: 'problem'
        }
      })
    }

    // 2. 检查 ProblemStatement 表中 type='solution' 的记录（新版本存储方式）
    const solutionStatement = await prisma.problemStatement.findFirst({
      where: {
        problemId: problem.id,
        type: 'solution',
        isVisible: true
      },
      orderBy: { createdAt: 'asc' }
    })

    if (solutionStatement && solutionStatement.content) {
      return res.json({
        success: true,
        data: {
          content: solutionStatement.content,
          format: solutionStatement.format,
          language: solutionStatement.language,
          fileUrl: solutionStatement.fileUrl,
          source: 'problem'
        }
      })
    }

    // 没有找到题解
    res.json({ success: true, data: null })
  } catch (e: any) {
    logger.error('training_solution_get_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

// ========== 训练附件 ==========

/**
 * GET /api/trainings/:id/problems/:problemId/attachments
 * 获取训练题目附件（只读，同步原题目附件，所有人可见）
 */
trainingsRouter.get('/trainings/:id/problems/:problemId/attachments', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    // 获取训练题目关联的原始题目 ID
    const trainingProblem = await prisma.trainingProblem.findUnique({
      where: { id: problemId },
      select: { problemId: true },
    })

    // 只获取原始题目附件（训练模块不存储独立附件）
    let problemAttachments: any[] = []
    if (trainingProblem?.problemId) {
      problemAttachments = await prisma.problemAttachment.findMany({
        where: { problemId: trainingProblem.problemId },
        orderBy: { uploadedAt: 'desc' },
      })
    }

    const allAttachments = problemAttachments.map(a => ({
      id: a.id,
      fileName: a.fileName,
      fileUrl: a.fileUrl,
      fileSize: a.fileSize,
      uploadedAt: a.uploadedAt.toISOString(),
    }))

    res.json({ success: true, data: allAttachments })
  } catch (e: any) {
    logger.error('training_attachments_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

// ========== 题目解析 ==========

/**
 * POST /api/trainings/resolve-problems
 * 批量解析 OJ+题号 → 查找 Problem 记录（用于训练创建时的题目检索）
 */
trainingsRouter.post('/resolve-problems', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未登录' })
    }

    const { items } = req.body as {
      items: Array<{ ojName: string; problemCode: string }>
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: '参数错误' })
    }

    const resolved: Array<{
      problemId: string
      title: string
      ojName: string
      problemCode: string
      found: boolean
      created: boolean
    }> = []

    for (const item of items) {
      let matched: { id: string; title: string } | null = null

      if (item.ojName === 'carits') {
        // Carits 平台：按 ID 或 problemId 查本地题库
        let p = await prisma.problem.findUnique({ where: { id: item.problemCode } }).catch(() => null)
        if (!p) {
          p = await prisma.problem.findUnique({ where: { platform_problemId: { platform: 'carits', problemId: item.problemCode } } })
        }
        if (p && (p.visibility === 'public' || p.ownerId === req.user.userId)) matched = { id: p.id, title: p.title }
      } else {
        // 外部 OJ：按 platform + problemId 直接查
        const p = await prisma.problem.findUnique({
          where: { platform_problemId: { platform: item.ojName, problemId: item.problemCode } }
        })
        if (p && (p.visibility === 'public' || p.ownerId === req.user.userId)) {
          matched = { id: p.id, title: p.title }
        }
      }

      if (matched) {
        resolved.push({
          problemId: matched.id,
          title: matched.title,
          ojName: item.ojName,
          problemCode: item.problemCode,
          found: true,
          created: false,
        })
      } else {
        resolved.push({
          problemId: '',
          title: '题库中未找到',
          ojName: item.ojName,
          problemCode: item.problemCode,
          found: false,
          created: false,
        })
      }
    }

    res.json({ success: true, data: { resolved } })
  } catch (e: any) {
    logger.error('training_resolve_problems_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '解析失败' })
  }
})
