import { describe, expect, it } from 'vitest'
import { assertTrainingSubmissionWindow } from '../src/modules/training-engine/training-engine.service'

function runningSession(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-10-04T00:10:00.000Z')
  return {
    now,
    session: {
      status: 'RUNNING' as const,
      currentRoundId: 'round-1',
      totalDurationSeconds: 1200,
      activeElapsedSeconds: 0,
      runningSince: new Date('2026-10-04T00:00:00.000Z'),
      Rounds: [{
        id: 'round-1',
        lifecycle: 'RUNNING',
        timeLimitSeconds: 900,
        activeElapsedSeconds: 0,
        runningSince: new Date('2026-10-04T00:00:00.000Z'),
      }],
      ...overrides,
    },
  }
}

describe('training submission window', () => {
  it('accepts submissions while both session and round remain open', () => {
    const { session, now } = runningSession()
    expect(() => assertTrainingSubmissionWindow(session, now)).not.toThrow()
  })

  it('rejects immediately when the session duration is reached', () => {
    const { session, now } = runningSession({ totalDurationSeconds: 600 })
    expect(() => assertTrainingSubmissionWindow(session, now)).toThrowError(expect.objectContaining({ code: 'TRAINING_SESSION_TIME_REACHED' }))
  })

  it('rejects immediately when the current round duration is reached', () => {
    const { session, now } = runningSession({
      Rounds: [{ id: 'round-1', lifecycle: 'RUNNING', timeLimitSeconds: 600, activeElapsedSeconds: 0, runningSince: new Date('2026-10-04T00:00:00.000Z') }],
    })
    expect(() => assertTrainingSubmissionWindow(session, now)).toThrowError(expect.objectContaining({ code: 'TRAINING_ROUND_TIME_REACHED' }))
  })
})
