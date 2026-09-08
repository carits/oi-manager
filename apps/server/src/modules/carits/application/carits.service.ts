import { prisma } from '../../../prisma'

type Account = { id: string; balance: bigint; createdAt: Date; updatedAt: Date }

export class CaritsApplicationError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

function serializeAccount(account: Account | null) {
  const balance = account?.balance || 0n
  return account
    ? {
        accountStatus: 'active' as const, accountId: account.id, balance: balance.toString(),
        availableBalance: (balance > 0n ? balance : 0n).toString(), debtBalance: (balance < 0n ? -balance : 0n).toString(),
        createdAt: account.createdAt, updatedAt: account.updatedAt,
      }
    : {
        accountStatus: 'empty' as const,
        balance: '0',
        availableBalance: '0',
        debtBalance: '0',
      }
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
      Organization: {
        status: 'active',
        School: { is: { status: 'active', directoryStatus: { not: 'legacy' } } },
      },
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
  const [accounts, transactions, rewards, purchases] = await Promise.all([
    prisma.caritsAccount.findMany({
      select: { id: true, ownerType: true, systemKey: true, balance: true, status: true, createdAt: true, User: { select: { username: true } }, Organization: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }, take: 100,
    }),
    prisma.caritsTransaction.findMany({
      where: { status: 'posted' }, orderBy: { postedAt: 'desc' }, take: 100,
      select: { id: true, type: true, referenceType: true, referenceId: true, postedAt: true, Entries: { select: { amount: true, Account: { select: { ownerType: true, systemKey: true, User: { select: { username: true } }, Organization: { select: { name: true } } } } } } },
    }),
    prisma.contributionRewardDelivery.aggregate({ where: { status: { in: ['posted', 'reversed'] } }, _sum: { userCarits: true, organizationCarits: true }, _count: { _all: true } }),
    prisma.resourcePurchase.aggregate({ where: { status: 'posted' }, _sum: { caritsAmount: true, evaluationCredits: true }, _count: { _all: true } }),
  ])
  const ownerLabel = (account: { ownerType: string; systemKey?: string | null; User?: { username: string } | null; Organization?: { name: string } | null }) => account.ownerType === 'SYSTEM' ? account.systemKey || '系统' : account.ownerType === 'USER' ? account.User?.username || '用户' : account.Organization?.name || '组织'
  return {
    currency: 'Carits币',
    summary: {
      rewardedCarits: ((rewards._sum.userCarits || 0n) + (rewards._sum.organizationCarits || 0n)).toString(),
      rewardCount: rewards._count._all,
      spentCarits: (purchases._sum.caritsAmount || 0n).toString(),
      purchasedCredits: purchases._sum.evaluationCredits || 0,
      purchaseCount: purchases._count._all,
    },
    items: accounts.map(account => ({ id: account.id, ownerType: account.ownerType, ownerLabel: ownerLabel(account), balance: account.balance.toString(), status: account.status, createdAt: account.createdAt })),
    transactions: transactions.map(({ Entries, ...transaction }) => ({
      ...transaction,
      entries: Entries.map(entry => ({ amount: entry.amount.toString(), ownerType: entry.Account.ownerType, ownerLabel: ownerLabel(entry.Account) })),
    })),
  }
}
