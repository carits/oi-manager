import { describe, expect, it } from 'vitest'
import { isTrainingGroupingDefinitionLocked, isTrainingStageDefinitionLocked, type StageGroup } from './trainingDesign'

const unit = (stageId: string, status: StageGroup['status']): StageGroup => ({
  id: stageId + '-' + status, clientKey: stageId + '-' + status, stageId, stageName: stageId,
  groupId: 'group-1', groupName: '基础组', mode: 'PRACTICE', accessPolicy: 'ALL_AT_ONCE',
  submissionMode: 'ENABLED', transitionPolicy: 'WAIT_FOR_TEACHER', problemIds: [], status, activeElapsedSeconds: 0,
})

describe('training definition locking', () => {
  it('keeps pending stage definitions editable', () => {
    expect(isTrainingStageDefinitionLocked('stage-1', [unit('stage-1', 'PENDING')])).toBe(false)
    expect(isTrainingGroupingDefinitionLocked('SCHEDULED', [unit('stage-1', 'PENDING')])).toBe(false)
  })

  it.each(['RUNNING', 'PAUSED', 'ENDED', 'SKIPPED'] as const)('locks a stage after it reaches %s', status => {
    expect(isTrainingStageDefinitionLocked('stage-1', [unit('stage-1', status)])).toBe(true)
  })

  it('locks grouping definitions once runtime has started', () => {
    expect(isTrainingGroupingDefinitionLocked('RUNNING', [unit('stage-2', 'PENDING')])).toBe(true)
    expect(isTrainingGroupingDefinitionLocked('SCHEDULED', [unit('stage-1', 'ENDED'), unit('stage-2', 'PENDING')])).toBe(true)
  })
})
