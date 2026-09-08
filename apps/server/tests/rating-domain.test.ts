import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { calculateMultiElo } from '../src/modules/rating/domain/multi-elo'
import { buildStanding } from '../src/modules/rating/domain/contest-scoring'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('Carits Multi-player Elo V1', () => {
  it('is balanced, deterministic and tie aware', () => {
    const result = calculateMultiElo([
      { userId: 'a', rating: 1500, rank: 1, tieGroup: 'score:100' },
      { userId: 'b', rating: 1500, rank: 2, tieGroup: 'score:80' },
      { userId: 'c', rating: 1500, rank: 2, tieGroup: 'score:80' },
      { userId: 'd', rating: 1500, rank: 4, tieGroup: 'score:0' },
    ])
    expect(result.map(item => item.appliedDelta)).toEqual([48, 0, 0, -48])
    expect(result.reduce((sum, item) => sum + item.appliedDelta, 0)).toBe(0)
    expect(result[1].actualPerformance).toBe(result[2].actualPerformance)
  })

  it('gives a strong favorite a smaller reward for winning', () => {
    const result = calculateMultiElo([
      { userId: 'favorite', rating: 2200, rank: 1, tieGroup: '1' },
      { userId: 'challenger', rating: 1400, rank: 2, tieGroup: '2' },
    ])
    expect(result[0].appliedDelta).toBeGreaterThanOrEqual(0)
    expect(result[0].appliedDelta).toBeLessThan(2)
    expect(result[1].appliedDelta).toBe(-result[0].appliedDelta)
  })
})

describe('contest scoring adapters', () => {
  const participants = [
    { userId: 'a', organizationIdSnapshot: 'org', disposition: 'NORMAL' as const, ratingLocked: true },
    { userId: 'b', organizationIdSnapshot: 'org', disposition: 'NORMAL' as const, ratingLocked: true },
  ]
  const problems = [{ id: 'p', points: 150 }]
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute))

  it('uses last submission for OI and best submission for IOI', () => {
    const submissions = [
      { id: 1, userId: 'a', trainingProblemId: 'p', result: 'wrong_answer', score: 80, createdAt: at(10), submissionPhase: null },
      { id: 2, userId: 'a', trainingProblemId: 'p', result: 'wrong_answer', score: 40, createdAt: at(20), submissionPhase: null },
      { id: 3, userId: 'b', trainingProblemId: 'p', result: 'wrong_answer', score: 60, createdAt: at(15), submissionPhase: null },
    ]
    expect(buildStanding({ track: 'OI', startTime: at(0), problems, submissions, participants })[0]).toMatchObject({ userId: 'b', totalScore: 90 })
    expect(buildStanding({ track: 'IOI', startTime: at(0), problems, submissions, participants })[0]).toMatchObject({ userId: 'a', totalScore: 120 })
  })

  it('applies ACM penalty only to solved problems and excludes CE', () => {
    const submissions = [
      { id: 1, userId: 'a', trainingProblemId: 'p', result: 'compile_error', score: 0, createdAt: at(10), submissionPhase: null },
      { id: 2, userId: 'a', trainingProblemId: 'p', result: 'wrong_answer', score: 0, createdAt: at(20), submissionPhase: null },
      { id: 3, userId: 'a', trainingProblemId: 'p', result: 'accepted', score: 100, createdAt: at(30), submissionPhase: null },
      { id: 4, userId: 'b', trainingProblemId: 'p', result: 'wrong_answer', score: 0, createdAt: at(5), submissionPhase: null },
    ]
    const rows = buildStanding({ track: 'ACM', startTime: at(0), problems, submissions, participants })
    expect(rows[0]).toMatchObject({ userId: 'a', solvedCount: 1, penaltySeconds: 3000 })
    expect(rows[1]).toMatchObject({ userId: 'b', solvedCount: 0, penaltySeconds: 0 })
  })

  it('keeps an audited result out of rating and forces a sanctioned participant to last place', () => {
    const rows = buildStanding({
      track: 'IOI', startTime: at(0), problems,
      submissions: [
        { id: 1, userId: 'a', trainingProblemId: 'p', result: 'accepted', score: 100, createdAt: at(10), submissionPhase: null },
        { id: 2, userId: 'b', trainingProblemId: 'p', result: 'wrong_answer', score: 10, createdAt: at(10), submissionPhase: null },
        { id: 3, userId: 'c', trainingProblemId: 'p', result: 'wrong_answer', score: 50, createdAt: at(10), submissionPhase: null },
      ],
      participants: [
        { ...participants[0], disposition: 'FORCE_LAST' },
        { ...participants[1], disposition: 'NORMAL' },
        { userId: 'c', organizationIdSnapshot: 'org', disposition: 'KEEP_RESULT', ratingLocked: true },
      ],
    })
    expect(rows.map(row => row.userId)).toEqual(['c', 'b', 'a'])
    expect(rows[0].ratingEligible).toBe(false)
    expect(rows[2]).toMatchObject({ rank: 3, ratingEligible: true, participantDisposition: 'FORCE_LAST' })
  })
})

