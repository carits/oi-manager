import { describe, expect, it } from 'vitest'
import { shouldHideTrainingProblemSource } from '../src/modules/training/training.visibility'

const now = Date.now()
const runningContest = {
  id: 1,
  format: 'ioi',
  type: 'contest',
  status: 'ongoing',
  problemIdVisible: false,
  startTime: new Date(now - 60_000),
  endTime: new Date(now + 60_000),
  teamId: 'team-1',
}

describe('比赛题目来源可见性', () => {
  it('赛中配置为赛后显示时，对普通参赛者隐藏原题来源', () => {
    expect(shouldHideTrainingProblemSource(runningContest, false)).toBe(true)
  })

  it('管理员、始终显示、非比赛和赛后场景均不隐藏', () => {
    expect(shouldHideTrainingProblemSource(runningContest, true)).toBe(false)
    expect(shouldHideTrainingProblemSource({ ...runningContest, problemIdVisible: true }, false)).toBe(false)
    expect(shouldHideTrainingProblemSource({ ...runningContest, type: 'training' }, false)).toBe(false)
    expect(shouldHideTrainingProblemSource({ ...runningContest, status: 'finished', endTime: new Date(now - 1) }, false)).toBe(false)
  })
})
