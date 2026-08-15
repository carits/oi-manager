import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { prisma } from '../../prisma'
import { hasOrganizationWalletAccess, isPlatformAdministrator } from '../featureAvailability'

export const caritsRouter = Router()

function requireOrganization(req: any, res: any) {
  const organizationId = String(req.params.organizationId || '')
  if (!hasOrganizationWalletAccess(req.user, organizationId)) {
    res.status(403).json({ success: false, message: '无权访问该校园的 Carits币信息' })
    return false
  }
  return true
}

function serializeAccount(account: { id: string; balance: bigint; createdAt: Date; updatedAt: Date } | null) {
  return account
    ? { accountStatus: 'active' as const, accountId: account.id, balance: account.balance.toString(), createdAt: account.createdAt, updatedAt: account.updatedAt }
    : { accountStatus: 'empty' as const }
}

async function transactionsFor(accountId?: string) {
  if (!accountId) return []
  const entries = await prisma.caritsLedgerEntry.findMany({
    where: { accountId, Transaction: { status: 'posted' } },
    include: { Transaction: { select: { type: true, referenceType: true, referenceId: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
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

caritsRouter.get('/me', asyncHandler(async (req, res) => {
  const account = await prisma.caritsAccount.findUnique({ where: { userId: req.user!.userId }, select: { id: true, balance: true, createdAt: true, updatedAt: true } })
  res.json({ success: true, data: { currency: 'Carits币', ...serializeAccount(account) } })
}))

caritsRouter.get('/me/transactions', asyncHandler(async (req, res) => {
  const account = await prisma.caritsAccount.findUnique({ where: { userId: req.user!.userId }, select: { id: true, balance: true, createdAt: true, updatedAt: true } })
  res.json({ success: true, data: { currency: 'Carits币', ...serializeAccount(account), items: await transactionsFor(account?.id) } })
}))

caritsRouter.get('/organizations/:organizationId', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  const account = await prisma.caritsAccount.findUnique({ where: { organizationId: req.params.organizationId }, select: { id: true, balance: true, createdAt: true, updatedAt: true } })
  res.json({ success: true, data: { currency: 'Carits币', ...serializeAccount(account) } })
}))

caritsRouter.get('/organizations/:organizationId/transactions', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  const account = await prisma.caritsAccount.findUnique({ where: { organizationId: req.params.organizationId }, select: { id: true, balance: true, createdAt: true, updatedAt: true } })
  res.json({ success: true, data: { currency: 'Carits币', ...serializeAccount(account), items: await transactionsFor(account?.id) } })
}))

caritsRouter.get('/platform', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) {
    return res.status(403).json({ success: false, message: '仅平台管理员可查看 Carits币审计入口' })
  }
  const accounts = await prisma.caritsAccount.findMany({
    select: { id: true, ownerType: true, balance: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  res.json({ success: true, data: { currency: 'Carits币', items: accounts.map(account => ({ ...account, balance: account.balance.toString() })) } })
}))
