import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { authRouter } from './routes/auth'
import { studentRouter } from './routes/students'
import { taskListRouter } from './routes/task-lists'
import { taskProgressRouter } from './routes/task-progress'
import { contestRouter } from './routes/contests'
import { milestoneRouter } from './routes/milestones'
import { teamRouter } from './routes/teams'
import { schoolRouter } from './routes/schools'
import { userRouter } from './routes/users'
import { statsRouter } from './routes/stats'
import { teacherRouter } from './routes/teachers'
import path from 'path'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// 中间件
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// 静态文件服务 - 上传的文件
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// API 路由
app.use('/api/auth', authRouter)
app.use('/api/students', studentRouter)
app.use('/api/task-lists', taskListRouter)
app.use('/api/task-progress', taskProgressRouter)
app.use('/api/contests', contestRouter)
app.use('/api/milestones', milestoneRouter)
app.use('/api/teams', teamRouter)
app.use('/api/schools', schoolRouter)
app.use('/api/users', userRouter)
app.use('/api/stats', statsRouter)
app.use('/api/teachers', teacherRouter)

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
})

export default app
