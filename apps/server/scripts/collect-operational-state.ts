import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/prisma'

const staleMinutes = Number.parseInt(process.env.OPERATIONAL_STALE_MINUTES || '15', 10)
if (!Number.isInteger(staleMinutes) || staleMinutes < 1) {
  throw new Error('OPERATIONAL_STALE_MINUTES must be a positive integer')
}

const staleBefore = new Date(Date.now() - staleMinutes * 60_000)

function positiveThreshold(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10)
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

const thresholds = {
  queuedRuns: positiveThreshold('OPERATIONAL_MAX_QUEUED_RUNS', 500),
  activeAttempts: positiveThreshold('OPERATIONAL_MAX_ACTIVE_ATTEMPTS', 500),
  pendingHacks: positiveThreshold('OPERATIONAL_MAX_PENDING_HACKS', 50),
  pendingOjFetch: positiveThreshold('OPERATIONAL_MAX_PENDING_OJ_FETCH', 100),
  recentInfraErrors: positiveThreshold('OPERATIONAL_MAX_RECENT_INFRA_ERRORS', 5),
  recentWorkflowFailures: positiveThreshold('OPERATIONAL_MAX_RECENT_WORKFLOW_FAILURES', 10),
}

function countMap(rows: Array<{ _count: { _all: number } } & Record<string, unknown>>, field: string) {
  return Object.fromEntries(rows.map(row => [String(row[field]), row._count._all]))
}

