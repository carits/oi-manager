import { describe, expect, it } from 'vitest'
import { JudgeAttemptState, JudgeRunStatus } from '@prisma/client'
import { prisma } from '../src/prisma'
import { createQueuedSubmissionWithRun } from '../src/modules/judge/application/judge-run.service'
import {
  assertJudgeAttemptTransition,
  assertJudgeRunTransition,
  InvalidJudgeTransition,
  isTerminalJudgeAttemptState,
  isTerminalJudgeRunState,
  JUDGE_ATTEMPT_TRANSITIONS,
  JUDGE_RUN_TRANSITIONS,
  legacyResultToAttemptState,
} from '../src/modules/judge/domain/judge-state'

describe('Judge domain state machine', () => {
  it('allows only declared JudgeRun transitions', () => {
    expect(() => assertJudgeRunTransition('QUEUED', 'RUNNING')).not.toThrow()
    expect(() => assertJudgeRunTransition('RUNNING', 'FINALIZED')).not.toThrow()
    expect(() => assertJudgeRunTransition('FINALIZED', 'RUNNING')).toThrow(InvalidJudgeTransition)
    expect(() => assertJudgeRunTransition('CANCELLED', 'QUEUED')).toThrow(InvalidJudgeTransition)
  })

  it('allows retry only by creating another attempt, never by reopening a terminal attempt', () => {
    expect(() => assertJudgeAttemptTransition('QUEUED', 'CLAIMED')).not.toThrow()
    expect(() => assertJudgeAttemptTransition('CLAIMED', 'COMPILING')).not.toThrow()
    expect(() => assertJudgeAttemptTransition('COMPILING', 'RUNNING')).not.toThrow()
    expect(() => assertJudgeAttemptTransition('RUNNING', 'FINALIZING')).not.toThrow()
    expect(() => assertJudgeAttemptTransition('FINALIZING', 'SUCCEEDED')).not.toThrow()
    for (const terminal of ['SUCCEEDED', 'USER_ERROR', 'INFRA_ERROR', 'CANCELLED'] as JudgeAttemptState[]) {
      expect(JUDGE_ATTEMPT_TRANSITIONS[terminal]).toEqual([])
      expect(() => assertJudgeAttemptTransition(terminal, 'RUNNING')).toThrow(InvalidJudgeTransition)
    }
  })

  it('defines terminal states explicitly', () => {
    for (const state of Object.values(JudgeRunStatus)) {
      expect(isTerminalJudgeRunState(state)).toBe(JUDGE_RUN_TRANSITIONS[state].length === 0)
    }
    for (const state of Object.values(JudgeAttemptState)) {
      expect(isTerminalJudgeAttemptState(state)).toBe(JUDGE_ATTEMPT_TRANSITIONS[state].length === 0)
    }
  })

  it('maps compatibility results without creating illegal states', () => {
    expect(legacyResultToAttemptState('queuing')).toBe('QUEUED')
    expect(legacyResultToAttemptState('judging')).toBe('RUNNING')
    expect(legacyResultToAttemptState('accepted')).toBe('SUCCEEDED')
    expect(legacyResultToAttemptState('wa')).toBe('USER_ERROR')
    expect(legacyResultToAttemptState('judge_failed')).toBe('INFRA_ERROR')
  })
})

describe('Submission and Judge lifecycle creation', () => {
  it('creates Submission, JudgeRun and JudgeAttempt atomically', async () => {
    const userId = `judge-domain-user-${Date.now()}`
    const problemId = `judge-domain-problem-${Date.now()}`
    await prisma.user.create({ data: {
      id: userId, username: userId, passwordHash: 'test', role: 'student', status: 'active',
    } })
    await prisma.problem.create({ data: {
      id: problemId, platform: 'carits', problemId, title: 'Judge domain test',
      ownerId: userId, ownerType: 'user', visibility: 'private', status: 'published',
    } })

    const submission = await createQueuedSubmissionWithRun({
      userId, oj: 'carits', problemId, problemInternalId: problemId,
      language: 'cpp', code: 'int main(){}', codeLength: 12,
      result: 'queuing', submitMethod: 'local', submitScope: 'problem',
    })
    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: submission.id },
      include: { CurrentJudgeRun: { include: { CurrentAttempt: true, Attempts: true } }, JudgeRuns: true },
    })
    expect(stored.CurrentJudgeRun).toMatchObject({
      runNumber: 1, runType: 'NORMAL', status: 'QUEUED', requestedBy: userId,
    })
    expect(stored.CurrentJudgeRun?.CurrentAttempt).toMatchObject({ attemptNumber: 1, state: 'QUEUED' })
    expect(stored.CurrentJudgeRun?.Attempts).toHaveLength(1)
    expect(stored.JudgeRuns).toHaveLength(1)
  })

  it('does not create local Judge lifecycle rows for archive records', async () => {
    await expect(createQueuedSubmissionWithRun({
      userId: 'unused', oj: 'codeforces', problemId: '1A', language: 'cpp',
      code: '', codeLength: 0, result: 'accepted', submitMethod: 'archive',
    })).rejects.toThrow('Archive submissions do not create local Judge runs')
  })
})
