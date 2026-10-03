import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { EVALUATION_LIMITS, EvaluationBudgetError, getEvaluationBudgetOverview, getUserEvaluationCreditOverview, reconcileEvaluationCreditReservations, reserveEvaluationCredits, settleEvaluationCredits, usageCredits } from '../src/modules/problem/problem.evaluation-budget.service'
import { createTestUser } from './helpers/testUser'

describe('Candidate evaluation budget', () => {
  it('reserves once, settles actual usage and releases the remainder', async () => {
    const accountUser = await createTestUser()
    const taskId = crypto.randomUUID(), userId = accountUser.user.id
    await reserveEvaluationCredits({ userId, manager: false, taskType: 'candidate', taskId, credits: 400 })
    await reserveEvaluationCredits({ userId, manager: false, taskType: 'candidate', taskId, credits: 400 })
    await settleEvaluationCredits({ taskType: 'candidate', taskId, reserved: 400, actual: 73 })
    const account = await prisma.evaluationCreditAccount.findFirstOrThrow({ where: { subjectId: userId } })
    expect(account.reservedCredits).toBe(0)
    expect(account.consumedCredits).toBe(73)
    expect(account.availableCredits).toBe(EVALUATION_LIMITS.normalDailyCredits - 73)
    expect(await prisma.evaluationCreditLedgerEntry.count({ where: { taskId, accountId: account.id } })).toBe(2)
    const accountLedger = await prisma.evaluationCreditLedgerEntry.aggregate({ where: { taskId, accountId: account.id }, _sum: { amount: true } })
    expect(account.limitCredits + (accountLedger._sum.amount || 0)).toBe(account.availableCredits)
    const platform = await prisma.evaluationCreditAccount.findFirstOrThrow({ where: { subjectType: 'platform', subjectId: 'global' } })
    expect(platform.reservedCredits).toBe(0)
    expect(platform.consumedCredits).toBe(73)
    const overview = await getUserEvaluationCreditOverview(userId)
    expect(overview.today).toEqual({ reserved: 0, consumed: 73 })
    const platformOverview = await getEvaluationBudgetOverview()
    expect(platformOverview.users).toContainEqual(expect.objectContaining({
      subjectId: userId,
      username: accountUser.user.username,
    }))
  })

  it('rejects a reused task identity with a different user or amount', async () => {
    const userId = (await createTestUser()).user.id, taskId = crypto.randomUUID()
    await reserveEvaluationCredits({ userId, manager: false, taskType: 'candidate', taskId, credits: 400 })
    await expect(reserveEvaluationCredits({ userId, manager: false, taskType: 'candidate', taskId, credits: 401 }))
      .rejects.toMatchObject({ code: 'EVALUATION_RESERVATION_IDEMPOTENCY_CONFLICT' })
    await expect(reserveEvaluationCredits({ userId: (await createTestUser()).user.id, manager: false, taskType: 'candidate', taskId, credits: 400 }))
      .rejects.toMatchObject({ code: 'EVALUATION_RESERVATION_IDEMPOTENCY_CONFLICT' })
  })

  it('rejects non-finite actual usage without mutating a reservation', async () => {
    const userId = (await createTestUser()).user.id, taskId = crypto.randomUUID()
    await reserveEvaluationCredits({ userId, manager: false, taskType: 'candidate', taskId, credits: 400 })
    await expect(settleEvaluationCredits({ taskType: 'candidate', taskId, reserved: 400, actual: Number.NaN }))
      .rejects.toMatchObject({ code: 'EVALUATION_USAGE_INVALID' })
    expect(await prisma.evaluationCreditReservation.findUniqueOrThrow({ where: { taskType_taskId: { taskType: 'candidate', taskId } } }))
      .toMatchObject({ status: 'reserved', actualCredits: null })
  })

  it('rejects a second settlement that changes the actual usage', async () => {
    const userId = (await createTestUser()).user.id, taskId = crypto.randomUUID()
    await reserveEvaluationCredits({ userId, manager: false, taskType: 'candidate', taskId, credits: 400 })
    await settleEvaluationCredits({ taskType: 'candidate', taskId, reserved: 400, actual: 73 })
    await expect(settleEvaluationCredits({ taskType: 'candidate', taskId, reserved: 400, actual: 74 }))
      .rejects.toMatchObject({ code: 'EVALUATION_SETTLEMENT_IDEMPOTENCY_CONFLICT' })
    expect(await prisma.evaluationCreditReservation.findUniqueOrThrow({ where: { taskType_taskId: { taskType: 'candidate', taskId } } }))
      .toMatchObject({ status: 'settled', actualCredits: 73 })
  })

  it('derives legacy settlement amounts from the immutable reservation ledger', async () => {
    const userId = (await createTestUser()).user.id, taskId = crypto.randomUUID()
    const periodStart = new Date(Date.UTC(2026, 0, 1))
    const freeAccountId = crypto.randomUUID(), platformAccountId = crypto.randomUUID()
    await prisma.evaluationCreditAccount.createMany({ data: [
      { id: freeAccountId, subjectType: 'legacy-user', subjectId: userId, periodStart, limitCredits: 1_000, availableCredits: 600, reservedCredits: 400 },
      { id: platformAccountId, subjectType: 'legacy-platform', subjectId: crypto.randomUUID(), periodStart, limitCredits: 1_000, availableCredits: 600, reservedCredits: 400 },
    ] })
    await prisma.evaluationCreditLedgerEntry.createMany({ data: [
      { id: crypto.randomUUID(), accountId: freeAccountId, type: 'reserve', amount: -400, idempotencyKey: `reserve:legacy:${taskId}`, taskType: 'legacy', taskId },
      { id: crypto.randomUUID(), accountId: platformAccountId, type: 'reserve', amount: -400, idempotencyKey: `reserve-platform:legacy:${taskId}`, taskType: 'legacy', taskId },
    ] })

    await expect(settleEvaluationCredits({ taskType: 'legacy', taskId, reserved: 399, actual: 73 }))
      .rejects.toMatchObject({ code: 'EVALUATION_RESERVATION_MISMATCH' })
    expect(await prisma.evaluationCreditAccount.findUniqueOrThrow({ where: { id: freeAccountId } })).toMatchObject({ availableCredits: 600, reservedCredits: 400, consumedCredits: 0 })

    await settleEvaluationCredits({ taskType: 'legacy', taskId, reserved: 400, actual: 73 })
    expect(await prisma.evaluationCreditAccount.findUniqueOrThrow({ where: { id: freeAccountId } })).toMatchObject({ availableCredits: 927, reservedCredits: 0, consumedCredits: 73 })
    await expect(settleEvaluationCredits({ taskType: 'legacy', taskId, reserved: 400, actual: 74 }))
      .rejects.toMatchObject({ code: 'EVALUATION_SETTLEMENT_IDEMPOTENCY_CONFLICT' })
  })

  it('fails closed when a user asks beyond the daily hard limit', async () => {
    await expect(reserveEvaluationCredits({ userId: (await createTestUser()).user.id, manager: false, taskType: 'candidate', taskId: crypto.randomUUID(), credits: EVALUATION_LIMITS.normalDailyCredits + 1 })).rejects.toBeInstanceOf(EvaluationBudgetError)
  })

  it('serializes concurrent reservations without exceeding the user or platform budget', async () => {
    const accountUser = await createTestUser()
    const userId = accountUser.user.id
    await prisma.evaluationCreditWallet.create({ data: {
      id: crypto.randomUUID(), userId, availableCredits: 5_000,
    } })
    const results = await Promise.allSettled(Array.from({ length: 4 }, () =>
      reserveEvaluationCredits({ userId, manager: false, taskType: 'candidate', taskId: crypto.randomUUID(), credits: 5_000 })))

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'EVALUATION_DAILY_USAGE_LIMIT' },
    })
    const account = await prisma.evaluationCreditAccount.findFirstOrThrow({ where: { subjectType: 'user', subjectId: userId } })
    const platform = await prisma.evaluationCreditAccount.findFirstOrThrow({ where: { subjectType: 'platform', subjectId: 'global' } })
    const wallet = await prisma.evaluationCreditWallet.findUniqueOrThrow({ where: { userId } })
    expect(account.reservedCredits).toBe(EVALUATION_LIMITS.normalDailyCredits)
    expect(account.availableCredits).toBe(0)
    expect(wallet.reservedCredits).toBe(5_000)
    expect(platform.reservedCredits).toBe(15_000)
    expect(await prisma.evaluationCreditReservation.count({ where: { userId, status: 'reserved' } })).toBe(3)
  })

  it('charges executions, CPU and generated bytes deterministically', () => {
    expect(usageCredits({ executions: 10, cpuMs: 250, generatedBytes: 2 * 1024 * 1024 })).toBe(15)
  })

  it('upgrades the daily free account when a later task has manager entitlement', async () => {
    const userId = (await createTestUser()).user.id
    await reserveEvaluationCredits({ userId, manager: false, taskType: 'candidate', taskId: crypto.randomUUID(), credits: 400 })
    await reserveEvaluationCredits({ userId, manager: true, taskType: 'candidate', taskId: crypto.randomUUID(), credits: 20_000 })
    const account = await prisma.evaluationCreditAccount.findFirstOrThrow({ where: { subjectType: 'user', subjectId: userId } })
    expect(account.limitCredits).toBe(EVALUATION_LIMITS.managerDailyCredits)
  })

  it('releases an old orphan reservation through the reconciliation worker', async () => {
    const taskId = crypto.randomUUID(), userId = (await createTestUser()).user.id
    await reserveEvaluationCredits({ userId, manager: false, taskType: 'candidate_generation', taskId, credits: 400 })
    await prisma.evaluationCreditReservation.update({ where: { taskType_taskId: { taskType: 'candidate_generation', taskId } }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } })
    expect(await reconcileEvaluationCreditReservations()).toMatchObject({ released: 1, failed: 0 })
    const reservation = await prisma.evaluationCreditReservation.findUniqueOrThrow({ where: { taskType_taskId: { taskType: 'candidate_generation', taskId } } })
    expect(reservation.status).toBe('released')
  })
})
