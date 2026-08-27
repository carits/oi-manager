import { JudgeAttemptState, JudgeRunStatus } from '@prisma/client'

export class InvalidJudgeTransition extends Error {
  constructor(entity: 'JudgeRun' | 'JudgeAttempt', from: string, to: string) {
    super(`${entity} cannot transition from ${from} to ${to}`)
    this.name = 'InvalidJudgeTransition'
  }
}

export const JUDGE_RUN_TRANSITIONS: Readonly<Record<JudgeRunStatus, readonly JudgeRunStatus[]>> = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['FINALIZED', 'CANCELLED'],
  FINALIZED: [],
  CANCELLED: [],
}

export const JUDGE_ATTEMPT_TRANSITIONS: Readonly<Record<JudgeAttemptState, readonly JudgeAttemptState[]>> = {
  QUEUED: ['CLAIMED', 'CANCELLED'],
  CLAIMED: ['COMPILING', 'RUNNING', 'INFRA_ERROR', 'CANCELLED'],
  COMPILING: ['RUNNING', 'USER_ERROR', 'INFRA_ERROR', 'CANCELLED'],
  RUNNING: ['FINALIZING', 'USER_ERROR', 'INFRA_ERROR', 'CANCELLED'],
  FINALIZING: ['SUCCEEDED', 'USER_ERROR', 'INFRA_ERROR', 'CANCELLED'],
  SUCCEEDED: [],
  USER_ERROR: [],
  INFRA_ERROR: [],
  CANCELLED: [],
}

export const TERMINAL_JUDGE_RUN_STATES = new Set<JudgeRunStatus>(['FINALIZED', 'CANCELLED'])
export const TERMINAL_JUDGE_ATTEMPT_STATES = new Set<JudgeAttemptState>([
  'SUCCEEDED', 'USER_ERROR', 'INFRA_ERROR', 'CANCELLED',
])

export function assertJudgeRunTransition(from: JudgeRunStatus, to: JudgeRunStatus) {
  if (!JUDGE_RUN_TRANSITIONS[from].includes(to)) throw new InvalidJudgeTransition('JudgeRun', from, to)
}

export function assertJudgeAttemptTransition(from: JudgeAttemptState, to: JudgeAttemptState) {
  if (!JUDGE_ATTEMPT_TRANSITIONS[from].includes(to)) throw new InvalidJudgeTransition('JudgeAttempt', from, to)
}

export function isTerminalJudgeRunState(state: JudgeRunStatus) {
  return TERMINAL_JUDGE_RUN_STATES.has(state)
}

export function isTerminalJudgeAttemptState(state: JudgeAttemptState) {
  return TERMINAL_JUDGE_ATTEMPT_STATES.has(state)
}

export function legacyResultToAttemptState(result: string): JudgeAttemptState {
  if (result === 'queuing') return 'QUEUED'
  if (result === 'judging') return 'RUNNING'
  if (result === 'accepted') return 'SUCCEEDED'
  if (['judge_failed', 'unknown_error', 'remote_unavailable', 'submit_failed'].includes(result)) return 'INFRA_ERROR'
  return 'USER_ERROR'
}
