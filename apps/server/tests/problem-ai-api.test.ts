import crypto from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('problem AI HTTP boundary', () => {
  let manager: Awaited<ReturnType<typeof createTestUser>>
  let student: Awaited<ReturnType<typeof createTestUser>>
  let problem: Awaited<ReturnType<typeof createTestProblem>>

  beforeEach(async () => {
    manager = await createTestUser({ accountRole: 'platform_admin' })
    student = await createTestUser({ organization: { role: 'student' } })
    problem = await createTestProblem({ ownerId: manager.user.id, title: 'AI API 测试题' })
  })

  it('returns usage from the managed problem and hides it from participants', async () => {
    const statement = await prisma.problemStatement.create({ data: {
      id: crypto.randomUUID(),
      problemId: problem.id,
      type: 'statement',
      format: 'markdown',
      language: 'zh',
      content: '# 题面',
      isVisible: true,
    } })
    await prisma.aiUsageLog.create({ data: {
      id: crypto.randomUUID(),
      userId: manager.user.id,
      problemId: problem.id,
      action: 'format',
      model: 'test-model',
      status: 'success',
      statementId: statement.id,
    } })

    const managerClient = createAuthenticatedRequest(app, generateTokenFromUser(manager.user))
    const usage = await managerClient.get(`/api/problems/${problem.id}/ai/usage`)
    expect(usage.status).toBe(200)
    expect(usage.body.data).toMatchObject({
      isAdmin: true,
      translations: { zh: true, en: false },
      formattedStatementIds: [statement.id],
    })

    const studentClient = createAuthenticatedRequest(app, generateTokenFromUser(student.user))
    expect((await studentClient.get(`/api/problems/${problem.id}/ai/usage`)).status).toBe(404)
  })
})
