import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import {
  adjustAiTokenPool,
  getAiTokenPool,
  releaseAiTokens,
  reserveAiTokens,
  settleAiTokens,
} from '../src/modules/ai/ai-token.service'

describe('AI Token pool accounting', () => {
  it('keeps adjustments idempotent and settles the provider actual usage', async () => {
    const operatorUserId = crypto.randomUUID()
    const idempotencyKey = `test-adjust:${crypto.randomUUID()}`
    await adjustAiTokenPool({ amount: 100, idempotencyKey, operatorUserId, reason: 'test quota' })
    await adjustAiTokenPool({ amount: 100, idempotencyKey, operatorUserId, reason: 'test quota' })

    const requestId = crypto.randomUUID()
    await reserveAiTokens({ requestId, userId: operatorUserId, amount: 60, problemId: 'problem-test', action: 'validator' })
    await settleAiTokens({ requestId, userId: operatorUserId, reserved: 60, actual: 75 })

    const pool = await getAiTokenPool()
    expect(pool.availableTokens).toBe('25')
    expect(pool.reservedTokens).toBe('0')
    expect(pool.consumedTokens).toBe('75')
    expect(await prisma.aiTokenLedgerEntry.count({ where: { idempotencyKey } })).toBe(1)
  })

  it('allows exactly one settle-or-release finalization', async () => {
    const userId = crypto.randomUUID()
    await adjustAiTokenPool({ amount: 100, idempotencyKey: `seed:${crypto.randomUUID()}`, operatorUserId: userId, reason: 'test quota' })
    const requestId = crypto.randomUUID()
    await reserveAiTokens({ requestId, userId, amount: 40, problemId: 'problem-test', action: 'validator' })

    await Promise.all([
      settleAiTokens({ requestId, userId, reserved: 40, actual: 10 }),
      releaseAiTokens({ requestId, userId, reserved: 40, reason: 'network failure' }),
    ])

    const pool = await getAiTokenPool()
    expect(pool.reservedTokens).toBe('0')
    expect(Number(pool.availableTokens) + Number(pool.consumedTokens)).toBe(100)
    expect(await prisma.aiTokenLedgerEntry.count({
      where: { requestId, type: { in: ['settle', 'release'] } },
    })).toBe(1)
  })
})
