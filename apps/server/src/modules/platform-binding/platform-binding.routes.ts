/**
 * Platform Binding Module - Routes Layer
 * 平台绑定模块路由层
 */

import { Router, Request, Response } from 'express'
import { authenticate } from '../../middleware/auth'
import { PlatformBindingService } from './platform-binding.service'
import { prisma } from '../../prisma'
import type { BindingPlatform } from './platform-binding.types'

export const platformBindingRouter = Router()
const service = new PlatformBindingService()

/**
 * 获取支持的平台列表
 * GET /api/platform-bindings/platforms
 */
platformBindingRouter.get('/platforms', (req: Request, res: Response) => {
  const platforms = service.getSupportedPlatforms()
  res.json({ success: true, data: platforms })
})

/**
 * 获取平台的配置 Schema
 * GET /api/platform-bindings/:platform/config-schema
 */
platformBindingRouter.get('/:platform/config-schema', (req: Request, res: Response) => {
  const platform = req.params.platform as BindingPlatform
  const schema = service.getConfigSchema(platform)

  if (!schema) {
    return res.status(404).json({
      success: false,
      message: '该平台暂无配置项或平台不存在'
    })
  }

  res.json({ success: true, data: schema })
})

/**
 * 获取当前用户的所有平台绑定状态
 * GET /api/platform-bindings
 */
