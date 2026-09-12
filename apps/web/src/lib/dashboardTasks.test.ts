import { describe, expect, it } from 'vitest'
import { compareDashboardTasks, taskUrgency, type LearningTask } from './dashboardTasks'

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
