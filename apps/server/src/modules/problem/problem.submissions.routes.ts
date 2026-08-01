/**
 * Problem Submissions Routes
 * 题目提交记录路由
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate, getResourceScope } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination, paginatedResponse } from '../../lib/pagination'
import logger from '../../lib/logger'

export const problemSubmissionsRouter = Router()

/**
 * GET /api/problems/:id/submissions
 * 获取题目的提交记录
 */
problemSubmissionsRouter.get('/:id/submissions', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const { page, pageSize, skip } = parsePagination(req.query, { defaultPageSize: 20, maxPageSize: 100 })

    // 查找题目
    const problem = await prisma.problem.findUnique({
      where: { id },
      select: { platform: true, problemId: true },
    })

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: '题目不存在',
      })
    }

    // 查询该题目的提交记录（只返回当前用户的，且只返回题库提交）
    const where = {
      oj: problem.platform,
      problemId: problem.problemId,
      userId: (req as any).user?.userId,
      workspaceScope: getResourceScope((req as any).user),
      submitScope: 'problem',  // 只显示题库提交，排除训练/比赛提交
    }

    // 调试日志
    logger.info('problem_submissions_query', {
      action: 'problems',
      metadata: {
        problemInternalId: id,
        platform: problem.platform,
        problemId: problem.problemId,
        currentUser: (req as any).user?.username,
        where
      }
    })

    const total = await prisma.submission.count({ where })

    const submissions = await prisma.submission.findMany({
      where,
      include: {
        User: {
          select: { username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    })

    const formattedSubmissions = submissions.map(s => ({
      id: s.id,
      username: s.User.username,
      oj: s.oj,
      problemId: s.problemId,
      result: s.result,
      timeUsed: s.timeUsed,
      memoryUsed: s.memoryUsed,
      codeLength: s.codeLength,
      language: s.language,
      submittedAt: s.createdAt.toISOString(),
    }))

    // 调试日志：返回结果
    logger.info('problem_submissions_result', {
      action: 'problems',
      metadata: {
        total,
        returnedCount: formattedSubmissions.length,
        usernames: formattedSubmissions.map(s => s.username)
      }
    })

    const pagination = paginatedResponse(formattedSubmissions, total, page, pageSize)
    res.json({
      success: true,
      data: {
        submissions: formattedSubmissions,
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: pagination.total,
        totalPages: pagination.totalPages,
      },
    })
}, '查询失败'))
