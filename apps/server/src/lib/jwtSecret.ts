/**
 * JWT Secret 获取工具
 *
 * 在生产环境强制要求配置 JWT_SECRET 环境变量，
 * 开发环境允许使用默认值但会输出警告。
 */

let hasWarned = false

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production')
    }

    if (!hasWarned) {
      console.warn('⚠️  WARNING: Using default JWT secret. Set JWT_SECRET in production!')
      hasWarned = true
    }

    return 'dev-secret-key-12345'
  }

  return secret
}