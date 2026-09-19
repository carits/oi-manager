import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import type { RequestHandler } from 'express'
import type { Request } from 'express'
import { getJwtSecret } from '../lib/jwtSecret'
import { getSessionToken } from '../lib/sessionCookie'

// 测试环境跳过限流（避免测试被限流导致失败）
const noop: RequestHandler = (_req, _res, next) => next()
const shouldSkip = process.env.NODE_ENV === 'test'

export function normalizeLoginAccount(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase('en-US').slice(0, 64)
    : ''
}

function requestIpKey(req: Request): string {
  return ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown')
}

export function getRateLimitKey(req: Request): string {
  const token = getSessionToken(req)

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
 * Login protection is deliberately split in two. A failed-attempt account
 * bucket stops credential guessing without treating a whole school NAT as one
 * user, while a much larger IP bucket remains as flood protection.
 */
export const loginAccountLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 5 * 60 * 1000,
  max: Number.parseInt(process.env.LOGIN_ACCOUNT_FAILED_MAX || '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: req => `account:${normalizeLoginAccount(req.body?.username) || 'missing'}`,
  message: { success: false, code: 'LOGIN_ACCOUNT_RATE_LIMITED', message: '该账号登录失败次数过多，请稍后再试' },
})

export const loginIpLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 1000,
  max: Number.parseInt(process.env.LOGIN_IP_FAILED_MAX || '120', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: req => `login-ip:${requestIpKey(req)}`,
  message: { success: false, code: 'LOGIN_IP_RATE_LIMITED', message: '该网络登录失败请求过多，请稍后再试' },
})

/** @deprecated Apply loginAccountLimiter and loginIpLimiter together. */
export const loginLimiter = loginAccountLimiter

/**
 * 注册接口速率限制
 * 共享网络每小时最多 30 次注册（可下调）
 * 防止批量注册攻击
 */
export const registerLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: Number.parseInt(process.env.REGISTER_IP_MAX || '30', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `register-ip:${requestIpKey(req)}`,
  message: { success: false, message: '注册请求过于频繁，请稍后再试' }
})

/**
 * 密码修改接口速率限制
 * 已登录账号每小时最多 10 次
 * 防止密码攻击
 */
export const passwordLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: Number.parseInt(process.env.PASSWORD_OPERATION_MAX || '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  message: { success: false, message: '密码操作过于频繁，请稍后再试' }
})

/**
 * 密码重置接口速率限制
 * 管理员账号每小时最多 30 次
 * 用于管理员重置用户密码
 */
export const passwordResetLimiter = shouldSkip ? noop : rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: Number.parseInt(process.env.PASSWORD_RESET_MAX || '30', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
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
