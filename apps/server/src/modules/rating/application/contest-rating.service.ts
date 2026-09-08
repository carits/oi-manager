import crypto from 'node:crypto'
import { Prisma, RatingScope, RatingTrack } from '@prisma/client'
import { prisma } from '../../../prisma'
import { canAccessTraining, canManageTraining } from '../../training/training.helpers'
import { buildStanding, type ScoringParticipant, type ScoringSubmission } from '../domain/contest-scoring'
import { calculateMultiElo, RATING_ALGORITHM } from '../domain/multi-elo'

export class ContestRatingError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message) }
}

function fail(statusCode: number, code: string, message: string): never { throw new ContestRatingError(statusCode, code, message) }
function hash(value: unknown) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }

export function trackForFormat(format: string): RatingTrack {
  if (format === 'oi') return 'OI'
  if (format === 'ioi') return 'IOI'
  if (format === 'icpc' || format === 'acm') return 'ACM'
  fail(422, 'RATING_SCORING_MODE_UNSUPPORTED', '该比赛赛制暂不支持 Rating')
}

export function defaultScoringRules(track: RatingTrack) {
  if (track === 'OI') return { version: 1, problemPolicy: 'LAST_SUBMISSION', tiePolicy: 'SCORE', judgeMaxScore: 100 }
  if (track === 'IOI') return { version: 1, problemPolicy: 'BEST_SUBMISSION', tiePolicy: 'SCORE', judgeMaxScore: 100 }
  return { version: 1, wrongPenaltySeconds: 1200, penaltyVerdicts: ['WA', 'PE', 'TLE', 'MLE', 'RE', 'OLE'], compileErrorPenalty: false, ratingTiePolicy: 'SOLVED_PENALTY' }
}

async function requireContest(trainingId: number) {
  const training = await prisma.training.findUnique({ where: { id: trainingId }, include: { RatingConfig: true, Team: { select: { organizationId: true } } } })
  if (!training || training.type !== 'contest') fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  return training
}

function configDto(config: any, training: any) {
  const track = trackForFormat(training.format)
  return config ? {
    id: config.id, scope: config.scope, track: config.track, weight: config.weightBasisPoints / 10_000,
    algorithmCode: config.algorithmCode, algorithmVersion: config.algorithmVersion,
    organizationMinParticipants: config.organizationMinParticipants,
    globalMinParticipants: config.globalMinParticipants, scoringRules: config.scoringRules,
    rulesHash: config.rulesHash, revision: config.revision, lockedAt: config.lockedAt,
    editable: !config.lockedAt && new Date() < training.startTime,
  } : {
    scope: 'NONE', track, weight: 1, algorithmCode: RATING_ALGORITHM.code,
    algorithmVersion: RATING_ALGORITHM.version, organizationMinParticipants: 5,
    globalMinParticipants: 20, scoringRules: defaultScoringRules(track),
    revision: 0, lockedAt: null, editable: new Date() < training.startTime,
  }
}

export async function getContestRatingConfig(trainingId: number, userId: string) {
  const training = await requireContest(trainingId)
  if (!await canAccessTraining(userId, training)) fail(403, 'CONTEST_ACCESS_DENIED', '无权限查看比赛 Rating 配置')
  return configDto(training.RatingConfig, training)
}

async function assertScopePermission(userId: string, scope: RatingScope) {
  if (!['GLOBAL', 'BOTH'].includes(scope)) return
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user || !['super_admin', 'platform_admin'].includes(user.role)) fail(403, 'GLOBAL_RATING_MANAGE_DENIED', '只有平台管理员可以启用全局 Rating')
}

async function assertNoOverlap(client: Prisma.TransactionClient, training: any, scope: RatingScope, track: RatingTrack) {
  if (scope === 'NONE') return
  const candidates = await client.trainingRatingConfig.findMany({
    where: {
      trainingId: { not: training.id }, track, scope: { not: 'NONE' },
      Training: { type: 'contest', startTime: { lt: training.endTime }, endTime: { gt: training.startTime } },
    },
    include: { Training: { select: { id: true, title: true, organizationId: true, Team: { select: { organizationId: true } } } } },
  })
  const organizationId = training.organizationId || training.Team?.organizationId || null
  const conflict = candidates.find(item => {
    const globalConflict = ['GLOBAL', 'BOTH'].includes(scope) && ['GLOBAL', 'BOTH'].includes(item.scope)
    const otherOrg = item.Training.organizationId || item.Training.Team?.organizationId || null
    const organizationConflict = ['ORGANIZATION', 'BOTH'].includes(scope) && ['ORGANIZATION', 'BOTH'].includes(item.scope) && organizationId && otherOrg === organizationId
    return globalConflict || organizationConflict
  })
  if (conflict) fail(409, 'RATED_CONTEST_OVERLAP', `同一 Rating 池已有时间重叠的比赛：${conflict.Training.title}`)
}

