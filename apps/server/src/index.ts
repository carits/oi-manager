import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import helmet from 'helmet'
import { MulterError } from 'multer'
import { authRouter } from './routes/auth'
import { studentRouter } from './routes/students'
import { milestoneRouter } from './routes/milestones'
import { teamRouter } from './routes/teams'
import { schoolRouter } from './routes/schools'
import { userRouter } from './routes/users'
import { statsRouter } from './routes/stats'
import { teacherRouter } from './routes/teachers'
import { problemsRouter } from './routes/problems'
import { ojFetcherRouter } from './routes/oj-fetcher'
import { filesRouter } from './routes/files'
import { platformBindingRouter } from './modules/platform-binding/platform-binding.routes'
import { teamImportRouter } from './modules/team-import/team-import.routes'
import path from 'path'
import { requestLogger } from './middleware/requestLogger'
import { globalLimiter } from './middleware/rateLimiter'
import logger from './lib/logger'
import { validateEnv, isProduction } from './config/env'
import { getCorsOptions } from './config/cors'

// 加载环境变量
dotenv.config()

// 增加 undici 全局连接超时（默认 10s 不够，VJudge 等海外站点从国内连接需要更久）
import { setGlobalDispatcher, Agent } from 'undici'
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))

// 启动时校验环境变量
validateEnv()

const app = express()
const PORT = process.env.PORT || 3001

// ==================== 安全中间件 ====================

// 1. Helmet 安全响应头
// 目的：防止 XSS、点击劫持、MIME 嗅探等攻击
// 效果：添加 X-Frame-Options: DENY、X-Content-Type-Options: nosniff 等安全头
app.use(helmet({
  contentSecurityPolicy: false, // 按需开启，避免影响内联脚本
  crossOriginEmbedderPolicy: false, // 允许加载外部资源
  crossOriginResourcePolicy: { policy: 'cross-origin' } // 允许跨域加载图片等资源
}))

// 2. CORS 跨域配置
// 目的：开发环境宽松，生产环境严格白名单
app.use(cors(getCorsOptions()))

// 3. 请求体大小限制
// 目的：防止大请求拖垮服务器
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// 4. 请求追踪中间件
app.use(requestLogger)

// 5. 全局 API 限流
// 目的：防止 DDoS 攻击和恶意滥用
// 限制：每分钟最多 100 次请求
app.use('/api', globalLimiter)

// ==================== 静态文件服务 ====================

// 上传的文件（注意：当前无权限控制，记录为已知问题 P2）
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// ==================== API 路由 ====================

app.use('/api/auth', authRouter)
app.use('/api/students', studentRouter)
app.use('/api/milestones', milestoneRouter)
app.use('/api/teams', teamRouter)
app.use('/api/schools', schoolRouter)
app.use('/api/users', userRouter)
app.use('/api/stats', statsRouter)
app.use('/api/teachers', teacherRouter)
app.use('/api/problems', problemsRouter)
app.use('/api/oj-fetcher', ojFetcherRouter)
app.use('/api/files', filesRouter)
app.use('/api/platform-bindings', platformBindingRouter)
app.use('/api/team-import', teamImportRouter)

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ==================== 错误处理 ====================

// 404 处理
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' })
})

// 全局错误处理中间件
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // 处理 Multer 上传错误
  if (err instanceof MulterError) {
    let message = '文件上传失败'
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = '文件大小超出限制'
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = '文件数量超出限制'
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = '意外的文件字段'
    }
    logger.warn('upload_error', {
      requestId: req.requestId,
      action: 'upload_error',
      metadata: { code: err.code, message: err.message }
    })
    return res.status(400).json({ success: false, message })
  }

  // 处理文件类型错误（来自 multer fileFilter）
  if (err.message === '只支持图片文件' || err.message === '不支持的文件类型') {
    logger.warn('upload_type_error', {
      requestId: req.requestId,
      action: 'upload_type_error',
      metadata: { message: err.message }
    })
    return res.status(400).json({ success: false, message: err.message })
  }

  // 处理 CORS 错误
  if (err.message === 'Not allowed by CORS') {
    logger.security('cors_blocked', {
      requestId: req.requestId,
      action: 'cors_blocked',
      metadata: { origin: req.headers.origin }
    })
    return res.status(403).json({ success: false, message: '不允许的跨域请求' })
  }

  // 记录未处理异常
  logger.error('unhandled_error', err, {
    requestId: req.requestId,
    userId: (req as any).user?.userId,
    role: (req as any).user?.role,
    action: 'unhandled_error',
    metadata: {
      path: req.path,
      method: req.method
    }
  })

  // 生产环境不返回详细错误信息，避免泄露敏感信息
  const message = isProduction()
    ? '服务器错误'
    : err.message || '服务器错误'

  res.status(500).json({ success: false, message })
})

// ==================== 启动服务 ====================

app.listen(PORT, () => {
  logger.info('server_started', {
    action: 'server_start',
    metadata: { port: PORT, env: process.env.NODE_ENV || 'development' }
  })
})

export default app