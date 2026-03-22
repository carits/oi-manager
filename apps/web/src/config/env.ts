/**
 * 编译时环境配置
 * 使用 NEXT_PUBLIC_ 前缀的环境变量
 */

export const ENV = {
  /** API 服务地址 */
  API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  /** 是否为开发环境 */
  IS_DEV: process.env.NODE_ENV === 'development',
  /** 是否为生产环境 */
  IS_PROD: process.env.NODE_ENV === 'production',
} as const
