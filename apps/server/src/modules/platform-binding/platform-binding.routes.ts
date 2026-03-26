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

    // 验证必填参数
    if (!platformUsername) {
      return res.status(400).json({ success: false, message: '请输入平台用户名' })
    }

    const result = await service.bindPlatform(userId, platform, {
      platformUsername,
      password,
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