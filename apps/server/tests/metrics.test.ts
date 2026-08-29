import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import logger from '../src/lib/logger'
import { MetricsCollector } from '../src/lib/metrics'
import { resetRuntimeTelemetry } from '../src/lib/runtimeTelemetry'

const originalSnapshotPath = process.env.METRICS_SNAPSHOT_PATH
const temporaryDirectories: string[] = []

afterEach(() => {
  resetRuntimeTelemetry()
  if (originalSnapshotPath === undefined) delete process.env.METRICS_SNAPSHOT_PATH
  else process.env.METRICS_SNAPSHOT_PATH = originalSnapshotPath
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('runtime metrics snapshots', () => {
  it('records normalized HTTP status families, process health and structured events', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-metrics-'))
    temporaryDirectories.push(directory)
    const target = path.join(directory, 'metrics.json')
    process.env.METRICS_SNAPSHOT_PATH = target

    const collector = new MetricsCollector()
    collector.recordEndpoint('GET', '/api/problems/123', 10, true, 200)
    collector.recordEndpoint('GET', '/api/problems/456', 30, false, 404)
    collector.recordEndpoint('GET', '/api/problems/789', 50, false, 503)
    collector.recordExternalCall('codeforces:fetch', 25, true)
    collector.recordCacheHit('translation')
    collector.updateCacheSize('translation', 3)
    logger.audit('problem_update', { userId: 'test-user' })
    logger.security('permission_denied', { userId: 'test-user' })

    expect(collector.flushSnapshot()).toBe(target)
    const snapshot = JSON.parse(fs.readFileSync(target, 'utf8'))
    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.process.rssBytes).toBeGreaterThan(0)
    expect(snapshot.endpoints).toHaveLength(1)
    expect(snapshot.endpoints[0]).toMatchObject({
      endpoint: 'GET:/api/problems/:id',
      count: 3,
      status2xx: 1,
      status4xx: 1,
      status5xx: 1,
      p95Ms: 50,
      p99Ms: 50,
    })
    expect(snapshot.runtimeEvents.series).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'audit', action: 'problem_update', count: 1 }),
      expect.objectContaining({ kind: 'security', action: 'permission_denied', count: 1 }),
    ]))
    expect(fs.statSync(target).mode & 0o077).toBe(0)
  })
})
