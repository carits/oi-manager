import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { postCaritsTransaction, reverseCaritsTransaction } from '../../carits/application/carits-ledger.service'

const POLICY_CODE = 'canonical_testcase_promoted'
const POLICY_VERSION = 1
const USER_DAILY_REWARD_CAP = 200n
const PLATFORM_DAILY_REWARD_CAP = 5_000n

export class ContributionRewardError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function nextUtcDay(now = new Date()) {
  const next = startOfUtcDay(now)
  next.setUTCDate(next.getUTCDate() + 1)
  return next
}

function rewardFor(source: string) {
  return source === 'hack' ? { score: 150, carits: 30n, type: 'hack_promoted' } : { score: 100, carits: 20n, type: 'candidate_promoted' }
}

function rewardSnapshot(event: { evidence: unknown; ruleCode: string; ruleVersion: number }) {
  const evidence = event.evidence && typeof event.evidence === 'object' && !Array.isArray(event.evidence)
    ? event.evidence as Record<string, unknown>
    : null
  const rawUserCarits = evidence?.rewardCarits
  const rawOrganizationCarits = evidence?.organizationRewardCarits
  if (event.ruleCode !== POLICY_CODE
    || !Number.isInteger(event.ruleVersion)
    || event.ruleVersion <= 0
    || typeof rawUserCarits !== 'string'
    || !/^[1-9][0-9]*$/.test(rawUserCarits)
    || typeof rawOrganizationCarits !== 'string'
    || !/^[0-9]+$/.test(rawOrganizationCarits)) {
    throw new ContributionRewardError(409, 'CONTRIBUTION_REWARD_SNAPSHOT_INVALID', '贡献事件的奖励快照缺失或不可信')
  }
  return { userCarits: BigInt(rawUserCarits), organizationCarits: BigInt(rawOrganizationCarits) }
}

export async function recordPromotedContribution(tx: Prisma.TransactionClient, input: {
  candidateId: string
  promotedGraphHash: string
  selectionMode: string
}) {
  const candidate = await tx.testcaseCandidate.findUnique({ where: { id: input.candidateId } })
  if (!candidate || candidate.status !== 'PROMOTED') throw new Error('Promoted Candidate is required before recording contribution')
  if (candidate.promotedGraphHash !== input.promotedGraphHash) {
    throw new ContributionRewardError(409, 'CONTRIBUTION_PROMOTION_EVIDENCE_MISMATCH', 'Candidate 的 Evolving 数据哈希与贡献证据不一致')
  }
  if (candidate.source === 'admin_import') return null
  const actor = await tx.user.findUnique({ where: { id: candidate.createdBy }, select: { id: true, role: true, status: true } })
  if (!actor || actor.status !== 'active' || ['platform_admin', 'super_admin'].includes(actor.role)) return null
  const reward = rewardFor(candidate.source)
  const accepted = input.selectionMode === 'auto'
  // A promoted candidate is a single contribution fact. Policy revisions are
  // captured on that fact; they must not create a second event (and reward)
  // for the same candidate later.
  const dedupeKey = `candidate:${candidate.id}:promoted`
  const event = await tx.contributionEvent.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      id: crypto.randomUUID(), actorUserId: actor.id, type: reward.type,
      sourceType: 'testcase_candidate', sourceId: candidate.id, score: reward.score,
      ruleCode: POLICY_CODE, ruleVersion: POLICY_VERSION,
      dedupeKey,
      status: accepted ? 'accepted' : 'pending', occurredAt: candidate.promotedAt || new Date(),
      acceptedAt: accepted ? new Date() : null,
      evidence: {
        problemId: candidate.problemId, candidateId: candidate.id,
        promotedGraphHash: input.promotedGraphHash, candidateSource: candidate.source,
        selectionMode: input.selectionMode, rewardCarits: reward.carits.toString(), organizationRewardCarits: '0',
      },
    },
  })
  const persistedEvidence = event.evidence && typeof event.evidence === 'object' && !Array.isArray(event.evidence)
    ? event.evidence as Record<string, unknown>
    : null
  if (event.sourceType !== 'testcase_candidate'
    || event.sourceId !== candidate.id
    || event.ruleCode !== POLICY_CODE
    || event.ruleVersion !== POLICY_VERSION
    || persistedEvidence?.promotedGraphHash !== input.promotedGraphHash
    || persistedEvidence?.selectionMode !== input.selectionMode) {
    throw new ContributionRewardError(409, 'CONTRIBUTION_EVENT_REPLAY_CONFLICT', '贡献事件的重放证据与原记录不一致')
  }
  if (candidate.contributionOrganizationId) {
    await tx.organizationContributionAttribution.upsert({
      where: { contributionId: event.id }, update: {},
      create: { id: crypto.randomUUID(), contributionId: event.id, organizationId: candidate.contributionOrganizationId, reason: 'contributor_selected_at_submission', evidence: { candidateId: candidate.id } },
    })
  }
  if (event.status === 'accepted' && !event.revokedAt) {
    const persistedReward = rewardSnapshot(event)
    await tx.contributionRewardDelivery.upsert({
      where: { contributionId: event.id }, update: {},
      create: {
        id: crypto.randomUUID(), contributionId: event.id,
        policyCode: event.ruleCode, policyVersion: event.ruleVersion,
        userCarits: persistedReward.userCarits,
        organizationCarits: persistedReward.organizationCarits,
      },
    })
  }
  return event
}

