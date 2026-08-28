import { prisma } from '../../../prisma'
import {
  inspectAllOiGraphs,
  migrateLegacyTestGraph,
  refreshProblemJudgeProjection,
} from '../../problem/problem.test-graph.service'

export async function applyLegacyTestGraphMigration() {
  const inspection = await inspectAllOiGraphs()
  let migratedCount = 0
  let skippedCount = 0
  let backfilledSnapshotCount = 0
  for (const item of inspection.valid) {
    if (item.alreadyMigrated) {
      skippedCount += 1
      const problem = await prisma.problem.findUnique({ where: { id: item.problemId }, select: { testGraphRevision: true } })
      if (problem?.testGraphRevision) {
        const backfilled = await prisma.trainingProblem.updateMany({
          where: { problemId: item.problemId, testGraphRevisionSnapshot: null },
          data: { testGraphRevisionSnapshot: problem.testGraphRevision },
        })
        backfilledSnapshotCount += backfilled.count
      }
      continue
    }
    const result = await migrateLegacyTestGraph(item.problemId)
    if (!result.ok) continue
    await refreshProblemJudgeProjection(item.problemId)
    const backfilled = await prisma.trainingProblem.updateMany({
      where: { problemId: item.problemId, testGraphRevisionSnapshot: null },
      data: { testGraphRevisionSnapshot: 1 },
    })
    backfilledSnapshotCount += backfilled.count
    migratedCount += 1
  }
  return {
    migratedCount, skippedCount, backfilledSnapshotCount,
    invalidCount: inspection.invalidCount, invalid: inspection.invalid,
  }
}
