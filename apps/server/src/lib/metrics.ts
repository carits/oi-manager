/**
 * 内存指标收集器
 *
 * 用于收集 API 端点延迟、成功率等指标，定期输出汇总日志。
 * P0 可观测性增强：基础指标收集。
 */

import fs from 'node:fs'
import path from 'node:path'
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'
import logger from './logger'
import { getRuntimeEventSummary } from './runtimeTelemetry'

interface EndpointMetric {
  count: number
  successCount: number
  errorCount: number
  status2xx: number
  status3xx: number
  status4xx: number
  status5xx: number
  totalMs: number
  maxMs: number
  minMs: number
  latencies: number[] // 最近 100 条用于计算 P90
}

interface CacheMetric {
  hitCount: number
  missCount: number
  size: number
}

interface ExternalCallMetric {
  count: number
  successCount: number
  errorCount: number
  totalMs: number
  maxMs: number
}

interface EndpointSummary {
  endpoint: string
  count: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  successRate: string
  errorRate: string
  status2xx: number
  status3xx: number
  status4xx: number
  status5xx: number
}

interface ExternalCallSummary {
  name: string
  count: number
  avgMs: number
  maxMs: number
  successRate: string
}

const MAX_LATENCIES = 100 // 用于计算百分位的样本数

/**
 * 计算百分位数
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.floor((p / 100) * sorted.length)
  return sorted[Math.min(index, sorted.length - 1)]
}

/**
 * 标准化路径（去除动态参数）
 * 例如：GET:/api/teams/cmx123 -> GET:/api/teams/:id
 */
function normalizePath(method: string, path: string): string {
  // 匹配 cuid 格式的 ID（25 字符，以 c 开头）
  let normalized = path.replace(/\/c[a-z0-9]{24}/gi, '/:id')
  // 匹配 UUID 格式的 ID
  normalized = normalized.replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/:id')
  // 匹配纯数字 ID
  normalized = normalized.replace(/\/\d+/g, '/:id')
  // 匹配项目中带稳定资源前缀的历史字符串 ID。不要按长度替换
  // 任意路由段，否则 platform-bindings、submission-users 等静态名称
  // 会被错误聚合为 :id，令端点指标失去意义。
  normalized = normalized.replace(/\/(?:org|team|user|problem|school|membership|file)_[a-zA-Z0-9_-]+/gi, '/:id')

  return `${method}:${normalized}`
}

export interface MetricsSnapshot {
  schemaVersion: 1
  generatedAt: string
  instance: { pid: number; port: string; appEnv: string; nodeEnv: string }
  process: {
    uptimeSeconds: number
    rssBytes: number
    heapUsedBytes: number
    heapTotalBytes: number
    externalBytes: number
    eventLoopDelayP50Ms: number
    eventLoopDelayP95Ms: number
    eventLoopDelayP99Ms: number
  }
  endpoints: EndpointSummary[]
  externalCalls: ExternalCallSummary[]
  caches: Array<{ name: string; hitCount: number; missCount: number; hitRate: string; size: number }>
  runtimeEvents: ReturnType<typeof getRuntimeEventSummary>
}

export class MetricsCollector {
  private endpoints = new Map<string, EndpointMetric>()
  private externalCalls = new Map<string, ExternalCallMetric>()
  private cacheMetrics = new Map<string, CacheMetric>()
  private startTime = Date.now()
  private interval: NodeJS.Timeout | null = null
  private readonly eventLoopDelay: IntervalHistogram

