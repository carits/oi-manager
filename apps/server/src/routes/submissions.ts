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
    const pageNum = parseInt(page) || 1
    const pageSizeNum = Math.min(parseInt(pageSize) || 20, 100)
    const skip = (pageNum - 1) * pageSizeNum

    // 构建查询条件
    const where: any = { isGlobalVisible: true }  // 只显示全局可见的提交

    // 按学校过滤：教师/学生只能看到本学校的评测记录
    if (user.role !== 'super_admin' && user.role !== 'platform_admin') {
      const schoolId = user.schoolId
      if (!schoolId) {
        // 没有学校关联的教师/学生，返回空列表
        return res.json({
          success: true,
          data: { submissions: [], page: pageNum, totalPages: 0, total: 0 },
        })
      }

      // 查找本校所有教师和学生的 userId
      const [teachers, students] = await Promise.all([
        prisma.teacher.findMany({
          where: { schoolId },
          select: { id: true },
        }),
        prisma.student.findMany({
          where: { schoolId },
          select: { id: true },
        }),
      ])
      const schoolUserIds = [
        ...teachers.map(t => t.id),
        ...students.map(s => s.id),
      ]
      where.userId = { in: schoolUserIds }
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
          select: { username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSizeNum,
    })

    // 批量获取关联题目的可见性信息
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

    // 格式化响应
    const formattedSubmissions = submissions.map(s => ({
      id: s.id,
      username: s.User.username,
      oj: s.oj,
      problemId: s.problemId,
      problemInternalId: s.problemInternalId,
      problemVisibility: s.problemInternalId ? (problemVisibilityMap.get(s.problemInternalId) || null) : null,
      result: s.result,
      score: s.score,
      timeUsed: s.timeUsed,
      memoryUsed: s.memoryUsed,
      codeLength: s.codeLength,
      language: s.language,
      ojRemoteId: s.ojRemoteId,
      submittedAt: s.createdAt.toISOString(),
      // 来源字段
      submitSource: s.submitSource,
      sourceId: s.sourceId,
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
            Teacher: { select: { name: true, schoolId: true } },
            Student: { select: { name: true, schoolId: true } },
          },
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

    // 权限检查：训练提交不能通过全局 API 访问
    if (submission.submitScope === 'training') {
      return res.status(403).json({
        success: false,
        message: '训练提交请通过训练页面查看',
      })
    }

    // 权限检查：教师/学生只能查看本学校的提交
    if (user.role !== 'super_admin' && user.role !== 'platform_admin') {
      const userSchoolId = user.schoolId
      const submitterSchoolId = submission.User.Teacher?.schoolId || submission.User.Student?.schoolId
      if (!userSchoolId || userSchoolId !== submitterSchoolId) {
        return res.status(403).json({
          success: false,
          message: '无权查看该提交记录',
        })
      }
    }

    // 获取题目标题
    let problemTitle: string | null = null
    if (submission.problemInternalId) {
      const problem = await prisma.problem.findUnique({
        where: { id: submission.problemInternalId },
        select: { title: true },
      })
      problemTitle = problem?.title || null
    }

    // 解析提交者显示名和头像
    const submitter = submission.User
    const submitterName = submitter.Teacher?.name || submitter.Student?.name || submitter.username

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