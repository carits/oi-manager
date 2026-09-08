import crypto from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '../../../prisma'
import { getOrCreateCaritsAccount } from '../../carits/application/carits-ledger.service'

function hash(value: unknown) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }

export async function inspectEconomyLoopMigration(client: Prisma.TransactionClient | PrismaClient = prisma) {
  const [invalidAccounts, orphanEvaluationEntries, invalidTransactions, activeGeneration, activeEvaluation, systemAccounts] = await Promise.all([
    client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM "CaritsAccount" WHERE NOT (("ownerType"='USER' AND "userId" IS NOT NULL AND "organizationId" IS NULL AND "systemKey" IS NULL) OR ("ownerType"='ORGANIZATION' AND "organizationId" IS NOT NULL AND "userId" IS NULL AND "systemKey" IS NULL) OR ("ownerType"='SYSTEM' AND "systemKey" IS NOT NULL AND "userId" IS NULL AND "organizationId" IS NULL))`,
    client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM "EvaluationCreditLedgerEntry" e LEFT JOIN "EvaluationCreditAccount" a ON a.id=e."accountId" WHERE a.id IS NULL`,
    client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM (SELECT t.id FROM "CaritsTransaction" t LEFT JOIN "CaritsLedgerEntry" e ON e."transactionId"=t.id WHERE t.status='posted' GROUP BY t.id HAVING COUNT(e.id)<2 OR COALESCE(SUM(e.amount),0)<>0) invalid`,
    client.problemDataGenerationJob.count({ where: { status: { in: ['queued', 'running', 'finalizing'] }, reservedCredits: { gt: 0 } } }),
    client.candidateEvaluationRun.count({ where: { status: { in: ['queued', 'running'] }, budgetCredits: { gt: 0 } } }),
    client.caritsAccount.findMany({ where: { ownerType: 'SYSTEM', systemKey: { in: ['REWARD_POOL', 'RESOURCE_SINK'] } }, select: { systemKey: true } }),
  ])
  const report = { invalidCaritsAccounts: Number(invalidAccounts[0]?.count || 0n), orphanEvaluationEntries: Number(orphanEvaluationEntries[0]?.count || 0n), invalidPostedTransactions: Number(invalidTransactions[0]?.count || 0n), activeLegacyReservations: activeGeneration + activeEvaluation, existingSystemAccounts: systemAccounts.map(item => item.systemKey).sort() }
  return { ...report, reportHash: hash(report), canApply: !report.invalidCaritsAccounts && !report.orphanEvaluationEntries && !report.invalidPostedTransactions }
}

export async function applyEconomyLoopMigration(reportHash: string, actorUserId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('economy-loop-migration-v1', 0)) IS NULL AS locked`
    const current = await inspectEconomyLoopMigration(tx)
    if (!reportHash || current.reportHash !== reportHash) throw new Error('检查报告已过期，请重新执行 check')
    if (!current.canApply) throw new Error('账本或额度流水存在异常，拒绝继续初始化')
    await getOrCreateCaritsAccount(tx, { ownerType: 'SYSTEM', systemKey: 'REWARD_POOL' })
    await getOrCreateCaritsAccount(tx, { ownerType: 'SYSTEM', systemKey: 'RESOURCE_SINK' })
    const previous = await tx.platformAuditLog.findFirst({ where: { action: 'economy_loop_initialized', targetType: 'economy', targetId: 'v1' } })
    if (!previous) await tx.platformAuditLog.create({ data: { id: crypto.randomUUID(), actorUserId, action: 'economy_loop_initialized', targetType: 'economy', targetId: 'v1', metadata: { reportHash, activeLegacyReservations: current.activeLegacyReservations } } })
    return { initialized: true, alreadyInitialized: Boolean(previous), activeLegacyReservations: current.activeLegacyReservations }
  })
}
