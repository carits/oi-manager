import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'

const POOL_ID = 'platform-deepseek'
const MAX_ACTIVE_PER_USER = Number(process.env.AI_MAX_ACTIVE_PER_USER || 1)
const MAX_HOURLY_PER_USER = Number(process.env.AI_MAX_HOURLY_PER_USER || 10)

export class AiTokenError extends Error { constructor(public statusCode: number, public code: string, message: string) { super(message) } }

async function lockPool(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-token-pool:${POOL_ID}`}, 0)) IS NULL AS locked`
  return tx.aiTokenPool.upsert({ where: { id: POOL_ID }, update: {}, create: {
    id: POOL_ID, availableTokens: BigInt(process.env.AI_TOKEN_INITIAL_BALANCE || 0),
  } })
}

async function ledger(tx: Prisma.TransactionClient, input: { type: string; amount: bigint; idempotencyKey: string; requestId?: string; operatorUserId?: string; reason?: string; metadata?: Prisma.InputJsonValue }) {
  const existing = await tx.aiTokenLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
  if (existing) return existing
  const pool = await tx.aiTokenPool.findUniqueOrThrow({ where: { id: POOL_ID } })
  return tx.aiTokenLedgerEntry.create({ data: {
    id: crypto.randomUUID(), poolId: POOL_ID, ...input,
    availableAfter: pool.availableTokens, reservedAfter: pool.reservedTokens, consumedAfter: pool.consumedTokens,
  } })
}

export async function reserveAiTokens(input: { requestId: string; userId: string; amount: number; problemId: string; action: string }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AiTokenError(400, 'AI_TOKEN_RESERVATION_INVALID', 'AI Token 预占量无效')
  return prisma.$transaction(async tx => {
    await lockPool(tx)
    const existingReservation = await tx.aiTokenLedgerEntry.findUnique({ where: { idempotencyKey: `reserve:${input.requestId}` } })
    if (existingReservation) return existingReservation
    const since = new Date(Date.now() - 60 * 60_000)
    const [active, recent] = await Promise.all([
      tx.aiGenerationRequest.count({ where: { userId: input.userId, id: { not: input.requestId }, status: { in: ['pending_reservation', 'reserved', 'running'] } } }),
      tx.aiGenerationRequest.count({ where: { userId: input.userId, id: { not: input.requestId }, createdAt: { gte: since } } }),
    ])
    if (active >= MAX_ACTIVE_PER_USER) throw new AiTokenError(429, 'AI_CONCURRENT_LIMIT', '当前已有 AI 请求正在执行')
    if (recent >= MAX_HOURLY_PER_USER) throw new AiTokenError(429, 'AI_RATE_LIMIT', '本小时 AI 请求次数已达上限')
    const changed = await tx.aiTokenPool.updateMany({ where: { id: POOL_ID, status: 'active', availableTokens: { gte: BigInt(input.amount) } }, data: {
      availableTokens: { decrement: BigInt(input.amount) }, reservedTokens: { increment: BigInt(input.amount) }, version: { increment: 1 },
    } })
    if (changed.count !== 1) throw new AiTokenError(402, 'AI_TOKEN_QUOTA_EXCEEDED', '平台 DeepSeek Token 额度不足')
    await ledger(tx, { type: 'reserve', amount: -BigInt(input.amount), idempotencyKey: `reserve:${input.requestId}`, requestId: input.requestId, operatorUserId: input.userId, metadata: { problemId: input.problemId, action: input.action } })
  })
}

export async function settleAiTokens(input: { requestId: string; userId: string; reserved: number; actual: number }) {
  const actual = Math.max(0, Math.ceil(Number(input.actual || 0)))
  return prisma.$transaction(async tx => {
    await lockPool(tx)
    const exists = await tx.aiTokenLedgerEntry.findFirst({
      where: { requestId: input.requestId, type: { in: ['settle', 'release'] } },
      orderBy: { createdAt: 'asc' },
    })
    if (exists) return exists
    await tx.aiTokenPool.update({ where: { id: POOL_ID }, data: {
      reservedTokens: { decrement: BigInt(input.reserved) }, consumedTokens: { increment: BigInt(actual) },
      availableTokens: { increment: BigInt(input.reserved - actual) }, version: { increment: 1 },
    } })
    return ledger(tx, { type: 'settle', amount: -BigInt(actual), idempotencyKey: `settle:${input.requestId}`, requestId: input.requestId, operatorUserId: input.userId, metadata: { reserved: input.reserved, actual } })
  })
}

export async function releaseAiTokens(input: { requestId: string; userId: string; reserved: number; reason: string }) {
  return prisma.$transaction(async tx => {
    await lockPool(tx)
    const exists = await tx.aiTokenLedgerEntry.findFirst({
      where: { requestId: input.requestId, type: { in: ['settle', 'release'] } },
      orderBy: { createdAt: 'asc' },
    })
    if (exists) return exists
    await tx.aiTokenPool.update({ where: { id: POOL_ID }, data: { reservedTokens: { decrement: BigInt(input.reserved) }, availableTokens: { increment: BigInt(input.reserved) }, version: { increment: 1 } } })
    return ledger(tx, { type: 'release', amount: BigInt(input.reserved), idempotencyKey: `release:${input.requestId}`, requestId: input.requestId, operatorUserId: input.userId, reason: input.reason })
  })
}

export async function getAiTokenPool() {
  const pool = await prisma.aiTokenPool.upsert({ where: { id: POOL_ID }, update: {}, create: { id: POOL_ID, availableTokens: BigInt(process.env.AI_TOKEN_INITIAL_BALANCE || 0) } })
  return { ...pool, availableTokens: pool.availableTokens.toString(), reservedTokens: pool.reservedTokens.toString(), consumedTokens: pool.consumedTokens.toString() }
}

export async function listAiTokenUsage() {
  const [pool, entries] = await Promise.all([getAiTokenPool(), prisma.aiTokenLedgerEntry.findMany({ where: { poolId: POOL_ID }, orderBy: { createdAt: 'desc' }, take: 200 })])
  return { pool, entries: entries.map(item => ({ ...item, amount: item.amount.toString(), availableAfter: item.availableAfter.toString(), reservedAfter: item.reservedAfter.toString(), consumedAfter: item.consumedAfter.toString() })) }
}

export async function adjustAiTokenPool(input: { amount: number; idempotencyKey: string; operatorUserId: string; reason: string }) {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new AiTokenError(400, 'AI_TOKEN_ADJUSTMENT_INVALID', '调整 Token 必须是非零整数')
  if (!input.idempotencyKey?.trim() || !input.reason?.trim()) throw new AiTokenError(400, 'AI_TOKEN_AUDIT_REQUIRED', '必须提供幂等键和调整原因')
  return prisma.$transaction(async tx => {
    await lockPool(tx)
    const existing = await tx.aiTokenLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
    if (existing) return existing
    const pool = await tx.aiTokenPool.findUniqueOrThrow({ where: { id: POOL_ID } })
    if (pool.availableTokens + BigInt(input.amount) < 0n) throw new AiTokenError(409, 'AI_TOKEN_BALANCE_NEGATIVE', '调整后可用 Token 不能为负数')
    await tx.aiTokenPool.update({ where: { id: POOL_ID }, data: { availableTokens: { increment: BigInt(input.amount) }, version: { increment: 1 } } })
    return ledger(tx, { type: 'adjust', amount: BigInt(input.amount), idempotencyKey: input.idempotencyKey, operatorUserId: input.operatorUserId, reason: input.reason })
  })
}
