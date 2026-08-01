import request from 'supertest'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { prisma } from '../../src/prisma'

// ESM imports for routes
import { authRouter } from '../../src/routes/auth'
import { meRouter } from '../../src/routes/me'
import { studentRouter } from '../../src/routes/students'
import { teamRouter } from '../../src/routes/teams'
import { schoolRouter } from '../../src/modules/school/school.routes'
import { userRouter } from '../../src/routes/users'
import { teacherRouter } from '../../src/routes/teachers'
import { problemListsRouter } from '../../src/routes/problem-lists'
import { schoolProblemListsRouter } from '../../src/routes/school-problem-lists'
import { teamProblemListsRouter } from '../../src/routes/team-problem-lists'
import { ojAccountsRouter } from '../../src/routes/oj-accounts'
import { trainingsRouter } from '../../src/modules/training/training.routes'
import { submissionsRouter } from '../../src/routes/submissions'
import { problemsRouter } from '../../src/modules/problem/problem.routes'
import { rankingRouter } from '../../src/modules/ranking/ranking.routes'
import { verifyCookieOrigin } from '../../src/middleware/csrf'

/**
 * 创建测试用的 Express 应用
 * 返回一个配置好路由的 Express 实例，用于 supertest 测试
 */
export function createTestApp() {
  const app = express()

  // 基础中间件
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }))
  app.use(cors({
    origin: '*',
    credentials: true
  }))
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))
  app.use(verifyCookieOrigin)

  // 注册路由
  app.use('/api/auth', authRouter)
  app.use('/api/me', meRouter)
  app.use('/api/students', studentRouter)
  app.use('/api/teams', teamRouter)
  app.use('/api/schools', schoolRouter)
  app.use('/api/users', userRouter)
  app.use('/api/teachers', teacherRouter)
  app.use('/api/problem-lists', problemListsRouter)
  app.use('/api/schools', schoolProblemListsRouter)
  app.use('/api/teams', teamProblemListsRouter)
  app.use('/api/oj-accounts', ojAccountsRouter)
  app.use('/api', trainingsRouter)  // training routes use /teams/:teamId/trainings and /trainings/:id patterns
  app.use('/api/submissions', submissionsRouter)
  app.use('/api/problems', problemsRouter)
  app.use('/api/rankings', rankingRouter)

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ success: true, message: 'OK' })
  })

  // 错误处理
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Test app error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  })

  return app
}

/**
 * 创建带认证的请求
 */
export function createAuthenticatedRequest(app: express.Application, token: string) {
  return {
    get: (url: string) =>
      request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) =>
      request(app).post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) =>
      request(app).put(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) =>
      request(app).delete(url).set('Authorization', `Bearer ${token}`)
  }
}
