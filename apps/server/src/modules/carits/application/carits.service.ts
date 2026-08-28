import { prisma } from '../../../prisma'

type Account = { id: string; balance: bigint; createdAt: Date; updatedAt: Date }

export class CaritsApplicationError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

function serializeAccount(account: Account | null) {
  return account
    ? {
        accountStatus: 'active' as const, accountId: account.id, balance: account.balance.toString(),
        createdAt: account.createdAt, updatedAt: account.updatedAt,
      }
    : { accountStatus: 'empty' as const }
}

async function transactionsFor(accountId?: string) {
  if (!accountId) return []
  const entries = await prisma.caritsLedgerEntry.findMany({
    where: { accountId, Transaction: { status: 'posted' } },
    include: { Transaction: { select: { type: true, referenceType: true, referenceId: true } } },
    orderBy: { createdAt: 'desc' }, take: 100,
  })
  return entries.map(entry => ({
    id: entry.id,
    type: entry.Transaction.type,
    source: entry.Transaction.referenceType || '系统账本',
    referenceId: entry.Transaction.referenceId,
    amount: entry.amount.toString(),
    balanceAfter: entry.balanceAfter.toString(),
    createdAt: entry.createdAt,
  }))
}

async function requireOrganizationManager(userId: string, organizationId: string) {
  const membership = await prisma.organizationMembership.findFirst({
    where: {
      organizationId, userId, status: 'active', memberRole: { in: ['school_principal', 'teacher'] },
    },
    select: { id: true },
  })
  if (!membership) throw new CaritsApplicationError(403, '无权访问该校园的 Carits币信息')
}

export async function getPersonalCaritsAccount(userId: string, includeTransactions = false) {
  const account = await prisma.caritsAccount.findUnique({
    where: { userId }, select: { id: true, balance: true, createdAt: true, updatedAt: true },
  })
  return {
    currency: 'Carits币',
    ...serializeAccount(account),
    ...(includeTransactions ? { items: await transactionsFor(account?.id) } : {}),
  }
}

export async function getOrganizationCaritsAccount(
  userId: string,
  organizationId: string,
  includeTransactions = false,
) {
  await requireOrganizationManager(userId, organizationId)
  const account = await prisma.caritsAccount.findUnique({
    where: { organizationId }, select: { id: true, balance: true, createdAt: true, updatedAt: true },
  })
  return {
    currency: 'Carits币',
    ...serializeAccount(account),
    ...(includeTransactions ? { items: await transactionsFor(account?.id) } : {}),
  }
}

export async function listPlatformCaritsAccounts() {
  const accounts = await prisma.caritsAccount.findMany({
    select: { id: true, ownerType: true, balance: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take: 100,
  })
  return {
    currency: 'Carits币', items: accounts.map(account => ({ ...account, balance: account.balance.toString() })),
  }
}