  constructor() {
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })
    this.eventLoopDelay.enable()
  }

  /**
   * 记录 API 端点请求
   */
  recordEndpoint(method: string, path: string, durationMs: number, success: boolean, statusCode = success ? 200 : 500): void {
    const endpoint = normalizePath(method, path)
    const existing = this.endpoints.get(endpoint) || {
      count: 0,
      successCount: 0,
      errorCount: 0,
      status2xx: 0,
      status3xx: 0,
      status4xx: 0,
      status5xx: 0,
      totalMs: 0,
      maxMs: 0,
      minMs: Infinity,
      latencies: []
    }

    existing.count++
    existing.totalMs += durationMs
    existing.maxMs = Math.max(existing.maxMs, durationMs)
    existing.minMs = Math.min(existing.minMs, durationMs)

    if (success) {
      existing.successCount++
    } else {
      existing.errorCount++
    }

    if (statusCode >= 500) existing.status5xx++
    else if (statusCode >= 400) existing.status4xx++
    else if (statusCode >= 300) existing.status3xx++
    else if (statusCode >= 200) existing.status2xx++

    // 保留最近 100 条延迟用于计算百分位
    existing.latencies.push(durationMs)
    if (existing.latencies.length > MAX_LATENCIES) {
      existing.latencies.shift()
    }

    this.endpoints.set(endpoint, existing)
  }

  /**
   * 记录外部服务调用（OJ 平台、AI 翻译等）
   */
  recordExternalCall(name: string, durationMs: number, success: boolean): void {
    const existing = this.externalCalls.get(name) || {
      count: 0,
      successCount: 0,
      errorCount: 0,
      totalMs: 0,
      maxMs: 0
    }

    existing.count++
    existing.totalMs += durationMs
    existing.maxMs = Math.max(existing.maxMs, durationMs)

    if (success) {
      existing.successCount++
    } else {
      existing.errorCount++
    }

    this.externalCalls.set(name, existing)
  }

  /**
   * 记录缓存命中/未命中
   */
  recordCacheHit(cacheName: string): void {
    const existing = this.cacheMetrics.get(cacheName) || {
      hitCount: 0,
      missCount: 0,
      size: 0
    }
    existing.hitCount++
    this.cacheMetrics.set(cacheName, existing)
  }

  recordCacheMiss(cacheName: string): void {
    const existing = this.cacheMetrics.get(cacheName) || {
      hitCount: 0,
      missCount: 0,
      size: 0
    }
    existing.missCount++
    this.cacheMetrics.set(cacheName, existing)
  }

  updateCacheSize(cacheName: string, size: number): void {
    const existing = this.cacheMetrics.get(cacheName) || {
      hitCount: 0,
      missCount: 0,
      size: 0
    }
    existing.size = size
    this.cacheMetrics.set(cacheName, existing)
  }

  /**
   * 获取端点汇总
   */
  getEndpointSummary(): EndpointSummary[] {
    return Array.from(this.endpoints.entries())
      .map(([endpoint, m]) => ({
        endpoint,
        count: m.count,
        avgMs: Math.round(m.totalMs / m.count),
        minMs: m.minMs === Infinity ? 0 : m.minMs,
        maxMs: m.maxMs,
        p50Ms: percentile(m.latencies, 50),
        p90Ms: percentile(m.latencies, 90),
        p95Ms: percentile(m.latencies, 95),
        p99Ms: percentile(m.latencies, 99),
        successRate: `${((m.successCount / m.count) * 100).toFixed(1)}%`,
        errorRate: `${((m.errorCount / m.count) * 100).toFixed(1)}%`,
        status2xx: m.status2xx,
        status3xx: m.status3xx,
        status4xx: m.status4xx,
        status5xx: m.status5xx,
      }))
      .sort((a, b) => b.count - a.count)
  }

  /**
   * 获取外部调用汇总
   */
  getExternalCallSummary(): ExternalCallSummary[] {
    return Array.from(this.externalCalls.entries())
      .map(([name, m]) => ({
        name,
        count: m.count,
        avgMs: Math.round(m.totalMs / m.count),
        maxMs: m.maxMs,
        successRate: `${((m.successCount / m.count) * 100).toFixed(1)}%`
      }))
      .sort((a, b) => b.count - a.count)
  }

  /**
   * 获取缓存汇总
   */
  getCacheSummary(): Array<{ name: string; hitCount: number; missCount: number; hitRate: string; size: number }> {
    return Array.from(this.cacheMetrics.entries())
      .map(([name, m]) => ({
        name,
        hitCount: m.hitCount,
        missCount: m.missCount,
        hitRate: m.hitCount + m.missCount > 0
          ? `${((m.hitCount / (m.hitCount + m.missCount)) * 100).toFixed(1)}%`
          : '0%',
        size: m.size
      }))
  }

  getSnapshot(): MetricsSnapshot {
    const memory = process.memoryUsage()
    const toMilliseconds = (nanoseconds: number) => Number.isFinite(nanoseconds)
      ? Math.round((nanoseconds / 1_000_000) * 1000) / 1000
      : 0

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      instance: {
        pid: process.pid,
        port: process.env.PORT || '3002',
        appEnv: process.env.APP_ENV || 'unknown',
        nodeEnv: process.env.NODE_ENV || 'unknown',
      },
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        eventLoopDelayP50Ms: toMilliseconds(this.eventLoopDelay.percentile(50)),
        eventLoopDelayP95Ms: toMilliseconds(this.eventLoopDelay.percentile(95)),
        eventLoopDelayP99Ms: toMilliseconds(this.eventLoopDelay.percentile(99)),
      },
      endpoints: this.getEndpointSummary(),
      externalCalls: this.getExternalCallSummary(),
      caches: this.getCacheSummary(),
      runtimeEvents: getRuntimeEventSummary(),
    }
  }

  private snapshotPath(): string {
    if (process.env.METRICS_SNAPSHOT_PATH) return path.resolve(process.env.METRICS_SNAPSHOT_PATH)
    const root = process.env.OI_MANAGER_ROOT || path.resolve(process.cwd(), '../..')
    return path.join(root, '.run', `metrics-${process.env.PORT || '3002'}.json`)
  }

  flushSnapshot(): string | null {
    const target = this.snapshotPath()
    const temporary = `${target}.next.${process.pid}`
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(temporary, `${JSON.stringify(this.getSnapshot(), null, 2)}\n`, { mode: 0o600 })
      fs.renameSync(temporary, target)
      return target
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }) } catch { /* best effort */ }
      logger.warn('metrics_snapshot_failed', {
        action: 'metrics',
        metadata: { target, error: error instanceof Error ? error.message : String(error) },
      })
      return null
    }
  }

  /**
   * 输出汇总日志
   */
  logSummary(): void {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000)

    const endpointSummary = this.getEndpointSummary()
    const externalSummary = this.getExternalCallSummary()
    const cacheSummary = this.getCacheSummary()
    const snapshotPath = this.flushSnapshot()

    // 只输出有数据的指标
    const hasData = endpointSummary.length > 0 || externalSummary.length > 0 || cacheSummary.length > 0

    if (hasData) {
      logger.info('metrics_summary', {
        action: 'metrics',
        metadata: {
          uptimeSeconds,
          endpoints: endpointSummary.slice(0, 20), // 限制输出前 20 个高频端点
          externalCalls: externalSummary,
          caches: cacheSummary,
          totalEndpoints: endpointSummary.length,
          totalExternalCalls: externalSummary.length,
          runtimeEvents: getRuntimeEventSummary(),
          process: this.getSnapshot().process,
          snapshotPath,
        }
      })
    }
  }

  /**
   * 启动定期输出
   */
  startPeriodicLog(intervalMs = 300000): void {
    if (this.interval) return
    this.flushSnapshot()
    // 每 5 分钟输出一次汇总
    this.interval = setInterval(() => this.logSummary(), intervalMs)
    this.interval.unref()
    logger.info('metrics_started', {
      action: 'metrics',
      metadata: { intervalMs, message: 'Metrics collector started, will output summary every 5 minutes' }
    })
  }

  stopPeriodicLog(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    this.flushSnapshot()
  }

  /**
   * 清空指标（用于测试）
   */
  reset(): void {
    this.endpoints.clear()
    this.externalCalls.clear()
    this.cacheMetrics.clear()
    this.startTime = Date.now()
  }
}

// 导出单例
export const metrics = new MetricsCollector()
export default metrics
