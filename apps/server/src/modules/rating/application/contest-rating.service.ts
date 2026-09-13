import crypto from 'node:crypto'
import { Prisma, RatingScope, RatingTrack } from '@prisma/client'
import { prisma } from '../../../prisma'
import { canAccessTraining, canManageTraining } from '../../training/training.helpers'
import { buildStanding, defaultScoringRules, normalizeScoringRules, type ScoringParticipant, type ScoringSubmission } from '../domain/contest-scoring'
import { calculateMultiElo, RATING_ALGORITHM } from '../domain/multi-elo'
import { findContestRuntimeForRating, listDueRatedContestRuntimes } from '../../contest/contest-query.facade'
import {
  beginContestFinalizationTx,
  completeContestFinalizationTx,
  completeContestRatingRebuildTx,
  failContestFinalizationTx,
} from '../../contest/contest-finalization-command.service'
import { resolveOrganizationAuthorizationsForOrganization } from '../../authorization/capabilities'

export class ContestRatingError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message) }
}

function fail(statusCode: number, code: string, message: string): never { throw new ContestRatingError(statusCode, code, message) }
function hash(value: unknown) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }

function isSerializableWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
}

async function withSerializableRetry<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeout?: number; maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        ...(options.timeout ? { timeout: options.timeout } : {}),
      })
    } catch (error) {
      if (!isSerializableWriteConflict(error) || attempt === maxAttempts) throw error
      // Re-open the complete transaction. Advisory locks are transaction scoped,
      // so the retry also re-acquires the contest lock before reading any state.
      await new Promise(resolve => setTimeout(resolve, attempt * 10))
    }
  }
  throw new Error('Serializable transaction retry exhausted')
}

export function trackForFormat(format: string): RatingTrack {
  if (format === 'oi') return 'OI'
  if (format === 'ioi') return 'IOI'
  if (format === 'icpc' || format === 'acm') return 'ACM'
  fail(422, 'RATING_SCORING_MODE_UNSUPPORTED', '该比赛赛制暂不支持 Rating')
}

export { defaultScoringRules } from '../domain/contest-scoring'

async function requireContest(trainingId: number) {
  const resolved = await findContestRuntimeForRating(trainingId)
  if (!resolved) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  return resolved.runtime
}

async function requireContestResolved(trainingId: number) {
  const resolved = await findContestRuntimeForRating(trainingId)
  if (!resolved) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  return resolved
}

