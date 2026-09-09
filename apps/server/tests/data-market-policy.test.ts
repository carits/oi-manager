import { describe, expect, it } from 'vitest'
import { automaticPriceCarits, determineDataProductGrade } from '../src/modules/data-market/data-market.service'

const eligible = {
  qualityStatus: 'READY', overallScore: 70, correctnessScore: 30,
  confidenceLevel: 'MEDIUM' as const, maturityLevel: 'VALIDATED' as const,
  holdoutClusterCount: 0, criticalIssueCount: 0,
}

describe('data product server policy', () => {
  it('automatically derives the highest quality-backed grade', () => {
    expect(determineDataProductGrade(eligible)).toBe('COMMUNITY')
    expect(determineDataProductGrade({ ...eligible, overallScore: 86, confidenceLevel: 'HIGH', maturityLevel: 'PROVEN', holdoutClusterCount: 4 })).toBe('VERIFIED')
    expect(determineDataProductGrade({ ...eligible, overallScore: 94, confidenceLevel: 'VERY_HIGH', maturityLevel: 'MATURE', holdoutClusterCount: 8 })).toBe('COMPETITION_GRADE')
  })

  it('rejects a failed correctness gate or critical snapshot regardless of score', () => {
    expect(determineDataProductGrade({ ...eligible, overallScore: 99, correctnessScore: 29, confidenceLevel: 'VERY_HIGH', maturityLevel: 'BATTLE_TESTED' })).toBeNull()
    expect(determineDataProductGrade({ ...eligible, overallScore: 99, criticalIssueCount: 1, confidenceLevel: 'VERY_HIGH', maturityLevel: 'BATTLE_TESTED' })).toBeNull()
  })

  it('prices licenses only from server grade and license factors', () => {
    expect(automaticPriceCarits('VERIFIED', 'PERSONAL')).toBe(90n)
    expect(automaticPriceCarits('VERIFIED', 'ORGANIZATION')).toBe(180n)
    expect(automaticPriceCarits('VERIFIED', 'CONTEST')).toBe(270n)
  })
})
