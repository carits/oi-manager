import crypto from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '../../prisma'

export const EVALUATION_LIMITS = Object.freeze({
  direct: { executions: 400, cpuMs: 60_000, generatedBytes: 32 * 1024 * 1024, persistentLogBytes: 512 * 1024 },
  generator: { executions: 4_000, cpuMs: 300_000, generatedBytes: 256 * 1024 * 1024, persistentLogBytes: 1024 * 1024 },
  maxCandidateBytes: 16 * 1024 * 1024,
  normalDailyCredits: 10_000, managerDailyCredits: 100_000, platformDailyCredits: 250_000,
  maxPurchasedDailyCredits: 50_000, maxHotCandidates: 5_000, maxHotBytes: 2 * 1024 * 1024 * 1024,
  maxTopK: 1_000, maxCorpusClusters: 512, maxFeatures: 128, maxSubtasks: 15,
})

export class EvaluationBudgetError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

function isTransientTransactionError(error: any) {
  const databaseCode = error?.meta?.code || error?.meta?.database_error_code
  return error?.code === '40P01'
    || error?.code === '40001'
    || error?.code === 'P2034'
    || databaseCode === '40P01'
    || databaseCode === '40001'
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try { return await operation() }
    catch (error) {
      lastError = error
      if (!isTransientTransactionError(error) || attempt === maxAttempts) throw error
      await new Promise(resolve => setTimeout(resolve, 10 * attempt * attempt))
    }
  }
  throw lastError
}

export function dayStart(now = new Date()) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) }
function accountId(subjectType: string, subjectId: string, periodStart: Date) { return crypto.createHash('sha256').update(`${subjectType}\0${subjectId}\0${periodStart.toISOString()}`).digest('hex') }

async function ensureAccount(tx: Prisma.TransactionClient, subjectType: string, subjectId: string, limit: number, periodStart: Date) {
  const account = await tx.evaluationCreditAccount.upsert({ where: { subjectType_subjectId_periodStart: { subjectType, subjectId, periodStart } }, update: {}, create: { id: accountId(subjectType, subjectId, periodStart), subjectType, subjectId, periodStart, limitCredits: limit, availableCredits: limit } })
  if (account.limitCredits >= limit) return account
  return tx.evaluationCreditAccount.update({ where: { id: account.id }, data: { limitCredits: limit, availableCredits: { increment: limit - account.limitCredits }, version: { increment: 1 } } })
}

export async function contributionProfile(userId: string, client: Prisma.TransactionClient | PrismaClient = prisma) {
  const aggregate = await client.contributionEvent.aggregate({ where: { actorUserId: userId, status: 'accepted', revokedAt: null }, _sum: { score: true } })
  const score = aggregate._sum.score || 0
  if (score >= 10_000) return { score, level: 'L4', dailyLimit: 50_000 }
  if (score >= 2_000) return { score, level: 'L3', dailyLimit: 40_000 }
  if (score >= 500) return { score, level: 'L2', dailyLimit: 30_000 }
  if (score >= 100) return { score, level: 'L1', dailyLimit: 20_000 }
  return { score, level: 'L0', dailyLimit: 15_000 }
}

type EvaluationReservationInput = { userId: string; manager: boolean; taskType: string; taskId: string; credits: number; metadata?: Prisma.InputJsonValue }
type EvaluationSettlementInput = { taskType: string; taskId: string; reserved: number; actual: number; metadata?: Prisma.InputJsonValue }

