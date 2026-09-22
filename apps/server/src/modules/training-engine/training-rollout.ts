export type TrainingStageEngineRolloutMode = 'enabled' | 'read_only'

export function trainingStageEngineRolloutMode(): TrainingStageEngineRolloutMode {
  return String(process.env.TRAINING_STAGE_ENGINE_ROLLOUT || 'enabled').toLowerCase() === 'read_only'
    ? 'read_only'
    : 'enabled'
}

export function assertTrainingDefinitionWritesEnabled() {
  if (trainingStageEngineRolloutMode() === 'read_only') {
    const error = new Error('Training Stage Engine is in read-only rollout mode') as Error & { code?: string; statusCode?: number }
    error.code = 'TRAINING_STAGE_ENGINE_READ_ONLY'
    error.statusCode = 503
    throw error
  }
}
