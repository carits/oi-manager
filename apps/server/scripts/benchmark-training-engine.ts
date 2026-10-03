import { performance } from 'node:perf_hooks'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const iterations = Math.max(1, Number(process.env.TRAINING_BENCHMARK_ITERATIONS || 20))
  const started = performance.now()
  let rows = 0
  for (let index = 0; index < iterations; index += 1) {
    const sessions = await prisma.trainingSession.findMany({
      take: 50,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        status: true,
        currentRoundId: true,
        _count: { select: { Participants: true, Problems: true, Rounds: true } },
        Rounds: { select: { lifecycle: true, _count: { select: { Assignments: true } } } },
      },
    })
    rows += sessions.length
  }
  const elapsedMs = performance.now() - started
  process.stdout.write(JSON.stringify({
    model: 'training-v3',
    iterations,
    rows,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    averageMs: Math.round((elapsedMs / iterations) * 100) / 100,
  }, null, 2) + '\n')
}

main().finally(() => prisma.$disconnect())
