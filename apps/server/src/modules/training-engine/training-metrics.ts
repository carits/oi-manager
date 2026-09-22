type LatencyWindow = {
  count: number
  totalMs: number
  maxMs: number
  samples: number[]
}

const MAX_SAMPLES = 200

function percentile(values: number[], p: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return Math.round(sorted[index] * 1000) / 1000
}

class TrainingMetrics {
  private activeSessionIds = new Set<string>()
  private stageTransitionTotal = 0
  private commandTotal = 0
  private commandFailureTotal = 0
  private sseConnections = 0
  private workspaceQueryCount = 0
  private groupMoveTotal = 0
  private permissionLatency: LatencyWindow = { count: 0, totalMs: 0, maxMs: 0, samples: [] }

  observeSession(sessionId: string, status: string) {
    if (['RUNNING', 'PAUSED'].includes(status)) this.activeSessionIds.add(sessionId)
    else this.activeSessionIds.delete(sessionId)
  }

  recordStageTransition() {
    this.stageTransitionTotal += 1
  }

  recordCommand(success: boolean) {
    this.commandTotal += 1
    if (!success) this.commandFailureTotal += 1
  }

  openSseConnection() {
    this.sseConnections += 1
  }

  closeSseConnection() {
    this.sseConnections = Math.max(0, this.sseConnections - 1)
  }

  recordPermissionLatency(durationMs: number) {
    const value = Math.max(0, durationMs)
    this.permissionLatency.count += 1
    this.permissionLatency.totalMs += value
    this.permissionLatency.maxMs = Math.max(this.permissionLatency.maxMs, value)
    this.permissionLatency.samples.push(value)
    if (this.permissionLatency.samples.length > MAX_SAMPLES) this.permissionLatency.samples.shift()
  }

  recordWorkspaceQueries(count: number) {
    this.workspaceQueryCount += Math.max(0, Math.floor(count))
  }

  recordGroupMove() {
    this.groupMoveTotal += 1
  }

  snapshot() {
    return {
      training_session_active_count: this.activeSessionIds.size,
      training_stage_transition_total: this.stageTransitionTotal,
      training_command_total: this.commandTotal,
      training_command_failure_total: this.commandFailureTotal,
      training_sse_connections: this.sseConnections,
      training_permission_latency: {
        count: this.permissionLatency.count,
        avgMs: this.permissionLatency.count ? Math.round((this.permissionLatency.totalMs / this.permissionLatency.count) * 1000) / 1000 : 0,
        maxMs: Math.round(this.permissionLatency.maxMs * 1000) / 1000,
        p95Ms: percentile(this.permissionLatency.samples, 95),
      },
      training_workspace_query_count: this.workspaceQueryCount,
      training_group_move_total: this.groupMoveTotal,
    }
  }

  resetWindow() {
    this.stageTransitionTotal = 0
    this.commandTotal = 0
    this.commandFailureTotal = 0
    this.workspaceQueryCount = 0
    this.groupMoveTotal = 0
    this.permissionLatency = { count: 0, totalMs: 0, maxMs: 0, samples: [] }
  }

  resetAll() {
    this.resetWindow()
    this.activeSessionIds.clear()
    this.sseConnections = 0
  }
}

export const trainingMetrics = new TrainingMetrics()