async function canonicalContestIdTx(tx: Prisma.TransactionClient, runtimeTrainingId: number) {
  const contest = await tx.contest.findUnique({
    where: { runtimeTrainingId },
    select: { id: true },
  })
  if (!contest) fail(409, 'CONTEST_CANONICAL_IDENTITY_MISSING', '比赛缺少规范 Contest 身份，已拒绝写入 Rating 数据')
  return contest.id
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

function fixedOrganizationId(training: any): string | null {
  return training.organizationId || training.Team?.organizationId || null
}

function ratingContext(training: any): 'organization' | 'platform' | 'personal_team' {
  if (fixedOrganizationId(training)) return 'organization'
  if (training.teamId) return 'personal_team'
  return 'platform'
}

async function allowedScopesFor(userId: string, training: any): Promise<RatingScope[]> {
  // V1 never maps a team ACM result onto every member's personal ACM rating.
  if (training.teamId && ['icpc', 'acm'].includes(String(training.format).toLowerCase())) return ['NONE']
  const context = ratingContext(training)
  if (context === 'organization') return ['NONE', 'ORGANIZATION']
  if (context === 'personal_team') return ['NONE']
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user && ['super_admin', 'platform_admin'].includes(user.role)
    ? ['NONE', 'GLOBAL', 'BOTH']
    : ['NONE']
}

export async function getContestRatingConfig(trainingId: number, userId: string) {
  const training = await requireContest(trainingId)
  if (!await canAccessTraining(userId, training)) fail(403, 'CONTEST_ACCESS_DENIED', '无权限查看比赛 Rating 配置')
  return { ...configDto(training.RatingConfig, training), allowedScopes: await allowedScopesFor(userId, training), context: ratingContext(training) }
}

async function activeRatingOrganizations(client: Prisma.TransactionClient | typeof prisma, userId: string) {
  const memberships = await client.organizationMembership.findMany({
    where: {
      userId,
      status: 'active',
      Organization: {
        status: 'active',
        OR: [
          { type: { not: 'school' } },
          { School: { is: { status: 'active', directoryStatus: { not: 'legacy' } } } },
        ],
      },
    },
    select: {
      organizationId: true,
      Organization: { select: { name: true, School: { select: { name: true, shortName: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return memberships.map(membership => ({
    id: membership.organizationId,
    name: membership.Organization.School?.name || membership.Organization.name,
    shortName: membership.Organization.School?.shortName || null,
  }))
}

function participationDto(input: {
  training: any
  participant: any
  organizations: Array<{ id: string; name: string; shortName: string | null }>
  selectedOrganization?: { id: string; name: string; shortName: string | null } | null
}) {
  const fixedId = fixedOrganizationId(input.training)
  const scope = input.training.RatingConfig?.scope || 'NONE'
  const inferredSingleId = !fixedId && scope === 'BOTH' && input.organizations.length === 1
    ? input.organizations[0].id
    : null
  const selectedOrganizationId = fixedId || input.participant?.organizationIdSnapshot || inferredSingleId || null
  const locked = Boolean(input.participant?.ratingLockedAt || input.participant?.firstSubmissionAt || input.participant?.ratingStatus === 'RATING_LOCKED')
  return {
    scope,
    context: ratingContext(input.training),
    fixed: Boolean(fixedId),
    selectedOrganizationId,
    selectionPersisted: Boolean(fixedId || input.participant?.organizationIdSnapshot),
    selectedOrganization: input.selectedOrganization || input.organizations.find(item => item.id === selectedOrganizationId) || null,
    organizations: input.organizations,
    requiresExplicitSelection: !fixedId && scope === 'BOTH' && input.organizations.length > 1 && !input.participant?.organizationIdSnapshot,
    canChange: !fixedId && scope === 'BOTH' && !locked,
    locked,
    firstSubmissionAt: input.participant?.firstSubmissionAt || null,
  }
}

export async function getRatingParticipation(trainingId: number, userId: string) {
  const training = await requireContest(trainingId)
  if (!await canAccessTraining(userId, training)) fail(403, 'CONTEST_ACCESS_DENIED', '无权限查看比赛 Rating 参与信息')
  const [participant, organizations] = await Promise.all([
    prisma.trainingParticipant.findFirst({ where: { trainingId, userId }, orderBy: { joinedAt: 'asc' } }),
    activeRatingOrganizations(prisma, userId),
  ])
  const selectedId = fixedOrganizationId(training) || participant?.organizationIdSnapshot || null
  const selectedOrganization = selectedId && !organizations.some(item => item.id === selectedId)
    ? await prisma.organization.findUnique({ where: { id: selectedId }, select: { id: true, name: true, School: { select: { name: true, shortName: true } } } })
    : null
  return participationDto({
    training,
    participant,
    organizations,
    selectedOrganization: selectedOrganization ? {
      id: selectedOrganization.id,
      name: selectedOrganization.School?.name || selectedOrganization.name,
      shortName: selectedOrganization.School?.shortName || null,
    } : null,
  })
}

export async function updateRatingParticipation(trainingId: number, userId: string, body: any) {
  const training = await requireContest(trainingId)
  if (!await canAccessTraining(userId, training)) fail(403, 'CONTEST_ACCESS_DENIED', '无权限设置比赛 Rating 参与信息')
  const fixedId = fixedOrganizationId(training)
  const rawOrganizationId = body?.organizationId
  const organizationId = rawOrganizationId === null || rawOrganizationId === undefined || rawOrganizationId === ''
    ? null
    : String(rawOrganizationId)
  if (fixedId) {
    if (organizationId && organizationId !== fixedId) fail(422, 'RATING_ORGANIZATION_FIXED', '组织比赛的 Rating 归属由比赛固定，不能修改')
    return getRatingParticipation(trainingId, userId)
  }

  await withSerializableRetry(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-participant:${trainingId}:${userId}`}, 0)) IS NULL AS locked`
    const currentContest = await tx.contest.findUnique({
      where: { runtimeTrainingId: trainingId },
      include: {
        RatingConfig: true,
        RuntimeTraining: { include: { Team: { select: { organizationId: true } } } },
      },
    })
    if (!currentContest?.RuntimeTraining) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
    const currentTraining = { ...currentContest.RuntimeTraining, RatingConfig: currentContest.RatingConfig }
    if (currentTraining.RatingConfig?.scope !== 'BOTH' || ratingContext(currentTraining) !== 'platform') {
      fail(409, 'RATING_ORGANIZATION_SELECTION_NOT_APPLICABLE', '只有平台 BOTH Rating 比赛需要选择参赛组织')
    }
    const existing = await tx.trainingParticipant.findFirst({ where: { trainingId, userId }, orderBy: { joinedAt: 'asc' } })
    if (existing?.ratingLockedAt || existing?.firstSubmissionAt || existing?.ratingStatus === 'RATING_LOCKED') {
      fail(409, 'RATING_PARTICIPATION_FROZEN', '首次提交后参赛组织已固定，不能修改')
    }
    if (organizationId) {
      const organizations = await activeRatingOrganizations(tx, userId)
      if (!organizations.some(item => item.id === organizationId)) {
        fail(422, 'RATING_ORGANIZATION_INVALID', '只能选择当前账号的有效组织')
      }
    }
    if (existing) {
      await tx.trainingParticipant.update({
        where: { id: existing.id },
        data: { organizationIdSnapshot: organizationId, ratingStatus: 'REGISTERED' },
      })
    } else {
      await tx.trainingParticipant.create({
        data: { id: crypto.randomUUID(), trainingId, userId, userType: 'student', organizationIdSnapshot: organizationId, ratingStatus: 'REGISTERED' },
      })
    }
  })
  return getRatingParticipation(trainingId, userId)
}

async function assertScopePermission(userId: string, scope: RatingScope) {
  if (!['GLOBAL', 'BOTH'].includes(scope)) return
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user || !['super_admin', 'platform_admin'].includes(user.role)) fail(403, 'GLOBAL_RATING_MANAGE_DENIED', '只有平台管理员可以启用全局 Rating')
}

async function assertNoOverlap(client: Prisma.TransactionClient, training: any, scope: RatingScope, track: RatingTrack) {
  if (scope === 'NONE') return
  const candidates = await client.contest.findMany({
    where: {
      runtimeTrainingId: { not: training.id },
      startAt: { lt: training.endTime },
      endAt: { gt: training.startTime },
      RatingConfig: { is: { track, scope: { not: 'NONE' } } },
    },
    include: {
      RatingConfig: { select: { scope: true } },
      Team: { select: { organizationId: true } },
    },
  })
  const organizationId = training.organizationId || training.Team?.organizationId || null
  const conflict = candidates.find(item => {
    const candidateScope = item.RatingConfig?.scope || 'NONE'
    const globalConflict = ['GLOBAL', 'BOTH'].includes(scope) && ['GLOBAL', 'BOTH'].includes(candidateScope)
    const otherOrg = item.organizationId || item.Team?.organizationId || null
    const organizationConflict = ['ORGANIZATION', 'BOTH'].includes(scope) && ['ORGANIZATION', 'BOTH'].includes(candidateScope) && organizationId && otherOrg === organizationId
    return globalConflict || organizationConflict
  })
  if (conflict) fail(409, 'RATED_CONTEST_OVERLAP', `同一 Rating 池已有时间重叠的比赛：${conflict.title}`)
}

export async function updateContestRatingConfig(trainingId: number, userId: string, body: any) {
  const resolved = await requireContestResolved(trainingId)
  const training = resolved.runtime
  if (!await canManageTraining(userId, training)) fail(403, 'CONTEST_MANAGE_DENIED', '只有比赛管理员可以配置 Rating')
  if (training.RatingConfig?.lockedAt || new Date() >= training.startTime) fail(409, 'RATING_CONFIG_FROZEN', '比赛开始后 Rating 配置永久冻结')
  const scope = String(body.scope || 'NONE').toUpperCase() as RatingScope
  if (!Object.values(RatingScope).includes(scope)) fail(422, 'RATING_SCOPE_INVALID', 'Rating 范围无效')
  await assertScopePermission(userId, scope)
  const allowedScopes = await allowedScopesFor(userId, training)
  if (!allowedScopes.includes(scope)) {
    if (training.teamId && ['icpc', 'acm'].includes(String(training.format).toLowerCase())) fail(422, 'TEAM_ACM_RATING_UNSUPPORTED', '团队 ACM 赛 V1 不计个人 ACM Rating')
    if (ratingContext(training) === 'organization') fail(422, 'GLOBAL_RATING_CONTEST_SCOPE_INVALID', '组织比赛只能选择不计 Rating 或组织 Rating')
    if (ratingContext(training) === 'personal_team') fail(422, 'TEAM_RATING_UNSUPPORTED', '个人团队比赛首版不计个人 Rating')
    fail(422, 'ORGANIZATION_RATING_CONTEXT_REQUIRED', '平台比赛不能在没有明确组织归属的情况下仅计算组织 Rating')
  }
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
    const current = await tx.contestRatingConfig.findUnique({ where: { contestId: resolved.contest.id } })
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
      ? tx.contestRatingConfig.update({ where: { id: current.id }, data: { scope, track, weightBasisPoints: Math.round(weight * 10_000), organizationMinParticipants, globalMinParticipants, scoringRules, rulesHash, revision: { increment: 1 } } })
      : tx.contestRatingConfig.create({ data: { id: crypto.randomUUID(), contestId: resolved.contest.id, scope, track, weightBasisPoints: Math.round(weight * 10_000), organizationMinParticipants, globalMinParticipants, scoringRules, rulesHash, createdBy: userId } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { ...configDto(config, training), allowedScopes, context: ratingContext(training) }
}

export async function lockContestRatingConfigTx(tx: Prisma.TransactionClient, trainingId: number, actorUserId: string, format: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-config:${trainingId}`}, 0)) IS NULL AS locked`
  const contestId = await canonicalContestIdTx(tx, trainingId)
  const existing = await tx.contestRatingConfig.findUnique({ where: { contestId } })
  if (existing?.lockedAt) return existing
  const track = trackForFormat(format)
  const now = new Date()
  return existing
    ? tx.contestRatingConfig.update({ where: { id: existing.id }, data: { lockedAt: now } })
    : tx.contestRatingConfig.create({ data: { id: crypto.randomUUID(), contestId, scope: 'NONE', track, scoringRules: defaultScoringRules(track), rulesHash: hash({ track, scoringRules: defaultScoringRules(track) }), createdBy: actorUserId, lockedAt: now } })
}

async function organizationSnapshotTx(tx: Prisma.TransactionClient, training: any, userId: string, config: any, existing: any) {
  const fixed = training.organizationId || training.Team?.organizationId || null
  if (fixed) return fixed
  if (config.scope !== 'BOTH') return null
  const organizations = await activeRatingOrganizations(tx, userId)
  if (existing?.organizationIdSnapshot) {
    if (!organizations.some(item => item.id === existing.organizationIdSnapshot)) {
      fail(409, 'RATING_ORGANIZATION_SELECTION_INVALID', '已选参赛组织已不可用，请在提交前重新选择')
    }
    return existing.organizationIdSnapshot
  }
  if (organizations.length > 1) {
    fail(409, 'RATING_ORGANIZATION_SELECTION_REQUIRED', '你属于多个组织，请在首次提交前选择本场比赛的 Rating 归属组织')
  }
  return organizations[0]?.id || null
}

export async function lockRatingParticipantTx(tx: Prisma.TransactionClient, training: any, userId: string, submittedAt = new Date()) {
  if (training.type !== 'contest') return
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating-participant:${training.id}:${userId}`}, 0)) IS NULL AS locked`
  const config = await lockContestRatingConfigTx(tx, training.id, userId, training.format)
  const existing = await tx.trainingParticipant.findFirst({ where: { trainingId: training.id, userId }, orderBy: { joinedAt: 'asc' } })
  const organizationIdSnapshot = await organizationSnapshotTx(tx, training, userId, config, existing)
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
  const contestId = await canonicalContestIdTx(tx, training.id)
  const frozenRules = normalizeScoringRules(config.track, config.scoringRules)
  const computedRulesHash = hash({ track: config.track, scoringRules: frozenRules })
  if (/^[0-9a-f]{64}$/i.test(String(config.rulesHash || '')) && config.rulesHash !== computedRulesHash) {
    fail(409, 'RATING_SCORING_RULES_HASH_MISMATCH', '冻结的 Rating 计分规则与哈希不一致，已拒绝生成榜单')
  }
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
    scoringRules: frozenRules,
    startTime: training.startTime,
    problems: training.TrainingProblem,
    submissions,
    participants: scoringParticipants,
  })
  const previous = await tx.contestStandingSnapshot.findFirst({
    where: { contestId, status: 'FINALIZED' },
    orderBy: { revision: 'desc' },
  })
  const inputHash = hash({
    contestId,
    rulesHash: config.rulesHash,
    submissions: submissions.map(item => [item.id, item.result, item.score]),
    participants: scoringParticipants,
    entries,
  })
  if (previous?.inputHash === inputHash) return previous
  const snapshot = await tx.contestStandingSnapshot.create({
    data: {
      id: crypto.randomUUID(),
      contestId,
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
    const managers = await resolveOrganizationAuthorizationsForOrganization(training.organizationId, tx as any)
    managers.filter(item => item.capabilities.has('contest.manage')).forEach(item => ids.add(item.userId))
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

async function assertNoEarlierRatedContestPendingTx(tx: Prisma.TransactionClient, input: {
  training: any
  scopeType: Extract<RatingScope, 'GLOBAL' | 'ORGANIZATION'>
  organizationId: string | null
  track: RatingTrack
}) {
  const candidates = await tx.contest.findMany({
    where: {
      runtimeTrainingId: { not: input.training.id },
      endAt: { lt: input.training.endTime },
      finalizationStatus: { not: 'FINALIZED' },
      RatingConfig: { is: {
        track: input.track,
        scope: input.scopeType === 'GLOBAL' ? { in: ['GLOBAL', 'BOTH'] } : { in: ['ORGANIZATION', 'BOTH'] },
      } },
    },
    include: {
      RatingConfig: { select: { scope: true } },
      Team: { select: { organizationId: true } },
    },
    orderBy: [{ endAt: 'asc' }, { runtimeTrainingId: 'asc' }],
  })
  const earlier = input.scopeType === 'GLOBAL'
    ? candidates[0]
    : candidates.find(candidate => candidate.RatingConfig?.scope === 'BOTH'
      || (candidate.organizationId || candidate.Team?.organizationId || null) === input.organizationId)
  if (earlier) fail(409, 'EARLIER_RATED_CONTEST_PENDING', `更早结束的同一 Rating 池比赛尚未结算：${earlier.title}`)
}

async function createAndApplyBatchTx(tx: Prisma.TransactionClient, input: {
  contestId: string; training: any; config: any; snapshot: any; scopeType: Extract<RatingScope, 'GLOBAL' | 'ORGANIZATION'>; organizationId: string | null; entries: any[]; minimum: number
}) {
  const pool = await ensurePoolTx(tx, input.scopeType, input.organizationId, input.config.track)
  await assertNoEarlierRatedContestPendingTx(tx, {
    training: input.training,
    scopeType: input.scopeType,
    organizationId: input.organizationId,
    track: input.config.track,
  })
  const eligible = input.entries.filter(entry => entry.ratingEligible && (input.scopeType === 'GLOBAL' || entry.organizationIdSnapshot === input.organizationId))
  const inputHash = hash({ poolId: pool.id, snapshotId: input.snapshot.id, users: eligible.map(entry => [entry.userId, entry.rank, entry.ratingTieGroup]) })
  if (eligible.length < input.minimum) return tx.ratingBatch.create({ data: { id: crypto.randomUUID(), contestId: input.contestId, poolId: pool.id, standingSnapshotId: input.snapshot.id, algorithmCode: input.config.algorithmCode, algorithmVersion: input.config.algorithmVersion, fieldSize: eligible.length, status: 'SKIPPED', inputHash, sequenceAt: input.training.endTime, skipReason: 'NOT_ENOUGH_PARTICIPANTS', calculatedAt: new Date(), appliedAt: new Date() } })
  const accounts = []
  for (const entry of eligible) accounts.push(await tx.ratingAccount.upsert({ where: { poolId_userId: { poolId: pool.id, userId: entry.userId } }, update: {}, create: { id: crypto.randomUUID(), poolId: pool.id, userId: entry.userId, rating: pool.baseRating, peakRating: pool.baseRating } }))
  const accountByUser = new Map(accounts.map(account => [account.userId, account]))
  const changes = calculateMultiElo(eligible.map(entry => ({ userId: entry.userId, rating: accountByUser.get(entry.userId)!.rating, tieGroup: entry.ratingTieGroup, rank: entry.rank })), { scale: pool.scale, kFactor: pool.kFactor, weightBasisPoints: input.config.weightBasisPoints })
  const batch = await tx.ratingBatch.create({ data: { id: crypto.randomUUID(), contestId: input.contestId, poolId: pool.id, standingSnapshotId: input.snapshot.id, algorithmCode: input.config.algorithmCode, algorithmVersion: input.config.algorithmVersion, fieldSize: eligible.length, status: 'CALCULATING', inputHash, sequenceAt: input.training.endTime } })
  for (const change of changes) {
    const account = accountByUser.get(change.userId)!
    await tx.ratingChange.create({ data: { id: crypto.randomUUID(), batchId: batch.id, accountId: account.id, userId: change.userId, ratingBefore: change.ratingBefore, expectedPerformance: change.expectedPerformance, actualPerformance: change.actualPerformance, rank: change.rank, fieldSize: eligible.length, rawDelta: change.rawDelta, appliedDelta: change.appliedDelta, ratingAfter: change.ratingAfter } })
    await tx.ratingAccount.update({ where: { id: account.id }, data: { rating: change.ratingAfter, peakRating: Math.max(account.peakRating, change.ratingAfter), ratedContestCount: { increment: 1 }, provisional: account.ratedContestCount + 1 < 5, lastRatedAt: input.training.endTime, version: { increment: 1 } } })
  }
  return tx.ratingBatch.update({ where: { id: batch.id }, data: { status: 'APPLIED', calculatedAt: new Date(), appliedAt: new Date() } })
}

async function finalizeContestRatingCore(trainingId: number, actorUserId: string) {
  const resolved = await requireContestResolved(trainingId)
  const training = resolved.runtime
  if (!resolved.contest.endAt) fail(409, 'CONTEST_CANONICAL_STATE_INCOMPLETE', '比赛规范结束时间缺失，请联系管理员修复')
  if (new Date() <= resolved.contest.endAt && resolved.contest.status !== 'finished') fail(409, 'CONTEST_NOT_ENDED', '比赛结束后才能生成最终榜单')
  return withSerializableRetry(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-finalize:${trainingId}`}, 0)) IS NULL AS locked`
    const lockedAggregate = await tx.contest.findUnique({
      where: { runtimeTrainingId: trainingId },
      include: { RatingConfig: true, RuntimeTraining: { include: {
        Team: { select: { organizationId: true } },
        TrainingProblem: { orderBy: { orderIndex: 'asc' }, select: { id: true, points: true } },
      } } },
    })
    const locked = lockedAggregate?.RuntimeTraining
    if (!locked) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
    if (lockedAggregate.finalizationStatus === 'FINALIZED' && lockedAggregate.finalizedStandingId) return loadContestRatingTx(tx, trainingId, actorUserId)
    const activeRuns = await tx.judgeRun.count({ where: { status: { in: ['QUEUED', 'RUNNING'] }, Submission: { trainingId, submitScope: 'contest' } } })
    if (activeRuns > 0) fail(409, 'CONTEST_JUDGING_INCOMPLETE', `仍有 ${activeRuns} 个评测任务未完成`)
    if (!await beginContestFinalizationTx(tx, trainingId, lockedAggregate.finalizationStatus)) {
      fail(409, 'CONTEST_FINALIZATION_STALE', '比赛结算状态已变化，请刷新后重试')
    }
    const config = lockedAggregate.RatingConfig || await lockContestRatingConfigTx(tx, trainingId, actorUserId, locked.format)
    const snapshot = await buildStandingSnapshotTx(tx, locked, config, actorUserId)
    const persistedEntries = await tx.contestStandingEntry.findMany({ where: { snapshotId: snapshot.id }, orderBy: [{ rank: 'asc' }, { userId: 'asc' }] })
    if (config.scope === 'GLOBAL' || config.scope === 'BOTH') await createAndApplyBatchTx(tx, { contestId: lockedAggregate.id, training: locked, config, snapshot, scopeType: 'GLOBAL', organizationId: null, entries: persistedEntries, minimum: config.globalMinParticipants })
    if (config.scope === 'ORGANIZATION' || config.scope === 'BOTH') {
      const organizations = ([...new Set(persistedEntries.map(item => item.organizationIdSnapshot).filter(Boolean))] as string[]).sort()
      const fallback = locked.organizationId || locked.Team?.organizationId
      if (!organizations.length && fallback) organizations.push(fallback)
      for (const organizationId of organizations) await createAndApplyBatchTx(tx, { contestId: lockedAggregate.id, training: locked, config, snapshot, scopeType: 'ORGANIZATION', organizationId, entries: persistedEntries, minimum: config.organizationMinParticipants })
    }
    await tx.submission.updateMany({
      where: { trainingId, submitScope: 'contest', isGlobalVisible: false },
      data: { isGlobalVisible: true },
    })
    if (!await completeContestFinalizationTx(tx, trainingId, snapshot.id)) {
      fail(409, 'CONTEST_FINALIZATION_STALE', '比赛结算状态已变化，请刷新后重试')
    }
    return loadContestRatingTx(tx, trainingId, actorUserId)
  }, { timeout: 30_000 })
}

export async function finalizeContestRating(trainingId: number, userId: string) {
  const training = await requireContest(trainingId)
  if (!await canManageTraining(userId, training)) fail(403, 'CONTEST_MANAGE_DENIED', '只有比赛管理员可以完成最终结算')
  return finalizeContestRatingCore(trainingId, userId)
}

/**
 * Finalize ended contests and their immutable standings in chronological order. The singleton scheduler
 * calls this, while the per-contest advisory lock keeps manual retries and a
 * blue/green overlap idempotent.
 */
export async function processDueContestRatings(limit = 20) {
  // Only contests that entered the Rating lifecycle are eligible. Discovery
  // goes through the aggregate boundary; the facade owns legacy fallback.
  const due = await listDueRatedContestRuntimes(new Date(), limit)
  const result = { scanned: due.length, finalized: 0, waiting: 0, failed: 0, failures: [] as Array<{ trainingId: number; code: string }> }
  for (const contest of due) {
    try {
      await finalizeContestRatingCore(contest.id, contest.createdBy)
      result.finalized++
    } catch (error) {
      const code = error instanceof ContestRatingError ? error.code : 'RATING_FINALIZATION_FAILED'
      if (['CONTEST_JUDGING_INCOMPLETE', 'EARLIER_RATED_CONTEST_PENDING'].includes(code)) result.waiting++
      else {
        result.failed++
        result.failures.push({ trainingId: contest.id, code })
        await prisma.$transaction(tx => failContestFinalizationTx(tx, contest.id))
      }
    }
  }
  return result
}

export async function updateRatingParticipantDisposition(trainingId: number, targetUserId: string, actorUserId: string, body: any) {
  const training = await requireContest(trainingId)
  if (!await canManageTraining(actorUserId, training)) fail(403, 'CONTEST_MANAGE_DENIED', '无权限调整 Rating 资格')
  const disposition = String(body?.disposition || '').toUpperCase()
  if (!['NORMAL', 'EXCLUDE', 'KEEP_RESULT', 'FORCE_LAST'].includes(disposition)) fail(422, 'RATING_DISPOSITION_INVALID', 'Rating 处置无效')
  const reason = String(body?.reason || '').trim()
  if (disposition !== 'NORMAL' && (reason.length < 5 || reason.length > 1000)) fail(422, 'RATING_DISPOSITION_REASON_REQUIRED', '非正常 Rating 处置必须填写 5～1000 字原因')
  return withSerializableRetry(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-finalize:${trainingId}`}, 0)) IS NULL AS locked`
    const locked = await tx.training.findUniqueOrThrow({ where: { id: trainingId }, include: { Team: { select: { organizationId: true } } } })
    if (['FINALIZING', 'FINALIZED'].includes(locked.finalizationStatus)) fail(409, 'CONTEST_RATING_DISPOSITION_FROZEN', '最终榜单正在生成或已生成；如需变更请先进入显式重测与重放流程')
    const updated = await tx.trainingParticipant.updateMany({
      where: { trainingId, userId: targetUserId },
      data: {
        ratingDisposition: disposition as any,
        ratingDispositionReason: reason || null,
        ratingDispositionBy: actorUserId,
        ratingDispositionAt: new Date(),
      },
    })
    if (!updated.count) fail(404, 'PARTICIPANT_NOT_FOUND', '参赛者不存在')
    const metadata = { trainingId, disposition, reason: reason || null }
    const organizationId = fixedOrganizationId(locked)
    if (organizationId) {
      await tx.organizationAuditLog.create({ data: {
        id: crypto.randomUUID(), organizationId, actorUserId,
        action: 'contest_rating_participant_disposition_updated', targetUserId,
        sourceType: 'training', sourceId: String(trainingId), metadata,
      } })
    } else {
      await tx.platformAuditLog.create({ data: {
        id: crypto.randomUUID(), actorUserId,
        action: 'contest_rating_participant_disposition_updated', targetType: 'training',
        targetId: String(trainingId), metadata: { ...metadata, targetUserId },
      } })
    }
    return { userId: targetUserId, disposition }
  })
}

/**
 * Rebuild a finalized contest after an explicit rejudge. The operation creates a
 * new immutable standing and replays every affected pool from its base rating.
 * Existing batches and changes are retained as SUPERSEDED audit history.
 */
export async function rebuildContestRating(trainingId: number, userId: string) {
  const resolved = await requireContestResolved(trainingId)
  const training = resolved.runtime
  if (!await canManageTraining(userId, training)) fail(403, 'CONTEST_MANAGE_DENIED', '只有比赛管理员可以申请 Rating 重放')
  if (!resolved.contest.finalizedStandingId) fail(409, 'CONTEST_NOT_FINALIZED', '比赛尚未生成最终榜单')
  if (resolved.contest.finalizationStatus === 'FINALIZED') return getContestRating(trainingId, userId)
  if (resolved.contest.finalizationStatus !== 'HELD') fail(409, 'CONTEST_REBUILD_NOT_READY', '只有赛后重测完成并进入待重放状态后才能重放 Rating')
  const activeRuns = await prisma.judgeRun.count({ where: { status: { in: ['QUEUED', 'RUNNING'] }, Submission: { trainingId, submitScope: 'contest' } } })
  if (activeRuns > 0) fail(409, 'CONTEST_JUDGING_INCOMPLETE', `仍有 ${activeRuns} 个评测任务未完成`)
  const affectedPools = await prisma.ratingBatch.findMany({
    where: { contestId: resolved.contest.id, status: { in: ['APPLIED', 'SKIPPED'] } },
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
    const lockedAggregate = await tx.contest.findUnique({
      where: { runtimeTrainingId: trainingId },
      include: {
        RatingConfig: true,
        RuntimeTraining: { include: {
          Team: { select: { organizationId: true } },
          TrainingProblem: { orderBy: { orderIndex: 'asc' }, select: { id: true, points: true } },
        } },
      },
    })
    const locked = lockedAggregate?.RuntimeTraining
    if (!locked) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
    if (lockedAggregate.finalizationStatus !== 'HELD') {
      fail(409, 'CONTEST_REBUILD_NOT_READY', '比赛重放状态已变化，请刷新后重试')
    }
    const config = lockedAggregate.RatingConfig || await lockContestRatingConfigTx(tx, trainingId, userId, locked.format)
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
          Contest: { include: { RatingConfig: true } },
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
        const snapshot = old.contestId === lockedAggregate.id
          ? await tx.contestStandingSnapshot.findUniqueOrThrow({
            where: { id: newSnapshot.id },
            include: { Entries: { orderBy: [{ rank: 'asc' }, { userId: 'asc' }] } },
          })
          : old.StandingSnapshot
        const eligible = snapshot.Entries.filter(entry => entry.ratingEligible && (
          pool.scopeType === 'GLOBAL' || entry.organizationIdSnapshot === pool.organizationId
        ))
        const ratingConfig = old.Contest.RatingConfig
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
            id: crypto.randomUUID(), contestId: old.contestId, poolId,
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
          id: crypto.randomUUID(), contestId: old.contestId, poolId,
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
    if (!await completeContestRatingRebuildTx(tx, trainingId, newSnapshot.id)) {
      fail(409, 'CONTEST_FINALIZATION_STALE', '比赛重放状态已变化，请刷新后重试')
    }
    return { ...(await loadContestRatingTx(tx, trainingId, userId)), rebuild: report }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 })
}

async function loadContestRatingTx(tx: Prisma.TransactionClient, trainingId: number, requestingUserId?: string) {
  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId: trainingId },
    include: {
      RatingConfig: true,
      FinalizedStanding: {
        include: {
          Entries: { orderBy: [{ rank: 'asc' }, { userId: 'asc' }] },
          RatingBatches: { include: { Pool: true, Changes: true } },
        },
      },
      RuntimeTraining: true,
    },
  })
  const training = aggregate?.RuntimeTraining
  if (!aggregate || !training) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  const users = await tx.user.findMany({ where: { id: { in: aggregate.FinalizedStanding?.Entries.map(item => item.userId) || [] } }, select: { id: true, username: true, avatar: true } })
  const userMap = new Map(users.map(user => [user.id, user]))
  const batches = aggregate.FinalizedStanding?.RatingBatches || []
  const organizationIds = [...new Set(batches.map(batch => batch.Pool.organizationId).filter(Boolean) as string[])]
  const organizations = organizationIds.length ? await tx.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true, School: { select: { shortName: true } } } }) : []
  const organizationMap = new Map(organizations.map(organization => [organization.id, { id: organization.id, name: organization.name, shortName: organization.School?.shortName || null }]))
  const batchDtos = batches.map(batch => ({ id: batch.id, scope: batch.Pool.scopeType, organizationId: batch.Pool.organizationId, organization: batch.Pool.organizationId ? organizationMap.get(batch.Pool.organizationId) || null : null, track: batch.Pool.track, status: batch.status, fieldSize: batch.fieldSize, skipReason: batch.skipReason, changes: batch.Changes }))
  return {
    finalizationStatus: aggregate.finalizationStatus,
    config: configDto(aggregate.RatingConfig, training),
    standing: aggregate.FinalizedStanding ? { id: aggregate.FinalizedStanding.id, revision: aggregate.FinalizedStanding.revision, finalizedAt: aggregate.FinalizedStanding.finalizedAt, entries: aggregate.FinalizedStanding.Entries.map(entry => ({ ...entry, totalScore: entry.totalScore === null ? null : Number(entry.totalScore), user: userMap.get(entry.userId) })) } : null,
    batches: batchDtos,
    myChanges: requestingUserId ? batchDtos.flatMap(batch => batch.changes.filter(change => change.userId === requestingUserId).map(change => ({ ...change, batchId: batch.id, scope: batch.scope, track: batch.track, organizationId: batch.organizationId, organization: batch.organization }))) : [],
  }
}

export async function getContestRating(trainingId: number, userId: string) {
  const training = await requireContest(trainingId)
  if (!await canAccessTraining(userId, training)) fail(403, 'CONTEST_ACCESS_DENIED', '无权限查看比赛 Rating')
  return prisma.$transaction(tx => loadContestRatingTx(tx, trainingId, userId))
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