export async function updateContestRatingConfig(trainingId: number, userId: string, body: any) {
  const training = await requireContest(trainingId)
  if (!await canManageTraining(userId, training)) fail(403, 'CONTEST_MANAGE_DENIED', '只有比赛管理员可以配置 Rating')
  if (training.RatingConfig?.lockedAt || new Date() >= training.startTime) fail(409, 'RATING_CONFIG_FROZEN', '比赛开始后 Rating 配置永久冻结')
  const scope = String(body.scope || 'NONE').toUpperCase() as RatingScope
  if (!Object.values(RatingScope).includes(scope)) fail(422, 'RATING_SCOPE_INVALID', 'Rating 范围无效')
  await assertScopePermission(userId, scope)
  const track = trackForFormat(training.format)
  if (body.track && String(body.track).toUpperCase() !== track) fail(422, 'RATING_TRACK_MISMATCH', 'Rating Track 必须与比赛赛制一致')
  const weight = Number(body.weight ?? 1)
  const maxWeight = ['GLOBAL', 'BOTH'].includes(scope) ? 1 : 1
  if (!Number.isFinite(weight) || weight < 0.1 || weight > maxWeight) fail(422, 'RATING_WEIGHT_INVALID', 'Rating 权重必须在 0.1～1.0 之间')
  const organizationMinParticipants = Number(body.organizationMinParticipants ?? 5)
  const globalMinParticipants = Number(body.globalMinParticipants ?? 20)
  if (!Number.isInteger(organizationMinParticipants) || organizationMinParticipants < 2 || !Number.isInteger(globalMinParticipants) || globalMinParticipants < 2) fail(422, 'RATING_MINIMUM_INVALID', '最低参赛人数必须是不小于 2 的整数')
  const scoringRules = defaultScoringRules(track)
  const rulesHash = hash({ track, scoringRules })
  const expectedRevision = Number(body.expectedRevision ?? training.RatingConfig?.revision ?? 0)
  const config = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-config:${trainingId}`}, 0)) IS NULL AS locked`
    const current = await tx.trainingRatingConfig.findUnique({ where: { trainingId } })
    if (['GLOBAL', 'BOTH'].includes(scope) || current && ['GLOBAL', 'BOTH'].includes(current.scope)) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-schedule:GLOBAL:${track}`}, 0)) IS NULL AS locked`
    }
    if (['ORGANIZATION', 'BOTH'].includes(scope) || current && ['ORGANIZATION', 'BOTH'].includes(current.scope)) {
      const organizationId = training.organizationId || training.Team?.organizationId || 'unassigned'
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-schedule:ORGANIZATION:${organizationId}:${track}`}, 0)) IS NULL AS locked`
    }
    if ((current?.revision ?? 0) !== expectedRevision) fail(409, 'RATING_CONFIG_STALE', 'Rating 配置已被其他管理员修改，请刷新后重试')
    await assertNoOverlap(tx, training, scope, track)
    return current
      ? tx.trainingRatingConfig.update({ where: { id: current.id }, data: { scope, track, weightBasisPoints: Math.round(weight * 10_000), organizationMinParticipants, globalMinParticipants, scoringRules, rulesHash, revision: { increment: 1 } } })
      : tx.trainingRatingConfig.create({ data: { id: crypto.randomUUID(), trainingId, scope, track, weightBasisPoints: Math.round(weight * 10_000), organizationMinParticipants, globalMinParticipants, scoringRules, rulesHash, createdBy: userId } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return configDto(config, training)
}

export async function lockContestRatingConfigTx(tx: Prisma.TransactionClient, trainingId: number, actorUserId: string, format: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-config:${trainingId}`}, 0)) IS NULL AS locked`
  const existing = await tx.trainingRatingConfig.findUnique({ where: { trainingId } })
  if (existing?.lockedAt) return existing
  const track = trackForFormat(format)
  const now = new Date()
  return existing
    ? tx.trainingRatingConfig.update({ where: { id: existing.id }, data: { lockedAt: now } })
    : tx.trainingRatingConfig.create({ data: { id: crypto.randomUUID(), trainingId, scope: 'NONE', track, scoringRules: defaultScoringRules(track), rulesHash: hash({ track, scoringRules: defaultScoringRules(track) }), createdBy: actorUserId, lockedAt: now } })
}

async function organizationSnapshotTx(tx: Prisma.TransactionClient, training: any, userId: string) {
  const fixed = training.organizationId || training.Team?.organizationId || null
  if (fixed) return fixed
  const memberships = await tx.organizationMembership.findMany({ where: { userId, status: 'active' }, orderBy: { createdAt: 'asc' }, select: { organizationId: true } })
  return memberships.length === 1 ? memberships[0].organizationId : null
}

export async function lockRatingParticipantTx(tx: Prisma.TransactionClient, training: any, userId: string, submittedAt = new Date()) {
  if (training.type !== 'contest') return
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-participant:${training.id}:${userId}`}, 0)) IS NULL AS locked`
  await lockContestRatingConfigTx(tx, training.id, userId, training.format)
  const organizationIdSnapshot = await organizationSnapshotTx(tx, training, userId)
  const existing = await tx.trainingParticipant.findFirst({ where: { trainingId: training.id, userId }, orderBy: { joinedAt: 'asc' } })
  if (existing) {
    await tx.trainingParticipant.update({ where: { id: existing.id }, data: {
      ratingStatus: existing.ratingStatus === 'EXCLUDED' ? 'EXCLUDED' : 'RATING_LOCKED',
      organizationIdSnapshot: existing.organizationIdSnapshot || organizationIdSnapshot,
      firstSubmissionAt: existing.firstSubmissionAt || submittedAt,
      ratingLockedAt: existing.ratingLockedAt || submittedAt,
    } })
    return
  }
  await tx.trainingParticipant.create({ data: { id: crypto.randomUUID(), trainingId: training.id, userId, userType: 'student', organizationIdSnapshot, ratingStatus: 'RATING_LOCKED', firstSubmissionAt: submittedAt, ratingLockedAt: submittedAt } })
}

async function currentSubmissionRows(tx: Prisma.TransactionClient, training: any): Promise<ScoringSubmission[]> {
  const rows = await tx.submission.findMany({
    where: { trainingId: training.id, submitScope: 'contest', submitMethod: { not: 'archive' }, createdAt: { lte: training.endTime } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true, trainingProblemId: true, result: true, score: true, createdAt: true, submissionPhase: true, CurrentJudgeRun: { select: { status: true, result: true, score: true } } },
  })
  return rows.map(row => ({
    id: row.id, userId: row.userId, trainingProblemId: row.trainingProblemId, createdAt: row.createdAt, submissionPhase: row.submissionPhase,
    result: row.CurrentJudgeRun?.status === 'FINALIZED' ? row.CurrentJudgeRun.result || row.result : row.CurrentJudgeRun?.status === 'CANCELLED' ? row.CurrentJudgeRun.result || 'judge_failed' : row.CurrentJudgeRun ? 'judging' : row.result,
    score: row.CurrentJudgeRun?.status === 'FINALIZED' ? row.CurrentJudgeRun.score : row.score,
  }))
}

async function buildStandingSnapshotTx(tx: Prisma.TransactionClient, training: any, config: any, actorUserId: string) {
  const submissions = await currentSubmissionRows(tx, training)
  const participants = await normalizeParticipantsTx(tx, training, submissions)
  const excludedManagers = await excludedManagerIdsTx(tx, training)
  const scoringParticipants: ScoringParticipant[] = participants
    .filter(item => !excludedManagers.has(item.userId) && item.ratingStatus !== 'NO_SHOW')
    .map(item => ({
      userId: item.userId,
      organizationIdSnapshot: item.organizationIdSnapshot,
      disposition: item.ratingDisposition,
      ratingLocked: item.ratingStatus === 'RATING_LOCKED',
    }))
  const entries = buildStanding({
    track: config.track,
    startTime: training.startTime,
    problems: training.TrainingProblem,
    submissions,
    participants: scoringParticipants,
  })
  const previous = await tx.contestStandingSnapshot.findFirst({
    where: { trainingId: training.id, status: 'FINALIZED' },
    orderBy: { revision: 'desc' },
  })
  const inputHash = hash({
    trainingId: training.id,
    rulesHash: config.rulesHash,
    submissions: submissions.map(item => [item.id, item.result, item.score]),
    participants: scoringParticipants,
    entries,
  })
  if (previous?.inputHash === inputHash) return previous
  const snapshot = await tx.contestStandingSnapshot.create({
    data: {
      id: crypto.randomUUID(),
      trainingId: training.id,
      revision: (previous?.revision || 0) + 1,
      scoringMode: config.track,
      rulesHash: config.rulesHash,
      status: 'FINALIZED',
      inputHash,
      createdBy: actorUserId,
      finalizedAt: new Date(),
      Entries: { create: entries.map(entry => ({ id: crypto.randomUUID(), ...entry })) },
    },
  })
  if (previous) await tx.contestStandingSnapshot.update({
    where: { id: previous.id },
    data: { status: 'SUPERSEDED', supersededAt: new Date() },
  })
  return snapshot
}

async function normalizeParticipantsTx(tx: Prisma.TransactionClient, training: any, submissions: ScoringSubmission[]) {
  const firstByUser = new Map<string, Date>()
  for (const submission of submissions) if (!firstByUser.has(submission.userId)) firstByUser.set(submission.userId, submission.createdAt)
  for (const [userId, submittedAt] of firstByUser) await lockRatingParticipantTx(tx, training, userId, submittedAt)
  await tx.trainingParticipant.updateMany({ where: { trainingId: training.id, ratingStatus: 'REGISTERED', userId: { notIn: [...firstByUser.keys()] } }, data: { ratingStatus: 'NO_SHOW' } })
  return tx.trainingParticipant.findMany({ where: { trainingId: training.id }, orderBy: { joinedAt: 'asc' } })
}

async function excludedManagerIdsTx(tx: Prisma.TransactionClient, training: any) {
  if (training.includeAdminInRanking) return new Set<string>()
  const ids = new Set<string>([training.createdBy])
  if (training.teamId) {
    const members = await tx.teamMember.findMany({ where: { teamId: training.teamId, status: 'active', role: { in: ['owner', 'admin'] } }, select: { userId: true } })
    members.forEach(item => ids.add(item.userId))
  }
  if (training.organizationId) {
    const members = await tx.organizationMembership.findMany({ where: { organizationId: training.organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } }, select: { userId: true } })
    members.forEach(item => ids.add(item.userId))
  }
  const admins = await tx.user.findMany({ where: { role: { in: ['super_admin', 'platform_admin'] } }, select: { id: true } })
  admins.forEach(item => ids.add(item.id))
  return ids
}

