import { describe, expect, it } from 'vitest'
import { readTrainingListLocation, updateTrainingListLocation } from './trainingListLocation'

describe('training list URL state', () => {
  it('restores filters, search, team and page from a bookmarked URL', () => {
    expect(readTrainingListLocation(new URLSearchParams('status=completed&q=graph&page=3&teamId=team-a'))).toEqual({ status: 'completed', keyword: 'graph', page: 3, teamId: 'team-a' })
  })
  it.each(['-1', '0', 'NaN', '1.5', 'Infinity', '100001'])('normalizes invalid page %s', page => {
    expect(readTrainingListLocation(new URLSearchParams({ page, status: 'unknown' }))).toMatchObject({ page: 1, status: 'active' })
  })
  it('resets pagination on filter changes and preserves unrelated page context', () => {
    const next = updateTrainingListLocation(new URLSearchParams('tab=activities&page=7&q=old'), { keyword: 'new' })
    expect(next.get('page')).toBeNull()
    expect(next.get('tab')).toBe('activities')
    expect(next.get('q')).toBe('new')
  })
  it('isolates an embedded team training list from its parent filters', () => {
    const next = updateTrainingListLocation(new URLSearchParams('tab=activities&page=2&status=all'), { page: 4, status: 'completed' }, 'training.')
    expect(next.get('page')).toBe('2')
    expect(next.get('status')).toBe('all')
    expect(readTrainingListLocation(next, 'training.')).toMatchObject({ page: 4, status: 'completed' })
  })
  it('produces canonical default URLs without deleting unrelated parameters', () => {
    const next = updateTrainingListLocation(new URLSearchParams('status=draft&q=a&page=4&teamId=b&tab=list'), { status: 'active', keyword: '', teamId: '' })
    expect(next.toString()).toBe('tab=list')
  })
})
