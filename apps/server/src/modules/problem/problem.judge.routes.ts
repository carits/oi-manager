/**
 * Problem Judge Config Routes
 * 评测配置路由
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { canModifyProblem } from './problem.access'
import logger from '../../lib/logger'

export const problemJudgeRouter = Router()

/**
 * GET /api/problems/:id/judge-config
 * 获取题目的评测配置
 */
problemJudgeRouter.get('/:id/judge-config', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const user = (req as any).user

    const problem = await prisma.problem.findUnique({ where: { id } })

    if (!problem || !canModifyProblem(user, problem)) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    // 解析 YAML 配置
    let config = null
    if (problem.judgeConfig) {
      try {
        const yaml = await import('js-yaml')
        config = yaml.load(problem.judgeConfig)
        logger.info('judge_config_loaded', { action: 'getJudgeConfig', metadata: { subtasksCount: (config as any)?.subtasks?.length ?? 0 } })
      } catch (e) {
        logger.warn('parse_judge_config_error', { error: e })
      }
    }

    res.json({
      success: true,
      data: {
        problemType: problem.problemType,
        timeLimit: problem.timeLimit,
        memoryLimit: problem.memoryLimit,
        config
      }
    })
}))

/**
 * PUT /api/problems/:id/judge-config
 * 保存题目的评测配置
 */
problemJudgeRouter.put('/:id/judge-config', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const user = (req as any).user
    const { problemType, timeLimit, memoryLimit, config } = req.body

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem || !canModifyProblem(user, existingProblem)) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    let judgeConfigYaml = null
    if (config) {
      const mode = config.mode || (Array.isArray(config.subtasks) && config.subtasks.length > 0 ? 'oi' : 'acm')
      if (mode !== 'acm' && mode !== 'oi') return res.status(400).json({ success: false, message: '无效的评测模式，必须是 acm 或 oi' })
      const yaml = await import('js-yaml')
      const normalized = { ...config, mode }
      judgeConfigYaml = yaml.dump(normalized, { lineWidth: -1 })
      logger.info('judge_config_saving', { action: 'saveJudgeConfig', metadata: { mode, subtasksCount: normalized.subtasks?.length ?? 0 } })
    }

    const updateData: any = {}
    if (problemType) updateData.problemType = problemType
    if (timeLimit !== undefined) updateData.timeLimit = timeLimit
    if (memoryLimit !== undefined) updateData.memoryLimit = memoryLimit
    updateData.judgeConfig = judgeConfigYaml

    const problem = await prisma.problem.update({
      where: { id },
      data: updateData
    })

    logger.audit('judge_config_updated', {
      userId: user.userId,
      action: 'update_judge_config',
      target: id,
      metadata: { problemType, timeLimit, memoryLimit }
    })

    res.json({ success: true, data: problem })
}))
