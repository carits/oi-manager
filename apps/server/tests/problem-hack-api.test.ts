import crypto from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('problem Hack HTTP boundary', () => {
  let manager: Awaited<ReturnType<typeof createTestUser>>
  let student: Awaited<ReturnType<typeof createTestUser>>
  let problem: Awaited<ReturnType<typeof createTestProblem>>

  beforeEach(async () => {
    manager = await createTestUser({ accountRole: 'platform_admin' })
    student = await createTestUser({ organization: { role: 'student' } })
    problem = await createTestProblem({ ownerId: manager.user.id, title: 'Hack API 测试题' })
    const judgeConfig = JSON.stringify({
      mode: 'acm',
      type: 'default',
      cases: [{ input: '1.in', output: '1.out' }],
    })
    const revisionId = crypto.randomUUID()
    await prisma.problemTestSetRevision.create({ data: {
      id: revisionId,
      problemId: problem.id,
      revisionNumber: 1,
      mode: 'acm',
      source: 'initial',
      judgeConfig,
      judgeConfigHash: 'a'.repeat(64),
      graphHash: 'b'.repeat(64),
      testdataPath: `revisions/${revisionId}`,
      createdBy: manager.user.id,
    } })
    await prisma.problem.update({
      where: { id: problem.id },
      data: { judgeConfig, latestTestSetRevisionId: revisionId },
    })
  })

  it('requires management permission for Hack configuration', async () => {
    const managerClient = createAuthenticatedRequest(app, generateTokenFromUser(manager.user))
    const studentClient = createAuthenticatedRequest(app, generateTokenFromUser(student.user))
    const config = await managerClient.get(`/api/problems/${problem.id}/hack-config`)
    expect(config.status).toBe(200)
    expect(config.body.data.revision).toBe(0)
    expect((await studentClient.get(`/api/problems/${problem.id}/hack-config`)).status).toBe(404)
  })

  it('uses configuration revision CAS and allows only one concurrent writer', async () => {
    const client = createAuthenticatedRequest(app, generateTokenFromUser(manager.user))
    const first = await client.put(`/api/problems/${problem.id}/hack-config`).send({
      enabled: false,
      standardSource: 'first',
      validatorSource: '',
      classifierSource: '',
      expectedRevision: 0,
    })
    expect(first.status).toBe(200)
    expect(first.body.data.revision).toBe(1)

    const stale = await client.put(`/api/problems/${problem.id}/hack-config`).send({
      enabled: false,
      standardSource: 'stale',
      expectedRevision: 0,
    })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('HACK_CONFIG_STALE')

    const results = await Promise.all([
      client.put(`/api/problems/${problem.id}/hack-config`).send({
        enabled: false,
        standardSource: 'writer-a',
        expectedRevision: 1,
      }),
      client.put(`/api/problems/${problem.id}/hack-config`).send({
        enabled: false,
        standardSource: 'writer-b',
        expectedRevision: 1,
      }),
    ])
    expect(results.map(result => result.status).sort()).toEqual([200, 409])
    const saved = await prisma.problemHackConfig.findUniqueOrThrow({
      where: { problemId: problem.id },
    })
    expect(saved.revision).toBe(2)
    expect(['writer-a', 'writer-b']).toContain(saved.standardSource)
  })
})
