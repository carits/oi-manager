import { TrainingEngineError } from './training-engine.errors'

export type TrainingStageEngineRolloutMode = 'enabled' | 'read_only'

export function trainingStageEngineRolloutMode(): TrainingStageEngineRolloutMode {
  return String(process.env.TRAINING_STAGE_ENGINE_ROLLOUT || 'enabled').toLowerCase() === 'read_only'
    ? 'read_only'
    : 'enabled'
}

export function assertTrainingDefinitionWritesEnabled() {
  if (trainingStageEngineRolloutMode() === 'read_only') {
    throw new TrainingEngineError(503, 'TRAINING_STAGE_ENGINE_READ_ONLY', 'Training Stage Engine 当前处于只读发布模式，暂不允许新建或修改训练 Definition')
  }
}
