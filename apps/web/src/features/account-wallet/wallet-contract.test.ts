import { describe, expect, it } from 'vitest'
import { CaritsAccountSchema, EvaluationCreditOverviewSchema } from '@oi-manager/contracts'
import { canAffordCarits, hasPositiveCaritsDebt } from './ui/wallet-display'

describe('account wallet feature contracts', () => {
  it('uses exact integer strings for Carits without treating Credits as currency', () => {
    expect(CaritsAccountSchema.safeParse({
      currency: 'Carits币', accountStatus: 'empty', balance: '0', availableBalance: '0', debtBalance: '0', items: [],
    }).success).toBe(true)
    expect(CaritsAccountSchema.safeParse({
      currency: 'Carits币', accountStatus: 'empty', balance: 0, availableBalance: '0', debtBalance: '0',
    }).success).toBe(false)
    expect(canAffordCarits('20', '10')).toBe(true)
    expect(hasPositiveCaritsDebt('1')).toBe(true)
  })

  it('requires Evaluation Credit quota fields independently from the Carits ledger', () => {
    const result = EvaluationCreditOverviewSchema.safeParse({
      periodStart: '2026-09-15T00:00:00.000Z', resetsAt: '2026-09-16T00:00:00.000Z',
      level: 'L0', contributionScore: 0, dailyLimit: 15_000,
      free: { limit: 10_000, available: 10_000, reserved: 0, consumed: 0 },
      purchased: { available: 0, reserved: 0, consumed: '0' },
      today: { reserved: 0, consumed: 0 }, packages: [], recentPurchases: [],
    })
    expect(result.success).toBe(true)
  })
})