async function claimDelivery() {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ContributionRewardDelivery" WHERE "status" IN ('pending', 'deferred_budget') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW()) AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW()) ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`
    if (!rows[0]) return null
    const token = crypto.randomUUID()
    const changed = await tx.contributionRewardDelivery.updateMany({ where: { id: rows[0].id, status: { in: ['pending', 'deferred_budget'] } }, data: { fencingToken: token, leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: { increment: 1 } } })
    return changed.count ? { id: rows[0].id, token } : null
  })
}

async function postClaimedReward(id: string, token: string) {
  return prisma.$transaction(async tx => {
    const rewardPeriodStart = startOfUtcDay()
    const delivery = await tx.contributionRewardDelivery.findFirst({ where: { id, fencingToken: token, status: { in: ['pending', 'deferred_budget'] } }, include: { Contribution: true } })
    if (!delivery) return false
    if ((process.env.CONTRIBUTION_REWARD_MODE || 'enabled') !== 'enabled') {
      await tx.contributionRewardDelivery.updateMany({ where: { id, fencingToken: token, status: { in: ['pending', 'deferred_budget'] } }, data: { leaseExpiresAt: null, fencingToken: null, nextAttemptAt: new Date(Date.now() + 5 * 60_000), errorMessage: 'observe_mode' } })
      return false
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contribution-reward:platform:${rewardPeriodStart.toISOString()}`}, 0)) IS NULL AS locked`
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contribution-reward:user:${delivery.Contribution.actorUserId}:${rewardPeriodStart.toISOString()}`}, 0)) IS NULL AS locked`
    const posted = await tx.contributionRewardDelivery.findMany({ where: { status: { in: ['posted', 'reversed'] }, postedAt: { gte: rewardPeriodStart } }, include: { Contribution: { select: { actorUserId: true } } } })
    const platformTotal = posted.reduce((sum, item) => sum + item.userCarits + item.organizationCarits, 0n)
    const userTotal = posted.filter(item => item.Contribution.actorUserId === delivery.Contribution.actorUserId).reduce((sum, item) => sum + item.userCarits, 0n)
    if (platformTotal + delivery.userCarits + delivery.organizationCarits > PLATFORM_DAILY_REWARD_CAP || userTotal + delivery.userCarits > USER_DAILY_REWARD_CAP) {
      const changed = await tx.contributionRewardDelivery.updateMany({ where: { id, fencingToken: token, status: { in: ['pending', 'deferred_budget'] } }, data: { status: 'deferred_budget', nextAttemptAt: nextUtcDay(rewardPeriodStart), fencingToken: null, leaseExpiresAt: null, errorMessage: 'daily_reward_budget_deferred' } })
      if (!changed.count) throw new Error('贡献奖励租约已失效')
      return false
    }
    const transaction = await postCaritsTransaction(tx, {
      type: 'contribution_reward', idempotencyKey: `contribution:${delivery.contributionId}:reward:v${delivery.policyVersion}`,
      referenceType: 'contribution_event', referenceId: delivery.contributionId,
      metadata: { policyCode: delivery.policyCode, policyVersion: delivery.policyVersion },
      entries: [
        { owner: { ownerType: 'SYSTEM', systemKey: 'REWARD_POOL' }, amount: -delivery.userCarits, allowNegative: true },
        { owner: { ownerType: 'USER', userId: delivery.Contribution.actorUserId }, amount: delivery.userCarits },
      ],
    })
    const changed = await tx.contributionRewardDelivery.updateMany({ where: { id, fencingToken: token, status: { in: ['pending', 'deferred_budget'] } }, data: { status: 'posted', transactionId: transaction.id, postedAt: new Date(), nextAttemptAt: null, fencingToken: null, leaseExpiresAt: null, errorMessage: null } })
    if (!changed.count) throw new Error('贡献奖励租约已失效')
    return true
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function processContributionRewardDeliveries(limit = 20) {
  if ((process.env.CONTRIBUTION_REWARD_MODE || 'enabled') !== 'enabled') {
    const observed = await prisma.contributionRewardDelivery.count({
      where: { status: { in: ['pending', 'deferred_budget'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    })
    return { posted: 0, observed }
  }
  let posted = 0
  for (let index = 0; index < limit; index += 1) {
    const claim = await claimDelivery()
    if (!claim) break
    try { if (await postClaimedReward(claim.id, claim.token)) posted += 1 }
    catch (error) {
      const delivery = await prisma.contributionRewardDelivery.findUnique({ where: { id: claim.id }, select: { attemptCount: true } }).catch(() => null)
      await prisma.contributionRewardDelivery.updateMany({ where: { id: claim.id, fencingToken: claim.token }, data: { status: (delivery?.attemptCount || 0) >= 5 ? 'failed' : 'pending', nextAttemptAt: (delivery?.attemptCount || 0) >= 5 ? null : new Date(Date.now() + Math.min(30 * 60_000, 2 ** (delivery?.attemptCount || 1) * 1_000)), fencingToken: null, leaseExpiresAt: null, errorMessage: String((error as Error).message).slice(0, 2000) } }).catch(() => undefined)
    }
  }
  return { posted, observed: 0 }
}

export async function acceptContribution(userId: string, contributionId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contribution-decision:${contributionId}`}, 0)) IS NULL AS locked`
    const event = await tx.contributionEvent.findUnique({ where: { id: contributionId } })
    if (!event || event.status !== 'pending') throw new ContributionRewardError(409, 'CONTRIBUTION_ALREADY_PROCESSED', '贡献事件不存在或已经处理')
    const reward = rewardSnapshot(event)
    await tx.contributionEvent.update({ where: { id: event.id }, data: { status: 'accepted', acceptedAt: new Date() } })
    await tx.contributionRewardDelivery.upsert({ where: { contributionId: event.id }, update: {}, create: { id: crypto.randomUUID(), contributionId: event.id, policyCode: event.ruleCode, policyVersion: event.ruleVersion, userCarits: reward.userCarits, organizationCarits: reward.organizationCarits } })
    await tx.platformAuditLog.create({ data: { id: crypto.randomUUID(), actorUserId: userId, action: 'contribution_accepted', targetType: 'contribution_event', targetId: event.id } })
    return { accepted: true }
  })
}

export async function rejectContribution(userId: string, contributionId: string, reason: string) {
  if (reason.trim().length < 10) throw new ContributionRewardError(422, 'CONTRIBUTION_REASON_REQUIRED', '处理原因至少需要 10 个字')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contribution-decision:${contributionId}`}, 0)) IS NULL AS locked`
    const changed = await tx.contributionEvent.updateMany({ where: { id: contributionId, status: 'pending' }, data: { status: 'rejected', revokeReason: reason.trim() } })
    if (!changed.count) throw new ContributionRewardError(409, 'CONTRIBUTION_ALREADY_PROCESSED', '贡献事件不存在或已经处理')
    await tx.platformAuditLog.create({ data: { id: crypto.randomUUID(), actorUserId: userId, action: 'contribution_rejected', targetType: 'contribution_event', targetId: contributionId, metadata: { reason: reason.trim() } } })
    return { rejected: true }
  })
}

export async function revokeContribution(userId: string, contributionId: string, reason: string) {
  if (reason.trim().length < 10) throw new ContributionRewardError(422, 'CONTRIBUTION_REASON_REQUIRED', '撤销原因至少需要 10 个字')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contribution-decision:${contributionId}`}, 0)) IS NULL AS locked`
    const event = await tx.contributionEvent.findUnique({ where: { id: contributionId }, include: { RewardDelivery: true } })
    if (!event || event.status !== 'accepted' || event.revokedAt) throw new ContributionRewardError(409, 'CONTRIBUTION_ALREADY_PROCESSED', '贡献事件不存在或已经撤销')
    let reversalId: string | null = null
    if (event.RewardDelivery?.status === 'posted' && event.RewardDelivery.transactionId) {
      const reversal = await reverseCaritsTransaction(tx, { transactionId: event.RewardDelivery.transactionId, idempotencyKey: `contribution:${event.id}:reversal:v1`, operatorUserId: userId, reason: reason.trim() })
      reversalId = reversal.id
      await tx.contributionRewardDelivery.update({ where: { id: event.RewardDelivery.id }, data: { status: 'reversed', reversalTransactionId: reversal.id, reversedAt: new Date() } })
    } else if (event.RewardDelivery) {
      await tx.contributionRewardDelivery.update({ where: { id: event.RewardDelivery.id }, data: { status: 'cancelled', fencingToken: null, leaseExpiresAt: null } })
    }
    await tx.contributionEvent.update({ where: { id: event.id }, data: { status: 'revoked', revokedAt: new Date(), revokeReason: reason.trim() } })
    await tx.platformAuditLog.create({ data: { id: crypto.randomUUID(), actorUserId: userId, action: 'contribution_revoked', targetType: 'contribution_event', targetId: event.id, metadata: { reason: reason.trim(), reversalTransactionId: reversalId } } })
    return { revoked: true, reversalTransactionId: reversalId }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function retryContributionReward(userId: string, contributionId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contribution-decision:${contributionId}`}, 0)) IS NULL AS locked`
    const event = await tx.contributionEvent.findUnique({ where: { id: contributionId }, include: { RewardDelivery: true } })
    if (!event || event.status !== 'accepted' || event.revokedAt || event.RewardDelivery?.status !== 'failed') throw new ContributionRewardError(409, 'CONTRIBUTION_REWARD_NOT_RETRYABLE', '该贡献奖励当前不能重试')
    await tx.contributionRewardDelivery.update({ where: { id: event.RewardDelivery.id }, data: { status: 'pending', attemptCount: 0, nextAttemptAt: null, leaseExpiresAt: null, fencingToken: null, errorMessage: null } })
    await tx.platformAuditLog.create({ data: { id: crypto.randomUUID(), actorUserId: userId, action: 'contribution_reward_retried', targetType: 'contribution_event', targetId: event.id } })
    return { retried: true }
  })
}

export async function listContributionAudit(
  status?: string,
  pagination: { page: number; pageSize: number; skip: number } = { page: 1, pageSize: 20, skip: 0 },
) {
  const allowed = ['pending', 'accepted', 'rejected', 'revoked']
  const where = status && allowed.includes(status) ? { status } : {}
  const [items, total, pending] = await Promise.all([
    prisma.contributionEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.pageSize,
      include: {
        Actor: { select: { username: true } },
        Attribution: {
          select: {
            organizationId: true,
            Organization: { select: { name: true } },
          },
        },
        RewardDelivery: true,
      },
    }),
    prisma.contributionEvent.count({ where }),
    prisma.contributionEvent.count({ where: { status: 'pending' } }),
  ])
  return {
    items: items.map(item => ({
      ...item,
      RewardDelivery: item.RewardDelivery
        ? {
            ...item.RewardDelivery,
            userCarits: item.RewardDelivery.userCarits.toString(),
            organizationCarits: item.RewardDelivery.organizationCarits.toString(),
          }
        : null,
    })),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.ceil(total / pagination.pageSize),
    pending,
  }
}

