/**
 * 异步路由处理器
 *
 * 统一包裹 async 路由处理函数，自动捕获异常并记录日志
 */

import { Request, Response, NextFunction } from 'express'
import logger from './logger'

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>

export interface ClientErrorResponse {
  status: 400 | 403 | 404 | 409
  message: string
  code?: string
}

/** Convert known domain/input failures into stable 4xx responses. */
export function classifyClientError(error: any): ClientErrorResponse | null {
  const message = typeof error?.message === 'string' ? error.message : ''
  const code = typeof error?.code === 'string' ? error.code : undefined
  const domainCode = code || (/^[A-Z][A-Z0-9_]+$/.test(message) ? message : undefined)

  if (code === 'P2025') return { status: 404, message: '记录不存在', code }
  if (/^无效的.+ID$/.test(message)) return { status: 400, message }
  if (domainCode?.endsWith('_NOT_FOUND')) {
    return { status: 404, message: '请求的资源不存在', code: domainCode }
  }
  if (domainCode && ['NOT_ADMIN', 'NOT_OWNER', 'PERMISSION_DENIED', 'FORBIDDEN'].includes(domainCode)) {
    return { status: 403, message: '权限不足', code: domainCode }
  }
  if (message.includes('不存在')) return { status: 404, message }
  if (message.startsWith('请先绑定')) return { status: 409, message }
  return null
}

/**
 * 包裹 async 路由处理函数，自动处理未捕获异常
 *
 * @param errorMessage - 可选的自定义错误消息，默认 '服务器错误'
 *
 * @example
 * router.get('/list', authenticate, asyncHandler(async (req, res) => {
 *   const data = await prisma.user.findMany()
 *   res.json({ success: true, data })
 * }))
 *
 * router.post('/create', authenticate, asyncHandler(async (req, res) => {
 *   // ...
 * }, '创建失败'))
 */
export function asyncHandler(fn: AsyncHandler, errorMessage = '服务器错误') {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((e: any) => {
      if (e?.message === 'TEAM_SCOPE_MISMATCH') {
        if (!res.headersSent) {
          res.status(403).json({ success: false, message: '该团队不属于当前使用模式' })
        }
        return
      }
      const clientError = classifyClientError(e)
      if (clientError) {
        logger.warn('request_rejected', {
          action: req.path,
          metadata: { method: req.method, status: clientError.status, error: e?.message }
        })
        if (!res.headersSent) {
          res.status(clientError.status).json({
            success: false,
            message: clientError.message,
            ...(clientError.code ? { code: clientError.code } : {})
          })
        }
        return
      }
      logger.error('unhandled_error', e, {
        action: req.path,
        metadata: { method: req.method, error: e.message }
      })
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: errorMessage })
      }
    })
  }
}
