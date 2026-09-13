import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { calculateMultiElo } from '../src/modules/rating/domain/multi-elo'
import { buildStanding } from '../src/modules/rating/domain/contest-scoring'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestSchoolWithPrincipal, createTestTeam, createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'
import { lockRatingParticipantTx, processDueContestRatings } from '../src/modules/rating/application/contest-rating.service'
import { ensureContestAggregateTx } from '../src/modules/contest/contest-aggregate.service'

const app = createTestApp()

async function createContestRuntimeFixture(args: Prisma.TrainingCreateArgs) {
  const runtime = await prisma.training.create(args)
  await prisma.$transaction(tx => ensureContestAggregateTx(tx, runtime.id))
  return runtime
}

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

  it('consumes the frozen ACM penalty rules instead of current code defaults', () => {
    const submissions = [
      { id: 1, userId: 'a', trainingProblemId: 'p', result: 'wrong_answer', score: 0, createdAt: at(5), submissionPhase: null },
      { id: 2, userId: 'a', trainingProblemId: 'p', result: 'accepted', score: 100, createdAt: at(30), submissionPhase: null },
    ]
    const rows = buildStanding({
      track: 'ACM', startTime: at(0), problems, submissions, participants,
      scoringRules: { version: 1, wrongPenaltySeconds: 900, penaltyVerdicts: ['WA'], compileErrorPenalty: false, ratingTiePolicy: 'SOLVED_PENALTY' },
    })
    expect(rows[0]).toMatchObject({ userId: 'a', solvedCount: 1, penaltySeconds: 2700 })
  })

  it('can replay a frozen best-submission score policy independent of the track default', () => {
    const submissions = [
      { id: 1, userId: 'a', trainingProblemId: 'p', result: 'wrong_answer', score: 80, createdAt: at(10), submissionPhase: null },
      { id: 2, userId: 'a', trainingProblemId: 'p', result: 'wrong_answer', score: 40, createdAt: at(20), submissionPhase: 'FINAL' },
    ]
    const [row] = buildStanding({
      track: 'OI', startTime: at(0), problems, submissions, participants: [participants[0]],
      scoringRules: { version: 1, problemPolicy: 'BEST_SUBMISSION', tiePolicy: 'SCORE', judgeMaxScore: 100 },
    })
    expect(row.totalScore).toBe(120)
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

  async function createFinishedContest(options: { title?: string; startHoursAgo?: number; endHoursAgo?: number } = {}) {
    const startHoursAgo = options.startHoursAgo ?? 2
    const endHoursAgo = options.endHoursAgo ?? 1
    const problem = await prisma.problem.create({ data: { id: crypto.randomUUID(), platform: 'carits', problemId: `RATING_${crypto.randomUUID()}`, title: 'Rating test', ownerId: manager.user.id, visibility: 'public', libraryScope: 'platform', libraryKey: 'platform', status: 'published', publishedAt: new Date() } })
    const contest = await createContestRuntimeFixture({ data: { title: options.title || 'Rated IOI contest', format: 'ioi', type: 'contest', scope: 'campus', organizationId, startTime: new Date(Date.now() - startHoursAgo * 3600_000), endTime: new Date(Date.now() - endHoursAgo * 3600_000), status: 'finished', finalizationStatus: 'JUDGING', createdBy: manager.user.id } })
    const trainingProblem = await prisma.trainingProblem.create({ data: { id: crypto.randomUUID(), trainingId: contest.id, problemId: problem.id, alias: 'A', orderIndex: 0, points: 100 } })
    await prisma.trainingRatingConfig.create({ data: { id: crypto.randomUUID(), trainingId: contest.id, scope: 'ORGANIZATION', track: 'IOI', organizationMinParticipants: 2, globalMinParticipants: 2, scoringRules: { problemPolicy: 'BEST_SUBMISSION' }, rulesHash: 'fixture', createdBy: manager.user.id } })
    for (const [index, user] of [first, second].entries()) {
      await prisma.submission.create({ data: { userId: user.user.id, oj: 'carits', problemId: problem.problemId, problemInternalId: problem.id, language: 'cpp', code: 'int main(){}', codeLength: 12, result: index === 0 ? 'accepted' : 'wrong_answer', score: index === 0 ? 100 : 20, submitMethod: 'local', submitScope: 'contest', workspaceScope: 'campus', organizationId, trainingId: contest.id, trainingProblemId: trainingProblem.id, contestId: contest.id, contestProblemId: trainingProblem.id, createdAt: new Date(contest.startTime.getTime() + (index + 1) * 60_000) } })
    }
    return contest
  }

  it('finalizes one immutable standing and applies one organization batch idempotently', async () => {
    const contest = await createFinishedContest()
    const firstResponse = await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${contest.id}/finalize`).set('X-OI-Organization-ID', organizationId)
    expect(firstResponse.status, JSON.stringify(firstResponse.body)).toBe(200)
    expect(firstResponse.body.data.finalizationStatus).toBe('FINALIZED')
    expect(firstResponse.body.data.standing.entries.map((item: any) => item.userId)).toEqual([first.user.id, second.user.id])
    expect(firstResponse.body.data.batches).toHaveLength(1)
    expect(firstResponse.body.data.batches[0]).toMatchObject({ scope: 'ORGANIZATION', status: 'APPLIED', fieldSize: 2 })

    const again = await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${contest.id}/finalize`).set('X-OI-Organization-ID', organizationId)
    expect(again.status).toBe(200)
    expect(await prisma.contestStandingSnapshot.count({ where: { trainingId: contest.id } })).toBe(1)
    expect(await prisma.ratingBatch.count({ where: { trainingId: contest.id } })).toBe(1)
    const accounts = await prisma.ratingAccount.findMany({ orderBy: { userId: 'asc' } })
    expect(accounts).toHaveLength(2)
    expect(accounts.reduce((sum, account) => sum + account.rating - 1500, 0)).toBe(0)
  })

  it('freezes config after the contest starts and rejects ordinary users from global rating', async () => {
    const future = await createContestRuntimeFixture({ data: { title: 'Future contest', format: 'oi', type: 'contest', scope: 'campus', organizationId, startTime: new Date(Date.now() + 3600_000), endTime: new Date(Date.now() + 7200_000), status: 'upcoming', createdBy: manager.user.id } })
    const global = await createAuthenticatedRequest(app, managerToken).put(`/api/trainings/${future.id}/rating-config`).set('X-OI-Organization-ID', organizationId).send({ scope: 'GLOBAL', expectedRevision: 0 })
    expect(global.status).toBe(403)
    const organization = await createAuthenticatedRequest(app, managerToken).put(`/api/trainings/${future.id}/rating-config`).set('X-OI-Organization-ID', organizationId).send({ scope: 'ORGANIZATION', expectedRevision: 0, organizationMinParticipants: 2 })
    expect(organization.status).toBe(200)
    await prisma.trainingRatingConfig.update({ where: { trainingId: future.id }, data: { lockedAt: new Date() } })
    const frozen = await createAuthenticatedRequest(app, managerToken).put(`/api/trainings/${future.id}/rating-config`).set('X-OI-Organization-ID', organizationId).send({ scope: 'NONE', expectedRevision: 1 })
    expect(frozen.status).toBe(409)
    expect(frozen.body.code).toBe('RATING_CONFIG_FROZEN')
  })

  it('rejects GLOBAL and BOTH for an organization contest even when the actor is a platform administrator', async () => {
    const platformAdmin = await createTestUser({ role: 'platform_admin' })
    const platformMembership = await prisma.organizationMembership.create({ data: {
      id: crypto.randomUUID(), organizationId, userId: platformAdmin.user.id,
      memberRole: 'teacher', relationType: 'employee', status: 'active', joinedAt: new Date(),
    } })
    await prisma.organizationMembershipRole.create({ data: {
      id: crypto.randomUUID(), membershipId: platformMembership.id, roleKey: 'teacher',
      source: 'test', grantedBy: manager.user.id,
    } })
    const platformToken = generateTestToken({ userId: platformAdmin.user.id, username: platformAdmin.user.username, role: platformAdmin.user.role })
    const future = await createContestRuntimeFixture({ data: { title: 'Organization-only rating contest', format: 'oi', type: 'contest', scope: 'campus', organizationId, startTime: new Date(Date.now() + 3600_000), endTime: new Date(Date.now() + 7200_000), status: 'upcoming', createdBy: platformAdmin.user.id } })

    for (const scope of ['GLOBAL', 'BOTH']) {
      const response = await createAuthenticatedRequest(app, platformToken).put(`/api/trainings/${future.id}/rating-config`).set('X-OI-Organization-ID', organizationId).send({ scope, expectedRevision: 0 })
      expect(response.status).toBe(422)
      expect(response.body.code).toBe('GLOBAL_RATING_CONTEST_SCOPE_INVALID')
    }

    const config = await createAuthenticatedRequest(app, platformToken).get(`/api/trainings/${future.id}/rating-config`).set('X-OI-Organization-ID', organizationId)
    expect(config.status, JSON.stringify(config.body)).toBe(200)
    expect(config.body.data).toMatchObject({ context: 'organization', allowedScopes: ['NONE', 'ORGANIZATION'] })
  })

  it('allows only NONE for a personal-team contest', async () => {
    const team = await createTestTeam({ schoolId: null, ownerId: manager.user.id, ownerType: 'teacher', scope: 'personal' })
    const future = await createContestRuntimeFixture({ data: { title: 'Personal team contest', format: 'icpc', type: 'contest', scope: 'personal', teamId: team.id, startTime: new Date(Date.now() + 3600_000), endTime: new Date(Date.now() + 7200_000), status: 'upcoming', createdBy: manager.user.id } })
    const personalToken = generateTestToken({ userId: manager.user.id, username: manager.user.username, role: manager.user.role })
    const config = await createAuthenticatedRequest(app, personalToken).get(`/api/trainings/${future.id}/rating-config`)
    expect(config.status, JSON.stringify(config.body)).toBe(200)
    expect(config.body.data).toMatchObject({ context: 'personal_team', allowedScopes: ['NONE'] })

    const response = await createAuthenticatedRequest(app, personalToken).put(`/api/trainings/${future.id}/rating-config`).send({ scope: 'ORGANIZATION', expectedRevision: 0 })
    expect(response.status).toBe(422)
    expect(response.body.code).toBe('TEAM_ACM_RATING_UNSUPPORTED')
  })

  it('requires and freezes an explicit organization snapshot for multi-organization BOTH participation', async () => {
    const otherSchool = (await createTestSchoolWithPrincipal(`Rating secondary ${crypto.randomUUID()}`)).school
    const otherOrganizationId = otherSchool.organizationId!
    for (const user of [first, second]) {
      await prisma.organizationMembership.create({ data: {
        id: crypto.randomUUID(), organizationId: otherOrganizationId, userId: user.user.id,
        memberRole: 'student', relationType: 'enrolled', status: 'active', joinedAt: new Date(),
      } })
    }
    const contest = await createContestRuntimeFixture({ data: {
      title: 'Platform BOTH contest', format: 'ioi', type: 'contest', scope: 'platform',
      startTime: new Date(Date.now() - 3600_000), endTime: new Date(Date.now() + 3600_000),
      status: 'ongoing', createdBy: manager.user.id,
    } })
    await prisma.trainingRatingConfig.create({ data: {
      id: crypto.randomUUID(), trainingId: contest.id, scope: 'BOTH', track: 'IOI',
      scoringRules: { problemPolicy: 'BEST_SUBMISSION' }, rulesHash: 'both-fixture', createdBy: manager.user.id,
    } })
    const firstToken = generateTestToken({ userId: first.user.id, username: first.user.username, role: first.user.role })

    const initial = await createAuthenticatedRequest(app, firstToken).get(`/api/trainings/${contest.id}/rating-participation`)
    expect(initial.status).toBe(200)
    expect(initial.body.data).toMatchObject({
      scope: 'BOTH', context: 'platform', selectedOrganizationId: null,
      requiresExplicitSelection: true, canChange: true, locked: false,
    })
    expect(initial.body.data.organizations.map((item: any) => item.id).sort()).toEqual([organizationId, otherOrganizationId].sort())

    const invalid = await createAuthenticatedRequest(app, firstToken).put(`/api/trainings/${contest.id}/rating-participation`).send({ organizationId: crypto.randomUUID() })
    expect(invalid.status).toBe(422)
    expect(invalid.body.code).toBe('RATING_ORGANIZATION_INVALID')

    const selected = await createAuthenticatedRequest(app, firstToken).put(`/api/trainings/${contest.id}/rating-participation`).send({ organizationId })
    expect(selected.status).toBe(200)
    expect(selected.body.data).toMatchObject({ selectedOrganizationId: organizationId, selectionPersisted: true, canChange: true })
    const changed = await createAuthenticatedRequest(app, firstToken).put(`/api/trainings/${contest.id}/rating-participation`).send({ organizationId: otherOrganizationId })
    expect(changed.status).toBe(200)
    expect(changed.body.data.selectedOrganizationId).toBe(otherOrganizationId)

    await prisma.$transaction(tx => lockRatingParticipantTx(tx, contest, first.user.id, new Date()))
    const participant = await prisma.trainingParticipant.findFirstOrThrow({ where: { trainingId: contest.id, userId: first.user.id } })
    expect(participant).toMatchObject({ organizationIdSnapshot: otherOrganizationId, ratingStatus: 'RATING_LOCKED' })
    expect(participant.firstSubmissionAt).not.toBeNull()

    const frozen = await createAuthenticatedRequest(app, firstToken).put(`/api/trainings/${contest.id}/rating-participation`).send({ organizationId })
    expect(frozen.status).toBe(409)
    expect(frozen.body.code).toBe('RATING_PARTICIPATION_FROZEN')

    await expect(prisma.$transaction(tx => lockRatingParticipantTx(tx, contest, second.user.id, new Date())))
      .rejects.toMatchObject({ code: 'RATING_ORGANIZATION_SELECTION_REQUIRED' })
    expect(await prisma.trainingParticipant.findFirst({ where: { trainingId: contest.id, userId: second.user.id } })).toBeNull()
  })

  it('allows GLOBAL participation without an organization and fixes organization contests automatically', async () => {
    const globalContest = await createContestRuntimeFixture({ data: {
      title: 'Platform GLOBAL contest', format: 'oi', type: 'contest', scope: 'platform',
      startTime: new Date(Date.now() - 3600_000), endTime: new Date(Date.now() + 3600_000),
      status: 'ongoing', createdBy: manager.user.id,
    } })
    await prisma.trainingRatingConfig.create({ data: {
      id: crypto.randomUUID(), trainingId: globalContest.id, scope: 'GLOBAL', track: 'OI',
      scoringRules: { problemPolicy: 'LAST_SUBMISSION' }, rulesHash: 'global-fixture', createdBy: manager.user.id,
    } })
    await prisma.$transaction(tx => lockRatingParticipantTx(tx, globalContest, first.user.id, new Date()))
    expect(await prisma.trainingParticipant.findFirst({ where: { trainingId: globalContest.id, userId: first.user.id } }))
      .toMatchObject({ organizationIdSnapshot: null, ratingStatus: 'RATING_LOCKED' })

    const organizationContest = await createContestRuntimeFixture({ data: {
      title: 'Fixed organization contest', format: 'oi', type: 'contest', scope: 'campus', organizationId,
      startTime: new Date(Date.now() - 3600_000), endTime: new Date(Date.now() + 3600_000),
      status: 'ongoing', createdBy: manager.user.id,
    } })
    await prisma.trainingRatingConfig.create({ data: {
      id: crypto.randomUUID(), trainingId: organizationContest.id, scope: 'ORGANIZATION', track: 'OI',
      scoringRules: { problemPolicy: 'LAST_SUBMISSION' }, rulesHash: 'organization-fixture', createdBy: manager.user.id,
    } })
    await prisma.$transaction(tx => lockRatingParticipantTx(tx, organizationContest, second.user.id, new Date()))
    expect(await prisma.trainingParticipant.findFirst({ where: { trainingId: organizationContest.id, userId: second.user.id } }))
      .toMatchObject({ organizationIdSnapshot: organizationId, ratingStatus: 'RATING_LOCKED' })
  })

  it('keeps Rating history private to the authenticated user', async () => {
    const firstToken = generateTestToken({ userId: first.user.id, username: first.user.username, role: first.user.role, schoolId: first.schoolId })
    const own = await createAuthenticatedRequest(app, firstToken).get(`/api/ratings/users/${first.user.id}/history?track=OI`)
    expect(own.status).toBe(200)

    const other = await createAuthenticatedRequest(app, firstToken).get(`/api/ratings/users/${second.user.id}/history?track=OI`)
    expect(other.status).toBe(403)
    expect(other.body.code).toBe('RATING_HISTORY_ACCESS_DENIED')
  })

  it('returns competition ranks across ties and preserves full-pool rank when filtering', async () => {
    const fourth = await createTestUser({ role: 'student', schoolId: (await prisma.school.findFirstOrThrow({ where: { organizationId } })).id })
    const pool = await prisma.ratingPool.create({ data: { id: crypto.randomUUID(), scopeType: 'GLOBAL', organizationId: null, track: 'OI' } })
    const rows = [
      [manager.user.id, 1700],
      [first.user.id, 1600],
      [second.user.id, 1600],
      [fourth.user.id, 1500],
    ] as const
    await prisma.ratingAccount.createMany({ data: rows.map(([userId, rating]) => ({ id: crypto.randomUUID(), poolId: pool.id, userId, rating, peakRating: rating })) })
    const firstToken = generateTestToken({ userId: first.user.id, username: first.user.username, role: first.user.role, schoolId: first.schoolId })

    const leaderboard = await createAuthenticatedRequest(app, firstToken).get('/api/ratings/global/OI')
    expect(leaderboard.status).toBe(200)
    expect(leaderboard.body.data.map((item: any) => item.rank)).toEqual([1, 2, 2, 4])

    const filtered = await createAuthenticatedRequest(app, firstToken).get(`/api/ratings/global/OI?q=${encodeURIComponent(fourth.user.username)}`)
    expect(filtered.status).toBe(200)
    expect(filtered.body.data).toHaveLength(1)
    expect(filtered.body.data[0]).toMatchObject({ userId: fourth.user.id, rank: 4 })
  })

  it('audits participant disposition and serializes it with finalization', async () => {
    const contest = await createFinishedContest()
    await prisma.trainingParticipant.createMany({ data: [first, second].map(user => ({
      id: crypto.randomUUID(), trainingId: contest.id, userId: user.user.id, userType: 'student',
      organizationIdSnapshot: organizationId, ratingStatus: 'RATING_LOCKED', firstSubmissionAt: new Date(), ratingLockedAt: new Date(),
    })) })

    const [disposition, finalization] = await Promise.all([
      createAuthenticatedRequest(app, managerToken).patch(`/api/trainings/${contest.id}/rating-participants/${second.user.id}`).set('X-OI-Organization-ID', organizationId).send({ disposition: 'EXCLUDE', reason: '竞赛纪律人工复核排除' }),
      createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${contest.id}/finalize`).set('X-OI-Organization-ID', organizationId),
    ])
    expect(finalization.status).toBe(200)
    expect([200, 409]).toContain(disposition.status)

    const participant = await prisma.trainingParticipant.findFirstOrThrow({ where: { trainingId: contest.id, userId: second.user.id } })
    const audit = await prisma.organizationAuditLog.findFirst({ where: { organizationId, action: 'contest_rating_participant_disposition_updated', targetUserId: second.user.id } })
    if (disposition.status === 200) {
      expect(participant.ratingDisposition).toBe('EXCLUDE')
      expect(audit).not.toBeNull()
    } else {
      expect(disposition.body.code).toBe('CONTEST_RATING_DISPOSITION_FROZEN')
      expect(participant.ratingDisposition).toBe('NORMAL')
      expect(audit).toBeNull()
    }
    expect((await prisma.training.findUniqueOrThrow({ where: { id: contest.id } })).finalizationStatus).toBe('FINALIZED')
  })

  it('automatically finalizes due rated contests and is idempotent', async () => {
    const contest = await createFinishedContest({ title: 'Scheduler-rated contest' })
    const firstRun = await processDueContestRatings()
    expect(firstRun).toMatchObject({ scanned: 1, finalized: 1, waiting: 0, failed: 0 })
    expect((await prisma.training.findUniqueOrThrow({ where: { id: contest.id } })).finalizationStatus).toBe('FINALIZED')
    expect(await prisma.contestStandingSnapshot.count({ where: { trainingId: contest.id } })).toBe(1)
    expect(await prisma.ratingBatch.count({ where: { trainingId: contest.id } })).toBe(1)

    const secondRun = await processDueContestRatings()
    expect(secondRun).toMatchObject({ scanned: 0, finalized: 0, waiting: 0, failed: 0 })
    expect(await prisma.contestStandingSnapshot.count({ where: { trainingId: contest.id } })).toBe(1)
    expect(await prisma.ratingBatch.count({ where: { trainingId: contest.id } })).toBe(1)
  })

  it('blocks a later contest until the earlier contest in the same pool is settled', async () => {
    const earlier = await createFinishedContest({ title: 'Earlier rated contest', startHoursAgo: 5, endHoursAgo: 4 })
    const later = await createFinishedContest({ title: 'Later rated contest', startHoursAgo: 3, endHoursAgo: 2 })

    const blocked = await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${later.id}/finalize`).set('X-OI-Organization-ID', organizationId)
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('EARLIER_RATED_CONTEST_PENDING')
    expect(await prisma.contestStandingSnapshot.count({ where: { trainingId: later.id } })).toBe(0)

    expect((await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${earlier.id}/finalize`).set('X-OI-Organization-ID', organizationId)).status).toBe(200)
    expect((await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${later.id}/finalize`).set('X-OI-Organization-ID', organizationId)).status).toBe(200)
    const batches = await prisma.ratingBatch.findMany({ where: { trainingId: { in: [earlier.id, later.id] } }, orderBy: { sequenceAt: 'asc' } })
    expect(batches).toHaveLength(2)
    expect(batches[0].trainingId).toBe(earlier.id)
    expect(batches[1].trainingId).toBe(later.id)
  })

  it('creates a new standing and superseding batch when a finalized contest is rebuilt', async () => {
    const contest = await createFinishedContest()
    const finalized = await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${contest.id}/finalize`).set('X-OI-Organization-ID', organizationId)
    expect(finalized.status).toBe(200)
    const secondSubmission = await prisma.submission.findFirstOrThrow({ where: { trainingId: contest.id, userId: second.user.id } })
    await prisma.submission.update({ where: { id: secondSubmission.id }, data: { score: 100, result: 'accepted' } })
    await prisma.training.update({ where: { id: contest.id }, data: { finalizationStatus: 'HELD' } })

    const rebuilt = await createAuthenticatedRequest(app, managerToken).post(`/api/trainings/${contest.id}/rating/rebuild`).set('X-OI-Organization-ID', organizationId)
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
