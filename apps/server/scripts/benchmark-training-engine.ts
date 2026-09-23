import { performance } from 'node:perf_hooks'
import { resolveEffectiveTrainingRule, evaluateProblemTimePolicy, resolveNextScoreTarget } from '../src/modules/training-engine/domain/training-rule-engine'
import { getCoachDashboard, getTrainingWorkspace } from '../src/modules/training-engine/training-engine.service'
import { prisma } from '../src/prisma'

const STUDENTS = 50
const PROBLEMS = 100
const ITERATIONS = Math.max(1, Number(process.env.TRAINING_BENCHMARK_ITERATIONS || 20))
const MAX_SYNTHETIC_MS = Math.max(1, Number(process.env.TRAINING_BENCHMARK_MAX_SYNTHETIC_MS || 250))
const MAX_REAL_P95_MS = Math.max(1, Number(process.env.TRAINING_BENCHMARK_MAX_REAL_P95_MS || 1500))

function percentile(values: number[], p: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function syntheticBenchmark() {
  const plans = Array.from({ length: PROBLEMS }, (_, index) => ({
    targetScore: index % 3 === 0 ? 60 : null,
    scoreGoals: index % 5 === 0 ? [{ score: 30 }, { score: 60 }, { score: 100 }] : [],
    timePolicy: index % 4 === 0 ? { mode: 'RECOMMEND_SWITCH', action: 'RECOMMEND_SWITCH', limitSeconds: 900 } : { mode: 'NONE' },
    stuckPolicy: { minActiveSeconds: 1200, minAttempts: 3, noImprovementSeconds: 600 },
    hintPolicy: { enabled: true },
    rules: {},
  }))
  const stage = {
    kind: 'TRAINING',
    accessPolicy: 'SEQUENTIAL',
    submissionMode: 'ENABLED',
    endPolicy: 'COMPLETION',
    defaultTargetScore: 100,
    rules: { accessScope: 'CURRENT_STAGE' },
  }
  const group = {
    accessPolicy: 'SEQUENTIAL',
    submissionMode: 'ENABLED',
    rules: { stuckPolicy: { minActiveSeconds: 900, minAttempts: 2, noImprovementSeconds: 480 } },
  }

  let checksum = 0
  const startedAt = performance.now()
  for (let student = 0; student < STUDENTS; student++) {
    for (let problem = 0; problem < PROBLEMS; problem++) {
      const bestScore = (student * 7 + problem * 13) % 101
      const activeSeconds = (student * 31 + problem * 17) % 1800
      const rule = resolveEffectiveTrainingRule({ stage, group, plan: plans[problem] })
      const time = evaluateProblemTimePolicy(rule.timePolicy, activeSeconds, bestScore >= rule.scorePolicy.completionScore)
      checksum += (resolveNextScoreTarget(rule.scorePolicy, bestScore) || 0)
      checksum += time.reached ? 1 : 0
      checksum += rule.stuckPolicy.minAttempts
    }
  }
  const durationMs = performance.now() - startedAt
  return {
    students: STUDENTS,
    problems: PROBLEMS,
    evaluations: STUDENTS * PROBLEMS,
    durationMs: Math.round(durationMs * 1000) / 1000,
    perEvaluationUs: Math.round((durationMs * 1000 / (STUDENTS * PROBLEMS)) * 1000) / 1000,
    checksum,
    thresholdMs: MAX_SYNTHETIC_MS,
    pass: durationMs <= MAX_SYNTHETIC_MS,
  }
}

async function realSessionBenchmark() {
  const sessionId = process.env.TRAINING_BENCHMARK_SESSION_ID
  const userId = process.env.TRAINING_BENCHMARK_USER_ID
  if (!sessionId || !userId) return { skipped: true, reason: 'set TRAINING_BENCHMARK_SESSION_ID and TRAINING_BENCHMARK_USER_ID to run database-backed benchmark' }

  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      _count: { select: { Participants: true, Stages: true } },
      Stages: { select: { _count: { select: { Problems: true } } } },
    },
  })
  if (!session) throw new Error('benchmark session not found')

  const problemCount = session.Stages.reduce((sum, stage) => sum + stage._count.Problems, 0)
  const workspaceMs: number[] = []
  const dashboardMs: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    let startedAt = performance.now()
    await getTrainingWorkspace(userId, sessionId)
    workspaceMs.push(performance.now() - startedAt)

    startedAt = performance.now()
    await getCoachDashboard(userId, sessionId)
    dashboardMs.push(performance.now() - startedAt)
  }

  const workspaceP95 = percentile(workspaceMs, 95)
  const dashboardP95 = percentile(dashboardMs, 95)
  return {
    skipped: false,
    sessionId,
    participants: session._count.Participants,
    problems: problemCount,
    iterations: ITERATIONS,
    workspace: { p50Ms: percentile(workspaceMs, 50), p95Ms: workspaceP95, maxMs: Math.max(...workspaceMs) },
    dashboard: { p50Ms: percentile(dashboardMs, 50), p95Ms: dashboardP95, maxMs: Math.max(...dashboardMs) },
    thresholdP95Ms: MAX_REAL_P95_MS,
    pass: workspaceP95 <= MAX_REAL_P95_MS && dashboardP95 <= MAX_REAL_P95_MS,
  }
}

async function main() {
  const synthetic = syntheticBenchmark()
  const real = await realSessionBenchmark()
  const pass = synthetic.pass && ('pass' in real ? real.pass !== false : true)
  console.log(JSON.stringify({
    benchmark: 'training-engine-stage-driven',
    generatedAt: new Date().toISOString(),
    synthetic,
    real,
    pass,
  }, null, 2))
  if (!pass) process.exitCode = 1
}

main()
  .catch(error => {
    console.error('Training benchmark failed:', error)
    process.exitCode = 2
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
