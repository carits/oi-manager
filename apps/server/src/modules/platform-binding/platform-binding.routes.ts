/**
 * Platform Binding Module - Routes Layer
 * 平台绑定模块路由层
 */

import { Router, Request, Response } from 'express'
import { authenticate } from '../../middleware/auth'
import { PlatformBindingService } from './platform-binding.service'
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

    // 洛谷平台不需要 platformUsername（从 Cookie 自动获取）
    // 其他平台需要 platformUsername
    if (platform !== 'luogu' && !actualUsername) {
      return res.status(400).json({ success: false, message: '请输入平台用户名' })
    }

    // Cookie 模式可以替代密码（绕过 Cloudflare）
    const hasCookie = extra?.cookieString || extra?.cookies
    if (platform !== 'luogu' && !actualPassword && !hasCookie) {
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