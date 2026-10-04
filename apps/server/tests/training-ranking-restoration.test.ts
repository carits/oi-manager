import { describe, expect, it } from 'vitest'
import { calculateTrainingRankingMetrics } from '../src/modules/training-engine/training-engine.service'

const startedAt = new Date('2026-10-04T00:00:00.000Z')

describe('training ranking restoration', () => {
  it('removes and restores an OI score with the effective problem set', () => {
    const progress = [{ sessionProblemId: 'problem-a', status: 'WORKING', bestScore: 80, attemptCount: 2 }]
    const metrics = (effectiveProblemIds: string[]) => calculateTrainingRankingMetrics({ sessionType: 'OI', effectiveProblemIds, progress, submissions: [], userId: 'user-1', startedAt })
    expect(metrics(['problem-a'])).toMatchObject({ score: 80, attempts: 2, total: 1 })
    expect(metrics([])).toMatchObject({ score: 0, attempts: 0, total: 0 })
    expect(metrics(['problem-a'])).toMatchObject({ score: 80, attempts: 2, total: 1 })
  })

  it('removes and restores ACM attempts, accepted state and penalty', () => {
    const submissions = [
      { userId: 'user-1', trainingSessionProblemId: 'problem-a', createdAt: new Date('2026-10-04T00:10:00.000Z'), CurrentJudgeRun: { result: 'Wrong Answer' } },
      { userId: 'user-1', trainingSessionProblemId: 'problem-a', createdAt: new Date('2026-10-04T00:20:00.000Z'), CurrentJudgeRun: { result: 'Wrong Answer' } },
      { userId: 'user-1', trainingSessionProblemId: 'problem-a', createdAt: new Date('2026-10-04T00:40:00.000Z'), CurrentJudgeRun: { result: 'Accepted' } },
    ]
    const metrics = (effectiveProblemIds: string[]) => calculateTrainingRankingMetrics({ sessionType: 'ACM', effectiveProblemIds, progress: [], submissions, userId: 'user-1', startedAt })
    expect(metrics(['problem-a'])).toMatchObject({ completed: 1, attempts: 3, penaltyMinutes: 80, total: 1 })
    expect(metrics([])).toMatchObject({ completed: 0, attempts: 0, penaltyMinutes: 0, total: 0 })
    expect(metrics(['problem-a'])).toMatchObject({ completed: 1, attempts: 3, penaltyMinutes: 80, total: 1 })
  })
})
