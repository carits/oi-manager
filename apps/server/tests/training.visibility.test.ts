import { describe, expect, it } from 'vitest'
import { shouldHideTrainingProblemIdentity } from '../src/modules/training/training.visibility'

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

describe('比赛题目身份可见性', () => {
  it('赛中题号赛后显示时，普通参赛者必须被脱敏', () => {
    expect(shouldHideTrainingProblemIdentity(runningContest, false)).toBe(true)
  })

  it('管理员、始终显示、非比赛和赛后场景均不脱敏', () => {
    expect(shouldHideTrainingProblemIdentity(runningContest, true)).toBe(false)
    expect(shouldHideTrainingProblemIdentity({ ...runningContest, problemIdVisible: true }, false)).toBe(false)
    expect(shouldHideTrainingProblemIdentity({ ...runningContest, type: 'training' }, false)).toBe(false)
    expect(shouldHideTrainingProblemIdentity({ ...runningContest, status: 'finished', endTime: new Date(now - 1) }, false)).toBe(false)
  })
})
