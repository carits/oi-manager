import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'

export const EVALUATION_LIMITS = Object.freeze({
  direct: { executions: 400, cpuMs: 60_000, generatedBytes: 32 * 1024 * 1024, persistentLogBytes: 512 * 1024 },
  generator: { executions: 4_000, cpuMs: 300_000, generatedBytes: 256 * 1024 * 1024, persistentLogBytes: 1024 * 1024 },
  maxCandidateBytes: 16 * 1024 * 1024,
  normalDailyCredits: 10_000,
  managerDailyCredits: 100_000,
  platformDailyCredits: 250_000,
  maxHotCandidates: 5_000,
  maxHotBytes: 2 * 1024 * 1024 * 1024,
  maxTopK: 1_000,
  maxCorpusClusters: 512,
  maxFeatures: 128,
  maxSubtasks: 64,
  maxRevisions: 10_000,
})

export class EvaluationBudgetError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

function dayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function accountId(subjectType: string, subjectId: string, periodStart: Date) {
  return crypto.createHash('sha256').update(`${subjectType}\0${subjectId}\0${periodStart.toISOString()}`).digest('hex')
}

async function ensureAccount(tx: Prisma.TransactionClient, subjectType: string, subjectId: string, limit: number, periodStart: Date) {
  return tx.evaluationCreditAccount.upsert({
    where: { subjectType_subjectId_periodStart: { subjectType, subjectId, periodStart } },
    update: {},
    create: { id: accountId(subjectType, subjectId, periodStart), subjectType, subjectId, periodStart, limitCredits: limit, availableCredits: limit },
  })
}

export async function reserveEvaluationCredits(input: {
  userId: string
  manager: boolean
  taskType: string
  taskId: string
  credits: number
  metadata?: Prisma.InputJsonValue
}) {
  if (!Number.isInteger(input.credits) || input.credits <= 0) throw new EvaluationBudgetError(400, 'EVALUATION_BUDGET_INVALID', '评估预算无效')
  const periodStart = dayStart()
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evaluation-budget:platform:${periodStart.toISOString()}`}, 0)) IS NULL AS locked`
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evaluation-budget:${input.userId}:${periodStart.toISOString()}`}, 0)) IS NULL AS locked`
    const idempotencyKey = `reserve:${input.taskType}:${input.taskId}`
    const existing = await tx.evaluationCreditLedgerEntry.findUnique({ where: { idempotencyKey } })
    if (existing) return existing
    const account = await ensureAccount(tx, 'user', input.userId, input.manager ? EVALUATION_LIMITS.managerDailyCredits : EVALUATION_LIMITS.normalDailyCredits, periodStart)
    const platformAccount = await ensureAccount(tx, 'platform', 'global', EVALUATION_LIMITS.platformDailyCredits, periodStart)
    const [changed, platformChanged] = await Promise.all([tx.evaluationCreditAccount.updateMany({
      where: { id: account.id, availableCredits: { gte: input.credits } },
      data: { availableCredits: { decrement: input.credits }, reservedCredits: { increment: input.credits }, version: { increment: 1 } },
    }), tx.evaluationCreditAccount.updateMany({
      where: { id: platformAccount.id, availableCredits: { gte: input.credits } },
      data: { availableCredits: { decrement: input.credits }, reservedCredits: { increment: input.credits }, version: { increment: 1 } },
    })])
    if (changed.count !== 1) throw new EvaluationBudgetError(429, 'EVALUATION_BUDGET_EXCEEDED', '今日评估资源额度不足')
    if (platformChanged.count !== 1) throw new EvaluationBudgetError(429, 'EVALUATION_PLATFORM_BUDGET_EXCEEDED', '平台今日评估资源额度不足')
    const userEntry = await tx.evaluationCreditLedgerEntry.create({ data: {
      id: crypto.randomUUID(), accountId: account.id, type: 'reserve', amount: -input.credits,
      idempotencyKey, taskType: input.taskType, taskId: input.taskId, metadata: input.metadata,
    } })
    await tx.evaluationCreditLedgerEntry.create({ data: {
      id: crypto.randomUUID(), accountId: platformAccount.id, type: 'reserve', amount: -input.credits,
      idempotencyKey: `reserve-platform:${input.taskType}:${input.taskId}`, taskType: input.taskType, taskId: input.taskId, metadata: input.metadata,
    } })
    return userEntry
  })
}

