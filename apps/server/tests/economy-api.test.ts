import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { postCarits } from '../src/modules/carits/application/carits-ledger.service'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'

const app = createTestApp()

describe('contribution economy HTTP permissions', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let platformAdmin: Awaited<ReturnType<typeof createTestUser>>
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    user = await createTestUser()
    platformAdmin = await createTestUser({ role: 'platform_admin' })
    superAdmin = await createTestUser({ role: 'super_admin' })
  })

  async function createPendingContribution() {
    const id = crypto.randomUUID()
    await prisma.contributionEvent.create({ data: {
      id, actorUserId: user.user.id, type: 'candidate_promoted', sourceType: 'testcase_candidate', sourceId: crypto.randomUUID(),
      score: 100, ruleCode: 'canonical_testcase_promoted', ruleVersion: 1, dedupeKey: `http:${id}`,
      status: 'pending', occurredAt: new Date(), evidence: {
        candidateSource: 'direct_data', selectionMode: 'emergency',
        rewardCarits: '20', organizationRewardCarits: '0',
      },
    } })
    return id
  }

  it('keeps platform auditors read-only and lets only super administrators decide', async () => {
    const contributionId = await createPendingContribution()
    const userClient = createAuthenticatedRequest(app, generateTokenFromUser(user.user))
    const platformClient = createAuthenticatedRequest(app, generateTokenFromUser(platformAdmin.user))
    const superClient = createAuthenticatedRequest(app, generateTokenFromUser(superAdmin.user))

    expect((await userClient.get('/api/platform/contributions')).status).toBe(403)
    expect((await platformClient.get('/api/platform/contributions')).status).toBe(200)
    expect((await platformClient.post(`/api/platform/contributions/${contributionId}/accept`).send()).status).toBe(403)
    expect((await superClient.post(`/api/platform/contributions/${contributionId}/accept`).send()).status).toBe(200)
    expect((await prisma.contributionRewardDelivery.count({ where: { contributionId } }))).toBe(1)
  })

  it('paginates personal and platform contribution records without hiding the pending total', async () => {
    const acceptedIds: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const id = crypto.randomUUID()
      acceptedIds.push(id)
      await prisma.contributionEvent.create({ data: {
        id, actorUserId: user.user.id, type: 'candidate_promoted', sourceType: 'testcase_candidate', sourceId: crypto.randomUUID(),
        score: 100, ruleCode: 'canonical_testcase_promoted', ruleVersion: 1, dedupeKey: `pagination-accepted:${id}`,
        status: 'accepted', occurredAt: new Date(Date.now() + index), acceptedAt: new Date(Date.now() + index),
        evidence: { rewardCarits: '20', organizationRewardCarits: '0' },
      } })
    }
    await createPendingContribution()
    const userClient = createAuthenticatedRequest(app, generateTokenFromUser(user.user))
    const platformClient = createAuthenticatedRequest(app, generateTokenFromUser(platformAdmin.user))

    const personal = await userClient.get('/api/contributions/me/events?page=2&pageSize=2')
    expect(personal.status).toBe(200)
    expect(personal.body.data).toMatchObject({ page: 2, pageSize: 2, total: 4, totalPages: 2 })
    expect(personal.body.data.items).toHaveLength(2)
    expect(personal.body.data.items.every((item: any) => acceptedIds.includes(item.id))).toBe(true)
    const personalFirstPage = await userClient.get('/api/contributions/me/events?page=1&pageSize=2')
    expect(personalFirstPage.body.data.items.some((item: any) => item.status === 'pending')).toBe(true)

    const audit = await platformClient.get('/api/platform/contributions?status=accepted&page=1&pageSize=2')
    expect(audit.status).toBe(200)
    expect(audit.body.data).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2, pending: 1 })
    expect(audit.body.data.items).toHaveLength(2)
    expect(audit.body.data.items.every((item: any) => item.status === 'accepted')).toBe(true)
  })

  it('lets platform auditors inspect bound Candidate and Revision evidence through the audit API', async () => {
    const problem = await createTestProblem({ ownerId: user.user.id, title: '贡献证据测试题' })
    const revisionId = crypto.randomUUID()
    const candidateId = crypto.randomUUID()
    await prisma.problemTestSetRevision.create({ data: {
      id: revisionId, problemId: problem.id, revisionNumber: 1, mode: 'acm', source: 'hack',
      judgeConfig: JSON.stringify({ mode: 'acm', cases: [] }), judgeConfigHash: 'a'.repeat(64),
      graphHash: 'b'.repeat(64), testdataPath: `revisions/${revisionId}`, createdBy: user.user.id,
    } })
    await prisma.testcaseCandidate.create({ data: {
      id: candidateId, problemId: problem.id, source: 'hack', targetRole: 'hack_gate', status: 'PROMOTED',
      evaluationStage: 'completed', inputSha256: '1'.repeat(64), outputSha256: '2'.repeat(64),
      inputSize: 4, outputSize: 2, inputFileName: 'hack.in', outputFileName: 'hack.out',
      createdBy: user.user.id, promotedRevisionId: revisionId, promotedAt: new Date(),
    } })
    const contributionId = crypto.randomUUID()
    await prisma.contributionEvent.create({ data: {
      id: contributionId, actorUserId: user.user.id, type: 'hack_promoted', sourceType: 'testcase_candidate', sourceId: candidateId,
      score: 150, ruleCode: 'canonical_testcase_promoted', ruleVersion: 1, dedupeKey: `evidence:${contributionId}`,
      status: 'accepted', occurredAt: new Date(), acceptedAt: new Date(), evidence: {
        problemId: problem.id, candidateId, promotedRevisionId: revisionId,
        candidateSource: 'hack', selectionMode: 'auto', rewardCarits: '30', organizationRewardCarits: '0',
      },
    } })
    const platformClient = createAuthenticatedRequest(app, generateTokenFromUser(platformAdmin.user))
    const userClient = createAuthenticatedRequest(app, generateTokenFromUser(user.user))

    expect((await userClient.get(`/api/platform/contributions/${contributionId}/evidence?kind=candidate`)).status).toBe(403)
    const candidate = await platformClient.get(`/api/platform/contributions/${contributionId}/evidence?kind=candidate`)
    expect(candidate.status).toBe(200)
    expect(candidate.body.data).toMatchObject({ kind: 'candidate', problemId: problem.id, candidate: { id: candidateId, promotedRevisionId: revisionId } })
    const revision = await platformClient.get(`/api/platform/contributions/${contributionId}/evidence?kind=revision`)
    expect(revision.status).toBe(200)
    expect(revision.body.data).toMatchObject({ kind: 'revision', problemId: problem.id, revision: { id: revisionId, revisionNumber: 1, spec: { mode: 'acm', cases: [] } } })
  })

  it('uses the authenticated user for purchases and preserves HTTP idempotency', async () => {
    await postCarits({
      type: 'test_reward', idempotencyKey: `http-reward:${crypto.randomUUID()}`,
      entries: [
        { owner: { ownerType: 'SYSTEM', systemKey: 'REWARD_POOL' }, amount: -20n, allowNegative: true },
        { owner: { ownerType: 'USER', userId: user.user.id }, amount: 20n },
      ],
    })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(user.user))
    const key = crypto.randomUUID()
    const first = await client.post('/api/resources/evaluation-credits/purchase').set('Idempotency-Key', key).send({ packageCode: 'EVAL_5K', userId: superAdmin.user.id })
    const repeated = await client.post('/api/resources/evaluation-credits/purchase').set('Idempotency-Key', key).send({ packageCode: 'EVAL_5K', userId: superAdmin.user.id })
    expect(first.status).toBe(201)
    expect(repeated.status).toBe(201)
    expect(repeated.body.data.id).toBe(first.body.data.id)
    expect(await prisma.resourcePurchase.count({ where: { userId: user.user.id } })).toBe(1)
    expect(await prisma.resourcePurchase.count({ where: { userId: superAdmin.user.id } })).toBe(0)
  })

  it('allows only a super administrator to retry a failed reward delivery', async () => {
    const contributionId = crypto.randomUUID()
    await prisma.contributionEvent.create({ data: {
      id: contributionId, actorUserId: user.user.id, type: 'candidate_promoted', sourceType: 'testcase_candidate', sourceId: crypto.randomUUID(),
      score: 100, ruleCode: 'canonical_testcase_promoted', ruleVersion: 1, dedupeKey: `retry:${contributionId}`,
      status: 'accepted', occurredAt: new Date(), acceptedAt: new Date(), evidence: { candidateSource: 'direct_data' },
      RewardDelivery: { create: { id: crypto.randomUUID(), policyCode: 'canonical_testcase_promoted', policyVersion: 1, userCarits: 20n, status: 'failed', attemptCount: 5 } },
    } })
    const platformClient = createAuthenticatedRequest(app, generateTokenFromUser(platformAdmin.user))
    const superClient = createAuthenticatedRequest(app, generateTokenFromUser(superAdmin.user))
    expect((await platformClient.post(`/api/platform/contributions/${contributionId}/retry-reward`).send()).status).toBe(403)
    expect((await superClient.post(`/api/platform/contributions/${contributionId}/retry-reward`).send()).status).toBe(200)
    expect(await prisma.contributionRewardDelivery.findUniqueOrThrow({ where: { contributionId } })).toMatchObject({ status: 'pending', attemptCount: 0 })
  })

  it('serializes platform ledger amounts and never returns raw BigInt entries', async () => {
    await postCarits({
      type: 'platform_http_test', idempotencyKey: `platform-http:${crypto.randomUUID()}`,
      entries: [
        { owner: { ownerType: 'SYSTEM', systemKey: 'REWARD_POOL' }, amount: -7n, allowNegative: true },
        { owner: { ownerType: 'USER', userId: user.user.id }, amount: 7n },
      ],
    })
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(platformAdmin.user)).get('/api/carits/platform')
    expect(response.status).toBe(200)
    const transaction = response.body.data.transactions.find((item: any) => item.type === 'platform_http_test')
    expect(transaction).toBeTruthy()
    expect(transaction).not.toHaveProperty('Entries')
    expect(transaction.entries).toHaveLength(2)
    expect(transaction.entries.every((entry: any) => typeof entry.amount === 'string')).toBe(true)
  })

  it('denies organization wallet access after a school is isolated as legacy', async () => {
    const fixture = await createTestSchoolWithPrincipal(`Legacy wallet ${crypto.randomUUID()}`)
    const principal = await prisma.user.findUniqueOrThrow({ where: { id: fixture.principal.userId } })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(principal))
    expect((await client.get(`/api/carits/organizations/${fixture.school.organizationId}`)).status).toBe(200)
    await prisma.school.update({ where: { id: fixture.school.id }, data: { directoryStatus: 'legacy', nameKey: null } })
    expect((await client.get(`/api/carits/organizations/${fixture.school.organizationId}`)).status).toBe(403)
  })
})
