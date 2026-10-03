export type ProgressiveStagePurpose = 'PRACTICE' | 'GUIDED' | 'TEACHING' | 'REVIEW'

export const progressiveStagePurposeDefaults = {
  PRACTICE: { kind: 'TRAINING', mode: 'PRACTICE', submissionMode: 'ENABLED' },
  GUIDED: { kind: 'TRAINING', mode: 'GUIDED', submissionMode: 'ENABLED' },
  TEACHING: { kind: 'TEACHING', mode: 'GUIDED', submissionMode: 'DISABLED' },
  REVIEW: { kind: 'REVIEW', mode: 'REVIEW', submissionMode: 'DISABLED' },
} as const

export function progressiveStageQueueState(stages: Array<{ lifecycle: string }>) {
  const pendingCount = stages.filter(stage => stage.lifecycle === 'PENDING').length
  return {
    pendingCount,
    legacy: pendingCount > 1,
    canPrepare: pendingCount <= 1,
  }
}

export function progressiveStageAllowsEmptyProblems(purpose: ProgressiveStagePurpose) {
  return purpose === 'TEACHING' || purpose === 'REVIEW'
}
