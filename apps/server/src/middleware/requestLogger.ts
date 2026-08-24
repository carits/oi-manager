/**
 * 请求追踪中间件
 *
 * 为每个请求生成唯一 requestId，记录请求入口和出口
 * P0 可观测性增强：按端点聚合延迟统计
 */

import { Request, Response, NextFunction } from 'express'
import logger, { createRequestLogger } from '../lib/logger'
import { metrics } from '../lib/metrics'
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

  // Express mutates req.path while a request is traversing nested routers.
  // Capture the public path and method before calling next() so the finish
  // callback records the endpoint that actually entered this middleware.
  const requestMethod = req.method
  const requestPath = req.path

  // 生成请求 ID
  const requestId = generateRequestId()
  req.requestId = requestId
  req.startTime = Date.now()
  res.setHeader('X-Request-ID', requestId)

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
      method: requestMethod,
      path: requestPath,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      ip: clientIp,
      userAgent
    }
  })

  // 记录响应完成
  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || Date.now())

    // 记录到 metrics（用于聚合统计）
    const success = res.statusCode < 400
    metrics.recordEndpoint(requestMethod, requestPath, duration, success)

    if (duration > 1000) {
      logger.warn('slow_request', {
        requestId,
        action: 'slow',
        metadata: {
          method: requestMethod,
          path: requestPath,
          status: res.statusCode,
          duration
        }
      })
    }

    logger.info('request_end', {
      requestId,
      action: 'response',
      metadata: {
        method: requestMethod,
        path: requestPath,
        status: res.statusCode,
        duration
      }
    })
  })

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