export async function settleEvaluationCredits(input: { taskType: string; taskId: string; reserved: number; actual: number; metadata?: Prisma.InputJsonValue }) {
  const actual = Math.max(0, Math.min(input.reserved, Math.ceil(input.actual)))
  return prisma.$transaction(async tx => {
    const reservation = await tx.evaluationCreditLedgerEntry.findUnique({ where: { idempotencyKey: `reserve:${input.taskType}:${input.taskId}` } })
    if (!reservation) return null
    const platformReservation = await tx.evaluationCreditLedgerEntry.findUnique({ where: { idempotencyKey: `reserve-platform:${input.taskType}:${input.taskId}` } })
    const idempotencyKey = `settle:${input.taskType}:${input.taskId}`
    if (platformReservation) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evaluation-account:${platformReservation.accountId}`}, 0)) IS NULL AS locked`
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evaluation-account:${reservation.accountId}`}, 0)) IS NULL AS locked`
    const existing = await tx.evaluationCreditLedgerEntry.findUnique({ where: { idempotencyKey } })
    if (existing) return existing
    await tx.evaluationCreditAccount.update({ where: { id: reservation.accountId }, data: {
      reservedCredits: { decrement: input.reserved }, consumedCredits: { increment: actual }, availableCredits: { increment: input.reserved - actual }, version: { increment: 1 },
    } })
    const userEntry = await tx.evaluationCreditLedgerEntry.create({ data: { id: crypto.randomUUID(), accountId: reservation.accountId, type: 'settle', amount: -actual, idempotencyKey, taskType: input.taskType, taskId: input.taskId, metadata: input.metadata } })
    if (platformReservation) {
      const platformSettleKey = `settle-platform:${input.taskType}:${input.taskId}`
      const platformSettled = await tx.evaluationCreditLedgerEntry.findUnique({ where: { idempotencyKey: platformSettleKey } })
      if (!platformSettled) {
        await tx.evaluationCreditAccount.update({ where: { id: platformReservation.accountId }, data: {
          reservedCredits: { decrement: input.reserved }, consumedCredits: { increment: actual }, availableCredits: { increment: input.reserved - actual }, version: { increment: 1 },
        } })
        await tx.evaluationCreditLedgerEntry.create({ data: { id: crypto.randomUUID(), accountId: platformReservation.accountId, type: 'settle', amount: -actual, idempotencyKey: platformSettleKey, taskType: input.taskType, taskId: input.taskId, metadata: input.metadata } })
      }
    }
    return userEntry
  })
}

export async function releaseEvaluationCredits(input: { taskType: string; taskId: string; reserved: number; reason: string }) {
  return settleEvaluationCredits({ taskType: input.taskType, taskId: input.taskId, reserved: input.reserved, actual: 0, metadata: { reason: input.reason } })
}

export function usageCredits(input: { executions: number; cpuMs: number; generatedBytes: number }) {
  return Math.max(1, input.executions + Math.ceil(input.cpuMs / 100) + Math.ceil(input.generatedBytes / (1024 * 1024)))
}

export async function getEvaluationBudgetOverview() {
  const periodStart = dayStart()
  const [platform, users, candidates, blobs, orphanBlobs] = await Promise.all([
    prisma.evaluationCreditAccount.findUnique({ where: { subjectType_subjectId_periodStart: { subjectType: 'platform', subjectId: 'global', periodStart } } }),
    prisma.evaluationCreditAccount.findMany({ where: { subjectType: 'user', periodStart }, orderBy: { consumedCredits: 'desc' }, take: 100 }),
    prisma.testcaseCandidate.groupBy({ by: ['status'], _count: { _all: true }, _sum: { inputSize: true, outputSize: true } }),
    prisma.blobObject.aggregate({ _count: { _all: true }, _sum: { size: true } }),
    prisma.blobObject.aggregate({ where: { References: { none: {} } }, _count: { _all: true }, _sum: { size: true } }),
  ])
  const ledger = await prisma.evaluationCreditLedgerEntry.findMany({ where: { accountId: { in: [platform?.id, ...users.map(item => item.id)].filter((id): id is string => Boolean(id)) } }, orderBy: { createdAt: 'desc' }, take: 200 })
  return {
    periodStart,
    hardLimits: EVALUATION_LIMITS,
    platform: platform || { limitCredits: EVALUATION_LIMITS.platformDailyCredits, availableCredits: EVALUATION_LIMITS.platformDailyCredits, reservedCredits: 0, consumedCredits: 0 },
    users,
    ledger,
    candidates: candidates.map(item => ({ status: item.status, count: item._count._all, bytes: Number(item._sum.inputSize || 0) + Number(item._sum.outputSize || 0) })),
    blobs: { count: blobs._count._all, bytes: Number(blobs._sum.size || 0), orphanCount: orphanBlobs._count._all, orphanBytes: Number(orphanBlobs._sum.size || 0) },
  }
}