async function ensurePoolTx(tx: Prisma.TransactionClient, scopeType: Extract<RatingScope, 'GLOBAL' | 'ORGANIZATION'>, organizationId: string | null, track: RatingTrack) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-pool:${scopeType}:${organizationId || 'global'}:${track}`}, 0)) IS NULL AS locked`
  const existing = await tx.ratingPool.findFirst({ where: { scopeType, organizationId, track } })
  return existing || tx.ratingPool.create({ data: { id: crypto.randomUUID(), scopeType, organizationId, track } })
}

async function createAndApplyBatchTx(tx: Prisma.TransactionClient, input: {
  training: any; config: any; snapshot: any; scopeType: Extract<RatingScope, 'GLOBAL' | 'ORGANIZATION'>; organizationId: string | null; entries: any[]; minimum: number
}) {
  const pool = await ensurePoolTx(tx, input.scopeType, input.organizationId, input.config.track)
  const eligible = input.entries.filter(entry => entry.ratingEligible && (input.scopeType === 'GLOBAL' || entry.organizationIdSnapshot === input.organizationId))
  const inputHash = hash({ poolId: pool.id, snapshotId: input.snapshot.id, users: eligible.map(entry => [entry.userId, entry.rank, entry.ratingTieGroup]) })
  if (eligible.length < input.minimum) return tx.ratingBatch.create({ data: { id: crypto.randomUUID(), trainingId: input.training.id, poolId: pool.id, standingSnapshotId: input.snapshot.id, algorithmCode: input.config.algorithmCode, algorithmVersion: input.config.algorithmVersion, fieldSize: eligible.length, status: 'SKIPPED', inputHash, sequenceAt: input.training.endTime, skipReason: 'NOT_ENOUGH_PARTICIPANTS', calculatedAt: new Date(), appliedAt: new Date() } })
  const accounts = []
  for (const entry of eligible) accounts.push(await tx.ratingAccount.upsert({ where: { poolId_userId: { poolId: pool.id, userId: entry.userId } }, update: {}, create: { id: crypto.randomUUID(), poolId: pool.id, userId: entry.userId, rating: pool.baseRating, peakRating: pool.baseRating } }))
  const accountByUser = new Map(accounts.map(account => [account.userId, account]))
  const changes = calculateMultiElo(eligible.map(entry => ({ userId: entry.userId, rating: accountByUser.get(entry.userId)!.rating, tieGroup: entry.ratingTieGroup, rank: entry.rank })), { scale: pool.scale, kFactor: pool.kFactor, weightBasisPoints: input.config.weightBasisPoints })
  const batch = await tx.ratingBatch.create({ data: { id: crypto.randomUUID(), trainingId: input.training.id, poolId: pool.id, standingSnapshotId: input.snapshot.id, algorithmCode: input.config.algorithmCode, algorithmVersion: input.config.algorithmVersion, fieldSize: eligible.length, status: 'CALCULATING', inputHash, sequenceAt: input.training.endTime } })
  for (const change of changes) {
    const account = accountByUser.get(change.userId)!
    await tx.ratingChange.create({ data: { id: crypto.randomUUID(), batchId: batch.id, accountId: account.id, userId: change.userId, ratingBefore: change.ratingBefore, expectedPerformance: change.expectedPerformance, actualPerformance: change.actualPerformance, rank: change.rank, fieldSize: eligible.length, rawDelta: change.rawDelta, appliedDelta: change.appliedDelta, ratingAfter: change.ratingAfter } })
    await tx.ratingAccount.update({ where: { id: account.id }, data: { rating: change.ratingAfter, peakRating: Math.max(account.peakRating, change.ratingAfter), ratedContestCount: { increment: 1 }, provisional: account.ratedContestCount + 1 < 5, lastRatedAt: input.training.endTime, version: { increment: 1 } } })
  }
  return tx.ratingBatch.update({ where: { id: batch.id }, data: { status: 'APPLIED', calculatedAt: new Date(), appliedAt: new Date() } })
}