export async function getContributionEvidence(contributionId: string, kind: string) {
  if (!['candidate', 'evolving'].includes(kind)) {
    throw new ContributionRewardError(400, 'CONTRIBUTION_EVIDENCE_KIND_INVALID', '贡献证据类型无效')
  }
  const event = await prisma.contributionEvent.findUnique({ where: { id: contributionId } })
  if (!event) throw new ContributionRewardError(404, 'CONTRIBUTION_NOT_FOUND', '贡献事件不存在')
  const evidence = event.evidence && typeof event.evidence === 'object' && !Array.isArray(event.evidence)
    ? event.evidence as Record<string, unknown>
    : null
  const problemId = typeof evidence?.problemId === 'string' ? evidence.problemId : ''
  const candidateId = typeof evidence?.candidateId === 'string' ? evidence.candidateId : ''
  const graphHash = typeof evidence?.promotedGraphHash === 'string' ? evidence.promotedGraphHash : ''
  if (!problemId || !candidateId || !graphHash || event.sourceType !== 'testcase_candidate' || event.sourceId !== candidateId) {
    throw new ContributionRewardError(409, 'CONTRIBUTION_EVIDENCE_INVALID', '贡献事件缺少可信的 Candidate 证据')
  }
  const candidate = await prisma.testcaseCandidate.findFirst({ where: { id: candidateId, problemId } })
  if (!candidate || candidate.promotedGraphHash !== graphHash) {
    throw new ContributionRewardError(409, 'CONTRIBUTION_EVIDENCE_INVALID', 'Candidate 与 Evolving 数据哈希证据不一致')
  }
  if (kind === 'candidate') {
    return { kind, problemId, candidate: serializeContributionEvidence(candidate) }
  }
  const current = await prisma.problemTestSetSlot.findUnique({
    where: { problemId_slot: { problemId, slot: 'EVOLVING' } },
    select: { graphHash: true, fencingToken: true, updatedAt: true },
  })
  return {
    kind,
    problemId,
    graphHash,
    isCurrent: current?.graphHash === graphHash,
    current: current || null,
  }
}

function serializeContributionEvidence(candidate: Awaited<ReturnType<typeof prisma.testcaseCandidate.findFirst>>) {
  if (!candidate) return null
  return {
    ...candidate,
    affectedSubtaskIds: candidate.affectedSubtaskIds
      ? (() => { try { return JSON.parse(candidate.affectedSubtaskIds) } catch { return [] } })()
      : [],
  }
}
