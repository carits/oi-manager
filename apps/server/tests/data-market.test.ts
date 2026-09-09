import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { postCarits } from '../src/modules/carits/application/carits-ledger.service'
import { createAuthenticatedRequest, createTestApp } from './helpers/testRequest'
import { createTestProblem } from './helpers/problemListHelpers'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'

const app = createTestApp()

describe('V1 data product marketplace', () => {
  let manager: Awaited<ReturnType<typeof createTestUser>>
  let buyer: Awaited<ReturnType<typeof createTestUser>>
  let outsider: Awaited<ReturnType<typeof createTestUser>>
  let problemId: string
  let revisionId: string
  let snapshotId: string
  let productId: string

  const client = (user: Awaited<ReturnType<typeof createTestUser>>) => createAuthenticatedRequest(app, generateTokenFromUser({ ...user.user, workspaceMode: 'personal' }))

  async function createQualityRevision(revisionNumber: number, grade: 'VERIFIED' | 'COMPETITION' = 'VERIFIED') {
    const revision = await prisma.problemTestSetRevision.create({ data: {
      id: crypto.randomUUID(), problemId, revisionNumber, mode: 'acm', source: 'market-test',
      judgeConfig: 'mode: acm', judgeConfigHash: `judge-${revisionNumber}`, graphHash: `graph-${revisionNumber}`,
      testdataPath: `/market/${revisionNumber}`, createdBy: manager.user.id,
    } })
    const corpus = await prisma.wrongCorpusRevision.create({ data: {
      id: crypto.randomUUID(), problemId, revisionNumber, status: 'active', sampleCount: 20, clusterCount: 8,
      evaluationCount: 5, holdoutCount: 3, corpusHash: `corpus-${revisionNumber}`, createdBy: manager.user.id,
    } })
    const job = await prisma.qualityEvaluationJob.create({ data: {
      id: crypto.randomUUID(), problemId, revisionId: revision.id, corpusRevisionId: corpus.id,
      qualityRuleVersion: 'QUALITY_RULE_V1', ruleConfig: {}, inputSnapshot: {}, inputHash: crypto.randomUUID(),
      featureSchemaHash: 'features', solutionProfileSchemaHash: 'solutions', checkerHash: 'checker', judgeConfigHash: revision.judgeConfigHash,
      status: 'SUCCEEDED', createdBy: manager.user.id, finishedAt: new Date(),
    } })
    const competition = grade === 'COMPETITION'
    const snapshot = await prisma.testSetQualitySnapshot.create({ data: {
      id: crypto.randomUUID(), problemId, revisionId: revision.id, corpusRevisionId: corpus.id, evaluationJobId: job.id,
      qualityRuleVersion: 'QUALITY_RULE_V1', inputHash: job.inputHash,
      correctnessScore: 30, discriminationScore: competition ? 24 : 22, coverageScore: 14, diversityScore: 9,
      subtaskQualityScore: 8, stabilityScore: 9, overallScore: competition ? 94 : 92,
      confidenceScore: competition ? 90 : 76, confidenceLevel: competition ? 'VERY_HIGH' : 'HIGH',
      maturityLevel: competition ? 'MATURE' : 'PROVEN', wrongProgramCount: 20, behaviorClusterCount: 8,
      evaluationClusterCount: 5, holdoutClusterCount: 3, weightedKillCoverage: .9, evaluationCoverage: .9,
      holdoutCoverage: .88, featureCoverage: .9, criticalFeatureCoverage: 1, qualityStatus: 'READY', evidence: {},
    } })
    return { revision, snapshot }
  }

  beforeEach(async () => {
    manager = await createTestUser({ role: 'platform_admin' })
    buyer = await createTestUser({ role: 'student' })
    outsider = await createTestUser({ role: 'student' })
    const problem = await createTestProblem({ ownerId: manager.user.id, title: 'Market quality problem' })
    problemId = problem.id
    const quality = await createQualityRevision(1)
    revisionId = quality.revision.id
    snapshotId = quality.snapshot.id
    await prisma.problem.update({ where: { id: problemId }, data: { latestTestSetRevisionId: revisionId } })
    await postCarits({
      type: 'test_funding', idempotencyKey: `market-test-funding:${crypto.randomUUID()}`,
      referenceType: 'test', referenceId: buyer.user.id, operatorUserId: manager.user.id,
      entries: [
        { owner: { ownerType: 'SYSTEM', systemKey: 'TEST_MARKET_TREASURY' }, amount: -1000n, allowNegative: true },
        { owner: { ownerType: 'USER', userId: buyer.user.id }, amount: 1000n },
      ],
    })
    const created = await client(manager).post(`/api/problems/${problemId}/data-products`).send({
      revisionId, qualitySnapshotId: snapshotId, updatePolicy: 'UPDATE_90D',
      allowedLicenses: ['PERSONAL', 'ORGANIZATION', 'CONTEST'], includes: { checker: false, std: false },
      grade: 'COMPETITION_GRADE', priceCarits: 1,
    })
    expect(created.status).toBe(201)
    expect(created.body.data.grade).toBe('VERIFIED')
    expect(Object.fromEntries(created.body.data.Prices.map((item: any) => [item.licenseType, item.amountCarits]))).toEqual({ PERSONAL: '90', ORGANIZATION: '180', CONTEST: '270' })
    productId = created.body.data.id
  })

  it('uses only the server price, posts one balanced ledger transaction, and grants one immutable revision idempotently', async () => {
    const unsupported = await client(manager).post(`/api/problems/${problemId}/data-products`).send({
      revisionId, qualitySnapshotId: snapshotId, updatePolicy: 'SNAPSHOT',
      allowedLicenses: ['PERSONAL'], includes: { testdata: true, std: true },
    })
    expect(unsupported.status).toBe(422)
    expect(unsupported.body.code).toBe('DATA_PRODUCT_INCLUDE_UNSUPPORTED')
    const requestId = crypto.randomUUID()
    const rejected = await client(buyer).post(`/api/data-products/${productId}/purchase`).set('Idempotency-Key', requestId).send({ license: 'PERSONAL', amountCarits: 1 })
    expect(rejected.status).toBe(422)
    expect(rejected.body.code).toBe('CLIENT_PRICE_FORBIDDEN')

    const purchased = await client(buyer).post(`/api/data-products/${productId}/purchase`).set('Idempotency-Key', requestId).send({ license: 'PERSONAL' })
    expect(purchased.status).toBe(201)
    expect(purchased.body.data.amountCarits).toBe('90')
    expect(purchased.body.data.qualityCertificateSnapshot.quality.overallScore).toBe(92)
    const entitlementId = purchased.body.data.Entitlement.id as string
    expect(purchased.body.data.Entitlement.Revisions).toEqual([expect.objectContaining({ testSetRevisionId: revisionId, sequence: 1, grantReason: 'PURCHASE' })])

    const replay = await client(buyer).post(`/api/data-products/${productId}/purchase`).set('Idempotency-Key', requestId).send({ license: 'PERSONAL' })
    expect(replay.status).toBe(201)
    expect(replay.body.data.id).toBe(purchased.body.data.id)
    expect(await prisma.dataPurchase.count({ where: { idempotencyKey: requestId } })).toBe(1)
    const transaction = await prisma.caritsTransaction.findUniqueOrThrow({ where: { id: purchased.body.data.caritsTransactionId }, include: { Entries: true } })
    expect(transaction.Entries.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(0n)
    expect(transaction.Entries.map(entry => entry.amount).sort((a, b) => Number(a - b))).toEqual([-90n, 90n])

    const manifest = await client(buyer).get(`/api/data-entitlements/${entitlementId}/revisions/${revisionId}/manifest`)
    expect(manifest.status).toBe(200)
    expect(manifest.body.data).toMatchObject({ entitlementId, revision: { id: revisionId }, qualityCertificate: { overallScore: 92 } })
    expect(manifest.body.data.qualityCertificate.holdoutCoverage).toBeCloseTo(0.88)
    expect(manifest.body.data.qualityCertificate.evidence).toBeUndefined()
    expect(manifest.body.data.judgeConfig).toBeUndefined()
    const entitlementDetail = await client(buyer).get(`/api/data-entitlements/${entitlementId}`)
    expect(entitlementDetail.body.data.Revisions[0].TestSetRevision.judgeConfig).toBeUndefined()
    expect(entitlementDetail.body.data.Revisions[0].TestSetRevision.testdataPath).toBeUndefined()
    const entitlementList = await client(buyer).get('/api/data-entitlements')
    const productDetail = await client(buyer).get(`/api/data-products/${productId}`)
    const productList = await client(buyer).get('/api/data-products')
    for (const payload of [purchased.body.data, entitlementDetail.body.data, entitlementList.body.data, manifest.body.data, productDetail.body.data, productList.body.data]) {
      const serialized = JSON.stringify(payload)
      for (const forbidden of ['"evidence"', '"evaluationCoverage"', '"evaluationJobId"', '"corpusRevisionId"', '"inputHash"', '"createdBy"', '"storageKey"', '"testdataPath"']) {
        expect(serialized).not.toContain(forbidden)
      }
    }
    expect((await client(outsider).get(`/api/data-entitlements/${entitlementId}/revisions/${revisionId}/manifest`)).status).toBe(404)
  })

  it('binds CONTEST licenses to Training(type=contest) and excludes ordinary participants', async () => {
    const team = await prisma.team.create({ data: { id: crypto.randomUUID(), name: 'Licensed contest team', scope: 'personal', isPublic: false } })
    await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: buyer.user.id, userType: 'student', role: 'owner', status: 'active' } })
    await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: outsider.user.id, userType: 'student', role: 'member', status: 'active' } })
    const practice = await prisma.training.create({ data: { title: 'Practice', type: 'training', scope: 'personal', teamId: team.id, startTime: new Date(), endTime: new Date(Date.now() + 3600_000), status: 'upcoming', createdBy: buyer.user.id } })
    const rejected = await client(buyer).post(`/api/data-products/${productId}/purchase`).set('Idempotency-Key', crypto.randomUUID()).send({ license: 'CONTEST', contestId: practice.id })
    expect(rejected.status).toBe(403)

    const contest = await prisma.training.create({ data: { title: 'Real contest', type: 'contest', scope: 'personal', teamId: team.id, startTime: new Date(), endTime: new Date(Date.now() + 3600_000), status: 'upcoming', createdBy: buyer.user.id } })
    const purchased = await client(buyer).post(`/api/data-products/${productId}/purchase`).set('Idempotency-Key', crypto.randomUUID()).send({ license: 'CONTEST', contestId: contest.id })
    expect(purchased.status).toBe(201)
    const entitlementId = purchased.body.data.Entitlement.id as string
    expect((await client(outsider).get(`/api/data-entitlements/${entitlementId}`)).status).toBe(404)
    expect((await client(outsider).get(`/api/data-entitlements/${entitlementId}/revisions/${revisionId}/manifest`)).status).toBe(404)
  })

  it('restricts organization entitlements to active teachers and principals', async () => {
    const teacher = await createTestUser({ role: 'teacher' })
    const student = await createTestUser({ role: 'student', schoolId: teacher.schoolId })
    const organizationId = (await prisma.school.findUniqueOrThrow({ where: { id: teacher.schoolId } })).organizationId!
    await postCarits({
      type: 'test_funding', idempotencyKey: `market-org-funding:${crypto.randomUUID()}`,
      referenceType: 'test', referenceId: organizationId, operatorUserId: manager.user.id,
      entries: [
        { owner: { ownerType: 'SYSTEM', systemKey: 'TEST_MARKET_TREASURY' }, amount: -500n, allowNegative: true },
        { owner: { ownerType: 'ORGANIZATION', organizationId }, amount: 500n },
      ],
    })
    const purchased = await client(teacher).post(`/api/data-products/${productId}/purchase`).set('Idempotency-Key', crypto.randomUUID()).send({ license: 'ORGANIZATION', organizationId })
    expect(purchased.status).toBe(201)
    const entitlementId = purchased.body.data.Entitlement.id as string
    expect((await client(student).get(`/api/data-entitlements/${entitlementId}`)).status).toBe(404)
    expect((await client(student).get(`/api/data-entitlements/${entitlementId}/revisions/${revisionId}/manifest`)).status).toBe(404)
  })

  it('suspends sales on a critical incident, preserves the certificate, and appends a free repair grant', async () => {
    const purchase = await client(buyer).post(`/api/data-products/${productId}/purchase`).set('Idempotency-Key', crypto.randomUUID()).send({ license: 'PERSONAL' })
    const purchaseId = purchase.body.data.id as string
    const entitlementId = purchase.body.data.Entitlement.id as string
    const certificateBefore = (await prisma.dataPurchase.findUniqueOrThrow({ where: { id: purchaseId } })).qualityCertificateSnapshot
    const incident = await client(manager).post('/api/test-set-quality-incidents').send({
      revisionId, severity: 'CRITICAL', type: 'CHECKER_BYPASS',
      description: 'Checker accepts a known invalid output and invalidates this revision.', evidence: { report: 'regression-1' },
    })
    expect(incident.status).toBe(201)
    expect((await prisma.dataProduct.findUniqueOrThrow({ where: { id: productId } })).status).toBe('SUSPENDED')
    const historicalDetail = await client(outsider).get(`/api/data-products/${productId}`)
    expect(historicalDetail.status).toBe(200)
    expect(historicalDetail.body.data.status).toBe('SUSPENDED')
    expect((await client(outsider).get('/api/data-products')).body.data.map((item: any) => item.id)).not.toContain(productId)
    expect((await client(outsider).post(`/api/data-products/${productId}/purchase`).set('Idempotency-Key', crypto.randomUUID()).send({ license: 'PERSONAL' })).status).toBe(409)
    expect((await prisma.dataPurchase.findUniqueOrThrow({ where: { id: purchaseId } })).qualityCertificateSnapshot).toEqual(certificateBefore)
    expect(await prisma.userNotification.count({ where: { userId: buyer.user.id, sourceId: incident.body.data.id } })).toBe(1)

    const fixed = await createQualityRevision(2, 'COMPETITION')
    const resolved = await client(manager).post(`/api/test-set-quality-incidents/${incident.body.data.id}/resolve`).send({ fixedByRevisionId: fixed.revision.id })
    expect(resolved.status).toBe(200)
    const grants = await prisma.dataEntitlementRevision.findMany({ where: { entitlementId }, orderBy: { sequence: 'asc' } })
    expect(grants).toEqual([
      expect.objectContaining({ sequence: 1, testSetRevisionId: revisionId, grantReason: 'PURCHASE' }),
      expect.objectContaining({ sequence: 2, testSetRevisionId: fixed.revision.id, grantReason: 'CRITICAL_FIX', sourceIncidentId: incident.body.data.id }),
    ])
  })
})