async function collect() {
  const [
    runStates,
    attemptStates,
    batchStates,
    hackStates,
    candidateStates,
    ojFetchStates,
    staleRuns,
    staleAttempts,
    staleBatches,
    staleHacks,
    staleCandidates,
    staleOjFetchJobs,
    recentInfraErrors,
    recentFailedBatches,
    recentFailedHacks,
    recentFailedCandidates,
    recentFailedOjFetchJobs,
    databaseHealthRows,
    storage,
    revisionInconsistency,
  ] = await Promise.all([
    prisma.judgeRun.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.judgeAttempt.groupBy({ by: ['state'], _count: { _all: true } }),
    prisma.rejudgeBatch.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.problemHackAttempt.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.testcaseCandidate.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ojFetchJob.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.judgeRun.count({ where: { status: { in: ['QUEUED', 'RUNNING'] }, updatedAt: { lt: staleBefore } } }),
    prisma.judgeAttempt.count({
      where: {
        state: { in: ['QUEUED', 'CLAIMED', 'COMPILING', 'RUNNING', 'FINALIZING'] },
        updatedAt: { lt: staleBefore },
      },
    }),
    prisma.rejudgeBatch.count({
      where: { status: { in: ['CREATED', 'QUEUING'] }, createdAt: { lt: staleBefore } },
    }),
    prisma.problemHackAttempt.count({ where: { finishedAt: null, updatedAt: { lt: staleBefore } } }),
    prisma.testcaseCandidate.count({
      where: { status: { in: ['VALIDATED', 'PROMOTING'] }, updatedAt: { lt: staleBefore } },
    }),
    prisma.ojFetchJob.count({
      where: { status: { in: ['pending', 'processing'] }, updatedAt: { lt: staleBefore } },
    }),
    prisma.judgeAttempt.count({ where: { state: 'INFRA_ERROR', updatedAt: { gte: staleBefore } } }),
    prisma.rejudgeBatch.count({ where: { status: 'FAILED', completedAt: { gte: staleBefore } } }),
    prisma.problemHackAttempt.count({
      where: { status: { in: ['system_error', 'error', 'failed'] }, updatedAt: { gte: staleBefore } },
    }),
    prisma.testcaseCandidate.count({ where: { status: 'FAILED', updatedAt: { gte: staleBefore } } }),
    prisma.ojFetchJob.count({
      where: { status: { in: ['failed', 'error'] }, updatedAt: { gte: staleBefore } },
    }),
    prisma.$queryRaw<Array<{
      connections: bigint
      max_connections: number
      long_transactions: bigint
      idle_transactions: bigint
      lock_waits: bigint
      database_bytes: bigint
    }>>`
      SELECT
        COUNT(*) FILTER (WHERE pid <> pg_backend_pid())::bigint AS connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
        COUNT(*) FILTER (
          WHERE pid <> pg_backend_pid()
            AND xact_start IS NOT NULL
            AND xact_start < now() - interval '5 minutes'
        )::bigint AS long_transactions,
        COUNT(*) FILTER (
          WHERE pid <> pg_backend_pid()
            AND state = 'idle in transaction'
            AND state_change < now() - interval '5 minutes'
        )::bigint AS idle_transactions,
        COUNT(*) FILTER (
          WHERE pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query_start < now() - interval '60 seconds'
        )::bigint AS lock_waits,
        pg_database_size(current_database())::bigint AS database_bytes
      FROM pg_stat_activity
      WHERE datname = current_database()
    `,
    prisma.testdataObject.aggregate({ _count: { _all: true }, _sum: { size: true } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Problem" problem
      JOIN "ProblemTestSetSlot" slot ON slot."problemId" = problem.id AND slot.slot = 'STABLE'
      WHERE problem."judgeConfig" IS DISTINCT FROM slot."judgeConfig"
    `,
  ])

  const stale = {
    judgeRuns: staleRuns,
    judgeAttempts: staleAttempts,
    rejudgeBatches: staleBatches,
    hackAttempts: staleHacks,
    testcaseCandidates: staleCandidates,
    ojFetchJobs: staleOjFetchJobs,
  }
  const queues = {
    judgeRuns: countMap(runStates, 'status'),
    judgeAttempts: countMap(attemptStates, 'state'),
    rejudgeBatches: countMap(batchStates, 'status'),
    hackAttempts: countMap(hackStates, 'status'),
    testcaseCandidates: countMap(candidateStates, 'status'),
    ojFetchJobs: countMap(ojFetchStates, 'status'),
  }
  const backlog = {
    queuedRuns: Number(queues.judgeRuns.QUEUED || 0),
    activeAttempts: ['QUEUED', 'CLAIMED', 'COMPILING', 'RUNNING', 'FINALIZING']
      .reduce((sum, state) => sum + Number(queues.judgeAttempts[state] || 0), 0),
    pendingHacks: ['queuing', 'judging', 'validating', 'promoting']
      .reduce((sum, state) => sum + Number(queues.hackAttempts[state] || 0), 0),
    pendingOjFetch: ['pending', 'processing']
      .reduce((sum, state) => sum + Number(queues.ojFetchJobs[state] || 0), 0),
  }
  const recentFailures = {
    judgeInfrastructure: recentInfraErrors,
    rejudgeBatches: recentFailedBatches,
    hackAttempts: recentFailedHacks,
    testcaseCandidates: recentFailedCandidates,
    ojFetchJobs: recentFailedOjFetchJobs,
  }
  const workflowFailureCount = recentFailedBatches + recentFailedHacks + recentFailedCandidates + recentFailedOjFetchJobs
  const databaseRow = databaseHealthRows[0]
  const database = {
    connections: Number(databaseRow?.connections || 0),
    maxConnections: Number(databaseRow?.max_connections || 0),
    connectionUtilizationPercent: databaseRow?.max_connections
      ? Math.round((Number(databaseRow.connections) / Number(databaseRow.max_connections)) * 1000) / 10
      : 0,
    longTransactions: Number(databaseRow?.long_transactions || 0),
    idleTransactions: Number(databaseRow?.idle_transactions || 0),
    lockWaits: Number(databaseRow?.lock_waits || 0),
    databaseBytes: Number(databaseRow?.database_bytes || 0),
  }
  const revisionMismatch = Number(revisionInconsistency[0]?.count || 0)
  const violations = [
    ...Object.entries(stale).filter(([, count]) => count > 0).map(([name, count]) => `${name}:${count}`),
    ...(revisionMismatch > 0 ? [`revisionProjection:${revisionMismatch}`] : []),
    ...(backlog.queuedRuns > thresholds.queuedRuns ? [`queuedRuns:${backlog.queuedRuns}`] : []),
    ...(backlog.activeAttempts > thresholds.activeAttempts ? [`activeAttempts:${backlog.activeAttempts}`] : []),
    ...(backlog.pendingHacks > thresholds.pendingHacks ? [`pendingHacks:${backlog.pendingHacks}`] : []),
    ...(backlog.pendingOjFetch > thresholds.pendingOjFetch ? [`pendingOjFetch:${backlog.pendingOjFetch}`] : []),
    ...(recentInfraErrors > thresholds.recentInfraErrors ? [`recentInfraErrors:${recentInfraErrors}`] : []),
    ...(workflowFailureCount > thresholds.recentWorkflowFailures ? [`recentWorkflowFailures:${workflowFailureCount}`] : []),
    ...(database.connectionUtilizationPercent >= 80 ? [`databaseConnections:${database.connectionUtilizationPercent}%`] : []),
    ...(database.longTransactions > 0 ? [`databaseLongTransactions:${database.longTransactions}`] : []),
    ...(database.idleTransactions > 0 ? [`databaseIdleTransactions:${database.idleTransactions}`] : []),
    ...(database.lockWaits > 0 ? [`databaseLockWaits:${database.lockWaits}`] : []),
  ]

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    staleThresholdMinutes: staleMinutes,
    status: violations.length > 0 ? 'degraded' : 'healthy',
    violations,
    thresholds,
    queues,
    backlog,
    recentFailures,
    database,
    stale,
    revisions: { projectionMismatch: revisionMismatch },
    storage: {
      immutableObjectCount: storage._count._all,
      immutableObjectBytes: storage._sum.size || 0,
    },
  }
}

function writeSnapshot(snapshot: Awaited<ReturnType<typeof collect>>) {
  const root = process.env.OI_MANAGER_ROOT || path.resolve(process.cwd(), '../..')
  const target = path.resolve(process.env.OPERATIONAL_STATE_PATH || path.join(root, '.run', 'operational-state.json'))
  const temporary = `${target}.next.${process.pid}`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, target)
  return target
}

async function main() {
  try {
    const snapshot = await collect()
    const target = writeSnapshot(snapshot)
    console.log(JSON.stringify({ ...snapshot, snapshotPath: target }, null, 2))
    if (process.argv.includes('--enforce') && snapshot.status !== 'healthy') process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
