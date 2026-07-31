import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import helmet from 'helmet'
import compression from 'compression'
import { MulterError } from 'multer'
import { authRouter } from './routes/auth'
import { studentRouter } from './routes/students'
import { milestoneRouter } from './routes/milestones'
import { teamRouter } from './routes/teams'
import { schoolRouter } from './modules/school/school.routes'
import { userRouter } from './routes/users'
import { statsRouter } from './routes/stats'
import { teacherRouter } from './routes/teachers'
import { problemsRouter } from './modules/problem/problem.routes'
import { ojFetcherRouter } from './routes/oj-fetcher'
import { filesRouter } from './routes/files'
import { platformBindingRouter } from './modules/platform-binding/platform-binding.routes'
import { teamImportRouter } from './modules/team-import/team-import.routes'
import { submissionsRouter } from './routes/submissions'
import { problemListsRouter } from './routes/problem-lists'
import { schoolProblemListsRouter } from './routes/school-problem-lists'
import { teamProblemListsRouter } from './routes/team-problem-lists'
import { ojAccountsRouter, startAutoVerifyScheduler } from './routes/oj-accounts'
import { submitRouter } from './routes/submit'
import { testdataRouter } from './routes/testdata'
import { trainingsRouter } from './modules/training/training.routes'
import { adminDataRouter } from './routes/admin-data'
import { migrationRouter } from './routes/migration'
import { archivedProblemsRouter } from './routes/archived-problems'
import { startSubmissionPoller } from './lib/submission-poller'
import { metrics } from './lib/metrics'
import path from 'path'
import { requestLogger } from './middleware/requestLogger'
import { globalLimiter } from './middleware/rateLimiter'
import logger from './lib/logger'
import { startCronTasks } from './lib/cron-tasks'
import { validateEnv, isProduction } from './config/env'
import { getCorsOptions } from './config/cors'
import { STORAGE_ROOT } from './config/storage'
import { verifyCookieOrigin } from './middleware/csrf'

// 开发和生产环境使用独立配置文件，也可通过 ENV_FILE 显式覆盖。
const envFile = process.env.ENV_FILE ||
  (process.env.NODE_ENV === 'production' ? '.env.production' : '.env')
dotenv.config({ path: path.resolve(process.cwd(), envFile) })

// 增加 undici 全局连接超时（默认 10s 不够，VJudge 等海外站点从国内连接需要更久）
import { setGlobalDispatcher, Agent } from 'undici'
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))

// 启动时校验环境变量
validateEnv()

const app = express()
const PORT = process.env.PORT || 3002

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

// 2.5. Gzip 压缩
// 目的：减少响应体积，加快传输速度
app.use(compression())

// 3. 请求体大小限制
// 目的：防止大请求拖垮服务器
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// 4. 请求追踪中间件
app.use(requestLogger)
app.use(verifyCookieOrigin)

// 5. 全局 API 限流
// 目的：防止 DDoS 攻击和恶意滥用
// 限制：每分钟最多 100 次请求
app.use('/api', globalLimiter)

// ==================== 静态文件服务 ====================

// 公开静态文件（头像等）
// 私有文件必须通过 /api/files/:id/download 权限接口访问
app.use('/uploads/public', express.static(path.join(STORAGE_ROOT, 'public')))
// 兼容旧路径 /public
app.use('/public', express.static(path.join(STORAGE_ROOT, 'public')))

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
app.use('/api/submissions', submissionsRouter)
app.use('/api/problem-lists', problemListsRouter)
app.use('/api/schools', schoolProblemListsRouter)
app.use('/api/teams', teamProblemListsRouter)
app.use('/api/oj-accounts', ojAccountsRouter)
app.use('/api/submit', submitRouter)
app.use('/api', testdataRouter)  // testdata routes use /problems/:id/testdata pattern
app.use('/api', trainingsRouter)  // training routes use /teams/:teamId/trainings and /trainings/:id patterns
app.use('/api/admin/data', adminDataRouter)  // 管理员数据维护 API
app.use('/api/admin/migration', migrationRouter)  // 数据迁移 API
app.use('/api/archived-problems', archivedProblemsRouter)  // 用户归档题目 API

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

// 加载代理配置
import { proxyManager } from './lib/browser/proxy'
proxyManager.loadFromEnv()

// 浏览器管理器关闭钩子
import { browserManager } from './lib/browser/manager'
import { initJudgeWebSocket } from './ws/judge'
const gracefulShutdown = async (signal: string) => {
  logger.info('server_shutting_down', { action: 'server_shutdown', metadata: { signal } })
  await browserManager.close()
  process.exit(0)
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

const httpServer = app.listen(PORT, () => {
  logger.info('server_started', {
    action: 'server_start',
    metadata: { port: PORT, env: process.env.NODE_ENV || 'development' }
  })
  if (process.env.DISABLE_BACKGROUND_JOBS !== 'true') {
    startCronTasks()
    startAutoVerifyScheduler()
    startSubmissionPoller(5000) // 每 5 秒轮询一次
    metrics.startPeriodicLog(300000) // 每 5 分钟输出一次指标汇总
  }

  // 初始化评测机 WebSocket 服务器
  ;(global as any).httpServer = httpServer
  initJudgeWebSocket()
})

export { httpServer }
export default app
