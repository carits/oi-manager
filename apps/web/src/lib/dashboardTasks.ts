export type LearningTaskType = 'assignment' | 'training' | 'contest'

export interface LearningTask {
  id: string
  type: LearningTaskType
  title: string
  status: string
  href: string
  actionLabel: string
  actionAt?: string | null
  dueAt?: string | null
  detail: string
  problemCount?: number
}

function timestamp(value?: string | null) {
  const parsed = value ? new Date(value).getTime() : Number.POSITIVE_INFINITY
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

/** Human task-inbox priority. Lower values are more urgent. */
export function taskUrgency(task: LearningTask, now = Date.now()) {
  if (['OVERDUE', 'REVIEWING'].includes(task.status)) return 0
  if (task.type === 'contest' && task.status === 'ONGOING') return 1
  if (task.type === 'training' && ['RUNNING', 'PAUSED'].includes(task.status)) return 1
  const deadline = timestamp(task.dueAt)
  if (deadline <= now) return 0
  if (deadline <= now + 24 * 60 * 60_000) return 2
  const actionAt = timestamp(task.actionAt)
  if (actionAt <= now + 24 * 60 * 60_000) return 3
  if (task.status === 'DRAFT') return 5
  return 4
}

export function compareDashboardTasks(a: LearningTask, b: LearningTask, now = Date.now()) {
  const priority = taskUrgency(a, now) - taskUrgency(b, now)
  if (priority) return priority
  const aTime = Math.min(timestamp(a.dueAt), timestamp(a.actionAt))
  const bTime = Math.min(timestamp(b.dueAt), timestamp(b.actionAt))
  return aTime - bTime || a.title.localeCompare(b.title, 'zh-CN')
}

export type LearningResourceAvailabilityState = 'pending' | 'ready' | 'empty' | 'error'

export interface LearningResourceAvailability {
  state: LearningResourceAvailabilityState
  hasData?: boolean
}

export interface LearningFeedAvailability {
  status: 'loading' | 'partial' | 'ready' | 'error'
  hasPending: boolean
  hasError: boolean
}

/**
 * Keeps an incomplete learning feed from being presented as an authoritative empty result.
 * Error snapshots with previous data remain usable, but the feed stays visibly degraded.
 */
export function resolveLearningFeedAvailability(
  resources: LearningResourceAvailability[],
): LearningFeedAvailability {
  const hasPending = resources.some(resource => resource.state === 'pending')
  const hasError = resources.some(resource => resource.state === 'error')
  const hasUsableData = resources.some(resource =>
    resource.state === 'ready' || resource.state === 'empty' || resource.hasData === true,
  )

  if (resources.length === 0 || resources.every(resource => resource.state === 'pending')) {
    return { status: 'loading', hasPending: true, hasError: false }
  }
  if (resources.every(resource => resource.state === 'error') && !hasUsableData) {
    return { status: 'error', hasPending: false, hasError: true }
  }
  if (hasPending || hasError) {
    return { status: 'partial', hasPending, hasError }
  }
  return { status: 'ready', hasPending: false, hasError: false }
}
