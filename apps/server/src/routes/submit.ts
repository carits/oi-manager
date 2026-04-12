import { Router } from 'express'
import path from 'path'
import { authenticate } from '../middleware/auth'
import { prisma } from '../prisma'
import { logger } from '../lib/logger'
import { submitToHdu } from '../lib/hdu-submit'
import { dispatchJudgeTask } from '../ws/judge'

export const submitRouter = Router()

/**
 * POST /api/submit
 * 提交代码到 OJ
 *
 * 请求体:
 * - problemId: 题号
 * - oj: 平台标识 (hdu, luogu, codeforces 等)
 * - language: 语言 ID
 * - code: 源代码
 * - submitMethod: 提交方式 (robot | myAccount | archive)
 */
submitRouter.post('/', authenticate, async (req: any, res) => {
  try {
    const { problemId, oj, language, code, submitMethod } = req.body
    const userId = req.user.userId

    // 参数验证
    if (!problemId || !oj || !language || !code) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    if (submitMethod !== 'robot') {
      return res.status(400).json({
        success: false,
        message: '目前仅支持机器人账号提交',
      })
    }

    // 检查题目是否存在
    const problem = await prisma.problem.findFirst({
      where: {
        platform: oj,
        problemId,
      },
    })

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: '题目不存在',
      })
    }

    // 创建提交记录
    const submission = await prisma.submission.create({
      data: {
        userId,
        oj,
        problemId,
        problemInternalId: problem.id,
        language,
        code,
        codeLength: Buffer.byteLength(code, 'utf8'),
        result: 'queuing',
        submitMethod,
      },
    })

    logger.info('submission_created', {
      action: 'submit',
      metadata: { submissionId: submission.id, userId, oj, problemId, language },
    })

    // Carits 平台本地评测
    if (problem.platform === 'carits' && submitMethod === 'robot') {
      try {
        // 获取评测配置
        const problemWithConfig = await prisma.problem.findUnique({
          where: { id: problem.id },
          select: { judgeConfig: true }
        })

        let problemConfig = {}
        if (problemWithConfig?.judgeConfig) {
          try {
            const yaml = await import('js-yaml')
            problemConfig = yaml.load(problemWithConfig.judgeConfig) || {}
          } catch (e) {
            logger.warn('parse_judge_config_error', { error: e })
          }
        }

        // 测试数据路径（使用绝对路径）
        const testdataPath = path.join(process.cwd(), 'testdata', problem.id)

        // 分发评测任务
        await dispatchJudgeTask({
          submissionId: submission.id.toString(),
          problemId: problem.id,
          code,
          language,
          testdataPath,
          problemConfig
        })

        // Carits 平台：远程提交ID就是本地评测ID
        await prisma.submission.update({
          where: { id: submission.id },
          data: { ojRemoteId: submission.id.toString() }
        })

        logger.info('carits_judge_dispatched', {
          action: 'submit',
          metadata: { submissionId: submission.id }
        })

        return res.json({
          success: true,
          data: { submissionId: submission.id },
          message: '已提交评测队列'
        })
      } catch (e: any) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            result: 'submit_failed',
            errorMessage: e.message
          }
        })

        return res.json({
          success: false,
          message: e.message || '评测服务不可用'
        })
      }
    }

    // 机器人账号提交
    if (submitMethod === 'robot' && oj === 'hdu') {
      // 查询所有可用的 HDU 账号（包含登录控制相关字段）
      const accounts = await prisma.ojAccount.findMany({
        where: {
          platform: 'hdu',
          enabled: true,
          password: { not: null },
          passwordIV: { not: null },
          OR: [
            { status: 'active' },
            { status: 'unverified' },  // 未验证的账号也可以尝试
          ],
        },
        orderBy: {
          priority: 'desc',
        },
      })

      if (accounts.length === 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            result: 'submit_failed',
            errorMessage: '没有可用的 HDU 账号',
          },
        })
        return res.json({
          success: false,
          message: '没有可用的 HDU 账号',
        })
      }

      // 过滤掉在冷却期或冻结的账号
      const now = Date.now()
      const availableAccounts = accounts.filter(account => {
        // 检查连续失败次数
        if (account.consecutiveFailures >= account.maxConsecutiveFailures) {
          return false
        }

        // 检查登录失败冷却时间
        if (account.lastLoginFailureAt) {
          const cooldownMs = account.loginFailureCooldownMinutes * 60 * 1000
          const elapsed = now - new Date(account.lastLoginFailureAt).getTime()
          if (elapsed < cooldownMs) {
            return false
          }
        }

        // 检查提交间隔
        if (account.lastSubmitAt) {
          const intervalMs = account.minSubmitIntervalSeconds * 1000
          const elapsed = now - new Date(account.lastSubmitAt).getTime()
          if (elapsed < intervalMs) {
            return false
          }
        }

        return true
      })

      if (availableAccounts.length === 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            result: 'submit_failed',
            errorMessage: '所有 HDU 账号都在冷却中，请稍后再试',
          },
        })
        return res.json({
          success: false,
          message: '所有 HDU 账号都在冷却中，请稍后再试',
        })
      }

      // 随机选择一个可用账号（实现负载均衡）
      const account = availableAccounts[Math.floor(Math.random() * availableAccounts.length)]

      logger.info('hdu_account_selected', {
        action: 'submit',
        metadata: {
          submissionId: submission.id,
          selectedAccount: account.username,
          totalAccounts: accounts.length,
          availableAccounts: availableAccounts.length
        }
      })

      // 提交代码
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
        code
      )

      if (result.success) {
        // 更新提交记录
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            ojAccountId: account.id,
            ojRemoteId: result.ojRemoteId,
          },
        })

        logger.info('hdu_submit_success', {
          action: 'submit',
          metadata: { submissionId: submission.id, ojRemoteId: result.ojRemoteId },
        })

        return res.json({
          success: true,
          data: { submissionId: submission.id },
          message: '提交成功',
        })
      } else {
        // 提交失败
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            result: 'submit_failed',
            errorMessage: result.message,
          },
        })

        logger.warn('hdu_submit_failed', {
          action: 'submit',
          metadata: { submissionId: submission.id, message: result.message },
        })

        return res.json({
          success: false,
          message: result.message,
        })
      }
    }

    // 其他平台暂不支持
    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        result: 'submit_failed',
        errorMessage: '暂不支持该平台的机器人提交',
      },
    })

    return res.json({
      success: false,
      message: '暂不支持该平台的机器人提交',
    })
  } catch (e: any) {
    logger.error('submit_error', {
      action: 'submit',
      metadata: { error: e.message },
    })
    return res.status(500).json({
      success: false,
      message: '提交失败',
    })
  }
})