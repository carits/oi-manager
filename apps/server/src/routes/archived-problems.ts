/**
 * User Archived Problems Routes
 * 用户归档题目 API 路由
 *
 * 归档功能：用户可以将做过的题目保存到个人题库，方便复习和管理
 */

import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../prisma'
import logger from '../lib/logger'
import { parsePagination, paginatedResponse } from '../lib/pagination'

export const archivedProblemsRouter = Router()

/**
 * GET /api/archived-problems
 * 获取当前用户的归档题目列表
 */
archivedProblemsRouter.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { platform, keyword } = req.query

    const where: any = { userId }
    if (platform) {
      where.platform = platform
    }
    if (keyword) {
      where.OR = [
        { title: { contains: keyword as string, mode: 'insensitive' } },
        { problemId: { contains: keyword as string, mode: 'insensitive' } },
      ]
    }

    const { page, pageSize } = parsePagination(req.query)
    const skip = (page - 1) * pageSize

    const [items, total] = await Promise.all([
      prisma.userArchivedProblem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.userArchivedProblem.count({ where }),
    ])

    res.json(paginatedResponse(items, page, pageSize, total))
  } catch (error) {
    logger.error('archived_problems_list_error', error as Error)
    res.status(500).json({ success: false, message: '获取归档列表失败' })
  }
})

/**
 * GET /api/archived-problems/:id
 * 获取单个归档题目详情
 */
archivedProblemsRouter.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { id } = req.params

    const item = await prisma.userArchivedProblem.findFirst({
      where: { id, userId },
    })

    if (!item) {
      return res.status(404).json({ success: false, message: '归档记录不存在' })
    }

    res.json({ success: true, data: item })
  } catch (error) {
    logger.error('archived_problem_detail_error', error as Error)
    res.status(500).json({ success: false, message: '获取归档详情失败' })
  }
})

/**
 * POST /api/archived-problems
 * 添加题目到归档
 */
archivedProblemsRouter.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { platform, problemId, title, difficulty, tags, solvedAt, sourceUrl, note } = req.body

    if (!platform || !problemId) {
      return res.status(400).json({ success: false, message: '平台和题号不能为空' })
    }

    // 检查是否已存在
    const existing = await prisma.userArchivedProblem.findUnique({
      where: {
        userId_platform_problemId: { userId, platform, problemId },
      },
    })

    if (existing) {
      // 更新已有记录
      const updated = await prisma.userArchivedProblem.update({
        where: { id: existing.id },
        data: {
          title: title || existing.title,
          difficulty: difficulty || existing.difficulty,
          tags: tags || existing.tags,
          solvedAt: solvedAt ? new Date(solvedAt) : existing.solvedAt,
          sourceUrl: sourceUrl || existing.sourceUrl,
          note: note ?? existing.note,
        },
      })
      return res.json({ success: true, data: updated, message: '归档已更新' })
    }

    // 创建新记录
    const item = await prisma.userArchivedProblem.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        platform,
        problemId,
        title,
        difficulty,
        tags: tags ? JSON.stringify(tags) : null,
        solvedAt: solvedAt ? new Date(solvedAt) : null,
        sourceUrl,
        note,
      },
    })

    logger.info('archived_problem_created', {
      action: 'archive_problem',
      userId,
      metadata: { platform, problemId },
    })

    res.status(201).json({ success: true, data: item, message: '归档成功' })
  } catch (error) {
    logger.error('archived_problem_create_error', error as Error)
    res.status(500).json({ success: false, message: '归档失败' })
  }
})

/**
 * PUT /api/archived-problems/:id
 * 更新归档题目（如添加备注）
 */
archivedProblemsRouter.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { id } = req.params
    const { title, difficulty, tags, note } = req.body

    const existing = await prisma.userArchivedProblem.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      return res.status(404).json({ success: false, message: '归档记录不存在' })
    }

    const item = await prisma.userArchivedProblem.update({
      where: { id },
      data: {
        title: title ?? existing.title,
        difficulty: difficulty ?? existing.difficulty,
        tags: tags ? JSON.stringify(tags) : existing.tags,
        note: note ?? existing.note,
      },
    })

    res.json({ success: true, data: item })
  } catch (error) {
    logger.error('archived_problem_update_error', error as Error)
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

/**
 * DELETE /api/archived-problems/:id
 * 从归档中移除题目
 */
archivedProblemsRouter.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { id } = req.params

    const existing = await prisma.userArchivedProblem.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      return res.status(404).json({ success: false, message: '归档记录不存在' })
    }

    await prisma.userArchivedProblem.delete({ where: { id } })

    logger.info('archived_problem_deleted', {
      action: 'unarchive_problem',
      userId,
      metadata: { platform: existing.platform, problemId: existing.problemId },
    })

    res.json({ success: true, message: '已从归档中移除' })
  } catch (error) {
    logger.error('archived_problem_delete_error', error as Error)
    res.status(500).json({ success: false, message: '删除失败' })
  }
})

/**
 * DELETE /api/archived-problems (批量删除)
 * 批量移除归档题目
 */
archivedProblemsRouter.delete('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { ids } = req.body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '请提供要删除的归档ID列表' })
    }

    const result = await prisma.userArchivedProblem.deleteMany({
      where: {
        id: { in: ids },
        userId, // 确保只能删除自己的归档
      },
    })

    logger.info('archived_problems_bulk_deleted', {
      action: 'bulk_unarchive',
      userId,
      metadata: { count: result.count },
    })

    res.json({ success: true, message: `已移除 ${result.count} 条归档` })
  } catch (error) {
    logger.error('archived_problems_bulk_delete_error', error as Error)
    res.status(500).json({ success: false, message: '批量删除失败' })
  }
})

/**
 * GET /api/archived-problems/stats
 * 获取归档统计信息
 */
archivedProblemsRouter.get('/stats/summary', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId

    const [total, byPlatform] = await Promise.all([
      prisma.userArchivedProblem.count({ where: { userId } }),
      prisma.userArchivedProblem.groupBy({
        by: ['platform'],
        where: { userId },
        _count: { id: true },
      }),
    ])

    res.json({
      success: true,
      data: {
        total,
        byPlatform: byPlatform.map((p: { platform: string; _count: { id: number } }) => ({
          platform: p.platform,
          count: p._count.id,
        })),
      },
    })
  } catch (error) {
    logger.error('archived_problems_stats_error', error as Error)
    res.status(500).json({ success: false, message: '获取统计失败' })
  }
})
