/**
 * 编译时环境配置
 * 使用 NEXT_PUBLIC_ 前缀的环境变量
 */

export const ENV = {
  /** API 服务地址（浏览器端，空字符串表示使用相对路径通过 Next.js API Route 代理） */
  API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  /** 后端地址（仅服务端 API Route 使用） */
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3002',
  /** 是否为开发环境 */
  APP_ENV: process.env.NEXT_PUBLIC_APP_ENV || 'development',
  IS_DEV: (process.env.NEXT_PUBLIC_APP_ENV || 'development') === 'development',
  /** 是否为生产环境 */
  IS_PROD: process.env.NEXT_PUBLIC_APP_ENV === 'production',
} as const
