import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'

const app = createTestApp()

describe('bounded Candidate HTTP boundary', () => {
  let manager: Awaited<ReturnType<typeof createTestUser>>, student: Awaited<ReturnType<typeof createTestUser>>, problem: Awaited<ReturnType<typeof createTestProblem>>
  beforeEach(async () => {
    manager = await createTestUser({ role: 'platform_admin' }); student = await createTestUser({ role: 'student' }); problem = await createTestProblem({ ownerId: manager.user.id, title: 'Candidate API 测试题' })
    for (const kind of ['standard', 'validator']) {
      const programId = crypto.randomUUID(), versionId = crypto.randomUUID()
      await prisma.problemJudgeProgram.create({ data: { id: programId, problemId: problem.id, kind, name: kind, language: 'cpp17', currentVersionId: versionId, createdBy: manager.user.id } })
      await prisma.problemJudgeProgramVersion.create({ data: { id: versionId, programId, problemId: problem.id, versionNumber: 1, language: 'cpp17', source: 'int main(){return 0;}', sourceSha256: kind.repeat(32).slice(0, 64), compileStatus: 'passed', createdBy: manager.user.id } })
    }
  })

  it('lets a submit-capable user contribute while keeping the management pool private', async () => {
    const studentClient = createAuthenticatedRequest(app, generateTokenFromUser({ ...student.user, workspaceMode: 'personal' })), managerClient = createAuthenticatedRequest(app, generateTokenFromUser(manager.user))
    const contribution = await studentClient.post(`/api/problems/${problem.id}/candidates/data`).send({ name: 'edge', inputData: '1 2\n' })
    expect(contribution.status, JSON.stringify(contribution.body)).toBe(202)
    expect(contribution.body.data).toMatchObject({ status: 'queued' })
    expect(contribution.body.data.jobId).toBeTruthy()
    const readiness = await studentClient.get(`/api/problems/${problem.id}/contribution-readiness`)
    expect(readiness.body.data).toMatchObject({ canContribute: true, mode: 'acm', standard: { status: 'active' }, validator: { status: 'active' } })
    const mine = await studentClient.get(`/api/problems/${problem.id}/contributions/mine`)
    expect(mine.body.data[0]).toMatchObject({ jobId: contribution.body.data.jobId, status: 'queued', stage: 'received' })
    expect((await studentClient.get(`/api/problems/${problem.id}/candidate-pool`)).status).toBe(404)
    const pool = await managerClient.get(`/api/problems/${problem.id}/candidate-pool`)
    expect(pool.status).toBe(200)
    expect(pool.body.data.policy.selectorMode).toBe('auto')
  })

  it('reports an explicit blocker and rejects direct API calls when Validator is not active', async () => {
    await prisma.problemJudgeProgram.updateMany({ where: { problemId: problem.id, kind: 'validator' }, data: { status: 'archived' } })
    const client = createAuthenticatedRequest(app, generateTokenFromUser({ ...student.user, workspaceMode: 'personal' }))
    const readiness = await client.get(`/api/problems/${problem.id}/contribution-readiness`)
    expect(readiness.status).toBe(200)
    expect(readiness.body.data.canContribute).toBe(false)
    expect(readiness.body.data.blockers).toContainEqual(expect.objectContaining({ code: 'VALIDATOR_NOT_ACTIVE' }))
    const contribution = await client.post(`/api/problems/${problem.id}/candidates/data`).send({ inputData: '1 2\n' })
    expect(contribution.status).toBe(409)
    expect(contribution.body.code).toBe('VALIDATOR_NOT_ACTIVE')
  })

  it('prevents another active contribution task for the same problem', async () => {
    const client = createAuthenticatedRequest(app, generateTokenFromUser({ ...student.user, workspaceMode: 'personal' }))
    const first = await client.post(`/api/problems/${problem.id}/candidates/data`).send({ inputData: '3 4\n' })
    expect(first.status, JSON.stringify(first.body)).toBe(202)
    const second = await client.post(`/api/problems/${problem.id}/candidates/data`).send({ inputData: '5 6\n' })
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('GENERATION_JOB_ACTIVE')
  })
})