export async function reserveEvaluationCreditsInTransaction(tx: Prisma.TransactionClient, input: EvaluationReservationInput) {
  if (!Number.isInteger(input.credits) || input.credits <= 0) throw new EvaluationBudgetError(400, 'EVALUATION_BUDGET_INVALID', '评估预算无效')
  const periodStart = dayStart()
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evaluation-budget:platform:${periodStart.toISOString()}`}, 0)) IS NULL AS locked`
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evaluation-budget:${input.userId}:${periodStart.toISOString()}`}, 0)) IS NULL AS locked`
  const key = `reservation:${input.taskType}:${input.taskId}`
  const existing = await tx.evaluationCreditReservation.findUnique({ where: { idempotencyKey: key } })
  if (existing) {
    if (existing.userId !== input.userId || existing.platformReserved !== input.credits) {
      throw new EvaluationBudgetError(409, 'EVALUATION_RESERVATION_IDEMPOTENCY_CONFLICT', '同一评估任务不能变更用户或预占额度')
    }
    return existing
  }
  const freeLimit = input.manager ? EVALUATION_LIMITS.managerDailyCredits : EVALUATION_LIMITS.normalDailyCredits
  const [profile, account, platformAccount] = await Promise.all([contributionProfile(input.userId, tx), ensureAccount(tx, 'user', input.userId, freeLimit, periodStart), ensureAccount(tx, 'platform', 'global', EVALUATION_LIMITS.platformDailyCredits, periodStart)])
  const dailyLimit = input.manager ? EVALUATION_LIMITS.managerDailyCredits : profile.dailyLimit
  const [activeUse, settledUse] = await Promise.all([
    tx.evaluationCreditReservation.aggregate({ where: { userId: input.userId, periodStart, status: 'reserved' }, _sum: { platformReserved: true } }),
    tx.evaluationCreditReservation.aggregate({ where: { userId: input.userId, periodStart, status: 'settled' }, _sum: { actualCredits: true } }),
  ])
  if ((activeUse._sum.platformReserved || 0) + (settledUse._sum.actualCredits || 0) + input.credits > dailyLimit) throw new EvaluationBudgetError(429, 'EVALUATION_DAILY_USAGE_LIMIT', `今日评估资源最多使用 ${dailyLimit} Credits`)
  const freeReserved = Math.min(account.availableCredits, input.credits), paidReserved = input.credits - freeReserved
  const wallet = paidReserved ? await tx.evaluationCreditWallet.findUnique({ where: { userId: input.userId } }) : null
  if (paidReserved > (wallet?.availableCredits || 0)) throw new EvaluationBudgetError(429, 'EVALUATION_BUDGET_EXCEEDED', '今日免费额度和已购 Evaluation Credits 均不足')
  const platformChanged = await tx.evaluationCreditAccount.updateMany({ where: { id: platformAccount.id, availableCredits: { gte: input.credits } }, data: { availableCredits: { decrement: input.credits }, reservedCredits: { increment: input.credits }, version: { increment: 1 } } })
  if (!platformChanged.count) throw new EvaluationBudgetError(429, 'EVALUATION_PLATFORM_BUDGET_EXCEEDED', '平台今日评估资源额度不足')
  if (freeReserved) await tx.evaluationCreditAccount.update({ where: { id: account.id }, data: { availableCredits: { decrement: freeReserved }, reservedCredits: { increment: freeReserved }, version: { increment: 1 } } })
  if (paidReserved) {
    const updated = await tx.evaluationCreditWallet.update({ where: { id: wallet!.id }, data: { availableCredits: { decrement: paidReserved }, reservedCredits: { increment: paidReserved }, version: { increment: 1 } } })
    await tx.evaluationCreditWalletEntry.create({ data: { id: crypto.randomUUID(), walletId: wallet!.id, type: 'reserve', amount: -paidReserved, balanceAfter: updated.availableCredits, idempotencyKey: `reserve-wallet:${input.taskType}:${input.taskId}`, referenceType: input.taskType, referenceId: input.taskId, metadata: input.metadata } })
  }
  const reservation = await tx.evaluationCreditReservation.create({ data: { id: crypto.randomUUID(), userId: input.userId, taskType: input.taskType, taskId: input.taskId, periodStart, freeAccountId: account.id, platformAccountId: platformAccount.id, walletId: paidReserved ? wallet!.id : null, freeReserved, paidReserved, platformReserved: input.credits, idempotencyKey: key, metadata: input.metadata } })
  await tx.evaluationCreditLedgerEntry.createMany({ data: [
    ...(freeReserved ? [{ id: crypto.randomUUID(), accountId: account.id, type: 'reserve', amount: -freeReserved, idempotencyKey: `reserve:${input.taskType}:${input.taskId}`, taskType: input.taskType, taskId: input.taskId, metadata: input.metadata }] : []),
    { id: crypto.randomUUID(), accountId: platformAccount.id, type: 'reserve', amount: -input.credits, idempotencyKey: `reserve-platform:${input.taskType}:${input.taskId}`, taskType: input.taskType, taskId: input.taskId, metadata: input.metadata },
  ] })
  return reservation
}