export async function finalizeContestRating(trainingId: number, userId: string) {
  const training = await requireContest(trainingId)
  if (!await canManageTraining(userId, training)) fail(403, 'CONTEST_MANAGE_DENIED', '只有比赛管理员可以完成最终结算')
  if (new Date() <= training.endTime && training.status !== 'finished') fail(409, 'CONTEST_NOT_ENDED', '比赛结束后才能生成最终榜单')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-finalize:${trainingId}`}, 0)) IS NULL AS locked`
    const locked = await tx.training.findUniqueOrThrow({ where: { id: trainingId }, include: { RatingConfig: true, Team: { select: { organizationId: true } }, TrainingProblem: { orderBy: { orderIndex: 'asc' }, select: { id: true, points: true } } } })
    if (locked.finalizationStatus === 'FINALIZED' && locked.finalizedStandingId) return loadContestRatingTx(tx, trainingId)
    const activeRuns = await tx.judgeRun.count({ where: { status: { in: ['QUEUED', 'RUNNING'] }, Submission: { trainingId, submitScope: 'contest' } } })
    if (activeRuns > 0) fail(409, 'CONTEST_JUDGING_INCOMPLETE', `仍有 ${activeRuns} 个评测任务未完成`)
    await tx.training.update({ where: { id: trainingId }, data: { finalizationStatus: 'FINALIZING' } })
    const config = await lockContestRatingConfigTx(tx, trainingId, userId, locked.format)
    const snapshot = await buildStandingSnapshotTx(tx, locked, config, userId)
    const persistedEntries = await tx.contestStandingEntry.findMany({ where: { snapshotId: snapshot.id }, orderBy: [{ rank: 'asc' }, { userId: 'asc' }] })
    if (config.scope === 'GLOBAL' || config.scope === 'BOTH') await createAndApplyBatchTx(tx, { training: locked, config, snapshot, scopeType: 'GLOBAL', organizationId: null, entries: persistedEntries, minimum: config.globalMinParticipants })
    if (config.scope === 'ORGANIZATION' || config.scope === 'BOTH') {
      const organizations = [...new Set(persistedEntries.map(item => item.organizationIdSnapshot).filter(Boolean))] as string[]
      const fallback = locked.organizationId || locked.Team?.organizationId
      if (!organizations.length && fallback) organizations.push(fallback)
      for (const organizationId of organizations) await createAndApplyBatchTx(tx, { training: locked, config, snapshot, scopeType: 'ORGANIZATION', organizationId, entries: persistedEntries, minimum: config.organizationMinParticipants })
    }
    await tx.training.update({ where: { id: trainingId }, data: { finalizationStatus: 'FINALIZED', finalizedStandingId: snapshot.id, status: 'finished' } })
    return loadContestRatingTx(tx, trainingId)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}

