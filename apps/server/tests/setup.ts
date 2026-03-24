import { beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '../src/prisma'

// 使用测试数据库
process.env.DATABASE_URL = 'file:./prisma/test.db'
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret-key-for-testing-only'

beforeAll(async () => {
  // 确保数据库连接
  await prisma.$connect()
})

afterEach(async () => {
  // 每个测试后清理数据（按依赖顺序删除）
  const tablenames = [
    'TeamOperationLog',
    'LoginLog',
    'TaskProgress',
    'TaskItem',
    'TaskList',
    'ContestProblemScore',
    'ContestResult',
    'ContestProblem',
    'ContestResource',
    'Contest',
    'TeamMember',
    'TeamJoinRequest',
    'Team',
    'Milestone',
    'Student',
    'Teacher',
    'PrincipalTransferLog',
    'Admin',
    'School',
    'User'
  ]

  for (const tablename of tablenames) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${tablename}"`)
    } catch {
      // 表可能为空或不存在，忽略错误
    }
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})