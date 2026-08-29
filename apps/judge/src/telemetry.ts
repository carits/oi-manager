import fs from 'node:fs'
import path from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'

type TaskType = 'submission' | 'hack'

export class JudgeTelemetry {
  private readonly counters = new Map<string, number>()
  private readonly taskDurations: Record<TaskType, number[]> = { submission: [], hack: [] }
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })
  private interval: NodeJS.Timeout | null = null
  private startedAt = Date.now()
  private windowStartedAt = Date.now()
  private inFlight = 0
  private connected = false
  private authenticated = false
  private judgeId = process.env.JUDGE_ID || 'unknown'
  private lastMessageAt: string | null = null
  private lastTaskAt: string | null = null
  private compileCache: Record<string, number> = {}

  constructor() {
    this.eventLoopDelay.enable()
  }

  increment(name: string): void {
    this.counters.set(name, (this.counters.get(name) || 0) + 1)
  }

  setConnection(connected: boolean, authenticated = false): void {
    const changed = this.connected !== connected
    this.connected = connected
    this.authenticated = authenticated
    if (changed) this.increment(connected ? 'connection.opened' : 'connection.closed')
    this.flush()
  }

  setAuthenticated(authenticated: boolean): void {
    const changed = this.authenticated !== authenticated
    this.authenticated = authenticated
    if (changed) this.increment(authenticated ? 'auth.succeeded' : 'auth.failed')
  }

  setJudgeId(judgeId: string): void {
    this.judgeId = judgeId || 'unknown'
    this.flush()
  }

  noteMessage(): void {
    this.lastMessageAt = new Date().toISOString()
    this.increment('message.received')
  }

  startTask(type: TaskType): number {
    this.inFlight += 1
    this.lastTaskAt = new Date().toISOString()
    this.increment(`task.${type}.received`)
    return performance.now()
  }

  finishTask(type: TaskType, outcome: string, startedAt: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    this.increment(`task.${type}.${outcome.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`)
    const durations = this.taskDurations[type]
    durations.push(Math.max(0, Math.round(performance.now() - startedAt)))
    if (durations.length > 500) durations.shift()
    this.flush()
  }

  setCompileCache(stats: Record<string, number>): void {
    this.compileCache = { ...stats }
  }

  private percentile(values: number[], percentile: number): number | null {
    if (!values.length) return null
    const sorted = [...values].sort((left, right) => left - right)
    const index = Math.min(sorted.length - 1, Math.floor((percentile / 100) * sorted.length))
    return sorted[index]
  }

  snapshot() {
    const memory = process.memoryUsage()
    const eventLoopP99 = this.eventLoopDelay.percentile(99)
    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      window: {
        startedAt: new Date(this.windowStartedAt).toISOString(),
        durationSeconds: Math.max(0, Math.floor((Date.now() - this.windowStartedAt) / 1000)),
      },
      judgeId: this.judgeId,
      process: {
        pid: process.pid,
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        eventLoopDelayP99Ms: Number.isFinite(eventLoopP99) ? Math.round((eventLoopP99 / 1_000_000) * 1000) / 1000 : 0,
      },
      connection: {
        connected: this.connected,
        authenticated: this.authenticated,
        lastMessageAt: this.lastMessageAt,
      },
      tasks: {
        inFlight: this.inFlight,
        lastTaskAt: this.lastTaskAt,
        submissionDurationP50Ms: this.percentile(this.taskDurations.submission, 50),
        submissionDurationP95Ms: this.percentile(this.taskDurations.submission, 95),
        hackDurationP50Ms: this.percentile(this.taskDurations.hack, 50),
        hackDurationP95Ms: this.percentile(this.taskDurations.hack, 95),
      },
      compileCache: this.compileCache,
      counters: Object.fromEntries(Array.from(this.counters.entries()).sort(([left], [right]) => left.localeCompare(right))),
    }
  }

  private targetPath(): string {
    if (process.env.JUDGE_METRICS_SNAPSHOT_PATH) return path.resolve(process.env.JUDGE_METRICS_SNAPSHOT_PATH)
    const root = process.env.OI_MANAGER_ROOT || path.resolve(process.cwd(), '../..')
    return path.join(root, '.run', 'judge-metrics.json')
  }

  private writeSnapshot(snapshot: ReturnType<JudgeTelemetry['snapshot']>): string | null {
    const target = this.targetPath()
    const temporary = `${target}.next.${process.pid}`
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
      fs.renameSync(temporary, target)
      return target
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }) } catch { /* best effort */ }
      console.warn('[JudgeMetrics] snapshot failed:', error instanceof Error ? error.message : String(error))
      return null
    }
  }

  flush(): string | null {
    return this.writeSnapshot(this.snapshot())
  }

  private resetWindow(): void {
    this.counters.clear()
    this.taskDurations.submission.length = 0
    this.taskDurations.hack.length = 0
    this.windowStartedAt = Date.now()
    this.eventLoopDelay.reset()
  }

  start(intervalMs = 60_000): void {
    if (this.interval) return
    this.flush()
    this.interval = setInterval(() => {
      const snapshot = this.snapshot()
      this.writeSnapshot(snapshot)
      this.resetWindow()
      console.log(JSON.stringify({ type: 'judge_metrics_summary', ...snapshot }))
    }, intervalMs)
    this.interval.unref()
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    this.flush()
  }
}

export const judgeTelemetry = new JudgeTelemetry()
