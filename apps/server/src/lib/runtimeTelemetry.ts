export type RuntimeEventKind = 'info' | 'warn' | 'error' | 'audit' | 'security'

interface RuntimeEventMetric {
  kind: RuntimeEventKind
  action: string
  count: number
  firstSeenAt: string
  lastSeenAt: string
}

const MAX_EVENT_SERIES = 512
const events = new Map<string, RuntimeEventMetric>()
let droppedSeries = 0

function normalizeAction(action: string): string {
  const normalized = action
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
  return normalized || 'unknown'
}

export function recordRuntimeEvent(kind: RuntimeEventKind, action: string, now = new Date()): void {
  const normalizedAction = normalizeAction(action)
  const key = `${kind}:${normalizedAction}`
  const timestamp = now.toISOString()
  const existing = events.get(key)
  if (existing) {
    existing.count += 1
    existing.lastSeenAt = timestamp
    return
  }

  if (events.size >= MAX_EVENT_SERIES) {
    droppedSeries += 1
    return
  }

  events.set(key, {
    kind,
    action: normalizedAction,
    count: 1,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
  })
}

export function getRuntimeEventSummary(): {
  series: RuntimeEventMetric[]
  droppedSeries: number
} {
  return {
    series: Array.from(events.values())
      .map(metric => ({ ...metric }))
      .sort((left, right) => right.count - left.count || left.action.localeCompare(right.action)),
    droppedSeries,
  }
}

export function resetRuntimeTelemetry(): void {
  events.clear()
  droppedSeries = 0
}
