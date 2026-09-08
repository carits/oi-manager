import crypto from 'node:crypto'
import { Prisma, type CaritsAccountOwnerType } from '@prisma/client'
import { prisma } from '../../../prisma'

export class CaritsLedgerError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

export type CaritsAccountOwner =
  | { ownerType: 'USER'; userId: string }
  | { ownerType: 'ORGANIZATION'; organizationId: string }
  | { ownerType: 'SYSTEM'; systemKey: string }

type EntryInput = { owner: CaritsAccountOwner; amount: bigint; allowNegative?: boolean }

function accountIdentity(owner: CaritsAccountOwner) {
  return owner.ownerType === 'USER'
    ? `user:${owner.userId}`
    : owner.ownerType === 'ORGANIZATION'
      ? `organization:${owner.organizationId}`
      : `system:${owner.systemKey}`
}

function accountId(owner: CaritsAccountOwner) {
  return crypto.createHash('sha256').update(`carits\0${accountIdentity(owner)}`).digest('hex')
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]))
  }
  return value
}

function transactionFingerprint(input: { type: string; referenceType?: string | null; referenceId?: string | null; operatorUserId?: string | null; organizationId?: string | null; metadata?: unknown }, entries: Array<{ identity: string; amount: bigint }>) {
  return crypto.createHash('sha256').update(JSON.stringify({
    type: input.type,
    referenceType: input.referenceType || null,
    referenceId: input.referenceId || null,
    operatorUserId: input.operatorUserId || null,
    organizationId: input.organizationId || null,
    metadata: canonicalJson(input.metadata ?? null),
    entries: entries.map(entry => ({ identity: entry.identity, amount: entry.amount.toString() })).sort((left, right) => left.identity.localeCompare(right.identity)),
  })).digest('hex')
}

function storedAccountIdentity(account: { ownerType: string; userId: string | null; organizationId: string | null; systemKey: string | null }) {
  if (account.ownerType === 'USER') return `user:${account.userId}`
  if (account.ownerType === 'ORGANIZATION') return `organization:${account.organizationId}`
  return `system:${account.systemKey}`
}

export async function getOrCreateCaritsAccount(tx: Prisma.TransactionClient, owner: CaritsAccountOwner) {
  const id = accountId(owner)
  return tx.caritsAccount.upsert({
    where: { id },
    update: {},
    create: {
      id,
      ownerType: owner.ownerType as CaritsAccountOwnerType,
      userId: owner.ownerType === 'USER' ? owner.userId : null,
      organizationId: owner.ownerType === 'ORGANIZATION' ? owner.organizationId : null,
      systemKey: owner.ownerType === 'SYSTEM' ? owner.systemKey : null,
    },
  })
}

