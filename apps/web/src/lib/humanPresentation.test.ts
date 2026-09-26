import { describe, expect, it } from 'vitest'
import { activityStatusLabel, reviewStatusLabel, trainingHintOpenModeLabel, trainingProgressStatusLabel, trainingSessionTypeLabel, trainingStageEndReasonLabel, trainingStageKindLabel, trainingStageStatusLabel, trainingStatusLabel } from './humanPresentation'

describe('human presentation vocabulary', () => {
  it('translates training types and lifecycle states', () => {
    expect(trainingStatusLabel('RUNNING')).toBe('进行中')
    expect(trainingSessionTypeLabel('GENERAL')).toBe('综合训练')
    expect(activityStatusLabel('SCHEDULED')).toBe('待开始')
    expect(activityStatusLabel('finished')).toBe('已结束')
    expect(trainingStageStatusLabel('PENDING')).toBe('未开始')
    expect(trainingProgressStatusLabel('LOCKED')).toBe('尚未开放')
    expect(trainingStageKindLabel('TEACHING')).toBe('统一讲解')
    expect(trainingHintOpenModeLabel('ATTEMPT')).toBe('按提交次数')
    expect(trainingStageEndReasonLabel('TEACHER_ENDED_EARLY')).toBe('教师提前结束')
    expect(trainingStageEndReasonLabel('提前完成课堂目标')).toBe('提前完成课堂目标')
  })

  it('does not leak unknown internal values into primary status labels', () => {
    expect(trainingStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
    expect(trainingStageStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
    expect(trainingProgressStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
    expect(trainingStageKindLabel('FUTURE_INTERNAL_VALUE')).toBe('训练阶段')
    expect(trainingHintOpenModeLabel('FUTURE_INTERNAL_VALUE')).toBe('开放方式待确认')
    expect(trainingStageEndReasonLabel('FUTURE_INTERNAL_VALUE')).toBe('结束原因待确认')
    expect(activityStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
    expect(reviewStatusLabel('pending')).toBe('待处理')
    expect(reviewStatusLabel('FUTURE_INTERNAL_VALUE')).toBe('状态待确认')
  })
})