/**
 * Rebuild a finalized contest after an explicit rejudge. The operation creates a
 * new immutable standing and replays every affected pool from its base rating.
 * Existing batches and changes are retained as SUPERSEDED audit history.
 */
export async function rebuildContestRating(trainingId: number, userId: string) {
  const training = await requireContest(trainingId)
  if (!await canManageTraining(userId, training)) fail(403, 'CONTEST_MANAGE_DENIED', '只有比赛管理员可以申请 Rating 重放')
  if (!training.finalizedStandingId) fail(409, 'CONTEST_NOT_FINALIZED', '比赛尚未生成最终榜单')
  if (training.finalizationStatus === 'FINALIZED') return getContestRating(trainingId, userId)
  if (training.finalizationStatus !== 'HELD') fail(409, 'CONTEST_REBUILD_NOT_READY', '只有赛后重测完成并进入待重放状态后才能重放 Rating')
  const activeRuns = await prisma.judgeRun.count({ where: { status: { in: ['QUEUED', 'RUNNING'] }, Submission: { trainingId, submitScope: 'contest' } } })
  if (activeRuns > 0) fail(409, 'CONTEST_JUDGING_INCOMPLETE', `仍有 ${activeRuns} 个评测任务未完成`)
  const affectedPools = await prisma.ratingBatch.findMany({
    where: { trainingId, status: { in: ['APPLIED', 'SKIPPED'] } },
    select: { poolId: true, Pool: { select: { scopeType: true } } },
  })
  if (affectedPools.some(item => item.Pool.scopeType === 'GLOBAL')) {
    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (!actor || !['super_admin', 'platform_admin'].includes(actor.role)) {
      fail(403, 'GLOBAL_RATING_REBUILD_DENIED', '全局 Rating 重放需要平台管理员执行')
    }
  }

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-rebuild:${trainingId}`}, 0)) IS NULL AS locked`
    const locked = await tx.training.findUniqueOrThrow({
      where: { id: trainingId },
      include: {
        RatingConfig: true,
        Team: { select: { organizationId: true } },
        TrainingProblem: { orderBy: { orderIndex: 'asc' }, select: { id: true, points: true } },
      },
    })
    const config = locked.RatingConfig || await lockContestRatingConfigTx(tx, trainingId, userId, locked.format)
    const newSnapshot = await buildStandingSnapshotTx(tx, locked, config, userId)
    const poolIds = [...new Set(affectedPools.map(item => item.poolId))]
    const report: Array<{ poolId: string; replayed: number; participants: number }> = []

    for (const poolId of poolIds) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-pool:${poolId}`}, 0)) IS NULL AS locked`
      const pool = await tx.ratingPool.findUniqueOrThrow({ where: { id: poolId } })
      const oldBatches = await tx.ratingBatch.findMany({
        where: { poolId, status: { in: ['APPLIED', 'SKIPPED'] } },
        orderBy: [{ sequenceAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        include: {
          Training: { include: { RatingConfig: true } },
          StandingSnapshot: { include: { Entries: { orderBy: [{ rank: 'asc' }, { userId: 'asc' }] } } },
        },
      })
      const accountRows = await tx.ratingAccount.findMany({ where: { poolId } })
      const accountByUser = new Map(accountRows.map(account => [account.userId, account]))
      const state = new Map(accountRows.map(account => [account.userId, {
        rating: pool.baseRating,
        peak: pool.baseRating,
        count: 0,
        lastRatedAt: null as Date | null,
      }]))
      await tx.ratingBatch.updateMany({
        where: { id: { in: oldBatches.map(batch => batch.id) } },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      })
      let changedParticipants = 0

      for (const old of oldBatches) {
        const snapshot = old.trainingId === trainingId
          ? await tx.contestStandingSnapshot.findUniqueOrThrow({
            where: { id: newSnapshot.id },
            include: { Entries: { orderBy: [{ rank: 'asc' }, { userId: 'asc' }] } },
          })
          : old.StandingSnapshot
        const eligible = snapshot.Entries.filter(entry => entry.ratingEligible && (
          pool.scopeType === 'GLOBAL' || entry.organizationIdSnapshot === pool.organizationId
        ))
        const ratingConfig = old.Training.RatingConfig
        const minimum = pool.scopeType === 'GLOBAL'
          ? ratingConfig?.globalMinParticipants ?? 20
          : ratingConfig?.organizationMinParticipants ?? 5
        const batchRevision = old.batchRevision + 1
        const replayInputHash = hash({
          poolId,
          snapshotId: snapshot.id,
          users: eligible.map(entry => [entry.userId, entry.rank, entry.ratingTieGroup]),
          replayOf: old.id,
        })
        if (eligible.length < minimum) {
          await tx.ratingBatch.create({ data: {
            id: crypto.randomUUID(), trainingId: old.trainingId, poolId,
            standingSnapshotId: snapshot.id, algorithmCode: old.algorithmCode,
            algorithmVersion: old.algorithmVersion, batchRevision, fieldSize: eligible.length,
            status: 'SKIPPED', inputHash: replayInputHash, sequenceAt: old.sequenceAt,
            skipReason: 'NOT_ENOUGH_PARTICIPANTS', calculatedAt: new Date(), appliedAt: new Date(),
            supersedesBatchId: old.id,
          } })
          continue
        }
        for (const entry of eligible) {
          if (!accountByUser.has(entry.userId)) {
            const account = await tx.ratingAccount.create({ data: {
              id: crypto.randomUUID(), poolId, userId: entry.userId,
              rating: pool.baseRating, peakRating: pool.baseRating,
            } })
            accountByUser.set(entry.userId, account)
            state.set(entry.userId, { rating: pool.baseRating, peak: pool.baseRating, count: 0, lastRatedAt: null })
          }
        }
        const changes = calculateMultiElo(eligible.map(entry => ({
          userId: entry.userId,
          rating: state.get(entry.userId)!.rating,
          tieGroup: entry.ratingTieGroup,
          rank: entry.rank,
        })), {
          scale: pool.scale,
          kFactor: pool.kFactor,
          weightBasisPoints: ratingConfig?.weightBasisPoints ?? 10_000,
        })
        const newBatch = await tx.ratingBatch.create({ data: {
          id: crypto.randomUUID(), trainingId: old.trainingId, poolId,
          standingSnapshotId: snapshot.id, algorithmCode: old.algorithmCode,
          algorithmVersion: old.algorithmVersion, batchRevision, fieldSize: eligible.length,
          status: 'APPLIED', inputHash: replayInputHash, sequenceAt: old.sequenceAt,
          calculatedAt: new Date(), appliedAt: new Date(), supersedesBatchId: old.id,
        } })
        for (const change of changes) {
          const account = accountByUser.get(change.userId)!
          await tx.ratingChange.create({ data: {
            id: crypto.randomUUID(), batchId: newBatch.id, accountId: account.id,
            userId: change.userId, ratingBefore: change.ratingBefore,
            expectedPerformance: change.expectedPerformance,
            actualPerformance: change.actualPerformance, rank: change.rank,
            fieldSize: eligible.length, rawDelta: change.rawDelta,
            appliedDelta: change.appliedDelta, ratingAfter: change.ratingAfter,
          } })
          const current = state.get(change.userId)!
          current.rating = change.ratingAfter
          current.peak = Math.max(current.peak, change.ratingAfter)
          current.count++
          current.lastRatedAt = old.sequenceAt
          changedParticipants++
        }
      }
      for (const [userId, account] of accountByUser) {
        const current = state.get(userId) || { rating: pool.baseRating, peak: pool.baseRating, count: 0, lastRatedAt: null }
        await tx.ratingAccount.update({ where: { id: account.id }, data: {
          rating: current.rating,
          peakRating: current.peak,
          ratedContestCount: current.count,
          provisional: current.count < 5,
          lastRatedAt: current.lastRatedAt,
          version: { increment: 1 },
        } })
      }
      report.push({ poolId, replayed: oldBatches.length, participants: changedParticipants })
      await tx.ratingRebuildJob.create({ data: {
        id: crypto.randomUUID(), poolId, fromTrainingId: trainingId,
        status: 'completed', requestedBy: userId, report,
        startedAt: new Date(), completedAt: new Date(),
      } })
    }
    await tx.training.update({ where: { id: trainingId }, data: {
      finalizedStandingId: newSnapshot.id,
      finalizationStatus: 'FINALIZED',
    } })
    return { ...(await loadContestRatingTx(tx, trainingId)), rebuild: report }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 })
}

