/**
 * 评测记录 API
 */

import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../prisma'
import { logger } from '../lib/logger'

export const submissionsRouter = Router()

/**
 * GET /api/submissions
 * 获取评测记录列表
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

    const pageNum = parseInt(page) || 1
    const pageSizeNum = Math.min(parseInt(pageSize) || 20, 100)
    const skip = (pageNum - 1) * pageSizeNum

    // 构建查询条件
    const where: any = {}

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
          select: { username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSizeNum,
    })

    // 格式化响应
    const formattedSubmissions = submissions.map(s => ({
      id: s.id,
      username: s.User.username,
      oj: s.oj,
      problemId: s.problemId,
      problemInternalId: s.problemInternalId,
      result: s.result,
      timeUsed: s.timeUsed,
      memoryUsed: s.memoryUsed,
      codeLength: s.codeLength,
      language: s.language,
      submittedAt: s.createdAt.toISOString(),
    }))

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
 */
submissionsRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params

    const submission = await prisma.submission.findUnique({
      where: { id: parseInt(id) },
      include: {
        User: {
          select: { username: true },
        },
        OjAccount: {
          select: { username: true },
        },
      },
    })

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: '提交记录不存在',
      })
    }

    res.json({
      success: true,
      data: {
        id: submission.id,
        username: submission.User.username,
        oj: submission.oj,
        problemId: submission.problemId,
        result: submission.result,
        timeUsed: submission.timeUsed,
        memoryUsed: submission.memoryUsed,
        codeLength: submission.codeLength,
        language: submission.language,
        code: submission.code,
        submitMethod: submission.submitMethod,
        ojRemoteId: submission.ojRemoteId,
        ojAccountUsername: submission.OjAccount?.username,
        submittedAt: submission.createdAt.toISOString(),
        errorMessage: submission.errorMessage,
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