import rateLimit from 'express-rate-limit'

/**
 * 全局 API 限流
 * 限制：每分钟最多 100 次请求
 * 目的：防止 DDoS 攻击和恶意滥用
 * 风险缓解：100次/分钟对正常用户足够宽松，同时能阻止自动化攻击
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '请求过于频繁，请稍后再试' }
})

/**
 * 登录接口速率限制
 * 限制：每分钟最多 5 次尝试
 * 目的：防止暴力破解密码
 */
export const loginLimiter = rateLimit({
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
export const registerLimiter = rateLimit({
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
export const passwordLimiter = rateLimit({
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
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '密码重置操作过于频繁，请稍后再试' }
})
