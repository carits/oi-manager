import { describe, expect, it } from 'vitest'
import { compareContestSchedules, contestLifecycle } from './contestOrdering'

const now = Date.parse('2026-09-12T10:00:00Z')
const item = (startTime: string, endTime: string, title = '') => ({ startTime, endTime, title })

describe('contest schedule ordering', () => {
  it('orders lifecycle groups without reading title numbers', () => {
    const contests = [
      item('2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', '第 999 周'),
      item('2026-09-12T10:10:00Z', '2026-09-12T12:00:00Z', '第 3 周'),
      item('2026-09-12T09:00:00Z', '2026-09-12T11:00:00Z', '2026 暑假赛'),
    ].sort((a, b) => compareContestSchedules(a, b, now))
    expect(contests.map(contest => contest.title)).toEqual(['2026 暑假赛', '第 3 周', '第 999 周'])
  })

  it('shows the nearest upcoming contest and most recent finished contest first', () => {
    const upcoming = [
      item('2026-10-01T00:00:00Z', '2026-10-01T02:00:00Z'),
      item('2026-09-12T10:10:00Z', '2026-09-12T12:00:00Z'),
    ].sort((a, b) => compareContestSchedules(a, b, now))
    expect(upcoming[0].startTime).toBe('2026-09-12T10:10:00Z')

    const finished = [
      item('2026-08-01T00:00:00Z', '2026-08-01T02:00:00Z'),
      item('2026-09-11T00:00:00Z', '2026-09-11T02:00:00Z'),
    ].sort((a, b) => compareContestSchedules(a, b, now))
    expect(finished[0].endTime).toBe('2026-09-11T02:00:00Z')
  })

  it('derives lifecycle from timestamps instead of stale labels', () => {
    expect(contestLifecycle({ startTime: '2026-09-12T09:00:00Z', endTime: '2026-09-12T11:00:00Z', status: 'upcoming' }, now)).toBe('ongoing')
  })
})
