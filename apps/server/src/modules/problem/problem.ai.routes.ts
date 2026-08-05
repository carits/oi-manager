import crypto from 'crypto'
/**
 * Problem AI Routes
 * AI 翻译/格式化接口
 */

import { Router, Request, Response } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { canModifyProblem } from './problem.access'

export const problemAiRouter = Router()

problemAiRouter.use('/:id/ai', authenticate, asyncHandler(async (req, res, next) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem((req as any).user, problem)) {
    return res.status(404).json({ success: false, message: '题目不存在' })
  }
  next()
}))

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''

/**
 * POST /:id/ai/translate — 翻译题面
 */
problemAiRouter.post('/:id/ai/translate', authenticate, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const { targetLang = 'en', statementId } = req.body
    const user = (req as any).user

    if (!DEEPSEEK_API_KEY) {
      res.status(400).json({ success: false, message: '未配置 DEEPSEEK_API_KEY' })
      return
    }

    // 检查限流：每题每种目标语言全局只能翻译一次，管理员无限制
    const isAdmin = ['super_admin', 'platform_admin'].includes(user.role)
    if (!isAdmin) {
      const existingTranslation = await prisma.problemStatement.findFirst({
        where: { problemId: id, type: 'statement', format: 'markdown', language: targetLang },
      })
      if (existingTranslation) {
        res.status(400).json({ success: false, message: `已存在${targetLang === 'zh' ? '中文' : '英文'}翻译版本，不能重复翻译` })
        return
      }
    }

    // 获取题面内容（同时记录原始题面的可见性）
    let content = ''
    let sourceLang = 'zh'
    let sourceIsVisible = true

    if (statementId) {
      const statement = await prisma.problemStatement.findFirst({
        where: { id: statementId, problemId: id },
      })
      if (!statement) {
        res.status(404).json({ success: false, message: '题面记录不存在' })
        return
      }
      content = statement.content || ''
      sourceLang = statement.language || 'zh'
      sourceIsVisible = statement.isVisible
    } else {
      const problem = await prisma.problem.findUnique({ where: { id } })
      if (!problem) {
        res.status(404).json({ success: false, message: '题目不存在' })
        return
      }
      // 找到第一个 markdown 题面
      const statement = await prisma.problemStatement.findFirst({
        where: { problemId: id, type: 'statement', format: 'markdown' },
      })
      if (!statement || !statement.content) {
        res.status(400).json({ success: false, message: '没有可翻译的 Markdown 题面' })
        return
      }
      content = statement.content
      sourceLang = statement.language || 'zh'
      sourceIsVisible = statement.isVisible
    }

    if (!content || content.trim().length === 0) {
      res.status(400).json({ success: false, message: '题面内容为空' })
      return
    }

    // 调用翻译模块
    const { translateDocument } = await import('../../lib/ai-translate')
    const result = await translateDocument({
      text: content,
      sourceLang: sourceLang as any,
      targetLang: targetLang as any,
      temperature: 0.1,
    })

    // 创建新的题面记录（继承原始题面的可见性）
    const newStatement = await prisma.problemStatement.create({
      data: {
        id: crypto.randomUUID(),
        problemId: id,
        type: 'statement',
        format: 'markdown',
        language: targetLang,
        content: result.translated,
        isVisible: sourceIsVisible,
      },
    })

    // 记录使用日志
    await prisma.aiUsageLog.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.userId,
        problemId: id,
        action: 'translate',
        sourceLang,
        targetLang,
        model: result.metadata.model,
        tokensUsed: result.metadata.chunksProcessed || 0,
        status: 'success',
      },
    })

    res.json({
      success: true,
      data: {
        statementId: newStatement.id,
        content: result.translated,
        sourceLang,
        targetLang,
        diagnostics: result.diagnostics,
      },
    })
}, '翻译失败'))

/**
 * POST /:id/ai/format — 格式化题面
 */
problemAiRouter.post('/:id/ai/format', authenticate, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const { statementId } = req.body
    const user = (req as any).user

    if (!DEEPSEEK_API_KEY) {
      res.status(400).json({ success: false, message: '未配置 DEEPSEEK_API_KEY' })
      return
    }

    // 检查限流：每题每条题面全局只能格式化一次，管理员无限制
    const isAdmin = ['super_admin', 'platform_admin'].includes(user.role)
    if (!isAdmin) {
      // 格式化使用 AiUsageLog 记录，检查该题面是否已被格式化过
      const formattedLog = await prisma.aiUsageLog.findFirst({
        where: {
          problemId: id,
          action: 'format',
          status: 'success',
          statementId: statementId || undefined,
        },
      })
      if (formattedLog) {
        res.status(400).json({ success: false, message: '该题面已格式化过，不能重复格式化' })
        return
      }
    }

    // 获取题面内容
    let content = ''

    if (statementId) {
      const statement = await prisma.problemStatement.findFirst({
        where: { id: statementId, problemId: id, format: 'markdown' },
      })
      if (!statement) {
        res.status(404).json({ success: false, message: '题面记录不存在' })
        return
      }
      content = statement.content || ''
    } else {
      const statement = await prisma.problemStatement.findFirst({
        where: { problemId: id, type: 'statement', format: 'markdown' },
      })
      if (!statement || !statement.content) {
        res.status(400).json({ success: false, message: '没有可格式化的 Markdown 题面' })
        return
      }
      content = statement.content
    }

    if (!content || content.trim().length === 0) {
      res.status(400).json({ success: false, message: '题面内容为空' })
      return
    }

    // 调用格式化
    const { formatDocument } = await import('../../lib/ai-translate')
    const result = await formatDocument(content)

    // 更新题面内容
    if (statementId) {
      await prisma.problemStatement.update({
        where: { id: statementId },
        data: { content: result.translated },
      })
    } else {
      const statement = await prisma.problemStatement.findFirst({
        where: { problemId: id, type: 'statement', format: 'markdown' },
      })
      if (statement) {
        await prisma.problemStatement.update({
          where: { id: statement.id },
          data: { content: result.translated },
        })
      }
    }

    // 记录使用日志
    await prisma.aiUsageLog.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.userId,
        problemId: id,
        action: 'format',
        model: result.metadata.model,
        status: 'success',
        statementId: statementId || undefined,
      },
    })

    res.json({
      success: true,
      data: {
        content: result.translated,
        diagnostics: result.diagnostics,
      },
    })
}, '格式化失败'))

/**
 * GET /:id/ai/usage — 获取当前用户对此题目的 AI 使用情况
 */
problemAiRouter.get('/:id/ai/usage', authenticate, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const user = (req as any).user
    const isAdmin = ['super_admin', 'platform_admin'].includes(user.role)

    // 翻译：检查是否已有其他语言的 statement
    const statements = await prisma.problemStatement.findMany({
      where: { problemId: id, type: 'statement', format: 'markdown' },
      select: { language: true },
    })
    const hasZh = statements.some(s => s.language === 'zh')
    const hasEn = statements.some(s => s.language === 'en')

    // 格式化：检查全局是否有成功的格式化记录
    const formatLogs = await prisma.aiUsageLog.findMany({
      where: { problemId: id, action: 'format', status: 'success' },
      select: { statementId: true },
    })
    const formattedStatementIds = new Set(formatLogs.map(l => l.statementId).filter(Boolean) as string[])

    res.json({
      success: true,
      data: {
        isAdmin,
        translations: { zh: hasZh, en: hasEn },
        formattedStatementIds: Array.from(formattedStatementIds),
      },
    })
}))
