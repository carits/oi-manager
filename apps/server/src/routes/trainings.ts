/**
 * 训练 API
 *
 * 权限规则：
 * - 团队管理员 (owner/admin)：可创建、编辑、删除训练，管理题目/题解/附件
 * - 团队成员：可查看训练、提交代码、查看排名
 * - 排名只统计学生成员（非管理员角色）
 */

import { Router } from 'express'
import { prisma } from '../prisma'
import { authenticate } from '../middleware/auth'
import { getUserTeacherId } from '../middleware/permissions'
import { logger } from '../lib/logger'
import type { AuthRequest } from '../middleware/auth'

export const trainingsRouter = Router()

// ========== 辅助函数 ==========

/** 获取用户在团队中的成员信息 */
async function getTeamMember(userId: string, teamId: string) {
  const teacherId = await getUserTeacherId(userId)
  const student = await prisma.student.findUnique({ where: { userId } })

  const orConditions: Array<{ userId: string; userType: string }> = []
  if (teacherId) orConditions.push({ userId: teacherId, userType: 'teacher' })
  if (student) orConditions.push({ userId: student.id, userType: 'student' })

  if (orConditions.length === 0) return null

  return prisma.teamMember.findFirst({
    where: { teamId, OR: orConditions, status: 'active' }
  })
}

/** 检查是否是团队管理员 */
async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role === 'super_admin') return true

  const member = await getTeamMember(userId, teamId)
  return member?.role === 'owner' || member?.role === 'admin'
}

/** 检查是否是团队成员 */
async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role === 'super_admin' || user?.role === 'platform_admin') return true

  const member = await getTeamMember(userId, teamId)
  return !!member
}

/** 获取用户的 userType 用于训练上下文 */
async function getUserTypeForTeam(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role === 'super_admin' || user?.role === 'platform_admin') return 'teacher'
  if (user?.role === 'teacher' || user?.role === 'school_principal') return 'teacher'
  return 'student'
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
        _count: { select: { TrainingParticipants: true, TrainingProblems: true } },
        TrainingProblems: { select: { id: true } },
      },
      orderBy: { startTime: 'desc' },
    })

    res.json({
      success: true,
      data: trainings.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        format: t.format,
        startTime: t.startTime.toISOString(),
        endTime: t.endTime.toISOString(),
        status: t.status,
        createdBy: t.createdBy,
        problemCount: t._count.TrainingProblems,
        participantCount: t._count.TrainingParticipants,
        createdAt: t.createdAt.toISOString(),
      })),
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
    const { title, description, format, startTime, endTime } = req.body

    if (!await isTeamAdmin(userId, teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以创建训练' })
    }

    if (!title || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: '标题、开始时间、结束时间为必填' })
    }

    if (new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
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
      },
    })

    logger.info('training_created', { action: 'trainings', metadata: { trainingId: training.id, teamId } })
    res.json({ success: true, data: training })
  } catch (e: any) {
    logger.error('training_create_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '创建失败' })
  }
})

/**
 * GET /api/trainings/:id
 * 获取训练详情
 */
