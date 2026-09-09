import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestProblem } from './helpers/problemListHelpers'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'

const app = createTestApp()

describe('V1 Solution / Editorial Contribution Domain', () => {
  let author: Awaited<ReturnType<typeof createTestUser>>
  let reviewer: Awaited<ReturnType<typeof createTestUser>>
  let problem: Awaited<ReturnType<typeof createTestProblem>>
  let organizationId: string
  let testSetRevisionId: string

  beforeEach(async () => {
    author = await createTestUser({ role: 'teacher' })
    reviewer = await createTestUser({ role: 'school_principal', schoolId: author.schoolId })
    organizationId = (await prisma.school.findUniqueOrThrow({ where: { id: author.schoolId } })).organizationId!
    problem = await createTestProblem({ ownerId: author.user.id, title: 'Editorial domain problem' })
    await prisma.problem.update({ where: { id: problem.id }, data: {
      libraryScope: 'school', libraryKey: `organization:${organizationId}`, organizationId,
      description: '# Stable statement\nSolve the problem.',
      judgeConfig: 'type: default\nmode: acm\n',
    } })
    testSetRevisionId = crypto.randomUUID()
    await prisma.problemTestSetRevision.create({ data: {
      id: testSetRevisionId, problemId: problem.id, revisionNumber: 1,
      mode: 'acm', source: 'initial', judgeConfig: 'type: default\nmode: acm\n',
      judgeConfigHash: 'judge-hash-v1', graphHash: 'graph-hash-v1', testdataPath: '/test/editorial-v1',
      createdBy: author.user.id,
    } })
    await prisma.problem.update({ where: { id: problem.id }, data: { latestTestSetRevisionId: testSetRevisionId } })
  })

  function authorClient() {
    return createAuthenticatedRequest(app, generateTokenFromUser(author.user))
  }

  function reviewerClient() {
    return createAuthenticatedRequest(app, generateTokenFromUser(reviewer.user))
  }

  async function createFullContribution() {
    return authorClient().post(`/api/problems/${problem.id}/solution-contributions`).send({
      type: 'COMMUNITY_EDITORIAL', title: 'Dynamic programming editorial',
      summary: 'A complete proof and implementation.', approachKey: 'dynamic-programming',
      contentMarkdown: '# Idea\nWe define a state for every prefix.\n\n# Correctness\nInduction proves every transition is optimal and covers every feasible answer.\n\n# Implementation\nCompute states in increasing order.',
      algorithmTags: ['DP'], complexityTime: 'O(n)', complexityMemory: 'O(n)',
      language: 'cpp17', referenceCode: '#include <bits/stdc++.h>\nint main(){return 0;}',
      sourceType: 'ORIGINAL', licenseAccepted: true, organizationId,
      testSetRevisionId,
    })
  }

  async function finalizeVerification(contributionId: string, result = 'accepted', score = 100) {
    const verification = await prisma.solutionVerification.findFirstOrThrow({
      where: { ContributionRevision: { contributionId } }, include: { Submission: { include: { CurrentJudgeRun: true } } },
    })
    const run = verification.Submission!.CurrentJudgeRun!
    await prisma.$transaction([
      prisma.judgeRun.update({ where: { id: run.id }, data: { status: 'FINALIZED', result, score, finalizedAt: new Date() } }),
      prisma.submission.update({ where: { id: verification.submissionId! }, data: { result, score } }),
    ])
    return verification
  }

  it('freezes submitted snapshots, requires independent verified review, and publishes one rewarded version idempotently', async () => {
    const created = await createFullContribution()
    expect(created.status).toBe(201)
    const contributionId = created.body.data.id as string

    const submitted = await authorClient().post(`/api/solution-contributions/${contributionId}/submit`).send()
    expect(submitted.status).toBe(200)
    expect(submitted.body.data.status).toBe('AUTO_CHECKING')
    expect(submitted.body.data.Revisions).toHaveLength(1)
    const globalAdministrator = await createTestUser({ role: 'super_admin' })
    const ordinaryLedger = await createAuthenticatedRequest(app, generateTokenFromUser(globalAdministrator.user))
      .get('/api/submissions?pageSize=100')
    expect(ordinaryLedger.status).toBe(200)
    expect(ordinaryLedger.body.data.submissions).toEqual([])
    expect((await authorClient().patch(`/api/solution-contributions/${contributionId}`).send({ title: 'mutated' })).status).toBe(409)

    const selfReview = await authorClient().post(`/api/review/solution-contributions/${contributionId}/reviews`).send({ decision: 'APPROVE' })
    expect(selfReview.status).toBe(403)
    expect(selfReview.body.code).toBe('SOLUTION_SELF_REVIEW_FORBIDDEN')

    await finalizeVerification(contributionId)
    const refreshed = await authorClient().post(`/api/solution-contributions/${contributionId}/verification/refresh`).send()
    expect(refreshed.body.data.status).toBe('PASSED')
    expect((await prisma.solutionContribution.findUniqueOrThrow({ where: { id: contributionId } })).status).toBe('TECHNICALLY_VALID')

    const reviewed = await reviewerClient().post(`/api/review/solution-contributions/${contributionId}/reviews`).send({
      reviewType: 'CONTENT', decision: 'APPROVE', checklist: { correctness: true, completeness: true }, comment: 'Verified.',
    })
    expect(reviewed.status).toBe(201)
    expect((await reviewerClient().post(`/api/review/solution-contributions/${contributionId}/accept`).send()).status).toBe(200)
    const published = await reviewerClient().post(`/api/review/solution-contributions/${contributionId}/publish`).send({ visibilityPolicy: 'PUBLIC' })
    expect(published.status).toBe(201)
    expect(published.body.data.version).toBe(1)

    const replay = await reviewerClient().post(`/api/review/solution-contributions/${contributionId}/publish`).send({ visibilityPolicy: 'PUBLIC' })
    expect(replay.status).toBe(201)
    expect(replay.body.data.id).toBe(published.body.data.id)
    expect(await prisma.problemSolutionVersion.count()).toBe(1)
    const event = await prisma.contributionEvent.findFirstOrThrow({ where: { sourceType: 'problem_solution_version', sourceId: published.body.data.id } })
    expect(event).toMatchObject({ status: 'accepted', type: 'solution_published', score: 20, ruleCode: 'solution_reward', ruleVersion: 1 })
    expect(await prisma.contributionRewardDelivery.count({ where: { contributionId: event.id } })).toBe(1)
    expect(await prisma.organizationContributionAttribution.count({ where: { contributionId: event.id, organizationId } })).toBe(1)

    await expect(prisma.solutionReview.update({ where: { id: reviewed.body.data.id }, data: { comment: 'rewritten' } })).rejects.toThrow()
    await expect(prisma.problemSolutionVersion.update({ where: { id: published.body.data.id }, data: { contentMarkdown: 'rewritten' } })).rejects.toThrow()
  })

  it('turns a failed JudgeRun into NEEDS_REVISION and appends a new immutable submission snapshot', async () => {
    const created = await createFullContribution()
    const contributionId = created.body.data.id as string
    await authorClient().post(`/api/solution-contributions/${contributionId}/submit`).send()
    await finalizeVerification(contributionId, 'wrong_answer', 0)
    const refreshed = await authorClient().post(`/api/solution-contributions/${contributionId}/verification/refresh`).send()
    expect(refreshed.body.data.status).toBe('FAILED')
    expect((await prisma.solutionContribution.findUniqueOrThrow({ where: { id: contributionId } })).status).toBe('NEEDS_REVISION')

    expect((await authorClient().patch(`/api/solution-contributions/${contributionId}`).send({
      contentMarkdown: '# Idea\nA corrected state definition.\n\n# Correctness\nThe induction now handles the missing boundary and every transition.\n\n# Implementation\nCompute the corrected recurrence in order.',
      referenceCode: '#include <bits/stdc++.h>\nint main(){return 0;}',
    })).status).toBe(200)
    const resubmitted = await authorClient().post(`/api/solution-contributions/${contributionId}/resubmit`).send()
    expect(resubmitted.status).toBe(200)
    expect(resubmitted.body.data.Revisions.map((item: any) => item.revision)).toEqual([2, 1])
    expect(await prisma.solutionContributionRevision.count({ where: { contributionId } })).toBe(2)
  })

  it('serializes conflicting reviews and compare-and-swaps acceptance', async () => {
    const first = await createFullContribution()
    const firstId = first.body.data.id as string
    await authorClient().post(`/api/solution-contributions/${firstId}/submit`).send()
    await finalizeVerification(firstId)
    await authorClient().post(`/api/solution-contributions/${firstId}/verification/refresh`).send()
    const conflicting = await Promise.all([
      reviewerClient().post(`/api/review/solution-contributions/${firstId}/reviews`).send({ decision: 'APPROVE' }),
      reviewerClient().post(`/api/review/solution-contributions/${firstId}/reviews`).send({ decision: 'REQUEST_CHANGES', comment: 'Please revise this conflicting review outcome.' }),
    ])
    expect(conflicting.map(item => item.status).sort()).toEqual([201, 409])
    expect(await prisma.solutionReview.count({ where: { contributionId: firstId } })).toBe(1)

    const second = await createFullContribution()
    const secondId = second.body.data.id as string
    await authorClient().post(`/api/solution-contributions/${secondId}/submit`).send()
    await finalizeVerification(secondId)
    await authorClient().post(`/api/solution-contributions/${secondId}/verification/refresh`).send()
    await reviewerClient().post(`/api/review/solution-contributions/${secondId}/reviews`).send({ decision: 'APPROVE' })
    const accepted = await Promise.all([
      reviewerClient().post(`/api/review/solution-contributions/${secondId}/accept`).send(),
      reviewerClient().post(`/api/review/solution-contributions/${secondId}/accept`).send(),
    ])
    expect(accepted.map(item => item.status).sort()).toEqual([200, 409])
    expect((await prisma.solutionContribution.findUniqueOrThrow({ where: { id: secondId } })).status).toBe('ACCEPTED')
  })

  it('publishes an accepted correction as V2 while retaining the superseded V1 content', async () => {
    const created = await createFullContribution()
    const contributionId = created.body.data.id as string
    await authorClient().post(`/api/solution-contributions/${contributionId}/submit`).send()
    await finalizeVerification(contributionId)
    await authorClient().post(`/api/solution-contributions/${contributionId}/verification/refresh`).send()
    await reviewerClient().post(`/api/review/solution-contributions/${contributionId}/reviews`).send({ decision: 'APPROVE' })
    await reviewerClient().post(`/api/review/solution-contributions/${contributionId}/accept`).send()
    const first = await reviewerClient().post(`/api/review/solution-contributions/${contributionId}/publish`).send({ visibilityPolicy: 'MANAGER_ONLY' })

    const correction = await authorClient().post(`/api/solutions/${first.body.data.solutionId}/corrections`).send({
      title: 'Corrected complexity explanation',
      contentMarkdown: 'The prior complexity paragraph omitted the initialization cost; this complete replacement fixes it.',
      sourceType: 'ORIGINAL', licenseAccepted: true, organizationId, testSetRevisionId,
    })
    expect(correction.status).toBe(201)
    const correctionId = correction.body.data.id as string
    const submitted = await authorClient().post(`/api/solution-contributions/${correctionId}/submit`).send()
    expect(submitted.body.data.status).toBe('AUTO_CHECKING')
    await finalizeVerification(correctionId)
    const refreshed = await authorClient().post(`/api/solution-contributions/${correctionId}/verification/refresh`).send()
    expect(refreshed.body.data.status).toBe('PASSED')
    await reviewerClient().post(`/api/review/solution-contributions/${correctionId}/reviews`).send({ decision: 'APPROVE' })
    await reviewerClient().post(`/api/review/solution-contributions/${correctionId}/accept`).send()
    const second = await reviewerClient().post(`/api/review/solution-contributions/${correctionId}/publish`).send({ visibilityPolicy: 'PUBLIC' })
    expect(second.body.data.version).toBe(2)
    const versions = await prisma.problemSolutionVersion.findMany({ orderBy: { version: 'asc' } })
    expect(versions.map(item => [item.version, item.status])).toEqual([[1, 'SUPERSEDED'], [2, 'PUBLISHED']])
    expect(versions[0].contentMarkdown).toContain('# Idea')
    expect(versions.map(item => item.visibilityPolicy)).toEqual(['MANAGER_ONLY', 'PUBLIC'])
    const reader = await createTestUser({ role: 'student', schoolId: author.schoolId })
    const readerClient = createAuthenticatedRequest(app, generateTokenFromUser(reader.user))
    const publicCurrent = await readerClient.get(`/api/solutions/${first.body.data.solutionId}`)
      .set('X-OI-Organization-ID', organizationId)
    expect(publicCurrent.status).toBe(200)
    const listed = await readerClient.get(`/api/problems/${problem.id}/solutions`)
      .set('X-OI-Organization-ID', organizationId)
    for (const payload of [publicCurrent.body.data, listed.body.data]) {
      const serialized = JSON.stringify(payload)
      for (const forbidden of ['"judgeConfig"', '"testdataPath"', '"verificationId"', '"sourceContributionRevisionId"', '"contentHash"', '"statementSnapshotHash"', '"passwordHash"']) {
        expect(serialized).not.toContain(forbidden)
      }
    }
    expect((await readerClient.get(`/api/solutions/${first.body.data.solutionId}/versions/${first.body.data.id}`)
      .set('X-OI-Organization-ID', organizationId)).status).toBe(404)
  })
})
