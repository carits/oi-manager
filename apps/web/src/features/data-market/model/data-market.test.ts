import { describe, expect, it } from 'vitest'
import { buildDataPurchasePayload, canManageDataMarketplace, canRequestDataUpgrade } from './data-market'

describe('data marketplace web policy', () => {
  it('builds scope-only purchase payloads without accepting a client price', () => {
    expect(buildDataPurchasePayload('PERSONAL', '', '')).toEqual({ license: 'PERSONAL' })
    expect(buildDataPurchasePayload('ORGANIZATION', 'org-1', '')).toEqual({ license: 'ORGANIZATION', organizationId: 'org-1' })
    expect(buildDataPurchasePayload('CONTEST', '', '42')).toEqual({ license: 'CONTEST', contestId: 42 })
    expect(buildDataPurchasePayload('PERSONAL', '', '')).not.toHaveProperty('amountCarits')
  })

  it('uses global capability plus organization manager role and hides snapshot upgrades', () => {
    expect(canManageDataMarketplace('platform_admin')).toBe(true)
    expect(canManageDataMarketplace('student', 'teacher')).toBe(true)
    expect(canManageDataMarketplace('student', 'student')).toBe(false)
    expect(canRequestDataUpgrade('SNAPSHOT')).toBe(false)
    expect(canRequestDataUpgrade('UPDATE_90D')).toBe(true)
  })
})