trainingsRouter.get('/trainings/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({
      where: { id },
      include: {
        _count: { select: { TrainingParticipants: true, TrainingProblems: true } },
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
        problemCount: training._count.TrainingProblems,
        participantCount: training._count.TrainingParticipants,
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
    const { id } = req.params
    const userId = req.user!.userId
    const { title, description, format, startTime, endTime } = req.body

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
    // Use direct string comparison to avoid timezone conversion issues
    // Frontend sends "YYYY-MM-DDTHH:mm" format (local time string without timezone)
    // Database stores UTC time, so we slice to the same format for comparison
    const originalStartTimeStr = training.startTime.toISOString().slice(0, 16)

    if (startTime && isStarted && startTime !== originalStartTimeStr) {
      return res.status(400).json({ success: false, message: '训练已经开始，不能修改开始时间' })
    }

    const newStartTime = startTime ? new Date(startTime) : training.startTime
    const newEndTime = endTime ? new Date(endTime) : training.endTime

    if (newEndTime <= newStartTime) {
      return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
    }

    // ongoing 状态下结束时间不能早于当前时间
    if (isStarted && newEndTime < now) {
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
    const { id } = req.params
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
    const { id } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    // 只有创建者或 owner 可删除
    const isCreator = training.createdBy === userId
    const isOwner = await (async () => {
      const member = await getTeamMember(userId, training.teamId)
      return member?.role === 'owner'
    })()
    const isSuperAdmin = (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role === 'super_admin'

    if (!isCreator && !isOwner && !isSuperAdmin) {
      return res.status(403).json({ success: false, message: '只有创建者或团队所有者可以删除训练' })
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
    const { id } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
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
          },
        },
        Solution: { select: { id: true, visible: true } },
        _count: { select: { Attachments: true } },
      },
      orderBy: { orderIndex: 'asc' },
    })

    res.json({
      success: true,
      data: problems.map(p => {
        const base: any = {
          id: p.id,
          alias: p.alias,
          orderIndex: p.orderIndex,
          points: p.points,
          hasSolution: !!p.Solution,
          solutionVisible: p.Solution?.visible ?? false,
          attachmentCount: p._count.Attachments,
        }

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

        // 普通成员只看到别名和题面（不暴露标题和来源）
        return base
      }),
    })
  } catch (e: any) {
    logger.error('training_problems_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/**
 * POST /api/trainings/:id/problems
 * 添加训练题目
 */
trainingsRouter.post('/trainings/:id/problems', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const userId = req.user!.userId
    const { problemId, alias, points } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    if (!problemId || !alias) {
      return res.status(400).json({ success: false, message: '题目ID和别名为必填' })
    }

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
        trainingId: id,
        problemId,
        alias,
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
 * PUT /api/trainings/:id/problems/:problemId
 * 更新训练题目
 */
trainingsRouter.put('/trainings/:id/problems/:problemId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, problemId } = req.params
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
    const { id, problemId } = req.params
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

/**
 * PUT /api/trainings/:id/problems/reorder
 * 重排题目顺序
 */
trainingsRouter.put('/trainings/:id/problems/reorder', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const userId = req.user!.userId
    const { orders } = req.body as { orders: Array<{ id: string; orderIndex: number }> }

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    await prisma.$transaction(
      orders.map(o =>
        prisma.trainingProblem.update({
          where: { id: o.id },
          data: { orderIndex: o.orderIndex },
        })
      )
    )

    res.json({ success: true, message: '排序已更新' })
  } catch (e: any) {
    logger.error('training_problem_reorder_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '排序失败' })
  }
})

// ========== 获取题目详情（用于训练中展示题面） ==========

/**
 * GET /api/trainings/:id/problems/:problemId/detail
 * 获取训练题目详情（题面内容）
 */
trainingsRouter.get('/trainings/:id/problems/:problemId/detail', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, problemId } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
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
    const { id, problemId } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
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
    const { id, problemId } = req.params
    const userId = req.user!.userId
    const { content } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
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
    const { id } = req.params
    const userId = req.user!.userId
    const { trainingProblemId, language, code } = req.body

    if (!trainingProblemId || !language || !code) {
      return res.status(400).json({ success: false, message: '缺少必要参数' })
    }

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

    const userType = await getUserTypeForTeam(userId)
    const member = await getTeamMember(userId, training.teamId)

    const submission = await prisma.trainingSubmission.create({
      data: {
        trainingId: id,
        trainingProblemId,
        userId,
        userType,
        language,
        code,
        codeLength: Buffer.byteLength(code, 'utf8'),
        result: 'queuing',
        submitMethod: 'code',
      },
    })

    // If Carits platform, dispatch to local judge
    if (trainingProblem.Problem.platform === 'carits') {
      try {
        const { dispatchJudgeTask } = await import('../ws/judge')
        const path = await import('path')

        // Get judge config
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

        // Use 'T-' prefix so handleResult knows to update TrainingSubmission
        dispatchJudgeTask({
          submissionId: `T-${submission.id}`,
          problemId: trainingProblem.Problem.id,
          code,
          language,
          testdataPath,
          problemConfig,
        })
      } catch (error) {
        console.error('Failed to dispatch judge task:', error)
      }
    } else {
      // External OJ - mark as pending (manual scoring needed)
      await prisma.trainingSubmission.update({
        where: { id: submission.id },
        data: { result: 'pending_review' },
      })
    }

    logger.info('training_submission_created', { action: 'trainings', metadata: { submissionId: submission.id, trainingId: id } })
    res.json({ success: true, data: { id: submission.id } })
  } catch (e: any) {
    logger.error('training_submit_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '提交失败' })
  }
})

/**
 * GET /api/trainings/:id/submissions
 * 获取训练评测记录
 */
trainingsRouter.get('/trainings/:id/submissions', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const userId = req.user!.userId
    const { page = '1', pageSize = '50', userId: filterUserId, problemId: filterProblemId, username: filterUsername, result: filterResult, language: filterLanguage } = req.query as Record<string, string>

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const pageNum = parseInt(page) || 1
    const pageSizeNum = Math.min(parseInt(pageSize) || 50, 200)

    const where: any = { trainingId: id }
    if (filterUserId) where.userId = filterUserId
    if (filterProblemId) where.trainingProblemId = filterProblemId
    if (filterResult) where.result = filterResult
    if (filterLanguage) where.language = filterLanguage

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
      prisma.trainingSubmission.findMany({
        where,
        include: {
          TrainingProblem: { select: { alias: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.trainingSubmission.count({ where }),
    ])

    // Get submitter names
    const userIds = [...new Set(submissions.map(s => s.userId))]
    const teachers = await prisma.teacher.findMany({ where: { userId: { in: userIds } }, select: { userId: true, name: true } })
    const students = await prisma.student.findMany({ where: { userId: { in: userIds } }, select: { userId: true, name: true } })
    const nameMap = new Map([...teachers.map(t => [t.userId, t.name]), ...students.map(s => [s.userId, s.name])])

    res.json({
      success: true,
      data: {
        submissions: submissions.map(s => ({
          id: s.id,
          userId: s.userId,
          userName: nameMap.get(s.userId) || '未知',
          userType: s.userType,
          problemAlias: s.TrainingProblem.alias,
          trainingProblemId: s.trainingProblemId,
          language: s.language,
          result: s.result,
          score: s.score,
          timeUsed: s.timeUsed,
          memoryUsed: s.memoryUsed,
          codeLength: s.codeLength,
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
 * 获取提交详情
 */
trainingsRouter.get('/trainings/:id/submissions/:submissionId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, submissionId } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const submission = await prisma.trainingSubmission.findUnique({
      where: { id: parseInt(submissionId) },
      include: {
        TrainingProblem: { select: { alias: true } },
      },
    })

    if (!submission || submission.trainingId !== id) {
      return res.status(404).json({ success: false, message: '提交不存在' })
    }

    // Only show code to the submitter or admin
    const isAdminUser = await isTeamAdmin(userId, training.teamId)
    const showCode = submission.userId === userId || isAdminUser

    let cases = null
    if (submission.cases) {
      try { cases = JSON.parse(submission.cases) } catch { cases = null }
    }
    let subtasks = null
    if (submission.subtasks) {
      try { subtasks = JSON.parse(submission.subtasks) } catch { subtasks = null }
    }

    res.json({
      success: true,
      data: {
        id: submission.id,
        userId: submission.userId,
        userType: submission.userType,
        problemAlias: submission.TrainingProblem.alias,
        language: submission.language,
        result: submission.result,
        score: submission.score,
        timeUsed: submission.timeUsed,
        memoryUsed: submission.memoryUsed,
        code: showCode ? submission.code : null,
        codeLength: submission.codeLength,
        cases,
        subtasks,
        createdAt: submission.createdAt.toISOString(),
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
    const { id } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({
      where: { id },
      include: {
        TrainingProblems: { orderBy: { orderIndex: 'asc' }, select: { id: true, alias: true, points: true } },
      },
    })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    // Get all submissions, filter to students only (not admins)
    const submissions = await prisma.trainingSubmission.findMany({
      where: { trainingId: id },
      orderBy: { createdAt: 'asc' },
    })

    // Get team members to determine admin roles
    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId: training.teamId, status: 'active' },
    })
    const adminUserIds = new Set(
      teamMembers.filter(m => m.role === 'owner' || m.role === 'admin').map(m => m.userId)
    )

    // Filter out admin submissions for ranking
    const studentSubmissions = submissions.filter(s => !adminUserIds.has(s.userId))

    // Get user names and usernames
    const participantIds = [...new Set(studentSubmissions.map(s => s.userId))]
    const users = await prisma.user.findMany({ where: { id: { in: participantIds } }, select: { id: true, username: true } })
    const teachers = await prisma.teacher.findMany({ where: { userId: { in: participantIds } }, select: { userId: true, name: true } })
    const students = await prisma.student.findMany({ where: { userId: { in: participantIds } }, select: { userId: true, name: true } })
    const nameMap = new Map([...teachers.map(t => [t.userId, t.name]), ...students.map(s => [s.userId, s.name])])
    const usernameMap = new Map(users.map(u => [u.id, u.username]))

    const problems = training.TrainingProblems

    if (training.format === 'ioi') {
      // IOI: total score = sum of max scores per problem
      const userScores = new Map<string, Map<string, { maxScore: number; lastSubmitAt: Date }>>()

      for (const sub of studentSubmissions) {
        if (!userScores.has(sub.userId)) userScores.set(sub.userId, new Map())
        const problemScores = userScores.get(sub.userId)!
        const existing = problemScores.get(sub.trainingProblemId)
        const score = sub.score ?? 0
        if (!existing || score > existing.maxScore) {
          problemScores.set(sub.trainingProblemId, { maxScore: score, lastSubmitAt: sub.createdAt })
        } else if (score === existing.maxScore) {
          existing.lastSubmitAt = sub.createdAt
        }
      }

      const ranking = Array.from(userScores.entries()).map(([uid, problemScores]) => {
        let totalScore = 0
        const problemDetails: Record<string, { score: number; alias: string }> = {}
        let lastSubmitAt = new Date(0)

        for (const p of problems) {
          const ps = problemScores.get(p.id)
          const score = ps?.maxScore ?? 0
          totalScore += score
          problemDetails[p.id] = { score, alias: p.alias }
          if (ps && ps.lastSubmitAt > lastSubmitAt) lastSubmitAt = ps.lastSubmitAt
        }

        return {
          userId: uid,
          name: nameMap.get(uid) || '未知',
          username: usernameMap.get(uid) || '',
          totalScore,
          lastSubmitAt: lastSubmitAt.toISOString(),
          problems: problemDetails,
        }
      })

      // Sort by totalScore desc, then by lastSubmitAt asc
      ranking.sort((a, b) => b.totalScore - a.totalScore || new Date(a.lastSubmitAt).getTime() - new Date(b.lastSubmitAt).getTime())

      res.json({ success: true, data: { format: 'ioi', problems: problems.map(p => ({ id: p.id, alias: p.alias, points: p.points })), ranking } })
    } else {
      // ICPC: solved count + penalty
      const userStats = new Map<string, Map<string, { solved: boolean; penalty: number; attempts: number }>>()

      for (const sub of studentSubmissions) {
        if (!userStats.has(sub.userId)) userStats.set(sub.userId, new Map())
        const problemStats = userStats.get(sub.userId)!
        if (!problemStats.has(sub.trainingProblemId)) {
          problemStats.set(sub.trainingProblemId, { solved: false, penalty: 0, attempts: 0 })
        }
        const stat = problemStats.get(sub.trainingProblemId)!

        if (stat.solved) continue // Already solved, skip

        stat.attempts++
        if (sub.result === 'accepted' || (sub.score ?? 0) >= (problems.find(p => p.id === sub.trainingProblemId)?.points ?? 100)) {
          stat.solved = true
          const timeDiff = (sub.createdAt.getTime() - training.startTime.getTime()) / 60000 // minutes
          stat.penalty = timeDiff + (stat.attempts - 1) * 20
        }
      }

      const ranking = Array.from(userStats.entries()).map(([uid, problemStats]) => {
        let solvedCount = 0
        let totalPenalty = 0
        const problemDetails: Record<string, { solved: boolean; penalty: number; attempts: number; alias: string }> = {}

        for (const p of problems) {
          const ps = problemStats.get(p.id)
          const solved = ps?.solved ?? false
          const penalty = ps?.penalty ?? 0
          const attempts = ps?.attempts ?? 0
          if (solved) {
            solvedCount++
            totalPenalty += penalty
          }
          problemDetails[p.id] = { solved, penalty, attempts, alias: p.alias }
        }

        return {
          userId: uid,
          name: nameMap.get(uid) || '未知',
          username: usernameMap.get(uid) || '',
          solvedCount,
          totalPenalty: Math.round(totalPenalty),
          problems: problemDetails,
        }
      })

      // Sort by solvedCount desc, then by totalPenalty asc
      ranking.sort((a, b) => b.solvedCount - a.solvedCount || a.totalPenalty - b.totalPenalty)

      res.json({ success: true, data: { format: 'icpc', problems: problems.map(p => ({ id: p.id, alias: p.alias, points: p.points })), ranking } })
    }
  } catch (e: any) {
    logger.error('training_ranking_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

// ========== 训练题解 ==========

/**
 * GET /api/trainings/:id/problems/:problemId/solution
 */
trainingsRouter.get('/trainings/:id/problems/:problemId/solution', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, problemId } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const solution = await prisma.trainingSolution.findUnique({ where: { trainingProblemId: problemId } })
    if (!solution) {
      return res.json({ success: true, data: null })
    }

    const isAdminUser = await isTeamAdmin(userId, training.teamId)

    // Non-admin can only see if visible
    if (!isAdminUser && !solution.visible) {
      return res.json({ success: true, data: { visible: false } })
    }

    res.json({ success: true, data: { id: solution.id, content: solution.content, visible: solution.visible } })
  } catch (e: any) {
    logger.error('training_solution_get_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/**
 * PUT /api/trainings/:id/problems/:problemId/solution
 */
trainingsRouter.put('/trainings/:id/problems/:problemId/solution', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, problemId } = req.params
    const userId = req.user!.userId
    const { content, visible } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以编辑题解' })
    }

    const solution = await prisma.trainingSolution.upsert({
      where: { trainingProblemId: problemId },
      create: {
        trainingProblemId: problemId,
        content: content || '',
        visible: visible ?? false,
        createdBy: userId,
      },
      update: {
        ...(content !== undefined && { content }),
        ...(visible !== undefined && { visible }),
      },
    })

    res.json({ success: true, data: solution })
  } catch (e: any) {
    logger.error('training_solution_save_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '保存失败' })
  }
})

// ========== 训练附件 ==========

/**
 * GET /api/trainings/:id/problems/:problemId/attachments
 */
trainingsRouter.get('/trainings/:id/problems/:problemId/attachments', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, problemId } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const attachments = await prisma.trainingAttachment.findMany({
      where: { trainingProblemId: problemId },
      orderBy: { uploadedAt: 'desc' },
    })

    res.json({
      success: true,
      data: attachments.map(a => ({
        id: a.id,
        fileName: a.fileName,
        fileUrl: a.fileUrl,
        fileSize: a.fileSize,
        uploadedBy: a.uploadedBy,
        uploadedAt: a.uploadedAt.toISOString(),
      })),
    })
  } catch (e: any) {
    logger.error('training_attachments_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/**
 * POST /api/trainings/:id/problems/:problemId/attachments
 */
trainingsRouter.post('/trainings/:id/problems/:problemId/attachments', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, problemId } = req.params
    const userId = req.user!.userId
    const { fileName, fileUrl, fileSize } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以上传附件' })
    }

    if (!fileName || !fileUrl) {
      return res.status(400).json({ success: false, message: '文件名和文件URL为必填' })
    }

    const attachment = await prisma.trainingAttachment.create({
      data: {
        trainingProblemId: problemId,
        fileName,
        fileUrl,
        fileSize: fileSize || 0,
        uploadedBy: userId,
      },
    })

    res.json({ success: true, data: attachment })
  } catch (e: any) {
    logger.error('training_attachment_upload_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '上传失败' })
  }
})

/**
 * DELETE /api/trainings/:id/attachments/:attachmentId
 */
trainingsRouter.delete('/trainings/:id/attachments/:attachmentId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, attachmentId } = req.params
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamAdmin(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以删除附件' })
    }

    await prisma.trainingAttachment.delete({ where: { id: attachmentId } })

    res.json({ success: true, message: '删除成功' })
  } catch (e: any) {
    logger.error('training_attachment_delete_error', { action: 'trainings', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: '删除失败' })
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
