/**
 * 异步路由处理器
 *
 * 统一包裹 async 路由处理函数，自动捕获异常并记录日志
 */

import { Request, Response, NextFunction } from 'express'
import logger from './logger'

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>

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
      logger.error('unhandled_error', e, {
        action: req.path,
        metadata: { method: req.method, error: e.message }
      })
      if (!res.headersSent) {
        if (e?.message === 'TEAM_SCOPE_MISMATCH') {
          res.status(403).json({ success: false, message: '该团队不属于当前使用模式' })
          return
        }
        res.status(500).json({ success: false, message: errorMessage })
      }
    })
  }
}
