import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import type { RequestHandler } from 'express'
import type { Request } from 'express'
import { getJwtSecret } from '../lib/jwtSecret'
import { getSessionToken } from '../lib/sessionCookie'

// 测试环境跳过限流（避免测试被限流导致失败）
const noop: RequestHandler = (_req, _res, next) => next()
const shouldSkip = process.env.NODE_ENV === 'test'

export function getRateLimitKey(req: Request): string {
  const authorization = req.headers.authorization
  const bearerToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : null
  const token = bearerToken || getSessionToken(req)

  if (token) {
    try {
      const payload = jwt.verify(token, getJwtSecret())
      if (typeof payload !== 'string' && typeof payload.userId === 'string' && payload.userId) {
        return `user:${payload.userId}`
      }
    } catch {
      // Invalid credentials remain subject to the anonymous IP bucket. The
      // authentication middleware later returns the actual 401 response.
    }
  }

  return `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown')}`
}

/**
 * 全局 API 限流
 * 限制：每分钟最多 2000 次请求（支持 1000 QPS，通过环境变量可调）
 * 维度：按用户 ID（已登录）或 IP（未登录）
 */
export const globalLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: parseInt(process.env.RATE_LIMIT_MAX || '2000'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  message: { success: false, message: '请求过于频繁，请稍后再试' }
})

/**
 * 登录接口速率限制
 * 限制：每分钟最多 5 次尝试
 * 目的：防止暴力破解密码
 */
export const loginLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '登录尝试过于频繁，请稍后再试' }
})

/**
 * 注册接口速率限制
 * 限制：每小时最多 3 次注册
 * 防止批量注册攻击
 */
export const registerLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '注册请求过于频繁，请稍后再试' }
})

/**
 * 密码修改接口速率限制
 * 限制：每小时最多 3 次
 * 防止密码攻击
 */
export const passwordLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '密码操作过于频繁，请稍后再试' }
})

/**
 * 密码重置接口速率限制
 * 限制：每小时最多 3 次
 * 用于管理员重置用户密码
 */
export const passwordResetLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '密码重置操作过于频繁，请稍后再试' }
})

export const clientTelemetryLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.CLIENT_TELEMETRY_RATE_LIMIT_MAX || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  message: { success: false, message: '客户端遥测请求过于频繁' },
})
