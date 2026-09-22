import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import logger from '../src/lib/logger'
import { MetricsCollector } from '../src/lib/metrics'
import { resetRuntimeTelemetry } from '../src/lib/runtimeTelemetry'
import { trainingMetrics } from '../src/modules/training-engine/training-metrics'

const originalSnapshotPath = process.env.METRICS_SNAPSHOT_PATH
const temporaryDirectories: string[] = []

afterEach(() => {
  resetRuntimeTelemetry()
  trainingMetrics.resetAll()
  if (originalSnapshotPath === undefined) delete process.env.METRICS_SNAPSHOT_PATH
  else process.env.METRICS_SNAPSHOT_PATH = originalSnapshotPath
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('runtime metrics snapshots', () => {
  it('exposes the required Training Engine observability metrics', () => {
    trainingMetrics.observeSession('session-a', 'RUNNING')
    trainingMetrics.recordStageTransition()
    trainingMetrics.recordCommand(true)
    trainingMetrics.recordCommand(false)
    trainingMetrics.openSseConnection()
    trainingMetrics.recordPermissionLatency(12)
    trainingMetrics.recordPermissionLatency(28)
    trainingMetrics.recordWorkspaceQueries(4)
    trainingMetrics.recordGroupMove()

    const collector = new MetricsCollector()
    expect(collector.getSnapshot().training).toMatchObject({
      training_session_active_count: 1,
      training_stage_transition_total: 1,
      training_command_total: 2,
      training_command_failure_total: 1,
      training_sse_connections: 1,
      training_workspace_query_count: 4,
      training_group_move_total: 1,
      training_permission_latency: {
        count: 2,
        avgMs: 20,
        maxMs: 28,
      },
    })

    trainingMetrics.closeSseConnection()
    trainingMetrics.observeSession('session-a', 'ENDED')
    expect(collector.getSnapshot().training).toMatchObject({
      training_session_active_count: 0,
      training_sse_connections: 0,
    })
  })

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
    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.window.durationSeconds).toBeGreaterThanOrEqual(0)
    expect(snapshot.process.rssBytes).toBeGreaterThan(0)
    expect(snapshot.endpoints).toHaveLength(1)
    expect(snapshot.externalCalls[0]).toMatchObject({ count: 1, successCount: 1, errorCount: 0 })
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

    collector.logSummary()
    collector.recordEndpoint('GET', '/api/problems/999', 7, true, 200)
    collector.flushSnapshot()
    const nextWindow = JSON.parse(fs.readFileSync(target, 'utf8'))
    expect(nextWindow.endpoints).toEqual([
      expect.objectContaining({ endpoint: 'GET:/api/problems/:id', count: 1, status5xx: 0 }),
    ])
    expect(nextWindow.runtimeEvents.series).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'permission_denied' }),
    ]))

    collector.reset()
    for (let index = 0; index < 520; index += 1) {
      collector.recordEndpoint('GET', `/scanner/path-${index}`, 1, false, 404)
    }
    expect(collector.getSnapshot().endpoints).toHaveLength(512)
    expect(collector.getSnapshot().droppedEndpointSeries).toBe(8)
  })
})
