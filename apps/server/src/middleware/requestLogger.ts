/**
 * 请求追踪中间件
 *
 * 为每个请求生成唯一 requestId，记录请求入口和出口
 */

import { Request, Response, NextFunction } from 'express'
import logger, { createRequestLogger } from '../lib/logger'
import type { JwtPayload } from '@oi-manager/shared'

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      requestId?: string
      requestLogger?: ReturnType<typeof createRequestLogger>
      startTime?: number
      user?: JwtPayload
    }
  }
}

/**
 * 生成唯一请求 ID
 */
function generateRequestId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `req_${timestamp}_${random}`
}

/**
 * 获取客户端 IP 地址
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * 获取 User-Agent
 */
function getUserAgent(req: Request): string {
  return req.headers['user-agent'] || 'unknown'
}

/**
 * 判断是否应该跳过日志
 */
function shouldSkipLog(path: string): boolean {
  // 跳过健康检查和静态资源
  const skipPatterns = [
    '/api/health',
    '/uploads/'
  ]
  return skipPatterns.some(pattern => path.startsWith(pattern))
}

/**
 * 请求追踪中间件
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // 跳过不需要日志的请求
  if (shouldSkipLog(req.path)) {
    next()
    return
  }

  // 生成请求 ID
  const requestId = generateRequestId()
  req.requestId = requestId
  req.startTime = Date.now()

  // 创建请求级别日志上下文（初始时没有用户信息）
  req.requestLogger = createRequestLogger(requestId)

  // 获取客户端信息
  const clientIp = getClientIp(req)
  const userAgent = getUserAgent(req)

  // 记录请求入口
  logger.info('request_start', {
    requestId,
    action: 'request',
    metadata: {
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      ip: clientIp,
      userAgent
    }
  })

  // 记录原始的 res.json 和 res.end
  const originalJson = res.json.bind(res)
  const originalEnd = res.end.bind(res)

  // 记录响应完成
  const logResponse = (status: number) => {
    const duration = Date.now() - (req.startTime || Date.now())

    logger.info('request_end', {
      requestId,
      action: 'response',
      metadata: {
        method: req.method,
        path: req.path,
        status,
        duration
      }
    })
  }

  // 包装 res.json
  res.json = function(body: any): Response {
    logResponse(res.statusCode)
    return originalJson(body)
  }

  // 包装 res.end
  res.end = function(chunk?: any, encoding?: any, cb?: any): Response {
    logResponse(res.statusCode)
    return originalEnd(chunk, encoding, cb)
  }

  next()
}

/**
 * 更新请求日志上下文（在认证后调用）
 */
export function updateRequestContext(req: Request, userId: string, role: string): void {
  if (req.requestId) {
    req.requestLogger = createRequestLogger(req.requestId, userId, role)
  }
}

export default requestLogger
