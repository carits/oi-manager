import dotenv from 'dotenv'
import path from 'node:path'
import { Client } from 'pg'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

function percentile(values: number[], quantile: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

const hours = Math.max(1, Number(process.env.JUDGE_SLO_WINDOW_HOURS || 24))
const minimumSamples = Math.max(1, Number(process.env.JUDGE_SLO_MIN_SAMPLES || 50))
const enforce = process.argv.includes('--enforce')
const targets = {
  queueLatencyMs: Number(process.env.JUDGE_SLO_QUEUE_P95_MS || 5_000),
  dispatchLatencyMs: Number(process.env.JUDGE_SLO_DISPATCH_P95_MS || 1_000),
  compileLatencyMs: Number(process.env.JUDGE_SLO_COMPILE_P95_MS || 3_000),
  runLatencyMs: Number(process.env.JUDGE_SLO_RUN_P95_MS || 10_000),
  persistLatencyMs: Number(process.env.JUDGE_SLO_PERSIST_P95_MS || 1_000),
  totalLatencyMs: Number(process.env.JUDGE_SLO_TOTAL_P95_MS || 20_000),
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
  const { rows } = await client.query<Record<string, number | string | null>>(`
    SELECT state,
      "queueLatencyMs", "dispatchLatencyMs", "compileLatencyMs",
      "runLatencyMs", "persistLatencyMs", "totalLatencyMs"
    FROM "JudgeAttempt"
    WHERE "finalizedAt" >= CURRENT_TIMESTAMP - ($1::text || ' hours')::interval
      AND state IN ('SUCCEEDED', 'USER_ERROR', 'INFRA_ERROR')
  `, [String(hours)])
  const stuck = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM "JudgeAttempt"
    WHERE state IN ('CLAIMED', 'COMPILING', 'RUNNING', 'FINALIZING')
      AND "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
  `)
  const phases = Object.fromEntries(Object.entries(targets).map(([name, target]) => {
    const values = rows.map(row => row[name]).filter((value): value is number => Number.isFinite(value)).map(Number)
    return [name, { samples: values.length, p50: percentile(values, 0.50), p95: percentile(values, 0.95), p99: percentile(values, 0.99), targetP95: target }]
  }))
  const infraErrors = rows.filter(row => row.state === 'INFRA_ERROR').length
  const infraErrorRate = rows.length ? infraErrors / rows.length : 0
  const violations: string[] = []
  for (const [name, metric] of Object.entries(phases)) {
    if (metric.samples < minimumSamples) {
      if (enforce) violations.push(`${name}: only ${metric.samples}/${minimumSamples} samples`)
    } else if ((metric.p95 ?? 0) > metric.targetP95) violations.push(`${name}: p95 ${metric.p95}ms > ${metric.targetP95}ms`)
  }
  if (rows.length >= minimumSamples && infraErrorRate >= 0.001) violations.push(`infra error rate ${(infraErrorRate * 100).toFixed(3)}% >= 0.1%`)
  if (stuck.rows[0].count > 0) violations.push(`stuck attempts: ${stuck.rows[0].count}`)
  console.log(JSON.stringify({
    windowHours: hours,
    minimumSamples,
    finalizedAttempts: rows.length,
    infraErrors,
    infraErrorRate,
    stuckAttempts: stuck.rows[0].count,
    phases,
    status: violations.length ? 'violated' : rows.length < minimumSamples ? 'collecting' : 'met',
    violations,
  }, null, 2))
  if (violations.length) process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