async function loadContestRatingTx(tx: Prisma.TransactionClient, trainingId: number) {
  const training = await tx.training.findUniqueOrThrow({
    where: { id: trainingId },
    include: {
      RatingConfig: true,
      FinalizedStanding: {
        include: {
          Entries: { orderBy: [{ rank: 'asc' }, { userId: 'asc' }] },
          RatingBatches: { include: { Pool: true, Changes: true } },
        },
      },
    },
  })
  const users = await tx.user.findMany({ where: { id: { in: training.FinalizedStanding?.Entries.map(item => item.userId) || [] } }, select: { id: true, username: true, avatar: true } })
  const userMap = new Map(users.map(user => [user.id, user]))
  return { finalizationStatus: training.finalizationStatus, config: configDto(training.RatingConfig, training), standing: training.FinalizedStanding ? { id: training.FinalizedStanding.id, revision: training.FinalizedStanding.revision, finalizedAt: training.FinalizedStanding.finalizedAt, entries: training.FinalizedStanding.Entries.map(entry => ({ ...entry, totalScore: entry.totalScore === null ? null : Number(entry.totalScore), user: userMap.get(entry.userId) })) } : null, batches: training.FinalizedStanding?.RatingBatches.map(batch => ({ id: batch.id, scope: batch.Pool.scopeType, organizationId: batch.Pool.organizationId, track: batch.Pool.track, status: batch.status, fieldSize: batch.fieldSize, skipReason: batch.skipReason, changes: batch.Changes })) || [] }
}

