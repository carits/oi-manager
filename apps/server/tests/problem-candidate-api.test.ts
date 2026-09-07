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
      await prisma.problemJudgeProgramVersion.create({ data: { id: versionId, programId, problemId: problem.id, versionNumber: 1, language: 'cpp17', source: 'int main(){return 0;}', sourceSha256: kind.repeat(32).slice(0, 64), compileStatus: 'passed', lifecycleStatus: 'active', protocol: kind === 'standard' ? 'oj.standard/v1' : 'oj.validator/v1', activatedAt: new Date(), createdBy: manager.user.id } })
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

  it('does not let a contributor turn the manager generation endpoint into a contribution endpoint', async () => {
    const client = createAuthenticatedRequest(app, generateTokenFromUser({ ...student.user, workspaceMode: 'personal' }))
    const response = await client.post(`/api/problems/${problem.id}/data-generation-jobs`).send({ contribution: true, sourceMode: 'input', cases: [{ name: 'bypass', inputData: '1 2\n' }] })
    expect(response.status).toBe(404)
  })

  it('requires a complete Generator v1 manifest and stores a server-generated seed', async () => {
    const client = createAuthenticatedRequest(app, generateTokenFromUser({ ...student.user, workspaceMode: 'personal' }))
    const source = 'import json\nctx=json.load(__import__("sys").stdin)\nprint(ctx["seed"])\n'
    const invalid = await client.post(`/api/problems/${problem.id}/candidates/generator`).send({ language: 'python3', source, manifest: { apiVersion: 'oj.generator/v1', protocol: 'oj.generator/v1', profiles: [{ id: 'default', params: {} }] } })
    expect(invalid.status).toBe(400)
    expect(invalid.body.code).toBe('GENERATOR_MANIFEST_INVALID')

    const accepted = await client.post(`/api/problems/${problem.id}/candidates/generator`).send({ language: 'python3', source, manifest: { apiVersion: 'oj.generator/v1', protocol: 'oj.generator/v1', language: 'python3', entry: 'main.py', parameterSchema: {}, profiles: [{ id: 'default', label: '默认', params: {} }] } })
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(202)
    const generatedCase = await prisma.problemDataGenerationCase.findFirstOrThrow({ where: { jobId: accepted.body.data.jobId } })
    expect(generatedCase.seed).toMatch(/^\d+$/)
    const job = await prisma.problemDataGenerationJob.findUniqueOrThrow({ where: { id: accepted.body.data.jobId } })
    expect((job.config as any).generatorManifest).toMatchObject({ language: 'python3', entry: 'main.py' })
  })

  it('rejects a verified but not active program version in a formal generation job', async () => {
    const standard = await prisma.problemJudgeProgram.findFirstOrThrow({ where: { problemId: problem.id, kind: 'standard' } })
    const validator = await prisma.problemJudgeProgram.findFirstOrThrow({ where: { problemId: problem.id, kind: 'validator' } })
    await prisma.problemJudgeProgramVersion.update({ where: { id: standard.currentVersionId! }, data: { lifecycleStatus: 'verified' } })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(manager.user))
    const response = await client.post(`/api/problems/${problem.id}/data-generation-jobs`).send({
      sourceMode: 'input', standardVersionId: standard.currentVersionId, validatorVersionId: validator.currentVersionId,
      cases: [{ name: 'formal', inputData: '1 2\n' }],
    })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PROGRAM_VERSION_NOT_ACTIVE')
  })

  it('serializes affected Subtask IDs as arrays for manager Candidate APIs', async () => {
    const candidate = await prisma.testcaseCandidate.create({ data: {
      id: crypto.randomUUID(), problemId: problem.id, source: 'generator', targetRole: 'hack_gate', status: 'ADMITTED', evaluationStage: 'awaiting_corpus',
      inputSha256: '1'.repeat(64), outputSha256: '2'.repeat(64), inputSize: 4, outputSize: 2,
      inputFileName: 'candidate.in', outputFileName: 'candidate.out', affectedSubtaskIds: '[1,2]', createdBy: manager.user.id,
    } })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(manager.user))
    const detail = await client.get(`/api/problems/${problem.id}/candidates/${candidate.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.affectedSubtaskIds).toEqual([1, 2])
    const pool = await client.get(`/api/problems/${problem.id}/candidate-pool`)
    expect(pool.status).toBe(200)
    expect(pool.body.data.candidates.find((item: any) => item.id === candidate.id)?.affectedSubtaskIds).toEqual([1, 2])
  })
})
