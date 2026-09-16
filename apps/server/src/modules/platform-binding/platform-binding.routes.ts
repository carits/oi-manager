/** 平台账号绑定 HTTP 路由。远端代码/提交归档能力已退役。 */
import { Router, Request, Response } from 'express'
import { PlatformBindingContracts } from '@oi-manager/contracts'
import { authenticate } from '../../middleware/auth'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { PlatformBindingService } from './platform-binding.service'
import type { BindingPlatform } from './platform-binding.types'

export const platformBindingRouter = Router()
const service = new PlatformBindingService()

platformBindingRouter.get('/platforms', (_req: Request, res: Response) => {
  sendContractData(res, PlatformBindingContracts.platforms, service.getSupportedPlatforms())
})

platformBindingRouter.get('/:platform/config-schema', (req: Request, res: Response) => {
  const schema = service.getConfigSchema(req.params.platform as BindingPlatform)
  if (!schema) return res.status(404).json({ success: false, message: '该平台暂无配置项或平台不存在' })
  sendContractData(res, PlatformBindingContracts.config, schema)
})

platformBindingRouter.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const bindings = await service.getUserBindings((req as any).user.userId)
    sendContractData(res, PlatformBindingContracts.list, bindings)
  } catch (error) {
    if (sendContractError(error, res)) return
    console.error('Get platform bindings error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

platformBindingRouter.get('/:platform', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await service.getUserPlatformBinding((req as any).user.userId, req.params.platform as BindingPlatform)
    sendContractData(res, PlatformBindingContracts.detail, result)
  } catch (error) {
    if (sendContractError(error, res)) return
    console.error('Get platform binding error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

platformBindingRouter.post('/:platform/bind', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const platform = req.params.platform as BindingPlatform
    const { platformUsername, password, extra } = parseContractBody(PlatformBindingContracts.bind, req.body ?? {})
    if (!service.getSupportedPlatforms().some(item => item.id === platform)) {
      return res.status(400).json({ success: false, message: '不支持的平台' })
    }
    const actualUsername = platformUsername || extra?.username
    const actualPassword = password || extra?.password
    if (platform !== 'luogu' && platform !== 'codeforces' && !actualUsername) {
      return res.status(400).json({ success: false, message: '请输入平台用户名' })
    }
    const hasCookie = extra?.cookieString || extra?.cookies || extra?.JSESSIONID
    if (platform !== 'luogu' && platform !== 'codeforces' && !actualPassword && !hasCookie) {
      return res.status(400).json({ success: false, message: '请输入密码或提供 Cookie' })
    }
    const result = await service.bindPlatform(userId, platform, {
      platformUsername: actualUsername || '',
      password: actualPassword,
      extra,
    })
    if (!result.success) return res.status(400).json({ success: false, message: result.message })
    sendContractData(res, PlatformBindingContracts.bind, result)
  } catch (error) {
    if (sendContractError(error, res)) return
    console.error('Bind platform error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

platformBindingRouter.delete('/:platform', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await service.unbindPlatform((req as any).user.userId, req.params.platform as BindingPlatform)
    if (!result.success) return res.status(400).json({ success: false, message: result.message })
    sendContractData(res, PlatformBindingContracts.unbind, { unbound: true })
  } catch (error) {
    if (sendContractError(error, res)) return
    console.error('Unbind platform error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

platformBindingRouter.post('/:platform/refresh', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await service.refreshBinding((req as any).user.userId, req.params.platform as BindingPlatform)
    if (!result.success) return res.status(400).json({ success: false, message: result.message })
    sendContractData(res, PlatformBindingContracts.refresh, { refreshed: true })
  } catch (error) {
    if (sendContractError(error, res)) return
    console.error('Refresh binding error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