platformBindingRouter.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const bindings = await service.getUserBindings(userId)
    res.json({ success: true, data: bindings })
  } catch (error) {
    console.error('Get platform bindings error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 获取当前用户的指定平台绑定状态
 * GET /api/platform-bindings/:platform
 */
platformBindingRouter.get('/:platform', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const platform = req.params.platform as BindingPlatform

    const result = await service.getUserPlatformBinding(userId, platform)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Get platform binding error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 发起平台绑定
 * POST /api/platform-bindings/:platform/bind
 */
platformBindingRouter.post('/:platform/bind', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const platform = req.params.platform as BindingPlatform
    const { platformUsername, password, extra } = req.body

    // 验证平台是否支持
    const supportedPlatforms = service.getSupportedPlatforms()
    const platformConfig = supportedPlatforms.find(p => p.id === platform)
    if (!platformConfig) {
      return res.status(400).json({ success: false, message: '不支持的平台' })
    }

    // 从 extra 中获取用户名和密码（前端发送格式）
    const actualUsername = platformUsername || extra?.username
    const actualPassword = password || extra?.password

    // 洛谷和 Codeforces 平台不需要 platformUsername（从 Cookie 自动获取）
    // 其他平台需要 platformUsername
    if (platform !== 'luogu' && platform !== 'codeforces' && !actualUsername) {
      return res.status(400).json({ success: false, message: '请输入平台用户名' })
    }

    // Cookie 模式可以替代密码（绕过 Cloudflare）
    const hasCookie = extra?.cookieString || extra?.cookies || extra?.JSESSIONID
    if (platform !== 'luogu' && platform !== 'codeforces' && !actualPassword && !hasCookie) {
      return res.status(400).json({ success: false, message: '请输入密码或提供 Cookie' })
    }

    const result = await service.bindPlatform(userId, platform, {
      platformUsername: actualUsername || '',
      password: actualPassword,
      extra
    })

    if (result.success) {
      res.json({ success: true, data: result })
    } else {
      res.status(400).json({ success: false, message: result.message })
    }
  } catch (error) {
    console.error('Bind platform error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 解除平台绑定
 * DELETE /api/platform-bindings/:platform
 */
platformBindingRouter.delete('/:platform', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const platform = req.params.platform as BindingPlatform

    const result = await service.unbindPlatform(userId, platform)

    if (result.success) {
      res.json({ success: true, message: result.message })
    } else {
      res.status(400).json({ success: false, message: result.message })
    }
  } catch (error) {
    console.error('Unbind platform error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 刷新绑定状态
 * POST /api/platform-bindings/:platform/refresh
 */
platformBindingRouter.post('/:platform/refresh', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const platform = req.params.platform as BindingPlatform

    const result = await service.refreshBinding(userId, platform)

    if (result.success) {
      res.json({ success: true, message: result.message })
    } else {
      res.status(400).json({ success: false, message: result.message })
    }
  } catch (error) {
    console.error('Refresh binding error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 同步归档题目（Codeforces 专用）
 * POST /api/platform-bindings/codeforces/sync-archive
 *
 * Body:
 * - startTime?: string - 开始时间（比赛/训练归档时传入）
 * - endTime?: string - 结束时间（比赛/训练归档时传入）
 * - problemId?: string - 单题归档时传入（题库页归档当前题）
 */
platformBindingRouter.post('/codeforces/sync-archive', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { startTime, endTime, problemId } = req.body

    // 1. 获取用户的 CF 绑定信息
    const binding = await service.getUserPlatformBinding(userId, 'codeforces')

    if (!binding.bound) {
      return res.status(400).json({
        success: false,
        message: '请先绑定 Codeforces 账号',
      })
    }

    // 2. 获取绑定数据
    const bindingRecord = await prisma.userPlatformBinding.findUnique({
      where: { userId_platform: { userId, platform: 'codeforces' } },
    })

    if (!bindingRecord?.bindingData) {
      return res.status(400).json({
        success: false,
        message: '绑定数据不完整，请重新绑定',
      })
    }

    const bindingData = JSON.parse(bindingRecord.bindingData)
    const { jsessionid, handle } = bindingData

    if (!jsessionid || !handle) {
      return res.status(400).json({
        success: false,
        message: '绑定数据不完整，请重新绑定',
      })
    }

    // 3. 构建归档选项
    const options = {
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      problemId, // 新增：单题归档
    }

    // 4. 执行归档同步
    const { archiveCfProblemsForUser } = await import('./binders/codeforces-archiver')
    const result = await archiveCfProblemsForUser(userId, jsessionid, handle, options)

    // 5. 改进返回信息
    let message = ''
    if (problemId) {
      // 单题归档
      if (result.count > 0) {
        message = '已将当前题加入归档'
      } else if (result.skipped > 0) {
        message = '当前题已在归档中'
      } else {
        message = '未在 Codeforces 最近 1000 条提交记录中找到该题 AC 记录'
      }
    } else {
      // 全量同步
      message = `已同步 ${result.count} 道 Codeforces AC 题目`
      if (result.skipped > 0) {
        message += `，跳过 ${result.skipped} 道已归档`
      }
    }

    res.json({
      success: true,
      message,
      data: {
        count: result.count,
        total: result.total,
        skipped: result.skipped,
        problems: result.problems.slice(0, 10), // 只返回前 10 道题目预览
      },
    })

  } catch (error) {
    console.error('Sync CF archive error:', error)
    res.status(500).json({ success: false, message: '同步归档失败' })
  }
})

/**
 * 同步 Codeforces 提交记录到 Submission 表
 * POST /api/platform-bindings/codeforces/sync-submissions
 *
 * Body:
 * - startTime?: string - 开始时间
 * - endTime?: string - 结束时间
 * - problemId?: string - 单题同步时传入
 */
platformBindingRouter.post('/codeforces/sync-submissions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { startTime, endTime, problemId } = req.body

    // 1. 获取用户的 CF 绑定信息
    const binding = await service.getUserPlatformBinding(userId, 'codeforces')

    if (!binding.bound) {
      return res.status(400).json({
        success: false,
        message: '请先绑定 Codeforces 账号',
      })
    }

    // 2. 获取绑定数据
    const bindingRecord = await prisma.userPlatformBinding.findUnique({
      where: { userId_platform: { userId, platform: 'codeforces' } },
    })

    if (!bindingRecord?.bindingData) {
      return res.status(400).json({
        success: false,
        message: '绑定数据不完整，请重新绑定',
      })
    }

    const bindingData = JSON.parse(bindingRecord.bindingData)
    const { handle } = bindingData

    if (!handle) {
      return res.status(400).json({
        success: false,
        message: '绑定数据不完整，请重新绑定',
      })
    }

    // 3. 构建同步选项
    const options = {
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      problemId,
    }

    // 4. 执行同步
    const { syncCfSubmissionsForUser } = await import('./binders/codeforces-archiver')
    const result = await syncCfSubmissionsForUser(userId, handle, options, bindingRecord.id)

    // 5. 返回结果
    let message = ''
    if (problemId) {
      // 单题同步
      if (result.count > 0) {
        message = `已同步 ${result.count} 条提交记录`
      } else if (result.skipped > 0) {
        message = '该题提交记录已存在'
      } else {
        message = '未在 Codeforces 最近 1000 条提交记录中找到该题'
      }
    } else {
      // 全量同步
      message = `已同步 ${result.count} 条提交记录`
      if (result.skipped > 0) {
        message += `，跳过 ${result.skipped} 条已存在`
      }
    }

    res.json({
      success: true,
      message,
      data: {
        count: result.count,
        total: result.total,
        skipped: result.skipped,
      },
    })

  } catch (error) {
    console.error('Sync CF submissions error:', error)
    res.status(500).json({ success: false, message: '同步提交记录失败' })
  }
})