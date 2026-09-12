export type ContestLifecycle = 'ongoing' | 'upcoming' | 'finished'

export interface ContestSchedule {
  startTime: string
  endTime: string
  status?: string
}

export function contestLifecycle(item: ContestSchedule, now = Date.now()): ContestLifecycle {
  const start = new Date(item.startTime).getTime()
  const end = new Date(item.endTime).getTime()
  if (now < start) return 'upcoming'
  if (now <= end) return 'ongoing'
  return 'finished'
}

const lifecyclePriority: Record<ContestLifecycle, number> = {
  ongoing: 0,
  upcoming: 1,
  finished: 2,
}

export function compareContestSchedules<T extends ContestSchedule>(a: T, b: T, now = Date.now()) {
  const aLifecycle = contestLifecycle(a, now)
  const bLifecycle = contestLifecycle(b, now)
  const lifecycleDiff = lifecyclePriority[aLifecycle] - lifecyclePriority[bLifecycle]
  if (lifecycleDiff) return lifecycleDiff

  const aStart = new Date(a.startTime).getTime()
  const bStart = new Date(b.startTime).getTime()
  const aEnd = new Date(a.endTime).getTime()
  const bEnd = new Date(b.endTime).getTime()

  if (aLifecycle === 'ongoing') return aEnd - bEnd || bStart - aStart
  if (aLifecycle === 'upcoming') return aStart - bStart
  return bEnd - aEnd || bStart - aStart
}
