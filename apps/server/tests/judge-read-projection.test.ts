import { describe, expect, it } from 'vitest'
import { projectSubmissionJudgeResult } from '../src/modules/judge/application/judge-read-projection'

const compatibility = {
  result: 'wa',
  score: 0,
  cases: 'legacy-cases',
  subtasks: 'legacy-subtasks',
  errorMessage: 'legacy-error',
  timeUsed: 1,
  wallTimeUsed: 2,
  memoryUsed: 3,
  timeoutReason: 'legacy-timeout',
  metricSource: 'legacy',
}

function run(status: 'QUEUED' | 'RUNNING' | 'FINALIZED' | 'CANCELLED', result: string | null = null) {
  return {
    status,
    result,
    score: 100,
    cases: 'run-cases',
    subtasks: 'run-subtasks',
    errorMessage: null,
    timeUsed: 10,
    wallTimeUsed: 20,
    memoryUsed: 30,
    timeoutReason: null,
    metricSource: 'judge-run',
  }
}

describe('JudgeRun switch-read projection', () => {
  it('maps active lifecycle states without consulting compatibility result', () => {
    expect(projectSubmissionJudgeResult({ ...compatibility, CurrentJudgeRun: run('QUEUED') }).result).toBe('queuing')
    expect(projectSubmissionJudgeResult({ ...compatibility, CurrentJudgeRun: run('RUNNING') }).result).toBe('judging')
  })

  it('projects finalized result, score, details and metrics exclusively from JudgeRun', () => {
    const projected = projectSubmissionJudgeResult({
      ...compatibility,
      CurrentJudgeRun: run('FINALIZED', 'accepted'),
    })
    expect(projected).toMatchObject({
      result: 'accepted',
      score: 100,
      cases: 'run-cases',
      subtasks: 'run-subtasks',
      timeUsed: 10,
      wallTimeUsed: 20,
      memoryUsed: 30,
      metricSource: 'judge-run',
    })
  })

  it('uses deterministic fail-closed results for terminal runs without a verdict', () => {
    expect(projectSubmissionJudgeResult({ ...compatibility, CurrentJudgeRun: run('FINALIZED') }).result).toBe('unknown_error')
    expect(projectSubmissionJudgeResult({ ...compatibility, CurrentJudgeRun: run('CANCELLED') }).result).toBe('judge_failed')
  })

  it('keeps archive and legacy rows without a JudgeRun on compatibility fields', () => {
    expect(projectSubmissionJudgeResult({ ...compatibility, CurrentJudgeRun: null })).toMatchObject(compatibility)
  })
})
