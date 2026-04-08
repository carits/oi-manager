import { beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '../src/prisma'

// 注意：DATABASE_URL 已在 setup-env.ts 中设置（必须在 prisma import 之前）

beforeAll(async () => {
  // 确保数据库连接
  await prisma.$connect()
})

afterEach(async () => {
  // 每个测试后清理数据（按依赖顺序删除）
  // 注意：不清理 Problem 表，因为题目数据是共享的公共数据
  const tablenames = [
    'ProblemListEntry',
    'ProblemListSection',
    'ProblemListShare',
    'SchoolProblemList',
    'TeamProblemList',
    'ProblemList',
    'TeamOperationLog',
    'LoginLog',
    'TaskItem',
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
