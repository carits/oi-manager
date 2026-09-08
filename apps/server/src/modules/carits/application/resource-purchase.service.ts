import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { postCaritsTransaction } from './carits-ledger.service'
import { contributionProfile, dayStart, getUserEvaluationCreditOverview } from '../../problem/problem.evaluation-budget.service'

export const EVALUATION_PACKAGES = Object.freeze([
  { packageCode: 'EVAL_5K', carits: 10n, credits: 5_000 },
  { packageCode: 'EVAL_20K', carits: 40n, credits: 20_000 },
  { packageCode: 'EVAL_50K', carits: 100n, credits: 50_000 },
])
const POLICY_CODE = 'evaluation_credit_exchange'
const POLICY_VERSION = 1
const DAILY_CARITS_CAP = 200n
const SERIALIZABLE_ATTEMPTS = 5

export class ResourcePurchaseError extends Error {
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

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try { return await operation() }
    catch (error) {
      lastError = error
      if (!isTransientTransactionError(error) || attempt === SERIALIZABLE_ATTEMPTS) throw error
      await new Promise(resolve => setTimeout(resolve, 10 * attempt * attempt))
    }
  }
  throw lastError
}

function walletId(userId: string) { return crypto.createHash('sha256').update(`evaluation-wallet\0${userId}`).digest('hex') }

export function listEvaluationPackages() {
  return EVALUATION_PACKAGES.map(item => ({ ...item, carits: item.carits.toString(), exchangeRate: 500, policyCode: POLICY_CODE, policyVersion: POLICY_VERSION }))
}

export async function purchaseEvaluationCredits(input: { userId: string; packageCode: string; idempotencyKey: string }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) throw new ResourcePurchaseError(400, 'IDEMPOTENCY_KEY_REQUIRED', '购买请求需要 UUID 格式的 Idempotency-Key')
  const selected = EVALUATION_PACKAGES.find(item => item.packageCode === input.packageCode)
  if (!selected) throw new ResourcePurchaseError(400, 'RESOURCE_PACKAGE_INVALID', 'Evaluation Credits 套餐不存在')
  return withSerializableRetry(() => prisma.$transaction(async tx => {
    const periodStart = dayStart()
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`resource-purchase:${input.idempotencyKey}`}, 0)) IS NULL AS locked`
    const existing = await tx.resourcePurchase.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
    if (existing) {
      if (existing.userId !== input.userId || existing.packageCode !== input.packageCode) throw new ResourcePurchaseError(409, 'IDEMPOTENCY_KEY_REUSED', '同一幂等键不能用于不同购买请求')
      return existing
    }
    // The daily purchase cap is a per-user aggregate. Serialize different
    // idempotency keys for the same user/day so two concurrent purchases cannot
    // both validate against the same pre-transaction total.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`resource-purchase:user:${input.userId}:${periodStart.toISOString()}`}, 0)) IS NULL AS locked`
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { status: true } })
    if (!user || user.status !== 'active') throw new ResourcePurchaseError(403, 'RESOURCE_PURCHASE_NOT_ALLOWED', '当前账号不能购买资源')
    const todaySpent = await tx.resourcePurchase.aggregate({ where: { userId: input.userId, status: 'posted', createdAt: { gte: periodStart } }, _sum: { caritsAmount: true } })
    if ((todaySpent._sum.caritsAmount || 0n) + selected.carits > DAILY_CARITS_CAP) throw new ResourcePurchaseError(429, 'EVALUATION_PURCHASE_DAILY_LIMIT', '每天最多使用 200 Carits币购买评估额度')
    const profile = await contributionProfile(input.userId, tx)
    const currentCarits = await tx.caritsAccount.findUnique({ where: { userId: input.userId } })
    if (currentCarits && currentCarits.balance < 0n) throw new ResourcePurchaseError(409, 'CARITS_DEBT_OUTSTANDING', '存在待偿还 Carits币债务，暂不能购买资源')
    const wallet = await tx.evaluationCreditWallet.upsert({ where: { userId: input.userId }, update: {}, create: { id: walletId(input.userId), userId: input.userId } })
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "EvaluationCreditWallet" WHERE "id" = ${wallet.id} FOR UPDATE`)
    const transaction = await postCaritsTransaction(tx, {
      type: 'evaluation_credit_purchase', idempotencyKey: `resource-purchase:${input.idempotencyKey}`,
      referenceType: 'resource_purchase', referenceId: input.idempotencyKey, operatorUserId: input.userId,
      metadata: { packageCode: selected.packageCode, credits: selected.credits, policyCode: POLICY_CODE, policyVersion: POLICY_VERSION },
      entries: [
        { owner: { ownerType: 'USER', userId: input.userId }, amount: -selected.carits },
        { owner: { ownerType: 'SYSTEM', systemKey: 'RESOURCE_SINK' }, amount: selected.carits, allowNegative: true },
      ],
    })
    const purchaseId = crypto.randomUUID()
    const updated = await tx.evaluationCreditWallet.update({ where: { id: wallet.id }, data: { availableCredits: { increment: selected.credits }, version: { increment: 1 } } })
    const walletEntry = await tx.evaluationCreditWalletEntry.create({ data: { id: crypto.randomUUID(), walletId: wallet.id, type: 'purchase', amount: selected.credits, balanceAfter: updated.availableCredits, idempotencyKey: `purchase:${input.idempotencyKey}`, referenceType: 'resource_purchase', referenceId: purchaseId, metadata: { levelAtPurchase: profile.level } } })
    return tx.resourcePurchase.create({ data: { id: purchaseId, userId: input.userId, packageCode: selected.packageCode, caritsAmount: selected.carits, evaluationCredits: selected.credits, policyCode: POLICY_CODE, policyVersion: POLICY_VERSION, status: 'posted', idempotencyKey: input.idempotencyKey, caritsTransactionId: transaction.id, walletEntryId: walletEntry.id } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))
}

export async function listEvaluationPurchases(userId: string) {
  const items = await prisma.resourcePurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 })
  return { items: items.map(item => ({ ...item, caritsAmount: item.caritsAmount.toString() })) }
}

export async function getEvaluationResourceOverview(userId: string) {
  const [credits, purchases] = await Promise.all([getUserEvaluationCreditOverview(userId), listEvaluationPurchases(userId)])
  return { ...credits, packages: listEvaluationPackages(), recentPurchases: purchases.items.slice(0, 10) }
}
