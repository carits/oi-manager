import { describe, expect, it } from 'vitest'
import { isTrainingGroupingDefinitionLocked, isTrainingStageDefinitionLocked, type Stage } from './trainingDesign'

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
})
