import { describe, expect, it } from 'vitest'
import { compareDashboardTasks, resolveLearningFeedAvailability, taskUrgency, type LearningTask } from './dashboardTasks'

const base: LearningTask = { id: 'x', type: 'assignment', title: '任务', status: 'OPEN', href: '/', actionLabel: '继续', detail: '' }

describe('dashboard task priority', () => {
  const now = Date.parse('2026-09-12T08:00:00Z')

  it('puts overdue review, active events and near deadlines before drafts', () => {
    const tasks: LearningTask[] = [
      { ...base, id: 'draft', status: 'DRAFT' },
      { ...base, id: 'tomorrow', dueAt: '2026-09-13T07:00:00Z' },
      { ...base, id: 'review', status: 'REVIEWING' },
      { ...base, id: 'contest', type: 'contest', status: 'ONGOING' },
    ]
    expect(tasks.sort((a, b) => compareDashboardTasks(a, b, now)).map(item => item.id)).toEqual(['review', 'contest', 'tomorrow', 'draft'])
  })

  it('uses the next action time inside the same priority', () => {
    const later = { ...base, id: 'later', dueAt: '2026-09-14T10:00:00Z' }
    const sooner = { ...base, id: 'sooner', dueAt: '2026-09-14T09:00:00Z' }
    expect(compareDashboardTasks(sooner, later, now)).toBeLessThan(0)
    expect(taskUrgency({ ...base, dueAt: '2026-09-12T07:00:00Z' }, now)).toBe(0)
  })
})

describe('learning feed availability', () => {
  it('keeps an all-pending feed unknown', () => {
    expect(resolveLearningFeedAvailability([
      { state: 'pending' },
      { state: 'pending' },
      { state: 'pending' },
    ])).toEqual({ status: 'loading', hasPending: true, hasError: false })
  })

  it('only treats fully resolved sources as authoritative', () => {
    expect(resolveLearningFeedAvailability([
      { state: 'ready' },
      { state: 'empty' },
      { state: 'ready' },
    ])).toEqual({ status: 'ready', hasPending: false, hasError: false })
  })

  it('distinguishes total failure from a partial feed', () => {
    expect(resolveLearningFeedAvailability([
      { state: 'error' },
      { state: 'error' },
      { state: 'error' },
    ])).toEqual({ status: 'error', hasPending: false, hasError: true })

    expect(resolveLearningFeedAvailability([
      { state: 'ready' },
      { state: 'error' },
      { state: 'pending' },
    ])).toEqual({ status: 'partial', hasPending: true, hasError: true })
  })

  it('keeps stale previous data visible but marks the feed degraded', () => {
    expect(resolveLearningFeedAvailability([
      { state: 'error', hasData: true },
      { state: 'error' },
    ])).toEqual({ status: 'partial', hasPending: false, hasError: true })
  })
})
