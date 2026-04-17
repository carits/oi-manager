/**
 * 环境变量配置和校验
 *
 * 在应用启动时校验关键配置，确保：
 * - 生产环境有必须的安全配置
 * - 开发环境允许更宽松的配置
 */

export const envConfig = {
  // 开发环境不需要强制校验的配置
  // SQLite 默认使用 file:./dev.db，不需要 DATABASE_URL
  required: [] as string[],
  productionOnly: ['JWT_SECRET', 'CORS_ORIGINS']
}

/**
 * 校验环境变量
 * 如果缺少必须配置，输出错误并退出进程
 */
export function validateEnv(): void {
  const nodeEnv = process.env.NODE_ENV || 'development'
  const errors: string[] = []

  // 检查必须配置
  for (const key of envConfig.required) {
    if (!process.env[key]) {
      errors.push(`Missing required env: ${key}`)
    }
  }

  // 生产环境额外检查
  if (nodeEnv === 'production') {
    for (const key of envConfig.productionOnly) {
      if (!process.env[key]) {
        errors.push(`Missing production required env: ${key}`)
      }
    }
  }

  if (errors.length > 0) {
    console.error('❌ Environment validation failed:')
    errors.forEach(err => console.error(`   - ${err}`))
    process.exit(1)
  }

  // 输出当前环境信息
  console.log(`✅ Environment: ${nodeEnv}`)
  console.log(`✅ Port: ${process.env.PORT || 3002}`)
}

/**
 * 判断是否为生产环境
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * 判断是否为开发环境
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production'
}
