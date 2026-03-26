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
  const nodeEnv = process.env.NODE_ENV || 'development'

  if (nodeEnv === 'production') {
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
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['Content-Disposition'] // 允许前端读取文件名
    }
  }

  // 开发环境：允许 localhost 和 127.0.0.1
  return {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition'] // 允许前端读取文件名
  }
}