describe('rating domain HTTP and persistence', () => {
  let organizationId: string
  let manager: Awaited<ReturnType<typeof createTestUser>>
  let first: Awaited<ReturnType<typeof createTestUser>>
  let second: Awaited<ReturnType<typeof createTestUser>>
  let managerToken: string

  beforeEach(async () => {
    const school = (await createTestSchoolWithPrincipal(`Rating ${crypto.randomUUID()}`)).school
    organizationId = school.organizationId!
    manager = await createTestUser({ role: 'school_principal', schoolId: school.id })
    first = await createTestUser({ role: 'student', schoolId: school.id })
    second = await createTestUser({ role: 'student', schoolId: school.id })
    managerToken = generateTestToken({ userId: manager.user.id, username: manager.user.username, role: manager.user.role, schoolId: school.id, teacherId: manager.teacherId })
  })

  async function createFinishedContest() {
    const problem = await prisma.problem.create({ data: { id: crypto.randomUUID(), platform: 'carits', problemId: `RATING_${crypto.randomUUID()}`, title: 'Rating test', ownerId: manager.user.id, visibility: 'public', libraryScope: 'platform', libraryKey: 'platform', status: 'published', publishedAt: new Date() } })
    const contest = await prisma.training.create({ data: { title: 'Rated IOI contest', format: 'ioi', type: 'contest', scope: 'campus', organizationId, startTime: new Date(Date.now() - 7200_000), endTime: new Date(Date.now() - 3600_000), status: 'finished', finalizationStatus: 'JUDGING', createdBy: manager.user.id } })
    const trainingProblem = await prisma.trainingProblem.create({ data: { id: crypto.randomUUID(), trainingId: contest.id, problemId: problem.id, alias: 'A', orderIndex: 0, points: 100 } })
    await prisma.trainingRatingConfig.create({ data: { id: crypto.randomUUID(), trainingId: contest.id, scope: 'ORGANIZATION', track: 'IOI', organizationMinParticipants: 2, globalMinParticipants: 2, scoringRules: { problemPolicy: 'BEST_SUBMISSION' }, rulesHash: 'fixture', createdBy: manager.user.id } })
    for (const [index, user] of [first, second].entries()) {
      await prisma.submission.create({ data: { userId: user.user.id, oj: 'carits', problemId: problem.problemId, problemInternalId: problem.id, language: 'cpp', code: 'int main(){}', codeLength: 12, result: index === 0 ? 'accepted' : 'wrong_answer', score: index === 0 ? 100 : 20, submitMethod: 'local', submitScope: 'contest', workspaceScope: 'campus', organizationId, trainingId: contest.id, trainingProblemId: trainingProblem.id, contestId: contest.id, contestProblemId: trainingProblem.id, createdAt: new Date(contest.startTime.getTime() + (index + 1) * 60_000) } })
    }
    return contest
  }

  it('finalizes one immutable standing and applies one organization batch idempotently', async () => {
    const contest = await createFinishedContest()
    const firstResponse = await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${contest.id}/finalize`)
    expect(firstResponse.status).toBe(200)
    expect(firstResponse.body.data.finalizationStatus).toBe('FINALIZED')
    expect(firstResponse.body.data.standing.entries.map((item: any) => item.userId)).toEqual([first.user.id, second.user.id])
    expect(firstResponse.body.data.batches).toHaveLength(1)
    expect(firstResponse.body.data.batches[0]).toMatchObject({ scope: 'ORGANIZATION', status: 'APPLIED', fieldSize: 2 })

    const again = await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${contest.id}/finalize`)
    expect(again.status).toBe(200)
    expect(await prisma.contestStandingSnapshot.count({ where: { trainingId: contest.id } })).toBe(1)
    expect(await prisma.ratingBatch.count({ where: { trainingId: contest.id } })).toBe(1)
    const accounts = await prisma.ratingAccount.findMany({ orderBy: { userId: 'asc' } })
    expect(accounts).toHaveLength(2)
    expect(accounts.reduce((sum, account) => sum + account.rating - 1500, 0)).toBe(0)
  })

  it('freezes config after the contest starts and rejects ordinary users from global rating', async () => {
    const future = await prisma.training.create({ data: { title: 'Future contest', format: 'oi', type: 'contest', scope: 'campus', organizationId, startTime: new Date(Date.now() + 3600_000), endTime: new Date(Date.now() + 7200_000), status: 'upcoming', createdBy: manager.user.id } })
    const global = await createAuthenticatedRequest(app, managerToken).put(`/api/trainings/${future.id}/rating-config`).send({ scope: 'GLOBAL', expectedRevision: 0 })
    expect(global.status).toBe(403)
    const organization = await createAuthenticatedRequest(app, managerToken).put(`/api/trainings/${future.id}/rating-config`).send({ scope: 'ORGANIZATION', expectedRevision: 0, organizationMinParticipants: 2 })
    expect(organization.status).toBe(200)
    await prisma.trainingRatingConfig.update({ where: { trainingId: future.id }, data: { lockedAt: new Date() } })
    const frozen = await createAuthenticatedRequest(app, managerToken).put(`/api/trainings/${future.id}/rating-config`).send({ scope: 'NONE', expectedRevision: 1 })
    expect(frozen.status).toBe(409)
    expect(frozen.body.code).toBe('RATING_CONFIG_FROZEN')
  })

  it('creates a new standing and superseding batch when a finalized contest is rebuilt', async () => {
    const contest = await createFinishedContest()
    const finalized = await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${contest.id}/finalize`)
    expect(finalized.status).toBe(200)
    const secondSubmission = await prisma.submission.findFirstOrThrow({ where: { trainingId: contest.id, userId: second.user.id } })
    await prisma.submission.update({ where: { id: secondSubmission.id }, data: { score: 100, result: 'accepted' } })
    await prisma.training.update({ where: { id: contest.id }, data: { finalizationStatus: 'HELD' } })

    const rebuilt = await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${contest.id}/rating/rebuild`)
    expect(rebuilt.status).toBe(200)
    expect(rebuilt.body.data.finalizationStatus).toBe('FINALIZED')
    expect(rebuilt.body.data.standing.revision).toBe(2)
    expect(await prisma.contestStandingSnapshot.count({ where: { trainingId: contest.id } })).toBe(2)
    expect(await prisma.ratingBatch.count({ where: { trainingId: contest.id, status: 'SUPERSEDED' } })).toBe(1)
    const active = await prisma.ratingBatch.findMany({ where: { trainingId: contest.id, status: 'APPLIED' }, include: { Changes: true } })
    expect(active).toHaveLength(1)
    expect(active[0].batchRevision).toBe(2)
    expect(active[0].Changes.every(change => change.appliedDelta === 0)).toBe(true)
  })
})
