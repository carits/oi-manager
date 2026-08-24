import { describe, expect, it } from 'vitest'
import {
  trainingProblemCode,
  trainingProblemSectionTitle,
  trainingProblemTitle,
} from './problem-label'

describe('training problem labels', () => {
  it('keeps a visible activity title', () => {
    expect(trainingProblemTitle({ orderIndex: 0, problemTitle: 'Median' })).toBe('Median')
  })

  it('uses a privacy-safe label when source identity is hidden', () => {
    expect(trainingProblemTitle({ orderIndex: 0 })).toBe('题目 A')
    expect(trainingProblemTitle({ orderIndex: 26 })).toBe('题目 AA')
    expect(trainingProblemSectionTitle({ orderIndex: 1 })).toBe('题目')
  })

  it('normalizes invalid order indexes', () => {
    expect(trainingProblemCode(undefined)).toBe('A')
    expect(trainingProblemCode(-1)).toBe('A')
  })
})
