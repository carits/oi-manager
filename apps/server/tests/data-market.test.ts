import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { postCarits } from '../src/modules/carits/application/carits-ledger.service'
import { createAuthenticatedRequest, createTestApp } from './helpers/testRequest'
import { createTestProblem } from './helpers/problemListHelpers'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'

const app = createTestApp()

describe('V1 data product marketplace on the two-slot TestSet model', () => {
  let manager: Awaited<ReturnType<typeof createTestUser>>
  let buyer: Awaited<ReturnType<typeof createTestUser>>
  let outsider: Awaited<ReturnType<typeof createTestUser>>
  let problemId: string
  let graphHash: string
  let snapshotId: string
  let productId: string

  const client = (user: Awaited<ReturnType<typeof createTestUser>>) =>
    createAuthenticatedRequest(app, generateTokenFromUser({ ...user.user, workspaceMode: 'personal' }))

  async function createQualitySlot(nextGraphHash: string, competition = false) {
    const judgeConfigHash = `judge-${nextGraphHash}`
    await prisma.problemTestSetSlot.upsert({
      where: { problemId_slot: { problemId, slot: 'STABLE' } },
      create: {
        problemId, slot: 'STABLE', mode: 'acm', source: 'market-test',
        judgeConfig: 'mode: acm', judgeConfigHash, graphHash: nextGraphHash,
        materializedPath: `/market/${nextGraphHash}`,
      },
      update: {
        judgeConfig: 'mode: acm', judgeConfigHash, graphHash: nextGraphHash,
        materializedPath: `/market/${nextGraphHash}`,
        fencingToken: { increment: 1 },
      },
    })
    const corpus = await prisma.wrongCorpusRevision.create({ data: {
      id: crypto.randomUUID(), problemId, revisionNumber: competition ? 2 : 1, status: 'active',
      sampleCount: 20, clusterCount: 8, evaluationCount: 5, holdoutCount: 3,
      corpusHash: `corpus-${nextGraphHash}`, createdBy: manager.user.id,
    } })
    const job = await prisma.qualityEvaluationJob.create({ data: {
      id: crypto.randomUUID(), problemId, slot: 'STABLE', graphHash: nextGraphHash,
      corpusRevisionId: corpus.id, qualityRuleVersion: 'QUALITY_RULE_V1',
      ruleConfig: {}, inputSnapshot: {}, inputHash: crypto.randomUUID(),
      featureSchemaHash: 'features', solutionProfileSchemaHash: 'solutions',
      checkerHash: 'checker', judgeConfigHash, status: 'SUCCEEDED',
      createdBy: manager.user.id, finishedAt: new Date(),
    } })
    const snapshot = await prisma.testSetQualitySnapshot.create({ data: {
      id: crypto.randomUUID(), problemId, slot: 'STABLE', graphHash: nextGraphHash,
      corpusRevisionId: corpus.id, evaluationJobId: job.id,
      qualityRuleVersion: 'QUALITY_RULE_V1', inputHash: job.inputHash,
      correctnessScore: 30, discriminationScore: competition ? 24 : 22,
      coverageScore: 14, diversityScore: 9, subtaskQualityScore: 8, stabilityScore: 9,
      overallScore: competition ? 94 : 92, confidenceScore: competition ? 90 : 76,
      confidenceLevel: competition ? 'VERY_HIGH' : 'HIGH',
      maturityLevel: competition ? 'MATURE' : 'PROVEN',
      wrongProgramCount: 20, behaviorClusterCount: 8, evaluationClusterCount: 5,
      holdoutClusterCount: 3, weightedKillCoverage: .9, evaluationCoverage: .9,
      holdoutCoverage: .88, featureCoverage: .9, criticalFeatureCoverage: 1,
      qualityStatus: 'READY', evidence: {},
    } })
    return snapshot
  }

  beforeEach(async () => {
    manager = await createTestUser({ accountRole: 'platform_admin' })
    buyer = await createTestUser({ organization: { role: 'student' } })
    outsider = await createTestUser({ organization: { role: 'student' } })
    const problem = await createTestProblem({ ownerId: manager.user.id, title: 'Market quality problem' })
    problemId = problem.id
    graphHash = 'graph-stable-1'
    snapshotId = (await createQualitySlot(graphHash)).id
    await postCarits({
      type: 'test_funding', idempotencyKey: `market-test-funding:${crypto.randomUUID()}`,
      referenceType: 'test', referenceId: buyer.user.id, operatorUserId: manager.user.id,
      entries: [
        { owner: { ownerType: 'SYSTEM', systemKey: 'TEST_MARKET_TREASURY' }, amount: -1000n, allowNegative: true },
        { owner: { ownerType: 'USER', userId: buyer.user.id }, amount: 1000n },
      ],
    })
    const created = await client(manager).post(`/api/problems/${problemId}/data-products`).send({
      slot: 'STABLE', qualitySnapshotId: snapshotId, updatePolicy: 'UPDATE_90D',
      allowedLicenses: ['PERSONAL', 'ORGANIZATION', 'CONTEST'], includes: { checker: false },
    })
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({ slot: 'STABLE', graphHash, grade: 'VERIFIED' })
    productId = created.body.data.id
  })

  it('uses server prices and grants one current-slot entitlement idempotently', async () => {
    const requestId = crypto.randomUUID()
    const rejected = await client(buyer).post(`/api/data-products/${productId}/purchase`)
      .set('Idempotency-Key', requestId).send({ license: 'PERSONAL', amountCarits: 1 })
    expect(rejected.status).toBe(422)
    expect(rejected.body.code).toBe('CLIENT_PRICE_FORBIDDEN')

    const purchased = await client(buyer).post(`/api/data-products/${productId}/purchase`)
      .set('Idempotency-Key', requestId).send({ license: 'PERSONAL' })
    expect(purchased.status).toBe(201)
    expect(purchased.body.data).toMatchObject({ amountCarits: '90', purchasedGraphHash: graphHash })
    expect(purchased.body.data.Entitlement).not.toHaveProperty('Revisions')
    const entitlementId = purchased.body.data.Entitlement.id as string

    const replay = await client(buyer).post(`/api/data-products/${productId}/purchase`)
      .set('Idempotency-Key', requestId).send({ license: 'PERSONAL' })
    expect(replay.status).toBe(201)
    expect(replay.body.data.id).toBe(purchased.body.data.id)
    expect(await prisma.dataPurchase.count({ where: { idempotencyKey: requestId } })).toBe(1)

    const transaction = await prisma.caritsTransaction.findUniqueOrThrow({
      where: { id: purchased.body.data.caritsTransactionId }, include: { Entries: true },
    })
    expect(transaction.Entries.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(0n)

    const manifest = await client(buyer).get(`/api/data-entitlements/${entitlementId}/manifest`)
    expect(manifest.status).toBe(200)
    expect(manifest.body.data).toMatchObject({
      entitlementId,
      testSet: { slot: 'STABLE', graphHash },
      qualityCertificate: { overallScore: 92 },
    })
    expect(manifest.body.data.judgeConfig).toBeUndefined()
    expect((await client(outsider).get(`/api/data-entitlements/${entitlementId}/manifest`)).status).toBe(404)
  })

  it('binds contest licenses through the Contest aggregate', async () => {
    const team = await prisma.team.create({ data: {
      id: crypto.randomUUID(), name: 'Licensed contest team', scope: 'personal', isPublic: false,
    } })
    await prisma.teamMember.create({ data: {
      id: crypto.randomUUID(), teamId: team.id, userId: buyer.user.id,
      userType: 'student', role: 'owner', status: 'active',
    } })
    const startAt = new Date()
    const contest = await prisma.contest.create({ data: {
      id: crypto.randomUUID(), title: 'Real contest', type: 'judged', format: 'ioi',
      scope: 'personal', organizationId: null, teamId: team.id, contestDate: startAt, startAt,
      endAt: new Date(Date.now() + 3600_000), status: 'upcoming', createdBy: buyer.user.id,
    } })
    const purchased = await client(buyer).post(`/api/data-products/${productId}/purchase`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ license: 'CONTEST', contestId: contest.publicId })
    expect(purchased.status).toBe(201)
    expect(purchased.body.data).toMatchObject({ licenseType: 'CONTEST', purchasedGraphHash: graphHash })
  })

  it('restricts organization entitlements to authorized organization managers', async () => {
    const teacher = await createTestUser({ organization: { role: 'teacher' } })
    const student = await createTestUser({ organization: {
      role: 'student', organizationId: teacher.organization!.organizationId,
    } })
    const organizationId = teacher.organization!.organizationId
    await postCarits({
      type: 'test_funding', idempotencyKey: `market-org-funding:${crypto.randomUUID()}`,
      referenceType: 'test', referenceId: organizationId, operatorUserId: manager.user.id,
      entries: [
        { owner: { ownerType: 'SYSTEM', systemKey: 'TEST_MARKET_TREASURY' }, amount: -500n, allowNegative: true },
        { owner: { ownerType: 'ORGANIZATION', organizationId }, amount: 500n },
      ],
    })
    const purchased = await client(teacher).post(`/api/data-products/${productId}/purchase`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ license: 'ORGANIZATION', organizationId })
    expect(purchased.status).toBe(201)
    const entitlementId = purchased.body.data.Entitlement.id as string
    expect((await client(student).get(`/api/data-entitlements/${entitlementId}`)).status).toBe(404)
  })

  it('suspends the affected graph and resolves only against a newer certified graph', async () => {
    const incident = await client(manager).post('/api/test-set-quality-incidents').send({
      problemId, slot: 'STABLE', severity: 'CRITICAL', type: 'CHECKER_BYPASS',
      description: 'Checker accepts a known invalid output for the current Stable graph.',
      evidence: { report: 'regression-1' },
    })
    expect(incident.status).toBe(201)
    expect(incident.body.data).toMatchObject({ affectedGraphHash: graphHash, status: 'CONFIRMED' })
    expect((await prisma.dataProduct.findUniqueOrThrow({ where: { id: productId } })).status).toBe('SUSPENDED')

    const noFix = await client(manager)
      .post(`/api/test-set-quality-incidents/${incident.body.data.id}/resolve`)
      .send({ fixedByGraphHash: graphHash })
    expect(noFix.status).toBe(422)

    const fixedGraphHash = 'graph-stable-2'
    await createQualitySlot(fixedGraphHash, true)
    const resolved = await client(manager)
      .post(`/api/test-set-quality-incidents/${incident.body.data.id}/resolve`)
      .send({ fixedByGraphHash: fixedGraphHash })
    expect(resolved.status).toBe(200)
    expect(resolved.body.data).toMatchObject({ status: 'RESOLVED', fixedByGraphHash: fixedGraphHash })
    expect(await prisma.problemTestSetSlot.count({ where: { problemId } })).toBe(1)
  })
})
