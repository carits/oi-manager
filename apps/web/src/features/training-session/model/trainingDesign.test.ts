import { describe, expect, it } from 'vitest'
import { isTrainingGroupingDefinitionLocked, isTrainingStageDefinitionLocked, unlockLabel, type Stage } from './trainingDesign'

const stage = (id: string, lifecycle: Stage['lifecycle']): Stage => ({
  id,
  clientKey: id,
  name: id,
  kind: 'TRAINING',
  lifecycle,
  Problems: [],
})

describe('training definition locking', () => {
  it('keeps pending stage definitions editable', () => {
    expect(isTrainingStageDefinitionLocked('stage-1', [stage('stage-1', 'PENDING')])).toBe(false)
    expect(isTrainingGroupingDefinitionLocked('SCHEDULED', [stage('stage-1', 'PENDING')])).toBe(false)
  })

  it.each(['RUNNING', 'ENDED', 'SKIPPED'] as const)('locks a stage after it reaches %s', lifecycle => {
    expect(isTrainingStageDefinitionLocked('stage-1', [stage('stage-1', lifecycle)])).toBe(true)
  })

  it('locks grouping definitions once runtime has started', () => {
    expect(isTrainingGroupingDefinitionLocked('RUNNING', [stage('stage-2', 'PENDING')])).toBe(true)
    expect(isTrainingGroupingDefinitionLocked('SCHEDULED', [stage('stage-1', 'ENDED'), stage('stage-2', 'PENDING')])).toBe(true)
  })

  it('presents unlock policies in classroom language', () => {
    expect(unlockLabel({ mode: 'ANY', conditions: [{ type: 'AC' }] })).toBe('满足任意一项 · 完成前一道题')
    expect(unlockLabel({ mode: 'ALL', conditions: [{ type: 'TIME', value: 600 }, { type: 'TEACHER' }] })).toBe('必须全部满足 · 用时达标 600 / 教练放行')
  })
})
