#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function threshold(name, fallback) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`)
  return value
}

function ageSeconds(timestamp) {
  return (Date.now() - Date.parse(timestamp)) / 1000
}

function validateCommon(snapshot, options) {
  const violations = []
  const age = ageSeconds(snapshot.generatedAt)
  const rssMb = Number(snapshot.process?.rssBytes || 0) / 1024 / 1024
  const eventLoopP99 = Number(snapshot.process?.eventLoopDelayP99Ms || 0)
  if (Number(snapshot.schemaVersion || 0) < 2) violations.push(`schemaVersion=${snapshot.schemaVersion ?? 'missing'}`)
  if (!snapshot.window || !Number.isFinite(Number(snapshot.window.durationSeconds))) violations.push('window=missing')
  if (!Number.isFinite(age) || age < 0 || age > options.maxAge) violations.push(`age=${age.toFixed(1)}s`)
  if (!Number.isFinite(rssMb) || rssMb > options.maxRssMb) violations.push(`rss=${rssMb.toFixed(1)}MiB`)
  if (!Number.isFinite(eventLoopP99) || eventLoopP99 > options.maxEventLoopP99Ms) {
    violations.push(`eventLoopP99=${eventLoopP99.toFixed(3)}ms`)
  }
  return { violations, age, rssMb, eventLoopP99 }
}

export function validateApiSnapshot(snapshot) {
  const common = validateCommon(snapshot, {
    maxAge: threshold('MONITOR_METRICS_MAX_AGE_SECONDS', 600),
    maxRssMb: threshold('MONITOR_API_RSS_MAX_MB', 1024),
    maxEventLoopP99Ms: threshold('MONITOR_EVENT_LOOP_P99_MAX_MS', 250),
  })
  const minRequests = threshold('MONITOR_API_ENDPOINT_MIN_REQUESTS', 20)
  const max5xx = threshold('MONITOR_API_ENDPOINT_5XX_MAX_PERCENT', 5)
  const maxP99 = threshold('MONITOR_API_ENDPOINT_P99_MAX_MS', 5000)
  const maxErrors = threshold('MONITOR_API_ERROR_EVENTS_MAX', 10)
  const maxSecurity = threshold('MONITOR_SECURITY_EVENTS_MAX', 50)
  const maxClientErrors = threshold('MONITOR_CLIENT_ERRORS_MAX', 20)
  const externalMinCalls = threshold('MONITOR_EXTERNAL_MIN_CALLS', 5)
  const externalMaxErrorPercent = threshold('MONITOR_EXTERNAL_ERROR_MAX_PERCENT', 50)
  const requiredNodeEnv = process.env.MONITOR_REQUIRED_NODE_ENV || 'production'

  if (snapshot.instance?.nodeEnv !== requiredNodeEnv) {
    common.violations.push(`nodeEnv=${snapshot.instance?.nodeEnv || 'missing'}`)
  }

  if (Number(snapshot.runtimeEvents?.droppedSeries || 0) > 0) {
    common.violations.push(`droppedSeries=${snapshot.runtimeEvents.droppedSeries}`)
  }
  if (Number(snapshot.droppedEndpointSeries || 0) > 0) {
    common.violations.push(`droppedEndpointSeries=${snapshot.droppedEndpointSeries}`)
  }
  for (const endpoint of snapshot.endpoints || []) {
    if (Number(endpoint.count) < minRequests) continue
    const rate5xx = Number(endpoint.status5xx || 0) * 100 / Number(endpoint.count)
    if (rate5xx > max5xx) common.violations.push(`${endpoint.endpoint}:5xx=${rate5xx.toFixed(1)}%`)
    if (Number(endpoint.p99Ms || 0) > maxP99) common.violations.push(`${endpoint.endpoint}:p99=${endpoint.p99Ms}ms`)
  }
  for (const external of snapshot.externalCalls || []) {
    if (Number(external.count) < externalMinCalls) continue
    const errorPercent = Number(external.errorCount || 0) * 100 / Number(external.count)
    if (errorPercent > externalMaxErrorPercent) {
      common.violations.push(`${external.name}:externalErrors=${errorPercent.toFixed(1)}%`)
    }
  }
  const series = Array.isArray(snapshot.runtimeEvents?.series) ? snapshot.runtimeEvents.series : []
  const errorEvents = series.filter(item => item.kind === 'error').reduce((sum, item) => sum + Number(item.count || 0), 0)
  const securityEvents = series.filter(item => item.kind === 'security').reduce((sum, item) => sum + Number(item.count || 0), 0)
  const clientErrors = series.filter(item => item.action === 'client_telemetry').reduce((sum, item) => sum + Number(item.count || 0), 0)
  if (errorEvents > maxErrors) common.violations.push(`errorEvents=${errorEvents}`)
  if (securityEvents > maxSecurity) common.violations.push(`securityEvents=${securityEvents}`)
  if (clientErrors > maxClientErrors) common.violations.push(`clientErrors=${clientErrors}`)

  return {
    violations: common.violations,
    summary: `age=${common.age.toFixed(1)}s rss=${common.rssMb.toFixed(1)}MiB eventLoopP99=${common.eventLoopP99.toFixed(3)}ms errors=${errorEvents} security=${securityEvents} clientErrors=${clientErrors}`,
  }
}

