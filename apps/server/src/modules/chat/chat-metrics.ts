const recentSendDurations: number[] = []
const counters = {
  activeConnections: 0,
  reconnectTotal: 0,
  resyncTotal: 0,
  backlogEventsTotal: 0,
  flushFailuresTotal: 0,
  messageSendTotal: 0,
  messageSendFailuresTotal: 0,
  maintenanceScannedTotal: 0,
  maintenanceFailuresTotal: 0,
}

const percentile = (values: number[], ratio: number) => {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

export const chatMetrics = {
  connectionOpened() { counters.activeConnections += 1 },
  connectionClosed() { counters.activeConnections = Math.max(0, counters.activeConnections - 1) },
  reconnect() { counters.reconnectTotal += 1 },
  resync() { counters.resyncTotal += 1 },
  backlog(count: number) { counters.backlogEventsTotal += count },
  flushFailure() { counters.flushFailuresTotal += 1 },
  messageSend(durationMs: number, success: boolean) {
    counters.messageSendTotal += 1
    if (!success) counters.messageSendFailuresTotal += 1
    recentSendDurations.push(durationMs)
    if (recentSendDurations.length > 100) recentSendDurations.shift()
  },
  maintenance(scanned: number, success: boolean) {
    counters.maintenanceScannedTotal += scanned
    if (!success) counters.maintenanceFailuresTotal += 1
  },
  snapshot() { return { ...counters, messageSendP95Ms: percentile(recentSendDurations, 0.95) } },
  resetWindow() {
    const activeConnections = counters.activeConnections
    for (const key of Object.keys(counters) as Array<keyof typeof counters>) counters[key] = 0
    counters.activeConnections = activeConnections
    recentSendDurations.length = 0
  },
}