export async function reserveEvaluationCredits(input: EvaluationReservationInput) {
  return withSerializableRetry(() => prisma.$transaction(tx => reserveEvaluationCreditsInTransaction(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))
}

export async function settleEvaluationCreditsInTransaction(tx: Prisma.TransactionClient, input: EvaluationSettlementInput) {
  if (!Number.isFinite(input.actual)) throw new EvaluationBudgetError(400, 'EVALUATION_USAGE_INVALID', '评估资源实际用量无效')
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evaluation-settle:${input.taskType}:${input.taskId}`}, 0)) IS NULL AS locked`
  const reservation = await tx.evaluationCreditReservation.findUnique({ where: { taskType_taskId: { taskType: input.taskType, taskId: input.taskId } } })
  if (!reservation) return settleLegacy(tx, input)
  const actual = Math.max(0, Math.min(reservation.platformReserved, Math.ceil(input.actual)))
  if (reservation.status === 'settled' || reservation.status === 'released') {
    if ((reservation.actualCredits ?? 0) !== actual) {
      throw new EvaluationBudgetError(409, 'EVALUATION_SETTLEMENT_IDEMPOTENCY_CONFLICT', '同一评估任务不能使用不同的实际用量重复结算')
    }
    return reservation
  }
  const freeActual = Math.min(actual, reservation.freeReserved), paidActual = actual - freeActual
  // Reservation updates the shared platform account before the user account. Keep
  // settlement in the same row-lock order so reserve/settle cannot deadlock.
  await tx.evaluationCreditAccount.update({ where: { id: reservation.platformAccountId }, data: { reservedCredits: { decrement: reservation.platformReserved }, consumedCredits: { increment: actual }, availableCredits: { increment: reservation.platformReserved - actual }, version: { increment: 1 } } })
  await tx.evaluationCreditAccount.update({ where: { id: reservation.freeAccountId }, data: { reservedCredits: { decrement: reservation.freeReserved }, consumedCredits: { increment: freeActual }, availableCredits: { increment: reservation.freeReserved - freeActual }, version: { increment: 1 } } })
  if (reservation.walletId && reservation.paidReserved) {
    const unused = reservation.paidReserved - paidActual
    const updated = await tx.evaluationCreditWallet.update({ where: { id: reservation.walletId }, data: { reservedCredits: { decrement: reservation.paidReserved }, consumedCredits: { increment: paidActual }, availableCredits: { increment: unused }, version: { increment: 1 } } })
    await tx.evaluationCreditWalletEntry.create({ data: { id: crypto.randomUUID(), walletId: reservation.walletId, type: paidActual ? 'settle' : 'release', amount: unused, balanceAfter: updated.availableCredits, idempotencyKey: `settle-wallet:${input.taskType}:${input.taskId}`, referenceType: input.taskType, referenceId: input.taskId, metadata: { ...((input.metadata as any) || {}), actual: paidActual } } })
  }
  await tx.evaluationCreditLedgerEntry.createMany({ data: [
    ...(reservation.freeReserved ? [{ id: crypto.randomUUID(), accountId: reservation.freeAccountId, type: 'settle', amount: reservation.freeReserved - freeActual, idempotencyKey: `settle:${input.taskType}:${input.taskId}`, taskType: input.taskType, taskId: input.taskId, metadata: { ...((input.metadata as any) || {}), actual: freeActual } }] : []),
    { id: crypto.randomUUID(), accountId: reservation.platformAccountId, type: 'settle', amount: reservation.platformReserved - actual, idempotencyKey: `settle-platform:${input.taskType}:${input.taskId}`, taskType: input.taskType, taskId: input.taskId, metadata: { ...((input.metadata as any) || {}), actual } },
  ] })
  return tx.evaluationCreditReservation.update({ where: { id: reservation.id }, data: { status: actual ? 'settled' : 'released', actualCredits: actual, settledAt: new Date(), metadata: input.metadata } })
}

export async function settleEvaluationCredits(input: EvaluationSettlementInput) {
  return withSerializableRetry(() => prisma.$transaction(tx => settleEvaluationCreditsInTransaction(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))
}

async function settleLegacy(tx: Prisma.TransactionClient, input: { taskType: string; taskId: string; reserved: number; actual: number; metadata?: Prisma.InputJsonValue }) {
  const reservation = await tx.evaluationCreditLedgerEntry.findUnique({ where: { idempotencyKey: `reserve:${input.taskType}:${input.taskId}` } })
  if (!reservation) return null
  const storedReserved = -reservation.amount
  if (storedReserved <= 0 || input.reserved !== storedReserved) {
    throw new EvaluationBudgetError(409, 'EVALUATION_RESERVATION_MISMATCH', '评估任务的预占额度与不可变流水不一致')
  }
  const actual = Math.max(0, Math.min(storedReserved, Math.ceil(input.actual)))
  const existing = await tx.evaluationCreditLedgerEntry.findUnique({ where: { idempotencyKey: `settle:${input.taskType}:${input.taskId}` } })
  if (existing) {
    const metadata = existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? existing.metadata as Record<string, unknown>
      : null
    // Before Reservation Allocation existed, settlement entries stored
    // `-actual`. A legacy reservation first settled by the new server stores
    // the unused release amount and marks that representation explicitly.
    const existingActual = metadata?.ledgerSemantics === 'unused_release_v2'
      ? storedReserved - existing.amount
      : -existing.amount
    if (existingActual !== actual) {
      throw new EvaluationBudgetError(409, 'EVALUATION_SETTLEMENT_IDEMPOTENCY_CONFLICT', '同一评估任务不能使用不同的实际用量重复结算')
    }
    return existing
  }
  const platformReservation = await tx.evaluationCreditLedgerEntry.findUnique({ where: { idempotencyKey: `reserve-platform:${input.taskType}:${input.taskId}` } })
  if (platformReservation) {
    const platformStoredReserved = -platformReservation.amount
    if (platformStoredReserved !== storedReserved) {
      throw new EvaluationBudgetError(409, 'EVALUATION_RESERVATION_MISMATCH', '用户与平台的评估预占流水不一致')
    }
    const platformSettlement = await tx.evaluationCreditLedgerEntry.findUnique({ where: { idempotencyKey: `settle-platform:${input.taskType}:${input.taskId}` } })
    const platformMetadata = platformSettlement?.metadata && typeof platformSettlement.metadata === 'object' && !Array.isArray(platformSettlement.metadata)
      ? platformSettlement.metadata as Record<string, unknown>
      : null
    const platformActual = platformSettlement
      ? platformMetadata?.ledgerSemantics === 'unused_release_v2'
        ? platformStoredReserved - platformSettlement.amount
        : -platformSettlement.amount
      : null
    if (platformSettlement && platformActual !== actual) {
      throw new EvaluationBudgetError(409, 'EVALUATION_SETTLEMENT_IDEMPOTENCY_CONFLICT', '用户与平台的评估结算流水不一致')
    }
    if (!platformSettlement) {
      await tx.evaluationCreditAccount.update({ where: { id: platformReservation.accountId }, data: { reservedCredits: { decrement: platformStoredReserved }, consumedCredits: { increment: actual }, availableCredits: { increment: platformStoredReserved - actual }, version: { increment: 1 } } })
      await tx.evaluationCreditLedgerEntry.create({ data: { id: crypto.randomUUID(), accountId: platformReservation.accountId, type: 'settle', amount: platformStoredReserved - actual, idempotencyKey: `settle-platform:${input.taskType}:${input.taskId}`, taskType: input.taskType, taskId: input.taskId, metadata: { ...((input.metadata as any) || {}), actual, ledgerSemantics: 'unused_release_v2' } } })
    }
  }
  await tx.evaluationCreditAccount.update({ where: { id: reservation.accountId }, data: { reservedCredits: { decrement: storedReserved }, consumedCredits: { increment: actual }, availableCredits: { increment: storedReserved - actual }, version: { increment: 1 } } })
  return tx.evaluationCreditLedgerEntry.create({ data: { id: crypto.randomUUID(), accountId: reservation.accountId, type: 'settle', amount: storedReserved - actual, idempotencyKey: `settle:${input.taskType}:${input.taskId}`, taskType: input.taskType, taskId: input.taskId, metadata: { ...((input.metadata as any) || {}), actual, ledgerSemantics: 'unused_release_v2' } } })
}

export async function releaseEvaluationCredits(input: { taskType: string; taskId: string; reserved: number; reason: string }) { return settleEvaluationCredits({ taskType: input.taskType, taskId: input.taskId, reserved: input.reserved, actual: 0, metadata: { reason: input.reason } }) }
export async function releaseEvaluationCreditsInTransaction(tx: Prisma.TransactionClient, input: { taskType: string; taskId: string; reserved: number; reason: string }) { return settleEvaluationCreditsInTransaction(tx, { taskType: input.taskType, taskId: input.taskId, reserved: input.reserved, actual: 0, metadata: { reason: input.reason } }) }
export function usageCredits(input: { executions: number; cpuMs: number; generatedBytes: number }) { return Math.max(1, input.executions + Math.ceil(input.cpuMs / 100) + Math.ceil(input.generatedBytes / (1024 * 1024))) }

export async function reconcileEvaluationCreditReservations(limit = 100) {
  const reservations = await prisma.evaluationCreditReservation.findMany({ where: { status: 'reserved' }, orderBy: { createdAt: 'asc' }, take: limit })
  let settled = 0, released = 0, pending = 0, failed = 0
  const orphanCutoff = new Date(Date.now() - 10 * 60_000)
  for (const reservation of reservations) {
    try {
      if (reservation.taskType === 'candidate_generation') {
        const job = await prisma.problemDataGenerationJob.findUnique({ where: { id: reservation.taskId } })
        if (!job) {
          if (reservation.createdAt > orphanCutoff) { pending += 1; continue }
          await settleEvaluationCredits({ taskType: reservation.taskType, taskId: reservation.taskId, reserved: reservation.platformReserved, actual: 0, metadata: { reason: 'orphan_generation_reservation_reconciled' } })
          released += 1
          continue
        }
        if (!['cancelled', 'completed', 'failed', 'promoted'].includes(job.status)) { pending += 1; continue }
        const cases = await prisma.problemDataGenerationCase.findMany({ where: { jobId: job.id }, select: { generatorTimeMs: true, validatorTimeMs: true, standardTimeMs: true, inputSize: true, outputSize: true } })
        const actual = job.status === 'cancelled' ? 0 : usageCredits({ executions: cases.length * 4, cpuMs: cases.reduce((sum, item) => sum + (item.generatorTimeMs || 0) + (item.validatorTimeMs || 0) + (item.standardTimeMs || 0), 0), generatedBytes: cases.reduce((sum, item) => sum + (item.inputSize || 0) + (item.outputSize || 0), 0) })
        await settleEvaluationCredits({ taskType: reservation.taskType, taskId: reservation.taskId, reserved: reservation.platformReserved, actual, metadata: { reason: 'generation_terminal_reconciled', jobStatus: job.status } })
        if (actual) settled += 1; else released += 1
        continue
      }
      if (reservation.taskType === 'candidate_evaluation') {
        const runs = await prisma.candidateEvaluationRun.findMany({ where: { OR: [{ id: reservation.taskId }, { budgetTaskId: reservation.taskId }] }, orderBy: { createdAt: 'asc' } })
        if (!runs.length) {
          if (reservation.createdAt > orphanCutoff) { pending += 1; continue }
          await settleEvaluationCredits({ taskType: reservation.taskType, taskId: reservation.taskId, reserved: reservation.platformReserved, actual: 0, metadata: { reason: 'orphan_evaluation_reservation_reconciled' } })
          released += 1
          continue
        }
        const staleReserving = runs.filter(run => run.status === 'reserving' && run.createdAt <= orphanCutoff)
        if (staleReserving.length) await prisma.candidateEvaluationRun.updateMany({ where: { id: { in: staleReserving.map(run => run.id) }, status: 'reserving' }, data: { status: 'failed', finishedAt: new Date(), message: '预占阶段异常中断，已由资源对账任务释放' } })
        if (runs.some(run => ['reserving', 'queued', 'running'].includes(run.status) && !staleReserving.some(stale => stale.id === run.id))) { pending += 1; continue }
        const executions = runs.reduce((sum, run) => sum + run.executionCount, 0)
        const cpuMs = runs.reduce((sum, run) => sum + run.cpuMilliseconds, 0)
        const generatedBytes = runs.reduce((sum, run) => sum + Number(run.generatedBytes), 0)
        const actual = executions || cpuMs || generatedBytes ? usageCredits({ executions, cpuMs, generatedBytes }) : 0
        await settleEvaluationCredits({ taskType: reservation.taskType, taskId: reservation.taskId, reserved: reservation.platformReserved, actual, metadata: { reason: 'evaluation_terminal_reconciled' } })
        if (actual) settled += 1; else released += 1
        continue
      }
      pending += 1
    } catch {
      failed += 1
    }
  }
  return { scanned: reservations.length, settled, released, pending, failed }
}

export async function getUserEvaluationCreditOverview(userId: string) {
  const periodStart = dayStart()
  const [profile, account, wallet, activeReservations, settledReservations] = await Promise.all([
    contributionProfile(userId),
    prisma.evaluationCreditAccount.findUnique({ where: { subjectType_subjectId_periodStart: { subjectType: 'user', subjectId: userId, periodStart } } }),
    prisma.evaluationCreditWallet.findUnique({ where: { userId } }),
    prisma.evaluationCreditReservation.aggregate({ where: { userId, periodStart, status: 'reserved' }, _sum: { platformReserved: true } }),
    prisma.evaluationCreditReservation.aggregate({ where: { userId, periodStart, status: 'settled' }, _sum: { actualCredits: true } }),
  ])
  return { periodStart, resetsAt: new Date(periodStart.getTime() + 86_400_000), level: profile.level, contributionScore: profile.score, dailyLimit: account?.limitCredits === EVALUATION_LIMITS.managerDailyCredits ? EVALUATION_LIMITS.managerDailyCredits : profile.dailyLimit, free: { limit: account?.limitCredits || EVALUATION_LIMITS.normalDailyCredits, available: account?.availableCredits ?? EVALUATION_LIMITS.normalDailyCredits, reserved: account?.reservedCredits || 0, consumed: account?.consumedCredits || 0 }, purchased: { available: wallet?.availableCredits || 0, reserved: wallet?.reservedCredits || 0, consumed: (wallet?.consumedCredits || 0n).toString() }, today: { reserved: activeReservations._sum.platformReserved || 0, consumed: settledReservations._sum.actualCredits || 0 } }
}

export async function getEvaluationBudgetOverview() {
  const periodStart = dayStart()
  const [platform, users, candidates, blobs, orphanBlobs] = await Promise.all([prisma.evaluationCreditAccount.findUnique({ where: { subjectType_subjectId_periodStart: { subjectType: 'platform', subjectId: 'global', periodStart } } }), prisma.evaluationCreditAccount.findMany({ where: { subjectType: 'user', periodStart }, orderBy: { consumedCredits: 'desc' }, take: 100 }), prisma.testcaseCandidate.groupBy({ by: ['status'], _count: { _all: true }, _sum: { inputSize: true, outputSize: true } }), prisma.blobObject.aggregate({ _count: { _all: true }, _sum: { size: true } }), prisma.blobObject.aggregate({ where: { References: { none: {} } }, _count: { _all: true }, _sum: { size: true } })])
  const ledger = await prisma.evaluationCreditLedgerEntry.findMany({ where: { accountId: { in: [platform?.id, ...users.map(item => item.id)].filter((id): id is string => Boolean(id)) } }, orderBy: { createdAt: 'desc' }, take: 200 })
  return { periodStart, hardLimits: EVALUATION_LIMITS, platform: platform || { limitCredits: EVALUATION_LIMITS.platformDailyCredits, availableCredits: EVALUATION_LIMITS.platformDailyCredits, reservedCredits: 0, consumedCredits: 0 }, users, ledger, candidates: candidates.map(item => ({ status: item.status, count: item._count._all, bytes: Number(item._sum.inputSize || 0) + Number(item._sum.outputSize || 0) })), blobs: { count: blobs._count._all, bytes: Number(blobs._sum.size || 0), orphanCount: orphanBlobs._count._all, orphanBytes: Number(orphanBlobs._sum.size || 0) } }
}
