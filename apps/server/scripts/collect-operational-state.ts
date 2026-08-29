import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/prisma'

const staleMinutes = Number.parseInt(process.env.OPERATIONAL_STALE_MINUTES || '15', 10)
if (!Number.isInteger(staleMinutes) || staleMinutes < 1) {
  throw new Error('OPERATIONAL_STALE_MINUTES must be a positive integer')
}

const staleBefore = new Date(Date.now() - staleMinutes * 60_000)

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
    prisma.testdataObject.aggregate({ _count: { _all: true }, _sum: { size: true } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Problem" problem
      JOIN "ProblemTestSetRevision" revision ON revision.id = problem."latestTestSetRevisionId"
      WHERE problem."judgeConfig" IS DISTINCT FROM revision."judgeConfig"
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
  const revisionMismatch = Number(revisionInconsistency[0]?.count || 0)
  const violations = [
    ...Object.entries(stale).filter(([, count]) => count > 0).map(([name, count]) => `${name}:${count}`),
    ...(revisionMismatch > 0 ? [`revisionProjection:${revisionMismatch}`] : []),
  ]

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    staleThresholdMinutes: staleMinutes,
    status: violations.length > 0 ? 'degraded' : 'healthy',
    violations,
    queues: {
      judgeRuns: countMap(runStates, 'status'),
      judgeAttempts: countMap(attemptStates, 'state'),
      rejudgeBatches: countMap(batchStates, 'status'),
      hackAttempts: countMap(hackStates, 'status'),
      testcaseCandidates: countMap(candidateStates, 'status'),
      ojFetchJobs: countMap(ojFetchStates, 'status'),
    },
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
