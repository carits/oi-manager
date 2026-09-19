import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('problem Judge configuration boundary', () => {
  let manager: Awaited<ReturnType<typeof createTestUser>>
  let student: Awaited<ReturnType<typeof createTestUser>>
  let problem: Awaited<ReturnType<typeof createTestProblem>>
  let managerToken: string

  beforeEach(async () => {
    manager = await createTestUser({ accountRole: 'platform_admin' })
    student = await createTestUser({ organization: { role: 'student' } })
    problem = await createTestProblem({ ownerId: manager.user.id, title: 'Checker API 测试题' })
    managerToken = generateTokenFromUser(manager.user)
  })

  it('uploads, replaces, downloads and deletes one safe Checker source', async () => {
    const first = await request(app)
      .post(`/api/problems/${problem.id}/checker`)
      .set('Cookie', `oi_session=${managerToken}`)
      .attach('file', Buffer.from('#include <iostream>\nint main() { return 0; }\n'), {
        filename: 'checker.cpp',
        contentType: 'text/plain',
      })
    expect(first.status).toBe(200)
    expect(first.body.data.fileName).toBe('checker.cpp')

    const replacementSource = '#include <iostream>\nint main() { return 1; }\n'
    const replacement = await request(app)
      .post(`/api/problems/${problem.id}/checker`)
      .set('Cookie', `oi_session=${managerToken}`)
      .attach('file', Buffer.from(replacementSource), {
        filename: 'checker.cpp',
        contentType: 'text/plain',
      })
    expect(replacement.status).toBe(200)
    expect(await prisma.problemChecker.count({ where: { problemId: problem.id } })).toBe(1)

    const download = await request(app)
      .get(`/api/problems/${problem.id}/checker/checker.cpp/download`)
      .set('Cookie', `oi_session=${managerToken}`)
    expect(download.status).toBe(200)
    expect(download.text).toContain('return 1')

    const removed = await createAuthenticatedRequest(app, managerToken)
      .delete(`/api/problems/${problem.id}/checker/${replacement.body.data.id}`)
    expect(removed.status).toBe(200)
    expect((await createAuthenticatedRequest(app, managerToken)
      .get(`/api/problems/${problem.id}/checker`)).body.data).toEqual([])
    expect((await createAuthenticatedRequest(app, managerToken)
      .get(`/api/problems/${problem.id}/checker/checker.cpp/download`)).status).toBe(404)
  })

  it('rejects binary source content and hides Checker management from participants', async () => {
    const binary = await request(app)
      .post(`/api/problems/${problem.id}/checker`)
      .set('Cookie', `oi_session=${managerToken}`)
      .attach('file', Buffer.from([0, 1, 2, 3, 4]), {
        filename: 'checker.cpp',
        contentType: 'text/plain',
      })
    expect(binary.status).toBe(400)
    expect(binary.body.code).toBe('INVALID_CHECKER_FILE')
    expect(await prisma.problemChecker.count({ where: { problemId: problem.id } })).toBe(0)

    const studentClient = createAuthenticatedRequest(app, generateTokenFromUser(student.user))
    expect((await studentClient.get(`/api/problems/${problem.id}/checker`)).status).toBe(404)
  })

  it('validates judge limits before writing the problem', async () => {
    const response = await createAuthenticatedRequest(app, managerToken)
      .put(`/api/problems/${problem.id}/judge-config`)
      .send({ timeLimit: -1 })
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('INVALID_JUDGE_LIMIT')
    expect((await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).timeLimit).toBeNull()
  })
})
