import { Prisma } from '@prisma/client'

export const CURRENT_JUDGE_RUN_SELECT = {
  status: true,
  result: true,
  score: true,
  cases: true,
  subtasks: true,
  errorMessage: true,
  timeUsed: true,
  wallTimeUsed: true,
  memoryUsed: true,
  timeoutReason: true,
  metricSource: true,
} satisfies Prisma.JudgeRunSelect

type CurrentJudgeRunProjection = {
  status: 'QUEUED' | 'RUNNING' | 'FINALIZED' | 'CANCELLED'
  result: string | null
  score: number | null
  cases: string | null
  subtasks: string | null
  errorMessage: string | null
  timeUsed: number | null
  wallTimeUsed: number | null
  memoryUsed: number | null
  timeoutReason: string | null
  metricSource: string | null
}

type SubmissionCompatibilityProjection = {
  result: string
  score?: number | null
  cases?: string | null
  subtasks?: string | null
  errorMessage?: string | null
  timeUsed?: number | null
  wallTimeUsed?: number | null
  memoryUsed?: number | null
  timeoutReason?: string | null
  metricSource?: string | null
  CurrentJudgeRun?: CurrentJudgeRunProjection | null
}

function runDisplayResult(run: CurrentJudgeRunProjection): string {
  if (run.status === 'QUEUED') return 'queuing'
  if (run.status === 'RUNNING') return 'judging'
  if (run.status === 'CANCELLED') return run.result || 'judge_failed'
  return run.result || 'unknown_error'
}

/**
 * Switch-read boundary for submission results.
 *
 * Local Judge submissions read exclusively from their current JudgeRun. Remote
 * archives and legacy rows without a run keep using the compatibility columns.
 */
export function projectSubmissionJudgeResult<T extends SubmissionCompatibilityProjection>(submission: T): T {
  const run = submission.CurrentJudgeRun
  if (!run) return submission
  return {
    ...submission,
    result: runDisplayResult(run),
    score: run.score,
    cases: run.cases,
    subtasks: run.subtasks,
    errorMessage: run.errorMessage,
    timeUsed: run.timeUsed,
    wallTimeUsed: run.wallTimeUsed,
    memoryUsed: run.memoryUsed,
    timeoutReason: run.timeoutReason,
    metricSource: run.metricSource,
  }
}

export function currentJudgeResultWhere(result: string): Prisma.SubmissionWhereInput {
  if (result === 'queuing') {
    return {
      OR: [
        { CurrentJudgeRun: { is: { status: 'QUEUED' } } },
        { currentJudgeRunId: null, result },
      ],
    }
  }
  if (result === 'judging') {
    return {
      OR: [
        { CurrentJudgeRun: { is: { status: 'RUNNING' } } },
        { currentJudgeRunId: null, result },
      ],
    }
  }
  return {
    OR: [
      { CurrentJudgeRun: { is: { status: { in: ['FINALIZED', 'CANCELLED'] }, result } } },
      { currentJudgeRunId: null, result },
    ],
  }
}

export function currentJudgeInProgressWhere(): Prisma.SubmissionWhereInput {
  return {
    OR: [
      { CurrentJudgeRun: { is: { status: { in: ['QUEUED', 'RUNNING'] } } } },
      { currentJudgeRunId: null, result: { in: ['queuing', 'judging'] } },
    ],
  }
}

export function currentJudgeCompletedWhere(): Prisma.SubmissionWhereInput {
  return { NOT: currentJudgeInProgressWhere() }
}

export function currentJudgeAcceptedWhere(): Prisma.SubmissionWhereInput {
  const accepted = ['accepted', 'Accepted', 'AC', 'ac']
  return {
    OR: [
      { CurrentJudgeRun: { is: { status: 'FINALIZED', result: { in: accepted } } } },
      { currentJudgeRunId: null, result: { in: accepted } },
    ],
  }
}