export async function getContestRating(trainingId: number, userId: string) {
  const training = await requireContest(trainingId)
  if (!await canAccessTraining(userId, training)) fail(403, 'CONTEST_ACCESS_DENIED', '无权限查看比赛 Rating')
  return prisma.$transaction(tx => loadContestRatingTx(tx, trainingId))
}

export async function setFinalSubmission(trainingId: number, trainingProblemId: string, submissionId: number, userId: string) {
  const training = await requireContest(trainingId)
  if (training.format !== 'oi') fail(422, 'FINAL_SUBMISSION_UNSUPPORTED', '只有 OI 最终提交制支持手动指定最终提交')
  if (new Date() > training.endTime) fail(409, 'CONTEST_ENDED', '比赛结束后不能更改最终提交')
  const submission = await prisma.submission.findFirst({ where: { id: submissionId, userId, trainingId, trainingProblemId, submitScope: 'contest', submitMethod: { not: 'archive' } } })
  if (!submission) fail(404, 'SUBMISSION_NOT_FOUND', '提交不存在或不属于当前比赛题目')
  await prisma.$transaction(async tx => {
    await tx.submission.updateMany({ where: { userId, trainingId, trainingProblemId, submissionPhase: 'FINAL' }, data: { submissionPhase: null } })
    await tx.submission.update({ where: { id: submissionId }, data: { submissionPhase: 'FINAL' } })
  })
  return { submissionId, trainingProblemId, policy: 'MANUAL_FINAL_SUBMISSION' }
}
