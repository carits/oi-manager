/**
 * CORS 动态配置
 *
 * 开发环境：允许 localhost 访问
 * 生产环境：从环境变量读取白名单
 */

import { CorsOptions } from 'cors'

/**
 * 获取 CORS 配置
 */
export function getCorsOptions(): CorsOptions {
  const appEnv = process.env.APP_ENV || process.env.NODE_ENV || 'development'

  if (appEnv === 'production') {
    // 生产环境：从环境变量读取白名单
    const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || []

    if (allowedOrigins.length === 0) {
      console.warn('⚠️  WARNING: CORS_ORIGINS not configured for production. CORS will block all cross-origin requests.')
    }

    return {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // 允许无 origin 的请求（如移动端应用、Postman、服务器端请求）
        if (!origin) {
          return callback(null, true)
        }

        if (allowedOrigins.includes(origin)) {
          callback(null, true)
        } else {
          // 记录被拒绝的来源（用于调试）
          console.warn(`CORS blocked origin: ${origin}`)
          callback(new Error('Not allowed by CORS'))
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-OI-Organization-ID'],
      exposedHeaders: ['Content-Disposition', 'X-Request-ID'] // 允许前端读取文件名和请求编号
    }
  }

  // Development preview can be reached through a public IP, VPN, or SSH
  // tunnel. Reflect the concrete Origin; cookie + Origin validation still
  // protects state-changing requests.
  return {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-OI-Organization-ID'],
    exposedHeaders: ['Content-Disposition', 'X-Request-ID'] // 允许前端读取文件名和请求编号
  }
}