export async function postCaritsTransaction(tx: Prisma.TransactionClient, input: {
  type: string
  idempotencyKey: string
  referenceType?: string
  referenceId?: string
  operatorUserId?: string
  organizationId?: string
  metadata?: Prisma.InputJsonValue
  entries: EntryInput[]
}) {
  if (input.entries.length < 2 || input.entries.some(item => item.amount === 0n)) {
    throw new CaritsLedgerError(422, 'CARITS_TRANSACTION_INVALID', '账本交易必须包含至少两条非零分录')
  }
  const total = input.entries.reduce((sum, item) => sum + item.amount, 0n)
  if (total !== 0n) throw new CaritsLedgerError(422, 'CARITS_TRANSACTION_UNBALANCED', '账本交易分录金额必须平衡')
  const aggregated = new Map<string, { owner: CaritsAccountOwner; amount: bigint; allowNegative: boolean }>()
  for (const entry of input.entries) {
    const key = accountIdentity(entry.owner), current = aggregated.get(key)
    aggregated.set(key, { owner: entry.owner, amount: (current?.amount || 0n) + entry.amount, allowNegative: Boolean(current?.allowNegative || entry.allowNegative) })
  }
  const entries = [...aggregated.values()].filter(item => item.amount !== 0n).sort((left, right) => accountIdentity(left.owner).localeCompare(accountIdentity(right.owner)))
  if (entries.length < 2) throw new CaritsLedgerError(422, 'CARITS_TRANSACTION_INVALID', '交易聚合后必须影响至少两个账户')
  const requestFingerprint = transactionFingerprint(input, entries.map(entry => ({ identity: accountIdentity(entry.owner), amount: entry.amount })))
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`carits-transaction:${input.idempotencyKey}`}, 0)) IS NULL AS locked`
  const existing = await tx.caritsTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { Entries: { include: { Account: true } } } })
  if (existing) {
    const existingFingerprint = existing.requestFingerprint || transactionFingerprint(existing, existing.Entries.map(entry => ({ identity: storedAccountIdentity(entry.Account), amount: entry.amount })))
    if (existingFingerprint !== requestFingerprint) throw new CaritsLedgerError(409, 'IDEMPOTENCY_KEY_REUSED', '同一幂等键不能用于不同的 Carits 账本交易')
    if (existing.status !== 'posted') throw new CaritsLedgerError(409, 'CARITS_TRANSACTION_INCOMPLETE', '幂等键对应的 Carits 交易未完成入账')
    return existing
  }
  const accounts = await Promise.all(entries.map(item => getOrCreateCaritsAccount(tx, item.owner)))
  const ids = accounts.map(item => item.id).sort()
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CaritsAccount" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`)
  const byId = new Map((await tx.caritsAccount.findMany({ where: { id: { in: ids } } })).map(item => [item.id, item]))
  for (let index = 0; index < entries.length; index += 1) {
    const account = byId.get(accounts[index].id)!
    if (!entries[index].allowNegative && account.balance + entries[index].amount < 0n) {
      throw new CaritsLedgerError(409, 'CARITS_BALANCE_INSUFFICIENT', 'Carits币余额不足')
    }
  }
  const transaction = await tx.caritsTransaction.create({ data: {
    id: crypto.randomUUID(), type: input.type, status: 'draft', idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    referenceType: input.referenceType || null, referenceId: input.referenceId || null,
    operatorUserId: input.operatorUserId || null, organizationId: input.organizationId || null,
    metadata: input.metadata,
  } })
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index], account = accounts[index]
    const updated = await tx.caritsAccount.update({ where: { id: account.id }, data: { balance: { increment: entry.amount }, version: { increment: 1 } } })
    await tx.caritsLedgerEntry.create({ data: { id: crypto.randomUUID(), transactionId: transaction.id, accountId: account.id, amount: entry.amount, balanceAfter: updated.balance } })
  }
  return tx.caritsTransaction.update({ where: { id: transaction.id }, data: { status: 'posted', postedAt: new Date() } })
}

function isTransientTransactionError(error: any) {
  const databaseCode = error?.meta?.code || error?.meta?.database_error_code
  return error?.code === '40P01'
    || error?.code === '40001'
    || error?.code === 'P2034'
    || databaseCode === '40P01'
    || databaseCode === '40001'
}

export async function postCarits(input: Parameters<typeof postCaritsTransaction>[1]) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await prisma.$transaction(tx => postCaritsTransaction(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      lastError = error
      if (!isTransientTransactionError(error) || attempt === 5) throw error
      await new Promise(resolve => setTimeout(resolve, 10 * attempt * attempt))
    }
  }
  throw lastError
}

export async function reverseCaritsTransaction(tx: Prisma.TransactionClient, input: { transactionId: string; idempotencyKey: string; operatorUserId: string; reason: string }) {
  const original = await tx.caritsTransaction.findUnique({ where: { id: input.transactionId }, include: { Entries: { include: { Account: true } } } })
  if (!original || original.status !== 'posted') throw new CaritsLedgerError(409, 'CARITS_TRANSACTION_NOT_POSTED', '原交易不存在或尚未入账')
  return postCaritsTransaction(tx, {
    type: 'contribution_reward_reversal', idempotencyKey: input.idempotencyKey,
    referenceType: 'carits_transaction', referenceId: original.id, operatorUserId: input.operatorUserId,
    metadata: { reason: input.reason },
    entries: original.Entries.map(entry => ({
      owner: entry.Account.ownerType === 'USER' ? { ownerType: 'USER' as const, userId: entry.Account.userId! }
        : entry.Account.ownerType === 'ORGANIZATION' ? { ownerType: 'ORGANIZATION' as const, organizationId: entry.Account.organizationId! }
          : { ownerType: 'SYSTEM' as const, systemKey: entry.Account.systemKey! },
      amount: -entry.amount,
      allowNegative: entry.Account.ownerType === 'SYSTEM' || entry.Account.ownerType === 'USER',
    })),
  })
}
