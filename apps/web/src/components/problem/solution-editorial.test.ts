import { describe, expect, it } from 'vitest'
import {
  canEditSolutionContribution,
  reviewActionsForStatus,
  solutionSubmissionAction,
  validateSolutionDraft,
} from './solution-editorial'

const completeDraft = {
  type: 'COMMUNITY_EDITORIAL' as const,
  title: '线性扫描题解',
  contentMarkdown: '先维护前缀状态。'.repeat(12),
  complexityTime: 'O(n)', complexityMemory: 'O(1)', language: 'cpp',
  referenceCode: 'int main() { return 0; }', sourceType: 'ORIGINAL' as const,
  licenseAccepted: true,
}

describe('solution editorial workflow', () => {
  it('keeps immutable submitted contributions out of the editor', () => {
    expect(canEditSolutionContribution('DRAFT')).toBe(true)
    expect(canEditSolutionContribution('NEEDS_REVISION')).toBe(true)
    expect(canEditSolutionContribution('SUBMITTED')).toBe(false)
    expect(solutionSubmissionAction('DRAFT')).toBe('submit')
    expect(solutionSubmissionAction('NEEDS_REVISION')).toBe('resubmit')
  })

  it('validates complete solutions and third-party source declarations', () => {
    expect(validateSolutionDraft(completeDraft)).toBeNull()
    expect(validateSolutionDraft({ ...completeDraft, referenceCode: '' })).toContain('参考代码')
    expect(validateSolutionDraft({ ...completeDraft, sourceType: 'DERIVED', sourceUrl: '', citation: '' })).toContain('来源')
  })

  it('only offers backend-valid review transitions', () => {
    expect(reviewActionsForStatus('TECHNICALLY_VALID')).toEqual(['approve', 'request-revision', 'reject'])
    expect(reviewActionsForStatus('UNDER_REVIEW')).toEqual(['accept', 'request-revision', 'reject'])
    expect(reviewActionsForStatus('ACCEPTED')).toEqual(['publish'])
    expect(reviewActionsForStatus('AUTO_CHECKING')).toEqual([])
  })
})
