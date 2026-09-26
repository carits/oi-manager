import { describe, expect, it } from 'vitest'
import {
  contestProblemCode,
  contestProblemSectionTitle,
  contestProblemTitle,
} from './problem-label'

describe('contest problem labels', () => {
  it('keeps a visible activity title', () => {
    expect(contestProblemTitle({ orderIndex: 0, problemTitle: 'Median' })).toBe('Median')
  })

  it('uses a privacy-safe label when source identity is hidden', () => {
    expect(contestProblemTitle({ orderIndex: 0 })).toBe('题目 A')
    expect(contestProblemTitle({ orderIndex: 26 })).toBe('题目 AA')
    expect(contestProblemSectionTitle({ orderIndex: 1 })).toBe('题目')
  })

  it('normalizes invalid order indexes', () => {
    expect(contestProblemCode(undefined)).toBe('A')
    expect(contestProblemCode(-1)).toBe('A')
  })
})