export function validateJudgeSnapshot(snapshot) {
  const common = validateCommon(snapshot, {
    maxAge: threshold('MONITOR_JUDGE_METRICS_MAX_AGE_SECONDS', 180),
    maxRssMb: threshold('MONITOR_JUDGE_RSS_MAX_MB', 2048),
    maxEventLoopP99Ms: threshold('MONITOR_EVENT_LOOP_P99_MAX_MS', 250),
  })
  const messageAge = snapshot.connection?.lastMessageAt
    ? ageSeconds(snapshot.connection.lastMessageAt)
    : Number.POSITIVE_INFINITY
  if (!snapshot.connection?.connected) common.violations.push('disconnected')
  if (!snapshot.connection?.authenticated) common.violations.push('unauthenticated')
  if (!snapshot.judgeId || snapshot.judgeId === 'unknown') common.violations.push('judgeId=unknown')
  if (!Number.isFinite(messageAge) || messageAge > threshold('MONITOR_JUDGE_METRICS_MAX_AGE_SECONDS', 180)) {
    common.violations.push(`lastMessageAge=${messageAge.toFixed(1)}s`)
  }
  const counters = snapshot.counters || {}
  const infraRetries = Object.entries(counters)
    .filter(([key]) => key.includes('infrastructure_retry'))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0)
  const systemErrors = Object.entries(counters)
    .filter(([key]) => key.includes('system_error'))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0)
  const connectionErrors = Number(counters['connection.error'] || 0)
  if (infraRetries > threshold('MONITOR_JUDGE_INFRA_RETRY_MAX', 5)) common.violations.push(`infraRetries=${infraRetries}`)
  if (systemErrors > threshold('MONITOR_JUDGE_SYSTEM_ERROR_MAX', 5)) common.violations.push(`systemErrors=${systemErrors}`)
  if (connectionErrors > threshold('MONITOR_JUDGE_CONNECTION_ERROR_MAX', 3)) common.violations.push(`connectionErrors=${connectionErrors}`)

  return {
    violations: common.violations,
    summary: `age=${common.age.toFixed(1)}s messageAge=${messageAge.toFixed(1)}s rss=${common.rssMb.toFixed(1)}MiB infraRetries=${infraRetries} systemErrors=${systemErrors}`,
  }
}

function main() {
  const [mode, file] = process.argv.slice(2)
  if (!['api', 'judge'].includes(mode) || !file) throw new Error('usage: validate-runtime-snapshot.mjs <api|judge> <snapshot.json>')
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'))
  const result = mode === 'api' ? validateApiSnapshot(snapshot) : validateJudgeSnapshot(snapshot)
  if (result.violations.length) {
    console.error(result.violations.join(', '))
    process.exitCode = 1
    return
  }
  console.log(result.summary)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
