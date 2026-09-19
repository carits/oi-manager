import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createTestUser } from './helpers/testUser'
import { getPersonalCaritsAccount } from '../src/modules/carits/application/carits.service'
import { postCarits, reverseCaritsTransaction } from '../src/modules/carits/application/carits-ledger.service'
import { purchaseEvaluationCredits, ResourcePurchaseError } from '../src/modules/carits/application/resource-purchase.service'
import { acceptContribution, processContributionRewardDeliveries, recordPromotedContribution, retryContributionReward, revokeContribution } from '../src/modules/contribution/application/contribution-reward.service'
import { dayStart, reserveEvaluationCredits, settleEvaluationCredits } from '../src/modules/problem/problem.evaluation-budget.service'
import { createTestProblem } from './helpers/problemListHelpers'

async function rewardUser(userId: string, amount = 100n, key = crypto.randomUUID()) {
  return postCarits({
    type: 'test_reward', idempotencyKey: `test-reward:${key}`,
    entries: [
      { owner: { ownerType: 'SYSTEM', systemKey: 'REWARD_POOL' }, amount: -amount, allowNegative: true },
      { owner: { ownerType: 'USER', userId }, amount },
    ],
  })
}

describe('Contribution, Carits and Evaluation Credits loop', () => {
  it('posts a balanced reward, purchases a server-defined package and preserves idempotency', async () => {
    const user = await createTestUser()
    const rewardKey = crypto.randomUUID()
    const reward = await rewardUser(user.user.id, 100n, rewardKey)
    const duplicate = await rewardUser(user.user.id, 100n, rewardKey)
    expect(duplicate.id).toBe(reward.id)
    await expect(rewardUser(user.user.id, 90n, rewardKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    await expect(rewardUser(user.user.id, 90n, rewardKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    await expect(purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_5K', idempotencyKey: 'not-a-uuid' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' })

    const idempotencyKey = crypto.randomUUID()
    const purchase = await purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_5K', idempotencyKey })
    const repeated = await purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_5K', idempotencyKey })
    expect(repeated.id).toBe(purchase.id)
    await expect(purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_20K', idempotencyKey })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })

    const account = await getPersonalCaritsAccount(user.user.id)
    expect(account.availableBalance).toBe('90')
    const wallet = await prisma.evaluationCreditWallet.findUniqueOrThrow({ where: { userId: user.user.id } })
    expect(wallet.availableCredits).toBe(5_000)
    const entries = await prisma.caritsLedgerEntry.groupBy({ by: ['transactionId'], _sum: { amount: true }, _count: { _all: true } })
    expect(entries.every(item => item._count._all >= 2 && item._sum.amount === 0n)).toBe(true)
  })

  it('includes canonical transaction metadata in the idempotency fingerprint', async () => {
    const user = await createTestUser(), key = crypto.randomUUID()
    const post = (metadata: Record<string, unknown>) => postCarits({
      type: 'metadata_reward', idempotencyKey: key, metadata: metadata as any,
      entries: [
        { owner: { ownerType: 'SYSTEM', systemKey: 'REWARD_POOL' }, amount: -10n, allowNegative: true },
        { owner: { ownerType: 'USER', userId: user.user.id }, amount: 10n },
      ],
    })
    const first = await post({ nested: { beta: 2, alpha: 1 }, label: 'same' })
    const reordered = await post({ label: 'same', nested: { alpha: 1, beta: 2 } })
    expect(reordered.id).toBe(first.id)
    await expect(post({ nested: { alpha: 1, beta: 3 }, label: 'same' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('never treats an incomplete draft ledger transaction as a successful idempotent replay', async () => {
    const user = await createTestUser()
    await rewardUser(user.user.id, 10n)
    const [userAccount, systemAccount] = await Promise.all([
      prisma.caritsAccount.findUniqueOrThrow({ where: { userId: user.user.id } }),
      prisma.caritsAccount.findUniqueOrThrow({ where: { systemKey: 'REWARD_POOL' } }),
    ])
    const idempotencyKey = `draft-replay:${crypto.randomUUID()}`
    const transaction = await prisma.caritsTransaction.create({ data: {
      id: crypto.randomUUID(), type: 'draft_replay_test', status: 'draft', idempotencyKey,
    } })
    await prisma.caritsLedgerEntry.createMany({ data: [
      { id: crypto.randomUUID(), transactionId: transaction.id, accountId: systemAccount.id, amount: -1n, balanceAfter: systemAccount.balance - 1n },
      { id: crypto.randomUUID(), transactionId: transaction.id, accountId: userAccount.id, amount: 1n, balanceAfter: userAccount.balance + 1n },
    ] })

    await expect(postCarits({
      type: 'draft_replay_test', idempotencyKey,
      entries: [
        { owner: { ownerType: 'SYSTEM', systemKey: 'REWARD_POOL' }, amount: -1n, allowNegative: true },
        { owner: { ownerType: 'USER', userId: user.user.id }, amount: 1n },
      ],
    })).rejects.toMatchObject({ code: 'CARITS_TRANSACTION_INCOMPLETE' })
  })

  it('uses free credits first, releases unused purchased credits and settles the platform reservation', async () => {
    const user = await createTestUser()
    await rewardUser(user.user.id, 10n)
    await purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_5K', idempotencyKey: crypto.randomUUID() })
    const taskId = crypto.randomUUID()
    const reservation = await reserveEvaluationCredits({ userId: user.user.id, manager: false, taskType: 'candidate', taskId, credits: 12_000 })
    expect(reservation.freeReserved).toBe(10_000)
    expect(reservation.paidReserved).toBe(2_000)

    await settleEvaluationCredits({ taskType: 'candidate', taskId, reserved: 12_000, actual: 10_500 })
    const [wallet, free, platform] = await Promise.all([
      prisma.evaluationCreditWallet.findUniqueOrThrow({ where: { userId: user.user.id } }),
      prisma.evaluationCreditAccount.findFirstOrThrow({ where: { subjectType: 'user', subjectId: user.user.id } }),
      prisma.evaluationCreditAccount.findFirstOrThrow({ where: { subjectType: 'platform', subjectId: 'global' } }),
    ])
    expect(wallet.availableCredits).toBe(4_500)
    expect(wallet.reservedCredits).toBe(0)
    expect(wallet.consumedCredits).toBe(500n)
    expect(free.reservedCredits).toBe(0)
    expect(free.consumedCredits).toBe(10_000)
    expect(platform.reservedCredits).toBe(0)
    expect(platform.consumedCredits).toBe(10_500)
  })

  it('recognizes the pre-reservation ledger settlement representation without double settling', async () => {
    const user = await createTestUser()
    const periodStart = dayStart()
    const taskId = crypto.randomUUID()
    const account = await prisma.evaluationCreditAccount.create({ data: {
      id: crypto.randomUUID(), subjectType: 'user', subjectId: user.user.id,
      periodStart, limitCredits: 1_000, availableCredits: 927,
      reservedCredits: 0, consumedCredits: 73,
    } })
    await prisma.evaluationCreditLedgerEntry.create({ data: {
      id: crypto.randomUUID(), accountId: account.id, type: 'reserve', amount: -400,
      idempotencyKey: `reserve:legacy:${taskId}`, taskType: 'legacy', taskId,
    } })
    const settled = await prisma.evaluationCreditLedgerEntry.create({ data: {
      id: crypto.randomUUID(), accountId: account.id, type: 'settle', amount: -73,
      idempotencyKey: `settle:legacy:${taskId}`, taskType: 'legacy', taskId,
    } })

    expect(await settleEvaluationCredits({ taskType: 'legacy', taskId, reserved: 400, actual: 73 })).toMatchObject({ id: settled.id })
    await expect(settleEvaluationCredits({ taskType: 'legacy', taskId, reserved: 400, actual: 74 }))
      .rejects.toMatchObject({ code: 'EVALUATION_SETTLEMENT_IDEMPOTENCY_CONFLICT' })
  })

  it('delivers a contribution reward once and reverses it without rewriting history', async () => {
    const user = await createTestUser()
    const administrator = await createTestUser({ accountRole: 'super_admin' })
    const contributionId = crypto.randomUUID()
    await prisma.contributionEvent.create({ data: {
      id: contributionId, actorUserId: user.user.id, type: 'candidate_promoted', sourceType: 'testcase_candidate', sourceId: crypto.randomUUID(),
      score: 100, ruleCode: 'canonical_testcase_promoted', ruleVersion: 1, dedupeKey: `test-contribution:${contributionId}`,
      status: 'accepted', occurredAt: new Date(), acceptedAt: new Date(), evidence: { candidateSource: 'direct_data' },
      RewardDelivery: { create: { id: crypto.randomUUID(), policyCode: 'canonical_testcase_promoted', policyVersion: 1, userCarits: 20n } },
    } })
    const previousRewardMode = process.env.CONTRIBUTION_REWARD_MODE
    process.env.CONTRIBUTION_REWARD_MODE = 'enabled'
    expect(await processContributionRewardDeliveries()).toMatchObject({ posted: 1 })
    expect(await processContributionRewardDeliveries()).toMatchObject({ posted: 0 })
    expect((await getPersonalCaritsAccount(user.user.id)).availableBalance).toBe('20')

    await revokeContribution(administrator.user.id, contributionId, '确认该贡献证据无效，执行经济奖励冲正')
    const event = await prisma.contributionEvent.findUniqueOrThrow({ where: { id: contributionId }, include: { RewardDelivery: true } })
    expect(event.status).toBe('revoked')
    expect(event.RewardDelivery?.status).toBe('reversed')
    expect((await getPersonalCaritsAccount(user.user.id)).availableBalance).toBe('0')
    if (previousRewardMode === undefined) delete process.env.CONTRIBUTION_REWARD_MODE
    else process.env.CONTRIBUTION_REWARD_MODE = previousRewardMode
  })

  it('blocks purchases while a user has Carits debt', async () => {
    const user = await createTestUser()
    const reward = await rewardUser(user.user.id, 10n)
    await purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_5K', idempotencyKey: crypto.randomUUID() })
    await prisma.$transaction(tx => reverseCaritsTransaction(tx, { transactionId: reward.id, idempotencyKey: `reverse:${reward.id}`, operatorUserId: user.user.id, reason: '测试冲正' }))
    await expect(purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_5K', idempotencyKey: crypto.randomUUID() })).rejects.toBeInstanceOf(ResourcePurchaseError)
    expect((await getPersonalCaritsAccount(user.user.id)).debtBalance).toBe('10')
  })

  it('enforces the daily Carits purchase cap with server-owned package prices', async () => {
    const user = await createTestUser()
    await rewardUser(user.user.id, 300n)
    await purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_50K', idempotencyKey: crypto.randomUUID() })
    await purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_50K', idempotencyKey: crypto.randomUUID() })
    await expect(purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_5K', idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: 'EVALUATION_PURCHASE_DAILY_LIMIT' })
  })

  it('serializes concurrent purchases so the daily Carits cap cannot be bypassed', async () => {
    const user = await createTestUser()
    await rewardUser(user.user.id, 500n)

    const results = await Promise.allSettled(Array.from({ length: 3 }, () =>
      purchaseEvaluationCredits({ userId: user.user.id, packageCode: 'EVAL_50K', idempotencyKey: crypto.randomUUID() })))

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'EVALUATION_PURCHASE_DAILY_LIMIT' },
    })
    expect(await prisma.resourcePurchase.count({ where: { userId: user.user.id, status: 'posted' } })).toBe(2)
    expect(await prisma.evaluationCreditWallet.findUniqueOrThrow({ where: { userId: user.user.id } })).toMatchObject({
      availableCredits: 100_000,
      reservedCredits: 0,
    })
    expect((await getPersonalCaritsAccount(user.user.id)).availableBalance).toBe('300')
  })

  it('keeps posted Carits transactions and entries immutable at the database boundary', async () => {
    const user = await createTestUser(), anotherUser = await createTestUser()
    const transaction = await rewardUser(user.user.id, 20n)
    await rewardUser(anotherUser.user.id, 1n)
    const entries = await prisma.caritsLedgerEntry.findMany({ where: { transactionId: transaction.id }, orderBy: { id: 'asc' } })
    const anotherAccount = await prisma.caritsAccount.findUniqueOrThrow({ where: { userId: anotherUser.user.id } })

    await expect(prisma.caritsLedgerEntry.update({ where: { id: entries[0].id }, data: { amount: 999n } })).rejects.toThrow()
    await expect(prisma.caritsLedgerEntry.delete({ where: { id: entries[0].id } })).rejects.toThrow()
    await expect(prisma.caritsLedgerEntry.create({ data: {
      id: crypto.randomUUID(), transactionId: transaction.id, accountId: anotherAccount.id,
      amount: 1n, balanceAfter: anotherAccount.balance + 1n,
    } })).rejects.toThrow()
    await expect(prisma.caritsTransaction.update({ where: { id: transaction.id }, data: { metadata: { tampered: true } } })).rejects.toThrow()

    const unbalancedId = crypto.randomUUID()
    await prisma.caritsTransaction.create({ data: {
      id: unbalancedId,
      type: 'invalid_test_transaction',
      status: 'draft',
      idempotencyKey: `invalid:${unbalancedId}`,
    } })
    await prisma.caritsLedgerEntry.create({ data: {
      id: crypto.randomUUID(), transactionId: unbalancedId, accountId: anotherAccount.id,
      amount: 1n, balanceAfter: anotherAccount.balance + 1n,
    } })
    await expect(prisma.caritsTransaction.update({ where: { id: unbalancedId }, data: { status: 'posted', postedAt: new Date() } })).rejects.toThrow()

    const persisted = await prisma.caritsLedgerEntry.findMany({ where: { transactionId: transaction.id } })
    expect(persisted).toHaveLength(2)
    expect(persisted.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(0n)
  })

  it('keeps Evaluation Credit daily ledgers immutable at the database boundary', async () => {
    const user = await createTestUser()
    const account = await prisma.evaluationCreditAccount.create({ data: {
      id: crypto.randomUUID(), subjectType: 'user', subjectId: user.user.id,
      periodStart: dayStart(), limitCredits: 1_000, availableCredits: 900,
      reservedCredits: 100,
    } })
    const entry = await prisma.evaluationCreditLedgerEntry.create({ data: {
      id: crypto.randomUUID(), accountId: account.id, type: 'reserve', amount: -100,
      idempotencyKey: `immutable:${crypto.randomUUID()}`, taskType: 'immutability_test', taskId: crypto.randomUUID(),
    } })
    await expect(prisma.evaluationCreditLedgerEntry.update({ where: { id: entry.id }, data: { amount: -99 } })).rejects.toThrow()
    await expect(prisma.evaluationCreditLedgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow()
  })

  it('defers rewards beyond the per-user UTC daily cap without losing deliveries', async () => {
    const user = await createTestUser()
    for (let index = 0; index < 11; index += 1) {
      const contributionId = crypto.randomUUID()
      await prisma.contributionEvent.create({ data: {
        id: contributionId, actorUserId: user.user.id, type: 'candidate_promoted', sourceType: 'testcase_candidate', sourceId: crypto.randomUUID(),
        score: 100, ruleCode: 'canonical', ruleVersion: 1, dedupeKey: `reward-cap:${contributionId}`,
        status: 'accepted', occurredAt: new Date(), acceptedAt: new Date(), evidence: { candidateSource: 'direct_data' },
        RewardDelivery: { create: { id: crypto.randomUUID(), policyCode: 'canonical_testcase_promoted', policyVersion: 1, userCarits: 20n } },
      } })
    }
    const previousRewardMode = process.env.CONTRIBUTION_REWARD_MODE
    try {
      process.env.CONTRIBUTION_REWARD_MODE = 'enabled'
      await processContributionRewardDeliveries(50)
    } finally {
      if (previousRewardMode === undefined) delete process.env.CONTRIBUTION_REWARD_MODE
      else process.env.CONTRIBUTION_REWARD_MODE = previousRewardMode
    }
    expect(await prisma.contributionRewardDelivery.count({ where: { Contribution: { actorUserId: user.user.id }, status: 'posted' } })).toBe(10)
    expect(await prisma.contributionRewardDelivery.count({ where: { Contribution: { actorUserId: user.user.id }, status: 'deferred_budget', nextAttemptAt: { gt: new Date() } } })).toBe(1)
    const administrator = await createTestUser({ accountRole: 'super_admin' })
    const posted = await prisma.contributionRewardDelivery.findFirstOrThrow({ where: { Contribution: { actorUserId: user.user.id }, status: 'posted' } })
    await revokeContribution(administrator.user.id, posted.contributionId, '确认测试奖励需要撤销并保留当日发行额度')
    await prisma.contributionRewardDelivery.updateMany({ where: { Contribution: { actorUserId: user.user.id }, status: 'deferred_budget' }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } })
    try {
      process.env.CONTRIBUTION_REWARD_MODE = 'enabled'
      await processContributionRewardDeliveries(10)
    } finally {
      if (previousRewardMode === undefined) delete process.env.CONTRIBUTION_REWARD_MODE
      else process.env.CONTRIBUTION_REWARD_MODE = previousRewardMode
    }
    expect(await prisma.contributionRewardDelivery.count({ where: { Contribution: { actorUserId: user.user.id }, status: 'deferred_budget' } })).toBe(1)
    expect((await getPersonalCaritsAccount(user.user.id)).availableBalance).toBe('180')
  })

  it('allows only one concurrent decision for a pending emergency contribution', async () => {
    const user = await createTestUser()
    const administrator = await createTestUser({ accountRole: 'super_admin' })
    const contributionId = crypto.randomUUID()
    await prisma.contributionEvent.create({ data: {
      id: contributionId, actorUserId: user.user.id, type: 'candidate_promoted', sourceType: 'testcase_candidate', sourceId: crypto.randomUUID(),
      score: 100, ruleCode: 'canonical_testcase_promoted', ruleVersion: 1, dedupeKey: `test-pending:${contributionId}`,
      status: 'pending', occurredAt: new Date(), evidence: {
        candidateSource: 'direct_data', selectionMode: 'emergency', rewardCarits: '17', organizationRewardCarits: '0',
      },
    } })
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => acceptContribution(administrator.user.id, contributionId)))
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.contributionRewardDelivery.findUnique({ where: { contributionId } })).toMatchObject({ userCarits: 17n, organizationCarits: 0n })
    expect(await prisma.platformAuditLog.count({ where: { action: 'contribution_accepted', targetId: contributionId } })).toBe(1)
  })

  it('reuses the candidate contribution fact and its frozen reward snapshot on promotion replay', async () => {
    const user = await createTestUser()
    const problem = await createTestProblem({ ownerId: user.user.id, title: '贡献快照重放测试题' })
    const revisionId = crypto.randomUUID()
    const candidateId = crypto.randomUUID()
    await prisma.problemTestSetRevision.create({ data: {
      id: revisionId, problemId: problem.id, revisionNumber: 1, mode: 'acm', source: 'admin_edit',
      judgeConfig: JSON.stringify({ mode: 'acm', cases: [] }), judgeConfigHash: 'c'.repeat(64),
      graphHash: 'd'.repeat(64), testdataPath: `revisions/${revisionId}`, createdBy: user.user.id,
    } })
    await prisma.testcaseCandidate.create({ data: {
      id: candidateId, problemId: problem.id, source: 'direct_data', targetRole: 'official', status: 'PROMOTED',
      evaluationStage: 'promoted', inputSha256: '3'.repeat(64), outputSha256: '4'.repeat(64),
      inputSize: 4, outputSize: 2, inputFileName: 'candidate.in', outputFileName: 'candidate.out',
      createdBy: user.user.id, promotedRevisionId: revisionId, promotedAt: new Date(),
    } })
    const eventId = crypto.randomUUID()
    await prisma.contributionEvent.create({ data: {
      id: eventId, actorUserId: user.user.id, type: 'candidate_promoted',
      sourceType: 'testcase_candidate', sourceId: candidateId, score: 100,
      ruleCode: 'canonical_testcase_promoted', ruleVersion: 1,
      dedupeKey: `candidate:${candidateId}:promoted`, status: 'accepted',
      occurredAt: new Date(), acceptedAt: new Date(), evidence: {
        problemId: problem.id, candidateId, promotedRevisionId: revisionId,
        candidateSource: 'direct_data', selectionMode: 'auto',
        rewardCarits: '17', organizationRewardCarits: '0',
      },
    } })

    const replay = () => prisma.$transaction(tx => recordPromotedContribution(tx, {
      candidateId, promotedRevisionId: revisionId, selectionMode: 'auto',
    }))
    expect((await replay())?.id).toBe(eventId)
    expect((await replay())?.id).toBe(eventId)
    expect(await prisma.contributionEvent.count({ where: { sourceType: 'testcase_candidate', sourceId: candidateId } })).toBe(1)
    expect(await prisma.contributionRewardDelivery.findUniqueOrThrow({ where: { contributionId: eventId } }))
      .toMatchObject({ userCarits: 17n, organizationCarits: 0n, policyCode: 'canonical_testcase_promoted', policyVersion: 1 })
  })

  it('lets a super administrator requeue a persistently failed reward', async () => {
    const user = await createTestUser(), administrator = await createTestUser({ accountRole: 'super_admin' })
    const contributionId = crypto.randomUUID()
    await prisma.contributionEvent.create({ data: {
      id: contributionId, actorUserId: user.user.id, type: 'candidate_promoted', sourceType: 'testcase_candidate', sourceId: crypto.randomUUID(), score: 100,
      ruleCode: 'canonical_testcase_promoted', ruleVersion: 1, dedupeKey: `failed-reward:${contributionId}`, status: 'accepted', occurredAt: new Date(), acceptedAt: new Date(), evidence: { candidateSource: 'direct_data' },
      RewardDelivery: { create: { id: crypto.randomUUID(), policyCode: 'canonical_testcase_promoted', policyVersion: 1, userCarits: 20n, status: 'failed', attemptCount: 5, errorMessage: 'database unavailable' } },
    } })
    expect(await retryContributionReward(administrator.user.id, contributionId)).toEqual({ retried: true })
    expect(await prisma.contributionRewardDelivery.findUniqueOrThrow({ where: { contributionId } })).toMatchObject({ status: 'pending', attemptCount: 0, errorMessage: null })
  })
})
