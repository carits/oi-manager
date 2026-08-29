import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JudgeTelemetry } from './telemetry'

const originalPath = process.env.JUDGE_METRICS_SNAPSHOT_PATH
const temporaryDirectories: string[] = []

afterEach(() => {
  if (originalPath === undefined) delete process.env.JUDGE_METRICS_SNAPSHOT_PATH
  else process.env.JUDGE_METRICS_SNAPSHOT_PATH = originalPath
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Judge telemetry', () => {
  it('persists connection, task, cache and process evidence atomically', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-judge-metrics-'))
    temporaryDirectories.push(directory)
    const target = path.join(directory, 'judge-metrics.json')
    process.env.JUDGE_METRICS_SNAPSHOT_PATH = target

    const telemetry = new JudgeTelemetry()
    telemetry.increment('connection.attempted')
    telemetry.setConnection(true)
    telemetry.setAuthenticated(true)
    telemetry.noteMessage()
    const startedAt = telemetry.startTask('submission')
    telemetry.finishTask('submission', 'Accepted', startedAt)
    telemetry.setCompileCache({ entries: 2, activeReferences: 0 })

    expect(telemetry.flush()).toBe(target)
    const snapshot = JSON.parse(fs.readFileSync(target, 'utf8'))
    expect(snapshot.connection).toMatchObject({ connected: true, authenticated: true })
    expect(snapshot.tasks.inFlight).toBe(0)
    expect(snapshot.compileCache).toEqual({ entries: 2, activeReferences: 0 })
    expect(snapshot.counters).toMatchObject({
      'connection.attempted': 1,
      'connection.opened': 1,
      'auth.succeeded': 1,
      'message.received': 1,
      'task.submission.received': 1,
      'task.submission.accepted': 1,
    })
    expect(fs.statSync(target).mode & 0o077).toBe(0)
  })
})
