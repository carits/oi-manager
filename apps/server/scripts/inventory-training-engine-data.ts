import { prisma } from '../src/prisma'

async function main() {
  const [
    sessions,
    stages,
    groups,
    stageAssignments,
    stageProblems,
    progress,
    events,
    templates,
    legacyTrainings,
    sessionStatus,
    stageLifecycle,
    relationSizes,
  ] = await Promise.all([
    prisma.trainingSession.count(),
    prisma.trainingSessionStage.count(),
    prisma.trainingSessionStageGroup.count(),
    prisma.trainingSessionStageParticipantAssignment.count(),
    prisma.trainingSessionStageProblem.count(),
    prisma.trainingSessionProblemProgress.count(),
    prisma.trainingSessionEvent.count(),
    prisma.trainingSessionTemplate.count(),
    prisma.training.count(),
    prisma.trainingSession.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
    prisma.trainingSessionStage.groupBy({ by: ['lifecycle'], _count: { _all: true }, orderBy: { lifecycle: 'asc' } }),
    prisma.$queryRaw<Array<{ tableName: string; sizeBytes: bigint }>>`
      SELECT c.relname AS "tableName", pg_total_relation_size(c.oid)::bigint AS "sizeBytes"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relkind = 'r'
        AND c.relname IN (
          'TrainingSession',
          'TrainingSessionStage',
          'TrainingSessionStageGroup',
          'TrainingSessionStageParticipantAssignment',
          'TrainingSessionStageProblem',
          'TrainingSessionStageProblemPlan',
          'TrainingSessionProblemProgress',
          'TrainingSessionEvent',
          'TrainingSessionTemplate',
          'Training'
        )
      ORDER BY pg_total_relation_size(c.oid) DESC
    `,
  ])

  const snapshot = {
    generatedAt: new Date().toISOString(),
    counts: {
      trainingSessions: sessions,
      stages,
      stageGroups: groups,
      stageAssignments,
      stageProblems,
      progress,
      events,
      templates,
      legacyTrainings,
    },
    sessionStatus: Object.fromEntries(sessionStatus.map(item => [item.status, item._count._all])),
    stageLifecycle: Object.fromEntries(stageLifecycle.map(item => [item.lifecycle, item._count._all])),
    relationSizes: relationSizes.map(item => ({
      table: item.tableName,
      bytes: Number(item.sizeBytes),
      mebibytes: Math.round((Number(item.sizeBytes) / 1024 / 1024) * 1000) / 1000,
    })),
  }

  console.log(JSON.stringify(snapshot, null, 2))
}

main()
  .catch(error => {
    console.error('Training Engine inventory failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
