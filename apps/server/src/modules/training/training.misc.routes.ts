/**
 * Training Misc Routes
 * 题解、附件、题目解析路由
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  canAccessTraining,
  canManageTraining,
  parseTrainingId,
  requireTrainingStarted,
} from './training.helpers'

export const trainingMiscRouter = Router()

/**
 * GET /api/trainings/:id/problems/:problemId/solution
 * 获取训练题目的题解（只读，同步原题目题解，所有人可见）
 */
trainingMiscRouter.get('/trainings/:id/problems/:problemId/solution', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    // 检查题解可见性：solutionVisible=true 或 训练已结束
    const showSolution = training.solutionVisible || training.status === 'finished' || new Date() > training.endTime
    if (!showSolution) {
      // 非管理员且题解不可见，返回提示信息
      const isAdmin = await canManageTraining(userId, training)
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
}, '查询失败'))

/**
 * GET /api/trainings/:id/problems/:problemId/attachments
 * 获取训练题目附件（只读，同步原题目附件，所有人可见）
 */
trainingMiscRouter.get('/trainings/:id/problems/:problemId/attachments', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
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
}, '查询失败'))

/**
 * POST /api/trainings/resolve-problems
 * 批量解析 OJ+题号 → 查找 Problem 记录（用于训练创建时的题目检索）
 */
trainingMiscRouter.post('/resolve-problems', authenticate, asyncHandler(async (req, res) => {
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
}, '解析失败'))