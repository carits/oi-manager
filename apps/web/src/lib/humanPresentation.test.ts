import { describe, expect, it } from 'vitest'
import { activityStatusLabel, reviewStatusLabel, trainingSessionTypeLabel, trainingStatusLabel } from './humanPresentation'

describe('human presentation vocabulary', () => {
  it('translates training types and lifecycle states', () => {
    expect(trainingStatusLabel('RUNNING')).toBe('进行中')
    expect(trainingSessionTypeLabel('GENERAL')).toBe('综合训练')
    expect(activityStatusLabel('SCHEDULED')).toBe('待开始')
    expect(activityStatusLabel('finished')).toBe('已结束')
  })

  it('does not leak unknown internal values into primary status labels', () => {
    expect(activityStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
    expect(reviewStatusLabel('pending')).toBe('待处理')
    expect(reviewStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
  })
})
