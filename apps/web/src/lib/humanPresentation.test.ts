import { describe, expect, it } from 'vitest'
import { activityStatusLabel, genericStatusLabel, membershipStatusLabel, organizationRoleLabel, reviewStatusLabel, testDataVersion, trainingSessionTypeLabel, trainingStatusLabel } from './humanPresentation'

describe('human presentation vocabulary', () => {
  it('translates training types and lifecycle states', () => {
    expect(trainingStatusLabel('READY')).toBe('待开始')
    expect(trainingStatusLabel('RUNNING')).toBe('进行中')
    expect(trainingSessionTypeLabel('GENERAL')).toBe('综合训练')
    expect(activityStatusLabel('SCHEDULED')).toBe('待开始')
    expect(activityStatusLabel('finished')).toBe('已结束')
  })

  it('does not leak unknown internal values into primary status labels', () => {
    const internal = 'FUTURE_INTERNAL_VALUE'
    expect(trainingStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
    expect(activityStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
    expect(reviewStatusLabel('pending')).toBe('待处理')
    expect(reviewStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
    expect(membershipStatusLabel(internal)).not.toContain(internal)
    expect(organizationRoleLabel(internal)).not.toContain(internal)
    expect(genericStatusLabel(internal)).not.toContain(internal)
  })

  it('does not expose storage revisions', () => {
    expect(testDataVersion(17, true)).toBe('使用发布时固定的数据评测')
  })
})
